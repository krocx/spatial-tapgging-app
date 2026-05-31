// HoneycombSphere v2 — screen-space alignment + billboard nodes
//
// UX model (matches Vuforia Expert Capture style):
//   • 8 ring-shaped nodes distributed around the tag via Fibonacci lattice.
//   • Nodes always face the camera (billboard).
//   • One "target" node (next to capture) pulses cyan — the user aims the
//     screen crosshair AT it.
//   • Alignment is checked in screen space: if the target node's screen
//     position is within ALIGN_PX_RATIO of screen centre → aligned.
//   • 500ms dwell (hold steady) before auto-capture fires.
//   • Captured nodes turn green permanently.
//
// API:
//   const hc = new HoneycombSphere(scene, tagWorldPosition);
//   // every frame:
//   hc.update(camera, t);                                 // billboard + visuals
//   const aligned = hc.getAlignedNodeScreenSpace(cam,W,H); // null | HoneycombNode
//   hc.setDwellProgress(0..1);                            // drive progress colour
//   hc.markCaptured(node.index);                          // lock green
//   if (hc.isComplete()) { ... }

import * as THREE from 'three';

export interface HoneycombNode {
  index: number;
  direction: THREE.Vector3;   // unit vector from sphere centre to this node
  worldPos: THREE.Vector3;    // cached absolute world position
  captured: boolean;
  mesh: THREE.Mesh;           // main ring mesh
  glowRing: THREE.Mesh;       // outer pulsing glow ring (child of mesh)
}

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_COUNT     = 8;
const SPHERE_RADIUS  = 0.40;   // metres — sphere around the tag
const NODE_INNER     = 0.028;  // ring inner radius (m)
const NODE_OUTER     = 0.055;  // ring outer radius (m)
const ALIGN_PX_RATIO = 0.14;   // screen-space threshold: fraction of min(W,H)

const COLOR_PENDING  = new THREE.Color(0x445566);
const COLOR_TARGET   = new THREE.Color(0x00ccff);   // next node to capture
const COLOR_ALIGNED  = new THREE.Color(0xffffff);   // dwell in progress
const COLOR_CAPTURED = new THREE.Color(0x00ee66);

// ── HoneycombSphere ───────────────────────────────────────────────────────────
export class HoneycombSphere {
  private group: THREE.Group;
  private nodes: HoneycombNode[] = [];
  private alignedIndex  = -1;
  private targetIndex   = 0;    // next uncaptured node index

  constructor(private readonly scene: THREE.Scene, centre: THREE.Vector3) {
    this.group = new THREE.Group();
    this.group.position.copy(centre);

    // ── Wireframe sphere shell ───────────────────────────────────────────────
    const shellGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 16, 10);
    const shellMat = new THREE.MeshBasicMaterial({
      color: 0x0077aa,
      transparent: true,
      opacity: 0.07,
      wireframe: true,
      depthWrite: false,
    });
    this.group.add(new THREE.Mesh(shellGeo, shellMat));

    // ── Nodes ────────────────────────────────────────────────────────────────
    fibonacciSphere(NODE_COUNT).forEach((dir, i) => {
      // Main ring — starts in XY plane, then billboarded via lookAt each frame
      const ringGeo = new THREE.RingGeometry(NODE_INNER, NODE_OUTER, 36);
      const ringMat = new THREE.MeshBasicMaterial({
        color: i === 0 ? COLOR_TARGET : COLOR_PENDING,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: i === 0 ? 0.9 : 0.5,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.position.copy(dir.clone().multiplyScalar(SPHERE_RADIUS));

      // Outer glow ring — visible only when this node is target / aligned
      const glowGeo = new THREE.RingGeometry(NODE_OUTER * 1.15, NODE_OUTER * 1.55, 36);
      const glowMat = new THREE.MeshBasicMaterial({
        color: COLOR_TARGET,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const glowRing = new THREE.Mesh(glowGeo, glowMat);
      mesh.add(glowRing);   // child — inherits billboard transform

      this.group.add(mesh);

      const worldPos = this.group.position.clone().add(dir.clone().multiplyScalar(SPHERE_RADIUS));
      this.nodes.push({ index: i, direction: dir, worldPos, captured: false, mesh, glowRing });
    });

    // ── Centre dot ───────────────────────────────────────────────────────────
    this.group.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.010, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    ));

    scene.add(this.group);
  }

  // ── Per-frame visual update ───────────────────────────────────────────────
  // Call every frame. Updates billboard orientation + target / aligned colours.
  update(camera: THREE.Camera, t: number): void {
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    this.nodes.forEach(node => {
      // Billboard: ring always faces camera
      node.mesh.lookAt(camPos);

      const mat     = node.mesh.material as THREE.MeshBasicMaterial;
      const glowMat = node.glowRing.material as THREE.MeshBasicMaterial;

      if (node.captured) {
        // Already captured — static green, no glow
        mat.color.set(COLOR_CAPTURED);
        mat.opacity   = 0.85;
        glowMat.opacity = 0;
        node.mesh.scale.setScalar(1.0);
        return;
      }

      if (node.index === this.alignedIndex) {
        // Crosshair on this node — bright white + fast glow pulse
        mat.color.set(COLOR_ALIGNED);
        mat.opacity = 1.0;
        glowMat.color.set(COLOR_ALIGNED);
        glowMat.opacity = 0.25 + 0.25 * Math.sin(t * 10);
        node.mesh.scale.setScalar(1.0);

      } else if (node.index === this.targetIndex) {
        // This is the NEXT node to capture — slow cyan pulse
        const pulse = 1 + 0.12 * Math.sin(t * 3);
        node.mesh.scale.setScalar(pulse);
        mat.color.set(COLOR_TARGET);
        mat.opacity = 0.7 + 0.25 * Math.abs(Math.sin(t * 3));
        glowMat.color.set(COLOR_TARGET);
        glowMat.opacity = 0.18 * (0.5 + 0.5 * Math.sin(t * 3));

      } else {
        // Pending — dim, no animation
        node.mesh.scale.setScalar(1.0);
        mat.color.set(COLOR_PENDING);
        mat.opacity   = 0.45;
        glowMat.opacity = 0;
      }
    });
  }

  // ── Screen-space alignment check ─────────────────────────────────────────
  // Projects every uncaptured node to screen coords and returns the one
  // closest to screen centre if it's within the alignment threshold.
  // Sets this.alignedIndex as a side-effect (used by update() for visuals).
  getAlignedNodeScreenSpace(
    camera: THREE.Camera,
    screenW: number,
    screenH: number,
  ): HoneycombNode | null {
    const threshold = ALIGN_PX_RATIO * Math.min(screenW, screenH);
    const cx = screenW / 2;
    const cy = screenH / 2;

    this.alignedIndex = -1;
    let bestDist = threshold;

    // Make sure camera matrices are current before projecting
    camera.updateMatrixWorld();

    this.nodes.forEach(node => {
      if (node.captured) return;

      const projected = node.worldPos.clone().project(camera);
      if (projected.z > 1) return;  // node is behind camera

      const sx   = (projected.x + 1) / 2 * screenW;
      const sy   = (-projected.y + 1) / 2 * screenH;
      const dist = Math.hypot(sx - cx, sy - cy);

      if (dist < bestDist) {
        bestDist           = dist;
        this.alignedIndex  = node.index;
      }
    });

    return this.alignedIndex >= 0 ? this.nodes[this.alignedIndex] ?? null : null;
  }

  // ── Dwell-progress colour ────────────────────────────────────────────────
  // progress: 0 = just aligned (cyan), 1 = about to capture (white).
  // Call this every frame while alignment is held.
  setDwellProgress(progress: number): void {
    if (this.alignedIndex < 0) return;
    const node = this.nodes[this.alignedIndex];
    if (!node || node.captured) return;
    const c = new THREE.Color().lerpColors(COLOR_TARGET, COLOR_ALIGNED, progress);
    (node.mesh.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  // ── Target node getter ────────────────────────────────────────────────────
  getTargetNode(): HoneycombNode | null {
    return this.nodes[this.targetIndex] ?? null;
  }

  // ── Mark captured ────────────────────────────────────────────────────────
  markCaptured(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node) return;
    node.captured = true;
    this.alignedIndex = -1;

    // Brief white flash, then settle to green
    const mat = node.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(0xffffff);
    mat.opacity = 1.0;
    (node.glowRing.material as THREE.MeshBasicMaterial).opacity = 0;
    node.mesh.scale.setScalar(1.15);

    setTimeout(() => {
      mat.color.set(COLOR_CAPTURED);
      mat.opacity = 0.85;
      node.mesh.scale.setScalar(1.0);
    }, 200);

    this.refreshTargetIndex();
  }

  // ── Status helpers ────────────────────────────────────────────────────────
  isComplete(): boolean           { return this.nodes.every(n => n.captured); }
  capturedCount(): number         { return this.nodes.filter(n => n.captured).length; }
  totalCount(): number            { return this.nodes.length; }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  dispose(): void {
    this.scene.remove(this.group);
    this.nodes.forEach(n => {
      n.mesh.geometry.dispose();
      (n.mesh.material as THREE.Material).dispose();
      n.glowRing.geometry.dispose();
      (n.glowRing.material as THREE.Material).dispose();
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private refreshTargetIndex(): void {
    const next = this.nodes.find(n => !n.captured);
    this.targetIndex = next ? next.index : -1;
  }
}

// ── Fibonacci lattice ─────────────────────────────────────────────────────────
// Distributes N points near-uniformly over a unit sphere.
function fibonacciSphere(count: number): THREE.Vector3[] {
  const φ = (1 + Math.sqrt(5)) / 2;
  return Array.from({ length: count }, (_, i) => {
    const theta = Math.acos(1 - (2 * (i + 0.5)) / count);
    const phi   = 2 * Math.PI * i / φ;
    return new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi),
    ).normalize();
  });
}
