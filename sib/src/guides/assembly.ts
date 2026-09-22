// assembly.ts — one placement for the whole assembly; every CAD-positioned step
// derives from it (AR OJT slice 1).
//
// The author (or the chamber configuration, or later PartFrame) supplies ONE
// AssemblyPose in the anchor frame. From it we derive, for each step that
// carries a `cadPosition` (assembly frame):
//   • the step pin  posX/Y/Z  = pose.position + R(pose.rotation) · (scale · cadPosition)
//   • the `assembly` model slot's offsets so the model's origin lands on the
//     pose (offset = pose.position − pin) with the pose's yaw and scale.
// The second point is what lets the CURRENT iOS app render the assembly in
// the right place before it learns about assembly poses itself: it already
// draws a step's model at pin + offset, rotated by modelRotationY.
//
// Clearing the pose un-places those steps again (isPlaced = false), which the
// operator guard already understands.

import fs from 'fs';
import path from 'path';
import type { AssemblyPose, Guide, GuideStep, GuideStepModel } from '@spatial/shared';
import { applySlotsToLegacy } from './step-models.js';
import { partBoundsFromGlb, unionBounds, centreOf, type Bounds } from '../models/glb-nodes.js';

// ── Auto-pin from parts (2026.4.46) ──────────────────────────────────────────
//
// A designer-authored step names the parts it installs but has no CAD pin.
// Its pin is the centre of those parts in the assembly frame — read from the
// GLB's accessor bounds — so once the assembly is placed on device every such
// step is placed too, and Place Steps is never needed for an assembly guide.

const boundsCache = new Map<string, { mtimeMs: number; bounds: Map<string, Bounds> }>();
// Same root the models router writes to (routes/models.ts MODELS_DIR).
const MODELS_DIR = path.join(process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data'), 'models-3d');

export function partBoundsForModel(modelId: string): Map<string, Bounds> | undefined {
  const file = path.join(MODELS_DIR, `${modelId}.glb`);
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    let hit = boundsCache.get(modelId);
    if (!hit || hit.mtimeMs !== mtimeMs) {
      hit = { mtimeMs, bounds: partBoundsFromGlb(fs.readFileSync(file)) };
      boundsCache.set(modelId, hit);
    }
    return hit.bounds;
  } catch {
    return undefined;
  }
}

/** Fill `cadPosition` on steps that list parts but have none; returns the steps changed. */
export function autoCadPositions(guide: Guide, steps: GuideStep[], boundsFor = partBoundsForModel): GuideStep[] {
  const modelId = guide.assembly?.modelId;
  if (!modelId) return [];
  const changed: GuideStep[] = [];
  let bounds: Map<string, Bounds> | undefined | null = null;   // lazy: only read the GLB when a step needs it
  for (const step of steps) {
    if (step.cadPosition || !step.nodes?.length) continue;
    if (bounds === null) bounds = boundsFor(modelId);
    if (!bounds) return changed;
    const b = unionBounds(step.nodes.map(n => bounds!.get(n.node)));
    if (!b) continue;
    const c = centreOf(b);
    step.cadPosition = [round(c[0]), round(c[1]), round(c[2])];
    changed.push(step);
  }
  return changed;
}

export const ASSEMBLY_SLOT = 'assembly';

/** Validate a client-supplied pose; returns an error string or null. */
export function validateAssemblyPose(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'assemblyPose must be an object';
  const o = p as Record<string, unknown>;
  const vec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x));
  if (!vec(o.position, 3)) return 'assemblyPose.position must be [x, y, z]';
  if (!vec(o.rotation, 4)) return 'assemblyPose.rotation must be a quaternion [x, y, z, w]';
  if (o.scale !== undefined && !(typeof o.scale === 'number' && o.scale > 0 && Number.isFinite(o.scale))) return 'assemblyPose.scale must be a positive number';
  if (!['tap', 'object', 'config', 'partframe'].includes(String(o.source))) return 'assemblyPose.source must be tap | object | config | partframe';
  return null;
}

export function normalizeAssemblyPose(p: AssemblyPose, setBy?: string): AssemblyPose {
  const q = p.rotation; const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return {
    position: [p.position[0], p.position[1], p.position[2]],
    rotation: [q[0] / len, q[1] / len, q[2] / len, q[3] / len],
    ...(p.scale !== undefined && p.scale !== 1 ? { scale: p.scale } : {}),
    source: p.source,
    setAt: new Date().toISOString(),
    ...(setBy ? { setBy } : {}),
  };
}

/** Rotate v by unit quaternion q = [x, y, z, w]. */
export function rotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = q; const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Yaw (rotation about +Y) of a quaternion, radians — the only rotation the
 *  legacy per-step model fields can express. */
export function yawOf(q: [number, number, number, number]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

/** World (anchor-frame) point of an assembly-frame point under the pose. */
export function transformPoint(pose: AssemblyPose, cad: [number, number, number]): [number, number, number] {
  const s = pose.scale ?? 1;
  const r = rotate(pose.rotation, [cad[0] * s, cad[1] * s, cad[2] * s]);
  return [round(pose.position[0] + r[0]), round(pose.position[1] + r[1]), round(pose.position[2] + r[2])];
}

/** Apply (or clear, when pose is undefined) the assembly pose to every step
 *  that has a cadPosition. Returns the steps that changed (already mutated). */
export function deriveStepsFromAssembly(guide: Guide, steps: GuideStep[], now: string): GuideStep[] {
  const pose = guide.assembly?.pose;
  const modelId = guide.assembly?.modelId;
  const changed: GuideStep[] = [];
  for (const step of steps) {
    if (!step.cadPosition) continue;
    if (pose) {
      const pin = transformPoint(pose, step.cadPosition);
      step.posX = pin[0]; step.posY = pin[1]; step.posZ = pin[2];
      step.isPlaced = true; step.positionSource = 'cad';
      if (modelId) {
        const slots: GuideStepModel[] = (step.models ?? []).filter(m => m.slotId !== ASSEMBLY_SLOT);
        const existing = (step.models ?? []).find(m => m.slotId === ASSEMBLY_SLOT);
        slots.unshift({
          slotId: ASSEMBLY_SLOT, modelId,
          modelScale: pose.scale ?? 1,
          modelOpacity: existing?.modelOpacity ?? 1,
          modelOffsetX: round(pose.position[0] - pin[0]),
          modelOffsetY: round(pose.position[1] - pin[1]),
          modelOffsetZ: round(pose.position[2] - pin[2]),
          modelRotationY: round(yawOf(pose.rotation)),
        });
        step.models = slots;
        applySlotsToLegacy(step);
      }
    } else if (step.positionSource === 'cad') {
      step.posX = undefined; step.posY = undefined; step.posZ = undefined;
      step.isPlaced = false; step.positionSource = undefined;
      if (step.models) {
        step.models = step.models.map(m => m.slotId === ASSEMBLY_SLOT
          ? { slotId: m.slotId, modelId: m.modelId, modelScale: m.modelScale, modelOpacity: m.modelOpacity }
          : m);
        applySlotsToLegacy(step);
      }
    } else {
      continue;
    }
    step.updatedAt = now;
    changed.push(step);
  }
  return changed;
}

const round = (x: number): number => Math.round(x * 1e5) / 1e5;
