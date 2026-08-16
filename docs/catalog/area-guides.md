---
id: guides
kind: area
name: AR Work Instructions
color: "#22c55e"
order: 3
wireframe: arguides
flow: |
  flowchart LR
    SRC[Author / import / Procedure Designer] --> DRAFT[Draft guide]
    DRAFT --> PLACE[Steps placed in AR]
    PLACE --> PUB[Published]
    PUB --> RUN[Operator session: panels, ghosts, voice]
    RUN --> BR{Step outcome}
    BR -->|success| RUN
    BR -->|failure| REC[Recovery branch]
    RUN --> DONE[Evidence + sign-off]
    RUN -.SSE.-> OBS[Live observers]
---
Step-by-step procedures anchored in space: floating instruction panels, translucent
3D ghosts, voice scripts and per-step evidence. Steps branch on outcome and gate on
prerequisites; guides stay invisible to operators until placed and published; live
sessions stream telemetry and an AI adapter offers hints when an operator stalls.
