// xr-engine.js — B3 (2026.4.46): the engine-neutral half of the WebXR kit.
//
// Pure functions only (no DOM, no Three.js) so `sib/test/xr-engine.test.ts`
// can pin them against UNITY-RUNTIME.md §4 — the same contract the iOS
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

/** Apply one delta to a state map (in place). Flash-only deltas change nothing. */
export function applyDelta(state, d) {
  const cur = state.get(d.node) || { show: undefined, opacity: undefined, color: undefined, position: null, rotation: null };
  let touched = false;
  if (d.show !== undefined) { cur.show = d.show; if (d.show === 'ghost') cur.opacity = d.opacity ?? GHOST_OPACITY; touched = true; }
  else if (d.animate === 'insert' || (hasMotion(d) && cur.show === 'hidden')) { cur.show = 'solid'; touched = true; }
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
 * start time, then by hierarchy depth (parents first — `depthOf` is injected
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

/** Nodes a step is "about" (deltas that change state, not flash-only). */
export function stepParts(step) {
  const seen = new Set();
  for (const d of step?.nodes || []) {
    if (d.effect === 'flash' && d.show === undefined && !hasMotion(d) && !d.color) continue;
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
