---
id: conditional-graph
name: Conditional task graph
area: guides
status: shipped
version: baseline
depends: [spatial-steps]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
wireframe: arguides
flow: |
  flowchart LR
    S1[Step] -->|success| S2[Next step]
    S1 -->|failure| R[Recovery step]
    R --> S2
    S3[Gated step] -.requires.-> S1
---
Steps branch on outcome (`nextOnSuccess` / `nextOnFailure`) and gate on
prerequisites, so a failed torque check routes to the recovery procedure instead of
marching on. The portal renders the graph with lanes per recovery path and back-arcs
for retry loops.
