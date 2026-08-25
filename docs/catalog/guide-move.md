---
id: guide-move
name: Guide move-to-anchor
area: portal
status: shipped
version: 2026.4.42
depends: [guide-library, guide-lifecycle]
terms: [Anchor, AR Work Instructions]
spec: SERVER-REFERENCE.md
api: |
  PATCH /guides/:id — new anchorId moves guide + all steps (portal · API key)
wireframe: portal
arch: |
  sequenceDiagram
    participant P as Portal (Move button)
    participant S as PATCH /guides/:id with anchorId
    participant St as Guide + step stores
    P->>S: Target anchor chosen
    S->>St: Move guide AND all steps (denormalised anchorId)
    S->>St: Clear posX/Y/Z, isPlaced, model offsets - positions belong to the OLD anchor's worldmap
    S->>St: Unpublish until re-placed
    S-->>P: A moved guide can never show stale geometry
---
⇄ Move reassigns a guide and all its steps to another anchor. The server clears
every step's AR placement — positions belong to the old anchor's world map — and
unpublishes the guide until it is re-placed, so a moved guide can never show stale
geometry.
