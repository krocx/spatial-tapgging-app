---
id: gemba
kind: area
name: Gemba Walk
color: "#f59e0b"
order: 2
wireframe: gemba
flow: |
  flowchart LR
    WALK[Start walk] --> RELOC[ARWorldMap relocalizes]
    RELOC --> PIN[Tap surface: pin finding]
    PIN --> TAX[Category + severity + photo]
    TAX --> NEXT[Next walk: findings reappear in place]
    NEXT --> RES[Resolve / still present / escalate]
    RES --> PORTAL[Portal audit trail]
---
Audit rounds without preparation: no QR, no setup — tap any surface to drop a finding
and the space itself remembers where it was. Findings carry taxonomy, severity and
photos, persist across walks via ARWorldMap, and are tracked to closure in the portal.
