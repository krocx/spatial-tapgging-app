---
id: feature-catalogue
name: Visual Feature Catalogue
area: platform
status: shipped
version: 2026.4.46
depends: [home-page, versioning]
terms: [SIB]
spec: catalog/README.md
api: |
  GET /catalog/data - the derived graph this page renders (browser · API key)
  GET /catalog/doc/:id - section-scoped spec markdown (browser · API key)
  GET /learn/data - the six Learn journeys joined with the catalogue (browser · API key)
arch: |
  flowchart LR
    MD["docs/catalog/*.md - YAML frontmatter, canonical source"] --> CORE["catalog-core.ts buildCatalog - validates + derives graph"]
    CORE --> DATA["GET /catalog/data - features, edges, trails, glossary (AI-grounding feed)"]
    DATA --> UI["catalog.html - force graph, cards, mermaid, lightbox"]
    MD --> DOC["GET /catalog/doc/:id - spec markdown in place"]
    CHK["npm run catalog:check - same rules, fails CI on drift"] -.-> MD
    LJ["docs/learn/journeys.json - six reading orders"] --> LD["GET /learn/data - stops joined with features + diagrams"]
    DATA --> LD
    LD --> LEARN["learn.html - one idea per screen, quiz, progress"]
    CHK -.-> LJ
---
This surface: docs/catalog/ holds one YAML-frontmatter file per feature, and
GET /catalog renders them as a connected graph - flows, dependencies, role trails
and dictionary definitions, generated live at /catalog/data (which doubles as the
AI-grounding feed). The markdown is the single source; everything visual is derived. Every card is
linkable (/catalog#feature-id, `?3d` for the stacked view) and render libraries are
vendored via `npm run catalog:vendor` so no CDN outage can blank a diagram. The map
is "The Core": SIB in the centre, products as radar wedges, features on depth
rings; **3D** lifts each product to its own layer along the SIB spine so cross-product
dependencies read as vertical links. **/learn** sits on the same data: six
five-minute journeys (`docs/learn/journeys.json`) - anchoring, procedure,
validation, walks, lockout, platform - each a reading order of catalogue
features, one idea per screen with the feature's own diagram, three
recognition questions at the end, and progress kept in the browser. The
checker validates every stop's feature id, so a journey can never drift from
the catalogue it summarises.
