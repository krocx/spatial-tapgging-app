---
id: realwear-hmt-1
name: RealWear HMT-1
display: text
overlay: none
input: [voice, buttons]
delivery: xrkit
notes: Monocular WVGA display worn below the eye line, read at arm's length in bright light; voice-driven (WearHF turns the buttons' words into commands); no WebXR, no SLAM; camera for photos. The XR kit's text form, one step per screen.
---
RealWear HMT-1: what it can deliver for a work instruction and how it is driven.
`display` is what the device shows (full, small, text or none), `overlay`
whether a 3D model sits on the tool (3d, reduced, none), `input` how the
technician drives it, `delivery` how a guide reaches it (the SIB app, the
XR kit in a browser, paged text via a companion phone, or spoken). The
readiness matrix joins these with each step's needs
(docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).

On the HMT-1 the guide opens in the device's browser from the "Open on a
headset" link (text form) or its QR; the XR kit recognises the device from
its user agent and lands in the text form without a profile parameter. The
buttons read Next, Back and Repeat so WearHF makes them voice commands; a
check step takes "pass" or "fail". Every run is recorded with the device, so
the scorecard's Glasses transition has a row for it.
