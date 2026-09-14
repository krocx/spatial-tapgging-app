---
id: usage-log
name: AR OMS Usage Log (per-step system of record)
area: guides
status: shipped
version: 2026.4.45
depends: [live-telemetry, evidence-signoff, kiosk-shift]
terms: [AR Work Instructions, Audit Logs, Evidence Capture]
spec: CONNECTED-WORKER.md#ar-oms-usage-log
api: |
  GET /guide-sessions/usage — usage sessions with per-step timing; ?workContext= ?guideId= (portal · API key)
  GET /guide-sessions/usage/export.xlsx — Excel with evidence, Configuration + Chamber columns (portal · API key)
  PUT /guide-sessions/live/:id/evidence/:stepId — live evidence upload during the run (app · API key)
  POST /guide-sessions/live/:id/events — step enter/exit, verdicts, overrides, drift (app · API key)
wireframe: portal
arch: |
  flowchart LR
    APP["iOS guide run"] -->|events| LIVE["live session (ephemeral)"]
    APP -->|"PUT …/evidence/:stepId"| EV[("guide-session-evidence/")]
    LIVE -->|derive| USE[("usage sessions - durable")]
    EV --> USE
    SO["sign-off (online or queued offline)"] -->|links, dedupes| USE
    USE --> P["Portal › AR Guides › 📊 Usage Log<br/>grouped by Production #"]
    USE --> X["GET /guide-sessions/usage/export.xlsx"]
---
Every guide run leaves a durable, per-step record derived on the server from the
live event stream: enter/exit times, duration, outcome, session totals, the
verified operator, the shift's Production # and the chamber's configuration.
Evidence photos upload while the run happens and the usage log — not the
sign-off — is the system of record; a sign-off only links and de-duplicates.
Validation verdicts, "proceeded anyway" overrides and scene-drift warnings land
on the same step entry, so the portal and the Excel tell one story.
