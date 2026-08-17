---
id: canvas-ux
name: Canvas UX — night theme + auto-sizing nodes
area: designer
status: shipped
version: 2026.4.42
depends: [procedure-maps]
terms: []
spec: roadmap-mindmapper.md
wireframe: procdes
arch: |
  flowchart LR
    KIND["Map kind procedure -> dark canvas default"] --> TOG["Toolbar toggle - per-map-kind preference"]
    CARD["Node cards stay white in both themes - contrast never lost"]
    TXT["Title wraps up to 4 lines"] --> H["Real node height measured"]
    H --> GEO["Edges, minimap, marquee, auto-layout, presentation bounds, SVG export all follow it"]
---
Procedure maps default to a dark canvas so an executable procedure is visually
distinct from a planning roadmap (toolbar toggle, per-map-kind preference); node
cards stay white in both themes so contents never lose contrast. Cards wrap titles
up to four lines and grow to fit — edges, minimap, layout and export all follow the
real height.
