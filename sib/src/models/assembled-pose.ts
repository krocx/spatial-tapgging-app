// assembled-pose.ts - switch an imported assembly between its two rest
// poses after import, without the source publication.
//
// The importer decides once (rest-pose.ts) whether the model's rest pose is
// the pose the publication saved or the state after the last step. When a
// user picks the wrong option, the switch is a pure transform of what SIB
// already holds:
//
//   → 'final'     every part still visible at the end takes the pose the
//                 steps leave it in (the same rule the AR runtime applies:
//                 translation column replaced, rotation replaced, scale
//                 kept - AssemblyNode.setPose); its former rest pose goes
//                 into the initial state so step 1 still starts where the
//                 publication started. Entries are tagged sourceKey
//                 'rest-pose' so the switch back knows which ones are its.
//   → 'published' every 'rest-pose' entry in the initial state is played
//                 back into the node and removed.
//
// Only the JSON chunk changes; the BIN chunk is copied. Variants are rebuilt
// by the caller (same node transforms, smaller geometry). A hose's rest tube
// is not rebuilt here - the importer does that when it rebases at import.
//
// Proprietary & Confidential · Applied Materials.

import type { GuideStepNode } from '@spatial/shared';
import { readGlbJson } from './glb-nodes.js';

export const REST_POSE_KEY = 'rest-pose';
export type AssembledPose = 'published' | 'final';

type Node = { name?: string; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[]; mesh?: number };

const EPS_T = 0.005, EPS_R = 0.01;
const near = (a: number[] | undefined, b: number[] | undefined, eps: number): boolean => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

// ── Node transform helpers (column-major 4x4 or TRS) ─────────────────────────

function restTranslation(n: Node): [number, number, number] {
  if (n.matrix && n.matrix.length === 16) return [n.matrix[12], n.matrix[13], n.matrix[14]];
  const t = n.translation ?? [0, 0, 0]; return [t[0], t[1], t[2]];
}
/** Rotation as axis-angle, from the matrix (scale removed) or the quaternion. */
function restRotation(n: Node): [number, number, number, number] {
  let q: [number, number, number, number];
  if (n.matrix && n.matrix.length === 16) {
    const m = n.matrix;
    const sx = Math.hypot(m[0], m[1], m[2]) || 1, sy = Math.hypot(m[4], m[5], m[6]) || 1, sz = Math.hypot(m[8], m[9], m[10]) || 1;
    const r00 = m[0] / sx, r01 = m[4] / sy, r02 = m[8] / sz, r10 = m[1] / sx, r11 = m[5] / sy, r12 = m[9] / sz, r20 = m[2] / sx, r21 = m[6] / sy, r22 = m[10] / sz;
    const tr = r00 + r11 + r22;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, 0.25 * s]; }
    else if (r00 > r11 && r00 > r22) { const s = Math.sqrt(1 + r00 - r11 - r22) * 2; q = [0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s]; }
    else if (r11 > r22) { const s = Math.sqrt(1 + r11 - r00 - r22) * 2; q = [(r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s]; }
    else { const s = Math.sqrt(1 + r22 - r00 - r11) * 2; q = [(r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s]; }
  } else { const r = n.rotation ?? [0, 0, 0, 1]; q = [r[0], r[1], r[2], r[3]]; }
  const [x, y, z, w] = q; const s = Math.sqrt(Math.max(0, 1 - w * w));
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
  return s < 1e-6 ? [0, 0, 1, 0] : [x / s, y / s, z / s, ang];
}
function setPose(n: Node, translation?: number[], rotation?: number[]): void {
  if (n.matrix && n.matrix.length === 16) {
    const m = n.matrix.slice();
    if (rotation) {
      const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
      const R = axisAngle(rotation);
      for (let i = 0; i < 3; i++) { m[i] = R[i] * sx; m[4 + i] = R[4 + i] * sy; m[8 + i] = R[8 + i] * sz; }
    }
    if (translation) { m[12] = translation[0]; m[13] = translation[1]; m[14] = translation[2]; }
    n.matrix = m.map(r6);
  } else {
    if (translation) n.translation = translation.map(r6);
    if (rotation) {
      let [x, y, z] = rotation; const a = rotation[3]; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      const s = Math.sin(a / 2); n.rotation = [x * s, y * s, z * s, Math.cos(a / 2)].map(r6);
    }
  }
}
function axisAngle(r: number[]): number[] {
  let [x, y, z] = r; const a = r[3] ?? 0; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t*x*x + c, t*x*y + s*z, t*x*z - s*y, 0, t*x*y - s*z, t*y*y + c, t*y*z + s*x, 0, t*x*z + s*y, t*y*z - s*x, t*z*z + c, 0, 0, 0, 0, 1];
}

// ── State after the last step (the runtime rule) ────────────────────────────

interface PartState { hidden: boolean; translation?: number[]; rotation?: number[] }
function endState(initial: GuideStepNode[], steps: GuideStepNode[][]): Map<string, PartState> {
  const st = new Map<string, PartState>();
  const apply = (n: GuideStepNode) => {
    const p = st.get(n.node) ?? { hidden: false };
    if (n.show === 'hidden') p.hidden = true; else if (n.show === 'solid' || n.show === 'ghost' || n.animate === 'insert') p.hidden = false;
    if (n.to && n.to.length === 3) p.translation = [...n.to];
    if (n.rotationTo && n.rotationTo.length === 4) p.rotation = [...n.rotationTo];
    st.set(n.node, p);
  };
  initial.forEach(apply);
  for (const s of steps) s.forEach(apply);
  return st;
}

export interface SwitchResult { glb: Buffer; initialNodes: GuideStepNode[]; changed: number; pose: AssembledPose }

/** Rewrite the GLB and the initial state for the target pose. Idempotent:
 *  switching to the pose the model already has changes nothing. */
export function switchAssembledPose(glb: Buffer, initialNodes: GuideStepNode[], steps: GuideStepNode[][], target: AssembledPose): SwitchResult {
  const json = readGlbJson(glb) as { nodes?: Node[] };
  const nodes = json.nodes ?? [];
  const byName = new Map<string, Node>();
  for (const n of nodes) if (n.name) byName.set(n.name, n);
  let changed = 0;
  let initial = initialNodes.map(n => ({ ...n }));

  if (target === 'final') {
    const end = endState(initial, steps);
    const hasInitialPose = new Set(initial.filter(n => n.to || n.rotationTo).map(n => n.node));
    for (const [name, s] of end) {
      if (s.hidden) continue;
      const node = byName.get(name); if (!node) continue;
      const rt = restTranslation(node), rr = restRotation(node);
      const t = s.translation && !near(s.translation, rt, EPS_T) ? s.translation : undefined;
      const r = s.rotation && !near(s.rotation, rr, EPS_R) ? s.rotation : undefined;
      if (!t && !r) continue;
      setPose(node, t, r);
      changed++;
      if (!hasInitialPose.has(name)) {
        const d: GuideStepNode = { node: name, sourceKey: REST_POSE_KEY };
        if (t) d.to = rt.map(r6) as GuideStepNode['to'];
        if (r) d.rotationTo = rr.map(r6) as GuideStepNode['rotationTo'];
        initial.push(d);
      }
    }
  } else {
    const mine = initial.filter(n => n.sourceKey === REST_POSE_KEY);
    for (const d of mine) {
      const node = byName.get(d.node); if (!node) continue;
      setPose(node, d.to, d.rotationTo);
      changed++;
    }
    initial = initial.filter(n => n.sourceKey !== REST_POSE_KEY);
  }
  return { glb: changed ? rewriteJson(glb, json) : glb, initialNodes: initial, changed, pose: target };
}

/** Same BIN chunk, new JSON chunk. */
function rewriteJson(glb: Buffer, json: unknown): Buffer {
  const jsonLen = glb.readUInt32LE(12);
  const rest = glb.subarray(20 + jsonLen);                      // BIN chunk (header + bytes), as is
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const out = Buffer.concat([header, jh, js, rest]);
  out.writeUInt32LE(out.length, 8);
  return out;
}
