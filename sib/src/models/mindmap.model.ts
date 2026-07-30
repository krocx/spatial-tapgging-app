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
  MindmapLane,
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
    case 'map:lanes': {
      const lanes = sanitizeLanes((event.payload as { lanes?: unknown })?.lanes);
      if (lanes === null) return null;
      next.lanes = lanes;
      break;
    }
    default:
      return null; // cursor:move / session:* never mutate the graph
  }

  next.updatedAt = Date.now();
  return next;
}

const NODE_TYPES = new Set(['tag', 'perception', 'semantic', 'reasoning', 'generic']);
const NODE_STATUSES = new Set(['planned', 'in-progress', 'done', 'blocked']);

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
    ...(NODE_STATUSES.has(n.status as string) && { status: n.status as MindmapNode['status'] }),
    ...(n.milestone === true && { milestone: true }),
    ...(typeof n.notes === 'string' && n.notes.length > 0 && { notes: n.notes.slice(0, 10_000) }),
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
    ...(typeof e.label === 'string' && e.label.trim().length > 0 && { label: e.label.trim().slice(0, 200) }),
  };
}

/** Returns null when the payload is malformed; [] is valid (lanes removed). */
export function sanitizeLanes(raw: unknown): MindmapLane[] | null {
  if (!Array.isArray(raw)) return null;
  const lanes: MindmapLane[] = [];
  for (const item of raw.slice(0, 20)) {
    const l = item as Partial<MindmapLane> | undefined;
    if (!l || typeof l.id !== 'string' || typeof l.x !== 'number' || typeof l.width !== 'number') return null;
    lanes.push({
      id: l.id,
      name: typeof l.name === 'string' ? l.name.slice(0, 80) : 'Lane',
      x: l.x,
      width: Math.max(80, l.width),
    });
  }
  return lanes;
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
const STATUS_COLORS: Record<string, string> = {
  planned: '#94a3b8',
  'in-progress': '#2563eb',
  done: '#16a34a',
  blocked: '#dc2626',
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

  // Swimlane bands behind everything.
  const lanes = (map.lanes ?? []).map((l, i) => [
    `  <rect x="${l.x}" y="${minY}" width="${l.width}" height="${maxY - minY}" fill="${i % 2 === 0 ? 'rgba(47,111,237,0.05)' : 'rgba(100,116,139,0.05)'}"/>`,
    `  <text x="${l.x + l.width / 2}" y="${minY + 24}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#94a3b8">${esc(l.name)}</text>`,
  ].join('\n')).join('\n');

  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const edges = map.edges.map(e => {
    const a = byId.get(e.from); const b = byId.get(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H / 2;
    const x2 = b.x + NODE_W / 2, y2 = b.y + NODE_H / 2;
    const marker = e.type === 'directed' ? ' marker-end="url(#arrow)"' : '';
    const label = e.label
      ? `\n  <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="11" fill="#475569" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`
      : '';
    return `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1.5"${marker}/>${label}`;
  }).join('\n');

  const nodes = map.nodes.map(n => {
    const color = NODE_COLORS[n.type] ?? NODE_COLORS.generic;
    const label = esc(n.text.length > 24 ? n.text.slice(0, 23) + '…' : n.text);
    const status = n.status
      ? `\n    <circle cx="${n.x + NODE_W - 10}" cy="${n.y + 10}" r="5" fill="${STATUS_COLORS[n.status]}" stroke="#ffffff" stroke-width="1.5"/>`
      : '';
    const milestone = n.milestone
      ? `\n    <path d="M ${n.x + 16} ${n.y - 8} l 7 8 l -7 8 l -7 -8 z" fill="#eab308" stroke="#ffffff" stroke-width="1.5"/>`
      : '';
    return [
      `  <g>`,
      `    <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#ffffff" stroke="${color}" stroke-width="2"/>`,
      `    <rect x="${n.x}" y="${n.y}" width="6" height="${NODE_H}" rx="3" fill="${color}"/>` + status + milestone,
      `    <text x="${n.x + NODE_W / 2}" y="${n.y + NODE_H / 2 + 5}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="13" fill="#1e293b">${label}</text>`,
      `  </g>`,
    ].join('\n');
  }).join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">`,
    `  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>`,
    `  <title>${esc(map.name)}</title>`,
    lanes,
    edges,
    nodes,
    `</svg>`,
  ].join('\n');
}
