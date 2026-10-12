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
  GET /platform/chamber - Play the chamber: one story in eight stages on a rail, before → with AR OMS → connected → ahead (The task · The slip · On hold · Right where he is · Guided and checked · Help where he is · One connected worker · Ahead); a technician in cleanroom PPE on a complex task, the tablet ten steps away, the slip on a slightly different configuration, the ME unreachable, then the step in his glasses, the amber check, the ME joining by presence, the connected systems and a look ahead to cobots and AMRs (browser · site key)
  GET /stats - the live numbers in both; presenceAnchors lights the chambers in the last beat (browser · public)
  POST /platform/assess - the six-question self-assessment, summarised at /platform/assess/summary (browser · public)
flow: |
  flowchart LR
    T["The task: instructions on a tablet ten steps away, twelve trips"] --> S["The slip: same task, different configuration, part misaligned"] --> H["On hold: lead says ask the ME; ME unavailable"]
    H --> W["Right where he is: scan, step on the part, through the glasses"] --> G["Guided and checked: cone, amber, the offset notch"] --> P["Help where he is: ME joins by presence, look here, green, evidence"]
    P --> C["One connected worker: MES · vision & quality · UAM · iPad companion"] --> A["Ahead: cobot and AMR on the same origin; the cleanroom live from /stats"]
---
Two leadership-facing pages. `/platform` is the platform in one picture: a
static drawing shared with the home hero (SIB in the centre with the live
numbers, the four products, the content lanes, governance, the devices by
eye class), the eight stops as stations on one rail with a detail panel, and
the Connected Worker maturity ladder with its self-assessment. `/platform/
chamber` is the one page that shows rather than explains: own geometry on
the vendored Three.js (a generic process module, never a real import), a
technician in cleanroom PPE with the glasses over the hood, and one story
for every shift and every tenure, told before → with AR OMS → connected →
ahead on a rail that never depends on scroll: a complex task with the
instructions on a tablet ten steps away; the slip on a configuration that is
slightly different; the lead, the unreachable ME and the work on hold; then
the step landing on the part in his glasses, the amber check catching the
misalignment in seconds, the ME joining by presence to fix it together with
evidence attached; AR OMS as the worker's side of the connected factory
(MES, vision and quality, UAM, the iPad as companion) with the outcomes said
in words; and a look ahead to cobots and AMRs on the same origin, ending on
the cleanroom lit from SIB. Machines without a usable
GPU are not played; they get the storyboard and a note. Every colour is read
from the brand tokens at runtime; no WebGL or reduced motion gives the six
stages as a storyboard. The
long-form write-up stays at /platform/long.
