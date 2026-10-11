---
id: oakley-vanguard
name: Meta Oakley Vanguard
display: none
overlay: none
input: [voice]
delivery: spoken
notes: No display. Steps read aloud, questions answered by voice; part names and locations spoken from the CAD pin.
class: no-display
what: Sports glasses with a camera, open-ear speakers and microphones and no display at all; the paired phone does the work.
displaySpec: none
fov: camera 122 degrees ultrawide, 12 MP
weight: about 66 g
battery: up to 9 hours (Meta), 36 h more from the case
cleanroom: Open-ear speakers leave hearing free; wraparound frame; IP67; the camera is the opportunity for evidence photos (backlog).
poc: XR kit spoken profile on the paired phone: steps read aloud, pass / fail by voice.
officialUrl: https://www.meta.com/ai-glasses/oakley-meta-vanguard/
specSource: Meta product page and reviews, read 2026-10-11
image: 
imageCredit: 
imageCreditUrl: 
---
Meta Oakley Vanguard: what it can deliver for a work instruction and how it is driven.
`display` is what the device shows (full, small, text or none), `overlay`
whether a 3D model sits on the tool (3d, reduced, none), `input` how the
technician drives it, `delivery` how a guide reaches it (the SIB app, the
XR kit in a browser, paged text via a companion phone, or spoken). The
readiness matrix joins these with each step's needs
(docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).

Delivery: the XR kit's **spoken** profile on the paired phone
(`/xr?guide=…&profile=oakley-vanguard`, the QR from the portal's "Open on a
headset" dialog). The glasses are the phone's Bluetooth audio device, so
every step is read through their open-ear speakers and "next", "back",
"repeat", "pass" and "fail" are heard through their microphone array; no
maker SDK is involved. Meta's Wearables Device Access Toolkit adds the
glasses' camera (a photo for a validation step) and is a later cut in the
SIB iOS app.
