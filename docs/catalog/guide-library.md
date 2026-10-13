---
id: guide-library
name: Guide Library
area: portal
status: shipped
version: baseline
depends: [guide-lifecycle, guide-import]
terms: [AR Work Instructions]
spec: ../README.md#anchor-portal-portal
api: |
  POST /guides/:id/archive - Manager+: archive; hidden from Operator and the library's default view (unpublished); runs, evidence and usage kept; GET /guides?archived=true lists them (portal · UAM)
  POST /guides/:id/unarchive - Manager+: back to draft (portal · UAM)
  DELETE /guides/:id - Owner only: the guide, its steps, its cone-training tags and its Roadmap map go to the trash for 30 days; runs, evidence and the usage log stay; the import log goes (portal · UAM)
  GET /guides/trash - Owner: what can still be restored and until when; expired items purge hourly (portal · UAM)
  POST /guides/trash/:id/restore - Owner: the guide, its steps, tags and map come back (portal · UAM)
  DELETE /guides/trash/:id - Owner: delete now, for good; runs and evidence stay (portal · UAM)
  GET /guides/integrity - Owner / Manager: dangling references (maps, sessions, usage, steps whose guide is gone), reported never auto-fixed (portal · UAM)
  GET /guides/:id/runs-count - what a delete would leave behind, for the confirm (portal · API key)
  GET /guides - all guides across anchors (portal · API key)
  PATCH /guides/:id - publish / unpublish from the library (portal · API key)
  GET /guides/:id/steps - step list with placement status (portal · API key)
  GET /guides/:id/xr-qr.png - QR of the guide's XR kit page for AR glasses, carrying a single-use device link; guide menu → QR for AR glasses (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    LIB["Guide Library tab"] --> LIST["GET /guides + GET /guides/:id/steps"]
    LIST --> PLC["Per-step isPlaced badges - placement status at a glance"]
    LIB --> PUB["Publish / Unpublish via PATCH /guides/:id"]
    LIB --> IMP["Import button - xlsx / JSON modal with preview"]
    LIB --> GRAPH["Task graph visualisation per guide"]
    LIB --> FILT["Live filter + post-import jump-and-flash"]
---
Browse, filter, publish/unpublish, import and delete guides, with per-step placement
status at a glance. The library is where an authored or imported procedure becomes -
or stops being - something operators can see.

Lifecycle (2026.4.50, docs/GUIDE-LIFECYCLE-REVIEW.md): draft → published →
archived → deleted (30-day trash) → purged. Publishing is a Manager's
decision and needs a chamber configuration on the anchor. Archive is the
default way to take a guide off the floor; delete is an Owner's action that
keeps every run, and the trash card under Admin › Ops log restores for 30
days. Session deletion is Owner only. Every transition is one line in the
ops log.
