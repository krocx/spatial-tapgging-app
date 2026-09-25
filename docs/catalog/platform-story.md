---
id: platform-story
name: Platform story page (/platform)
area: platform
status: shipped
version: 2026.4.46
depends: [home-page, presence-coaching, feature-catalogue]
terms: [SIB]
spec: CONNECTED-WORKER.md#platform-story-platform
api: |
  GET /stats - presenceNow / presenceAnchors light the fab grid (browser · public)
flow: |
  flowchart LR
    H["One chamber. One origin."] --> W["The WI lands where the hands go"] --> V["SIB checks the work, not the checkbox"]
    V --> C["The ME and the technician, on the same pin"] --> F["Not a slide. A fab. (live /stats)"]
    F --> D["iPad today · glasses tomorrow (FY27 POCs, trl.json)"] --> L["Connected Worker ladder · 6-question self-assessment"]
---
The leadership-facing story of the platform as one stylised chamber that the
platform happens to as you scroll, in the order a fab adopts it, ending on the
Connected Worker maturity ladder with a self-assessment. Live counters and the
fab grid read from SIB, readiness cards can be overridden from a deployment
file, Three.js is vendored with a quiet 2D fallback, and the long-form write-up
is parked verbatim at /platform/long.
