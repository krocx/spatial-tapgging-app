# Architecture decision records

## ADR-001 — Track a PartFrame, not "objects" (2026-09-16)
Content, validation and OJT logic are authored in the CAD base-part frame and
consume one published `PartFrame`. Pose sources are pluggable. Consequence:
swapping LiDAR fit → edge tracker → visionOS `ObjectTrackingProvider` never
touches content.

## ADR-002 — Marker-free from day one; no jig phase (2026-09-16)
Daily cleanroom feedback replaces staged de-risking. A marker jig is kept as
insurance only. Consequence: the LiDAR disc fit and the recorder are built
first because the edge tracker cannot initialise, recover, or be debugged
remotely without them — they are prerequisites, not phases.

## ADR-003 — Own code on Apple SDKs only (2026-09-16)
ARKit, Vision, Core ML, Metal, Accelerate. No Vuforia/VisionLib/OpenCV
binaries. Consequence: contour/edge/PnP/Kalman code is ours; Core ML models
are trained by us from synthetic CAD renders.

## ADR-004 — Assembly-state-aware tracking model (2026-09-16)
The tracker renders the expected partial assembly for the current step, not
the bare plate. Consequence: tracking survives progressive occlusion by
installed components; the guide runtime must publish the step index to the
tracker.

## ADR-005 — Same repo, branch `feature/ar-ojt` (2026-09-16)
AR OJT is a mode of the existing iOS app and uses SIB guides, models, usage
log, validation and the `.tag` emitter. PartFrame lives in `ios/.../PartFrame/`
as a self-contained module with no dependency on existing anchoring code.

## ADR-006 — Recordings are the debugging contract (2026-09-16)
`.arrec` sessions (RGB, depth, intrinsics, poses, intermediate estimates) are
the unit of field feedback and regression. Never committed; kept in the
private test set.

## ADR-007 — Equipment-agnostic by construction (2026-09-16)
Per-equipment knowledge is data (CAD, shape prior, face definition), never
code. The home rig exercises two shape priors so disc-specific assumptions
cannot creep in unnoticed.

## ADR-008 — Home proxy rig is the primary test environment (2026-09-16)
A 1:1 proxy with the real hole pattern reproduces every geometric and kinematic
property the tracker depends on; only surface finish and lighting differ, and
those are what cleanroom sessions are for.
