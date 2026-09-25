---
id: ar-moment-coach
name: In-AR moment coach + panel redesign
area: guides
status: shipped
version: 2026.4.46
depends: [onboarding-ftue, spatial-steps]
terms: [Author Mode, Operator Mode]
spec: CONNECTED-WORKER.md#in-ar-moment-coach
wireframe: arguides
flow: |
  flowchart LR
    T["control becomes relevant<br/>(pin dropped · validation step reached · …)"] --> M["moment card over live AR<br/>one line · one glyph · Got it"]
    M --> S[("remembered per employee ID")]
    Q["? icon"] --> C["Controls cheat-sheet · Replay tips · overview"]
---
The paged overview taught a mode before the camera was up and was forgotten by
the time a control mattered. Now a one-line moment card appears over the live AR
view the first time a control becomes relevant - never covering the camera or
the AR panels - and is remembered per person, so a shared kiosk iPad still
teaches the next technician. The AR floating panels were redesigned in the same
pass (adaptive height, state bands, chips, minimized pill) and the pulsing "tap
here" hand returned everywhere.
