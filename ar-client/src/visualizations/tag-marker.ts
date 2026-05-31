// TagMarker — a virtual sticky note anchored in the AR scene.
//
// The card is oriented ONCE at construction time to face the camera's position
// at the moment of placement.  It does NOT re-orient each frame (no billboard),
// so it behaves like a note stuck to a surface — it looks head-on when you face
// it and slanted when you look at it from an angle.
//
// A gentle vertical bob and an off-screen direction arrow help the user locate
// the tag after looking away.
//
// Usage:
//   const marker = new TagMarker(scene, tagWorldPosition, label, shortId, camera);
//   renderer.onUpdate(delta => marker.update(camera, delta));
//   marker.dispose();

import * as THREE from 'three';

const NOTE_W   = 0.18;   // metres — card width
const NOTE_H   = 0.12;   // metres — card height
const PIN_H    = 0.06;   // metres — vertical pin below card
const BOB_AMP  = 0.006;  // metres — bob amplitude
const BOB_FREQ = 1.4;    // Hz

export class TagMarker {
  private readonly group: THREE.Group;
  private readonly card: THREE.Mesh;
  private readonly pin: THREE.Line;
  private t = 0;
  /** World-space position of the placement point (group origin). */
  readonly worldPosition: THREE.Vector3;

  constructor(
    private readonly scene: THREE.Scene,
    position: THREE.Vector3,
    label: string,
    shortId: string,
    /** Camera at the moment of placement — card faces this direction and stays. */
    placementCamera?: THREE.Camera,
  ) {
    this.group        = new THREE.Group();
    this.worldPosition = position.clone();

    // ── Sticky-note card ──────────────────────────────────────────────────────
    const tex = this.makeTexture(label, shortId);
    const geo = new THREE.PlaneGeometry(NOTE_W, NOTE_H);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.card = new THREE.Mesh(geo, mat);
    // Raise the card above the placement point by half its height + pin
    this.card.position.set(0, NOTE_H / 2 + PIN_H, 0);
    this.group.add(this.card);

    // ── Thin vertical pin from placement dot to card base ─────────────────────
    const pinGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0,    0),
      new THREE.Vector3(0, PIN_H, 0),
    ]);
    const pinMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    this.pin = new THREE.Line(pinGeo, pinMat);
    this.group.add(this.pin);

    // ── Gold dot at exact placement point ────────────────────────────────────
    this.group.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd700 }),
    ));

    this.group.position.copy(position);
    scene.add(this.group);

    // ── Orient card to face placement camera — set ONCE, never updated ────────
    // This makes the tag look like it is stuck to a surface: you see it face-on
    // when you look toward it and edge-on when you look from the side.
    // PlaneGeometry faces +Z; lookAt makes +Z point toward the target.
    if (placementCamera) {
      const camPos = new THREE.Vector3();
      placementCamera.getWorldPosition(camPos);
      // Card world pos = group.position + card.localPosition
      const cardWorldPos = position.clone().add(
        new THREE.Vector3(0, NOTE_H / 2 + PIN_H, 0),
      );
      // Compute look direction and apply directly — lookAt works in world space
      // but the card is a child of the group, so we must account for that.
      const lookTarget = camPos.clone();
      this.card.lookAt(lookTarget);
    } else {
      // Default: face -Z (toward initial camera position for a typical placement)
      this.card.rotation.y = Math.PI;
    }
  }

  // Call every frame — only animates the gentle bob, no rotation changes.
  update(_camera: THREE.Camera, delta: number): void {
    this.t += delta;
    // Gentle vertical bob in the card's LOCAL position
    this.card.position.y = NOTE_H / 2 + PIN_H + BOB_AMP * Math.sin(this.t * BOB_FREQ * Math.PI * 2);
  }

  /**
   * Returns the card's screen-space position {x, y} in CSS pixels,
   * and whether it is in front of the camera.
   * Use this to draw an off-screen direction arrow.
   */
  getScreenPosition(
    camera: THREE.Camera,
    screenW: number,
    screenH: number,
  ): { x: number; y: number; inFront: boolean } {
    camera.updateMatrixWorld();
    const projected = this.worldPosition.clone().project(camera);
    return {
      x:       (projected.x  + 1) / 2 * screenW,
      y:       (-projected.y + 1) / 2 * screenH,
      inFront: projected.z < 1,
    };
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  dispose(): void {
    this.scene.remove(this.group);
    (this.card.material as THREE.MeshBasicMaterial).map?.dispose();
    this.card.geometry.dispose();
    (this.card.material as THREE.Material).dispose();
    this.pin.geometry.dispose();
    (this.pin.material as THREE.Material).dispose();
  }

  // ── Private: render text → CanvasTexture ────────────────────────────────────
  private makeTexture(label: string, shortId: string): THREE.CanvasTexture {
    const W = 360, H = 240;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // Background — yellow sticky-note colour with rounded corners
    const r = 18;
    ctx.clearRect(0, 0, W, H);
    this.roundRect(ctx, 0, 0, W, H, r, 'rgba(255, 240, 80, 0.93)');

    // Top colour strip (darker yellow)
    this.roundRect(ctx, 0, 0, W, 44, r, 'rgba(230, 190, 20, 0.95)', 'top');

    // Drop shadow (faint, beneath card)
    ctx.shadowColor   = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetY = 4;

    // Tag icon (📌 emoji substitute — just a circle with cross)
    ctx.fillStyle   = '#fff';
    ctx.font        = 'bold 22px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏷', 14, 22);

    // Label text — top strip
    ctx.shadowColor = 'transparent';
    ctx.fillStyle   = '#1a1a1a';
    ctx.font        = 'bold 20px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    const truncated = label.length > 20 ? label.slice(0, 18) + '…' : label;
    ctx.fillText(truncated, 46, 22);

    // Body — ID
    ctx.fillStyle   = '#333';
    ctx.font        = '15px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`ID: ${shortId}`, 16, 56);

    // Body — "INSPECTION POINT" badge
    ctx.fillStyle = 'rgba(0,120,255,0.12)';
    this.roundRect(ctx, 14, 84, 160, 28, 6, 'rgba(0,100,220,0.12)');
    ctx.fillStyle = '#0055bb';
    ctx.font      = 'bold 13px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('INSPECTION POINT', 22, 98);

    // Bottom hint
    ctx.fillStyle    = '#666';
    ctx.font         = '12px -apple-system, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Tap Capture to validate', 16, H - 10);

    return new THREE.CanvasTexture(canvas);
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
    fill: string,
    clip?: 'top' | 'bottom',
  ): void {
    ctx.beginPath();
    if (clip === 'top') {
      // Only round top corners
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
