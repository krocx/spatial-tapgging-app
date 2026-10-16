---
id: spatial-readings
name: Spatial readings - instrument displays, labels and part numbers read by the camera
area: guides
status: beta
sensitivity: restricted
version: 2026.4.50
depends: [step-validation, procedure-maps, guide-library]
terms: [Evidence Capture, Train in App]
spec: SPATIAL-READINGS.md
api: |
  PATCH /guides/:id/steps/:stepId - { assertions } the readings and text checks on a step: kind text-value | text-match | code | location, the ME's expectation in the work instruction's own words, bounds derived server-side, block or flag on a miss (designer · app · portal · API key)
flow: |
  flowchart LR
    ME["ME types the expectation on the step (Designer or iPad)"] --> B["SIB derives min / max and the unit"]
    B --> OP["Operator frames the display or label; the device reads it"]
    OP --> V["Verdict in words per check; block or flag"]
    V --> EV["Frame with the read overlaid is the evidence; a typed value is recorded as typed"]
---
Spatial Inspection confirms the work, not the words: the part is present, the
right part, in the right place; the label is the right label, in the right
language, in the right place; the reading on the instrument is what the work
instruction expects. Reading text is one sense among those, so it enters as a
kind of assertion on the step, judged on the same captured frame as presence
and pose, with its own result in the evidence. The ME types the expectation
as the work instruction says it ("80 Ω ±5 %", "12.0 N·m ± 0.5", "≤ 1.0e-9
mbar·l/s") in the Designer's step inspector or the iPad step page; SIB
derives the bounds once and both ends judge by them. On the floor the number
comes from the camera, never the keyboard; a typed fallback is recorded as
typed so a manager can tell a measured value from a remembered one. This
version ships the model and the authoring (AROMS-337); the iPad capture and
verdict (AROMS-338), labels and codes (339, 340), import recognition (341)
and the torque and leak-check display cases (342) follow.
