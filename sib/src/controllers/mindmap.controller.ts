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
  snapshotVersion,
  listVersions,
  summarize,
  renderMindmapSvg,
} from '../models/mindmap.model.js';

export class MindmapError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Create or update a map (full-graph save) and snapshot a version. */
export function saveMindmap(body: SaveMindmapRequest): Mindmap {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    throw new MindmapError(400, 'Missing required field: name');
  }
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    throw new MindmapError(400, 'nodes and edges must be arrays');
  }

  const now = Date.now();
  const existing = body.id ? mindmapStore.findById(body.id) : undefined;

  const map: Mindmap = {
    id: existing?.id ?? body.id ?? uuidv4(),
    name: body.name.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nodes: body.nodes,
    edges: body.edges,
  };

  mindmapStore.save(map);
  snapshotVersion(map, body.versionLabel ?? 'manual save');
  return map;
}

export function loadMindmap(id: string): Mindmap {
  const map = mindmapStore.findById(id);
  if (!map) throw new MindmapError(404, `Mindmap ${id} not found`);
  return map;
}

export function listMindmaps(): MindmapSummary[] {
  return mindmapStore.findAll()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summarize);
}

export function deleteMindmap(id: string): void {
  if (!mindmapStore.delete(id)) throw new MindmapError(404, `Mindmap ${id} not found`);
  mindmapVersionStore.pruneWhere(v => v.mapId === id);
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
  // PNG rendering needs a raster canvas — done client-side in /roadmap to keep
  // SIB dependency-free. The endpoint stays honest about that.
  throw new MindmapError(400, `Unsupported export format "${format}". Server supports: json, svg. PNG export is available in the /roadmap client.`);
}
