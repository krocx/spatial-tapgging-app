---
id: kiosk-shift
name: Kiosk shift start (employee ID + Production #)
area: platform
status: shipped
version: 2026.4.45
depends: [uam, chamber-configs]
terms: [RBAC, Operator Mode]
spec: CONNECTED-WORKER.md#kiosk-shift-start
api: |
  POST /uam/login — employee-ID-only kiosk sign-in; server resolves name, email, role (app · public)
  GET /uam/me — refresh identity on launch; 401 reopens the gate (app · API key)
wireframe: operator
arch: |
  flowchart LR
    G["iOS kiosk gate<br/>employee ID → role"] --> L["POST /uam/login (kiosk path)"]
    L --> T{"role"}
    T -->|Technician| P["Production / Slot #<br/>configuration comes from the chamber QR"]
    T -->|Engineer+| A["I'm authoring (pick configuration)<br/>or I'm operating"]
    P & A --> H["Home chip: identity · Production # · configuration"]
    H --> U["work context on every usage-log session"]
---
A shared iPad opens on a shift screen: the technician types only an employee
ID — the server resolves who they are and what they may do — plus the
Production # they will work on. Both persist for the shift, ride on every usage
record, and a home chip switches technician or system between shifts. The gate
owns its own server connection (retries, dormant-UAM skip) so it never waits on
a network probe to appear. Pre-SSO trade-off, approved: ID alone authenticates
on kiosk iPads until corporate SSO lands.
