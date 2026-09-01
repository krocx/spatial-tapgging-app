// store.ts — Zustand store: all business logic for the mind-map editor.
// Components stay presentational; every mutation flows through an action here
// so local state, the undo stack, and the collaboration channel never diverge.
//
// Collaboration model: optimistic local apply → WS event to peers → server
// persists (LWW). Remote events apply through the same reducers minus the echo.

import { create } from 'zustand';
import type {
  Mindmap, MindmapNode, MindmapEdge, MindmapLane, MindmapGroup, MindmapNodeType,
  MindmapNodeStatus, MindmapNodeReview, MindmapComment, MindmapSummary,
  MindmapWsEvent, MapSyncPayload, CursorPayload, PresencePayload,
  MindmapKind, MindmapEdgeRole, ProcedureCompileResult, ProcedureExportResult,
} from '@spatial/shared';
import { mindmapApi } from '../api/mindmap-api.js';
import { CollabClient, type CollabStatus } from '../ws/collab.js';
import { autoLayout, type LayoutMode } from '../utils/layout.js';
import { NODE_W, NODE_H, nodeHeight } from '../utils/geometry.js';
import { computeSteps, stepBounds, type PresentationStep } from '../utils/presentation.js';
import type { MindmapEdgePort, MindmapNodeShape, MindmapSettings } from '@spatial/shared';
import { getDraftKey, type ImageImportResult } from '../api/mindmap-api.js';
import { fileToDownscaledBase64 } from '../utils/image.js';
import { parseGlossary, type GlossaryData } from '../utils/glossary.js';

export interface Peer {
  clientId: string;
  clientName: string;
  x: number;
  y: number;
  draggingNodeId?: string;
  lastSeen: number;
}

export interface Camera { x: number; y: number; scale: number; }

interface HistoryEntry {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  lanes?: MindmapLane[];
  groups?: MindmapGroup[];
}

/** 'none' matches nodes without a status. */
export type StatusFilter = MindmapNodeStatus | 'none';

export interface ViewFilters {
  types: MindmapNodeType[];
  statuses: StatusFilter[];
  groupIds: string[];
}

export const EMPTY_FILTERS: ViewFilters = { types: [], statuses: [], groupIds: [] };

/**
 * Highlight rule: within a category selections OR together; across categories
 * they AND. Returns null when no filters are active (= highlight everything).
 */
export function computeHighlight(map: Mindmap, f: ViewFilters): Set<string> | null {
  if (f.types.length === 0 && f.statuses.length === 0 && f.groupIds.length === 0) return null;
  const grouped = new Set<string>(
    (map.groups ?? []).filter(g => f.groupIds.includes(g.id)).flatMap(g => g.nodeIds),
  );
  const out = new Set<string>();
  for (const n of map.nodes) {
    if (f.types.length > 0 && !f.types.includes(n.type)) continue;
    if (f.statuses.length > 0 && !f.statuses.includes(n.status ?? 'none')) continue;
    if (f.groupIds.length > 0 && !grouped.has(n.id)) continue;
    out.add(n.id);
  }
  return out;
}

const HISTORY_LIMIT = 100;
let collab: CollabClient | null = null;   // socket lives outside the store
let cursorThrottle = 0;                   // cursor:move rate limit
let dragThrottle = 0;                     // node:update rate limit during drags

// Clipboard + last cursor position (module-level: no re-renders on mouse move).
let clipboard: { nodes: MindmapNode[]; edges: MindmapEdge[] } | null = null;
let lastMouseWorld = { x: 300, y: 200 };
export function noteMouseWorld(x: number, y: number): void { lastMouseWorld = { x, y }; }

interface State {
  // navigation
  view: 'list' | 'editor';
  maps: MindmapSummary[];
  map: Mindmap | null;
  // editor
  camera: Camera;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  selectedLaneId: string | null;
  editingNodeId: string | null;
  pendingEdgeFrom: string | null;      // node id while dragging a new connection
  pendingEdgeFromPort: MindmapEdgePort | null;  // pinned source port, if the drag started on one
  defaultNodeType: MindmapNodeType;
  searchQuery: string;
  /** Last applied auto-layout; any manual node move resets to 'freeform'. */
  layoutMode: 'freeform' | 'hierarchical' | 'grid';
  /** View filters — per-client, never synced or persisted. */
  filters: ViewFilters;
  showFilterPanel: boolean;
  /** Presentation mode — per-client walkthrough of lanes/groups. */
  presentation: { active: boolean; step: number; steps: PresentationStep[] };
  /** Whiteboard/screenshot import: preview awaiting user confirmation. */
  imagePreview: ImageImportResult | null;
  importingImage: boolean;
  /** In-app dictionary (docs/roadmap-glossary.md, fetched once per session). */
  glossary: GlossaryData | null;
  showGlossary: boolean;
  glossaryFocusTerm: string | null;
  // ── Procedure Designer (kind: 'procedure' maps only) ──────────────────────
  /**
   * A connection has been dropped and is waiting for the author to say what it
   * means. On procedure maps an edge is never created until a role is chosen —
   * an unroled edge is silently ignored by the compiler, which would be a
   * confusing way to lose work.
   */
  pendingRolePick: { from: string; to: string; fromPort?: MindmapEdgePort; toPort?: MindmapEdgePort } | null;
  /**
   * Latest server-side pre-flight. Holds the census, the derived step order and
   * any issues. Server-derived on purpose: see mindmap-api.procedureValidate.
   */
  procedure: ProcedureCompileResult | null;
  procedureBusy: boolean;
  /** Result of the last successful send, shown as a confirmation. */
  procedureSent: ProcedureExportResult | null;
  /** Set when a send is refused because the target guide is published. */
  procedurePublishedConflict: string | null;
  /**
   * Canvas day/night theme. Per-client, per-map-kind (localStorage) — a view
   * preference like filters, never synced. Procedure maps default to night so
   * an executable procedure is visually unmistakable from a planning roadmap;
   * node cards stay white in both themes so nothing inside them can lose
   * contrast.
   */
  canvasTheme: 'day' | 'night';
  /**
   * Preview walkthrough (procedure maps): simulates the operator's run in a
   * phone-frame panel while the canvas highlights the current step. Purely
   * client-side — traverses the same next/failure/requires edges the compiler
   * emits and the iOS runtime walks, so what you rehearse is what ships.
   */
  preview: {
    currentId: string;
    /** Steps completed (in order visited). */
    visited: string[];
    /** Unmet prerequisite blocking the current step, if any. */
    blockedBy: string | null;
    /** Terminal state: the walk ran off the end of the Next chain. */
    done: boolean;
  } | null;
  // collab
  collabStatus: CollabStatus;
  peers: Record<string, Peer>;
  // meta
  dirty: boolean;
  statusMessage: string;
  error: string | null;
  // history
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

interface Actions {
  refreshList(): Promise<void>;
  createMap(name: string, kind?: MindmapKind): Promise<void>;
  openMap(id: string, clientName: string): Promise<void>;
  closeMap(): void;
  deleteMap(id: string): Promise<void>;

  setCamera(cam: Camera): void;
  select(nodeId: string | null, additive?: boolean): void;
  selectEdge(edgeId: string | null): void;
  setEditing(nodeId: string | null): void;
  setDefaultNodeType(t: MindmapNodeType): void;
  setPendingEdgeFrom(nodeId: string | null, port?: MindmapEdgePort): void;

  addNode(x: number, y: number, type?: MindmapNodeType): void;
  updateNodeText(id: string, text: string): void;
  setNodeType(id: string, type: MindmapNodeType): void;
  setNodeStatus(id: string, status: MindmapNodeStatus | undefined): void;
  setNodeReview(id: string, review: MindmapNodeReview | undefined): void;
  toggleMilestone(id: string): void;
  setNodeNotes(id: string, notes: string): void;
  addComment(nodeId: string, text: string): void;
  deleteComment(nodeId: string, commentId: string): void;
  moveNode(id: string, x: number, y: number, live: boolean): void;
  moveNodes(positions: Array<{ id: string; x: number; y: number }>, live: boolean): void;
  addEdge(from: string, to: string, fromPort?: MindmapEdgePort, toPort?: MindmapEdgePort): void;
  toggleEdgeType(id: string): void;
  setEdgeLabel(id: string, label: string): void;
  // ── Procedure Designer ────────────────────────────────────────────────────
  confirmEdgeRole(role: MindmapEdgeRole): void;
  cancelEdgeRole(): void;
  setEdgeRole(id: string, role: MindmapEdgeRole): void;
  validateProcedure(): Promise<void>;
  sendToGuideLibrary(opts: { anchorId?: string; createdBy: string; confirmUnpublish?: boolean }): Promise<void>;
  dismissProcedureSent(): void;
  toggleCanvasTheme(): void;
  /** Merge fields into node.metadata.step (voice, required, image, model). */
  patchStepMeta(nodeId: string, patch: Record<string, unknown>): void;
  // ── Preview walkthrough ───────────────────────────────────────────────────
  startPreview(): void;
  exitPreview(): void;
  /** Advance along the current step's `next` or `failure` edge. */
  previewGo(role: 'next' | 'failure'): void;
  /** Jump to the unmet prerequisite blocking the current step. */
  previewJumpToRequired(): void;
  deleteSelection(): void;

  // Lanes
  selectLane(id: string | null): void;
  setLanes(lanes: MindmapLane[], withHistory?: boolean): void;
  addLanePreset(): void;
  addRowLanePreset(): void;
  addLane(): void;
  fitView(): void;
  importMapFromJson(raw: string): Promise<void>;

  // Groups + view filters
  setGroups(groups: MindmapGroup[]): void;
  createGroupFromSelection(name: string): void;
  renameGroup(id: string, name: string): void;
  deleteGroup(id: string): void;
  toggleTypeFilter(t: MindmapNodeType): void;
  toggleStatusFilter(s: StatusFilter): void;
  toggleGroupFilter(id: string): void;
  clearFilters(): void;
  setShowFilterPanel(v: boolean): void;

  // Rich nodes + collapse + presentation
  toggleCollapse(id: string): void;
  setNodeIcon(id: string, icon: string | undefined): void;
  setNodeShape(id: string, shape: MindmapNodeShape | undefined): void;
  setNodeLink(id: string, link: string | undefined): void;
  startPresentation(): void;
  exitPresentation(): void;
  presentationGoto(step: number): void;

  // Style settings + publish workflow
  updateSettings(patch: Partial<MindmapSettings>): void;
  publishMap(): Promise<void>;
  unpublishMap(): Promise<void>;
  unlockDraft(draftKey: string): Promise<void>;
  /** Does this browser hold the current map's draft key? */
  holdsDraftKey(): boolean;

  // Whiteboard/screenshot import
  importFromImage(file: File): Promise<void>;
  discardImagePreview(): void;
  createFromImagePreview(name: string): Promise<void>;

  // Dictionary
  loadGlossary(): Promise<void>;
  openGlossary(term?: string): void;
  closeGlossary(): void;
  updateLane(id: string, patch: Partial<MindmapLane>): void;
  removeLane(id: string): void;

  // Clipboard / search
  copySelection(): void;
  pasteClipboard(): void;
  duplicateSelection(): void;
  setSearchQuery(q: string): void;
  jumpToNode(id: string): void;

  // SIB bridge
  importFromSib(): Promise<void>;

  applyAutoLayout(mode: LayoutMode): void;
  undo(): void;
  redo(): void;
  save(label?: string): Promise<void>;
  restoreVersion(versionId: string): Promise<void>;

  sendCursor(x: number, y: number, draggingNodeId?: string): void;
  setError(message: string | null): void;
}

export const useStore = create<State & Actions>((set, get) => {

  // ── internal helpers ─────────────────────────────────────────────────────

  function pushHistory(): void {
    const { map, undoStack } = get();
    if (!map) return;
    const entry: HistoryEntry = {
      nodes: structuredClone(map.nodes),
      edges: structuredClone(map.edges),
      lanes: map.lanes ? structuredClone(map.lanes) : undefined,
      groups: map.groups ? structuredClone(map.groups) : undefined,
    };
    set({ undoStack: [...undoStack.slice(-HISTORY_LIMIT + 1), entry], redoStack: [] });
  }

  function mutateGraph(fn: (map: Mindmap) => void): void {
    const { map } = get();
    if (!map) return;
    const next = { ...map, nodes: [...map.nodes], edges: [...map.edges] };
    fn(next);
    next.updatedAt = Date.now();
    set({ map: next, dirty: true });
  }

  /** Patch one node (history + WS broadcast) — shared by all field editors. */
  function patchNode(id: string, patch: Partial<MindmapNode>): void {
    pushHistory();
    let updated: MindmapNode | undefined;
    mutateGraph(m => {
      const i = m.nodes.findIndex(n => n.id === id);
      if (i !== -1) {
        updated = { ...m.nodes[i], ...patch, updatedAt: Date.now() };
        m.nodes[i] = updated;
      }
    });
    if (updated) collab?.send('node:update', updated);
  }

  /** Replace one edge (history + delete/re-add on the wire). */
  function patchEdge(id: string, patch: Partial<MindmapEdge>): void {
    pushHistory();
    let updated: MindmapEdge | undefined;
    mutateGraph(m => {
      const i = m.edges.findIndex(e => e.id === id);
      if (i !== -1) {
        updated = { ...m.edges[i], ...patch, updatedAt: Date.now() };
        m.edges[i] = updated;
      }
    });
    if (updated) {
      collab?.send('edge:delete', { id });
      collab?.send('edge:add', updated);
    }
  }

  /** Apply a remote (peer / server) event to local state. */
  function onCollabEvent(event: MindmapWsEvent): void {
    const { map } = get();
    switch (event.type) {
      case 'map:sync': {
        const synced = (event.payload as MapSyncPayload).map;
        if (synced) {
          // Defensive: if a sync payload ever arrives without publication
          // state, keep what we already know instead of letting the
          // Draft/Published chip read `undefined` as published.
          set({
            map: { ...synced, published: synced.published ?? get().map?.published },
            dirty: false,
          });
        }
        return;
      }
      case 'session:join':
      case 'session:leave': {
        const p = event.payload as PresencePayload;
        const peers: Record<string, Peer> = {};
        for (const peer of p.peers ?? []) {
          const existing = get().peers[peer.clientId];
          peers[peer.clientId] = existing ?? { ...peer, x: 0, y: 0, lastSeen: Date.now() };
        }
        set({ peers });
        return;
      }
      case 'cursor:move': {
        if (!event.clientId) return;
        const c = event.payload as CursorPayload;
        const peers = { ...get().peers };
        const existing = peers[event.clientId];
        peers[event.clientId] = {
          clientId: event.clientId,
          clientName: event.clientName ?? existing?.clientName ?? 'Peer',
          x: c.x, y: c.y,
          draggingNodeId: c.draggingNodeId,
          lastSeen: Date.now(),
        };
        set({ peers });
        return;
      }
    }

    if (!map || event.mapId !== map.id) return;

    switch (event.type) {
      case 'node:add': {
        const node = event.payload as MindmapNode;
        mutateGraph(m => { if (!m.nodes.some(n => n.id === node.id)) m.nodes.push(node); });
        return;
      }
      case 'node:update': {
        const node = event.payload as MindmapNode;
        mutateGraph(m => {
          const i = m.nodes.findIndex(n => n.id === node.id);
          if (i !== -1 && m.nodes[i].updatedAt <= node.updatedAt) m.nodes[i] = node;
        });
        return;
      }
      case 'node:delete': {
        const { id } = event.payload as { id: string };
        mutateGraph(m => {
          m.nodes = m.nodes.filter(n => n.id !== id);
          m.edges = m.edges.filter(e => e.from !== id && e.to !== id);
        });
        return;
      }
      case 'edge:add': {
        const edge = event.payload as MindmapEdge;
        mutateGraph(m => { if (!m.edges.some(e => e.id === edge.id)) m.edges.push(edge); });
        return;
      }
      case 'edge:delete': {
        const { id } = event.payload as { id: string };
        mutateGraph(m => { m.edges = m.edges.filter(e => e.id !== id); });
        return;
      }
      case 'map:rename': {
        const { name } = event.payload as { name: string };
        mutateGraph(m => { m.name = name; });
        return;
      }
      case 'map:lanes': {
        const { lanes } = event.payload as { lanes: MindmapLane[] };
        mutateGraph(m => { m.lanes = lanes; });
        return;
      }
      case 'map:groups': {
        const { groups } = event.payload as { groups: MindmapGroup[] };
        mutateGraph(m => { m.groups = groups; });
        return;
      }
      case 'map:settings': {
        const { settings } = event.payload as { settings: MindmapSettings };
        mutateGraph(m => { m.settings = settings; });
        return;
      }
      case 'comment:add': {
        const { nodeId, comment } = event.payload as { nodeId: string; comment: MindmapComment };
        mutateGraph(m => {
          const i = m.nodes.findIndex(n => n.id === nodeId);
          if (i !== -1 && !(m.nodes[i].comments ?? []).some(c => c.id === comment.id)) {
            m.nodes[i] = { ...m.nodes[i], comments: [...(m.nodes[i].comments ?? []), comment] };
          }
        });
        return;
      }
      case 'comment:delete': {
        const { nodeId, commentId } = event.payload as { nodeId: string; commentId: string };
        mutateGraph(m => {
          const i = m.nodes.findIndex(n => n.id === nodeId);
          if (i !== -1) {
            const remaining = (m.nodes[i].comments ?? []).filter(c => c.id !== commentId);
            m.nodes[i] = { ...m.nodes[i], comments: remaining.length ? remaining : undefined };
          }
        });
        return;
      }
    }
  }

  // ── store ────────────────────────────────────────────────────────────────

  return {
    view: 'list',
    maps: [],
    map: null,
    camera: { x: 0, y: 0, scale: 1 },
    selectedNodeIds: [],
    selectedEdgeId: null,
    selectedLaneId: null,
    editingNodeId: null,
    pendingRolePick: null,
    procedure: null,
    procedureBusy: false,
    procedureSent: null,
    procedurePublishedConflict: null,
    canvasTheme: 'day',
    preview: null,
    pendingEdgeFrom: null,
    pendingEdgeFromPort: null,
    defaultNodeType: 'generic',
    searchQuery: '',
    layoutMode: 'freeform',
    filters: EMPTY_FILTERS,
    showFilterPanel: false,
    presentation: { active: false, step: 0, steps: [] },
    imagePreview: null,
    importingImage: false,
    glossary: null,
    showGlossary: false,
    glossaryFocusTerm: null,
    collabStatus: 'disconnected',
    peers: {},
    dirty: false,
    statusMessage: '',
    error: null,
    undoStack: [],
    redoStack: [],

    async refreshList() {
      try { set({ maps: await mindmapApi.list(), error: null }); }
      catch (err) { set({ error: (err as Error).message }); }
    },

    async createMap(name, kind) {
      try {
        const map = await mindmapApi.save({
          name, nodes: [], edges: [], versionLabel: 'created',
          ...(kind === 'procedure' ? { kind } : {}),
        });
        await get().refreshList();
        set({ error: null });
        void get().openMap(map.id, localStorage.getItem('roadmap-name') ?? 'Anonymous');
      } catch (err) { set({ error: (err as Error).message }); }
    },

    async openMap(id, clientName) {
      try {
        const map = await mindmapApi.load(id);
        set({
          map, view: 'editor', dirty: false, error: null,
          camera: { x: 60, y: 60, scale: 1 },
          selectedNodeIds: [], selectedEdgeId: null, editingNodeId: null,
          undoStack: [], redoStack: [], peers: {},
          pendingRolePick: null, procedure: null, preview: null,
          procedureSent: null, procedurePublishedConflict: null,
          // Stored per map KIND so flipping one procedure map flips them all —
          // the theme is a "which tool am I in" signal, not a per-map setting.
          canvasTheme: (localStorage.getItem(`canvas-theme:${map.kind ?? 'roadmap'}`)
            ?? (map.kind === 'procedure' ? 'night' : 'day')) as 'day' | 'night',
        });
        if (map.kind === 'procedure') void get().validateProcedure();
        collab?.close();
        collab = new CollabClient(id, clientName, onCollabEvent, status => set({ collabStatus: status }));
        collab.connect();
        // Warm the dictionary so per-node lookups are instant in the inspector.
        void get().loadGlossary();
      } catch (err) { set({ error: (err as Error).message }); }
    },

    closeMap() {
      collab?.close();
      collab = null;
      set({ view: 'list', map: null, peers: {}, collabStatus: 'disconnected' });
      void get().refreshList();
    },

    async deleteMap(id) {
      try {
        await mindmapApi.remove(id);
        await get().refreshList();
      } catch (err) { set({ error: (err as Error).message }); }
    },

    setCamera: cam => set({ camera: cam }),

    select: (nodeId, additive = false) => set(s => ({
      selectedNodeIds: nodeId === null
        ? []
        : additive
          ? (s.selectedNodeIds.includes(nodeId)
              ? s.selectedNodeIds.filter(id => id !== nodeId)
              : [...s.selectedNodeIds, nodeId])
          : (s.selectedNodeIds.includes(nodeId) && s.selectedNodeIds.length > 1
              // Clicking a node that's part of a multi-selection keeps the group
              // (so a drag moves all of them) instead of collapsing to one.
              ? s.selectedNodeIds
              : [nodeId]),
      selectedEdgeId: null,
      selectedLaneId: null,
    })),

    selectEdge: edgeId => set({ selectedEdgeId: edgeId, selectedNodeIds: [], selectedLaneId: null }),
    selectLane: laneId => set({ selectedLaneId: laneId, selectedNodeIds: [], selectedEdgeId: null }),
    setEditing: nodeId => set({ editingNodeId: nodeId }),
    setDefaultNodeType: t => set({ defaultNodeType: t }),
    setPendingEdgeFrom: (nodeId, port) => set({ pendingEdgeFrom: nodeId, pendingEdgeFromPort: nodeId ? port ?? null : null }),

    addNode(x, y, type) {
      pushHistory();
      const node: MindmapNode = {
        id: crypto.randomUUID(),
        x: x - NODE_W / 2,
        y: y - NODE_H / 2,
        text: 'New node',
        type: type ?? get().defaultNodeType,
        metadata: {},
        updatedAt: Date.now(),
      };
      mutateGraph(m => m.nodes.push(node));
      collab?.send('node:add', node);
      set({ selectedNodeIds: [node.id], editingNodeId: node.id });
    },

    updateNodeText: (id, text) => patchNode(id, { text }),
    setNodeType: (id, type) => patchNode(id, { type }),
    setNodeStatus: (id, status) => patchNode(id, { status }),
    setNodeReview: (id, review) => patchNode(id, { review }),
    setNodeNotes: (id, notes) => patchNode(id, { notes: notes || undefined }),

    addComment(nodeId, text) {
      if (!text.trim()) return;
      const comment: MindmapComment = {
        id: crypto.randomUUID(),
        author: localStorage.getItem('roadmap-name')?.trim() || 'Anonymous',
        text: text.trim(),
        createdAt: Date.now(),
      };
      mutateGraph(m => {
        const i = m.nodes.findIndex(n => n.id === nodeId);
        if (i !== -1) m.nodes[i] = { ...m.nodes[i], comments: [...(m.nodes[i].comments ?? []), comment] };
      });
      collab?.send('comment:add', { nodeId, comment });
    },

    deleteComment(nodeId, commentId) {
      mutateGraph(m => {
        const i = m.nodes.findIndex(n => n.id === nodeId);
        if (i !== -1) {
          const remaining = (m.nodes[i].comments ?? []).filter(c => c.id !== commentId);
          m.nodes[i] = { ...m.nodes[i], comments: remaining.length ? remaining : undefined };
        }
      });
      collab?.send('comment:delete', { nodeId, commentId });
    },

    toggleMilestone(id) {
      const node = get().map?.nodes.find(n => n.id === id);
      if (node) patchNode(id, { milestone: !node.milestone || undefined });
    },

    moveNode(id, x, y, live) {
      // `live` drags skip history (one entry per drag, pushed on drag start by NodeView)
      let updated: MindmapNode | undefined;
      mutateGraph(m => {
        const i = m.nodes.findIndex(n => n.id === id);
        if (i !== -1) {
          m.nodes[i] = { ...m.nodes[i], x, y, updatedAt: Date.now() };
          updated = m.nodes[i];
        }
      });
      if (!updated) return;
      // Throttle live drag broadcasts to ~30 fps; always send the final position.
      const now = performance.now();
      if (!live || now - dragThrottle > 33) {
        dragThrottle = now;
        collab?.send('node:update', updated);
      }
    },

    addEdge(from, to, fromPort, toPort) {
      const { map } = get();
      if (!map) return;
      // Self-loops (from === to) are allowed; one connection per node pair
      // either way round, and one loop per node.
      if (map.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;

      // On a procedure map an edge has to mean something, so ask before
      // creating it. Committing an unroled edge would look connected on screen
      // while the compiler silently ignored it.
      if (map.kind === 'procedure') { set({ pendingRolePick: { from, to, fromPort, toPort } }); return; }

      pushHistory();
      const edge: MindmapEdge = {
        id: crypto.randomUUID(), from, to, type: 'directed', updatedAt: Date.now(),
        ...(fromPort ? { fromPort } : {}), ...(toPort ? { toPort } : {}),
      };
      mutateGraph(m => m.edges.push(edge));
      collab?.send('edge:add', edge);
    },

    confirmEdgeRole(role) {
      const pick = get().pendingRolePick;
      if (!pick) return;
      pushHistory();
      const edge: MindmapEdge = {
        id: crypto.randomUUID(),
        from: pick.from, to: pick.to,
        type: 'directed', role,
        updatedAt: Date.now(),
        ...(pick.fromPort ? { fromPort: pick.fromPort } : {}),
        ...(pick.toPort ? { toPort: pick.toPort } : {}),
      };
      mutateGraph(m => m.edges.push(edge));
      collab?.send('edge:add', edge);
      set({ pendingRolePick: null });
      void get().validateProcedure();
    },

    cancelEdgeRole: () => set({ pendingRolePick: null }),

    setEdgeRole(id, role) {
      patchEdge(id, { role });
      void get().validateProcedure();
    },

    async validateProcedure() {
      const map = get().map;
      if (!map || map.kind !== 'procedure') return;
      set({ procedureBusy: true });
      try {
        // Server-derived: the canvas must show the same step numbers the
        // compiler will emit, so it asks rather than deriving its own.
        const result = await mindmapApi.procedureValidate(map.id);
        set({ procedure: result, procedureBusy: false });
      } catch (err) {
        set({ procedureBusy: false, error: (err as Error).message });
      }
    },

    async sendToGuideLibrary(opts) {
      const map = get().map;
      if (!map || map.kind !== 'procedure') return;
      set({ procedureBusy: true, procedurePublishedConflict: null });
      try {
        const result = await mindmapApi.procedureExport(map.id, {
          anchorId:         opts.anchorId ?? map.anchorId ?? '',
          createdBy:        opts.createdBy,
          confirmUnpublish: opts.confirmUnpublish,
        });
        // Re-open the map so the provenance the server stamped onto the nodes
        // is reflected locally; without it the next send would duplicate steps.
        const fresh = await mindmapApi.load(map.id);
        set({ map: fresh, procedureSent: result, procedureBusy: false });
        void get().validateProcedure();
      } catch (err) {
        const message = (err as Error).message;
        // 409 — the target guide is published and may be in use right now.
        if (/published/i.test(message)) {
          set({ procedureBusy: false, procedurePublishedConflict: message });
        } else {
          set({ procedureBusy: false, error: message });
        }
      }
    },

    dismissProcedureSent: () => set({ procedureSent: null, procedurePublishedConflict: null }),

    toggleCanvasTheme() {
      const next = get().canvasTheme === 'night' ? 'day' : 'night';
      localStorage.setItem(`canvas-theme:${get().map?.kind ?? 'roadmap'}`, next);
      set({ canvasTheme: next });
    },

    patchStepMeta(nodeId, patch) {
      const node = get().map?.nodes.find(n => n.id === nodeId);
      if (!node) return;
      const prev = (node.metadata?.step as Record<string, unknown>) ?? {};
      const step = { ...prev, ...patch };
      // Drop cleared keys so metadata doesn't accumulate nulls.
      for (const k of Object.keys(step)) {
        if (step[k] === null || step[k] === undefined || step[k] === '') delete step[k];
      }
      patchNode(nodeId, { metadata: { ...node.metadata, step } });
      // Step content affects compile output (warnings, tts, media) — revalidate.
      void get().validateProcedure();
    },

    // ── Preview walkthrough ───────────────────────────────────────────────
    //
    // Traversal rules mirror the compiler + iOS runtime exactly:
    //   Complete → follow the `next` edge; none left → done.
    //   Failed   → follow the `failure` edge (button only shown when one exists).
    //   Arriving at a step with an incoming `requires` edge whose source has
    //   not been completed → blocked, offer a jump to the prerequisite (the
    //   on-device behaviour is the same redirect).
    // Divergence between this walk and the compiled guide is a bug in ONE of
    // them — keep both against docs/PROCEDURE-DESIGNER.md §sequencing.

    startPreview() {
      const { map, procedure } = get();
      if (!map || map.kind !== 'procedure' || !procedure?.order) return;
      const startId = Object.entries(procedure.order).find(([, seq]) => seq === 1)?.[0];
      if (!startId) return;
      set({ preview: { currentId: startId, visited: [], blockedBy: null, done: false } });
      get().jumpToNode(startId);
    },

    exitPreview: () => set({ preview: null }),

    previewGo(role) {
      const { map, preview } = get();
      if (!map || !preview || preview.done) return;
      const edge = map.edges.find(e => e.from === preview.currentId && e.role === role);
      const visited = [...preview.visited, preview.currentId];
      if (!edge) {
        // Only reachable for 'next' (the Failed button requires an edge).
        set({ preview: { ...preview, visited, done: true, blockedBy: null } });
        return;
      }
      // Requires gate on the target: prerequisite must already be completed.
      const unmet = map.edges.find(e =>
        e.role === 'requires' && e.to === edge.to && !visited.includes(e.from));
      set({
        preview: {
          currentId: edge.to,
          visited,
          blockedBy: unmet ? unmet.from : null,
          done: false,
        },
      });
      get().jumpToNode(edge.to);
    },

    previewJumpToRequired() {
      const { preview } = get();
      if (!preview?.blockedBy) return;
      // The operator is redirected to the prerequisite; on completing it they
      // come back — modelled here by simply making it the current step (its
      // `next` chain leads back through the flow).
      set({ preview: { ...preview, currentId: preview.blockedBy, blockedBy: null } });
      get().jumpToNode(preview.blockedBy);
    },

    toggleEdgeType(id) {
      const edge = get().map?.edges.find(e => e.id === id);
      if (edge) patchEdge(id, { type: edge.type === 'directed' ? 'undirected' : 'directed' });
    },

    setEdgeLabel: (id, label) => patchEdge(id, { label: label.trim() || undefined }),

    moveNodes(positions, live) {
      const updates: MindmapNode[] = [];
      mutateGraph(m => {
        for (const p of positions) {
          const i = m.nodes.findIndex(n => n.id === p.id);
          if (i !== -1) {
            m.nodes[i] = { ...m.nodes[i], x: p.x, y: p.y, updatedAt: Date.now() };
            updates.push(m.nodes[i]);
          }
        }
      });
      const now = performance.now();
      if (!live || now - dragThrottle > 33) {
        dragThrottle = now;
        for (const n of updates) collab?.send('node:update', n);
      }
      if (get().layoutMode !== 'freeform') set({ layoutMode: 'freeform' });
    },

    deleteSelection() {
      const { selectedNodeIds, selectedEdgeId, map } = get();
      if (!map || (selectedNodeIds.length === 0 && !selectedEdgeId)) return;
      pushHistory();

      if (selectedEdgeId) {
        mutateGraph(m => { m.edges = m.edges.filter(e => e.id !== selectedEdgeId); });
        collab?.send('edge:delete', { id: selectedEdgeId });
      }
      for (const id of selectedNodeIds) {
        mutateGraph(m => {
          m.nodes = m.nodes.filter(n => n.id !== id);
          m.edges = m.edges.filter(e => e.from !== id && e.to !== id);
          // Cascade group memberships (server does the same on node:delete).
          if (m.groups?.some(g => g.nodeIds.includes(id))) {
            m.groups = m.groups.map(g =>
              g.nodeIds.includes(id) ? { ...g, nodeIds: g.nodeIds.filter(n => n !== id) } : g,
            );
          }
        });
        collab?.send('node:delete', { id });
      }
      set({ selectedNodeIds: [], selectedEdgeId: null, editingNodeId: null });
    },

    // ── Groups ───────────────────────────────────────────────────────────

    setGroups(groups) {
      pushHistory();
      mutateGraph(m => { m.groups = groups; });
      collab?.send('map:groups', { groups });
    },

    createGroupFromSelection(name) {
      const { map, selectedNodeIds } = get();
      if (!map || selectedNodeIds.length === 0 || !name.trim()) return;
      const group: MindmapGroup = {
        id: crypto.randomUUID(),
        name: name.trim(),
        nodeIds: [...selectedNodeIds],
      };
      get().setGroups([...(map.groups ?? []), group]);
      // Immediately filter to the new group so the user sees what they made.
      set(s => ({
        filters: { ...s.filters, groupIds: [group.id] },
        showFilterPanel: true,
        statusMessage: `Group "${group.name}" (${group.nodeIds.length} nodes)`,
      }));
    },

    renameGroup(id, name) {
      if (!name.trim()) return;
      get().setGroups((get().map?.groups ?? []).map(g => g.id === id ? { ...g, name: name.trim() } : g));
    },

    deleteGroup(id) {
      get().setGroups((get().map?.groups ?? []).filter(g => g.id !== id));
      set(s => ({ filters: { ...s.filters, groupIds: s.filters.groupIds.filter(g => g !== id) } }));
    },

    // ── View filters (per-client) ────────────────────────────────────────

    toggleTypeFilter: t => set(s => ({
      filters: {
        ...s.filters,
        types: s.filters.types.includes(t)
          ? s.filters.types.filter(x => x !== t)
          : [...s.filters.types, t],
      },
    })),

    toggleStatusFilter: st => set(s => ({
      filters: {
        ...s.filters,
        statuses: s.filters.statuses.includes(st)
          ? s.filters.statuses.filter(x => x !== st)
          : [...s.filters.statuses, st],
      },
    })),

    toggleGroupFilter: id => set(s => ({
      filters: {
        ...s.filters,
        groupIds: s.filters.groupIds.includes(id)
          ? s.filters.groupIds.filter(x => x !== id)
          : [...s.filters.groupIds, id],
      },
    })),

    clearFilters: () => set({ filters: EMPTY_FILTERS }),
    setShowFilterPanel: v => set({ showFilterPanel: v }),

    // ── Style settings (map-level, synced, no undo entry — it's cosmetic) ─

    updateSettings(patch) {
      const { map } = get();
      if (!map) return;
      const settings: MindmapSettings = { ...map.settings, ...patch };
      // Defaults stay implicit — drop keys set back to their default value.
      // edgeStyle: default flipped to 'curved' in 2026.4.45, so 'straight'
      // is the explicit, persisted choice now.
      if (settings.edgeColor !== 'neutral') delete settings.edgeColor;
      if (settings.edgeStyle !== 'straight' && settings.edgeStyle !== 'curved') delete settings.edgeStyle;
      mutateGraph(m => { m.settings = settings; });
      collab?.send('map:settings', { settings });
    },

    // ── Publish workflow ─────────────────────────────────────────────────

    holdsDraftKey() {
      const { map } = get();
      return !!map && !!getDraftKey(map.id);
    },

    async publishMap() {
      const { map } = get();
      if (!map) return;
      try {
        const updated = await mindmapApi.publish(map.id);
        set({ map: { ...map, published: updated.published }, statusMessage: 'Published — visible to everyone', error: null });
        void get().refreshList();
      } catch (err) { set({ error: (err as Error).message }); }
    },

    async unpublishMap() {
      const { map } = get();
      if (!map) return;
      try {
        const updated = await mindmapApi.unpublish(map.id);
        set({ map: { ...map, published: updated.published }, statusMessage: 'Unpublished — draft-key holders only', error: null });
        void get().refreshList();
      } catch (err) { set({ error: (err as Error).message }); }
    },

    // ── Dictionary ───────────────────────────────────────────────────────

    async loadGlossary() {
      // Cache only a SUCCESSFUL load — an empty/failed result retries on the
      // next open instead of sticking for the whole session.
      const existing = get().glossary;
      if (existing && existing.entries.length > 0) return;
      try {
        const { markdown } = await mindmapApi.glossary();
        set({ glossary: parseGlossary(markdown) });
      } catch {
        // Missing glossary is non-fatal — the 📖 panel shows a note.
        set({ glossary: { sections: [], entries: [] } });
      }
    },

    openGlossary(term) {
      set({ showGlossary: true, glossaryFocusTerm: term ?? null, showFilterPanel: false });
      void get().loadGlossary();
    },

    closeGlossary: () => set({ showGlossary: false, glossaryFocusTerm: null }),

    // ── Whiteboard / screenshot import ───────────────────────────────────

    async importFromImage(file) {
      set({ importingImage: true, error: null, imagePreview: null });
      try {
        const { base64, mimeType } = await fileToDownscaledBase64(file);
        const result = await mindmapApi.importImage(base64, mimeType);
        if (result.nodes.length === 0) {
          set({ error: 'No diagram found in that image — try a clearer photo.', importingImage: false });
          return;
        }
        set({ imagePreview: result, importingImage: false });
      } catch (err) {
        set({ error: (err as Error).message, importingImage: false });
      }
    },

    discardImagePreview: () => set({ imagePreview: null }),

    async createFromImagePreview(name) {
      const preview = get().imagePreview;
      if (!preview) return;
      try {
        const saved = await mindmapApi.save({
          name: name.trim() || preview.name,
          nodes: preview.nodes,
          edges: preview.edges,
          lanes: preview.lanes,
          versionLabel: `imported from image (${preview.model})`,
        });
        set({ imagePreview: null, statusMessage: `Created draft "${saved.name}"` });
        await get().refreshList();
      } catch (err) { set({ error: (err as Error).message }); }
    },

    async unlockDraft(draftKey) {
      try {
        const { summary } = await mindmapApi.unlock(draftKey.trim());
        await get().refreshList();
        set({ statusMessage: `Unlocked draft "${summary.name}"`, error: null });
      } catch (err) { set({ error: (err as Error).message }); }
    },

    // ── Rich nodes + collapse ────────────────────────────────────────────

    toggleCollapse(id) {
      const node = get().map?.nodes.find(n => n.id === id);
      if (node) patchNode(id, { collapsed: !node.collapsed || undefined });
    },

    setNodeIcon: (id, icon) => patchNode(id, { icon }),
    setNodeShape: (id, shape) => patchNode(id, { shape: shape === 'rounded' ? undefined : shape }),
    setNodeLink(id, link) {
      const trimmed = link?.trim();
      if (trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
        set({ error: 'Links must start with http:// or https://' });
        return;
      }
      patchNode(id, { link: trimmed || undefined });
    },

    // ── Presentation mode ────────────────────────────────────────────────

    startPresentation() {
      const { map } = get();
      if (!map) return;
      const steps = computeSteps(map);
      set({
        presentation: { active: true, step: 0, steps },
        selectedNodeIds: [], selectedEdgeId: null, selectedLaneId: null,
        editingNodeId: null, showFilterPanel: false,
      });
      get().presentationGoto(0);
    },

    exitPresentation() {
      set({ presentation: { active: false, step: 0, steps: [] } });
      get().fitView();
    },

    presentationGoto(step) {
      const { map, presentation } = get();
      if (!map || presentation.steps.length === 0) return;
      const clamped = Math.max(0, Math.min(presentation.steps.length - 1, step));
      const bounds = stepBounds(map, presentation.steps[clamped]);
      if (bounds) {
        const pad = 90;
        const vw = window.innerWidth, vh = window.innerHeight - 90;
        const w = bounds.maxX - bounds.minX + pad * 2;
        const h = bounds.maxY - bounds.minY + pad * 2;
        const scale = Math.min(1.6, Math.max(0.15, Math.min(vw / w, vh / h)));
        set({
          camera: {
            scale,
            x: (vw - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale,
            y: (vh - (bounds.maxY - bounds.minY) * scale) / 2 - bounds.minY * scale + 30,
          },
        });
      }
      set(s => ({ presentation: { ...s.presentation, step: clamped } }));
    },

    // ── Lanes ────────────────────────────────────────────────────────────

    setLanes(lanes, withHistory = true) {
      if (withHistory) pushHistory();
      mutateGraph(m => { m.lanes = lanes; });
      collab?.send('map:lanes', { lanes });
    },

    addLanePreset() {
      const { map } = get();
      if (!map) return;
      // Span the current content (or a sensible default) with Now / Next / Later.
      const xs = map.nodes.map(n => n.x);
      const startX = xs.length ? Math.min(...xs) - 40 : 40;
      const total = Math.max(xs.length ? Math.max(...xs) + NODE_W + 40 - startX : 0, 1200);
      const w = Math.ceil(total / 3);
      get().setLanes([
        { id: crypto.randomUUID(), name: 'Now', x: startX, width: w },
        { id: crypto.randomUUID(), name: 'Next', x: startX + w, width: w },
        { id: crypto.randomUUID(), name: 'Later', x: startX + 2 * w, width: w },
      ]);
    },

    addRowLanePreset() {
      const { map } = get();
      if (!map) return;
      // Horizontal Why / What / How bands spanning the current content height.
      const ys = map.nodes.map(n => n.y);
      const startY = ys.length ? Math.min(...ys) - 40 : 40;
      const total = Math.max(ys.length ? Math.max(...ys) + NODE_H + 40 - startY : 0, 720);
      const h = Math.ceil(total / 3);
      const columns = (map.lanes ?? []).filter(l => l.orientation !== 'row');
      get().setLanes([
        ...columns,
        { id: crypto.randomUUID(), name: 'Why', x: startY, width: h, orientation: 'row' },
        { id: crypto.randomUUID(), name: 'What', x: startY + h, width: h, orientation: 'row' },
        { id: crypto.randomUUID(), name: 'How', x: startY + 2 * h, width: h, orientation: 'row' },
      ]);
    },

    addLane() {
      const { map } = get();
      if (!map) return;
      const lanes = map.lanes ?? [];
      const columns = lanes.filter(l => l.orientation !== 'row');
      const last = columns[columns.length - 1];
      const x = last ? last.x + last.width : 40;
      get().setLanes([...lanes, { id: crypto.randomUUID(), name: `Lane ${columns.length + 1}`, x, width: 400 }]);
    },

    fitView() {
      const { map } = get();
      if (!map || map.nodes.length === 0) return;
      const pad = 80;
      const minX = Math.min(...map.nodes.map(n => n.x)) - pad;
      const minY = Math.min(...map.nodes.map(n => n.y)) - pad;
      const maxX = Math.max(...map.nodes.map(n => n.x)) + NODE_W + pad;
      const maxY = Math.max(...map.nodes.map(n => n.y + nodeHeight(n))) + pad;
      const vw = window.innerWidth, vh = window.innerHeight - 120;   // minus chrome
      const scale = Math.min(2, Math.max(0.15, Math.min(vw / (maxX - minX), vh / (maxY - minY))));
      set({
        camera: {
          scale,
          x: (vw - (maxX - minX) * scale) / 2 - minX * scale,
          y: (vh - (maxY - minY) * scale) / 2 - minY * scale + 60,
        },
      });
    },

    async importMapFromJson(raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<Mindmap>;
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error('Not a mind-map export: missing nodes/edges arrays');
        }
        const name = typeof parsed.name === 'string' && parsed.name.trim()
          ? `${parsed.name.trim()} (imported)`
          : 'Imported map';
        // New id on this server — an export from Render becomes a fresh map here.
        // kind/anchorId MUST travel with the import: kind is create-only, and
        // dropping it here silently demoted procedure maps to plain roadmaps on
        // the destination server (no role picker, no procedure bar) — found
        // when moving maps between Render and an internal deploy.
        const saved = await mindmapApi.save({
          name,
          nodes: parsed.nodes,
          edges: parsed.edges,
          lanes: parsed.lanes ?? [],
          groups: parsed.groups ?? [],
          settings: parsed.settings,
          ...(parsed.kind && { kind: parsed.kind }),
          ...(parsed.anchorId && { anchorId: parsed.anchorId }),
          versionLabel: 'imported from JSON',
        });
        await get().refreshList();
        set({ statusMessage: `Imported "${saved.name}"`, error: null });
      } catch (err) { set({ error: `Import failed: ${(err as Error).message}` }); }
    },

    updateLane(id, patch) {
      const lanes = (get().map?.lanes ?? []).map(l => l.id === id ? { ...l, ...patch, id: l.id } : l);
      get().setLanes(lanes);
    },

    removeLane(id) {
      get().setLanes((get().map?.lanes ?? []).filter(l => l.id !== id));
      set({ selectedLaneId: null });
    },

    // ── Clipboard / duplicate ────────────────────────────────────────────

    copySelection() {
      const { map, selectedNodeIds } = get();
      if (!map || selectedNodeIds.length === 0) return;
      const ids = new Set(selectedNodeIds);
      clipboard = {
        nodes: structuredClone(map.nodes.filter(n => ids.has(n.id))),
        edges: structuredClone(map.edges.filter(e => ids.has(e.from) && ids.has(e.to))),
      };
      set({ statusMessage: `Copied ${clipboard.nodes.length} node(s)` });
    },

    pasteClipboard() {
      if (!clipboard || clipboard.nodes.length === 0) return;
      pushHistory();
      // Re-id everything; keep internal edges wired to the new ids.
      const idMap = new Map(clipboard.nodes.map(n => [n.id, crypto.randomUUID()]));
      // Offset so the paste lands at the cursor (anchored on the copied group's top-left).
      const minX = Math.min(...clipboard.nodes.map(n => n.x));
      const minY = Math.min(...clipboard.nodes.map(n => n.y));
      const dx = lastMouseWorld.x - minX;
      const dy = lastMouseWorld.y - minY;
      const now = Date.now();

      const newNodes: MindmapNode[] = clipboard.nodes.map(n => ({
        ...n, id: idMap.get(n.id)!, x: n.x + dx, y: n.y + dy, updatedAt: now,
        metadata: { ...n.metadata },
      }));
      const newEdges: MindmapEdge[] = clipboard.edges.map(e => ({
        ...e, id: crypto.randomUUID(), from: idMap.get(e.from)!, to: idMap.get(e.to)!, updatedAt: now,
      }));

      mutateGraph(m => { m.nodes.push(...newNodes); m.edges.push(...newEdges); });
      for (const n of newNodes) collab?.send('node:add', n);
      for (const e of newEdges) collab?.send('edge:add', e);
      set({ selectedNodeIds: newNodes.map(n => n.id), selectedEdgeId: null });
    },

    duplicateSelection() {
      get().copySelection();
      // Nudge the paste target so duplicates don't sit exactly on the originals.
      lastMouseWorld = { x: lastMouseWorld.x + 24, y: lastMouseWorld.y + 24 };
      const { map, selectedNodeIds } = get();
      if (map && selectedNodeIds.length > 0) {
        const first = map.nodes.find(n => n.id === selectedNodeIds[0]);
        if (first) lastMouseWorld = { x: first.x + 24, y: first.y + 24 };
      }
      get().pasteClipboard();
    },

    // ── Search ───────────────────────────────────────────────────────────

    setSearchQuery: q => set({ searchQuery: q }),

    jumpToNode(id) {
      const { map, camera } = get();
      const node = map?.nodes.find(n => n.id === id);
      if (!node) return;
      // Center the node in the viewport at the current zoom.
      const vw = window.innerWidth, vh = window.innerHeight;
      set({
        camera: {
          scale: camera.scale,
          x: vw / 2 - (node.x + NODE_W / 2) * camera.scale,
          y: vh / 2 - (node.y + nodeHeight(node) / 2) * camera.scale,
        },
        selectedNodeIds: [id],
        selectedEdgeId: null,
        searchQuery: '',
      });
    },

    // ── SIB bridge ───────────────────────────────────────────────────────

    async importFromSib() {
      const { map } = get();
      if (!map) return;
      try {
        const result = await mindmapApi.importSib(map.id);
        // Server broadcasts map:sync to this client too; set directly in case
        // the WS is momentarily down.
        set({
          map: result.map,
          dirty: false,
          statusMessage: result.addedNodes || result.addedEdges
            ? `SIB import: +${result.addedNodes} nodes, +${result.addedEdges} edges`
            : 'SIB import: already up to date',
          error: null,
        });
      } catch (err) { set({ error: (err as Error).message }); }
    },

    applyAutoLayout(mode) {
      const { map } = get();
      if (!map) return;
      pushHistory();
      const laidOut = autoLayout(map, mode).map(n => ({ ...n, updatedAt: Date.now() }));
      mutateGraph(m => { m.nodes = laidOut; });
      for (const n of laidOut) collab?.send('node:update', n);
      set({ layoutMode: mode });
    },

    undo() {
      const { undoStack, map } = get();
      if (!map || undoStack.length === 0) return;
      const entry = undoStack[undoStack.length - 1];
      const current: HistoryEntry = {
        nodes: structuredClone(map.nodes),
        edges: structuredClone(map.edges),
        lanes: map.lanes ? structuredClone(map.lanes) : undefined,
        groups: map.groups ? structuredClone(map.groups) : undefined,
      };
      set({
        undoStack: undoStack.slice(0, -1),
        redoStack: [...get().redoStack, current],
        map: { ...map, nodes: entry.nodes, edges: entry.edges, lanes: entry.lanes, groups: entry.groups, updatedAt: Date.now() },
        dirty: true,
      });
      // Undo/redo re-syncs peers via a full REST save (server broadcasts map:sync).
      void get().save('undo');
    },

    redo() {
      const { redoStack, map } = get();
      if (!map || redoStack.length === 0) return;
      const entry = redoStack[redoStack.length - 1];
      const current: HistoryEntry = {
        nodes: structuredClone(map.nodes),
        edges: structuredClone(map.edges),
        lanes: map.lanes ? structuredClone(map.lanes) : undefined,
        groups: map.groups ? structuredClone(map.groups) : undefined,
      };
      set({
        redoStack: redoStack.slice(0, -1),
        undoStack: [...get().undoStack, current],
        map: { ...map, nodes: entry.nodes, edges: entry.edges, lanes: entry.lanes, groups: entry.groups, updatedAt: Date.now() },
        dirty: true,
      });
      void get().save('redo');
    },

    async save(label = 'manual save') {
      const { map } = get();
      if (!map) return;
      try {
        const saved = await mindmapApi.save({
          id: map.id, name: map.name, nodes: map.nodes, edges: map.edges,
          lanes: map.lanes ?? [], groups: map.groups ?? [],
          settings: map.settings, versionLabel: label,
        });
        set({ map: saved, dirty: false, statusMessage: `Saved ${new Date().toLocaleTimeString()}`, error: null });
      } catch (err) { set({ error: (err as Error).message }); }
    },

    async restoreVersion(versionId) {
      const { map } = get();
      if (!map) return;
      try {
        pushHistory();
        const restored = await mindmapApi.restore(map.id, versionId);
        set({ map: restored, dirty: false, error: null });
      } catch (err) { set({ error: (err as Error).message }); }
    },

    sendCursor(x, y, draggingNodeId) {
      const now = performance.now();
      if (now - cursorThrottle > 50) {   // ≤20 cursor frames/sec on the wire
        cursorThrottle = now;
        collab?.send('cursor:move', { x, y, draggingNodeId } satisfies CursorPayload);
      }
    },

    setError: message => set({ error: message }),
  };
});
