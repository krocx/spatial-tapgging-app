---
id: roadmap-collab
name: Real-time collaboration
area: designer
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: roadmap-mindmapper.md
api: |
  POST /mindmap/save — LWW map save (designer · API key)
  GET /mindmap/list — map directory (designer · API key)
  GET /mindmap/load/:id — load map (designer · API key)
  POST /mindmap/:id/publish — draft to published (designer · API key)
  POST /mindmap/unlock — per-map draft key check (designer · API key)
arch: |
  sequenceDiagram
    participant C1 as Client A (zustand store)
    participant W as ws/mindmap.ws.ts - room per map
    participant C2 as Client B
    participant S as POST /mindmap/save
    C1->>W: Cursor + node ops
    W-->>C2: Live broadcast - presence, cursors
    C1->>S: Save (last-writer-wins on conflict)
    W->>W: Auto-snapshot during collab sessions
    Note over S: GET /mindmap/load/:id hydrates late joiners
---
WebSocket rooms with live cursors, presence and last-writer-wins conflict
resolution — the canvas is multiplayer by default. Auto-snapshots run during collab
sessions so a bad merge is always one restore away.
