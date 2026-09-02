// compiler.ts — compiles a `kind: 'procedure'` Mindmap into an ImportedGuide.
//
// Pure: no I/O, no stores, no Express. That is deliberate — the sequencing
// logic here is the same logic the Guide Library graph uses to lay out lanes
// and the same order an Operator walks on device. It needs to be unit-testable
// in isolation, because a silent disagreement between "what the canvas shows"
// and "what the guide does" is the worst defect this feature can produce.
//
// See docs/PROCEDURE-DESIGNER.md for the design and the validation contract.
//
// ── Sequencing ───────────────────────────────────────────────────────────────
// Unlike the portal graph renderer, there is no pre-existing sequenceNumber to
// fall back on — the graph is defined purely by edges. So:
//
//   1. start      = the only node with no incoming `next` or `failure` edge
//   2. spine      = walk `next` from start                      → lane 0
//   3. branches   = each `failure` edge into an unplaced node opens a new lane,
//                   walked via `next` from there
//   4. leftovers  = anything unplaced is unreachable → blocking error
//
// Branch walks follow `next` only. There is no positional fallback: in a
// canvas, an unconnected node genuinely is unconnected, and silently inferring
// an order from x/y would reintroduce exactly the class of bug that made the
// portal graph collapse every branch into one lane.

import type {
  Mindmap,
  MindmapNode,
  MindmapEdge,
  ImportedGuide,
  ImportedGuideStep,
  ProcedureCompileResult,
  ProcedureIssue,
} from '@spatial/shared';

/** Canvas reading order: left to right, then top to bottom. */
function byPosition(a: MindmapNode, b: MindmapNode): number {
  return a.x !== b.x ? a.x - b.x : a.y - b.y;
}

/** Title shown on the step pill. Falls back to a positional label. */
function titleOf(node: MindmapNode, seq: number): string {
  const t = (node.text ?? '').trim();
  return t.length > 0 ? t : `Step ${seq}`;
}

/**
 * Instruction body. Prefers the node's notes (the inspector's long field), and
 * falls back to the node title so a quickly-sketched map still compiles —
 * a step with a title and no notes is under-specified, not invalid.
 */
function bodyOf(node: MindmapNode): string {
  const notes = (node.notes ?? '').trim();
  if (notes.length > 0) return notes;
  return (node.text ?? '').trim();
}

/**
 * Per-step authoring fields set by the Inspector's Procedure section, stored
 * at node.metadata.step: voice script, optional flag, attached image (a
 * designer-image-store filename) and 3D model assignment.
 */
interface StepMeta {
  ttsText?:      string;
  optional?:     boolean;
  evidenceRequired?: boolean;
  imageFile?:    string;
  linkUrl?:      string;
  modelId?:      string;
  modelScale?:   number;
  modelOpacity?: number;
}

function stepMetaOf(node: MindmapNode): StepMeta {
  const raw = node.metadata?.step;
  if (!raw || typeof raw !== 'object') return {};
  const m = raw as Record<string, unknown>;
  return {
    ttsText:      typeof m.ttsText === 'string' && m.ttsText.trim() ? m.ttsText.trim() : undefined,
    optional:     m.optional === true,
    evidenceRequired: m.evidenceRequired === true,
    imageFile:    typeof m.imageFile === 'string' && m.imageFile ? m.imageFile : undefined,
    // Only http(s) survives — anything else would produce a dead button on device.
    linkUrl:      typeof m.linkUrl === 'string' && /^https?:\/\//i.test(m.linkUrl.trim())
                    ? m.linkUrl.trim() : undefined,
    modelId:      typeof m.modelId === 'string' && m.modelId ? m.modelId : undefined,
    modelScale:   typeof m.modelScale === 'number' && isFinite(m.modelScale) && m.modelScale > 0 ? m.modelScale : undefined,
    modelOpacity: typeof m.modelOpacity === 'number' && m.modelOpacity >= 0 && m.modelOpacity <= 1 ? m.modelOpacity : undefined,
  };
}

export function compileProcedure(map: Mindmap): ProcedureCompileResult {
  const issues: ProcedureIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) =>
    issues.push({ level: 'error', code, message, ...(nodeId && { nodeId }) });
  const warn = (code: string, message: string, nodeId?: string) =>
    issues.push({ level: 'warning', code, message, ...(nodeId && { nodeId }) });

  const nodes = [...map.nodes].sort(byPosition);
  const byId = new Map<string, MindmapNode>();
  nodes.forEach(n => byId.set(n.id, n));

  const emptyCensus = { steps: nodes.length, next: 0, failure: 0, requires: 0, lanes: 0 };

  if (nodes.length === 0) {
    err('empty-map', 'This procedure has no steps yet.');
    return { ok: false, issues, census: emptyCensus };
  }

  // ── Index edges by role, dropping anything that references a missing node ──
  const nextOut     = new Map<string, string>();   // from → to
  const failOut     = new Map<string, string>();
  const precondOf   = new Map<string, string>();   // gated step → prerequisite
  const nextIn      = new Set<string>();           // has an incoming `next` edge

  const seenNext    = new Set<string>();
  const seenFail    = new Set<string>();
  const seenPrecond = new Set<string>();

  for (const e of map.edges as MindmapEdge[]) {
    if (!e.role) {
      warn('unroled-edge',
        'A connection has no relationship set, so it will be ignored. Set it to Next, On failure or Requires.',
        e.from);
      continue;
    }
    if (!byId.has(e.from) || !byId.has(e.to)) {
      warn('dangling-edge', 'A connection points at a step that no longer exists and will be ignored.');
      continue;
    }

    if (e.role === 'next') {
      if (seenNext.has(e.from)) {
        err('dup-next',
          `"${titleOf(byId.get(e.from)!, 0)}" has more than one Next connection. A step can only continue to one place.`,
          e.from);
        continue;
      }
      seenNext.add(e.from);
      nextOut.set(e.from, e.to);
      nextIn.add(e.to);
    } else if (e.role === 'failure') {
      if (seenFail.has(e.from)) {
        err('dup-failure',
          `"${titleOf(byId.get(e.from)!, 0)}" has more than one On failure connection. A step can only have one recovery path.`,
          e.from);
        continue;
      }
      seenFail.add(e.from);
      failOut.set(e.from, e.to);
    } else {
      // requires: drawn FROM the prerequisite INTO the gated step
      if (seenPrecond.has(e.to)) {
        warn('multi-requires',
          `"${titleOf(byId.get(e.to)!, 0)}" has more than one prerequisite. Only the first will be enforced.`,
          e.to);
        continue;
      }
      seenPrecond.add(e.to);
      precondOf.set(e.to, e.from);
    }
  }

  const census = {
    steps:    nodes.length,
    next:     nextOut.size,
    failure:  failOut.size,
    requires: precondOf.size,
    lanes:    0,
  };

  // ── Start node ────────────────────────────────────────────────────────────
  // Two tiers, because a retry loop ("if the warm-up fails, go back to step 1")
  // gives the genuine first step an incoming *failure* edge. Disqualifying on
  // that would report a perfectly normal procedure as having no way in.
  //
  //   tier 1 — no incoming next AND not a failure target : a true entry point
  //   tier 2 — no incoming next                          : entry inside a retry loop
  //
  // Nodes that are failure targets are branch roots, not alternative starts, so
  // they are excluded from tier 1 rather than reported as competing entries.
  const failureTargets = new Set(failOut.values());
  const noNextIn = nodes.filter(n => !nextIn.has(n.id));
  const tier1    = noNextIn.filter(n => !failureTargets.has(n.id));
  const start    = tier1[0] ?? noNextIn[0];

  if (!start) {
    err('no-start',
      'Every step follows another step, so there is no way in. One step must have no incoming Next connection.');
    return { ok: false, issues, census };
  }

  // ── Lane assignment ───────────────────────────────────────────────────────
  const lane = new Map<string, number>();
  const orderedIds: string[] = [];

  const walk = (fromId: string, laneNo: number) => {
    let cur: string | undefined = fromId;
    const guard = new Set<string>();
    while (cur && !lane.has(cur) && !guard.has(cur)) {
      guard.add(cur);
      lane.set(cur, laneNo);
      orderedIds.push(cur);
      cur = nextOut.get(cur);
    }
  };

  walk(start.id, 0);

  let laneCount = 1;
  // BFS over already-placed steps so a branch off a branch gets its own lane.
  for (let i = 0; i < orderedIds.length; i++) {
    const target = failOut.get(orderedIds[i]);
    // A failure edge into an already-placed step is a loop back into the flow.
    // Correct, drawn as a back-arc, and it needs no lane of its own.
    if (!target || lane.has(target)) continue;
    walk(target, laneCount++);
  }
  census.lanes = laneCount;

  // ── Unreachable ───────────────────────────────────────────────────────────
  for (const n of nodes) {
    if (!lane.has(n.id)) {
      err('unreachable',
        `"${titleOf(n, 0)}" cannot be reached from the first step. Connect it, or delete it.`,
        n.id);
    }
  }

  // ── Sequence numbers ──────────────────────────────────────────────────────
  const seqOf = new Map<string, number>();
  orderedIds.forEach((id, i) => seqOf.set(id, i + 1));
  const order: Record<string, number> = {};
  seqOf.forEach((seq, id) => { order[id] = seq; });

  // ── Per-step checks ───────────────────────────────────────────────────────
  for (const id of orderedIds) {
    const node = byId.get(id)!;
    if (bodyOf(node).length === 0) {
      err('empty-text',
        `Step ${seqOf.get(id)} has no instruction text. An operator would see an empty panel.`,
        id);
    } else if (bodyOf(node).length > 280) {
      warn('long-text',
        `Step ${seqOf.get(id)}'s instruction is ${bodyOf(node).length} characters — on the AR panel it will truncate behind a "More" control. Consider splitting it into two steps.`,
        id);
    } else if ((node.notes ?? '').trim().length === 0) {
      warn('title-only',
        `Step ${seqOf.get(id)} has no detail — its title will be used as the instruction.`,
        id);
    }
    if (!stepMetaOf(node).imageFile) {
      warn('no-image',
        `Step ${seqOf.get(id)} has no reference image. Usable, but weaker in the field.`,
        id);
    }
  }

  // ── Precondition cycles ───────────────────────────────────────────────────
  // A prerequisite that can only be reached after the step it gates is a
  // deadlock: neither can ever become available.
  for (const [gated, prereq] of precondOf) {
    const gs = seqOf.get(gated);
    const ps = seqOf.get(prereq);
    if (gs !== undefined && ps !== undefined && ps > gs) {
      err('requires-after',
        `Step ${gs} requires step ${ps}, which comes later. Neither step could ever run.`,
        gated);
    }
  }

  const hasErrors = issues.some(i => i.level === 'error');
  if (hasErrors) return { ok: false, issues, census, order };

  // ── Emit ──────────────────────────────────────────────────────────────────
  const steps: ImportedGuideStep[] = orderedIds.map(id => {
    const node = byId.get(id)!;
    const seq  = seqOf.get(id)!;
    const meta = stepMetaOf(node);

    const nextId    = nextOut.get(id);
    const failId    = failOut.get(id);
    const prereqId  = precondOf.get(id);

    const step: ImportedGuideStep = {
      sequenceNumber:     seq,
      title:              titleOf(node, seq),
      text:               bodyOf(node),
      // metadata.optional kept for backward compat with slice-1 maps;
      // metadata.step.optional is what the Inspector writes now.
      completionRequired: (meta.optional || node.metadata?.optional === true) ? false : true,
      ...(meta.evidenceRequired === true ? { evidenceRequired: true } : {}),
    };
    if (meta.ttsText)      step.ttsText      = meta.ttsText;
    if (meta.imageFile)    step.imageFile    = meta.imageFile;
    if (meta.linkUrl)      step.linkUrl      = meta.linkUrl;
    if (meta.modelId) {
      step.modelId = meta.modelId;
      if (meta.modelScale   !== undefined) step.modelScale   = meta.modelScale;
      if (meta.modelOpacity !== undefined) step.modelOpacity = meta.modelOpacity;
    }
    if (nextId   && seqOf.has(nextId))   step.nextOnSuccessSeq = seqOf.get(nextId);
    if (failId   && seqOf.has(failId))   step.nextOnFailureSeq = seqOf.get(failId);
    if (prereqId && seqOf.has(prereqId)) step.preconditionSeq  = seqOf.get(prereqId);
    return step;
  });

  // Mindmap has no description field; the guide description is left for the
  // author to set in the Guide Library rather than invented here.
  const guide: ImportedGuide = {
    name: (map.name ?? '').trim() || 'Untitled procedure',
    steps,
  };

  return { ok: true, issues, census, guide, order };
}
