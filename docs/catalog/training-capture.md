---
id: training-capture
name: Multi-angle training capture
area: tags
status: shipped
version: baseline
depends: [check-ontology]
terms: [Pass State, Train in App]
spec: SIB-TRAINING-FEATURES.md
wireframe: author
arch: |
  sequenceDiagram
    participant A as Author (iOS)
    participant G as TrainingDomeGuide / ConeCaptureView
    participant C as Device crypto (AES-256-GCM)
    participant S as SIB POST /perception/train
    participant St as Pass-state store
    A->>G: Sweep cone (19 zones) or honeycomb (7 points)
    G->>G: Lock distanceM, capture per-zone frames + depth
    G->>C: Downsample, then encrypt each frame (key never leaves device)
    C->>S: Upload PASS set (and FAIL set for dual-state tags)
    S->>St: Persist encrypted references per tag + calibration data
    S-->>A: Trained - comparator warm-up runs in background
---
Guided reference capture: a 19-zone cone dome or 7-point honeycomb hemisphere walks
the author around the feature, recording angles with depth metadata. Tags are trained
on both the correct state and the defect state (dual PASS/FAIL references) for sharper
discrimination — on the shop floor, by the person who knows the part.
