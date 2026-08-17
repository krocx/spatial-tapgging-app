---
id: presentation-mode
name: Presentation mode
area: designer
status: shipped
version: baseline
depends: [swimlanes-views]
terms: []
spec: roadmap-mindmapper.md
arch: |
  flowchart LR
    ENTER["Presentation mode toggle"] --> SEQ["Client-side step-through of lanes and groups"]
    SEQ --> FIT["Camera fits each lane/group using real node bounds"]
    SEQ --> LIVE["The roadmap presents itself - no slide export to go stale"]
---
A step-through walkthrough of lanes and groups for meetings — the roadmap presents
itself, in order, without exporting to slides that would be stale by Friday.
