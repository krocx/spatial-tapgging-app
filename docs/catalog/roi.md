---
id: roi
name: Region of interest (ROI)
area: tags
status: shipped
version: baseline
depends: [training-capture]
terms: [Pass State]
spec: SIB-TRAINING-FEATURES.md
wireframe: author
arch: |
  flowchart LR
    PICK["ROIPickerView - author draws box on reference"] --> STORE["ROI rect stored on the tag"]
    STORE --> TRAIN["Training crops references to ROI"]
    STORE --> VAL["Validation crops live frame with the SAME shared crop math"]
    TRAIN --> CMP["image-comparator.ts scores inside the box only"]
    VAL --> CMP
    NOTE["Client and server crop math de-duplicated - one source of truth"] -.-> VAL
---
The author draws a box around the part of the frame that matters; scoring ignores
everything outside it. Backgrounds, lighting spill and neighbouring components stop
polluting the comparison.
