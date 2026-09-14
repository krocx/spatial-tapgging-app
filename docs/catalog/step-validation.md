---
id: step-validation
name: Step validation — cone, quick-shot, never-stuck
area: guides
status: shipped
version: 2026.4.45
depends: [spatial-steps, patch-scoring, training-capture, usage-log]
terms: [SSIM Validation, Train in App, Evidence Capture, Pass State]
spec: CONNECTED-WORKER.md#step-validation-ssim-cone-quick-shot-never-stuck
api: |
  PUT /guides/:id/steps/:stepId/validation-ref — single reference photo (quick train) (app · API key)
  POST /guides/:id/steps/:stepId/validation-trained — stamp cone / quick-shot training on the hidden step tag (app · API key)
  GET /guides/:id/steps/:stepId/validation-ref.jpg — author's reference frame for the operator ghost, decrypted in memory (app · API key)
  POST /guides/:id/steps/:stepId/validate — score a live frame best-of against every reference (app · API key)
  DELETE /guides/:id/steps/:stepId/validation-ref — remove training, cascade hidden tag + pass-states (app · API key)
wireframe: arguides
arch: |
  flowchart LR
    subgraph Author["Place Steps in AR"]
      C["🛡 cone sweep at the pin"] --> PS[("pass-state under hidden step tag")]
      Q["📷 quick-shot + stance"] --> PS
      S["single photo → Verify"] --> PS
    end
    subgraph Operator["guide session · focus mode"]
      G["cone / ghost frame guidance"] --> AC["dwell 0.8 s or image-aligned ≥0.60 → auto-capture<br/>8 s → Capture anyway"]
      AC --> V["POST …/validate<br/>max(feature-print, SSIM) ≥ 0.60"]
      V -->|PASS| DONE["auto-complete + score"]
      V -->|FAIL| F["Retry · recovery branch · Proceed anyway"]
    end
    PS --> V
    AC -->|frame is the evidence| EV["live evidence upload"]
    F -->|overridden| UL["usage log: validation.overridden"]
---
A guide step can refuse to complete until the camera agrees the work was done —
scored by the same comparator the tag inspections use. Authors train in AR
(multi-angle cone, one-frame quick-shot with the author's stance, or a plain
reference photo); operators get cone or ghost-frame guidance, auto-capture on
dwell or image alignment, and a "Capture anyway" escape after eight seconds so
a moved QR can never trap them. A validated step always yields evidence (the
validation frame itself), FAILs can be overridden with an audit trail, and a
pose check at "I'm Here" flags scene drift before pins mislead anyone.
