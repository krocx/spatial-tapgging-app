---
id: designer
kind: area
name: Roadmap & Procedure Designer
color: "#8b5cf6"
order: 4
wireframe: procdes
flow: |
  flowchart LR
    MAP[Draw procedure map] --> ROLES[Role-typed edges: Next / On failure / Requires]
    ROLES --> CONTENT[Step content: voice, images, models, links]
    CONTENT --> PREV[Preview mode walkthrough]
    PREV --> VALID[Pre-flight validation]
    VALID --> EXPORT[Send to Guide Library as draft]
    EXPORT --> RESYNC[Re-sync updates steps, never placement]
---
One collaborative canvas, two jobs: planning roadmaps (swimlanes, statuses, reviews,
history) and drawing executable procedures as flowcharts that compile straight into
draft AR guides. The compile path runs through the guide ingestion service, whose
tested invariant is that no import or canvas write ever overwrites AR placement.
