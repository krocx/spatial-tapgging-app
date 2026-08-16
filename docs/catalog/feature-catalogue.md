---
id: feature-catalogue
name: Visual Feature Catalogue
area: platform
status: shipped
version: 2026.4.42
depends: [home-page, versioning]
terms: [SIB]
spec: catalog/README.md
---
This surface: docs/catalog/ holds one YAML-frontmatter file per feature, and
GET /catalog renders them as a connected graph — flows, dependencies, role trails
and dictionary definitions, generated live at /catalog/data (which doubles as the
AI-grounding feed). The markdown is the single source; everything visual is derived.
