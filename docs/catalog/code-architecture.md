---
id: code-architecture
name: Code architecture (C4)
area: platform
status: shipped
version: 2026.4.46
depends: [feature-catalogue, brand-system]
terms: [SIB]
spec: ARCHITECTURE.md
sensitivity: restricted
api: |
  GET /architecture/data - docs/ARCHITECTURE.md split into C4 sections plus the generated level-4 graphs (browser · API key + IP key)
wireframe: portal
arch: |
  flowchart LR
    MD["docs/ARCHITECTURE.md - levels 1 to 3 by hand, ADR index"] --> ROUTE["routes/architecture.ts - sections + generated graphs, IP key"]
    GEN["scripts/arch-graph.mjs - imports in sib/src, type references in ios-app"] --> L4[("docs/architecture/ deps.json · deps-sib.mmd · deps-app.mmd")]
    L4 --> ROUTE
    CHK["npm run arch:check - regenerates, fails on drift"] -.-> L4
    ROUTE --> PAGE["architecture.html - one tab per level, mermaid on brand tokens, file explorer"]
    PAGE --> IMG["Download PNG / SVG - Applied Materials header, appliedx wordmark, confidentiality line, Open Sans embedded"]
---
The level beneath the Feature Catalogue: how the code is organised and why.
`/architecture` renders the C4 model (context, containers, components, code)
from `docs/ARCHITECTURE.md`. Levels 1 to 3 are written by hand and change
slowly; level 4 is generated from the source by `npm run arch:graph` and
`npm run arch:check` fails the build when the committed graph no longer
matches the code, so the diagram is always true. Each diagram downloads as a
PNG or SVG carrying the Applied Materials header and the strictly confidential
line, with the brand font embedded so it renders the same on any machine.
The whole page is IP-restricted: without the key it shows only the unlock
prompt, never a redacted copy. C4 (c4model.com) is CC BY 4.0 and Mermaid is
MIT, both used from the vendored copy; nothing loads from the internet.
