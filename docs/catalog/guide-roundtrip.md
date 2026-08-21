---
id: guide-roundtrip
name: Edit any guide in the Designer (round-trip)
area: designer
status: shipped
version: 2026.4.42
depends: [procedure-maps, guide-ingestion, guide-library]
terms: [AR Work Instructions, Instruction Import]
spec: PROCEDURE-DESIGNER.md
wireframe: procdes
arch: |
  sequenceDiagram
    participant P as Portal (Edit in Designer)
    participant E as POST /guides/:id/edit-map
    participant R as procedure/reverse-compiler.ts
    participant D as Designer (/roadmap?map=id)
    participant X as POST /mindmap/:id/procedure/export
    P->>E: guide id
    alt map already linked (guideSync / provenance)
      E-->>P: mapId + stale flag - warn if guide changed since last sync
    else no map yet
      E->>R: steps to nodes, branches to role edges, content carried
      R-->>E: "[Guide] name" map - provenance on every node
    end
    P->>D: open by URL
    D->>X: re-sync after editing
    Note over X: Content-only edits to a PUBLISHED guide apply LIVE - structural edits confirm + unpublish until placed
    X->>X: ingest updates steps IN PLACE - placement always survives
---
Any guide — imported from xlsx/JSON, hand-built on iOS, or born on the canvas —
opens in the Procedure Designer with one click from the Guide Library. A reverse-
compiler turns steps into nodes and branch fields into role edges, provenance
keeps re-syncs in-place so AR placement always survives, and a stale flag warns
when the guide changed elsewhere since the map last agreed with it.
