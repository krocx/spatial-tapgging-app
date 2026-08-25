---
id: guide-import
name: Guide import (xlsx / JSON, adapter)
area: guides
status: shipped
version: 2026.4.42
depends: [guide-ingestion, adapter-architecture]
terms: [Instruction Import, Adapter]
spec: SERVER-REFERENCE.md
api: |
  POST /guides/import — adapter-based instruction import, manual JSON today (portal · API key)
  GET /guides/step-image/:filename — imported step image (app, portal · API key)
wireframe: portal
arch: |
  sequenceDiagram
    participant P as Portal (Import modal)
    participant X as SheetJS parseGuideXlsx (browser)
    participant S as SIB POST /guides/import
    participant A as instructions-source-adapter.ts
    participant I as guides/ingest.ts - applyImportedGuide
    participant St as Guide store
    P->>X: .xlsx file (header-flexible) or JSON
    X-->>P: Parsed steps -> preview gates the Import button
    P->>S: ImportedGuide payload + adapter id
    S->>A: Adapter validates/normalises steps
    A->>I: Single shared create/upsert path
    Note over I: Invariant - spatial placement is NEVER overwritten
    I->>St: Guide + steps (draft, unplaced)
    S-->>P: Guide id -> jump-and-flash in Guide Library
---
`POST /guides/import` sits behind a pluggable instruction-source adapter; the portal
front door accepts Excel (.xlsx, downloadable template, header order-free), JSON
files or pasted JSON. A parse preview — step count, media, branches, per-step
warnings — gates the Import button, and a successful import jumps to the Guide
Library and flashes the new guide.
