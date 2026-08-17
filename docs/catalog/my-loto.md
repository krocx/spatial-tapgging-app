---
id: my-loto
name: My LOTO
area: iloto
status: shipped
version: 2026.4.42
depends: [loto-event-log]
terms: [LOTO]
spec: ILOTO.md
wireframe: iloto
arch: |
  flowchart LR
    Q["GET /loto/my"] --> DER["Derived from the event log - locks the user currently holds, all panels"]
    DER --> LIST["MyLotoView - per-lock rows with panel + serial"]
    LIST --> DEEP["One-tap deep link into the Remove flow for that point"]
    DER --> TILE["Hub tile turns red with live count - the shift-end nudge"]
---
Every lock the user currently holds, across all panels, with a one-tap deep-link into
the Remove flow. The hub tile turns red with a live count whenever locks are held —
the shift-end nudge that stops a lock being forgotten on a breaker overnight.
