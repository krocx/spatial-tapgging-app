// map-merge.ts — D (2026.4.46): bring a procedure map up to date with its guide.
//
// Doctrine: the GUIDE is the source of truth; the map is a VIEW of it that
// carries presentation the guide doesn't (layout, shapes, icons, comments,
// annotation nodes). "Edit in Designer" used to reopen the stored map as-is
// and merely warn when the guide had moved on — a step added on iOS never
// reached the canvas, and re-sending from that canvas would have dropped it.
//
// This merge re-derives the CONTENT from the guide (via the reverse compiler)
// and keeps the map's PRESENTATION, matched by per-node provenance
// (`metadata.guide.stepId`):
//   • step exists + node exists  → content updated in place, x/y/shape/icon/
//                                  comments/review/collapsed kept
//   • step exists, no node       → node added beside its predecessor's node
//                                  (or on the fresh layout when it has none)
//   • node exists, step gone     → node and its edges removed
//   • node without provenance    → annotation, untouched
//   • role edges (next/failure/requires) rebuilt from the guide, reusing the
//     existing edge id when from/to/role already match; non-role edges kept
//     while both endpoints survive.
//
// Pure: no I/O, no stores.

import { v4 as uuidv4 } from 'uuid';
import type { Guide, GuideStep, Mindmap, MindmapNode, MindmapEdge } from '@spatial/shared';
import { guideToProcedureMap } from './reverse-compiler.js';

const COL_W  = 240;
const LANE_H = 170;

export interface MergeSummary {
  added:   number;
  updated: number;
  removed: number;
  /** Titles of added steps — for the portal toast. */
  addedTitles: string[];
}

function stepIdOf(n: MindmapNode): string | undefined {
  const g = n.metadata?.guide as { stepId?: unknown } | undefined;
  return typeof g?.stepId === 'string' ? g.stepId : undefined;
}

/** Nearest free slot at/below (x, y) — never stack a new node on an old one. */
function freeSpot(nodes: MindmapNode[], x: number, y: number): { x: number; y: number } {
  const taken = (px: number, py: number) => nodes.some(n => Math.abs(n.x - px) < 60 && Math.abs(n.y - py) < 60);
  let yy = y;
  for (let i = 0; i < 50 && taken(x, yy); i++) yy += LANE_H;
  return { x, y: yy };
}

export function mergeGuideIntoMap(
  map: Mindmap, guide: Guide, rawSteps: GuideStep[],
  imageFileByStepId: Record<string, string> = {},
): { map: Mindmap; summary: MergeSummary } {
  const fresh = guideToProcedureMap(guide, rawSteps, imageFileByStepId);
  const steps = [...rawSteps].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const now = Date.now();

  const existingByStep = new Map<string, MindmapNode>();
  for (const n of map.nodes) { const sid = stepIdOf(n); if (sid) existingByStep.set(sid, n); }
  const freshStepOf = new Map<string, string>();   // fresh node id → stepId
  for (const n of fresh.nodes) { const sid = stepIdOf(n); if (sid) freshStepOf.set(n.id, sid); }

  const summary: MergeSummary = { added: 0, updated: 0, removed: 0, addedTitles: [] };
  const mergedByStep = new Map<string, MindmapNode>();
  const out: MindmapNode[] = [];

  // Annotations (no provenance) survive untouched.
  for (const n of map.nodes) if (!stepIdOf(n)) out.push(n);

  // Walk steps in sequence so a new step can sit beside its predecessor.
  let prevMerged: MindmapNode | undefined;
  for (const s of steps) {
    const f = fresh.nodes.find(n => stepIdOf(n) === s.id);
    if (!f) continue;
    const ex = existingByStep.get(s.id);
    let merged: MindmapNode;
    if (ex) {
      merged = {
        ...ex,
        text:  f.text,
        notes: f.notes,
        metadata: { ...ex.metadata, step: f.metadata.step, guide: f.metadata.guide },
        updatedAt: now,
      };
      summary.updated++;
    } else {
      const spot = prevMerged
        ? freeSpot([...out, ...mergedByStep.values()], prevMerged.x + COL_W, prevMerged.y)
        : freeSpot([...out, ...mergedByStep.values()], f.x, f.y);
      merged = { ...f, id: uuidv4(), x: spot.x, y: spot.y, updatedAt: now };
      summary.added++;
      summary.addedTitles.push(f.text);
    }
    mergedByStep.set(s.id, merged);
    out.push(merged);
    prevMerged = merged;
  }

  // Provenance nodes whose step is gone.
  for (const [sid] of existingByStep) if (!mergedByStep.has(sid)) summary.removed++;

  const survivingIds = new Set(out.map(n => n.id));
  const mergedIdOfFresh = (freshId: string): string | undefined => {
    const sid = freshStepOf.get(freshId);
    return sid ? mergedByStep.get(sid)?.id : undefined;
  };

  const edges: MindmapEdge[] = [];
  // Non-role edges (drawn by hand on the canvas) — keep while endpoints live.
  for (const e of map.edges) {
    if (e.role) continue;
    if (survivingIds.has(e.from) && survivingIds.has(e.to)) edges.push(e);
  }
  // Role edges — the guide decides; reuse ids where the same edge existed.
  for (const fe of fresh.edges) {
    const from = mergedIdOfFresh(fe.from), to = mergedIdOfFresh(fe.to);
    if (!from || !to) continue;
    const same = map.edges.find(e => e.role === fe.role && e.from === from && e.to === to);
    edges.push(same ? { ...same, updatedAt: same.updatedAt } : { ...fe, from, to, updatedAt: now });
  }

  const mergedMap: Mindmap = {
    ...map,
    name: map.name,                       // the designer may have renamed it — keep
    anchorId: guide.anchorId,
    nodes: out,
    edges,
    updatedAt: now,
    guideSync: { guideId: guide.id, syncedAt: now },
  };
  return { map: mergedMap, summary };
}
