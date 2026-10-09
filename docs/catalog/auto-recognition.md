---
id: auto-recognition
name: Auto-recognition of a task done
area: tags
status: planned
version: baseline
depends: [contextual-intelligence, step-validation]
terms: [SIB]
spec: CONTEXTUAL-INTELLIGENCE.md
arch: |
  flowchart LR
    O["observations + device sensors"] -.planned.-> R["recognise: task done · done wrong"]
    R --> V["verdict without the technician saying so"]
    R --> H["assist until it is fixed"]
    NOTE["Research track: MDP FD10 POC-3 - iPad benchmark with precision / recall, then headsets"] -.-> R
---
Recognising that a step has been done, or done wrong, without the technician
saying so, from the observation stream and the device's sensors, with the
assist loop closed until it is fixed. Research, not shipped - MDP FD10 POC-3
is where it is benchmarked on the iPad before any glass.
