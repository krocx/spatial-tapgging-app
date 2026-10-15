// models/part-resolver.ts - find a guide's step parts in a model that may
// have been regenerated since (2026.4.50, backlog #6).
//
// A step addresses a part by node name (`cmp:<DEF>`). When the model is
// rebuilt from a later publication the exporter may rename DEFs, and the
// guide then points at names the GLB no longer has - the XR kit's "N step
// nodes not found in the model". The GLB extras carry three more handles
// per part (objectID, partNumber, displayName), so a reference is resolved
// by a cascade and the guide can be re-pointed once, on the server, instead
// of every renderer guessing on its own.
//
// Proprietary & Confidential · Applied Materials.

import type { GuideStepNode } from '@spatial/shared';
import { partTreeOf, isPlaybackNode, type GlbPartNode } from './glb-nodes.js';

export interface PartIndex {
  names:        Set<string>;
  byObjectId:   Map<string, string[]>;
  byPartNumber: Map<string, string[]>;
  byDisplay:    Map<string, string[]>;
  /** Node name → its extras (objectID, partNumber, displayName, def). */
  extrasOf:     Map<string, Record<string, unknown>>;
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();
const push = (m: Map<string, string[]>, k: string, v: string) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(v)) a.push(v); } else m.set(k, [v]); };

export function buildPartIndex(gltf: Record<string, unknown>): PartIndex {
  const idx: PartIndex = { names: new Set(), byObjectId: new Map(), byPartNumber: new Map(), byDisplay: new Map(), extrasOf: new Map() };
  const walk = (n: GlbPartNode) => {
    idx.names.add(n.name);
    const e = n.extras ?? {};
    idx.extrasOf.set(n.name, e);
    if (e.objectID !== undefined && e.objectID !== null) push(idx.byObjectId, String(e.objectID), n.name);
    if (e.partNumber) push(idx.byPartNumber, norm(e.partNumber), n.name);
    if (e.displayName) push(idx.byDisplay, norm(e.displayName), n.name);
    if (e.def) push(idx.byDisplay, norm(e.def), n.name);
    for (const c of n.children) walk(c);
  };
  for (const r of partTreeOf(gltf).roots) walk(r);
  // Playback nodes (hose flipbook frames, rest tubes) are not parts an author
  // picks, so the part tree leaves them out - but a step's deltas do address
  // them, so they count as present here or every hose reports as missing.
  const nodesJ = Array.isArray(gltf.nodes) ? gltf.nodes as Array<Record<string, unknown>> : [];
  nodesJ.forEach((nj, i) => { const name = typeof nj.name === 'string' && nj.name.trim() ? nj.name : `node${i}`; if (isPlaybackNode(name)) idx.names.add(name); });
  return idx;
}

export type MatchBy = 'name' | 'objectID' | 'partNumber' | 'displayName';
export type PartMatch = { name: string; by: MatchBy } | null;

/** Resolve one step node reference against the index. Only unambiguous
 *  fallbacks count: a handle shared by several parts is not a match. */
export function resolvePart(idx: PartIndex, ref: Pick<GuideStepNode, 'node' | 'sourceKey'>, extrasOfRef?: Record<string, unknown>): PartMatch {
  if (idx.names.has(ref.node)) return { name: ref.node, by: 'name' };
  const one = (list: string[] | undefined) => list && list.length === 1 ? list[0] : undefined;
  // objectID: the step's sourceKey is the importer's objectID (procedure.ts);
  // a previous model's extras may also hand it over.
  const oid = ref.sourceKey && /^\d+$/.test(ref.sourceKey) ? ref.sourceKey : extrasOfRef?.objectID !== undefined ? String(extrasOfRef.objectID) : undefined;
  if (oid) { const n = one(idx.byObjectId.get(oid)); if (n) return { name: n, by: 'objectID' }; }
  if (extrasOfRef?.partNumber) { const n = one(idx.byPartNumber.get(norm(extrasOfRef.partNumber))); if (n) return { name: n, by: 'partNumber' }; }
  const display = extrasOfRef?.displayName ? norm(extrasOfRef.displayName) : norm(ref.node.replace(/^cmp:/, ''));
  { const n = one(idx.byDisplay.get(display)); if (n) return { name: n, by: 'displayName' }; }
  return null;
}

export interface RebindReport {
  total: number; matched: number;
  /** Renamed references: old node → new node, and which handle matched. */
  renamed: { from: string; to: string; by: MatchBy }[];
  unmatched: string[];
}

/** Re-point every node reference of a guide's steps and initial state at the
 *  current model. `previous` is the index of the model the guide was authored
 *  against (when still on disk) so partNumber / displayName can carry over.
 *  Mutates the given node lists; returns what changed. */
export function rebindParts(idx: PartIndex, nodeLists: GuideStepNode[][], previous?: PartIndex): RebindReport {
  const report: RebindReport = { total: 0, matched: 0, renamed: [], unmatched: [] };
  const seenRename = new Set<string>();
  for (const list of nodeLists) for (const ref of list) {
    report.total++;
    const m = resolvePart(idx, ref, previous?.extrasOf.get(ref.node));
    if (!m) { if (!report.unmatched.includes(ref.node)) report.unmatched.push(ref.node); continue; }
    report.matched++;
    if (m.name !== ref.node) {
      const key = `${ref.node}→${m.name}`;
      if (!seenRename.has(key)) { seenRename.add(key); report.renamed.push({ from: ref.node, to: m.name, by: m.by }); }
      ref.node = m.name;
    }
  }
  return report;
}
