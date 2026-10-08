/**
 * portfolio-core.ts - the POC Portfolio's rules, pure (docs/POC-PORTFOLIO.md).
 *
 *   • Stages and the gates between them (a POC cannot start without scope
 *     and a definition of done; cannot complete without learnings, a
 *     scorecard update on its tracks and an exit).
 *   • Health is separate from stage and set by a Manager with a reason.
 *   • The overview order: decisions waiting on leadership first, then red,
 *     then the stalest record, so the sponsor reads what needs them.
 *   • Staleness against the weekly steering cadence.
 *   • The seed: the use-cases the programme runs today, so the page never
 *     opens empty.
 */
import type { UseCase, Poc, PocStage, UseCaseStage, PocExit, Health } from '@spatial/shared';

export const USECASE_STAGES: { id: UseCaseStage; label: string }[] = [
  { id: 'identified', label: 'Identified' }, { id: 'scoping', label: 'Scoping' }, { id: 'agreed', label: 'Agreed' },
  { id: 'active', label: 'Active' }, { id: 'pilot', label: 'Pilot' }, { id: 'adopted', label: 'Adopted' }, { id: 'parked', label: 'Parked' },
];
export const POC_STAGES: { id: PocStage; label: string }[] = [
  { id: 'planned', label: 'Planned' }, { id: 'in-progress', label: 'In progress' }, { id: 'completed', label: 'Completed' },
];
export const EXITS: { id: PocExit; label: string }[] = [
  { id: 'next-poc', label: 'Next POC' }, { id: 'pilot', label: 'Move to pilot' }, { id: 'parked', label: 'Parked in the backlog' },
];
export const HEALTH: Health[] = ['green', 'amber', 'red'];
/** Weekly steering committee: a record older than this is stale on the overview. */
export const STALE_DAYS = 7;

export const stageLabel = (s: UseCaseStage) => USECASE_STAGES.find(x => x.id === s)?.label ?? s;
export const pocStageLabel = (s: PocStage) => POC_STAGES.find(x => x.id === s)?.label ?? s;
export const exitLabel = (e: PocExit | undefined) => e ? (EXITS.find(x => x.id === e)?.label ?? e) : '';

/** The current POC: the one in progress, else the next planned, else the last completed. */
export function currentPoc(u: UseCase): Poc | undefined {
  const sorted = [...u.pocs].sort((a, b) => a.number - b.number);
  return sorted.find(p => p.stage === 'in-progress') ?? sorted.find(p => p.stage === 'planned') ?? sorted[sorted.length - 1];
}

/** Gate for a POC stage change. `scorecardTouched` = an entry exists on one of the POC's tracks since it started. */
export function pocGate(poc: Poc, target: PocStage, scorecardTouched: boolean): { ok: true } | { ok: false; why: string } {
  if (target === poc.stage) return { ok: true };
  if (target === 'in-progress') {
    const missing = [!poc.scope?.trim() && 'scope', !poc.definitionOfDone?.trim() && 'definition of done'].filter(Boolean);
    if (missing.length) return { ok: false, why: `A POC starts with its ${missing.join(' and ')} written down` };
    return { ok: true };
  }
  if (target === 'completed') {
    const missing = [
      !poc.learnings.length && 'at least one learning',
      !poc.exit && 'an exit (next POC, pilot or parked)',
      !scorecardTouched && (poc.tracks.length ? 'a scorecard entry on its tracks since it started' : ''),
    ].filter(Boolean);
    if (missing.length) return { ok: false, why: `A POC completes with ${missing.join(', ')}` };
    if (poc.exit === 'parked' && !poc.exitReason?.trim()) return { ok: false, why: 'Parking needs the reason (technology, hardware or software not available …)' };
    return { ok: true };
  }
  if (target === 'planned' && poc.stage === 'completed') return { ok: false, why: 'A completed POC stays completed - add the next POC instead' };
  return { ok: true };
}

/** Use-case stage must follow the POCs: Active needs a POC in progress; Pilot needs a completed POC with exit pilot. */
export function useCaseGate(u: UseCase, target: UseCaseStage): { ok: true } | { ok: false; why: string } {
  if (target === 'active' && !u.pocs.some(p => p.stage === 'in-progress')) return { ok: false, why: 'Active means a POC is in progress - start one first' };
  if (target === 'pilot' && !u.pocs.some(p => p.stage === 'completed' && p.exit === 'pilot')) return { ok: false, why: 'Pilot follows a completed POC whose exit is "move to pilot"' };
  if (target === 'agreed' && !u.pocs.some(p => p.scope?.trim() && p.definitionOfDone?.trim())) return { ok: false, why: 'Agreed means at least one POC has its scope and definition of done' };
  return { ok: true };
}

export function daysSince(iso: string | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso); if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Latest activity on a use-case: the newest status, bottleneck or learning entry, or its updatedAt. */
export function lastActivity(u: UseCase): string {
  let last = u.updatedAt;
  for (const p of u.pocs) for (const e of [...p.status, ...p.bottlenecks, ...p.learnings]) if (e.at > last) last = e.at;
  return last;
}

export const openDecisions = (u: UseCase) => u.pocs.flatMap(p => p.bottlenecks.filter(b => b.needsLeadership && !b.resolvedAt));
export const openBottlenecks = (u: UseCase) => u.pocs.flatMap(p => p.bottlenecks.filter(b => !b.resolvedAt));

/** Overview order: decisions waiting on leadership, then red, then amber, then the stalest. */
export function sortForOverview(list: UseCase[], now = new Date()): UseCase[] {
  const h: Record<Health, number> = { red: 0, amber: 1, green: 2 };
  return [...list].sort((a, b) =>
    (openDecisions(b).length > 0 ? 1 : 0) - (openDecisions(a).length > 0 ? 1 : 0)
    || h[a.health] - h[b.health]
    || (daysSince(lastActivity(b), now) ?? 0) - (daysSince(lastActivity(a), now) ?? 0)
    || a.bu.localeCompare(b.bu) || a.name.localeCompare(b.name));
}

export function summary(list: UseCase[], now = new Date()) {
  const byStage: Record<string, number> = {};
  for (const s of USECASE_STAGES) byStage[s.id] = 0;
  for (const u of list) byStage[u.stage] = (byStage[u.stage] ?? 0) + 1;
  const pocs = list.flatMap(u => u.pocs);
  const stale = list.filter(u => (daysSince(lastActivity(u), now) ?? 0) > STALE_DAYS);
  return {
    bus: [...new Set(list.map(u => u.bu))].sort(),
    useCases: list.length,
    byStage,
    pocsTotal: pocs.length,
    pocsInProgress: pocs.filter(p => p.stage === 'in-progress').length,
    pocsCompleted: pocs.filter(p => p.stage === 'completed').length,
    decisions: list.reduce((n, u) => n + openDecisions(u).length, 0),
    red: list.filter(u => u.health === 'red').length,
    stale: stale.length,
    oldestUpdateDays: list.length ? Math.max(...list.map(u => daysSince(lastActivity(u), now) ?? 0)) : 0,
  };
}

// ── Seed: the use-cases the programme runs today ─────────────────────────────
export function seedUseCases(at: string, by: string): UseCase[] {
  const poc = (number: number, name: string, scope: string, dod: string, tracks: string[], stage: PocStage = 'planned'): Poc =>
    ({ id: `poc-${number}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, number, name, scope, definitionOfDone: dod, stage, tracks, status: [], bottlenecks: [], learnings: [], ...(stage === 'in-progress' ? { startedAt: at } : {}) });
  const base = (id: string, bu: string, name: string, question: string, process: string, stage: UseCaseStage, pocs: Poc[]): UseCase =>
    ({ id, bu, name, question, process, stage, health: 'green', anchorIds: [], guideIds: [], pocs, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });
  return [
    base('mdp-fd10-wi', 'MDP', 'FD10 WI: the future of Connected Worker work instructions',
      'Which work instructions are still technician-driven after automation, AMRs, cobots, physical AI and agentic AI - and how those instructions adapt to the technician, showing the future of the Smart Worker and the factory of the future.',
      'FD10', 'active', [
        poc(1, 'AR work instructions on glasses', 'Show how AR work instructions will be presented when glasses are ready: the FD10 instructions imported, placed on the equipment, delivered per device form on the devices held today.', 'The FD10 instructions run end to end on the iPad and on at least one headset class, with device readiness scored on the scorecard.', ['content-pipeline', 'hardware-fit'], 'in-progress'),
        poc(2, 'Adaptive to the technician performing the task', 'Instructions that adapt to how the technician performs the task, rather than the static, pre-programmed instructions used for decades.', 'Baselines learned per step from real visits; at least one adaptation (pace, order or detail) demonstrated and measured against the static version.', ['content-pipeline']),
        poc(3, 'Contextual intelligence: guide, detect, assist', 'Instructions with contextual intelligence that guide the technician as they work, auto-detect a task done correctly and validated, or done incorrectly, and assist until it is fixed.', 'Auto-recognition of task done / done wrong demonstrated on the iPad benchmark with measured precision and recall, and the assist loop closed on at least one step.', ['content-pipeline', 'ar-sdk']),
      ]),
    base('etch-cathode-3doms', 'ETCH', 'Cathode: 3D OMS to spatial computing devices',
      'How a 3D OMS publication is imported and auto-converted for spatial computing devices, so the content the BU already has reaches the technician without being re-authored.',
      'Cathode', 'active', [
        poc(1, 'Manual import and device readiness', 'Import the Cathode 3D OMS publication manually; check the result on each device form; fix the import where the model or the steps differ from the source.', 'The Cathode publication imports with parts, steps and hidden-at-start state faithful to the source, previews on the XR kit, and has a readiness verdict per device on the scorecard.', ['content-pipeline', 'hardware-fit'], 'in-progress'),
        poc(2, 'Dynamic import from MES', 'Pull the instructions from MES and adapt them to the device in real time, so MEs never import by hand.', 'One Cathode process pulled live from MES through the GIS-enabled API, adapted per device form, run on the floor with no manual import step.', ['content-pipeline']),
      ]),
    base('etch-esc-json-cad', 'ETCH', 'ESC: JSON work instructions attached to CAD (.JT)',
      'The non-3D-OMS path: import the instructions as JSON and attach each instruction or step to the imported CAD (.JT) model, for content that has no 3D OMS publication.',
      'ESC', 'scoping', [
        poc(1, 'Manual import and device readiness (JSON + CAD)', 'Import the ESC instructions as JSON, attach each step to the imported .JT model, check the result on each device form.', 'ESC steps attached to the CAD model, previewed on the XR kit, with a readiness verdict per device on the scorecard.', ['content-pipeline', 'hardware-fit']),
        poc(2, 'Dynamic import from MES (JSON + CAD)', 'Pull the ESC instructions from MES and attach them to the CAD model automatically, adapted per device.', 'One ESC process pulled live from MES, attached to its CAD model and run on the floor without a manual import step.', ['content-pipeline']),
      ]),
  ];
}
