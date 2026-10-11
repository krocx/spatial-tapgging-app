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
  GET /platform/chamber - Play the chamber: seven beats on a play rail, a technician in cleanroom PPE at a chamber, the step through each wearable's eye (browser · site key)
  GET /stats - the live numbers in both; presenceAnchors lights the chambers in the last beat (browser · public)
  POST /platform/assess - the six-question self-assessment, summarised at /platform/assess/summary (browser · public)
flow: |
  flowchart LR
    A["Arrive: technician in PPE at the chamber"] --> S["Scan once: one origin"] --> P["The step lands on the focus ring; the ghost"]
    P --> V["Cone of light; verdict with evidence"] --> C["ME: look here, on the slit valve"]
    C --> E["Through the eye: Quest 3 · RayNeo X3 Pro · RealWear · Oakley · iPad companion"] --> L["Live: the cleanroom, lit from /stats"]
---
Two leadership-facing pages. `/platform` is the platform in one picture: a
static drawing shared with the home hero (SIB in the centre with the live
numbers, the four products, the content lanes, governance, the devices by
eye class), the eight stops as stations on one rail with a detail panel, and
the Connected Worker maturity ladder with its self-assessment. `/platform/
chamber` is the one page that shows rather than explains: own geometry on
the vendored Three.js (a generic process module, never a real import), a
technician in cleanroom PPE with the glasses over the hood, seven beats on a
play rail that never depend on scroll, the same step seen through each
wearable's window with the iPad as the companion, and the chambers lit from
SIB in the last beat. Every colour is read from the brand tokens at runtime;
no WebGL or reduced motion gives the seven beats as a storyboard. The
long-form write-up stays at /platform/long.
