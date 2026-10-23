// assembly-state.ts - the part state the operator sees, for the Designer.
//
// 2026.4.50 (backlog #7): no engine of its own any more. The settled state,
// the playback schedule and the in-flight state all come from the WebXR
// kit's `portal/xr-engine.js` - the one implementation pinned against
// UNITY-RUNTIME.md §4 by sib/test/xr-engine.test.ts and the contract the
// iOS player implements. This file only adapts its shapes to what the
// Studio's preview reads (PartPose with opacity always set) and keeps the
// names the components already use, so the Studio and the XR player show
// the same picture by construction.

import type { GuideStepNode } from '@spatial/shared';
import {
  DEFAULT_SPEED, GHOST_OPACITY, stateBefore, scheduleStep, scheduleLength, stateDuring,
  type EngineState, type ScheduleEntry,
} from '../../../portal/xr-engine.js';

export type Show = 'solid' | 'ghost' | 'hidden';
export interface PartPose {
  show: Show;
  opacity: number;
  color?: [number, number, number];
  /** nil = rest pose (the model's own transform). */
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  /** Built-in glTF clips under the part: play (looping unless loop is false) or rest. */
  clip?: { play: boolean; loop?: boolean };
}
export type PartStateMap = Map<string, PartPose>;

/** Engine state (show may be undefined = the model's own look) → the Studio's PartPose. */
function toPoses(st: EngineState): PartStateMap {
  const out: PartStateMap = new Map();
  for (const [name, p] of st) {
    const show: Show = p.show ?? 'solid';
    const pose: PartPose = { show, opacity: show === 'ghost' ? (p.opacity ?? GHOST_OPACITY) : show === 'hidden' ? 0 : 1 };
    if (p.color && p.color.length === 3) pose.color = [p.color[0], p.color[1], p.color[2]];
    if (p.position && p.position.length === 3) pose.position = [p.position[0], p.position[1], p.position[2]];
    if (p.rotation && p.rotation.length === 4) pose.rotation = [p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]];
    if (p.clip) pose.clip = { play: !!p.clip.play, ...(p.clip.loop === false ? { loop: false } : {}) };
    out.set(name, pose);
  }
  return out;
}
function toEngine(poses: PartStateMap): EngineState {
  const out: EngineState = new Map();
  for (const [name, p] of poses) out.set(name, { show: p.show, opacity: p.opacity, color: p.color, position: p.position ?? null, rotation: p.rotation ?? null, clip: p.clip });
  return out;
}

/** State after step `through` (0-based; -1 = the initial state only). */
export function stateAfter(initial: GuideStepNode[] | undefined, steps: GuideStepNode[][], through: number): PartStateMap {
  return toPoses(stateBefore(initial, steps.map(nodes => ({ nodes })), through + 1));
}

/** The deltas of a step as the app reads them (`metadata.step.nodes`). */
export function deltasOf(step: Record<string, unknown> | undefined): GuideStepNode[] {
  if (!step || !Array.isArray(step.nodes)) return [];
  return (step.nodes as unknown[]).filter((n): n is GuideStepNode => !!n && typeof n === 'object' && typeof (n as GuideStepNode).node === 'string');
}

// ── Playback ─────────────────────────────────────────────────────────────────

export interface Timeline { schedule: ScheduleEntry[]; length: number }

/** A step's deltas on the XR player's clock: the guide's authored speed
 *  (DEFAULT_SPEED when none), the iOS floors, parents first. */
export function timeline(deltas: GuideStepNode[], speed: number = DEFAULT_SPEED): Timeline {
  const schedule = scheduleStep(deltas, speed);
  return { schedule, length: scheduleLength(schedule) };
}

/** State at clock `t` seconds into a step that starts from `base`. */
export function stateAt(base: PartStateMap, tl: Timeline, t: number): PartStateMap {
  return toPoses(stateDuring(toEngine(base), tl.schedule, t));
}
