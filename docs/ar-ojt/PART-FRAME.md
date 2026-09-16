# PartFrame — real-time 6-DoF tracking of a moving base part

Proprietary & Confidential · Applied Materials · Patent pending
Status: design v0.1 (2026-09-16) · Owner: AppliedX

## 1. Problem

PartFrame is equipment-agnostic: it tracks whatever *base part* a configuration
names, given its CAD and a **shape prior** (§4). The first POC target is an
Etch cathode down plate; everything below is written for it, with the generic
form noted where it differs.

A technician places an Etch cathode down plate (disc, Ø 30–50 cm, 7–8 cm thick,
asymmetric features on the faces, flipped once during the job) on a bench in any
yaw, slides it, rotates it, and installs components on top of it. AR guidance
must stay registered to the plate to **±1 cm** at a working distance of
**50–100 cm**, on an **iPad Pro 11 (LiDAR)** normally mounted on a 6-DoF arm and
sometimes hand-held. The perception/validation model (SSIM step verdicts) must
keep working on top of the tracked frame.

None of the existing SIB anchoring works here: QR gate and world map assume the
part is static in the room; ARKit `ARReferenceObject` is a detector, not a
tracker (its anchor is not updated when the object moves); on iOS there is no
Apple API for dynamic object tracking (visionOS has `ObjectTrackingProvider`).

## 2. The abstraction

```swift
struct PartFrame {
    var transform: simd_float4x4      // part (CAD base frame) → ARKit world
    var covariance: simd_float3x3?     // position uncertainty, metres²
    var yawSigma: Float                // radians
    var confidence: Float              // 0…1, fused
    var state: State                   // .searching, .following, .locked, .lost
    var face: Face                     // .a, .b (flip), .unknown
    var sources: SourceMask            // which estimators contributed this frame
    var assemblyStep: Int?             // expected assembly state used for tracking
}
```

Everything above the tracker (content, validation, OJT logic) is authored in the
**part frame** = the CAD base-part coordinate system. The tracker's only job is
to publish `PartFrame` every ARKit frame. Pose *sources* are pluggable; today's
sources are §4–§6, `ObjectTrackingProvider` on visionOS is a future source with
no content change.

`transform` is published as an `ARAnchor` subclass (`PartAnchor`) so RealityKit
/ SceneKit content attaches to it exactly like today's tag anchors.

## 3. Pipeline

```
ARFrame ─┬─ RGB (1920×1440) ────────────┐
         ├─ sceneDepth (256×192) + conf  │
         ├─ camera intrinsics/pose       │
         └─ plane anchors (bench)        │
                                         ▼
  [A] Bench plane + above-plane depth segmentation
  [B] Disc fit (RANSAC circle/cylinder)  → centre, axis          5 DoF, every frame
  [C] Face classification (A/B, flip)    → which face is up
  [D] Yaw solve from asymmetric features → θ                     when moving / on init
  [E] Edge-based 6-DoF refinement vs CAD → Δpose                 every frame, 30 Hz
  [F] Fusion (SE(3) Kalman) + freeze/follow hysteresis
  [G] PartAnchor publish (+ world-anchor pin while locked)
```

Stages A–D run on the depth/RGB thread; E runs on Metal; F–G on the render
thread. Budget: ≤ 12 ms per frame at 30 Hz on A-series (M-series on iPad Pro 11
has headroom).

## 4. Source 1 — LiDAR primitive fit (initialiser, recovery, position/axis)

Each configuration declares a **shape prior** for its base part — the coarse
primitive the depth fitter looks for: `disc(radius, thickness)`,
`box(w, d, h)`, `cylinder(radius, length)`, or `mesh` (fit the CAD hull
directly by ICP once a coarse pose exists). The prior is the only per-equipment
tuning the tracker needs; everything downstream is driven by the CAD. The
cathode plate's prior is `disc`, and the plate is the easiest shape there is to
fit from depth. Per frame:

1. Take the bench `ARPlaneAnchor` (or fit one from depth on first run). Keep
   depth points with confidence ≥ medium that are 1–12 cm above the plane.
2. Project to the plane; RANSAC a circle with radius prior R ∈ [15, 25] cm
   (per-config exact radius from CAD). Inliers → least-squares circle.
3. Axis = plane normal (the plate lies flat); height from the top-face inlier
   band gives thickness → sanity check against CAD (7–8 cm) and a first flip
   cue (faces may differ in thickness profile).
4. Output centre `c` (≈ 3–6 mm σ at 75 cm from a few hundred rim points),
   axis `n`. Yaw is undetermined (symmetry) — that is stage D's job.

For a `box` prior the same stage fits the top face and two visible side
planes (3 DoF position + yaw modulo 90°, disambiguated by aspect ratio and
stage D); for `mesh` it runs a coarse ICP against the CAD hull seeded by the
principal axes of the above-plane point cloud. All priors publish the same
(centre, axis, yaw-candidates, confidence) tuple, so stages D–G never know
which primitive was used.

Why this is the initialiser: it needs no prior pose, works with hands and
installed components partially covering the top face (the rim and side wall stay
visible), and is lighting-independent. It hands stage E a pose within ~1 cm /
unknown-yaw in one frame.

## 5. Source 2 — Yaw from asymmetric features

With `c`, `n` known, yaw is a 1-D search. Rectify the top face to a canonical
top-down view (homography from the known plane and intrinsics; ~4 px/mm at
75 cm on the wide camera), then:

- **v0 (ship first):** `VNDetectContoursRequest` on the rectified face →
  contour set; match against a hole/port template rendered from CAD at 1°
  steps (360 candidates, cheap with a distance transform). Score → θ and a
  confidence. Repeated at 5 Hz while moving; once at lock.
- **v1:** a small Core ML landmark model (trained on *synthetic* renders of the
  CAD under randomised lighting/occlusion — no manual labelling) detects N named
  features (bolt holes, ports, engraving) → PnP → full 6-DoF, not just yaw. Also
  the robust **flip** cue: face A and face B have different landmark sets.

Ambiguity handling: if the template has k-fold near-symmetry, stage D reports
k candidates; stage E's edge residual disambiguates within a few frames; until
then `state = .searching` and content is not drawn.

## 6. Source 3 — Edge-based 6-DoF refinement against CAD (the tracker proper)

Classic model-based tracking (RAPiD family), our implementation:

1. Predict pose from the fused state (constant velocity).
2. Render the CAD **silhouette + crease edges** at the predicted pose (Metal,
   depth-tested so hidden edges are excluded), sample ~300 control points along
   visible edges.
3. For each control point search ±8 px along the edge normal in the camera
   image for the strongest gradient (Sobel on a downscaled luma plane; Accelerate).
4. Solve the 6-DoF update by iteratively re-weighted Gauss–Newton (Tukey weights
   kill outliers from hands/cables). 2–3 iterations per frame.
5. Residual statistics → per-frame confidence; residual > threshold for N frames
   → `.lost` → stage B/D re-initialise.

**Assembly-state-aware model.** The rendered model is not the bare plate but
the *expected partial assembly at the current step* (plate + components already
installed). As the top face disappears under components, the tracker keys on
the new geometry instead of losing it. The step index comes from the guide
runtime; on a step completion the model set is swapped. This is the capability
generic trackers cannot have — they don't know the procedure.

Depth as a second residual: LiDAR points near rendered surfaces add a
point-to-plane term (ICP-style) to the same Gauss–Newton solve. Cheap, and it
stabilises depth/scale that edges alone estimate poorly.

## 7. Fusion, freeze / follow, pinning

A constant-velocity Kalman filter on SE(3) (position + rotation-vector) with
per-source covariances: disc fit (position tight, yaw ∞), yaw solve (yaw only),
edge refinement (full, from residual covariance). Two behaviours matter more than
the filter:

- **Freeze on stationary:** when fused velocity < 5 mm/s and < 0.5°/s for
  300 ms, `state = .locked`; the PartAnchor is pinned to a world anchor so ARKit
  world tracking carries it and the overlay does not jitter while the technician
  works. Sources keep running in the background; a consistent offset > 8 mm or
  > 1.5° for 200 ms unlocks.
- **Follow on motion:** `state = .following`; trust live sources, pin released.
  Target: overlay catches up within 300 ms of the plate stopping.

Hand-held vs arm-mounted is transparent: ARKit world tracking absorbs camera
motion; the part tracker only sees relative motion.

## 8. Flip / face detection

The plate is flipped once. Face is a discrete state with its own evidence:
thickness profile (stage B), landmark set (stage D v1), and edge residual of
face-A vs face-B models (stage E). Face changes only on a confident vote across
≥ 10 frames; content for the other face is not shown until then. This makes
"which face is up" a **verified object state** that the guide can gate on
(step N requires face B).

## 9. Validation on a tracked part

Today's SSIM verdicts compare an operator capture against an author capture from
a similar viewpoint. With PartFrame the reference and the live crop are both
**rectified into the part frame** (known plane → homography) before comparison,
which removes most viewpoint variance and makes the verdict viewpoint-invariant
within the arm's working envelope. Reference captures can also be *rendered* from
the CAD at the step's expected state (see CAD-CONTENT.md).

## 10. Debuggability — the recorder

From day one the app records `.arrec` sessions: per frame RGB (JPEG q80),
depth + confidence (16-bit PNG), intrinsics, ARKit camera pose, plane anchors,
and every intermediate PartFrame with per-source estimates. A macOS/Linux replay
tool (`tools/replay`) re-runs stages A–F offline on a recording so that field
feedback ("drifts when I rotate fast") becomes a reproducible test case the same
day. Recordings never leave the AppliedX team.

## 11. Acceptance

| Metric | Target |
|---|---|
| Position error at 50–100 cm, plate stationary | ≤ 1 cm (95 %) |
| Yaw error | ≤ 1° |
| Update rate while following | ≥ 30 Hz |
| Catch-up after motion stops | ≤ 300 ms |
| Re-acquire after full occlusion / pick-up | ≤ 1 s |
| False flip detections | 0 in a session |
| Works with ≥ 60 % of top face covered by installed components | yes (assembly-aware model) |
| Frame budget | ≤ 12 ms |

Measured with the recorder against a reference: a printed calibration grid on
the bench for ground-truth position, and a protractor scale under the plate for
yaw, during the repeatable common-config test.

## 12. Non-goals (v1)

Multiple simultaneous parts; parts with no asymmetric features; base parts
that are not resting on a plane (hanging, held in a fixture at an angle);
hand-held tracking at > 1.5 m; deformable or articulated base parts.

## 13. Generality checklist (what "works for multiple equipment" means)

A new equipment onboards with: (1) the assembly CAD with a named `base` node
and frame convention, (2) a shape prior, (3) a face definition if it can be
flipped, (4) a 60-second recording on the common rig for regression. No code
change. The home test rig (HOME-TEST-RIG.md) deliberately exercises two
priors — `disc` (cathode proxy) and `box` (a second proxy) — so nothing in the
pipeline is silently disc-specific.
