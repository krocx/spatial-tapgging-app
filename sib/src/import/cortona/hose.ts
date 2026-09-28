// hose.ts - Cortona3D hose / cable sweeps (`HoseSplineFlow`, `HoseSplineFlow2`)
// rebuilt as real geometry at import.
//
// In the viewer these PROTOs carry no mesh: a script builds a tube at
// runtime along a Hermite spline through control-point objects (the tiny
// `BoxDummy` ObjectVMs), with a circular cross-section of `WireDiameter`.
// An O-ring seal, a cable, a wire: all of them. Without this the model has
// the control points (3 mm boxes) and no tube - the Bee drone's seal step
// showed nothing. The spine maths below is the viewer's own `buildSpine()`
// transcribed; the tube is our sweep of a circle along it.
//
// Static only (the rest pose of the control points). The seal-insertion
// animation moves the control points and the viewer rebuilds the tube per
// frame; a flipbook of sampled frames is the follow-up (CORTONA3D-IMPORT.md).
//
// Proprietary & Confidential · Applied Materials.

import { type VrmlNode, type VrmlUse, numField, boolField, nodesField } from './vrml.js';
import { mul } from './scene.js';

export const HOSE_TYPES = /^HoseSplineFlow\d*$/;

export interface HoseMesh { positions: number[]; indices: number[]; controlPoints: number }

type Vec = [number, number, number];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec): Vec => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Point / direction through a column-major 4x4. */
const xfP = (m: number[], p: Vec): Vec => [
  m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const xfV = (m: number[], v: Vec): Vec => [
  m[0] * v[0] + m[4] * v[1] + m[8]  * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9]  * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];

/** Inverse of an affine column-major 4x4 (rotation · scale · translation). */
export function invertAffine(m: number[]): number[] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  const r = [
    A / det, B / det, C / det, 0,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, 0,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det, 0,
    0, 0, 0, 1];
  const t = xfV(r, [m[12], m[13], m[14]]);
  r[12] = -t[0]; r[13] = -t[1]; r[14] = -t[2];
  return r;
}

/**
 * Build the tube for one hose instance, in the frame of the ObjectVM that
 * owns it. `worldOf` gives the assembly-frame matrix of a control-point
 * node (null when unknown: the hose is skipped).
 */
export function buildHose(
  geom: VrmlNode, ownerWorld: number[],
  worldOf: (n: VrmlNode | VrmlUse) => number[] | null,
): HoseMesh | null {
  const objects = nodesField(geom, 'Objects');
  const n = objects.length;
  if (n < 2) return null;
  const pointsF = numField(geom, 'Points', []);
  const tangF   = numField(geom, 'Tangents', []);
  const curvature = numField(geom, 'SpineCurvature', [1])[0];
  const perSeg  = Math.max(1, Math.round(numField(geom, 'PointsPerSegment', [10])[0]));
  const diameter = numField(geom, 'WireDiameter', [0.01])[0];
  const crossQ  = Math.max(3, Math.round(numField(geom, 'cross_quality', [8])[0]));
  const useIntermediate = boolField(geom, 'UseIntermediateTangents') ?? true;

  const toOwner = invertAffine(ownerWorld);
  const pnts: Vec[] = []; const tang: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const w = worldOf(objects[i]); if (!w) return null;
    const m = mul(toOwner, w);
    const p: Vec = pointsF.length >= (i + 1) * 3 ? [pointsF[i * 3], pointsF[i * 3 + 1], pointsF[i * 3 + 2]] : [0, 0, 0];
    const t: Vec = tangF.length >= (i + 1) * 3 ? [tangF[i * 3], tangF[i * 3 + 1], tangF[i * 3 + 2]] : [0, 0, 1];
    pnts.push(xfP(m, p)); tang.push(xfV(m, t));
  }
  tang[n - 1] = mulS(tang[n - 1], -1);
  if (!useIntermediate) for (let i = 1; i < n - 1; i++) tang[i] = norm(sub(pnts[i + 1], pnts[i - 1]));

  // Viewer's Hermite: per segment k = chord · curvature; p = a·p0 + b·t0 + c·t1 + d·p1.
  const spine: Vec[] = [];
  for (let i = 0; i < n - 1; i++) {
    const k = len(sub(pnts[i + 1], pnts[i])) * curvature;
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg, t1 = 1 - t;
      const d = (3 - 2 * t) * t * t, a = 1 - d, b = t * t1 * t1 * k, c = -t * t * t1 * k;
      spine.push(add(add(mulS(pnts[i], a), mulS(tang[i], b)), add(mulS(tang[i + 1], c), mulS(pnts[i + 1], d))));
    }
  }
  spine.push(pnts[n - 1]);
  // Drop repeated points (zero-length steps break the frame).
  const sp: Vec[] = [spine[0]];
  for (let i = 1; i < spine.length; i++) if (len(sub(spine[i], sp[sp.length - 1])) > 1e-7) sp.push(spine[i]);
  if (sp.length < 2) return null;

  // Sweep a circle along the spine with a parallel-transported frame.
  const r = diameter / 2;
  const positions: number[] = []; const indices: number[] = [];
  let prevT: Vec = norm(sub(sp[1], sp[0]));
  let normal: Vec = Math.abs(prevT[1]) < 0.9 ? norm(cross(prevT, [0, 1, 0])) : norm(cross(prevT, [1, 0, 0]));
  for (let i = 0; i < sp.length; i++) {
    const tDir: Vec = i === 0 ? prevT : i === sp.length - 1 ? norm(sub(sp[i], sp[i - 1])) : norm(sub(sp[i + 1], sp[i - 1]));
    // Rotate the normal from the previous tangent to this one (parallel transport).
    const axis = cross(prevT, tDir); const s = len(axis);
    if (s > 1e-6) {
      const ax = mulS(axis, 1 / s); const cth = Math.max(-1, Math.min(1, dot(prevT, tDir))); const sth = s;
      // Rodrigues
      normal = add(add(mulS(normal, cth), mulS(cross(ax, normal), sth)), mulS(ax, dot(ax, normal) * (1 - cth)));
    }
    normal = norm(sub(normal, mulS(tDir, dot(normal, tDir))));
    const binormal = cross(tDir, normal);
    for (let k = 0; k < crossQ; k++) {
      const ang = 2 * Math.PI * k / crossQ;
      const off = add(mulS(normal, r * Math.cos(ang)), mulS(binormal, r * Math.sin(ang)));
      const v = add(sp[i], off); positions.push(v[0], v[1], v[2]);
    }
    prevT = tDir;
  }
  for (let i = 0; i + 1 < sp.length; i++) {
    const a0 = i * crossQ, b0 = (i + 1) * crossQ;
    for (let k = 0; k < crossQ; k++) {
      const k1 = (k + 1) % crossQ;
      indices.push(a0 + k, b0 + k, b0 + k1, a0 + k, b0 + k1, a0 + k1);
    }
  }
  // End caps
  const capStart = positions.length / 3;
  positions.push(sp[0][0], sp[0][1], sp[0][2]);
  const capEnd = positions.length / 3;
  const last = sp[sp.length - 1]; positions.push(last[0], last[1], last[2]);
  const lastRing = (sp.length - 1) * crossQ;
  for (let k = 0; k < crossQ; k++) {
    const k1 = (k + 1) % crossQ;
    indices.push(capStart, k1, k);
    indices.push(capEnd, lastRing + k, lastRing + k1);
  }
  return { positions, indices, controlPoints: n };
}
