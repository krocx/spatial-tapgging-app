---
id: even-g2
name: Even Realities G2
display: text
overlay: none
input: [ring, trackpad]
delivery: companion-text
notes: Green monochrome text, one page per step via SIB on G2 in the Even app (portal code, no QR); press next, double press back, long press repeat; no model, no images.
class: binocular-glasses
what: Everyday-looking glasses with a green text display in each lens; driven from the temple touchpad or the R1 ring.
displaySpec: green monochrome MicroLED, 640 x 350, about 1,200 nits, in both lenses
fov: about 27.5 degrees
weight: about 36 g
battery: 192 mAh, about two days of typical use (Even Realities); the case recharges it
cleanroom: The lightest device here; prescription lenses; IP65; text only, no image and no model.
poc: SIB on G2 inside the Even app: one text page per step, next / back / repeat from the touchpad or ring.
officialUrl: https://www.evenrealities.com/g2
specSource: Even Realities specs and reviews, read 2026-10-11
image: 
imageCredit: 
imageCreditUrl: 
---
Even Realities G2: what it can deliver for a work instruction and how it is driven.
`display` is what the device shows (full, small, text or none), `overlay`
whether a 3D model sits on the tool (3d, reduced, none), `input` how the
technician drives it, `delivery` how a guide reaches it (the SIB app, the
XR kit in a browser, paged text via a companion phone, or spoken). The
readiness matrix joins these with each step's needs
(docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).

Delivery: **SIB on G2** (`sib/g2-client/`, docs/ar-ojt/EVEN-G2.md) - the
portal's "Open on a headset" dialog mints a six-character code; the technician
enters it in SIB on G2 inside the Even Realities app and the steps page on
the glasses, driven from the temple touchpad or the R1 ring.
