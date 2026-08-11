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

`Mindmap { id, name, createdAt, updatedAt, nodes[], edges[], lanes?[] }`
`MindmapNode { id, x, y, text, type, metadata, updatedAt, status?, review?, milestone?, notes?, comments?[] }` — type is one of `tag | perception | semantic | reasoning | generic`, mapping 1:1 onto SIB layers (blue / purple / green / orange / grey); `status` is `planned | in-progress | done | blocked` (badge); `review` is `approved | rejected | needs-validation` (✓ / ✗ / ? glyph), independent of status.
`MindmapComment { id, author, text, createdAt }` — appended via dedicated `comment:add` / `comment:delete` WS events; `node:update` merges comment arrays by id (union), so concurrent commenters never overwrite each other.
`MindmapEdge { id, from, to, type: directed|undirected, updatedAt, label? }`
`MindmapGroup { id, name, nodeIds }` — named node grouping usable as a view filter; replaced atomically via `map:groups`; node deletion cascades memberships out of groups.
`MindmapLane { id, name, x, width, orientation? }` — swimlane bands, replaced atomically via `map:lanes`. Default orientation is `column` (vertical bands along x — Now / Next / Later); `row` gives horizontal bands along y (Why / What / How), where `x` is the band top and `width` its height. Columns and rows combine into a strategy grid.

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
| POST | `/mindmap/save` | `{ id?, name, nodes[], edges[], lanes?, groups?, settings?, versionLabel? }` | `Mindmap` (201). Omit `id` to create — new maps start as drafts and the response carries `draftKey` once. Snapshots a version. |
| POST | `/mindmap/unlock` | `{ draftKey }` | `{ mapId, summary }` — resolves a shared draft key. |
| POST | `/mindmap/:id/publish` / `unpublish` | — (`X-Draft-Key` required) | Toggles publication. |
| GET | `/mindmap/load/:id` | — | `Mindmap` |
| GET | `/mindmap/list` | — | `MindmapSummary[]` (no graph payload, sorted by `updatedAt`) |
| POST | `/mindmap/export` | `{ id, format: "json"\|"svg"\|"sib-json" }` | File download (`Content-Disposition: attachment`). PNG is client-side. `sib-json` = draft SIB tag scaffold from tag-typed nodes. |
| POST | `/mindmap/:id/import-sib` | `{ anchorId? }` | Merges SIB anchors/tags into the map (idempotent — re-import adds nothing). Broadcasts `map:sync`. |
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

Double-click empty canvas → create node · drag node → move (a multi-selection moves together) · background drag → **marquee select** · drag the ring on a node's right edge → drop on another node to connect · scroll → zoom to cursor · space+drag / middle mouse → pan · double-click node → edit text (Enter commits, Esc cancels) · double-click edge → toggle directed/undirected · shift-click / shift-marquee → extend selection · palette click → sets type for new nodes **and** recolors the selection.

**Touch (iPad):** one finger on background → pan · pinch → zoom · drag a node → move · long-press empty canvas → create node · long-press a node → edit text.

**Inspector (right panel, appears on selection):** node text / layer type / status / milestone / **review verdict (Approve ✓ / Reject ✗ / Needs Validation ?** — click again to clear) / notes / **comment thread** (author = your display name; comment count bubbles on nodes) · edge label + direction · lane name / width / remove. Multi-selection gets bulk type + status setters.

**Toolbar:** search with jump-to-node · Lanes menu (Now/Next/Later columns, **Why/What/How rows**, add, clear) · **Layout button shows the current mode** (Freeform / Hierarchical / Grid — any hand-move resets to Freeform) · **Fit** (zoom to whole map) · SIB menu (import anchors+tags, export draft) · undo/redo · Export (PNG/SVG/JSON) · History · Save · presence.

**Collapsible branches:** nodes with outgoing directed edges get a chevron beneath them — collapse hides all descendants (fixpoint rule: a node hides only when *every* directed parent is collapsed or hidden, so alternate visible paths and cycles behave correctly). Collapsed nodes show a "+N" badge with the hidden count. Collapse state is part of the map (synced + versioned). Exports always render the full graph.

**Presentation mode (▶ Present):** full-screen walkthrough — steps are column lanes (left→right), then row lanes, then a closing Overview; maps without lanes step through groups, else one whole-map step. Navigation: → / ← / Space / Esc, or the on-screen bar with progress dots. Nodes outside the current step fade; editing is disabled while presenting. Collapse first, then present, for a chapter-level walkthrough.

**Rich nodes (inspector):** shape (rounded / rect / pill / diamond / hexagon), a 20-glyph inline icon set (flag, star, bolt, gear, eye, camera, cube, robot, wrench, chip, qr, tag, check, alert, bulb, target, layers, doc, user, clock — no external requests), and an http(s) hyperlink opened via the ↗ affordance on the node. Links are sanitized server-side on **both** the WS and REST/save paths (`javascript:` etc. rejected); REST saves also drop malformed nodes and dangling/self-loop edges.

**View filters (Filters button):** left panel with toggleable chips for SIB layers, statuses (incl. "no status"), and custom groups — matching nodes stay full-strength, everything else fades to 15% (edges fade unless both endpoints match). Within a section chips OR together; across sections they AND ("semantic OR reasoning, AND in-progress"). Filters are per-viewer only — they never affect collaborators. Groups are created from a multi-selection ("Group selection" in the inspector), renamed by double-clicking their chip, and are synced + versioned map state.

**Edge styling (Style menu):** map-level, synced to all viewers and honored by PNG/SVG exports. Edge color: **parent** (default — edges and arrowheads carry the source node's layer color, so flows visually tell their origin's story) or **neutral** grey. Routes: **straight** (default) or **curved** (cubic beziers with controls along the dominant axis; labels sit on the curve).

**Publish workflow (pre-RBAC):** new maps are born as **private drafts**. The creator's browser receives the map's **draft key** exactly once and stores it (`roadmap-draft-keys` in localStorage). Drafts are invisible in the list and locked (403 on REST + WS) for everyone else. Sharing: "Copy key" in the toolbar → teammate uses "Unlock draft" on the home screen. The **Draft 🔒 / Published** chip next to the map name toggles publication (draft-key holder only): published maps are open to everyone (view + edit); unpublish flips them back. Keys live server-side in `.sib-data/mindmap-access.json`, are never included in map payloads, and survive publish — only the holder can ever unpublish. Maps created before this feature have no key and are permanently published. When SSO/RBAC lands, access records map directly onto real ownership. Headers: `X-Draft-Key` (single map), `X-Draft-Keys: id:key,…` (list); WS: `&draftKey=`. Endpoints: `POST /mindmap/unlock` `{ draftKey }`, `POST /mindmap/:id/publish`, `POST /mindmap/:id/unpublish`.

**Image → roadmap ("From image 📷" on the map list):** photograph a whiteboard or upload a screenshot; a **local** vision model extracts nodes, edges, and lanes — preserving the sketch's spatial arrangement, reading arrows into directed edges with labels, and mapping ✓/✗ marks onto statuses. A preview modal (rendered graph + extraction stats + warnings) lets you rename and **Create draft** (normal private draft → tidy → publish) or discard. Images are downscaled client-side to ≤1280 px and sent only to the SIB host's configured endpoint — nothing leaves your network.

*Setup (one-time, per SIB host):* install [Ollama](https://ollama.com), then `ollama pull qwen2.5vl`. SIB defaults to Ollama's OpenAI-compatible endpoint at `http://localhost:11434/v1`. Any OpenAI-compatible **local** runtime works (LM Studio, vLLM on the internal server): configure `SIB_VISION_URL`, `SIB_VISION_MODEL`, optional `SIB_VISION_API_KEY`, `SIB_VISION_TIMEOUT_MS` (default 120 s — local VLMs are slow on first call). Endpoint: `POST /mindmap/import-image` `{ image: base64, mimeType }` → preview graph (never auto-saved). If no model is running, the error tells you exactly what to start. Note: Render has no GPU/Ollama — this feature shines on the MacBook and internal server; on Render it reports the model as unreachable unless you point `SIB_VISION_URL` at a reachable internal gateway.

**In-app dictionary (📖):** the roadmap glossary (`docs/roadmap-glossary.md`) is served live at `GET /mindmap/glossary` — edit the markdown, restart nothing, the tool shows the update. The 📖 toolbar button opens a searchable panel grouped by pillar. Selecting a node also surfaces its matching entry in the inspector ("From the dictionary"), matched by normalized fuzzy lookup (so "AI Dyn. Instructions" finds "AI Dynamic Instructions" without manual linking), with a jump into the full panel. The Docker image copies the glossary; on bare deployments keep `docs/roadmap-glossary.md` beside the repo layout.

**Cross-server transfer:** Export → JSON on one server (e.g. Render), then "Import JSON" on the map-list screen of another (e.g. the internal server). The import creates a fresh map with a new id and keeps nodes, edges, lanes, statuses, reviews, notes, and comments.

Shortcuts: `Delete` remove selection · `Enter` edit selected · `Ctrl/⌘+S` save · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Y` / `Shift+Z` redo · `Ctrl/⌘+C/V` copy/paste (internal edges included, pasted at cursor) · `Ctrl/⌘+D` duplicate · `Ctrl/⌘+A` select all · `Esc` deselect.

Auto-layout: **Hierarchical** (layered left-to-right from root nodes over directed edges; disconnected parts get their own layers) and **Grid** (freeform tidy-up). A clickable **minimap** (bottom-right) shows the whole graph, lanes, and the current viewport.

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
npm run test:sib
```

Production is identical to the existing flow: `npm run build --workspace=@spatial/sib && npm start --workspace=@spatial/sib`. (Use the exact package *name* — the path form `--workspace=sib` also matches the nested `sib/roadmap-client` workspace.) Set `SIB_API_KEY` to require auth, `SIB_DATA_DIR` to relocate storage, HTTPS via the existing `SSL_CERT_PATH`/`SSL_KEY_PATH` (WS automatically upgrades to `wss://`). For private-network-only access, bind `HOST` to a LAN interface or firewall port 3001 — no additional configuration is needed by the tool.

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
git pull                                # branch with the mind-mapper
npm install                             # repo root — installs all workspaces (adds ws)
npm run build --workspace=@spatial/sib  # recompile sib/dist (exact name — see note above)
# restart the NSSM service
```

Then open `https://dca-qa-330.amat.com:447/roadmap`. The committed `sib/roadmap/` bundle is served as-is (no Node build tools needed for the frontend on the server), HTTPS gives collaborators `wss://` transport, and data persists under the configured `SIB_DATA_DIR` (`C:\sib-data`).

## SIB Integration (wired — sib/src/adapters/mindmap-sib-adapter.ts)

- **Import:** the toolbar's SIB → "Import anchors + tags" (REST: `POST /mindmap/:id/import-sib`) merges the live anchor/tag graph into the current map — anchors as `generic` nodes, their tags as `tag` nodes with anchor→tag edges. Provenance is stored in `node.metadata.sib = { kind, id }`, making re-imports idempotent; imported nodes keep their positions on subsequent imports. Each import that changes anything snapshots a version.
- **Export:** SIB → "Export SIB draft" (`POST /mindmap/export` with `format: "sib-json"`) produces a *draft* scaffold of Tag entities from tag-typed nodes (nodes already linked to SIB are listed separately for traceability). It deliberately does **not** write into the SIB stores — real tags need an anchor and spatial placement, which stays in the authoring apps.
- AI-assisted node expansion remains intentionally out: it conflicts with the "no external calls" constraint. When a local model is available it should join via the adapter interface — never hard-coded into the client.

## Procedure Designer (kind: 'procedure' maps)

The canvas doubles as a visual authoring tool for AR work instructions. Full design
rationale and lifecycle: [PROCEDURE-DESIGNER.md](PROCEDURE-DESIGNER.md).

- **Map kind** is chosen at creation ("Create procedure" on the map list) and is
  **immutable** afterwards — flipping a roadmap into an executable procedure would
  silently change what every node means. `Mindmap.kind` is absent on all pre-existing
  maps, which the server treats as `'roadmap'`.
- **Edge roles**: on procedure maps, dropping a connection opens a relationship picker
  (Next / On failure / Requires, keys 1/2/3) — no edge is created until a role is
  chosen, because an unroled edge is ignored by the compiler. Roles render green /
  red / amber, matching the Guide Library's ⬡ Graph view exactly. Stored as
  `MindmapEdge.role`, whitelisted through `sanitizeEdge` (which rebuilds edges from
  scratch — any new field must be added there or it is silently dropped on save).
- **Derived step numbers**: node badges show the sequence the compiler will emit,
  fetched from `POST /mindmap/:id/procedure/validate` — never derived client-side, so
  the number on the card cannot drift from the number in the guide.
- **Pre-flight**: the ProcedureBar shows the census (steps / next / failure /
  requires / lanes) plus blocking errors (no start, unreachable step, empty text,
  duplicate role edges, precondition deadlock) and non-blocking warnings. Blocking
  issues select the offending node on click.
- **Send to Guide Library**: `POST /mindmap/:id/procedure/export` compiles the map
  via the shared ingestion service and creates or updates a **draft** guide. Every
  new step arrives unplaced — AR placement stays on device. Node provenance
  (`metadata.guide = { guideId, stepId }`) is stamped back so re-sync updates steps
  in place; spatial fields are never overwritten by a canvas write. Re-sync to a
  **published** guide is refused (409) unless explicitly confirmed, which unpublishes
  first.
- **Server pieces**: compiler `sib/src/procedure/compiler.ts` (pure, unit-tested),
  policy `sib/src/procedure/export.ts`, shared ingestion `sib/src/guides/ingest.ts`.
  Tests: `sib/test/procedure-compiler.test.ts`, `guide-ingest.test.ts`,
  `procedure-export.test.ts`.

## Assumptions & Limitations

- **LWW, not CRDT** — chosen for simplicity and auditability at team scale (a handful of concurrent editors). Whole-entity granularity: two people editing the *same node's text* simultaneously → last writer wins. Position and text are on the same record, so a concurrent move+rename resolves to one writer. A CRDT can replace `applyGraphEvent()` without touching the wire protocol.
- Undo/redo is per-client and resyncs peers through a full REST save (`map:sync`) rather than operational transforms.
- `JsonFileStore` writes the full store per mutation — fine for hundreds of maps / thousands of nodes; swap for SQLite behind the same store interface if maps grow much larger.
- Server-side export covers JSON and SVG; PNG export runs in the browser (kept the server dependency-free).
- API key is a shared team credential (existing SIB model), so presence names are self-declared, not authenticated identities.
- Version history is capped at 50 snapshots per map.
