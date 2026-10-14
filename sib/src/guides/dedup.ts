/**
 * Import de-duplication (2026.4.50, backlog #2).
 *
 * Every re-import of the same publication used to create a new guide with
 * the same name, and every guide then got its own designer map - the
 * "nine Bee Assembly cards" on the Roadmap home. An import now looks for
 * an existing guide first and lets the caller choose: update it (steps
 * refreshed; id, anchor, configuration, sharing, sessions, map, placement
 * and validation training kept) or create a new one on purpose.
 *
 * Match key: the normalised name (lower-case, collapsed whitespace), since a
 * Cortona publication carries no stable id of its own. Guides in the trash
 * are not matched; archived ones are, so an update revives the right guide.
 * When several guides already share the name, the newest wins and the count
 * is reported so the caller can say so.
 */
import type { Guide, GuideStep } from '@spatial/shared';
import { guideStore, guideStepStore } from './store.js';
import { runsOf } from './lifecycle.js';

export const normalizeGuideName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface ExistingGuideMatch {
  guideId: string; name: string; anchorId: string; steps: number; runs: number;
  published: boolean; archived: boolean; createdAt: string; updatedAt: string;
  /** How many guides share this name (the newest is the one above). */
  matches: number;
}

export function findExistingGuide(name: string, anchorId?: string): ExistingGuideMatch | null {
  const key = normalizeGuideName(name); if (!key) return null;
  const same = guideStore.findAll().filter(g => normalizeGuideName(g.name) === key);
  if (same.length === 0) return null;
  // Prefer the same anchor, then the most recently updated.
  same.sort((a, b) => Number(b.anchorId === anchorId) - Number(a.anchorId === anchorId) || b.updatedAt.localeCompare(a.updatedAt));
  const g: Guide = same[0];
  return {
    guideId: g.id, name: g.name, anchorId: g.anchorId, steps: guideStepStore.findAll().filter(s => s.guideId === g.id).length,
    runs: runsOf(g.id), published: !!g.published, archived: !!g.archivedAt, createdAt: g.createdAt, updatedAt: g.updatedAt, matches: same.length,
  };
}

/** Incoming sequenceNumber → existing step id, paired by rank (first with
 *  first, second with second), so an update re-uses the step records and
 *  with them placement and validation training. Extra incoming steps are
 *  created; extra existing steps are removed by the ingest path. */
export function existingStepIdsBySeq(guideId: string, incomingSeqs: number[]): Record<number, string> {
  const out: Record<number, string> = {};
  const steps: GuideStep[] = guideStepStore.findAll().filter(s => s.guideId === guideId).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const seqs = [...incomingSeqs].sort((a, b) => a - b);
  seqs.forEach((seq, i) => { if (steps[i]) out[seq] = steps[i].id; });
  return out;
}
