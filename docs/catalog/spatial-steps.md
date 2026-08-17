---
id: spatial-steps
name: Spatially placed guide steps
area: guides
status: shipped
version: baseline
depends: [qr-anchoring]
terms: [AR Work Instructions, Anchor]
spec: ../README.md
wireframe: arguides
arch: |
  flowchart LR
    subgraph Author
      PL["GuideStepPlacementView - tap to pin each step"] --> POS["posX/Y/Z on GuideStep (device-owned)"]
      PL --> WMU["POST /worldmap/guide/:guideId/upload"]
    end
    subgraph Operator["Operator (ARGuideSessionView)"]
      QR["QR scan locks origin"] --> RELOC["Guide worldmap relocalizes"]
      RELOC --> PANEL["Floating SCNNode panels at step positions"]
      PANEL --> NAV["Nearest-step navigation overlay guides the walk"]
    end
    POS --> PANEL
    WMU --> RELOC
---
Guide steps are pinned in 3D space with floating instruction panels — the operator is
physically guided to where the work happens, in order. Panels carry title,
instruction, reference image, evidence camera and the step's Reference link.
