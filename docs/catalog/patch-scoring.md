---
id: patch-scoring
name: Patch-grid scoring with confidence
area: tags
status: shipped
version: baseline
depends: [training-capture, roi]
terms: [SSIM Validation, Perception Layer]
spec: SIB-TRAINING-FEATURES.md
wireframe: operator
arch: |
  flowchart LR
    subgraph SIB["SIB - perception/image-comparator.ts"]
      IN["POST /perception/validate: live frame + tagId"] --> DEC["decodeReference - promise-coalesced, decrypt pass state"]
      DEC --> ROI["Apply stored ROI crop - one shared crop math"]
      ROI --> REG["Registration: align live frame to reference"]
      REG --> GRID["Patch grid comparison"]
      GRID --> WP["Worst-percentile aggregate (WORST_FRACTION)"]
      WP --> TH["Per-tag calibrated threshold"]
      TH --> OUT["PASS / FAIL + confidence 0-100%"]
    end
    OUT --> ADPT["Returned via perception-adapter.ts - model stays swappable"]
---
Live frames are registered (aligned) against the reference before a worst-percentile
patch-grid comparison with per-tag calibrated thresholds. Every check returns PASS or
FAIL plus a 0–100% confidence score — no external vendor calls, all behind the
perception adapter so the model stays swappable.
