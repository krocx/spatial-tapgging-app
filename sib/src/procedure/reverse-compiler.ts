// reverse-compiler.ts — turns an existing Guide into a `kind: 'procedure'` map.
//
// The other half of the round-trip: compiler.ts walks canvas edges into
// sequenced steps; this walks sequenced steps back into canvas nodes + edges
// so ANY guide (xlsx import, JSON import, iOS hand-built) can be edited
// visually and re-synced through the same ingest path.
//
// Pure: no I/O, no stores. The route layer resolves images (guide step-image
// store → designer image store) and passes filenames in.
//
// Fidelity rules (from the UX review):
//   • every node carries metadata.guide = { guideId, stepId } provenance, so
//     re-sync matches steps IN PLACE — placement and any fields the designer
//     doesn't surface (posX/Y/Z, evidence, model offsets) survive untouched,
//     because ingest only updates the content fields it is given.
//   • implicit sequence order becomes EXPLICIT `next` edges. The forward
//     compiler derives order purely from edges, so making the implicit chain
//     visible is what guarantees the round-trip reproduces the same order.
//   • requires edges are drawn FROM the prerequisite INTO the gated step —
//     same direction the forward compiler expects.

import { v4 as uuidv4 } from 'uuid';
import type { Guide, GuideStep, Mindmap, MindmapNode, MindmapEdge } from '@spatial/shared';

const COL_W  = 240;   // horizontal spacing along a chain
const LANE_H = 170;   // vertical spacing between lanes
const X0     = 140;
const Y0     = 220;

export interface ReverseCompileResult {
  name:     string;
  kind:     'procedure';
  anchorId: string;
  nodes:    MindmapNode[];
  edges:    MindmapEdge[];
}

/** Effective success target: explicit branch, else next in sequence. */
function effectiveNext(steps: GuideStep[], i: number): string | undefined {
  const s = steps[i];
  if (s.nextOnSuccess) return s.nextOnSuccess;
  return i + 1 < steps.length ? steps[i + 1].id : undefined;
}

/**
 * Lane layout, mirroring how the forward compiler reads a canvas:
 * lane 0 = the success spine from step 1; every step not reached that way
 * (typically failure-branch targets) starts a new lane, walked by its own
 * success chain. Guarantees every node gets exactly one position.
 */
function layoutLanes(steps: GuideStep[]): Map<string, { col: number; lane: number }> {
  const byId = new Map(steps.map(s => [s.id, s]));
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const pos = new Map<string, { col: number; lane: number }>();
  let lane = 0;

  const walk = (startId: string) => {
    let id: string | undefined = startId;
    let col = 0;
    while (id && byId.has(id) && !pos.has(id)) {
      pos.set(id, { col, lane });
      const i: number = index.get(id)!;
      id = effectiveNext(steps, i);
      col++;
    }
  };

  if (steps.length > 0) { walk(steps[0].id); lane++; }
  for (const s of steps) {
    if (!pos.has(s.id)) { walk(s.id); lane++; }
  }
  return pos;
}

export function guideToProcedureMap(guide: Guide, rawSteps: GuideStep[],
  /** stepId → designer-image-store filename (route resolves media copies). */
  imageFileByStepId: Record<string, string> = {},
): ReverseCompileResult {
  const steps = [...rawSteps].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const now = Date.now();
  const pos = layoutLanes(steps);
  const nodeIdByStepId = new Map<string, string>(steps.map(s => [s.id, uuidv4()]));

  const nodes: MindmapNode[] = steps.map((s, i) => {
    const p = pos.get(s.id) ?? { col: i, lane: 0 };
    const stepMeta: Record<string, unknown> = {};
    if (s.ttsText?.trim())            stepMeta.ttsText      = s.ttsText.trim();
    if (s.completionRequired === false) stepMeta.optional   = true;
    if (imageFileByStepId[s.id])      stepMeta.imageFile    = imageFileByStepId[s.id];
    if (s.linkUrl?.trim())            stepMeta.linkUrl      = s.linkUrl.trim();
    if (s.modelId)                    stepMeta.modelId      = s.modelId;
    if (s.modelScale !== undefined)   stepMeta.modelScale   = s.modelScale;
    if (s.modelOpacity !== undefined) stepMeta.modelOpacity = s.modelOpacity;

    return {
      id: nodeIdByStepId.get(s.id)!,
      x: X0 + p.col * COL_W,
      y: Y0 + p.lane * LANE_H,
      // Canvas title = pill text; the instruction body lives in notes, which
      // is exactly where the forward compiler reads it back from (bodyOf).
      text: s.title?.trim() || `Step ${s.sequenceNumber}`,
      notes: s.text,
      type: 'generic',
      metadata: {
        step:  stepMeta,
        // Provenance — the whole point. Re-sync updates these steps in place.
        guide: { guideId: guide.id, stepId: s.id },
      },
      updatedAt: now,
    };
  });

  const edges: MindmapEdge[] = [];
  const edge = (fromStep: string, toStep: string, role: 'next' | 'failure' | 'requires') => {
    const from = nodeIdByStepId.get(fromStep);
    const to   = nodeIdByStepId.get(toStep);
    if (!from || !to || from === to) return;    // dangling branch targets are
    edges.push({                                 // dropped; the designer's
      id: uuidv4(), from, to,                    // validator reports the gap.
      type: 'directed', role, updatedAt: now,
    });
  };

  steps.forEach((s, i) => {
    const next = effectiveNext(steps, i);
    if (next) edge(s.id, next, 'next');
    if (s.nextOnFailure) edge(s.id, s.nextOnFailure, 'failure');
    if (s.precondition)  edge(s.precondition, s.id, 'requires');
  });

  return {
    name: `[Guide] ${guide.name}`.slice(0, 120),
    kind: 'procedure',
    anchorId: guide.anchorId,
    nodes,
    edges,
  };
}

/** Assemble a full Mindmap record from the compile result (id + clocks). */
export function toMindmapRecord(r: ReverseCompileResult, guide: Guide): Mindmap {
  const now = Date.now();
  return {
    id: uuidv4(),
    name: r.name,
    createdAt: now,
    updatedAt: now,
    nodes: r.nodes,
    edges: r.edges,
    kind: r.kind,
    anchorId: r.anchorId,
    // Stale-map detection: guide edits after this moment (iOS, portal) mean
    // the map no longer reflects the guide — the UI warns before re-sync.
    guideSync: { guideId: guide.id, syncedAt: now },
  };
}
