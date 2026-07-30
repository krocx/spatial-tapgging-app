// mindmap.ws.ts — real-time collaboration channel for the Roadmap Mind-Mapper.
//
// Native `ws` (no Socket.IO — minimal deps, per SIB preferences), attached to
// the existing HTTP(S) server via the `upgrade` event on path /mindmap/ws.
//
// Protocol (all frames are JSON MindmapWsEvent):
//   client → server: node:add|update|delete, edge:add|delete, map:rename, cursor:move
//   server → client: same events re-broadcast to the room (sender excluded),
//                    plus map:sync (full graph on join / REST save / restore),
//                    session:join / session:leave (presence + peer list).
//
// Conflict resolution: last-write-wins per entity via applyGraphEvent().
// Persistence: mutations are applied to the store immediately (in-memory) and
// flushed to disk on a short debounce so a burst of drags is one file write.
//
// Auth: mirrors apiKeyAuth — when SIB_API_KEY is set, clients must supply the
// key as ?key=... (browsers can't set headers on WebSocket connects).

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import type { Mindmap, MindmapWsEvent } from '@spatial/shared';
import { mindmapStore, applyGraphEvent, snapshotVersion } from '../models/mindmap.model.js';

interface Client {
  id: string;
  name: string;
  mapId: string;
  socket: WebSocket;
  alive: boolean;
}

const rooms = new Map<string, Set<Client>>();          // mapId → clients
const flushTimers = new Map<string, NodeJS.Timeout>(); // mapId → debounce
const dirtySince = new Map<string, number>();          // mapId → first unflushed mutation

const FLUSH_DEBOUNCE_MS = 800;
/** Auto-snapshot a version if collaborative edits have run this long unflagged. */
const AUTO_SNAPSHOT_MS = 5 * 60_000;
const lastSnapshotAt = new Map<string, number>();

let wss: WebSocketServer | null = null;

export function attachMindmapWs(server: HttpServer): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/mindmap/ws') return; // let other upgrade handlers (none today) pass

    // --- Auth (same env contract as apiKeyAuth) ---
    const expectedKey = process.env.SIB_API_KEY?.trim();
    const provided = url.searchParams.get('key') ?? (req.headers['x-api-key'] as string | undefined);
    if (expectedKey && provided !== expectedKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const mapId = url.searchParams.get('mapId');
    if (!mapId || !mindmapStore.findById(mapId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const clientName = (url.searchParams.get('name') ?? 'Anonymous').slice(0, 40);
    wss!.handleUpgrade(req, socket, head, ws => {
      handleConnection(ws, mapId, clientName);
    });
  });

  // Heartbeat — drop dead connections so presence lists stay accurate.
  setInterval(() => {
    for (const room of rooms.values()) {
      for (const client of room) {
        if (!client.alive) { client.socket.terminate(); continue; }
        client.alive = false;
        client.socket.ping();
      }
    }
  }, 30_000).unref();

  console.log('[mindmap.ws] Collaboration channel attached at /mindmap/ws');
}

function handleConnection(socket: WebSocket, mapId: string, clientName: string): void {
  const client: Client = { id: uuidv4(), name: clientName, mapId, socket, alive: true };
  const room = rooms.get(mapId) ?? new Set<Client>();
  room.add(client);
  rooms.set(mapId, room);

  socket.on('pong', () => { client.alive = true; });

  // 1. Full state sync to the joining client.
  const map = mindmapStore.findById(mapId);
  send(client, { type: 'map:sync', mapId, ts: Date.now(), payload: { map } });

  // 2. Presence: tell everyone (including the joiner) who is in the room.
  broadcastPresence(mapId, 'session:join', client);

  socket.on('message', raw => {
    let event: MindmapWsEvent;
    try { event = JSON.parse(String(raw)) as MindmapWsEvent; }
    catch { return send(client, errorEvent(mapId, 'Malformed JSON frame')); }

    if (!event || typeof event.type !== 'string') return;
    event.mapId = mapId;              // clients can't write into other rooms
    event.clientId = client.id;
    event.clientName = client.name;
    if (typeof event.ts !== 'number') event.ts = Date.now();

    // Cursor traffic: ephemeral — relay to peers, never persisted.
    if (event.type === 'cursor:move') {
      return broadcast(mapId, event, client.id);
    }

    // Graph mutations: apply (LWW) → persist (debounced) → relay.
    const current = mindmapStore.findById(mapId);
    if (!current) return send(client, errorEvent(mapId, 'Map no longer exists'));

    const next = applyGraphEvent(current, event);
    if (!next) return;                // stale or invalid — silently dropped

    mindmapStore.save(next);          // JsonFileStore flushes synchronously — cheap at this scale
    scheduleAutoSnapshot(next);
    broadcast(mapId, event, client.id);
  });

  socket.on('close', () => {
    room.delete(client);
    if (room.size === 0) {
      rooms.delete(mapId);
      // Last collaborator left — snapshot the session's end state.
      const finalMap = mindmapStore.findById(mapId);
      if (finalMap && dirtySince.has(mapId)) {
        snapshotVersion(finalMap, 'collab session end');
        dirtySince.delete(mapId);
      }
    } else {
      broadcastPresence(mapId, 'session:leave', client);
    }
  });

  socket.on('error', () => socket.terminate());
}

// ── Broadcast helpers ──────────────────────────────────────────────────────

function send(client: Client, event: MindmapWsEvent): void {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(event));
  }
}

function broadcast(mapId: string, event: MindmapWsEvent, excludeClientId?: string): void {
  const room = rooms.get(mapId);
  if (!room) return;
  const frame = JSON.stringify(event);
  for (const c of room) {
    if (c.id === excludeClientId) continue;
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(frame);
  }
}

function broadcastPresence(mapId: string, type: 'session:join' | 'session:leave', subject: Client): void {
  const room = rooms.get(mapId);
  const peers = [...(room ?? [])].map(c => ({ clientId: c.id, clientName: c.name }));
  broadcast(mapId, {
    type,
    mapId,
    clientId: subject.id,
    clientName: subject.name,
    ts: Date.now(),
    payload: { clientId: subject.id, clientName: subject.name, peers },
  });
}

/** Push a full re-sync to all collaborators (used after REST save / restore). */
export function broadcastMapSync(map: Mindmap): void {
  broadcast(map.id, { type: 'map:sync', mapId: map.id, ts: Date.now(), payload: { map } });
}

function errorEvent(mapId: string, message: string): MindmapWsEvent {
  return { type: 'error', mapId, ts: Date.now(), payload: { message } };
}

// ── Auto-snapshot during long collaborative sessions ───────────────────────

function scheduleAutoSnapshot(map: Mindmap): void {
  if (!dirtySince.has(map.id)) dirtySince.set(map.id, Date.now());

  const last = lastSnapshotAt.get(map.id) ?? 0;
  if (Date.now() - last < AUTO_SNAPSHOT_MS) return;
  lastSnapshotAt.set(map.id, Date.now());

  // Debounce so the snapshot captures the tail of an edit burst.
  clearTimeout(flushTimers.get(map.id));
  const timer = setTimeout(() => {
    const current = mindmapStore.findById(map.id);
    if (current) snapshotVersion(current, 'auto snapshot');
  }, FLUSH_DEBOUNCE_MS);
  timer.unref();
  flushTimers.set(map.id, timer);
}
