---
id: ipad
name: iPad / iPhone (SIB app)
display: full
overlay: 3d
input: [touch, voice]
delivery: app
notes: The reference player: ARKit anchoring, full model sized to the device, every step as authored.
class: handheld
what: The tablet every technician already knows; the SIB app runs on it with ARKit, so it is the reference every other device is measured against.
displaySpec: Liquid Retina, 11 in or 13 in; the chamber seen through the camera with the model drawn on screen
fov: the camera view, on screen
weight: about 450-580 g by model
battery: up to 10 hours (Apple)
cleanroom: Capacitive screen works through cleanroom gloves; held, on a stand or a cart; wipe-down surfaces.
poc: The reference player: SIB app, full model sized to the device, every step as authored, spatial validation through the camera.
officialUrl: https://www.apple.com/ipad/
specSource: Apple tech specs, read 2026-10-11
image: 
imageCredit: 
imageCreditUrl: 
---
iPad / iPhone (SIB app): what it can deliver for a work instruction and how it is driven.
`display` is what the device shows (full, small, text or none), `overlay`
whether a 3D model sits on the tool (3d, reduced, none), `input` how the
technician drives it, `delivery` how a guide reaches it (the SIB app, the
XR kit in a browser, paged text via a companion phone, or spoken). The
readiness matrix joins these with each step's needs
(docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).
