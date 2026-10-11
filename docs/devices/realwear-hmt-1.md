---
id: realwear-hmt-1
name: RealWear HMT-1
display: text
overlay: none
input: [voice, buttons]
delivery: xrkit
notes: Monocular WVGA display worn below the eye line, read at arm's length in bright light; voice-driven (WearHF turns the buttons' words into commands); no WebXR, no SLAM; camera for photos. The XR kit's text form, one step per screen.
class: monocular
what: A rugged head-worn computer with a small display on a boom below one eye, driven entirely by voice.
displaySpec: 0.33 in colour LCD, WVGA 854 x 480, on an articulating boom; reads like a 7 in tablet at arm's length
fov: 20 degrees
weight: 380 g
battery: 3,250 mAh hot-swappable, a full shift (9-10 h, RealWear)
cleanroom: Works with any gloves, hard hat or hood; voice in noise is its strength; no WebXR and no SLAM; camera for photos. The HMT-1 is RealWear's earlier model (Navigator 500/520 succeed it).
poc: XR kit text form in its browser: one step per screen, Next / Back / Repeat as voice commands.
officialUrl: https://www.realwear.com/
specSource: RealWear HMT-1 datasheet, read 2026-10-11
image: 
imageCredit: 
imageCreditUrl: 
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
