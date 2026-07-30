# Roadmap Mind-Mapper — SIB-Hosted Collaborative Mind-Mapping

A secure, collaborative mind-mapping tool hosted entirely on the SIB server — no Azure, no external SaaS, no cloud dependencies. Served at **`/roadmap`** (same model as `/portal`), API under **`/mindmap/*`**, real-time collaboration over a native WebSocket at **`/mindmap/ws`**.

It serves as a roadmap designer, a graph editor for the SIB ontology, a workflow designer for AR clients, and a visual reasoning canvas for perception → semantic → action pipelines.

## Architecture Overview

Thin client, thick backend. The server owns persistence, conflict resolution, versioning, and auth; the client is a replaceable React front-end compiled to a static bundle.

```
Browser (any device on the SIB network)
  └── /roadmap            static React bundle  (source: sib/roadmap-client/)
        ├── REST  /mindmap/*        save / load / list / export / versions
        └── WS    /mindmap/ws       node/edge events, cursors, presence

SIB server (Node.js + Express, unchanged stack)
  sib/src/routes/mindmap.routes.ts      thin HTTP layer
  sib/src/controllers/mindmap.controller.ts   business logic
  sib/src/models/mindmap.model.ts       stores + pure graph logic (LWW, versioning, SVG render)
  sib/src/ws/mindmap.ws.ts              WebSocket rooms, broadcast, heartbeat

Storage (JsonFileStore convention — .sib-data/)
  mindmaps.json            current state of every map
  mindmap-versions.json    bounded version history (max 50 per map)
```

Separation of concerns follows the workspace preferences: UI logic (components) is separate from business logic (Zustand store + pure utils); the canvas engine (SVG interaction layer) is separate from state; the server model layer is pure and unit-tested without Express or sockets.

### Data model (shared/src/mindmap.ts)

`Mindmap { id, name, createdAt, updatedAt, nodes[], edges[] }`
`MindmapNode { id, x, y, text, type, metadata, updatedAt }` — type is one of `tag | perception | semantic | reasoning | generic`, mapping 1:1 onto SIB layers (blue / purple / green / orange / grey).
`MindmapEdge { id, from, to, type: directed|undirected, updatedAt }`

Types live in `@spatial/shared` so server and client can never drift.

### Collaboration & conflict resolution

- One WebSocket room per map. Events: `node:add|update|delete`, `edge:add|delete`, `cursor:move`, `session:join|leave`, `map:rename`, `map:sync`, `error`.
- **Last-write-wins per entity** keyed on `updatedAt` (client clock, server-clamped to +30 s to neutralize broken clocks). Stale updates are dropped server-side and never broadcast.
- Node deletes cascade their edges. Edge adds validate both endpoints, reject self-loops and duplicates.
- Optimistic local apply on the client → event to server → LWW apply + persist → relay to peers. REST saves and version restores push a full `map:sync` to every collaborator.
- Live drags are throttled to ~30 events/s, cursors to ≤20/s. A 30 s ping/pong heartbeat reaps dead connections.

### Versioning

Every REST save snapshots a version (`manual save`, or a custom label). During WS sessions an `auto snapshot` is taken at most every 5 minutes of activity, and a `collab session end` snapshot when the last participant leaves. Restore snapshots the current state first (`before restore`), so restores are themselves undoable. History is pruned to the newest 50 versions per map.

### Security

- Same auth contract as the rest of SIB: `apiKeyAuth` with the `SIB_API_KEY` env var. No key set → open (local dev / trusted LAN); key set → required on every `/mindmap/*` call (`X-API-Key`) and on the WS connect (`?key=` query param, since browsers cannot set WS headers).
- Static `/roadmap` assets are served without auth (like `/portal`); the app reads `GET /config` and prompts for the key when `authRequired` is true. The key is stored in `localStorage` (`sib-api-key`, shared with the portal convention).
- All data stays in `.sib-data/` on the SIB host. The app makes zero external network calls — no CDNs, no fonts, no telemetry.

## API Reference

All routes behind `apiKeyAuth`; responses use the standard `ApiResponse<T>` envelope (`{ data, timestamp }`), errors `{ error, timestamp }`.

| Method | Route | Body | Returns |
|---|---|---|---|
| POST | `/mindmap/save` | `{ id?, name, nodes[], edges[], versionLabel? }` | `Mindmap` (201). Omit `id` to create. Snapshots a version. |
| GET | `/mindmap/load/:id` | — | `Mindmap` |
| GET | `/mindmap/list` | — | `MindmapSummary[]` (no graph payload, sorted by `updatedAt`) |
| POST | `/mindmap/export` | `{ id, format: "json"\|"svg" }` | File download (`Content-Disposition: attachment`). PNG is client-side. |
| GET | `/mindmap/:id/versions` | — | Version metadata (no snapshots), newest first |
| POST | `/mindmap/:id/restore/:versionId` | — | Restored `Mindmap`; broadcasts `map:sync` |
| DELETE | `/mindmap/:id` | — | `{ deleted: id }`; also removes its versions |

WebSocket: `GET /mindmap/ws?mapId=<id>&name=<displayName>[&key=<apiKey>]` → upgraded connection; server immediately sends `map:sync`, then presence. Frames are JSON `MindmapWsEvent { type, mapId, clientId?, clientName?, ts, payload }`.

## Client (sib/roadmap-client/)

React 18 + TypeScript + Vite + Zustand. No canvas library — a hand-rolled SVG engine keeps the bundle at ~55 kB gzipped and every interaction under our control.

```
src/
  state/store.ts          all business logic: graph mutations, undo/redo (100 steps),
                          selection, camera, presence, collab event reducer
  api/mindmap-api.ts      REST client + API-key handling
  ws/collab.ts            WebSocket transport, auto-reconnect w/ backoff
  canvas/CanvasStage.tsx  infinite canvas: pan, zoom-to-cursor, dot grid, dbl-click create
  canvas/NodeView.tsx     node rendering, drag, connect-handle, inline edit
  canvas/EdgeView.tsx     edges w/ arrowheads, fat hit area, dbl-click toggles direction
  canvas/CursorLayer.tsx  live peer cursors (stale fade-out)
  components/Toolbar.tsx  palette, layout, undo/redo, export, history, save, presence
  components/MapList.tsx  home: identity, API key, create/open/delete maps
  components/VersionsPanel.tsx  version list + one-click restore
  hooks/useKeyboardShortcuts.ts
  utils/                  colors (SIB palette), geometry, auto-layout, export (PNG/SVG/JSON)
```

### Canvas interactions

Double-click empty canvas → create node · drag node → move · drag the ring on a node's right edge → drop on another node to connect · scroll → zoom to cursor · space+drag (or background drag / middle mouse) → pan · double-click node → edit text (Enter commits, Esc cancels) · double-click edge → toggle directed/undirected · shift-click → multi-select · palette click → sets type for new nodes **and** recolors the selection.

Shortcuts: `Delete` remove selection · `Enter` edit selected · `Ctrl/⌘+S` save · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Y` / `Shift+Z` redo · `Esc` deselect.

Auto-layout: **Hierarchical** (layered left-to-right from root nodes over directed edges; disconnected parts get their own layers) and **Grid** (freeform tidy-up).

## Build & Deployment

Nothing new to deploy — the mind-mapper rides the existing SIB server.

```bash
# one-time after pulling: install workspace deps (adds ws, react, vite, zustand)
npm install

# run SIB as usual — /roadmap and /mindmap/* are live
npm run dev:sib             # http://<macbook-lan-ip>:3001/roadmap

# frontend development with hot reload (proxies API+WS to :3001)
npm run dev:roadmap         # http://localhost:5174

# rebuild the static bundle into sib/roadmap/ after client changes
npm run build:roadmap

# backend unit tests (12 tests: LWW, versioning, export, controller)
npm test --workspace=sib
```

Production is identical to the existing flow: `npm run build --workspace=sib && npm start --workspace=sib`. Set `SIB_API_KEY` to require auth, `SIB_DATA_DIR` to relocate storage, HTTPS via the existing `SSL_CERT_PATH`/`SSL_KEY_PATH` (WS automatically upgrades to `wss://`). For private-network-only access, bind `HOST` to a LAN interface or firewall port 3001 — no additional configuration is needed by the tool.

### Render

Nothing new to configure — the existing Docker deploy carries the mind-mapper:

- `sib/Dockerfile` copies the committed `sib/roadmap/` bundle into the runtime image and includes the `sib/roadmap-client` workspace manifest so `npm ci` matches the lockfile. (Both were added when the tool was introduced — a deploy from an older Dockerfile will fail `npm ci`.)
- Push to the deploy branch → Render builds → `https://<your-service>.onrender.com/roadmap`.
- `SIB_API_KEY` is set on Render, so the app will show the API-key field on the home screen; the WebSocket passes the key as `?key=` and uses `wss://` automatically. Mind-map data lands on the persistent disk (`SIB_DATA_DIR=/data/.sib-data`) alongside anchors and tags.
- Note: Render Starter spins down on idle — the WS drops with it; the client auto-reconnects with backoff once the service wakes.

### Internal server (dca-qa-330, Windows + NSSM)

Follow the existing `INTERNAL-SERVER-DEPLOY.md` flow; the mind-mapper needs no extra steps:

```bash
cd C:\sib
git pull                       # branch with the mind-mapper
npm install                    # repo root — installs all workspaces (adds ws)
npm run build --workspace=sib  # recompile sib/dist
# restart the NSSM service
```

Then open `https://dca-qa-330.amat.com:447/roadmap`. The committed `sib/roadmap/` bundle is served as-is (no Node build tools needed for the frontend on the server), HTTPS gives collaborators `wss://` transport, and data persists under the configured `SIB_DATA_DIR` (`C:\sib-data`).

## SIB Integration Path (designed-for, not yet wired)

- Node types already mirror SIB layers, and `metadata` is an open `Record<string, unknown>` — a `tag` node can carry `{ anchorId, tagId }` today.
- Planned adapters (small, isolated modules): import SIB anchors/tags as nodes (`GET /anchors`, `/tags` → graph), and export `tag`-typed nodes into SIB tag schemas. Both belong in `sib/src/adapters/` next to `perception-adapter.ts`.
- AI-assisted node expansion was intentionally left out: it conflicts with the "no external calls" constraint. When a local model is available it should join via the existing adapter interface — never hard-coded into the client.

## Assumptions & Limitations

- **LWW, not CRDT** — chosen for simplicity and auditability at team scale (a handful of concurrent editors). Whole-entity granularity: two people editing the *same node's text* simultaneously → last writer wins. Position and text are on the same record, so a concurrent move+rename resolves to one writer. A CRDT can replace `applyGraphEvent()` without touching the wire protocol.
- Undo/redo is per-client and resyncs peers through a full REST save (`map:sync`) rather than operational transforms.
- `JsonFileStore` writes the full store per mutation — fine for hundreds of maps / thousands of nodes; swap for SQLite behind the same store interface if maps grow much larger.
- Server-side export covers JSON and SVG; PNG export runs in the browser (kept the server dependency-free).
- API key is a shared team credential (existing SIB model), so presence names are self-declared, not authenticated identities.
- Version history is capped at 50 snapshots per map.
