---
id: sib-on-g2
name: SIB on G2 (Even Realities companion)
area: platform
status: beta
version: 2026.4.46
depends: [device-readiness, guide-library, xr-kit]
terms: [SIB]
spec: ar-ojt/EVEN-G2.md
api: |
  POST /guides/:id/device-code - a six-character code, ten minutes, single use, one guide; opens it in SIB on G2 (portal · API key)
  POST /g2/redeem - { code } → a device token for that guide's bundle and the session endpoints, twelve hours, sent as X-Device-Token (Even app · public, 10 tries a minute)
  GET /g2 - the companion page (sib/g2-client/, bundle under sib/portal/g2/) (Even app · public)
wireframe: portal
arch: |
  flowchart LR
    P["portal: Open on a headset → Even G2 - mints ABC-123"] --> C["SIB on G2 on the phone (Even Realities app WebView)"]
    C -->|"POST /g2/redeem"| T["device token - this guide, 12 h"]
    C -->|"bundle + sessions, X-Device-Token"| S["SIB"]
    C -->|"Even Hub SDK bridge, Bluetooth"| G["G2 glasses - one text page per step; press / double press / long press / swipe; menu Pass · Fail · First · End"]
---
Work instructions on Even Realities G2 glasses. The glasses have a green
text display, touchpads and no camera, and nothing runs on them; an Even Hub
app is a web page in the Even Realities phone app that pages containers to
the glasses over Bluetooth. SIB on G2 is that page: it takes a six-character
code from the portal instead of a QR (no camera, no site key), loads the
guide bundle with a device token scoped to that guide, and shows one page
per step - number and title, the instruction, where on the tool in words,
the parts, and how to answer a validation step. Press is next, double press
back, long press repeat, swipe scrolls, and the contextual menu carries Pass
/ Fail / First step / End guide. The phone mirrors the page and can drive
the run alone. The run is recorded exactly as an XR kit run is, so it lands
in Analytics and Intelligence. Development uses the Even Hub CLI's QR
sideload against the Vite dev server; the production bundle is committed.
