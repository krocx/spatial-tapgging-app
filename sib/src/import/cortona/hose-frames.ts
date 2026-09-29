// hose-frames.ts - the animated half of hose sweeps: a flipbook.
//
// When a sub-step moves a hose's control points (the seal flowing into its
// groove), the viewer rebuilds the tube every frame. Our contract is rigid
// parts with visibility deltas, so the tube is baked at FRAMES sampled
// across the motion window, each frame a child part of the hose
// (`<owner>#s<substep>f<k>`), and the sub-step's timeline shows them in
// turn: rest tube hidden, frame 0 on, frame 1 on / frame 0 off, … The last
// frame stays; the rest tube lives in `<owner>#rest` so it can be hidden
// without hiding the frames. Every client plays this with the deltas it
// already understands; the 0.25 s visibility floor in the players turns
// the flipbook into a crossfade.
//
// Proprietary & Confidential · Applied Materials.

import type { GuideStepNode } from '@spatial/shared';
import type { VrmlNode } from './vrml.js';
import { type SceneGraph, type SceneNode, type SceneMesh, type PoseOverrides, worldMatrices } from './scene.js';
import type { ExtractedSubStep, SubstepMotion } from './procedure.js';
import { buildHose } from './hose.js';

export const FRAMES_PER_MOTION = 8;

export interface HoseFrameStats { hoses: number; windows: number; frames: number; triangles: number; /** Owner show/hide deltas written for the tubes that stand in for it. */ carried?: number }

const round = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Value of a keyframed field at fraction u ∈ [0,1] of its window. */
export function sampleMotion(m: SubstepMotion, u: number): number[] {
  const stride = m.field === 'translation' ? 3 : 4;
  const n = Math.floor(m.keyValue.length / stride);
  if (n === 0) return [];
  if (n === 1) return m.keyValue.slice(0, stride);
  const keys = m.key.length === n ? m.key : Array.from({ length: n }, (_, i) => i / (n - 1));
  let i = 0; while (i < n - 2 && u > keys[i + 1]) i++;
  const span = keys[i + 1] - keys[i] || 1;
  const t = Math.max(0, Math.min(1, (u - keys[i]) / span));
  const a = m.keyValue.slice(i * stride, (i + 1) * stride), b = m.keyValue.slice((i + 1) * stride, (i + 2) * stride);
  if (m.field === 'translation') return [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t);
  return slerpAxisAngle(a, b, t);
}

/** Interpolate two VRML axis-angle rotations (via quaternions). */
function slerpAxisAngle(a: number[], b: number[], t: number): number[] {
  const q = (r: number[]): [number, number, number, number] => {
    const l = Math.hypot(r[0], r[1], r[2]) || 1; const s = Math.sin(r[3] / 2);
    return [r[0] / l * s, r[1] / l * s, r[2] / l * s, Math.cos(r[3] / 2)];
  };
  const qa = q(a); let qb = q(b);
  let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (d < 0) { qb = qb.map(v => -v) as typeof qb; d = -d; }
  let w0 = 1 - t, w1 = t;
  if (d < 0.9995) { const th = Math.acos(Math.min(1, d)); const s = Math.sin(th); w0 = Math.sin((1 - t) * th) / s; w1 = Math.sin(t * th) / s; }
  const r = [0, 1, 2, 3].map(k => qa[k] * w0 + qb[k] * w1);
  const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1; const x = r[0] / l, y = r[1] / l, z = r[2] / l, w = r[3] / l;
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, w))); const s = Math.sqrt(Math.max(0, 1 - w * w));
  return s < 1e-6 ? [0, 0, 1, 0] : [x / s, y / s, z / s, ang];
}

/**
 * Bake frames for every hose whose control points move in a sub-step. Adds
 * frame nodes to the scene (children of the hose owner), moves the owner's
 * rest tube into a `#rest` child, appends visibility deltas to the sub-step,
 * and returns the names of all frame nodes (they are created `visible:false`,
 * so the importer's initial state hides them).
 */
export function bakeHoseFrames(scene: SceneGraph, substeps: ExtractedSubStep[], framesPerMotion = FRAMES_PER_MOTION): { frameNodes: string[]; stats: HoseFrameStats } {
  const stats: HoseFrameStats = { hoses: 0, windows: 0, frames: 0, triangles: 0, carried: 0 };
  const frameNodes: string[] = [];
  if (!scene.hoseOwners.length) return { frameNodes, stats };

  const controlToHoses = new Map<string, number[]>();
  scene.hoseOwners.forEach((h, i) => { for (const c of h.controls) { const l = controlToHoses.get(c) ?? []; l.push(i); controlToHoses.set(c, l); } });
  const lastShown = new Map<number, string>();          // hose index → frame node currently standing in for the tube
  const restMoved = new Set<number>();

  const resolveByDef = (n: VrmlNode | { use: string }): SceneNode | undefined => {
    const def = 'use' in n ? n.use : n.def; return def ? scene.byDef.get(def) : undefined;
  };

  substeps.forEach((ss, si) => {
    if (ss.setup || !ss.motions.length) return;
    const byHose = new Map<number, SubstepMotion[]>();
    for (const m of ss.motions) for (const hi of controlToHoses.get(m.def) ?? []) { const l = byHose.get(hi) ?? []; l.push(m); byHose.set(hi, l); }
    for (const [hi, motions] of byHose) {
      const hose = scene.hoseOwners[hi];
      const ownerDef = hose.owner.def; if (!ownerDef) continue;
      const t0w = Math.min(...motions.map(m => m.t0)), t1w = Math.max(...motions.map(m => m.t1));
      if (!(t1w > t0w)) continue;
      const k = Math.max(2, framesPerMotion);
      // The rest tube becomes a child so it can be hidden on its own.
      if (!restMoved.has(hi) && hose.owner.meshes.length) {
        const rest: SceneNode = { id: `${ownerDef}#rest`, def: `${ownerDef}#rest`, type: 'Transform', name: hose.owner.name,
          // visible: it inherits the owner's state; an explicit initial "hidden"
          // here would stick when the owner is later shown (child override).
          matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], visible: true, meshes: hose.owner.meshes, children: [], vrml: { type: 'Transform', fields: {} } };
        hose.owner.meshes = [];
        hose.owner.children.unshift(rest); scene.byDef.set(rest.def!, rest);
        restMoved.add(hi);
        stats.hoses++;
      }
      const t = (f: number) => t0w + (t1w - t0w) * f / (k - 1);
      const prevBefore = lastShown.get(hi) ?? `${ownerDef}#rest`;
      let prev = prevBefore;
      let built = 0;
      for (let f = 0; f < k; f++) {
        const tf = t(f);
        const overrides: PoseOverrides = new Map();
        for (const m of motions) {
          const u = Math.max(0, Math.min(1, (tf - m.t0) / ((m.t1 - m.t0) || 1)));
          const v = sampleMotion(m, u); if (!v.length) continue;
          const o = overrides.get(m.def) ?? {}; if (m.field === 'translation') o.translation = v; else o.rotation = v; overrides.set(m.def, o);
        }
        const worlds = worldMatrices(scene.roots, overrides);
        const ownerWorld = worlds.get(hose.owner); if (!ownerWorld) break;
        const tube = buildHose(hose.geom, ownerWorld, ref => { const sn = resolveByDef(ref as VrmlNode); return sn ? worlds.get(sn) ?? null : null; });
        if (!tube) break;
        const color = hose.owner.children[0]?.meshes[0]?.color ?? [0.8, 0.8, 0.8];
        const transparency = hose.owner.children[0]?.meshes[0]?.transparency ?? 0;
        const mesh: SceneMesh = { positions: Float32Array.from(tube.positions), indices: Uint32Array.from(tube.indices), color, transparency };
        const def = `${ownerDef}#s${si}f${f}`;
        const node: SceneNode = { id: def, def, type: 'Transform', name: hose.owner.name, matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
          visible: false, meshes: [mesh], children: [], vrml: { type: 'Transform', fields: {} } };
        hose.owner.children.push(node); scene.byDef.set(def, node);
        scene.meshCount++; scene.triangleCount += mesh.indices.length / 3; stats.triangles += mesh.indices.length / 3;
        frameNodes.push(`cmp:${def}`);
        // Timeline: this frame on, the previous one off, at the same instant.
        ss.nodes.push({ node: `cmp:${def}`, show: 'solid', delaySec: round(tf), durationSec: 0.05 });
        ss.nodes.push({ node: `cmp:${prev}`, show: 'hidden', delaySec: round(tf), durationSec: 0.05 });
        prev = def; built++;
      }
      if (built) { lastShown.set(hi, prev); stats.windows++; stats.frames += built; }
    }
  });

  // A part's visibility is its own: the players do not hide a child because
  // its parent is hidden (a step may show a part under a group the
  // publication never switches on). So when a step hides or shows a hose
  // owner, the same delta is written for the tube that stands in for it at
  // that moment - the current frame, else the rest tube - and a hide also
  // covers every frame, so nothing of the hose is left behind.
  const standIn = new Map<number, string>();               // hose index → node currently shown for it
  for (let hi = 0; hi < scene.hoseOwners.length; hi++) if (restMoved.has(hi)) standIn.set(hi, `${scene.hoseOwners[hi].owner.def}#rest`);
  const framesOf = new Map<number, string[]>();
  for (let hi = 0; hi < scene.hoseOwners.length; hi++) {
    const def = scene.hoseOwners[hi].owner.def; if (!def) continue;
    framesOf.set(hi, scene.hoseOwners[hi].owner.children.filter(c => c.def && /#s\d+f\d+$/.test(c.def)).map(c => c.def!));
  }
  const ownerIndex = new Map<string, number>();
  scene.hoseOwners.forEach((h, i) => { if (h.owner.def && restMoved.has(i)) ownerIndex.set(`cmp:${h.owner.def}`, i); });
  let carried = 0;
  for (const ss of substeps) {
    const extra: GuideStepNode[] = [];
    // Events in time order so the stand-in is right when the owner's delta fires.
    const timed = ss.nodes.map((n, i) => ({ n, i })).sort((a, b) => (a.n.delaySec ?? 0) - (b.n.delaySec ?? 0) || a.i - b.i);
    for (const { n } of timed) {
      const frame = n.node.match(/^cmp:(.*)#s\d+f\d+$/);
      if (frame && n.show === 'solid') { const hi = ownerIndex.get(`cmp:${frame[1]}`); if (hi !== undefined) standIn.set(hi, n.node.slice(4)); continue; }
      const hi = ownerIndex.get(n.node); if (hi === undefined || !n.show) continue;
      const at = { ...(n.delaySec !== undefined ? { delaySec: n.delaySec } : {}), ...(n.durationSec !== undefined ? { durationSec: n.durationSec } : {}) };
      if (n.show === 'hidden') {
        for (const f of framesOf.get(hi) ?? []) extra.push({ node: `cmp:${f}`, show: 'hidden', ...at });
        extra.push({ node: `cmp:${scene.hoseOwners[hi].owner.def}#rest`, show: 'hidden', ...at });
      } else {
        const cur = standIn.get(hi); if (cur) extra.push({ node: `cmp:${cur}`, show: n.show, ...(n.opacity !== undefined ? { opacity: n.opacity } : {}), ...at });
      }
      carried += extra.length;
    }
    ss.nodes.push(...extra);
  }
  stats.carried = carried;
  return { frameNodes, stats };
}
