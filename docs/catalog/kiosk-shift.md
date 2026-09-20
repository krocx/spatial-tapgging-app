---
id: kiosk-shift
name: Kiosk shift start (identity) + product doors
area: platform
status: shipped
version: 2026.4.46
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
    T -->|Engineer+| A["authoring / operating"]
    T -->|Technician| A2["operating"]
    A & A2 --> H["Home: What are you working on?"]
    H -->|AR OMS| C["Production # (operate) · configuration (author)<br/>→ chamber QR / chamber directory"]
    H -->|Gemba Audit| GA["Project ID at walk start"]
    H -->|iLOTO| LO["Test bay # → iLOTO panels<br/>stamped on every event"]
    C & GA & LO --> U["context on every usage / event record"]
---
A shared iPad opens on a shift screen: the technician types only an employee
ID — the server resolves who they are and what they may do; engineers add
whether they author or operate this shift. Nothing else is asked there,
because the app cannot know which product the person will pick. The home
screen then offers three product doors, each asking only for its own context,
prefilled from local memory with a "Change" affordance and a "last used"
badge: AR OMS (Production # for operators, chamber configuration for
authors), Gemba Audit (Project ID at walk start) and iLOTO (Test bay #, the
raceway the panel sits in, stamped on every lock/tag event). The gate owns its
own server connection (retries, dormant-UAM skip) so it never waits on a
network probe to appear. Pre-SSO trade-off, approved: ID alone authenticates
on kiosk iPads until corporate SSO lands.
