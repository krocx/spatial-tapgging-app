// mindmap.ts — Roadmap Mind-Mapper schema (SIB-hosted, /roadmap)
//
// Shared between the SIB server (routes/ws/model) and the roadmap-client.
// Follows the SIB layer ontology: node types map 1:1 onto SIB layers so a
// mind-map can later be projected into anchors/tags/perception entities.

// --- Node ontology (SIB layers) ---

export type MindmapNodeType =
  | 'tag'         // blue    — spatial layer (anchors/tags)
  | 'perception'  // purple  — perception layer (models, comparators)
  | 'semantic'    // green   — semantic layer (meaning, ontology)
  | 'reasoning'   // orange  — reasoning / orchestration layer
  | 'generic';    // grey    — free-form

export type MindmapEdgeType = 'directed' | 'undirected';

export interface MindmapNode {
  id: string;
  x: number;
  y: number;
  text: string;
  type: MindmapNodeType;
  metadata: Record<string, unknown>;
  /** Last-write-wins clock — epoch ms of the last mutation. */
  updatedAt: number;
}

export interface MindmapEdge {
  id: string;
  from: string;               // node id
  to: string;                 // node id
  type: MindmapEdgeType;
  updatedAt: number;
}

export interface Mindmap {
  id: string;
  name: string;
  createdAt: number;          // epoch ms
  updatedAt: number;          // epoch ms
  nodes: MindmapNode[];
  edges: MindmapEdge[];
}

/** Lightweight listing entry (no graph payload). */
export interface MindmapSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
}

// --- Versioning ---

export interface MindmapVersion {
  id: string;
  mapId: string;
  createdAt: number;
  /** e.g. "manual save", "auto snapshot", "before restore" */
  label: string;
  snapshot: Mindmap;
}

// --- REST request/response payloads ---

export interface SaveMindmapRequest {
  /** Omit id to create a new map. */
  id?: string;
  name: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  /** Optional label recorded on the version snapshot. */
  versionLabel?: string;
}

export type ExportFormat = 'json' | 'svg';

export interface ExportMindmapRequest {
  id: string;
  format: ExportFormat;
}

// --- Collaboration (WebSocket /mindmap/ws) ---

export type MindmapWsEventType =
  | 'session:join'
  | 'session:leave'
  | 'node:add'
  | 'node:update'
  | 'node:delete'
  | 'edge:add'
  | 'edge:delete'
  | 'cursor:move'
  | 'map:sync'      // server → client: full graph on join / resync
  | 'map:rename'
  | 'error';

export interface MindmapWsEvent<T = unknown> {
  type: MindmapWsEventType;
  mapId: string;
  /** Originating client session id — server fills this in on broadcast. */
  clientId?: string;
  /** Display name for cursors / presence. */
  clientName?: string;
  /** Event emission time (epoch ms) — used for last-write-wins. */
  ts: number;
  payload: T;
}

export interface CursorPayload {
  x: number;
  y: number;
  /** Node id being dragged, if any (lets peers render live drags smoothly). */
  draggingNodeId?: string;
}

export interface PresencePayload {
  clientId: string;
  clientName: string;
  /** Everyone currently in the room (sent with session:join/leave). */
  peers: { clientId: string; clientName: string }[];
}

export interface MapSyncPayload {
  map: Mindmap;
}
