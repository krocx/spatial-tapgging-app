---
id: demo-mode
name: Demo / training mode per guide
area: guides
status: shipped
version: 2026.4.46
depends: [guide-library, contextual-intelligence, step-validation]
terms: [Operator Mode, Train in App]
spec: CONTEXTUAL-INTELLIGENCE.md
api: |
  PATCH /guides/:id - { ciMode: "demo" | null } switches a guide between demo and production hinting (portal · API key)
wireframe: portal
flow: |
  flowchart LR
    A["Guide Library › Demo"] --> G["guide.ciMode = demo"]
    G --> R["A run on the floor: floors only, no baseline tightening, more patient hints"]
    R --> U["Usage Log marks the run demo - never counted as production"]
    U --> P["Demo off → production hinting and baselines again"]
---
A guide in demo mode is for showing and for learning: the contextual engine
fires on its floors only, the learned baseline does not tighten them, and the
hints are more patient, so a newcomer or an audience is coached rather than
chased. Runs made in demo are marked as such in the Usage Log and never fold
into the production baseline or the Insights numbers, so a training session
cannot make a real guide look worse. It is a one-click switch in the Guide
Library and reversible at any time. The planned AR on-the-job training mode
(backlog #13) builds on it: demo mode with real spatial validation on.
