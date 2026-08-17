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
arch: |
  flowchart LR
    START["Preview button in the procedure bar"] --> SIM["Client-side walkthrough - nothing saved or sent"]
    SIM --> CARD["Phone-frame step card: title, instruction, image, voice via speechSynthesis"]
    CARD --> BTN{"Complete or Failed"}
    BTN --> TRAV["Traverses the REAL edge graph - success, failure, requires redirects"]
    TRAV --> HL["Canvas highlights the current step"]
    TRAV --> SUM["Exit summary - branches never exercised"]
---
▶ Preview walks the procedure as the operator will experience it: a phone-frame step
card with voice playback, Complete ✓ / Failed ✗ buttons that traverse the real edge
graph, requires-gate redirects, canvas highlight of the current step, and an exit
summary listing branches never exercised. Purely client-side; nothing is saved or
sent.
