// export.ts — controller for turning a procedure map into a real guide.
//
// Sits between the compiler (pure graph → ImportedGuide) and the ingestion
// service (ImportedGuide → Guide + GuideStep records). Its own job is the
// policy in between:
//
//   • only a `kind: 'procedure'` map may be exported
//   • blocking validation issues stop the write
//   • re-syncing a PUBLISHED guide is refused unless explicitly confirmed,
//     because operators may be mid-session against it
//   • node provenance (metadata.guide) is read to match steps, and written
//     back after a successful export so the next re-sync matches again
//
// See docs/PROCEDURE-DESIGNER.md §8.

import type {
  Mindmap,
  MindmapNode,
  MindmapGuideProvenance,
  ProcedureCompileResult,
  ProcedureExportResult,
  ProcedureIssue,
} from '@spatial/shared';
import { compileProcedure } from './compiler.js';
import { applyImportedGuide } from '../guides/ingest.js';
import { guideStore, guideStepStore } from '../guides/store.js';

export class ProcedureError extends Error {
  constructor(public status: number, message: string, public issues: ProcedureIssue[] = []) {
    super(message);
  }
}

/** Reads `node.metadata.guide` if it is well-formed. */
export function provenanceOf(node: MindmapNode): MindmapGuideProvenance | null {
  const raw = node.metadata?.guide as Partial<MindmapGuideProvenance> | undefined;
  return raw && typeof raw.guideId === 'string' && typeof raw.stepId === 'string'
    ? { guideId: raw.guideId, stepId: raw.stepId }
    : null;
}

/**
 * The guide this map is already bound to, inferred from node provenance.
 * Returns null for a map that has never been exported.
 */
export function boundGuideId(map: Mindmap): string | null {
  for (const n of map.nodes) {
    const p = provenanceOf(n);
    if (p) return p.guideId;
  }
  return null;
}

export function assertProcedureMap(map: Mindmap): void {
  if (map.kind !== 'procedure') {
    throw new ProcedureError(400,
      'This is a roadmap map. Only procedure maps can be sent to the Guide Library.');
  }
}

/** Compile only — used by the pre-flight panel. Never writes. */
export function validateProcedure(map: Mindmap): ProcedureCompileResult {
  assertProcedureMap(map);
  return compileProcedure(map);
}

export interface ExportProcedureOptions {
  anchorId?:         string;
  createdBy:         string;
  /** Explicit target. Falls back to the guide inferred from node provenance. */
  guideId?:          string;
  /** Required to proceed when the target guide is published. */
  confirmUnpublish?: boolean;
}

export interface ExportProcedureOutcome {
  result:      ProcedureExportResult;
  /** node id → provenance to persist, so the next re-sync matches these steps. */
  provenance:  Record<string, MindmapGuideProvenance>;
}

export async function exportProcedure(
  map:  Mindmap,
  opts: ExportProcedureOptions,
): Promise<ExportProcedureOutcome> {
  assertProcedureMap(map);

  const compiled = compileProcedure(map);
  if (!compiled.ok || !compiled.guide || !compiled.order) {
    throw new ProcedureError(422,
      'This procedure has problems that must be fixed before it can be sent.',
      compiled.issues);
  }

  const targetGuideId = opts.guideId ?? boundGuideId(map) ?? undefined;
  const anchorId      = opts.anchorId ?? map.anchorId;
  if (!anchorId) {
    throw new ProcedureError(400,
      'Choose which anchor this procedure belongs to before sending it.');
  }

  // Map derived sequence numbers back to the step ids already on those nodes,
  // so ingest updates in place and placement survives.
  const existingStepIdBySeq: Record<number, string> = {};
  const nodeBySeq = new Map<number, string>();
  for (const node of map.nodes) {
    const seq = compiled.order[node.id];
    if (seq === undefined) continue;
    nodeBySeq.set(seq, node.id);
    const prov = provenanceOf(node);
    if (prov && (!targetGuideId || prov.guideId === targetGuideId)) {
      existingStepIdBySeq[seq] = prov.stepId;
    }
  }

  // ── Published-guide policy (agreed in the round-trip UX review) ────────────
  // CONTENT-ONLY edits (every compiled step matches an existing step, none
  // added or removed) apply LIVE: placement is untouched by ingest, operators
  // just see better wording/voice/images. STRUCTURAL edits (steps added or
  // removed) change what "fully placed" means, so they require the caller to
  // confirm — and the guide unpublishes until the new steps are placed.
  const existing = targetGuideId ? guideStore.findById(targetGuideId) : undefined;
  if (existing?.published) {
    const existingCount = guideStepStore.findAll()
      .filter(s => s.guideId === existing.id).length;
    const compiledCount = compiled.guide.steps.length;
    const allMatched    = compiled.guide.steps
      .every(s => existingStepIdBySeq[s.sequenceNumber] !== undefined);
    const contentOnly   = allMatched && compiledCount === existingCount;

    if (!contentOnly && !opts.confirmUnpublish) {
      throw new ProcedureError(409,
        `"${existing.name}" is published and this change adds or removes steps. ` +
        'Confirm to apply — the guide will be unpublished until the new steps are placed in AR.');
    }
    if (!contentOnly && opts.confirmUnpublish) {
      guideStore.save({ ...existing, published: false, updatedAt: new Date().toISOString() });
      console.log(`[procedure] Unpublished ${existing.id} ("${existing.name}") — structural re-sync`);
    }
    // contentOnly → fall through: live in-place update, stays published.
  }

  const applied = await applyImportedGuide(compiled.guide, {
    anchorId,
    createdBy: opts.createdBy,
    guideId:   targetGuideId,
    existingStepIdBySeq,
  });

  // Hand provenance back so the caller can persist it onto the nodes.
  const provenance: Record<string, MindmapGuideProvenance> = {};
  for (const step of applied.steps) {
    const nodeId = nodeBySeq.get(step.sequenceNumber);
    if (nodeId) provenance[nodeId] = { guideId: applied.guide.id, stepId: step.id };
  }

  const result: ProcedureExportResult = {
    guideId:       applied.guide.id,
    guideName:     applied.guide.name,
    stepsCreated:  applied.created,
    stepsUpdated:  applied.updated,
    stepsRemoved:  applied.removed,
    stepsUnplaced: applied.unplaced,
    issues:        compiled.issues,   // warnings survive a successful export
  };

  return { result, provenance };
}
