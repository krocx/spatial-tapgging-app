---
id: batch-validation
name: Batch validation
area: tags
status: shipped
version: baseline
depends: [patch-scoring]
terms: [Batch Validation, Anchor]
spec: SERVER-REFERENCE.md
api: |
  POST /perception/validate — score one capture against one tag (app · API key)
  POST /perception/validate-all — one anchor capture scored against every tag (app · API key)
wireframe: operator
arch: |
  sequenceDiagram
    participant O as Operator (iOS)
    participant S as SIB POST /perception/validate-all
    participant IC as image-comparator.ts
    O->>S: One anchor capture + anchorId
    S->>S: Load every tag on the anchor
    loop each tag
      S->>IC: Crop tag region, score vs pass state
      IC-->>S: verdict + confidence
    end
    S-->>O: Per-tag results in one response
    O->>S: POST /sessions - results + evidence become the session record
---
One scan, every answer: a single anchor capture validates all tags on that anchor and
returns per-tag verdicts in one pass. This is what makes a five-minute inspection a
thirty-second one.
