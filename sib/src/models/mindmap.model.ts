// mindmap.model.ts — stores + pure graph logic for the Roadmap Mind-Mapper.
//
// Persistence follows the SIB convention: JsonFileStore → .sib-data/*.json.
// All mutation logic lives here as pure functions so the WS layer and the
// REST controller share one code path (and so it's unit-testable without
// Express or sockets).
//
// Conflict resolution: last-write-wins per entity, keyed on `updatedAt`
// (epoch ms set by the originating client, sanity-clamped by the server).

import { v4 as uuidv4 } from 'uuid';
import type {
  Mindmap,
  MindmapNode,
  MindmapEdge,
  MindmapVersion,
  MindmapWsEvent,
  MindmapSummary,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

export const mindmapStore = new JsonFileStore<Mindmap>('mindmaps');
export const mindmapVersionStore = new JsonFileStore<MindmapVersion>('mindmap-versions');

/** Max stored versions per map — oldest are pruned beyond this. */
export const MAX_VERSIONS_PER_MAP = 50;

// ── Graph helpers ──────────────────────────────────────────────────────────

export function createMindmap(name: string): Mindmap {
  const now = Date.now();
  return { id: uuidv4(), name, createdAt: now, updatedAt: now, nodes: [], edges: [] };
}

export function summarize(map: Mindmap): MindmapSummary {
  return {
    id: map.id,
    name: map.name,
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
    nodeCount: map.nodes.length,
    edgeCount: map.edges.length,
  };
}

/**
 * Apply a collaboration event to a map, mutating a *copy* and returning it.
 * Returns null when the event is stale (LWW: an equal-or-newer version of
 * the entity already exists) or malformed — callers skip persist + broadcast.
 */
export function applyGraphEvent(map: Mindmap, event: MindmapWsEvent): Mindmap | null {
  // Clamp client clocks that are wildly ahead (>30 s) to server time so a
  // client with a broken clock can't win every future conflict.
  const ts = Math.min(event.ts, Date.now() + 30_000);
  const next: Mindmap = { ...map, nodes: [...map.nodes], edges: [...map.edges] };

  switch (event.type) {
    case 'node:add': {
      const node = sanitizeNode(event.payload, ts);
      if (!node) return null;
      if (next.nodes.some(n => n.id === node.id)) return null; // duplicate add
      next.nodes.push(node);
      break;
    }
    case 'node:update': {
      const node = sanitizeNode(event.payload, ts);
      if (!node) return null;
      const i = next.nodes.findIndex(n => n.id === node.id);
      if (i === -1) return null;                       // deleted concurrently
      if (next.nodes[i].updatedAt > node.updatedAt) return null; // stale (LWW)
      next.nodes[i] = node;
      break;
    }
    case 'node:delete': {
      const id = (event.payload as { id?: string })?.id;
      if (!id) return null;
      if (!next.nodes.some(n => n.id === id)) return null;
      next.nodes = next.nodes.filter(n => n.id !== id);
      // Cascade: remove edges touching the node.
      next.edges = next.edges.filter(e => e.from !== id && e.to !== id);
      break;
    }
    case 'edge:add': {
      const edge = sanitizeEdge(event.payload, ts);
      if (!edge) return null;
      if (next.edges.some(e => e.id === edge.id)) return null;
      // Both endpoints must exist; ignore self-loops and duplicates.
      if (edge.from === edge.to) return null;
      if (!next.nodes.some(n => n.id === edge.from) || !next.nodes.some(n => n.id === edge.to)) return null;
      if (next.edges.some(e => e.from === edge.from && e.to === edge.to)) return null;
      next.edges.push(edge);
      break;
    }
    case 'edge:delete': {
      const id = (event.payload as { id?: string })?.id;
      if (!id || !next.edges.some(e => e.id === id)) return null;
      next.edges = next.edges.filter(e => e.id !== id);
      break;
    }
    case 'map:rename': {
      const name = (event.payload as { name?: string })?.name?.trim();
      if (!name) return null;
      next.name = name;
      break;
    }
    default:
      return null; // cursor:move / session:* never mutate the graph
  }

  next.updatedAt = Date.now();
  return next;
}

const NODE_TYPES = new Set(['tag', 'perception', 'semantic', 'reasoning', 'generic']);

function sanitizeNode(raw: unknown, ts: number): MindmapNode | null {
  const n = raw as Partial<MindmapNode> | undefined;
  if (!n || typeof n.id !== 'string' || typeof n.x !== 'number' || typeof n.y !== 'number') return null;
  return {
    id: n.id,
    x: n.x,
    y: n.y,
    text: typeof n.text === 'string' ? n.text.slice(0, 2000) : '',
    type: NODE_TYPES.has(n.type as string) ? (n.type as MindmapNode['type']) : 'generic',
    metadata: (n.metadata && typeof n.metadata === 'object') ? n.metadata as Record<string, unknown> : {},
    updatedAt: typeof n.updatedAt === 'number' ? Math.min(n.updatedAt, ts) : ts,
  };
}

function sanitizeEdge(raw: unknown, ts: number): MindmapEdge | null {
  const e = raw as Partial<MindmapEdge> | undefined;
  if (!e || typeof e.id !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') return null;
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    type: e.type === 'undirected' ? 'undirected' : 'directed',
    updatedAt: typeof e.updatedAt === 'number' ? Math.min(e.updatedAt, ts) : ts,
  };
}

// ── Versioning ─────────────────────────────────────────────────────────────

/** Snapshot the current state of a map into the version store, pruning old versions. */
export function snapshotVersion(map: Mindmap, label: string): MindmapVersion {
  const version: MindmapVersion = {
    id: uuidv4(),
    mapId: map.id,
    createdAt: Date.now(),
    label,
    snapshot: structuredClone(map),
  };
  mindmapVersionStore.save(version);

  // Bounded retention — keep the newest MAX_VERSIONS_PER_MAP per map.
  const all = versionsNewestFirst(map.id);
  if (all.length > MAX_VERSIONS_PER_MAP) {
    const cutoff = new Set(all.slice(MAX_VERSIONS_PER_MAP).map(v => v.id));
    mindmapVersionStore.pruneWhere(v => cutoff.has(v.id));
  }
  return version;
}

/**
 * Newest-first, deterministically: snapshots created within the same
 * millisecond are tie-broken by insertion order (JsonFileStore preserves it),
 * so `.reverse()` before the stable sort keeps later insertions first.
 */
function versionsNewestFirst(mapId: string): MindmapVersion[] {
  return mindmapVersionStore.findAll()
    .filter(v => v.mapId === mapId)
    .reverse()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listVersions(mapId: string): Omit<MindmapVersion, 'snapshot'>[] {
  return versionsNewestFirst(mapId).map(({ snapshot: _snapshot, ...meta }) => meta);
}

// ── Server-side SVG export ─────────────────────────────────────────────────
// Minimal, dependency-free renderer used by POST /mindmap/export.
// (The browser client exports richer PNG/SVG; this keeps export scriptable
// via curl for CI / documentation pipelines.)

const NODE_COLORS: Record<string, string> = {
  tag: '#2f6fed',
  perception: '#8b5cf6',
  semantic: '#16a34a',
  reasoning: '#f59e0b',
  generic: '#64748b',
};
const NODE_W = 160;
const NODE_H = 48;

export function renderMindmapSvg(map: Mindmap): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const xs = map.nodes.map(n => n.x);
  const ys = map.nodes.map(n => n.y);
  const pad = 60;
  const minX = (xs.length ? Math.min(...xs) : 0) - pad;
  const minY = (ys.length ? Math.min(...ys) : 0) - pad;
  const maxX = (xs.length ? Math.max(...xs) : 0) + NODE_W + pad;
  const maxY = (ys.length ? Math.max(...ys) : 0) + NODE_H + pad;

  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const edges = map.edges.map(e => {
    const a = byId.get(e.from); const b = byId.get(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H / 2;
    const x2 = b.x + NODE_W / 2, y2 = b.y + NODE_H / 2;
    const marker = e.type === 'directed' ? ' marker-end="url(#arrow)"' : '';
    return `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1.5"${marker}/>`;
  }).join('\n');

  const nodes = map.nodes.map(n => {
    const color = NODE_COLORS[n.type] ?? NODE_COLORS.generic;
    const label = esc(n.text.length > 24 ? n.text.slice(0, 23) + '…' : n.text);
    return [
      `  <g>`,
      `    <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#ffffff" stroke="${color}" stroke-width="2"/>`,
      `    <rect x="${n.x}" y="${n.y}" width="6" height="${NODE_H}" rx="3" fill="${color}"/>`,
      `    <text x="${n.x + NODE_W / 2}" y="${n.y + NODE_H / 2 + 5}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="13" fill="#1e293b">${label}</text>`,
      `  </g>`,
    ].join('\n');
  }).join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">`,
    `  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>`,
    `  <title>${esc(map.name)}</title>`,
    edges,
    nodes,
    `</svg>`,
  ].join('\n');
}
