---
id: node-lifecycle
name: Status, review, comments, milestones
area: designer
status: shipped
version: baseline
depends: [roadmap-collab]
terms: [Status vs. Review, Milestone]
spec: roadmap-mindmapper.md
arch: |
  flowchart LR
    N["Node fields in the map document"] --> ST["status: planned / in-progress / done / blocked"]
    N --> RV["review: approved / rejected / needs validation"]
    N --> CM["Threaded comments"]
    N --> MS["Milestone flag - gold diamond"]
    ST -.independent axes by design.- RV
    ALL["All persisted via POST /mindmap/save - no separate service"] -.-> N
---
Per-node execution status (planned / in-progress / done / blocked) is tracked
separately from review verdict (approved / rejected / needs validation) — a node can
be in-progress AND needs-validation on purpose. Threaded comments and gold-diamond
milestones complete the picture.
