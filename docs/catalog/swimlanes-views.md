---
id: swimlanes-views
name: Swimlanes, groups + filters
area: designer
status: shipped
version: baseline
depends: [roadmap-collab]
terms: [Now / Next / Later, Pillar]
spec: roadmap-mindmapper.md
arch: |
  flowchart LR
    DOC["Map document: nodes carry lane + row + group ids"] --> LAY["Client-side layout - Now/Next/Later columns x Why/What/How rows"]
    DOC --> GRP["Saved node groups"]
    DOC --> FIL["View filters - hide by status, pillar, group"]
    LAY --> SAME["Same canvas reads as delivery plan or dependency map"]
---
Now/Next/Later columns crossed with Why/What/How rows, saved node groups, and view
filters. The same canvas reads as a delivery plan to leadership and a dependency
map to the build team.
