// rest-pose.ts - which pose is the model's rest pose: as published, or the
// state after the last step?
//
// A Cortona publication keeps its parts wherever the author left them in
// the .wrl. In most publications that is the assembled product and a set-up
// step (simulate FALSE) explodes the parts before step 1. In others there is
// no set-up step: the .wrl itself holds the exploded start and the steps
// animate every part into place. The GLB is the rest pose, and everything
// that shows "the assembly" (Place Assembly, the Models and Designer
// previews, the whole-assembly context) shows the rest pose, so a
// publication of the second kind looks exploded everywhere except in the
// last step of playback.
//
// This module measures the three states (published, before step 1, after
// the last step) by their bounding extent and, when the published rest is
// clearly more spread out than the end state, rebases the scene: the parts
// still visible at the end take their end pose as rest, and the initial
// state records the published pose so playback is unchanged (the deltas
// are absolute keyframes). Parts hidden at the end keep the published pose:
// nobody sees it, and the context overlay draws hidden parts at rest.
//
// Proprietary & Confidential · Applied Materials.

import type { GuideStepNode } from '@spatial/shared';
import { type SceneGraph, type SceneNode, worldMatrices } from './scene.js';
import type { ExtractedSubStep } from './procedure.js';
import { numField } from './vrml.js';

export type RestPoseChoice = 'auto' | 'published' | 'final';

export interface Pose { translation?: number[]; rotation?: number[] }

export interface RestPoseReport {
  /** Bounding-box diagonal (m): published and final over the parts visible at the end, initial over the parts visible before step 1. */
  extentM: { published: number; initial: number; final: number };
  /** Parts whose end pose differs from the published one (and are visible at the end). */
  movedParts: number;
  chosen: 'published' | 'final';
  /** Parts whose published transform was replaced by their end pose. */
  rebased: number;
  reason: string;
}

const EPS_T = 0.005;      // 5 mm - exporters round keyframes
const EPS_R = 0.01;       // rad

const near = (a: number[] | undefined, b: number[] | undefined, eps: number): boolean => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
};

interface PartState { pose: Pose; hidden: boolean }

/** Play the sub-steps' deltas in order and return every DEF's pose and
 *  visibility at the end. `hiddenAtStart` seeds the Switch-hidden parts. */
function playState(substeps: ExtractedSubStep[], hiddenAtStart: Set<string>, seed?: Map<string, PartState>): Map<string, PartState> {
  const st = new Map<string, PartState>();
  if (seed) for (const [k, v] of seed) st.set(k, { pose: { ...v.pose }, hidden: v.hidden });
  else for (const d of hiddenAtStart) st.set(d, { pose: {}, hidden: true });
  for (const ss of substeps) for (const n of ss.nodes) {
    const def = n.node.replace(/^cmp:/, '');
    const cur = st.get(def) ?? { pose: {}, hidden: false };
    if (n.to && n.to.length === 3) cur.pose.translation = [...n.to];
    if (n.rotationTo && n.rotationTo.length === 4) cur.pose.rotation = [...n.rotationTo];
    if (n.show === 'hidden') cur.hidden = true;
    else if (n.show === 'solid' || n.show === 'ghost' || n.animate === 'insert') cur.hidden = false;
    st.set(def, cur);
  }
  return st;
}

/** Bounding-box diagonal of the scene with the given poses, counting only
 *  parts not hidden in that state. Uses each DEF's published subtree box
 *  moved by its world-matrix change - exact for rigid parts. */
function extent(scene: SceneGraph, state: Map<string, PartState>): number {
  const overrides = new Map<string, Pose>();
  for (const [def, s] of state) if (s.pose.translation || s.pose.rotation) overrides.set(def, s.pose);
  const before = worldMatrices(scene.roots);
  const after = overrides.size ? worldMatrices(scene.roots, overrides) : before;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (p: number[]) => { for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; } };
  const apply = (m: number[], p: number[]): number[] => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  for (const [def, box] of scene.boundsByDef) {
    if (state.get(def)?.hidden) continue;
    const sn = scene.byDef.get(def); if (!sn) continue;
    // Leaf-most DEFs only: a moved parent's box is the union of its children,
    // which are visited on their own (and may be hidden individually).
    if (sn.children.some(c => c.def && scene.boundsByDef.has(c.def)) && sn.meshes.length === 0) continue;
    const wb = before.get(sn), wa = after.get(sn);
    if (!wb || !wa || wb === wa) { grow(box.min); grow(box.max); continue; }
    // World-space corners → published local → new world: corner' = Wa · Wb⁻¹ · corner
    const inv = invertAffine(wb); if (!inv) { grow(box.min); grow(box.max); continue; }
    for (let i = 0; i < 8; i++) {
      const c = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
      grow(apply(wa, apply(inv, c)));
    }
  }
  return Number.isFinite(min[0]) ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
}

function invertAffine(m: number[]): number[] | null {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  const r = 1 / det;
  const out = [
    A * r, B * r, C * r, 0,
    (c * h - b * i) * r, (a * i - c * g) * r, (b * g - a * h) * r, 0,
    (b * f - c * e) * r, (c * d - a * f) * r, (a * e - b * d) * r, 0,
    0, 0, 0, 1,
  ];
  const tx = m[12], ty = m[13], tz = m[14];
  out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
  out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
  out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
  return out;
}

export interface RestPoseDecision {
  report: RestPoseReport;
  /** DEF → end pose to bake into the .wrl fields before the scene is rebuilt. */
  rebase: Map<string, Pose>;
  /** Initial-state deltas that put the rebased parts back at their published pose for step 1. */
  initialDeltas: GuideStepNode[];
}

/** Decide the rest pose. Mutates nothing; the caller applies `rebase` to the
 *  VRML fields and rebuilds the scene so bounds, hoses and matrices agree. */
export function decideRestPose(scene: SceneGraph, substeps: ExtractedSubStep[], choice: RestPoseChoice = 'auto'): RestPoseDecision {
  const hiddenAtStart = new Set<string>();
  for (const [def, sn] of scene.byDef) if (!sn.visible && sn.meshes.length + sn.children.length > 0) hiddenAtStart.add(def);
  const initial = playState(substeps.filter(ss => ss.setup), hiddenAtStart);
  const final = playState(substeps.filter(ss => !ss.setup), hiddenAtStart, initial);

  const publishedPose = (sn: SceneNode): Pose => ({ translation: numField(sn.vrml, 'translation', [0, 0, 0]), rotation: numField(sn.vrml, 'rotation', [0, 0, 1, 0]) });
  const rebase = new Map<string, Pose>();
  for (const [def, s] of final) {
    if (s.hidden) continue;
    const sn = scene.byDef.get(def); if (!sn) continue;
    const p = publishedPose(sn);
    const t = s.pose.translation && !near(s.pose.translation, p.translation, EPS_T) ? s.pose.translation : undefined;
    const r = s.pose.rotation && !near(s.pose.rotation, p.rotation, EPS_R) ? s.pose.rotation : undefined;
    if (t || r) rebase.set(def, { ...(t ? { translation: t } : {}), ...(r ? { rotation: r } : {}) });
  }

  // Compare like with like: the published poses of the parts still visible
  // at the end against their end poses. (Counting every published part would
  // make an assembled model look wider than its end state whenever the
  // procedure hides parts.)
  const publishedAtEnd = new Map<string, PartState>();
  for (const [def, s] of final) publishedAtEnd.set(def, { pose: {}, hidden: s.hidden });
  const extentM = { published: extent(scene, publishedAtEnd), initial: extent(scene, initial), final: extent(scene, final) };
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const report: RestPoseReport = {
    extentM: { published: round(extentM.published), initial: round(extentM.initial), final: round(extentM.final) },
    movedParts: rebase.size, chosen: 'published', rebased: 0, reason: '',
  };
  let useFinal = false;
  if (!rebase.size) report.reason = 'the parts end where the publication put them';
  else if (choice === 'published') report.reason = 'kept as published (option)';
  else if (choice === 'final') { useFinal = true; report.reason = 'end state (option)'; }
  else if (extentM.final < extentM.published * 0.9) { useFinal = true; report.reason = `the published pose is spread ${round(extentM.published / extentM.final)}x wider than the end state - the .wrl holds the exploded start`; }
  else report.reason = 'the published pose is at least as compact as the end state';

  const initialDeltas: GuideStepNode[] = [];
  if (useFinal) {
    for (const [def, pose] of rebase) {
      const sn = scene.byDef.get(def)!;
      const p = publishedPose(sn);
      const d: GuideStepNode = { node: `cmp:${def}`, sourceKey: 'rest-pose' };   // assembled-pose.ts switches these back
      if (pose.translation) d.to = p.translation!.map(v => Math.round(v * 1e6) / 1e6) as GuideStepNode['to'];
      if (pose.rotation) d.rotationTo = p.rotation!.map(v => Math.round(v * 1e6) / 1e6) as GuideStepNode['rotationTo'];
      initialDeltas.push(d);
    }
    report.chosen = 'final'; report.rebased = rebase.size;
  }
  return { report, rebase: useFinal ? rebase : new Map(), initialDeltas };
}

/** Write the end poses into the VRML fields (the parsed tree the scene was
 *  built from), so a rebuild of the scene bakes them into every matrix,
 *  bound and hose. */
export function applyRestPose(scene: SceneGraph, rebase: Map<string, Pose>): void {
  for (const [def, pose] of rebase) {
    const sn = scene.byDef.get(def); if (!sn) continue;
    if (pose.translation) sn.vrml.fields.translation = [...pose.translation];
    if (pose.rotation) sn.vrml.fields.rotation = [...pose.rotation];
  }
}
