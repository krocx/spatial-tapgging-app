# CAD-assembly content model

Proprietary & Confidential · Applied Materials · Patent pending
Status: design v0.1 (2026-09-16)

## 1. Why

Placing a 3D model per step with a tag is labour-intensive and imprecise. The
assembly CAD already knows where every component sits relative to the base
part. Once the base part is tracked (PartFrame), every child component's pose is
known; authoring a step reduces to *choosing which components to show and how*.

## 2. Asset

One **assembly asset** per chamber configuration, exported from CAD with the
node hierarchy and node names preserved (USDZ via Reality Composer / Reality
Converter keeps them; STEP goes through our own conversion so no third-party
runtime is involved). Requirements on the export:

- the **base part** is a named node (`base`) whose local frame is the
  PartFrame origin (centre of the plate, axis = +Y, an agreed feature = +X);
- every installable component is a named node (`cmp:<partNumber>`), rigid,
  parented to `base`, in its **installed** pose;
- faces A/B of the base are distinguishable in the model (the tracker renders
  edges from it).

The CAD itself never leaves the AppliedX environment; the app receives a
derived USDZ through the SIB models API like today (`Model3D`, USDZ-only).

## 3. Steps

A step references nodes, not positions:

```jsonc
{
  "id": "step-12",
  "title": "Install upper ring",
  "nodes": [
    { "node": "cmp:0190-12345", "show": "ghost",   "animate": "insert", "axis": "-Y", "travel": 0.08 },
    { "node": "cmp:0190-11111", "show": "solid" },            // already installed, context
    { "node": "cmp:0190-22222", "show": "hidden" }
  ],
  "requiresFace": "A",
  "validation": { "mode": "rendered-reference", "roi": "cmp:0190-12345" }
}
```

Presentation modes: `hidden`, `ghost` (translucent at installed pose),
`solid`, `exploded` (offset along `axis` by `travel`), `insert` animation
(exploded → installed, looping). Everything not listed inherits the previous
step's state, so the author only edits deltas — the *cumulative* state is what
the PartFrame tracker uses as its expected geometry for that step (see
PART-FRAME.md §6).

The Procedure Designer's compiler gains a node picker; the reverse compiler
round-trips `nodes`. Guides keep `steps[]` and the branch graph unchanged.

## 3a. Assembly placement (implemented 2026-09-18, slice 1)

Until PartFrame supplies the registration live, a guide carries **one**
`assembly` record (`Guide.assembly`: `modelId`, `pose?`, `initialNodes?`,
`bounds?`, `source`). The pose is in the anchor frame and comes from exactly
one of: a single author tap on device (`tap`), the anchor's object scan
(`object`), the chamber configuration's `defaultAssemblyPose` (`config`, no
author involvement — inherited at import), or, later, the tracker
(`partframe`). Every imported step carries `cadPosition` (assembly frame —
the centroid of the parts it moves, else highlights, else reveals, else
touches); the server derives `posX/Y/Z`, `isPlaced`, `positionSource = 'cad'`
and the `assembly` model-slot offsets from the pose (`sib/src/guides/assembly.ts`),
so the current iOS app already renders the assembly at the right place.
`PATCH /guides/:id { assemblyPose }` sets it, `null` clears it (steps become
unplaced again); moving a guide to another anchor clears it. `initialNodes`
is the set-up step of the source publication: the state before step 1, on
which step deltas apply cumulatively. `bounds` lets placement UIs put the
bottom-centre of the geometry on the tapped surface rather than the CAD
origin, which is often metres away.

## 3b. Look-from-here (implemented 2026-09-18, slice 5)

`GuideStep.view` (source viewpoint: position, orientation axis-angle, optional
center, in the assembly frame) is rendered as a small camera marker child of
the assembly root (`AssemblyNode.setViewHint`), inverse-scaled so it reads the
same at any placement scale. The operator session compares the device camera
with it at 10 Hz (`viewAlignment`: metres to the viewpoint, degrees between
forward vectors) and shows a chip until aligned (0.5 m / 30°, release at
0.9 m / 45°). It is advisory only — nothing is gated on it.

## 4. Registration

Registration = PartFrame acquiring `.locked` on the base part. There is no
author placement step for models. What remains authorable is the *base frame
convention* (§2) which is set once per configuration, in CAD, not in AR.

Tags remain for what they are good at — instructions, findings, LOTO points,
validation references — and gain an optional `node` binding so a tag's pose is
derived (`node` centroid + offset) instead of placed. A `.tag` emitted for such
a part carries a `group` member per sub-assembly (kind `group`, v1.1).

## 5. Validation references

Three reference sources, selectable per step:

1. **Captured** (today): author photo, compared by SSIM after both images are
   rectified into the part frame (PartFrame §9).
2. **Rendered**: the expected assembly state rendered from the CAD at the live
   camera pose, compared against the live frame within the ROI of the target
   node. No author capture needed; works from day one of a new configuration.
3. **Geometric** (LiDAR): expected surface of the installed component vs
   measured depth in its ROI — "is there a ring there or not" — independent of
   lighting and texture. Cheap and robust for presence/absence checks.

The verdict combines what is available; the usage log records which sources
voted. Rendered and geometric references are new capabilities; captured stays
compatible with existing guides.

## 6. OJT specifics

The training mode adds: a **free explore** state (touch a component → name,
part number, install order, torque spec), **step replay** (insert animation on
demand), **assessment** (trainee performs steps; validation verdicts + time per
step go to the usage log with an `ojt` context), and **face-gated steps**
(step refuses to start until the tracker reports the required face).
