---
id: task-graph-viz
name: ⬡ Task graph visualisation
area: portal
status: shipped
version: baseline
depends: [conditional-graph]
terms: [AR Work Instructions]
spec: ../README.md#anchor-portal-portal
wireframe: portal
arch: |
  flowchart LR
    STEPS["GuideStep graph fields: nextOnSuccess / nextOnFailure / precondition"] --> ALG["Portal lane algorithm - branch-root BFS subtrees"]
    ALG --> LANES["Failure branches get their own lanes"]
    ALG --> ARCS["Back-arcs for retry loops"]
    ALG --> CEN["Census header: steps / success / failure / precondition / lanes"]
    SEQ["Purely sequential guide"] --> NOTICE["Plain notice instead of a forced graph"]
---
Branch logic rendered in the browser: lanes per recovery path, back-arcs for retry
loops, and a link census header (steps / success / failure / precondition / lanes),
with a plain notice for purely sequential guides. The fastest way to review a
procedure's logic without a phone in hand.
