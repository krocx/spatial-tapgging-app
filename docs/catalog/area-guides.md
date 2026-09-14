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
    PLACE --> TRAIN[Validation training: cone / quick-shot]
    TRAIN --> PUB[Published · copy to other chambers]
    PUB --> RUN[Operator session: panels, ghosts, voice, presence + coaching]
    RUN --> VAL[Step validation: auto-capture, verdict, override]
    VAL --> BR{Step outcome}
    BR -->|success| RUN
    BR -->|failure| REC[Recovery branch]
    RUN --> DONE[Live evidence + sign-off → usage log]
    RUN -.SSE.-> OBS[Live observers · author coach]
---
Step-by-step procedures anchored in space: floating instruction panels, translucent
3D ghosts, voice scripts and per-step evidence. Steps branch on outcome and gate on
prerequisites; guides stay invisible to operators until placed and published; steps
can demand a camera-verified verdict; live sessions stream telemetry, feed a durable
usage log, and let an author coach the operator in AR.
