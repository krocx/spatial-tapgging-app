---
id: preview-mode
name: Preview mode
area: designer
status: shipped
version: 2026.4.42
depends: [procedure-maps, conditional-graph]
terms: [AR Work Instructions, Operator Mode]
spec: PROCEDURE-DESIGNER.md
wireframe: procdes
---
▶ Preview walks the procedure as the operator will experience it: a phone-frame step
card with voice playback, Complete ✓ / Failed ✗ buttons that traverse the real edge
graph, requires-gate redirects, canvas highlight of the current step, and an exit
summary listing branches never exercised. Purely client-side; nothing is saved or
sent.
