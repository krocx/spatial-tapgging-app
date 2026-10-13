// xr-hands.js - hands in the XR kit (H1, 2026.4.50). Own code on the WebXR
// Hand Input API; no SDK.
//
// What it gives xr.html, per frame:
//   • the joints of each tracked hand, drawn as a quiet skeleton (dots and
//     bones in the ink tiers) with the pinch point marked;
//   • a gesture vocabulary of four, every one HELD for 0.8 s against a
//     registration mark that locks in (the brand's focus signature), so a
//     glove twitch never triggers anything:
//       pinch on a part   → "I am on this step" / grab to inspect
//       point at a part   → mark it ("look here", from the technician's side)
//       thumbs up         → pass the step's check (or next, when there is none)
//       open palm, pushed → call for help (presence)
//   • part proximity: how close the index tip is to each of the step's parts,
//     so the part can light as the hand approaches ("reach for the right part");
//   • the wrist pose, so the step card can sit on the back of the hand;
//   • grab to inspect: a pinched part comes into the hand as a copy;
//   • evidence: whether the hands were at the part, and for how long - a fact
//     about the run, never a recording.
//
// A simulator drives the same pipeline from the mouse on the desktop preview
// (`?hands=sim`): the fingertip is where the pointer meets the model; keys
// hold the gestures (P pinch · I point · T thumbs up · O open palm). It is for
// reviewing the look, not a substitute for the headset.
//
// Colours are read from the page's CSS variables (tokens); nothing fades or
// slides - states switch, the mark locks in.

const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];
// bones: wrist → each finger's first joint, then along the finger (thumb 1-4, then 5-9, 10-14, 15-19, 20-24)
const BONES = []; for (const [a, b] of [[1, 4], [5, 9], [10, 14], [15, 19], [20, 24]]) { BONES.push([0, a]); for (let j = a; j < b; j++) BONES.push([j, j + 1]); }
const TIPS = { thumb: 4, index: 9, middle: 14, ring: 19, pinky: 24 };
const HOLD_MS = 800, COOLDOWN_MS = 1500;
const PINCH_M = 0.022, NEAR_M = 0.12, ON_M = 0.045, ZONE_M = 0.15;

export class XRHands {
  /**
   * @param {typeof import('three')} THREE
   * @param {import('three').Scene} scene
   * @param {{ colors?: Record<string,string>, onGesture?: (g: string, hand: HandState) => void }} opts
   */
  constructor(THREE, scene, opts = {}) {
    this.THREE = THREE; this.scene = scene; this.onGesture = opts.onGesture || (() => {});
    const c = Object.assign({ ink: '#ffffff', ink3: 'rgba(255,255,255,.5)', green: '#30D158', blue: '#0A84FF', orange: '#FF9F0A' }, opts.colors || {});
    this.colors = c;
    this.hands = { left: this._newHand('left'), right: this._newHand('right') };
    this.enabled = false; this.sim = null; this.grab = null; this.zone = { tracked: false, ms: 0, onPart: null, samples: 0, onSamples: 0 };
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  _newHand(side) {
    const { THREE } = this;
    const g = new THREE.Group(); g.visible = false; this.scene.add(g);
    const dot = new THREE.SphereGeometry(0.004, 8, 6);
    const joints = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial({ color: this.colors.ink, transparent: true, opacity: 0.55, depthTest: false }), JOINTS.length);
    joints.renderOrder = 998; g.add(joints);
    const bones = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BONES.length * 6), 3)), new THREE.LineBasicMaterial({ color: this.colors.ink, transparent: true, opacity: 0.28, depthTest: false }));
    bones.renderOrder = 998; g.add(bones);
    // the registration mark at the pinch / point: four corners that lock in as the hold completes
    const mark = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3)), new THREE.LineBasicMaterial({ color: this.colors.blue, transparent: true, opacity: 0.95, depthTest: false }));
    mark.renderOrder = 999; mark.visible = false; this.scene.add(mark);
    return { side, group: g, joints, bones, mark, pos: JOINTS.map(() => new THREE.Vector3()), tracked: false, pinching: false, gesture: null, since: 0, fired: -1e9, progress: 0, palm: new THREE.Vector3(), focus: new THREE.Vector3() };
  }

  // ── Per frame ─────────────────────────────────────────────────────────────
  /** Read the joints from the XR frame (or the simulator), draw them, recognise gestures. */
  update(frame, refSpace, session, camera, dt) {
    const { THREE } = this; const camPos = this._w.setFromMatrixPosition(camera.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this._q));
    for (const h of Object.values(this.hands)) h.tracked = false;
    if (this.sim) this._readSim(camera);
    else if (frame && session) for (const src of session.inputSources) {
      if (!src.hand) continue;
      const h = this.hands[src.handedness === 'left' ? 'left' : 'right']; let ok = 0;
      JOINTS.forEach((name, i) => { const js = src.hand.get(name); const p = js && frame.getJointPose(js, refSpace); if (p) { h.pos[i].set(p.transform.position.x, p.transform.position.y, p.transform.position.z); ok++; } });
      h.tracked = ok >= 20;
    }
    this.enabled = Object.values(this.hands).some(h => h.tracked) || !!this.sim;
    for (const h of Object.values(this.hands)) { this._draw(h); this._recognise(h, camPos, fwd, dt); }
    if (this.grab) this._followGrab();
  }
  _draw(h) {
    h.group.visible = h.tracked;
    if (!h.group.visible) { if (!h.tracked) h.mark.visible = false; return; }
    const m = new this.THREE.Matrix4();
    h.pos.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); h.joints.setMatrixAt(i, m); }); h.joints.instanceMatrix.needsUpdate = true;
    const a = h.bones.geometry.attributes.position; BONES.forEach(([i, j], k) => { a.setXYZ(k * 2, h.pos[i].x, h.pos[i].y, h.pos[i].z); a.setXYZ(k * 2 + 1, h.pos[j].x, h.pos[j].y, h.pos[j].z); }); a.needsUpdate = true;
  }
  _extended(h, finger) { // tip far from the wrist relative to the hand's size (wrist → middle metacarpal)
    const size = h.pos[0].distanceTo(h.pos[10]) || 0.08; const tip = h.pos[TIPS[finger]].distanceTo(h.pos[0]) / size;
    return finger === 'thumb' ? tip > 1.35 : tip > 1.9;
  }
  _curled(h, finger) { const size = h.pos[0].distanceTo(h.pos[10]) || 0.08; return h.pos[TIPS[finger]].distanceTo(h.pos[0]) / size < 1.5; }
  _recognise(h, camPos, fwd, dt) {
    if (!h.tracked) { h.gesture = null; h.progress = 0; h.mark.visible = false; h.pinching = false; return; }
    const { THREE } = this;
    // palm normal: from the wrist, index metacarpal and pinky metacarpal
    const a = this._v.subVectors(h.pos[5], h.pos[0]), b = new THREE.Vector3().subVectors(h.pos[20], h.pos[0]);
    h.palm.crossVectors(a, b).normalize(); if (h.side === 'right') h.palm.negate();
    const pinchD = h.pos[TIPS.thumb].distanceTo(h.pos[TIPS.index]);
    h.pinching = pinchD < PINCH_M;
    let g = null;
    if (this.sim) { g = this.sim.gesture || null; h.pinching = g === 'pinch'; h.focus.copy(g === 'thumbs-up' ? h.pos[TIPS.thumb] : g === 'open-palm' ? h.pos[10] : h.pos[TIPS.index]); }
    else if (h.pinching) { g = 'pinch'; h.focus.lerpVectors(h.pos[TIPS.thumb], h.pos[TIPS.index], 0.5); }
    else if (this._extended(h, 'index') && this._curled(h, 'middle') && this._curled(h, 'ring') && this._curled(h, 'pinky')) { g = 'point'; h.focus.copy(h.pos[TIPS.index]); }
    else if (this._extended(h, 'thumb') && h.pos[TIPS.thumb].y - h.pos[0].y > 0.05 && this._curled(h, 'index') && this._curled(h, 'middle') && this._curled(h, 'ring') && this._curled(h, 'pinky')) { g = 'thumbs-up'; h.focus.copy(h.pos[TIPS.thumb]); }
    else if (['index', 'middle', 'ring', 'pinky'].every(f => this._extended(h, f)) && h.palm.dot(fwd) > 0.45) { g = 'open-palm'; h.focus.copy(h.pos[10]); }
    const now = performance.now();
    if (g !== h.gesture) { h.gesture = g; h.since = now; h.progress = 0; }
    else if (g && now - h.fired > COOLDOWN_MS) {
      h.progress = Math.min(1, (now - h.since) / HOLD_MS);
      if (h.progress >= 1) { h.fired = now; h.since = now; h.progress = 0; this.onGesture(g, h); }
    }
    this._mark(h);
  }
  /** The registration mark at the hand's focus: four corners that close in with the hold and lock in. */
  _mark(h) {
    const show = !!h.gesture && h.tracked; h.mark.visible = show; if (!show) return;
    const p = h.progress, size = 0.05 - 0.025 * p, len = 0.012 + 0.012 * p, c = h.focus;
    const a = h.mark.geometry.attributes.position; let k = 0;
    const seg = (x1, y1, x2, y2) => { a.setXYZ(k++, c.x + x1, c.y + y1, c.z); a.setXYZ(k++, c.x + x2, c.y + y2, c.z); };
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { seg(sx * size, sy * size, sx * (size - len), sy * size); seg(sx * size, sy * size, sx * size, sy * (size - len)); }
    a.needsUpdate = true;
    h.mark.material.color.set(h.gesture === 'thumbs-up' ? this.colors.green : h.gesture === 'open-palm' ? this.colors.orange : this.colors.blue);
    h.mark.lookAt(this._w); // faces the viewer (camera position cached in update)
  }

  // ── Parts: proximity, zone evidence, grab ─────────────────────────────────
  /**
   * @param {{ name: string, center: import('three').Vector3, mats: any[] }[]} targets - the step's parts in world space
   * @returns {{ near: {name, strength}[], on: string|null, nearest: number|null }}
   */
  proximity(targets, dt) {
    let on = null, nearest = null; const near = [];
    const tips = Object.values(this.hands).filter(h => h.tracked).map(h => h.pos[TIPS.index]);
    for (const t of targets) {
      let d = Infinity; for (const tip of tips) d = Math.min(d, tip.distanceTo(t.center));
      if (d < NEAR_M) near.push({ name: t.name, strength: 1 - d / NEAR_M });
      if (d < ON_M && (on === null || d < nearest)) on = t.name;
      if (nearest === null || d < nearest) nearest = d;
    }
    // evidence: hands tracked, and at the part (within the zone) for how long
    this.zone.tracked = this.zone.tracked || this.enabled;
    if (this.enabled) { this.zone.samples++; if (nearest !== null && nearest < ZONE_M) { this.zone.ms += dt * 1000; this.zone.onSamples++; } }
    this.zone.onPart = on;
    return { near, on, nearest };
  }
  /** The evidence fact for the current step, and reset for the next. */
  evidence() {
    const z = this.zone; const out = { tracked: z.tracked, inZoneSeconds: Math.round(z.ms / 100) / 10, share: z.samples ? Math.round(z.onSamples / z.samples * 100) / 100 : 0, onPartAtCheck: !!z.onPart };
    return out;
  }
  resetEvidence() { this.zone = { tracked: this.enabled, ms: 0, onPart: null, samples: 0, onSamples: 0 }; }
  /** Grab to inspect: a copy of the part comes into the pinching hand; release returns it. */
  grabStart(hand, partObj, name) {
    if (this.grab) this.grabEnd();
    const clone = partObj.clone(true);
    clone.traverse(o => { if (o.isMesh) { o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.transparent = true; c.opacity = Math.max(0.85, c.opacity ?? 1); c.visible = true; c.emissive?.set(this.colors.blue); c.emissiveIntensity = 0.25; return c; }); if (o.material.length === 1) o.material = o.material[0]; } });
    const box = new this.THREE.Box3().setFromObject(partObj); const size = box.getSize(new this.THREE.Vector3()).length() || 0.1;
    const g = new this.THREE.Group(); g.add(clone); clone.position.sub(box.getCenter(new this.THREE.Vector3())); g.scale.setScalar(Math.min(1, 0.12 / size));
    this.scene.add(g); this.grab = { hand, group: g, name };
  }
  _followGrab() { const h = this.grab.hand; if (!h.tracked) return; this.grab.group.position.copy(h.focus); this.grab.group.quaternion.setFromRotationMatrix(new this.THREE.Matrix4().lookAt(h.pos[0], h.pos[10], h.palm)); }
  grabEnd() { if (!this.grab) return null; this.scene.remove(this.grab.group); const n = this.grab.name; this.grab = null; return n; }
  /** Where the step card may sit: the back of the non-dominant hand when it faces the viewer. */
  wrist(camera, side = 'left') {
    const h = this.hands[side]; if (!h.tracked) return null;
    const camPos = this._w.setFromMatrixPosition(camera.matrixWorld); const toCam = new this.THREE.Vector3().subVectors(camPos, h.pos[0]).normalize();
    if (h.palm.dot(toCam) > -0.25) return null;                 // the palm must face away, the back of the hand toward the viewer
    const up = h.palm.clone().negate();                          // off the back of the hand
    const pos = h.pos[10].clone().addScaledVector(up, 0.08).add(new this.THREE.Vector3().subVectors(h.pos[0], h.pos[10]).multiplyScalar(0.6));
    return { position: pos, lookAt: camPos };
  }
  pinching(side) { return this.hands[side].pinching; }
  focus(side) { return this.hands[side].focus; }

  // ── Simulator (desktop review) ────────────────────────────────────────────
  /** Drive the right hand from a world point (the pointer on the model) and a held gesture name. */
  simulate(point, gesture, camera) { this.sim = { point: point ? point.clone() : null, gesture }; }
  _readSim(camera) {
    const h = this.hands.right; const s = this.sim; if (!s.point) { h.tracked = false; return; }
    const { THREE } = this; const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const toCam = new THREE.Vector3().subVectors(camPos, s.point).normalize(); const right = new THREE.Vector3().crossVectors(toCam, new THREE.Vector3(0, 1, 0)).normalize();
    // a schematic hand: wrist 15 cm toward the viewer and below, tips laid out by the gesture
    const wrist = s.point.clone().addScaledVector(toCam, 0.12).add(new THREE.Vector3(0, -0.05, 0));
    const size = 0.085; h.pos[0].copy(wrist); h.pos[10].copy(wrist).addScaledVector(toCam, -size);
    h.pos[5].copy(wrist).addScaledVector(toCam, -size).addScaledVector(right, 0.02); h.pos[20].copy(wrist).addScaledVector(toCam, -size).addScaledVector(right, -0.03);
    const ext = f => h.pos[TIPS[f]].copy(wrist).addScaledVector(toCam, -size * 2.1).addScaledVector(right, { thumb: 0.04, index: 0.02, middle: 0, ring: -0.02, pinky: -0.04 }[f]);
    const curl = f => h.pos[TIPS[f]].copy(wrist).addScaledVector(toCam, -size * 1.2).addScaledVector(right, { thumb: 0.03, index: 0.02, middle: 0, ring: -0.02, pinky: -0.04 }[f]);
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) ext(f);
    if (s.gesture === 'pinch') { h.pos[TIPS.index].copy(s.point); h.pos[TIPS.thumb].copy(s.point).addScaledVector(right, 0.01); }
    else if (s.gesture === 'point') { for (const f of ['middle', 'ring', 'pinky']) curl(f); h.pos[TIPS.index].copy(s.point); curl('thumb'); }
    else if (s.gesture === 'thumbs-up') { for (const f of ['index', 'middle', 'ring', 'pinky']) curl(f); h.pos[TIPS.thumb].copy(wrist).add(new THREE.Vector3(0, size * 1.5, 0)); }
    else if (s.gesture === 'open-palm') { /* all extended, palm toward the model */ }
    else { h.pos[TIPS.index].copy(s.point); }
    h.tracked = true;
  }
}
