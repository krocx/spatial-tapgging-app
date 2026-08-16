---
id: data-admin
name: Data administration
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
wireframe: portal
---
Per-row and bulk delete with correct cascades — deleting an anchor takes its tags,
pass states, QR blob and world map with it, and says so before it does. Destructive
actions are explicit, never side effects.
