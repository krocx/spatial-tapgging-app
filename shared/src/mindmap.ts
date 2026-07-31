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

/** Roadmap execution status — rendered as a badge on the node. */
export type MindmapNodeStatus = 'planned' | 'in-progress' | 'done' | 'blocked';

/** Review verdict — independent of execution status. */
export type MindmapNodeReview = 'approved' | 'rejected' | 'needs-validation';

/** Node outline shape. Default: 'rounded'. */
export type MindmapNodeShape = 'rounded' | 'rect' | 'pill' | 'diamond' | 'hexagon';

export interface MindmapComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;   // epoch ms
}

export interface MindmapNode {
  id: string;
  x: number;
  y: number;
  text: string;
  type: MindmapNodeType;
  metadata: Record<string, unknown>;
  /** Last-write-wins clock — epoch ms of the last mutation. */
  updatedAt: number;
  /** Roadmap status badge (optional — plain mind-map nodes have none). */
  status?: MindmapNodeStatus;
  /** Milestone marker — rendered as a gold diamond. */
  milestone?: boolean;
  /** Free-form notes, edited in the inspector panel. */
  notes?: string;
  /** Review verdict (approve / reject / needs validation). */
  review?: MindmapNodeReview;
  /**
   * Collapse marker: when true, descendants reachable via *directed* edges
   * are hidden (fixpoint rule: a node hides only when ALL its directed
   * parents are collapsed or hidden — alternate visible paths keep it shown).
   */
  collapsed?: boolean;
  /** Icon name from the curated set (client validates; server caps length). */
  icon?: string;
  /** Outline shape (default 'rounded'). */
  shape?: MindmapNodeShape;
  /** Hyperlink — http(s) only, opened via the ↗ affordance. */
  link?: string;
  /**
   * Discussion thread. Server-side merge is append-safe: node:update events
   * union comments by id, and comment:add/comment:delete events mutate the
   * thread directly — concurrent commenters never overwrite each other.
   */
  comments?: MindmapComment[];
}

export interface MindmapEdge {
  id: string;
  from: string;               // node id
  to: string;                 // node id
  type: MindmapEdgeType;
  updatedAt: number;
  /** Optional label rendered at the edge midpoint. */
  label?: string;
}

/**
 * Swimlane band. orientation 'column' (default): vertical band spanning a
 * world-space x range — e.g. Now / Next / Later. orientation 'row':
 * horizontal band spanning a y range — e.g. Why / What / How; for rows,
 * `x` is the band's top y and `width` is its height (field reuse keeps the
 * wire format and stored data backward-compatible).
 */
export interface MindmapLane {
  id: string;
  name: string;
  x: number;
  width: number;
  orientation?: 'column' | 'row';
}

/**
 * Named node grouping — a saved selection usable as a view filter
 * ("show only Perception-pipeline nodes"). Groups are map-level state,
 * replaced atomically via the `map:groups` WS event (like lanes).
 */
export interface MindmapGroup {
  id: string;
  name: string;
  nodeIds: string[];
}

/** Map-level visual style — shared by all viewers and honored by exports. */
export interface MindmapSettings {
  /** 'parent': edges take the source node's layer color. Default 'parent'. */
  edgeColor?: 'parent' | 'neutral';
  /** Default 'straight'. */
  edgeStyle?: 'straight' | 'curved';
}

export interface Mindmap {
  id: string;
  name: string;
  createdAt: number;          // epoch ms
  updatedAt: number;          // epoch ms
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  /** Swimlanes (optional — absent on plain mind-maps). */
  lanes?: MindmapLane[];
  /** Named node groups (optional). */
  groups?: MindmapGroup[];
  /** Visual style (optional). */
  settings?: MindmapSettings;
  /**
   * Publication state — decorated onto responses by the server from its
   * access store; ignored when sent by clients. Absent = published
   * (backward compatibility with pre-publish maps).
   */
  published?: boolean;
}

/** Lightweight listing entry (no graph payload). */
export interface MindmapSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
  /** false = draft (only listed for callers presenting its draft key). */
  published: boolean;
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
  lanes?: MindmapLane[];
  groups?: MindmapGroup[];
  settings?: MindmapSettings;
  /** Optional label recorded on the version snapshot. */
  versionLabel?: string;
}

/** Creation responses carry the map's draft key exactly once. */
export type SaveMindmapResponse = Mindmap & { draftKey?: string };

/** sib-json: draft SIB entity scaffold generated from tag-typed nodes. */
export type ExportFormat = 'json' | 'svg' | 'sib-json';

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
  | 'map:lanes'     // full lanes array replace (rename/add/remove/resize)
  | 'map:groups'    // full groups array replace (create/rename/remove/membership)
  | 'map:settings'  // visual style replace (edge color/curve mode)
  | 'comment:add'    // { nodeId, comment } — appended server-side (never lost to LWW)
  | 'comment:delete' // { nodeId, commentId }
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
