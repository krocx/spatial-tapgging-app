# TestFlight copy

Paste-ready text for App Store Connect. Two fields: **What to Test** (per
build, what's new on top) and the **App description** (the standing one).
Update the first section with every build; the key in brackets is the backlog
row (docs/BACKLOG.md) so a tester's note can be filed against it.

---

## What to Test · 2026.4.50

**New in this build**

Readings, labels and barcodes on a step. A step can now check what the
camera reads: a value on an instrument display (multimeter, torque tool,
leak checker), words on a label, or a barcode / QR / Data Matrix. The frame
with the read is the step's evidence.

- Label checks mean "must say", not "says only" - a real label carries more
  than the words that matter. [AROMS-349]
- Barcodes: 1D, QR, Data Matrix, PDF417 and Aztec are decoded on the same
  frame as the text; several in frame are listed by kind. [AROMS-340]
- Instrument displays: a reading is sampled three times over a second and
  the stable value kept; a display still settling says so. Scientific
  notation as leak checkers print it (1.2×10⁻⁹, 1.2E-09, mantissa and
  exponent on separate lines). [AROMS-342]
- One validation on the floor: when presence validates in the cone, the
  label or display is read on that same frame; both pass in one go when it
  is legible from there, otherwise the reading sheet opens with presence
  kept. [AROMS-352]
- Author mode: reading the real label in Place Steps in AR sets the words
  the way the camera spells them (tap the line); and "Try it as the
  operator" on any trained step shows the operator's verdict without a
  save, publish or mode switch. [AROMS-350, 351]

**Please try**

1. Operator: a step with a Text check on a printed label. Walk into the
   cone; expect one PASS covering presence and the label when the label is
   legible from where the cone fires, and "Presence OK - now read the label
   up close" otherwise.
2. Operator: a step with a Reading check on a torque or leak-check display.
   Read while the display settles; expect "display still moving" with the
   values seen, then a clean read once it holds.
3. Operator: a Barcode check on a Luna label at working distance. Note how
   large the Data Matrix has to be in frame to decode.
4. Author: Place Steps in AR → a trained step's chip → "Try it as the
   operator" → the verdict, nothing recorded.

**Also in this build**

- Every chamber shows in the Guide Library, even with no guides yet.
- The danger zone (delete everything) needs its own key.
- "Wrong QR" after creating a guide in the app is fixed.
- Build is clean for iOS 26 / Xcode 27.

**Known**

- Position checks on a label are flagged, not blocking, until the author
  trains them in Place Steps in AR.
- The two `hitTest` deprecations stay until a placement regression test on
  device [AROMS-345].

---

## App description

**Spatial Tagging for AR OMS**

Spatial Tagging puts the work instruction on the equipment. An author walks
the chamber once with the iPad, places each step of the procedure where it
happens and trains what "done" looks like; an operator scans the anchor QR,
sees the steps floating at their places and is validated as they go - by
presence in the cone, by what the camera reads on a display, a label or a
barcode, and by the evidence frame the step keeps.

What it does

- AR work instructions (AR OMS): steps pinned to the equipment, 3D parts
  shown in place, Cortona and iOMS publications imported and placed.
- Readings and checks: an instrument value, the words on a label, a barcode
  - read by the camera, judged on the device, said in plain words, and
  recorded with the frame as evidence. Typed only when the camera cannot
  read, and recorded as typed.
- Presence validation: the author trains a step with a cone sweep or a
  quick shot; the operator is validated from the same viewpoint, on device
  and on the server, without being asked.
- Gemba Audit: walk an area, tag findings where they are.
- iLOTO: lockout / tagout on control panels, point by point.
- Sessions, evidence and verdicts flow to the SIB portal for the engineer
  and the lead.

Who it is for

Manufacturing and field engineers who write procedures, and the technicians
who run them, at Applied Materials. Internal use; an SIB server and an
account are required.
