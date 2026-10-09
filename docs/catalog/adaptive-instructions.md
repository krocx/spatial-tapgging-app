---
id: adaptive-instructions
name: Adaptive work instructions
area: guides
status: planned
version: baseline
depends: [contextual-intelligence, live-telemetry]
terms: [SIB]
spec: CONTEXTUAL-INTELLIGENCE.md
arch: |
  flowchart LR
    O["observations · baselines per step"] -.planned.-> A["adapt the instruction: pace · order · detail · form"]
    A --> D["the same Guide Bundle, delivered differently per visit"]
    NOTE["Research track: MDP FD10 POC-2 - iOS benchmark first, then headsets"] -.-> A
---
Instructions that adapt to how the technician performs the task, rather than
the static, pre-programmed instructions used for decades: the step's pace,
order, detail and delivery form follow the baselines and signals contextual
intelligence already learns. Research, not shipped - MDP FD10 POC-2 is where
it is proved on the iPad first.
