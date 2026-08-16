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
---
Live frames are registered (aligned) against the reference before a worst-percentile
patch-grid comparison with per-tag calibrated thresholds. Every check returns PASS or
FAIL plus a 0–100% confidence score — no external vendor calls, all behind the
perception adapter so the model stays swappable.
