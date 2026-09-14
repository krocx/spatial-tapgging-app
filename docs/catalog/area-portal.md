---
id: portal
kind: area
name: Team Portal
color: "#06b6d4"
order: 6
wireframe: portal
flow: |
  flowchart LR
    HOME[SIB home /] --> P[Portal /portal]
    P --> ANCH[Chambers by configuration + print-exact QR]
    P --> SESS[Sessions / Gemba walks / Usage Log review + Excel]
    P --> LIB[Guide Library: import, copy, move, publish]
    P --> LOTO[iLOTO status + audit + certs]
    P --> ADMIN[Admin: configs, users, device logs, backup]
    HOME -.compass + guided assistance.-> P
---
The browser side of the platform: manage anchors and print QR at true physical size,
review every session with evidence photos, run the Guide Library (import, move,
publish), and audit iLOTO. Read surfaces are read-only by design; destructive actions
cascade correctly and say so.
