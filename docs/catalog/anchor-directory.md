---
id: anchor-directory
name: Anchor directory + print-exact QR
area: portal
status: shipped
version: baseline
depends: [qr-anchoring]
terms: [Anchor, QR Spatial Anchoring]
spec: SERVER-REFERENCE.md
wireframe: portal
---
Anchors are created and managed in the browser, and the QR PDF prints at true
physical size — which matters, because the printed size is what the 6-DOF tracking
trusts. Encryption keys are auto-generated for portal-created anchors.
