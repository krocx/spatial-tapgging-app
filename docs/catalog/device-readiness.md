---
id: device-readiness
name: Device readiness (adaptive work instructions)
area: platform
status: beta
version: 2026.4.46
depends: [guide-library, xr-kit]
terms: [SIB]
spec: ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md
api: |
  GET /devices - wearable profiles from docs/devices/*.md (browser · API key)
  GET /guides/:id/readiness - per step: derived needs and, per profile, native / adapted / assisted with the reason; summary per profile (portal · API key)
  GET /guides/:id/xr-qr.png - ?profile=<id> bakes a device profile into the XR kit link (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    S["guide steps - text, pin, motion, parts, image"] --> N["stepNeeds() - text · spatial · motion · part-id · media · hands-busy"]
    D["docs/devices/*.md - display, overlay, input, delivery"] --> J["readiness join - native / adapted / assisted per need"]
    N --> J
    J --> M["portal: guide menu → Device readiness - matrix, %, CSV, open / QR per device"]
    J -.-> X["XR kit ?profile= - reduced model · text pages · spoken pages"]
---
One procedure, many wearables. Each step's needs are derived from the step
itself (text, a place on the tool, motion, parts to find, an image, hands
busy) and joined with what a device can deliver (a profile file per
wearable: display, overlay, input, delivery). The result is a readiness
matrix per guide - native, adapted or assisted per step and device, with
the reason on hover and a deliverable percentage per device - which is the
AR OMS assessment deliverable. The XR kit reads the same profile and
renders the step in the form the device allows: the reduced model without
hose flipbooks for small waveguide glasses, one step per screen paged by
ring or trackpad for text-only glasses, or the step read aloud with voice
commands for glasses without a display.
