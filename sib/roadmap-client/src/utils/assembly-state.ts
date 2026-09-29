// assembly-state.ts - the part state the operator sees, as a pure model.
//
// A port of the app's AssemblyState (Services/AssemblyState.swift) so the
// Designer's preview shows exactly what the AR runtime shows: the imported
// initial state, then every step's deltas in order (array order = timeline
// order), last state wins. The END of any motion is the state; `insert`
// implies solid; a flash leaves nothing. Positions and rotations are the
// delta's `to` / `rotationTo` in the part's parent frame, exactly as the
// app applies them (translation column replaced, rotation replaced, scale
// kept - AssemblyNode.setPose).
//
// Playback (`timeline`) lays a step's deltas on a clock: each delta fires at
// `delaySec`; a motion runs `durationSec` from `from` to `to`; a show/hide
// is instant. Hose flipbooks are ordinary frame nodes shown and hidden by
// their own deltas, so they play with nothing special here.

import type { GuideStepNode } from '@spatial/shared';

export type Show = 'solid' | 'ghost' | 'hidden';
export interface PartPose {
  show: Show;
  opacity: number;
  color?: [number, number, number];
  /** nil = rest pose (the model's own transform). */
  position?: [number, number, number];
  rotation?: [number, number, number, number];
}
export type PartStateMap = Map<string, PartPose>;

function apply(deltas: GuideStepNode[], st: PartStateMap): void {
  for (const n of deltas) {
    const p: PartPose = st.get(n.node) ?? { show: 'solid', opacity: 1 };
    if (n.show) {
      p.show = n.show;
      p.opacity = n.show === 'ghost' ? (n.opacity ?? 0.35) : n.show === 'hidden' ? 0 : 1;
    } else if (n.animate === 'insert') { p.show = 'solid'; p.opacity = 1; }
    if (n.color && n.color.length === 3) p.color = [n.color[0], n.color[1], n.color[2]];
    if (n.to && n.to.length === 3) p.position = [n.to[0], n.to[1], n.to[2]];
    if (n.rotationTo && n.rotationTo.length === 4) p.rotation = [n.rotationTo[0], n.rotationTo[1], n.rotationTo[2], n.rotationTo[3]];
    st.set(n.node, p);
  }
}

/** State after step `through` (0-based; -1 = the initial state only). */
export function stateAfter(initial: GuideStepNode[] | undefined, steps: GuideStepNode[][], through: number): PartStateMap {
  const st: PartStateMap = new Map();
  apply(initial ?? [], st);
  for (let i = 0; i <= through && i < steps.length; i++) apply(steps[i], st);
  return st;
}

/** The deltas of a step as the app reads them (`metadata.step.nodes`). */
export function deltasOf(step: Record<string, unknown> | undefined): GuideStepNode[] {
  if (!step || !Array.isArray(step.nodes)) return [];
  return (step.nodes as unknown[]).filter((n): n is GuideStepNode => !!n && typeof n === 'object' && typeof (n as GuideStepNode).node === 'string');
}

// ── Playback ─────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  at: number;            // seconds from step start
  duration: number;      // seconds; 0 = instant
  delta: GuideStepNode;
}

/** A step's deltas on a clock. Motions with no timing get a short default so
 *  an authored step still animates; the source timing is used when present. */
export function timeline(deltas: GuideStepNode[], defaults = { motion: 0.8, gap: 0.25 }): { events: TimelineEvent[]; length: number } {
  const events: TimelineEvent[] = [];
  let cursor = 0;
  for (const d of deltas) {
    const motion = !!(d.from && d.to) || !!(d.rotationFrom && d.rotationTo) || !!d.animate;
    const at = d.delaySec ?? cursor;
    const duration = motion ? (d.durationSec ?? defaults.motion) : 0;
    events.push({ at, duration, delta: d });
    if (d.delaySec === undefined) cursor = at + duration + (motion ? defaults.gap : 0);
  }
  events.sort((a, b) => a.at - b.at);
  const length = events.reduce((m, e) => Math.max(m, e.at + e.duration), 0);
  return { events, length };
}

/** State at clock `t` seconds into a step that starts from `base`: every
 *  event that has begun has been applied; a motion in flight is interpolated.
 *  Pure, so the player can scrub as well as play. */
export function stateAt(base: PartStateMap, tl: { events: TimelineEvent[] }, t: number): PartStateMap {
  const st: PartStateMap = new Map();
  for (const [k, v] of base) st.set(k, { ...v });
  for (const e of tl.events) {
    if (e.at > t) break;
    const d = e.delta;
    const p: PartPose = st.get(d.node) ?? { show: 'solid', opacity: 1 };
    const u = e.duration > 0 ? Math.min(1, (t - e.at) / e.duration) : 1;
    if (d.show) { p.show = d.show; p.opacity = d.show === 'ghost' ? (d.opacity ?? 0.35) : d.show === 'hidden' ? 0 : 1; }
    else if (d.animate === 'insert') { p.show = 'solid'; p.opacity = 1; }
    if (d.color && d.color.length === 3) p.color = [d.color[0], d.color[1], d.color[2]];
    if (d.to && d.to.length === 3) {
      const from = d.from && d.from.length === 3 ? d.from : (p.position ?? d.to);
      p.position = [0, 1, 2].map(i => from[i] + (d.to![i] - from[i]) * ease(u)) as [number, number, number];
    }
    if (d.rotationTo && d.rotationTo.length === 4) {
      const from = d.rotationFrom && d.rotationFrom.length === 4 ? d.rotationFrom : (p.rotation ?? d.rotationTo);
      p.rotation = slerpAxisAngle(from, d.rotationTo, ease(u));
    }
    st.set(d.node, p);
  }
  return st;
}

const ease = (u: number): number => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

function slerpAxisAngle(a: number[], b: number[], t: number): [number, number, number, number] {
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
