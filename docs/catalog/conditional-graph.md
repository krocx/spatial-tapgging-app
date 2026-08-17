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
arch: |
  flowchart LR
    subgraph Authoring
      E["nextOnSuccess / nextOnFailure / precondition on GuideStep"]
    end
    subgraph Runtime["iOS ARGuideSessionView"]
      DONE{"Step outcome"} -->|success| NS["goto nextOnSuccess"]
      DONE -->|failure| NF["goto nextOnFailure - recovery lane"]
      GATE["precondition unmet -> redirect to required step"]
    end
    subgraph Portal
      VIZ["Guide Library graph - branch-root BFS lanes, back-arcs"]
    end
    E --> DONE
    E --> VIZ
---
Steps branch on outcome (`nextOnSuccess` / `nextOnFailure`) and gate on
prerequisites, so a failed torque check routes to the recovery procedure instead of
marching on. The portal renders the graph with lanes per recovery path and back-arcs
for retry loops.
