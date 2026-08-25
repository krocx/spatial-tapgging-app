---
id: feature-catalogue
name: Visual Feature Catalogue
area: platform
status: shipped
version: 2026.4.42
depends: [home-page, versioning]
terms: [SIB]
spec: catalog/README.md
api: |
  GET /catalog/data — the derived graph this page renders (browser · API key)
  GET /catalog/doc/:id — section-scoped spec markdown (browser · API key)
arch: |
  flowchart LR
    MD["docs/catalog/*.md - YAML frontmatter, canonical source"] --> CORE["catalog-core.ts buildCatalog - validates + derives graph"]
    CORE --> DATA["GET /catalog/data - features, edges, trails, glossary (AI-grounding feed)"]
    DATA --> UI["catalog.html - force graph, cards, mermaid, lightbox"]
    MD --> DOC["GET /catalog/doc/:id - spec markdown in place"]
    CHK["npm run catalog:check - same rules, fails CI on drift"] -.-> MD
---
This surface: docs/catalog/ holds one YAML-frontmatter file per feature, and
GET /catalog renders them as a connected graph — flows, dependencies, role trails
and dictionary definitions, generated live at /catalog/data (which doubles as the
AI-grounding feed). The markdown is the single source; everything visual is derived. Every card is
linkable (/catalog#feature-id) and render libraries are vendored via
`npm run catalog:vendor` so no CDN outage can blank a diagram.
