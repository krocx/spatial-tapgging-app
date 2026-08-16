---
id: guide-move
name: Guide move-to-anchor
area: portal
status: shipped
version: 2026.4.42
depends: [guide-library, guide-lifecycle]
terms: [Anchor, AR Work Instructions]
spec: SERVER-REFERENCE.md
wireframe: portal
---
⇄ Move reassigns a guide and all its steps to another anchor. The server clears
every step's AR placement — positions belong to the old anchor's world map — and
unpublishes the guide until it is re-placed, so a moved guide can never show stale
geometry.
