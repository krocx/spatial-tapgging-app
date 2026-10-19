# TestFlight

Source of truth for what testers read. `ios-app/SpatialTaggingApp/TestFlight/WhatToTest.en-US.txt`
is what Xcode Cloud attaches to a build as **What to Test**; for an Organizer
upload (Product → Archive → Distribute), paste the same text over the commit
log Xcode fills in. Both are refreshed with every iOS feature commit (rule in
CLAUDE.md), the version line first.

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
- Spatial validation: the author trains a step with a cone sweep or a quick
  shot; the operator is validated from the same viewpoint, on device and on
  the server, without being asked.
- Readings and checks: an instrument value, the words on a label, a barcode
  - read by the camera, judged on the device, said in plain words, and
  recorded with the frame as evidence. Typed only when the camera cannot
  read, and recorded as typed.
- Gemba Audit: walk an area, tag findings where they are.
- iLOTO: lockout / tagout on control panels, point by point.
- Sessions, evidence and verdicts flow to the SIB portal for the engineer
  and the lead: Completion Log, Usage Log, Intelligence and Insights.

Who it is for

Manufacturing and field engineers who write procedures, and the technicians
who run them, at Applied Materials. Internal use; an SIB server and an
account are required.

## What to Test · 2026.4.50

See `ios-app/SpatialTaggingApp/TestFlight/WhatToTest.en-US.txt` - the same
text, kept once.
