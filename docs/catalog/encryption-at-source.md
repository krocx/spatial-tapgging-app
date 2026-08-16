---
id: encryption-at-source
name: AES-256-GCM at source
area: tags
status: shipped
version: baseline
depends: [training-capture]
terms: [SIB]
spec: ../README.md
---
Reference imagery is encrypted on the device before it is stored; the key never
leaves the device and the server holds no plaintext. Site imagery is treated as
sensitive by construction, not by policy.
