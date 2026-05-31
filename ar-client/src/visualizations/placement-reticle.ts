// PlacementReticle
// A visual ray from the camera to a green ring 1.5 m ahead.
// Shows the user exactly where a tag will be placed before they confirm.
// Updates every frame — call update() from the render loop.

import * as THREE from 'three';

const DISTANCE = 1.5;   // metres in front of camera

export class PlacementReticle {
  private ring: THREE.Mesh;
  private line: THREE.Line;
  private group: THREE.Group;
  private t = 0;         // time accumulator for pulse

  constructor(private readonly scene: THREE.Scene) {
    this.group = new THREE.Group();

    // ── Ring ────────────────────────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.055, 0.075, 40);
    // Rotate so ring faces +Z (toward camera) by default
    ringGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);

    // Small filled centre dot
    const dotGeo = new THREE.CircleGeometry(0.018, 24);
    dotGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, depthWrite: false });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    this.ring.add(dot);

    // ── Laser line (dashed) ─────────────────────────────────────────────────
    const points = [new THREE.Vector3(0, 0, -0.3), new THREE.Vector3(0, 0, -DISTANCE)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x00ff88,
      dashSize: 0.06,
      gapSize: 0.04,
      opacity: 0.55,
      transparent: true,
    });
    this.line = new THREE.Line(lineGeo, lineMat);
    this.line.computeLineDistances();

    scene.add(this.group);
    scene.add(this.line);   // line stays in world space, updated manually
  }

  // Call every frame. cameraQuat drives the ray direction.
  update(camera: THREE.Camera, delta: number): void {
    this.t += delta;

    // Forward vector from camera (world space)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const camPos  = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    // Place ring DISTANCE metres along the ray
    const ringPos = camPos.clone().addScaledVector(forward, DISTANCE);
    this.ring.position.copy(ringPos);
    this.ring.lookAt(camPos);          // always face camera

    // Pulse ring scale
    const pulse = 1 + 0.08 * Math.sin(this.t * 4);
    this.ring.scale.setScalar(pulse);

    // Reposition group
    this.group.position.copy(ringPos);

    // Update laser line endpoints
    const nearPos = camPos.clone().addScaledVector(forward, 0.3);
    const positions = (this.line.geometry as THREE.BufferGeometry)
      .getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, nearPos.x, nearPos.y, nearPos.z);
    positions.setXYZ(1, ringPos.x, ringPos.y, ringPos.z);
    positions.needsUpdate = true;
    this.line.computeLineDistances();

    // Add ring to scene graph (if not already)
    if (!this.group.children.includes(this.ring)) {
      this.group.add(this.ring);
    }
  }

  // Returns current world position of the ring — use this as the tag position.
  getPosition(): THREE.Vector3 {
    return this.ring.position.clone();
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.line.visible  = v;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.remove(this.line);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
