---
id: loto-model-slots
name: 3D assets on points (≤3 slots)
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors, model-library]
terms: [LOTO, GLB / USDZ]
spec: ILOTO.md
wireframe: iloto
---
Each point holds up to three model slots — lock, tag, hasp — rendered ghost while the
point is clear and solid the moment a lock is applied, each with its own
device-owned AR placement (pan / pinch / Y-rotate). Unadjusted slots fan out to avoid
overlap; changing a slot's model resets that slot's placement server-side, and legacy
single-model points lift into one synthetic slot.
