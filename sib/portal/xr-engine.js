// xr-engine.js - B3 (2026.4.46): the engine-neutral half of the WebXR kit.
//
// Pure functions only (no DOM, no Three.js) so `sib/test/xr-engine.test.ts`
// can pin them against UNITY-RUNTIME.md §4 - the same contract the iOS
// player (AssemblyState.swift / AssemblyNode.swift) implements:
//
//   state(k)  = fold(initialNodes) ⊕ deltas(step 0) ⊕ … ⊕ deltas(step k)   last write wins
//   schedule  = deltas of ONE step turned into (startSec, durationSec, kind)
//               with the author's speed applied and the iOS floors kept
//               (motion ≥ 0.8 s, visibility ≥ 0.25 s)
//
// Proprietary & Confidential · Applied Materials.

export const DEFAULT_SPEED = 0.5;
export const GHOST_OPACITY = 0.35;
const MIN_MOTION_SEC = 0.8;
const MIN_VISIBILITY_SEC = 0.25;

/** True when the delta moves the part (translation or rotation). */
export function hasMotion(d) {
  return Array.isArray(d.to) || Array.isArray(d.rotationTo);
}

/** Apply one delta to a state map (in place). Flash-only deltas change nothing.
 *  Settled-state rule, the same as AssemblyState.swift and the Designer: a
 *  `show` sets the state; `insert` implies solid; a motion on its own never
 *  changes visibility (the player shows a hidden part WHILE it moves, and the
 *  settled state hides it again - Cortona moves exploded parts into place
 *  before it switches them on). */
export function applyDelta(state, d) {
  const cur = state.get(d.node) || { show: undefined, opacity: undefined, color: undefined, position: null, rotation: null, clip: undefined };
  let touched = false;
  if (d.show !== undefined) { cur.show = d.show; if (d.show === 'ghost') cur.opacity = d.opacity ?? GHOST_OPACITY; touched = true; }
  if (d.clip !== undefined)  { cur.clip = d.clip; touched = true; }   // built-in glTF clips under the node: play / rest
  else if (d.animate === 'insert') { cur.show = 'solid'; touched = true; }
  if (Array.isArray(d.to))         { cur.position = d.to.slice(0, 3); touched = true; }
  if (Array.isArray(d.rotationTo)) { cur.rotation = d.rotationTo.slice(0, 4); touched = true; }
  if (Array.isArray(d.color))      { cur.color = d.color.slice(0, 3); touched = true; }
  if (touched) state.set(d.node, cur);
  return state;
}

/** State BEFORE step `k` plays: initial ⊕ steps[0..k-1]. */
export function stateBefore(initialNodes, steps, k) {
  const state = new Map();
  for (const d of initialNodes || []) applyDelta(state, d);
  for (let i = 0; i < k && i < steps.length; i++) for (const d of steps[i].nodes || []) applyDelta(state, d);
  return state;
}

/** State AFTER step `k` (used for the "last step done" pose). */
export function stateAfter(initialNodes, steps, k) {
  return stateBefore(initialNodes, steps, k + 1);
}

/**
 * Turn one step's deltas into a playback schedule. Entries are sorted by
 * start time, then by hierarchy depth (parents first - `depthOf` is injected
 * by the renderer), then by array index. Times are already divided by speed.
 */
export function scheduleStep(nodes, speed = DEFAULT_SPEED, depthOf = () => 0) {
  const s = speed > 0 ? speed : DEFAULT_SPEED;
  const out = (nodes || []).map((d, index) => {
    const motion = hasMotion(d);
    const raw = (d.durationSec ?? 1) / s;
    const dur = motion ? Math.max(MIN_MOTION_SEC, raw) : Math.max(MIN_VISIBILITY_SEC, raw);
    return {
      index,
      delta: d,
      startSec: (d.delaySec ?? 0) / s,
      durationSec: dur,
      motion,
      flash: d.effect === 'flash',
      /** motion AND show=hidden: travel first, hide at the end. */
      hideAfterMotion: motion && d.show === 'hidden',
      depth: depthOf(d.node),
    };
  });
  out.sort((a, b) => a.startSec - b.startSec || a.depth - b.depth || a.index - b.index);
  return out;
}

/** Total playback length of a schedule (seconds). */
export function scheduleLength(schedule) {
  let end = 0;
  for (const e of schedule) end = Math.max(end, e.startSec + e.durationSec);
  return end;
}

/**
 * State at clock `t` (seconds) into a step that starts from `base`, as a
 * pure map - the same picture the XR player's tweens paint (2026.4.50, one
 * engine for the XR kit and the Designer's Studio):
 *   · an entry applies once `t` reaches its start; a motion in flight is
 *     interpolated (ease in-out) from `from` (or the current pose) to `to`;
 *   · a `show` settles at the start, except hideAfterMotion: the part
 *     travels visible and hides when the motion ends;
 *   · a motion on a part that is hidden reveals it for the travel;
 *   · flash-only entries change nothing.
 * Pure, so a viewer can scrub as well as play.
 */
export function stateDuring(base, schedule, t) {
  const st = new Map();
  for (const [k, v] of base) st.set(k, { ...v });
  for (const e of schedule) {
    if (e.startSec > t) continue;
    const d = e.delta;
    const p = st.get(d.node) || { show: undefined, opacity: undefined, color: undefined, position: null, rotation: null, clip: undefined };
    if (e.flash && d.show === undefined && !e.motion && !d.color && d.clip === undefined) continue;
    if (d.clip !== undefined) p.clip = d.clip;
    const u = e.durationSec > 0 ? Math.min(1, (t - e.startSec) / e.durationSec) : 1;
    const k = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    if (Array.isArray(d.color)) p.color = d.color.slice(0, 3);
    if (e.motion) {
      if (Array.isArray(d.to)) {
        const from = Array.isArray(d.from) ? d.from : (p.position || d.to);
        p.position = [0, 1, 2].map(i => from[i] + (d.to[i] - from[i]) * k);
      }
      if (Array.isArray(d.rotationTo)) {
        const from = Array.isArray(d.rotationFrom) ? d.rotationFrom : (p.rotation || d.rotationTo);
        p.rotation = slerpAxisAngle(from, d.rotationTo, k);
      }
      if (e.hideAfterMotion) { p.show = u < 1 ? 'solid' : 'hidden'; if (u >= 1) p.opacity = undefined; }
      else if (d.show !== undefined) { p.show = d.show; if (d.show === 'ghost') p.opacity = d.opacity ?? GHOST_OPACITY; }
      else if (d.animate === 'insert' || p.show === 'hidden' || p.show === undefined) p.show = 'solid';
    } else if (d.show !== undefined) { p.show = d.show; if (d.show === 'ghost') p.opacity = d.opacity ?? GHOST_OPACITY; }
    else if (d.animate === 'insert') p.show = 'solid';
    st.set(d.node, p);
  }
  return st;
}

function slerpAxisAngle(a, b, t) {
  const q = r => { const l = Math.hypot(r[0], r[1], r[2]) || 1; const s = Math.sin(r[3] / 2); return [r[0] / l * s, r[1] / l * s, r[2] / l * s, Math.cos(r[3] / 2)]; };
  const qa = q(a); let qb = q(b);
  let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (d < 0) { qb = qb.map(v => -v); d = -d; }
  let w0 = 1 - t, w1 = t;
  if (d < 0.9995) { const th = Math.acos(d), s = Math.sin(th); w0 = Math.sin((1 - t) * th) / s; w1 = Math.sin(t * th) / s; }
  const x = qa[0] * w0 + qb[0] * w1, y = qa[1] * w0 + qb[1] * w1, z = qa[2] * w0 + qb[2] * w1, w = qa[3] * w0 + qb[3] * w1;
  const l = Math.hypot(x, y, z); const ang = 2 * Math.atan2(l, w);
  return l < 1e-9 ? [0, 0, 1, 0] : [x / l, y / l, z / l, ang];
}

/** Nodes a step is "about" (deltas that change state, not flash-only). */
export function stepParts(step) {
  const seen = new Set();
  for (const d of step?.nodes || []) {
    if (d.effect === 'flash' && d.show === undefined && !hasMotion(d) && !d.color && d.clip === undefined) continue;
    seen.add(d.node);
  }
  return [...seen];
}

/** Bottom-centre rule: model origin so the bounds' bottom-centre sits on the hit point.
 *  `rotate` maps a local vector through the placement rotation. */
export function originForSurface(hit, bounds, scale = 1, rotate = v => v) {
  if (!bounds) return hit.slice(0, 3);
  const bc = [(bounds.min[0] + bounds.max[0]) / 2 * scale, bounds.min[1] * scale, (bounds.min[2] + bounds.max[2]) / 2 * scale];
  const r = rotate(bc);
  return [hit[0] - r[0], hit[1] - r[1], hit[2] - r[2]];
}

/** Bucket an observation sample the way the iOS sampler does. */
export function attentionFor({ hitsTarget, hitsAssembly, placed, panelOpen }) {
  if (!placed) return 'none';
  if (panelOpen) return 'panel';
  if (hitsTarget) return 'target';
  if (hitsAssembly) return 'assembly';
  return 'away';
}
