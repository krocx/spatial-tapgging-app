---
id: guide-import
name: Guide import (xlsx / JSON, adapter)
area: guides
status: shipped
version: 2026.4.42
depends: [guide-ingestion, adapter-architecture]
terms: [Instruction Import, Adapter]
spec: SERVER-REFERENCE.md
wireframe: portal
---
`POST /guides/import` sits behind a pluggable instruction-source adapter; the portal
front door accepts Excel (.xlsx, downloadable template, header order-free), JSON
files or pasted JSON. A parse preview — step count, media, branches, per-step
warnings — gates the Import button, and a successful import jumps to the Guide
Library and flashes the new guide.
