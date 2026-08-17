---
id: encryption-at-source
name: AES-256-GCM at source
area: tags
status: shipped
version: baseline
depends: [training-capture]
terms: [SIB]
spec: ../README.md
arch: |
  flowchart LR
    subgraph Device["iOS device"]
      KEY["Per-anchor AES-256-GCM key - generated on device or by portal at anchor creation"]
      IMG["Reference frame"] --> ENC["Encrypt before any upload"]
      KEY --> ENC
    end
    ENC --> SIB["SIB stores ciphertext blobs only"]
    SIB --> VAL["Validation decrypts in-memory in image-comparator.ts"]
    KEY -.never persisted server-side.-> SIB
---
Reference imagery is encrypted on the device before it is stored; the key never
leaves the device and the server holds no plaintext. Site imagery is treated as
sensitive by construction, not by policy.
