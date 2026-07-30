// store.ts — Zustand store: all business logic for the mind-map editor.
// Components stay presentational; every mutation flows through an action here
// so local state, the undo stack, and the collaboration channel never diverge.
//
// Collaboration model: optimistic local apply → WS event to peers → server
// persists (LWW). Remote events apply through the same reducers minus the echo.

import { create } from 'zustand';
import type {
  Mindmap, MindmapNode, MindmapEdge, MindmapNodeType, MindmapSummary,
  MindmapWsEvent, MapSyncPayload, CursorPayload, PresencePayload,
} from '@spatial/shared';
import { mindmapApi } from '../api/mindmap-api.js';
import { CollabClient, type CollabStatus } from '../ws/collab.js';
import { autoLayout, type LayoutMode } from '../utils/layout.js';
import { NODE_W, NODE_H } from '../utils/geometry.js';

export interface Peer {
  clientId: string;
  clientName: string;
  x: number;
  y: number;
  draggingNodeId?: string;
  lastSeen: number;
}

export interface Camera { x: number; y: number; scale: number; }

interface HistoryEntry { nodes: MindmapNode[]; edges: MindmapEdge[]; }

const HISTORY_LIMIT = 100;
let collab: CollabClient | null = null;   // socket lives outside the store
let cursorThrottle = 0;                   // cursor:move rate limit
let dragThrottle = 0;                     // node:update rate limit during drags

interface State {
  // navigation
  view: 'list' | 'editor';
  maps: MindmapSummary[];
  map: Mindmap | null;
  // editor
  camera: Camera;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  editingNodeId: string | null;
  pendingEdgeFrom: string | null;      // node id while dragging a new connection
  defaultNodeType: MindmapNodeType;
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
  createMap(name: string): Promise<void>;
  openMap(id: string, clientName: string): Promise<void>;
  closeMap(): void;
  deleteMap(id: string): Promise<void>;

  setCamera(cam: Camera): void;
  select(nodeId: string | null, additive?: boolean): void;
  selectEdge(edgeId: string | null): void;
  setEditing(nodeId: string | null): void;
  setDefaultNodeType(t: MindmapNodeType): void;
  setPendingEdgeFrom(nodeId: string | null): void;

  addNode(x: number, y: number, type?: MindmapNodeType): void;
  updateNodeText(id: string, text: string): void;
  setNodeType(id: string, type: MindmapNodeType): void;
  moveNode(id: string, x: number, y: number, live: boolean): void;
  addEdge(from: string, to: string): void;
  toggleEdgeType(id: string): void;
  deleteSelection(): void;

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
    const entry: HistoryEntry = { nodes: structuredClone(map.nodes), edges: structuredClone(map.edges) };
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

  /** Apply a remote (peer / server) event to local state. */
  function onCollabEvent(event: MindmapWsEvent): void {
    const { map } = get();
    switch (event.type) {
      case 'map:sync': {
        const synced = (event.payload as MapSyncPayload).map;
        if (synced) set({ map: synced, dirty: false });
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
    editingNodeId: null,
    pendingEdgeFrom: null,
    defaultNodeType: 'generic',
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

    async createMap(name) {
      try {
        const map = await mindmapApi.save({ name, nodes: [], edges: [], versionLabel: 'created' });
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
        });
        collab?.close();
        collab = new CollabClient(id, clientName, onCollabEvent, status => set({ collabStatus: status }));
        collab.connect();
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
          : [nodeId],
      selectedEdgeId: null,
    })),

    selectEdge: edgeId => set({ selectedEdgeId: edgeId, selectedNodeIds: [] }),
    setEditing: nodeId => set({ editingNodeId: nodeId }),
    setDefaultNodeType: t => set({ defaultNodeType: t }),
    setPendingEdgeFrom: nodeId => set({ pendingEdgeFrom: nodeId }),

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

    updateNodeText(id, text) {
      pushHistory();
      let updated: MindmapNode | undefined;
      mutateGraph(m => {
        const i = m.nodes.findIndex(n => n.id === id);
        if (i !== -1) {
          m.nodes[i] = { ...m.nodes[i], text, updatedAt: Date.now() };
          updated = m.nodes[i];
        }
      });
      if (updated) collab?.send('node:update', updated);
    },

    setNodeType(id, type) {
      pushHistory();
      let updated: MindmapNode | undefined;
      mutateGraph(m => {
        const i = m.nodes.findIndex(n => n.id === id);
        if (i !== -1) {
          m.nodes[i] = { ...m.nodes[i], type, updatedAt: Date.now() };
          updated = m.nodes[i];
        }
      });
      if (updated) collab?.send('node:update', updated);
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

    addEdge(from, to) {
      const { map } = get();
      if (!map || from === to) return;
      if (map.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
      pushHistory();
      const edge: MindmapEdge = { id: crypto.randomUUID(), from, to, type: 'directed', updatedAt: Date.now() };
      mutateGraph(m => m.edges.push(edge));
      collab?.send('edge:add', edge);
    },

    toggleEdgeType(id) {
      pushHistory();
      let removed = false;
      let added: MindmapEdge | undefined;
      mutateGraph(m => {
        const i = m.edges.findIndex(e => e.id === id);
        if (i !== -1) {
          removed = true;
          added = { ...m.edges[i], type: m.edges[i].type === 'directed' ? 'undirected' : 'directed', updatedAt: Date.now() };
          m.edges[i] = added;
        }
      });
      // Edge type change = delete + re-add on the wire (server has no edge:update).
      if (removed && added) {
        collab?.send('edge:delete', { id });
        collab?.send('edge:add', added);
      }
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
        });
        collab?.send('node:delete', { id });
      }
      set({ selectedNodeIds: [], selectedEdgeId: null, editingNodeId: null });
    },

    applyAutoLayout(mode) {
      const { map } = get();
      if (!map) return;
      pushHistory();
      const laidOut = autoLayout(map, mode).map(n => ({ ...n, updatedAt: Date.now() }));
      mutateGraph(m => { m.nodes = laidOut; });
      for (const n of laidOut) collab?.send('node:update', n);
    },

    undo() {
      const { undoStack, map } = get();
      if (!map || undoStack.length === 0) return;
      const entry = undoStack[undoStack.length - 1];
      const current: HistoryEntry = { nodes: structuredClone(map.nodes), edges: structuredClone(map.edges) };
      set({
        undoStack: undoStack.slice(0, -1),
        redoStack: [...get().redoStack, current],
        map: { ...map, nodes: entry.nodes, edges: entry.edges, updatedAt: Date.now() },
        dirty: true,
      });
      // Undo/redo re-syncs peers via a full REST save (server broadcasts map:sync).
      void get().save('undo');
    },

    redo() {
      const { redoStack, map } = get();
      if (!map || redoStack.length === 0) return;
      const entry = redoStack[redoStack.length - 1];
      const current: HistoryEntry = { nodes: structuredClone(map.nodes), edges: structuredClone(map.edges) };
      set({
        redoStack: redoStack.slice(0, -1),
        undoStack: [...get().undoStack, current],
        map: { ...map, nodes: entry.nodes, edges: entry.edges, updatedAt: Date.now() },
        dirty: true,
      });
      void get().save('redo');
    },

    async save(label = 'manual save') {
      const { map } = get();
      if (!map) return;
      try {
        const saved = await mindmapApi.save({
          id: map.id, name: map.name, nodes: map.nodes, edges: map.edges, versionLabel: label,
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
