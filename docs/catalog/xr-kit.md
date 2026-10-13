---
id: xr-kit
name: XR assessment kit (WebXR, no engine)
area: guides
status: shipped
version: 2026.4.46
depends: [guide-bundle, live-telemetry, contextual-intelligence, evidence-signoff, qr-anchoring]
terms: [Assembly Model, Anchor, Operator Mode]
spec: ar-ojt/UNITY-RUNTIME.md
api: |
  GET /xr - the kit page; open as /xr?guide=<guideId>; ?hands=sim adds virtual hands to the desktop preview: the pointer is the fingertip, Left / Right Shift picks the hand, Space grabs, Enter is thumbs up, M marks, H calls for help, V toggles the hands (browser · same gate as the portal)
  POST /guide-sessions/live/:id/events - hands:gesture { gesture, part, did } for a held pinch / point / thumbs-up / open palm; perception:result carries the hands-at-the-part fact; step completions carry hands { tracked, inZoneSeconds, share, onPartAtCheck } (any client · API key / token)
  GET /guides/:id/bundle - everything the page loads (any client · API key / token)
  POST /guide-sessions/live - the kit opens a live session like the iPad (any client · API key / token)
  POST /guide-sessions/live/:id/observations - 1 Hz attention / distance / alignment samples (any client · API key / token)
  POST /guide-sessions - sign-off with step completions, linked to the live session (any client · API key / token)
wireframe: portal
arch: |
  flowchart LR
    P["/xr?guide=id<br/>sib/portal/xr.html<br/>own code · vendored Three.js · WebXR API"] -->|GET| B["Guide Bundle"]
    P -->|GET| G["GLB via GLTFLoader"]
    P -->|hit-test · tap| T["tap-place<br/>bottom-centre rule"]
    P -->|image-tracking where offered| Q["printed QR<br/>identity + config pose"]
    P --> E["xr-engine.js<br/>state fold + schedule<br/>= UNITY-RUNTIME §4"]
    P -->|POST| L["live session · events<br/>observations · sign-off"]
    L --> U["Usage Log · baselines · hints"]
---
A guide runs in any WebXR browser - a headset's browser, Android Chrome, or a
desktop as a 3D preview - with **no game engine and no third-party tracking**:
the page is our own code on the vendored Three.js renderer and the browser's
WebXR API. It loads the Guide Bundle, fetches the assembly GLB, and plays the
same cumulative timeline the iPad plays (the pure part of the player lives in
`sib/portal/xr-engine.js` and is unit-tested against the contract in
UNITY-RUNTIME.md §4). Placement: aim at the surface the equipment stands on
and tap; the model's bottom-centre lands on the hit point facing the operator;
tap again to move, Lock to start. Where the browser offers image tracking, the
anchor's printed QR (size from the bundle) confirms the equipment and, when the
assembly pose came from the chamber configuration, places the model directly
in the QR frame. Steps show title, text and the parts they are about (chips
pulse the part; "Show me" pulses them all; Replay re-runs the animation; the
blue camera marker shows the recommended viewpoint). Validation-required steps
take a manual Pass/Fail (`perception:result`, mode `manual`, client `webxr`).

What makes it an *assessment* kit rather than a demo: the page opens a live
session, posts step events, streams the same 1 Hz observations the iPad does
(attention target / assembly / away / panel, distance and angle to the part,
viewpoint alignment, movement, taps on right and wrong parts, replays), polls
the same hint queue, and signs off with per-step completions linked to the
live session. So a headset run lands in the Usage Log next to iPad runs,
feeds the same baselines, and can be compared step by step - which is the
evidence the TRL scorecard needs before any glasses decision.

From the portal Guide Library each guide has an **🥽 XR kit** link. On a
key-locked server the page asks for the API key once and keeps it in the
browser, like the portal.

Hands (H1, 2026.4.50): on a device whose profile says `hands: tracked`
(Quest 3, HoloLens 2) the kit asks WebXR for hand tracking and `xr-hands.js`
draws the joints as a quiet skeleton, recognises four gestures that must be
held for 0.8 s against a registration mark that locks in (pinch on a part to
take a copy into the hand and turn it; point at a part to mark it; thumbs up
to pass the check or go to the next step; open palm to call for help), lights
the step's part as the index finger approaches and holds it green when the
hand is on it, sits the step card on the back of the free hand when it faces
the viewer, and records hands-at-the-part evidence per step: time within 15
cm of the step's parts, the share of the step spent there, and whether a hand
was on the part at the check - a fact about the run, never a recording. A
device with `hands: pinch` (Vision Pro) keeps pinch-as-select; devices
without hand tracking keep the kit as it was. Own code on the WebXR Hand
Input API; virtual hands on the desktop preview (`?hands=sim`, keyboard and
trackpad the way MRTK and the Meta XR Simulator do it: the pointer is the
fingertip, Left / Right Shift picks the hand, Space grabs, Enter is thumbs
up, M marks, H calls for help, V toggles the hands; a palette does the same
by click) run the same pipeline for reviewing the look.
