---
id: platform
kind: area
name: Platform Foundations
color: "#64748b"
order: 7
flow: |
  flowchart LR
    CLIENTS[iOS app / portal / roadmap] --> SIB[SIB - self-hosted server]
    SIB --> ADPT[Adapters: perception, instructions, AI, vision]
    SIB --> SCHEMA[Shared TypeScript schema]
    SIB --> DATA[(JSON file store - on-prem or Render disk)]
    ADPT -.swappable.-> EXT[Local models / MES / future vendors]
---
The load-bearing decisions: self-hosted end to end (no third party sees site data),
no cloud AI dependency, everything external behind an adapter with a working default,
and one shared TypeScript schema typed across server, portal and (mirrored) iOS.
