---
id: adapter-architecture
name: Adapter architecture
area: platform
status: shipped
version: baseline
depends: []
terms: [Adapter]
spec: technical-architecture.md
arch: |
  flowchart LR
    subgraph SIB["sib/src/adapters/"]
      P["perception-adapter.ts"]
      VI["vision-adapter.ts"]
      I["instructions-source-adapter.ts"]
      AI["ai-guide-adapter.ts"]
      MM["mindmap-sib-adapter.ts"]
    end
    P --> RULE["Each: stable interface + working default + swappable implementation"]
    VI --> RULE
    I --> RULE
    AI --> RULE
    MM --> RULE
    RULE --> NO["No vendor ever hard-coded into the platform"]
---
Anything external — perception models, instruction sources, AI guidance, vision
stacks — is an isolated, swappable module behind a stable interface, and every
adapter ships with a working default. No vendor is ever hard-coded into the platform.
