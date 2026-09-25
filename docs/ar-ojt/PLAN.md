# Plan

Status: v0.1 (2026-09-16). Order is dependency order, not phase order - we go
straight to the marker-free tracker; the items before it are its prerequisites.

## Build order

| # | Deliverable | Why first | Done when |
|---|---|---|---|
| 0 | **Recorder + replay** (`ios/Recorder`, `tools/replay`) | Field feedback becomes reproducible offline test cases; the only way the tracker can be debugged remotely | A cleanroom session replays offline and produces the same PartFrame trace |
| 1 | **PartFrame service skeleton** + `PartAnchor` + debug HUD (axes, confidence, state, per-source estimates) | Everything else plugs into it | HUD shows a fused frame from a stub source |
| 2 | **LiDAR disc fit** (PART-FRAME §4) | Initialiser and recovery; gives position/axis at ±1 cm immediately | Centre within 1 cm of the calibration grid, stationary and while sliding |
| 3 | **Yaw solve v0** (contour template) + face vote v0 (PART-FRAME §5, §8) | Completes the 6th DoF; makes content drawable | Yaw ≤ 2° on the common config; correct face after flip |
| 4 | **CAD content model** (CAD-CONTENT §2–3) + node-based step rendering on PartAnchor - *done 2026-09-18 on a tap-placed assembly pose (CAD-CONTENT §3a); PartFrame later replaces the tap* | Content appears at CAD positions with no placement | A 5-step guide renders on the tracked plate |
| 5 | **Edge-based refinement** (PART-FRAME §6) incl. assembly-state-aware model + depth residual | The tracker proper: ≤ 1 cm / 1° at 30 Hz with occlusion | Acceptance table PART-FRAME §11 |
| 6 | **Fusion + freeze/follow + pinning** (PART-FRAME §7) | Usability: rock-steady when working, catches up when moved | No visible jitter when locked; ≤ 300 ms catch-up |
| 7 | **Validation on PartFrame** (CAD-CONTENT §5: rectified captured, rendered, geometric) | K4 verdicts must survive viewpoint changes | Verdict stable across the arm's envelope |
| 8 | **OJT mode** (CAD-CONTENT §6) + usage-log `ojt` context | The product surface | Trainee session end-to-end |
| 9 | Yaw v1: Core ML landmark model from synthetic renders | Robustness under occlusion; full 6-DoF from a single frame | Replaces v0 on the common config |

Items 0–3 are one block (the tracker cannot be exercised without them);
4 can run in parallel; 5–6 is the core; 7–9 follow.

## Daily loop

1. You run the app on the common config; the recorder captures the session
   (`.arrec`, kept on the iPad; AirDrop/USB to the Mac; never in git).
2. You tell me what you saw; I replay the recording, reproduce, fix, and give
   you a build the same day.
3. Every fixed case becomes a regression recording in the private test set.

## Where testing happens

Most iteration happens **at home on the proxy rig** (HOME-TEST-RIG.md): a 1:1
plywood/MDF proxy of the cathode plate with the real hole pattern, a second
box-shaped proxy to keep the pipeline generic, a lazy-Susan turntable, a
tripod/arm, a printed calibration grid and a degree scale. Cleanroom sessions
are reserved for confirming what already works at home on the real part and
for capturing recordings of real surfaces/lighting.

A short script per session, home or cleanroom: stationary 10 s → rotate 90° in
2 s → slide 20 cm → flip → hands over top face 5 s → add two components →
pick up iPad and walk around → replace on the arm.

## Not doing (unless the tracker fails)

Marker jig; Vuforia/VisionLib-class third-party SDKs; visionOS until the
glasses assessment lands (PartFrame absorbs `ObjectTrackingProvider` as a
source when it does).
