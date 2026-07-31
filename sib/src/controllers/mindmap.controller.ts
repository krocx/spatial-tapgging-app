// mindmap.controller.ts — business logic for the /mindmap/* REST surface.
// Routes stay thin (validation + HTTP mapping); everything stateful runs here
// so the WS layer and tests reuse the same functions.

import { v4 as uuidv4 } from 'uuid';
import type {
  Mindmap,
  MindmapSummary,
  MindmapVersion,
  SaveMindmapRequest,
} from '@spatial/shared';
import {
  mindmapStore,
  mindmapVersionStore,
  mindmapAccessStore,
  getAccess,
  canAccess,
  isOwner,
  isPublished,
  snapshotVersion,
  listVersions,
  summarize,
  renderMindmapSvg,
  sanitizeLanes,
  sanitizeGroups,
  sanitizeSettings,
  sanitizeGraphArrays,
} from '../models/mindmap.model.js';
import { importSibGraph, buildSibDraft } from '../adapters/mindmap-sib-adapter.js';

export class MindmapError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Decorate a map response with its publication state (never the key). */
export function withPublished(map: Mindmap): Mindmap {
  return { ...map, published: isPublished(map.id) };
}

/** Throw 403 unless the map is published or the caller holds its draft key. */
export function assertAccess(mapId: string, draftKey?: string): void {
  if (!canAccess(mapId, draftKey)) {
    throw new MindmapError(403, 'This map is an unpublished draft. Enter its draft key to access it.');
  }
}

/** Create or update a map (full-graph save) and snapshot a version. */
export function saveMindmap(body: SaveMindmapRequest, draftKey?: string): SaveMindmapResult {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    throw new MindmapError(400, 'Missing required field: name');
  }
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    throw new MindmapError(400, 'nodes and edges must be arrays');
  }

  const now = Date.now();
  const existing = body.id ? mindmapStore.findById(body.id) : undefined;

  // Updates to unpublished drafts require the draft key.
  if (existing) assertAccess(existing.id, draftKey);

  // Same sanitization rules as the WS path — REST saves and JSON imports
  // can't persist unsafe links, bogus shapes, or dangling edges.
  const { nodes, edges } = sanitizeGraphArrays(body.nodes, body.edges);

  const map: Mindmap = {
    id: existing?.id ?? body.id ?? uuidv4(),
    name: body.name.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nodes,
    edges,
    // Lanes/groups/settings: keep existing when the request omits them (older clients).
    lanes: body.lanes !== undefined
      ? (sanitizeLanes(body.lanes) ?? existing?.lanes ?? [])
      : existing?.lanes,
    groups: body.groups !== undefined
      ? (sanitizeGroups(body.groups, new Set(nodes.map(n => n.id))) ?? existing?.groups ?? [])
      : existing?.groups,
    settings: body.settings !== undefined
      ? (sanitizeSettings(body.settings) ?? existing?.settings)
      : existing?.settings,
  };
  delete map.published;   // publication state lives in the access store only

  mindmapStore.save(map);
  snapshotVersion(map, body.versionLabel ?? 'manual save');

  // New maps start life as private drafts — the creator gets the key once.
  let newDraftKey: string | undefined;
  if (!existing) {
    newDraftKey = uuidv4();
    mindmapAccessStore.save({ id: map.id, draftKey: newDraftKey, published: false });
  }
  return { map: withPublished(map), draftKey: newDraftKey };
}

export interface SaveMindmapResult {
  map: Mindmap;
  /** Present only on creation — the caller must store it. */
  draftKey?: string;
}

export function loadMindmap(id: string): Mindmap {
  const map = mindmapStore.findById(id);
  if (!map) throw new MindmapError(404, `Mindmap ${id} not found`);
  return map;
}

/**
 * Published maps for everyone; drafts only when the caller presents their
 * key (draftKeys: mapId → key, parsed from the X-Draft-Keys header).
 */
export function listMindmaps(draftKeys?: Map<string, string>): MindmapSummary[] {
  return mindmapStore.findAll()
    .filter(m => canAccess(m.id, draftKeys?.get(m.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summarize);
}

export function deleteMindmap(id: string, draftKey?: string): void {
  assertAccess(id, draftKey);
  if (!mindmapStore.delete(id)) throw new MindmapError(404, `Mindmap ${id} not found`);
  mindmapVersionStore.pruneWhere(v => v.mapId === id);
  mindmapAccessStore.delete(id);
}

// ── Publish workflow ───────────────────────────────────────────────────────

export function publishMindmap(id: string, draftKey: string | undefined, publish: boolean): Mindmap {
  const map = loadMindmap(id);
  const access = getAccess(id);
  if (!access.draftKey) {
    // Pre-publish-era map: no key exists, it is de-facto published; give it
    // an owner on first publish-toggle attempt? No — refuse silently instead:
    // legacy maps stay published (nothing to unpublish with).
    if (!publish) throw new MindmapError(400, 'This map predates the publish workflow and is permanently published.');
    return withPublished(map);
  }
  if (!isOwner(id, draftKey)) {
    throw new MindmapError(403, 'Only the holder of the draft key can change publication state.');
  }
  mindmapAccessStore.update(id, { published: publish });
  return withPublished(map);
}

/** Resolve a draft key → its map summary (how a teammate unlocks a shared draft). */
export function unlockByKey(draftKey: string): { mapId: string; summary: MindmapSummary } {
  const record = mindmapAccessStore.findAll().find(a => a.draftKey && a.draftKey === draftKey);
  if (!record) throw new MindmapError(404, 'No draft found for that key.');
  const map = loadMindmap(record.id);
  return { mapId: record.id, summary: summarize(map) };
}

export function getVersions(mapId: string): Omit<MindmapVersion, 'snapshot'>[] {
  loadMindmap(mapId); // 404 if the map itself is gone
  return listVersions(mapId);
}

/** Restore a snapshot as the current state (current state is snapshotted first). */
export function restoreVersion(mapId: string, versionId: string): Mindmap {
  const current = loadMindmap(mapId);
  const version = mindmapVersionStore.findById(versionId);
  if (!version || version.mapId !== mapId) {
    throw new MindmapError(404, `Version ${versionId} not found for map ${mapId}`);
  }

  snapshotVersion(current, 'before restore');

  const restored: Mindmap = {
    ...version.snapshot,
    id: current.id,                 // identity + createdAt never change
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  };
  mindmapStore.save(restored);
  snapshotVersion(restored, `restored: ${version.label}`);
  return restored;
}

export interface ExportResult {
  contentType: string;
  filename: string;
  body: string;
}

export function exportMindmap(id: string, format: string): ExportResult {
  const map = loadMindmap(id);
  const safeName = map.name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'mindmap';

  if (format === 'json') {
    return {
      contentType: 'application/json',
      filename: `${safeName}.json`,
      body: JSON.stringify(map, null, 2),
    };
  }
  if (format === 'svg') {
    return {
      contentType: 'image/svg+xml',
      filename: `${safeName}.svg`,
      body: renderMindmapSvg(map),
    };
  }
  if (format === 'sib-json') {
    return {
      contentType: 'application/json',
      filename: `${safeName}.sib-draft.json`,
      body: JSON.stringify(buildSibDraft(map), null, 2),
    };
  }
  // PNG rendering needs a raster canvas — done client-side in /roadmap to keep
  // SIB dependency-free. The endpoint stays honest about that.
  throw new MindmapError(400, `Unsupported export format "${format}". Server supports: json, svg, sib-json. PNG export is available in the /roadmap client.`);
}

export interface ImportSibSummary {
  map: Mindmap;
  addedNodes: number;
  addedEdges: number;
}

/** Merge SIB anchors/tags into a map (idempotent) and snapshot a version. */
export function importSib(mapId: string, anchorId?: string): ImportSibSummary {
  const map = loadMindmap(mapId);
  const result = importSibGraph(map, anchorId);

  if (result.addedNodes === 0 && result.addedEdges === 0) {
    return { map, addedNodes: 0, addedEdges: 0 };
  }

  const next: Mindmap = { ...map, nodes: result.nodes, edges: result.edges, updatedAt: Date.now() };
  mindmapStore.save(next);
  snapshotVersion(next, `SIB import (+${result.addedNodes} nodes, +${result.addedEdges} edges)`);
  return { map: next, addedNodes: result.addedNodes, addedEdges: result.addedEdges };
}
