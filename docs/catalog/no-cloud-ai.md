---
id: no-cloud-ai
name: No cloud AI dependency
area: platform
status: shipped
version: baseline
depends: [adapter-architecture]
terms: [Adapter, Perception Layer]
spec: ../README.md
arch: |
  flowchart LR
    V["Vision OCR - on device"] --> LOCAL["Every intelligent feature local or behind an owned interface"]
    S["SSIM patch scoring - image-comparator.ts on OUR server"] --> LOCAL
    O["Whiteboard import - local Ollama"] --> LOCAL
    H["AI guide hints - rule-based adapter today"] --> LOCAL
    LOCAL --> SWAP["Vendor dies tomorrow? An adapter changes - the platform does not"]
---
Every intelligent feature is either local (on-device Vision, in-house SSIM, local
Ollama vision) or behind an interface we own. If a vendor disappears tomorrow, an
adapter changes — the platform doesn't.
