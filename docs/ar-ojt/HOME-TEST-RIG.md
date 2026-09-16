# Home test rig — testing PartFrame without a cleanroom

Proprietary & Confidential · Applied Materials
Status: v0.1 (2026-09-16)

## Principle

The tracker depends on **geometry and kinematics** (a thick disc with an
asymmetric hole pattern, resting on a plane, rotated/slid/flipped, progressively
covered by rigid components), not on the part being a real cathode plate. A 1:1
proxy with the same geometry reproduces every failure mode we care about at
home. What a proxy cannot reproduce — anodised/machined surface finish,
specular highlights, cleanroom lighting — is exactly what cleanroom sessions
are reserved for, and those are confirmation runs, not development runs.

## Rig, in order of importance

1. **Disc proxy (1:1).** Two plywood/MDF discs cut to the plate's CAD
   diameter, stacked to 7–8 cm (or one disc plus a foam ring under it — only
   the top face and the outer wall matter to the tracker). Drill or paint the
   **real hole/port pattern** from the CAD onto the top face; mark face B
   differently (different pattern or a painted sector) so flip detection has
   something to detect. A hardware store cuts discs; a printed 1:1 template of
   the pattern taped on is enough to drill by. Keep the surface matte and
   mid-grey (like the real part's reflectance class, without the speculars).
2. **Proxy CAD.** Because the proxy is *our* design, we build its CAD ourselves
   (a disc + cylinders for holes + a few blocks for "components") — no
   dependency on the company assembly for development. Same file structure as
   CAD-CONTENT.md §2 (`base`, `cmp:*`), so the pipeline is exercised end to
   end. When the real CAD arrives it's a data swap.
3. **Components.** 4–6 rigid objects that sit on the disc at defined spots:
   3D-printed or wooden blocks/rings whose dimensions are in the proxy CAD.
   These are what make the assembly-state-aware tracking testable at home.
4. **Second proxy, box shape** (a toolbox, a cardboard box with tape features,
   or a printed cuboid) with its own tiny CAD, to keep the pipeline generic
   (PART-FRAME §13).
5. **Ground truth.** A printed grid (2 cm squares) taped to the table under
   the proxy for position; a printed 360° degree scale ring around it for yaw;
   a **lazy-Susan turntable** on the grid gives repeatable rotation and lets
   you turn while both hands are free to hold the iPad. Photograph the
   protractor reading at the start of each recording.
6. **Mount.** Tripod with a tablet clamp at 50–100 cm, plus a hand-held
   segment in every script. A desk arm is a bonus, not a requirement.
7. **Lighting variants.** Overhead only, window side-light, a desk lamp at a
   low angle (worst case for edges), and dim. Each is a 30-second recording.
8. **Occlusion props.** Your hands, a cloth over half the top face, a cable
   across the rim.

## Test scripts (each one recording, ≈ 90 s)

| Script | Purpose |
|---|---|
| **S1 static** | Stationary 30 s at 50/75/100 cm → jitter floor, accuracy vs grid |
| **S2 rotate** | 0 → 90 → 180 → 270 → 360° on the turntable, 2 s per quarter, stop 3 s at each → yaw accuracy, catch-up time |
| **S3 slide** | Slide 20 cm in two directions, stop → position tracking, freeze/follow |
| **S4 flip** | Flip, wait, flip back → face vote, no false flips |
| **S5 assemble** | Add components one by one, 5 s each, then remove → assembly-state model swap, occlusion robustness |
| **S6 occlude** | Hands over top face 5 s, cloth over half, cable across rim → lost/re-acquire |
| **S7 handheld** | Pick iPad off tripod, walk a half circle, come back, replace → world-tracking absorption |
| **S8 lights** | S1 + S2 under each lighting variant |
| **S9 box** | S1–S3 on the box proxy → generality |

## Synthetic tests (no rig at all)

- **Rendered frames.** The replay tool renders the proxy CAD at known poses
  (SceneKit/RealityKit offscreen, or a Python renderer on the Mac) with a
  synthetic depth map and feeds them to stages B–F. Exact ground truth, unit
  tests for the fitter, the yaw solver and the edge tracker's convergence
  basin (how far off can the initial pose be and still converge).
- **Recording perturbation.** Replay a real recording with added depth noise,
  dropped frames, or a time-shifted intrinsics change to test robustness.

## What only the cleanroom can tell us

Surface finish / speculars on the real part, the real bench and arm, real
lighting, and whether the hole pattern on the drawing matches the part as
built. Each cleanroom visit: run S1, S2, S5 on the real part and bring the
recordings home. That is the whole cleanroom protocol.
