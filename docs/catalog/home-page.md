---
id: home-page
name: SIB home page
area: portal
status: shipped
version: 2026.4.42
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
arch: |
  flowchart LR
    GET["GET / in app.ts"] --> HTML["sib/portal/home.html - static, no build step"]
    HTML --> CFG["fetch /config - status dot + platformVersion"]
    HTML --> CARDS["Cards: /portal, /roadmap, /wireframe, /catalog"]
---
GET / is a landing page with a live site pulse — anchors, sessions this week,
open Gemba findings and active LOTO locks (red when any are held), from the
aggregate-only public /stats endpoint — plus cards for the Web Portal, the Roadmap & Procedure
Designer, and the interactive App Wireframe at /wireframe, plus a live server status
dot and the platform version. The front door for anyone handed a server URL.
