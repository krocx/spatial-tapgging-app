---
id: backup-restore
name: Backup & restore
area: platform
status: shipped
version: 2026.4.42
depends: [self-hosted, data-admin]
terms: [SIB]
spec: INTERNAL-SERVER-DEPLOY.md
api: |
  GET /admin/backup?scope=data|full — streamed tar.gz of the data directory (portal · admin key)
  GET /admin/events — ops log of admin actions (portal · admin key)
arch: |
  flowchart LR
    BTN["Portal Settings - Backups (admin unlock)"] --> EP["GET /admin/backup?scope=data|full"]
    GATE["adminKeyAuth - every /admin path needs X-Admin-Key"] --> EP
    EP --> TAR["system tar, streamed - no archiver dependency"]
    TAR -->|data| J["JSON stores only - small, weekly"]
    TAR -->|full| F["+ evidence, world maps, models, QR + step images"]
    J --> DL["timestamped .tar.gz download"]
    F --> DL
    RES["Restore: STOP service - unpack - START (documented, deliberately not an endpoint)"] -.-> DL
    LOG[("ops-log store - every admin-gated action, pruned to 1000")] --> EV["GET /admin/events - viewer in portal Settings"]
    GATE --> LOG
---
One click in the portal produces a timestamped archive of everything SIB knows,
with live streamed-MB progress and inline status. A Render-logs-style ops log
records every admin-gated action (allowed / denied / gate-off, with IP and
backup sizes), self-pruned to the newest 1,000 — the compliance-grade iLOTO
event log remains separate and unpruned. Scopes:
data scope for the weekly habit, full scope before upgrades. Restore is a
documented stop-unpack-start procedure rather than a button — verified end to
end by an automated drill that backs up, restores into a fresh directory, and
boots with the data intact.
