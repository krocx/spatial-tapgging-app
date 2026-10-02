---
id: oakley-vanguard
name: Meta Oakley Vanguard
display: none
overlay: none
input: [voice]
delivery: spoken
notes: No display. Steps read aloud, questions answered by voice; part names and locations spoken from the CAD pin.
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
