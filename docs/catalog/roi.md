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
---
The author draws a box around the part of the frame that matters; scoring ignores
everything outside it. Backgrounds, lighting spill and neighbouring components stop
polluting the comparison.
