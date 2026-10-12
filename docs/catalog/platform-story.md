---
id: platform-story
name: Platform map and Play the chamber (/platform, /platform/chamber)
area: platform
status: shipped
version: 2026.4.46
depends: [home-page, presence-coaching, feature-catalogue, device-readiness]
terms: [SIB]
spec: CONNECTED-WORKER.md#platform-story-platform
api: |
  GET /platform - the platform in one picture: one drawing, eight stations on a rail, the maturity ladder and self-assessment (browser · site key)
  GET /platform/chamber - Play the chamber: one story in six stages on a rail (Night shift · The step · The check · Right · Morning · Every device); a technician in cleanroom PPE on the step that caused re-work, the amber check, the ME's look here, the green verdict, then the same step through each wearable's eye (browser · site key)
  GET /stats - the live numbers in both; presenceAnchors lights the chambers in the last beat (browser · public)
  POST /platform/assess - the six-question self-assessment, summarised at /platform/assess/summary (browser · public)
flow: |
  flowchart LR
    X["Night shift: chamber down, third week on the tool"] --> I["The step: paper says seat it flat"] --> R["The check: scan · pin · amber · ME look here"]
    R --> K["Right: reseat, green, evidence attached, beacon turns"] --> F["Morning: nobody walks the cleanroom"]
    F --> Z["Every device: the same step through every wearable, iPad companion; the cleanroom live from /stats"]
---
Two leadership-facing pages. `/platform` is the platform in one picture: a
static drawing shared with the home hero (SIB in the centre with the live
numbers, the four products, the content lanes, governance, the devices by
eye class), the eight stops as stations on one rail with a detail panel, and
the Connected Worker maturity ladder with its self-assessment. `/platform/
chamber` is the one page that shows rather than explains: own geometry on
the vendored Three.js (a generic process module, never a real import), a
technician in cleanroom PPE with the glasses over the hood, and one story
told in six stages (written on the classic plot arc, shown with plain
names: Night shift · The step · The check · Right · Morning · Every device)
on a rail that never depends on scroll: the step that caused re-work, the
first seat coming back amber, the ME's "look here" from another building,
the green verdict with evidence, the night lifting to morning, and then the
same step seen through each wearable's window with the iPad as the
companion, ending on the chambers lit from SIB. Machines without a usable
GPU are not played; they get the storyboard and a note. Every colour is read
from the brand tokens at runtime; no WebGL or reduced motion gives the six
stages as a storyboard. The
long-form write-up stays at /platform/long.
