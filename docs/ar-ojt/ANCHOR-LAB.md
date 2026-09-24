# Anchor Lab — measuring anchoring accuracy at home, then in the cleanroom

Proprietary & Confidential · Applied Materials
Status: v0.2 (2026-09-24) · Owner: AppliedX

## Why

Testers said tags "snap with a slight offset". A feeling can't be improved;
a number can. Anchor Lab makes every session report *how* it found its
origin and lets a tester mark where each tag's physical feature really is,
so the error is stored in millimetres with the device, lighting, approach
angle and origin strategy that produced it. Runs are then compared on the
same number — home rig vs cleanroom, iPhone vs iPad, before vs after a
change.

Constraint honoured throughout: **one QR and nothing else in the cleanroom.**
No extra markers, no calibration sheets. The rig at home is the same: a QR
on the wall or table, the sealed world map, the equipment's own geometry.

## What changed in the app (the trust layer)

| Before | Now |
|---|---|
| Sealed origin = a matrix in meta; tags spawn the instant tracking is normal | Origin = `sib-origin` ARAnchor **inside** the map; ARKit refines it after relocalization and tags follow it |
| No notion of "settled" | Convergence gate: still < 3 mm / 0.3° for 1.5 s → *locked*; 8 s ceiling → *approximate* (said out loud) |
| Live QR ignored once the map is origin (only a > 5 cm drift note) | QR discrepancy published continuously (mm / °), recorded at lock |
| Nothing measured | Lock report + per-tag truth marks → `POST /anchors/:id/accuracy` → portal chart |

Legacy sealed maps (no origin anchor) still work from the meta pose; the
author's next relocalized Author-mode scan re-seals with the anchor.

## The Lab door (how the team runs it)

Home → **Anchor Lab** (users with the `lab` entitlement in Portal → Admin →
Users). Rigs are anchors of type LAB — they never show up in AR OMS,
Gemba or iLOTO directories, and the portal grid hides them behind a *Lab
rigs* toggle.

1. **New rig** → name it. No code is needed for the default path — the
   rig's world map is the origin. (**QR** is still there, printed at 10 cm,
   for the *QR + map* run type only.)
2. **Tap to tag** (default, no code) → look at the object and tap a real
   feature (hinge pin, screw head, corner; 3–5). The pin drops with the same
   pop / ring / haptic as AR OMS and is named *Tag N* → Save. That seals the
   map with the origin anchor at the spot you stood. Re-opening relocalizes
   into the sealed map first so more tags can be added. Do this once per
   rig. *Place with the QR* (full Author mode) remains as the secondary path.
   The Lab always requests the LiDAR scene mesh so a tap lands on the feature,
   not on the table plane behind it.
3. **Run** → pick the run type and a label chip → Start.
   - *Map only*: relocalize into the sealed map, no code in view. Look at
     the rig from roughly where the tags were placed; tags appear when the
     origin has settled.
   - *QR + map*: the gate first, then the same run view.
   The screen is clean by default — just the tags on the rig. Two toggles in
   the top bar: the origin axes, and the **Lab panel** (lock report, tag
   chips, marks). To report drift: tap a tag (or its chip), aim the **orange
   ring** — the same 3-D ring used to place tags — at its physical feature
   from ≤ 60 cm — the pin tucks to a dot as you get close (AR OMS rule) so
   the feature itself is what you aim at — then tap again or press **Mark
   where it really is**. An
   orange dot stays where you marked, with a hairline to the tag, so the
   offset is visible in the room. Two viewpoints per tag. **Done** shows this
   run's median next to the rig's history by run type.
4. **History** on the rig (or Portal → Anchors → Lab rigs → *Lab* badge)
   for the full picture.

## What a run records, and what it learns

Every **Done** posts one run record (`POST /anchors/:id/accuracy/runs`): run
label and type, device, marks, median / p90 / max, origin source, relocalize
and converge seconds, corrections, whether the session was interrupted,
whether the ghost was used, the map size — and whether the map **grew**. The
portal's Lab view lists runs newest first; the rig's History does the same.

**Map growth (Lab only, for now).** A clean run — relocalized into the sealed
map, origin *locked* (not approximate), never interrupted — saves its map
back over the sealed one if it is at least 5 % larger. Every viewpoint the
testers use is then in the map for the next run. Watch the *Runs* table: the
map column should grow over the first runs and relocalize times fall. This is
the measurement that decides whether production gets the same behaviour.

**Ghost.** Save in placement stores a photo of what the camera saw and the
pose it was taken from. In a run the ghost is off by default (toggle in the
top bar); after 8 s of relocalizing without a lock the app offers it once.
Nothing is tracked against it — it only tells a tester where to stand.

## The measurement

1. Settings → **Anchor Lab** on (tester devices only). The gate now
   requests the LiDAR scene mesh so truth raycasts hit real surfaces.
2. Enter Operator mode through the QR gate as usual. Wait for
   *Aligning…* → *Origin locked*.
3. The Lab card (trailing edge) shows the lock report: origin source,
   relocalize s, converge s, approach °, light, QR vs origin.
4. Type a **run label** once (`door · evening · 2 m`). It sticks until changed.
5. Tap a tag chip → a crosshair appears. Put the crosshair on the **physical
   feature the tag was placed on** (the hinge pin, the screw head, the corner)
   from **≤ 60 cm**, hold still, tap **Mark where it really is**.
6. The error (mm) shows in the card and is sent. Mark every tag, then repeat
   from a second viewpoint (the median of two marks per tag cancels most
   aiming error).

What the mark measures: the 3-D distance between where the tag *rendered*
and the raycast point. Aiming error at 50 cm with the crosshair is ≈ 1–2 mm;
LiDAR raycast error at that range is ≈ 3–5 mm. So the floor of this method is
about 5 mm — it can tell 5 from 15 from 40, which is what we need.

**Devices without LiDAR** run the same flow; taps and marks land on ARKit's
estimated planes instead of the mesh (the panel's *Surface* row says which).
Expect a higher floor (≈ 1–3 cm on flat features, worse on small raised
parts); compare such runs by device in the portal, never against a LiDAR run.

## Bands (used in the app, the card badge and the portal)

| Median error | Meaning |
|---|---|
| ≤ 10 mm | good — at the method's floor |
| ≤ 25 mm | acceptable for guidance; investigate if it doesn't improve with map growth |
| > 25 mm | needs work — check origin source, relocalize time, approach angle |

## Home protocol (rigorous = measured, repeated, varied)

**Rigs** — three, each its own anchor with its own QR:

- **R1 AirPods Max on a shelf.** Rich, asymmetric geometry; our best case.
  Tags on: left hinge pin, right ear-cup seam, headband centre stitch, the
  shelf corner next to it.
- **R2 HomePod.** Rotationally symmetric — depth cannot give yaw, only the
  QR can. Tags on: the power-cable exit, the top-surface centre, the
  base-to-fabric seam at the front. *Expected*: position good, yaw entirely
  from the QR; a great test that the trust layer says so instead of guessing.
- **R3 cluttered bookshelf corner** (stand-in for gas lines): 4–5 tags on
  spine edges and a shelf bracket at different depths.

**Author once per rig** from a normal standing spot, in daylight. That seals
the map with the origin anchor.

**Runs** — each run = every tag marked from two viewpoints, one run label
(the chips in the Lab door), done once as *Map only* and once as *QR + map*:

| Run label | Who / how |
|---|---|
| `author-spot · day` | you, same spot as authoring — the baseline |
| `door · day` | enter from the room door, no instructions beyond "scan the QR" |
| `opposite · day` | approach from the opposite side |
| `door · evening` | lamps only |
| `door · dim` | one lamp, far |
| `second-person · day` | someone else, no coaching |
| `after-move · day` | R1/R3 only: move an unrelated object on the shelf first |

Do each run on **both** the iPhone 17 Pro Max and the iPad. That's 7 runs ×
3 rigs × 2 devices ≈ 42 runs of 2–3 minutes; spread over a week. The
portal's Lab view then answers, per rig: median by device, by origin source
(sealed / approximate / QR) and by run — and whether relocalize/converge
times correlate with error.

**Pass criteria for this phase** (trust layer only, before map growth or
mesh-lock): R1 median ≤ 15 mm across all day runs on both devices; R2
position ≤ 15 mm and the card reporting the QR as the yaw witness; R3 ≤ 20
mm; no run where tags spawned before *locked* (convergeS always present).

## Reading the numbers

- **Error high, convergeS high (> 5 s)** → ARKit struggled to settle: the map
  was authored from one viewpoint. Next lever: map growth (successful
  sessions extend the map).
- **Error high, convergeS low, approach > 60°** → relocalization from an
  angle the map never saw; same lever.
- **Error high only in `dim`** → features lost; lighting, not anchoring.
- **QR vs origin large (> 20 mm) but tag error small** → the QR moved or the
  print size is wrong; the map is right.
- **iPad ≫ iPhone on the same rig** → device-specific; check LiDAR on/off
  and camera intrinsics, not the doctrine.
- **Every tag off by the same ~10 cm+ in one run** → the frame was replaced
  under the tags (a fresh session after an interruption). Fixed in 2026.4.46:
  the start timeout no longer fires after an interruption; marks are blocked
  while relocalizing. Discard such a run's marks (History → Clear).
- **Marks 5–8 cm off without the scene mesh** → the tap and the mark landed
  on the estimated plane behind the object, not on it. The Lab now always
  uses the mesh; runs made before that are not anchoring numbers.

## Data

`DATA_DIR/accuracy/{anchorId}.jsonl`, one `AnchorAccuracySample` per line,
capped at 5 000 per anchor. Numbers, labels and device identifiers only —
never an image, never a key. `DELETE /anchors/:id/accuracy` clears a rig's
record when the rig changes.

## Next levers (not in this phase)

1. **Map growth** — a relocalized session saves its map back; the server
   keeps versions with a quality score and promotes only a better one.
2. **Mesh-lock PartFrame** — LiDAR mesh of the equipment stored in the
   `.sib`; live depth registered against it (see PART-FRAME.md).
