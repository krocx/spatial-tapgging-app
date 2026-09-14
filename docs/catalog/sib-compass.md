---
id: sib-compass
name: SIB Compass (one navigator on every surface)
area: portal
status: shipped
version: 2026.4.46
depends: [home-page, feature-catalogue]
terms: [SIB]
spec: CONNECTED-WORKER.md#sib-compass
api: |
  GET /stats — aggregate counts that ride on the map nodes (browser · public)
flow: |
  flowchart LR
    B["brand-hex button bottom-right<br/>(pulses while a run is live)"] --> M["radial map: SIB centre → Portal · Admin · Platform · Roadmap · Catalogue · Wireframe → stops"]
    M --> N["one click, leaf to leaf · current path lit"]
    BC["breadcrumb SIB › Portal › Admin › …"] --> N
    W["Where next? chips · Recents · g g / g h p m r c w a"] --> N
---
Each web surface had grown its own way home. compass.js, injected by brand.js on
the portal, home, /platform, catalogue, roadmap and wireframe, gives them one
navigator: a radial map with the current node lit and the path drawn, live
counts from /stats on the nodes, a clickable breadcrumb, "Where next?" chips from
the getting-started ladder, recents and keyboard shortcuts. Reduced motion is
respected and the leaves hide on narrow screens.
