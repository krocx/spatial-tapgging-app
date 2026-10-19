---
id: spatial-readings
name: Spatial readings - instrument displays, labels and part numbers read by the camera
area: guides
status: shipped
sensitivity: restricted
version: 2026.4.50
depends: [step-validation, procedure-maps, guide-library]
terms: [Evidence Capture, Train in App]
spec: SPATIAL-READINGS.md
api: |
  PATCH /guides/:id/steps/:stepId - { assertions } the readings, label and barcode checks on a step: kind text-value | text-match | code | location, the ME's expectation in the work instruction's own words ("a | b" for either), bounds re-derived server-side from the wording on every save, contains by default, block or flag on a miss (designer · app · portal · API key)
  POST /guide-sessions/live/:id/events - perception:result with mode reading, one check's verdict onto the Usage Log, shown on the Completion Log and on every step visit (app · API key)
arch: |
  flowchart LR
    subgraph Author["Author · Designer or iPad step page"]
      ME["expectation as the work instruction says it<br/>80 Ω ±5 % · ≤ 1.0 × 10⁻⁹ mbar·l/s · PIXMA · LUNA-4471"] --> SA["SIB oms/assertions<br/>bounds re-derived on every save · contains by default"]
      PL["Place Steps in AR<br/>read the real label → words + position · Try it as the operator"] --> SA
    end
    subgraph Device["iPad · ReadingEngine"]
      CF["cone validation frame<br/>(PresenceScorer: feature print ∨ SSIM ≥ 0.60)"] --> RE["Vision: text (en · ko · ja · zh) + barcodes<br/>3 frames for a reading · exponent join · language per line"]
      RS["reading sheet<br/>only when not legible from the cone"] --> RE
      RE --> RJ["ReadingJudge<br/>same rule as SIB · verdict in words · block or flag"]
    end
    SA -->|"step.assertions"| RJ
    RJ -->|"perception:result · mode reading"| UL["SIB usage-log<br/>readings on the step visit"]
    RJ -->|"frame = evidence"| EV["evidence · Completion Log"]
    UL --> PT["portal: Usage Log · Completion Log chips<br/>Intelligence · Insights (AROMS-354)"]
flow: |
  flowchart LR
    ME["ME types the expectation on the step (Designer or iPad)"] --> B["SIB derives min / max and the unit"]
    B --> OP["Operator frames the display or label; the device reads it"]
    B --> AU["Author reads the real label in Place Steps in AR - the words as the camera spells them, and where it sits; Try it as the operator"]
    AU --> OP["Operator: presence first in the cone, the checks read on that frame; the reading sheet only when not legible from there"]
    OP --> V["Verdict in words per check - reading sampled over three frames, barcode by payload, label by 'must say' with its language; block or flag"]
    V --> EV["Frame with the read is the evidence; a typed value is recorded as typed; chips on the Completion and Usage Logs"]
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
typed so a manager can tell a measured value from a remembered one. 2026.4.50
ships the model and authoring (AROMS-337), the iPad capture and verdict
(338), labels with their place (339), the author journey (346, 350, 351),
"must say" semantics (349), barcodes (340), instrument displays and one
validation on the floor (342, 352), reads in the Usage Log (353) and labels
in Korean, Japanese and Chinese (355). Import recognition (341) and readings
in Intelligence and Insights (354) follow.
