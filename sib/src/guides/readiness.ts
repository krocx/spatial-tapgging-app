// readiness.ts - which steps of a guide a wearable can deliver, and how.
//
// docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md. Three pure parts:
//
//   stepNeeds(step)            what channels carry the step's meaning, derived
//                              from the step itself (text, a place on the tool,
//                              motion, parts to find, media, hands busy); an
//                              author can override with `step.needs`.
//   DeviceProfile              what a device can deliver (docs/devices/*.md).
//   readiness(steps, profile)  the join: per step, native / adapted / assisted
//                              with the reason, and a summary.
//
// Nothing here renders; the XR kit and the portal read the result.
// Proprietary & Confidential · Applied Materials.

import type { GuideStep, GuideStepNode } from '@spatial/shared';

export type StepNeed = 'text' | 'spatial' | 'motion' | 'part-id' | 'media' | 'hands-busy';
export const STEP_NEEDS: StepNeed[] = ['text', 'spatial', 'motion', 'part-id', 'media', 'hands-busy'];

export type Level = 'native' | 'adapted' | 'assisted';
const RANK: Record<Level, number> = { native: 0, adapted: 1, assisted: 2 };

export interface DeviceProfile {
  id: string;
  name: string;
  /** What the device can show. */
  display: 'full' | 'small' | 'text' | 'none';
  /** 3D overlay on the tool: full model, a reduced model (small field of view, no hoses), or none. */
  overlay: '3d' | 'reduced' | 'none';
  /** How the technician drives it. */
  input: ('touch' | 'voice' | 'ring' | 'trackpad' | 'gaze' | 'hands' | 'controller' | 'mouse')[];
  /** How a guide reaches it. */
  delivery: 'app' | 'xrkit' | 'companion-text' | 'spoken';
  notes?: string;
}

// ── Step needs ──────────────────────────────────────────────────────────────

const HANDS_BUSY = /\b(torque|hold(?:ing)?|while (?:hold|press|insert)|press and hold|both hands|tighten|keep pressing|thread|screw in|insert while)\b/i;

/** The channels a step's meaning travels on, derived from the step. `step.needs` (an author's override) wins when present. */
export function stepNeeds(step: Pick<GuideStep, 'text' | 'title' | 'mediaPath' | 'cadPosition'> & { nodes?: GuideStepNode[]; view?: unknown; needs?: string[] }): StepNeed[] {
  if (Array.isArray(step.needs) && step.needs.length) return step.needs.filter((n): n is StepNeed => (STEP_NEEDS as string[]).includes(n));
  const out = new Set<StepNeed>();
  const text = `${step.title ?? ''} ${step.text ?? ''}`.trim();
  if (text) out.add('text');
  if (step.cadPosition || step.view) out.add('spatial');
  const nodes = step.nodes ?? [];
  if (nodes.some(n => n.animate || (n.from && n.to) || (n.rotationFrom && n.rotationTo) || /#s\d+f\d+$/.test(n.node))) out.add('motion');
  if (nodes.some(n => n.show === 'solid' || n.animate === 'insert' || n.color)) out.add('part-id');
  if (step.mediaPath) out.add('media');
  if (HANDS_BUSY.test(text)) out.add('hands-busy');
  return STEP_NEEDS.filter(n => out.has(n));
}

// ── The join ────────────────────────────────────────────────────────────────

export interface NeedVerdict { need: StepNeed; level: Level; how: string }
export interface StepReadiness { level: Level; needs: NeedVerdict[] }

/** One need on one profile: can the device deliver it as authored, in a reduced form, or not at all? */
export function judge(need: StepNeed, p: DeviceProfile, ctx: { hasHoseFrames: boolean }): NeedVerdict {
  const voice = p.input.includes('voice');
  switch (need) {
    case 'text':
      if (p.display === 'none') return { need, level: 'adapted', how: 'read aloud' };
      if (p.display === 'text') return { need, level: 'native', how: 'paged text' };
      return { need, level: 'native', how: 'shown' };
    case 'spatial':
      if (p.overlay === '3d') return { need, level: 'native', how: 'pin on the tool' };
      if (p.overlay === 'reduced') return { need, level: 'native', how: 'pin on the reduced model' };
      if (p.display === 'text') return { need, level: 'adapted', how: 'location in words from the CAD pin' };
      return { need, level: 'adapted', how: 'location spoken from the CAD pin' };
    case 'motion':
      if (p.overlay === '3d') return { need, level: 'native', how: 'animated on the tool' };
      if (p.overlay === 'reduced') return ctx.hasHoseFrames ? { need, level: 'adapted', how: 'reduced model; hose animation dropped' } : { need, level: 'native', how: 'animated on the reduced model' };
      return { need, level: 'adapted', how: p.display === 'none' ? 'motion described aloud' : 'motion described in words' };
    case 'part-id':
      if (p.overlay !== 'none') return { need, level: 'native', how: 'highlighted on the model' };
      return { need, level: 'adapted', how: p.display === 'none' ? 'part names spoken' : 'part names listed' };
    case 'media':
      if (p.display === 'full') return { need, level: 'native', how: 'image shown' };
      if (p.display === 'small') return { need, level: 'adapted', how: 'image shown small' };
      return { need, level: 'assisted', how: 'no image on this device - phone or colleague' };
    case 'hands-busy':
      if (voice) return { need, level: 'native', how: 'voice-driven' };
      if (p.input.includes('ring') || p.input.includes('trackpad') || p.input.includes('gaze')) return { need, level: 'adapted', how: 'advance with the ring / trackpad between actions' };
      return { need, level: 'assisted', how: 'needs a hand on the device' };
  }
}

export function readinessOf(step: Parameters<typeof stepNeeds>[0], p: DeviceProfile): StepReadiness {
  const needs = stepNeeds(step);
  const hasHoseFrames = (step.nodes ?? []).some(n => /#s\d+f\d+$/.test(n.node));
  const verdicts = needs.map(n => judge(n, p, { hasHoseFrames }));
  const level = verdicts.reduce<Level>((worst, v) => (RANK[v.level] > RANK[worst] ? v.level : worst), 'native');
  return { level, needs: verdicts };
}

export interface ReadinessReport {
  profiles: DeviceProfile[];
  steps: { id: string; sequenceNumber: number; title: string; needs: StepNeed[]; byProfile: Record<string, StepReadiness> }[];
  summary: Record<string, { native: number; adapted: number; assisted: number; total: number; deliverable: number }>;
}

export function readinessReport(steps: (Parameters<typeof stepNeeds>[0] & { id: string; sequenceNumber: number })[], profiles: DeviceProfile[]): ReadinessReport {
  const rows = steps.map(s => ({
    id: s.id, sequenceNumber: s.sequenceNumber, title: s.title || `Step ${s.sequenceNumber}`, needs: stepNeeds(s),
    byProfile: Object.fromEntries(profiles.map(p => [p.id, readinessOf(s, p)])),
  }));
  const summary: ReadinessReport['summary'] = {};
  for (const p of profiles) {
    const c = { native: 0, adapted: 0, assisted: 0, total: rows.length, deliverable: 0 };
    for (const r of rows) c[r.byProfile[p.id].level]++;
    c.deliverable = rows.length ? Math.round(((c.native + c.adapted) / rows.length) * 100) : 0;
    summary[p.id] = c;
  }
  return { profiles, steps: rows, summary };
}

// ── Profiles from docs/devices/*.md ─────────────────────────────────────────

const DISPLAYS = ['full', 'small', 'text', 'none'], OVERLAYS = ['3d', 'reduced', 'none'], DELIVERIES = ['app', 'xrkit', 'companion-text', 'spoken'];

/** Build a profile from a parsed frontmatter; null when a required field is off. */
export function profileFrom(fm: Record<string, string | string[]>): DeviceProfile | null {
  const s = (k: string) => (typeof fm[k] === 'string' ? (fm[k] as string) : undefined);
  const id = s('id'), name = s('name'), display = s('display'), overlay = s('overlay'), delivery = s('delivery');
  const input = Array.isArray(fm.input) ? (fm.input as string[]) : typeof fm.input === 'string' ? [fm.input] : [];
  if (!id || !name || !display || !overlay || !delivery) return null;
  if (!DISPLAYS.includes(display) || !OVERLAYS.includes(overlay) || !DELIVERIES.includes(delivery)) return null;
  return { id, name, display: display as DeviceProfile['display'], overlay: overlay as DeviceProfile['overlay'],
    input: input as DeviceProfile['input'], delivery: delivery as DeviceProfile['delivery'], ...(s('notes') ? { notes: s('notes') } : {}) };
}
