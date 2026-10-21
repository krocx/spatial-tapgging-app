// assets.ts - what an asset's bytes are (never trust `Format`), and the
// coordinate conversion from the Guides (Unity) frame to SIB's.
//
// Proprietary & Confidential · Applied Materials.

export type Sniffed = 'glb' | 'gltf' | 'png' | 'jpeg' | 'mp4' | 'webm' | 'mp3' | 'wav' | 'unknown';

/** The content type from the first bytes. */
export function sniff(bytes: Buffer): Sniffed {
  if (bytes.length >= 4) {
    if (bytes.toString('latin1', 0, 4) === 'glTF') return 'glb';
    if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
    if (bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
    if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.length >= 12 && bytes.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  }
  // a .gltf is JSON text
  const head = bytes.subarray(0, 64).toString('utf8').trimStart();
  if (head.startsWith('{')) return 'gltf';
  return 'unknown';
}

// ── Coordinates ───────────────────────────────────────────────────────────────
//
// Guides runs on HoloLens / Unity: left-handed, Y up, metres, quaternions as
// (x, y, z, w). glTF / RealityKit / SceneKit / USD are right-handed, Y up.
// The expected conversion is position (x, y, -z) and rotation (-x, -y, z, w).
// It lives here, behind one flag, so the day a real guide is checked against
// a HoloLens placement it is one line to correct. Only placement and
// attention-director transforms go through it; GLB mesh data is already
// right-handed per the glTF spec and is never touched.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface FrameConversion { flipZ: boolean }
export const DEFAULT_FRAME: FrameConversion = { flipZ: true };

const neg = (v: number) => (v === 0 ? 0 : -v);   // no -0 in the output (reads badly in diffs and tests)
export function convertPosition(p: Vec3, f: FrameConversion = DEFAULT_FRAME): Vec3 { return f.flipZ ? [p[0], p[1], neg(p[2])] : [p[0], p[1], p[2]]; }
export function convertRotation(q: Quat, f: FrameConversion = DEFAULT_FRAME): Quat { return f.flipZ ? [neg(q[0]), neg(q[1]), q[2], q[3]] : [q[0], q[1], q[2], q[3]]; }
export function convertScale(s: Vec3): Vec3 { return [s[0], s[1], s[2]]; }

/** A unit quaternion, or identity when the source is degenerate. Some guides
 *  store every placement rotation as (0, 0, 0, 0): three.js happens to treat
 *  that as identity, but SceneKit's simd_float4x4(simd_quatf) turns it into a
 *  zero matrix and the model draws as nothing on iOS. `repaired` says whether
 *  the input was unusable (zero length or non-finite), so the report can count it. */
export function normalizeQuat(q: Quat): { q: Quat; repaired: boolean } {
  if (!q.every(Number.isFinite)) return { q: [0, 0, 0, 1], repaired: true };
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-6) return { q: [0, 0, 0, 1], repaired: true };
  if (Math.abs(n - 1) < 1e-6) return { q: [q[0], q[1], q[2], q[3]], repaired: false };
  return { q: [q[0] / n, q[1] / n, q[2] / n, q[3] / n], repaired: false };
}

/** Quaternion (x, y, z, w) → axis-angle [x, y, z, radians] (SIB's GuideStepNode rotation form). */
export function quatToAxisAngle(input: Quat): [number, number, number, number] {
  const q = normalizeQuat(input).q;
  const x = q[0], y = q[1], z = q[2], w = Math.max(-1, Math.min(1, q[3]));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-6) return [0, 1, 0, 0];
  return [x / s, y / s, z / s, angle];
}
