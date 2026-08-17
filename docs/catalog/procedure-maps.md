---
id: procedure-maps
name: Procedure maps (flowchart → guide)
area: designer
status: shipped
version: baseline
depends: [guide-ingestion, roadmap-collab]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
wireframe: procdes
flow: |
  flowchart LR
    DRAW[Draw nodes + role-typed edges] --> NUM[Server derives step numbers]
    NUM --> VAL[Pre-flight validation]
    VAL --> SEND[Send to Guide Library as draft]
    SEND --> EDIT[Edit map later]
    EDIT --> SYNC[Re-sync: steps update, placement untouched]
arch: |
  flowchart LR
    subgraph Canvas["Roadmap canvas (kind: procedure)"]
      N["Nodes + role-typed edges"] --> V["POST /mindmap/:id/procedure/validate - pre-flight"]
    end
    subgraph SIB
      V --> C["procedure/compiler.ts - edge graph to numbered steps"]
      C --> X["POST /mindmap/:id/procedure/export"]
      X --> I["guides/ingest.ts - applyImportedGuide"]
      IMG["procedure/designer-images.ts - content-addressed step images"]
    end
    I --> LIB["Guide Library draft"]
    C -.re-sync.-> I
    I -.never touches.-> PLACE["Existing AR placement"]
    IMG --> I
---
Procedures drawn as flowcharts on the Roadmap canvas (`kind: procedure`): role-typed
edges, server-derived step numbers, pre-flight validation, and one click to the Guide
Library as a draft. Re-sync updates steps in place and can never overwrite AR
placement — the spatial work survives every content edit.
