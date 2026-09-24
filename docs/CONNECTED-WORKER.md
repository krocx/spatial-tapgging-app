# Connected Worker — platform capabilities added in 2026.4.45 → 2026.4.46

The reference for everything the platform gained after the `.tag` emitter.
Each section is the "deep dive" behind a Feature Catalogue card; the changelog
carries the per-slice detail and the fix history. Version stamps are the
platform version the capability shipped in.

Proprietary & Confidential · Applied Materials.

---

## Kiosk shift start

*2026.4.45 · iOS + server.* The iPad opens on a shift screen whenever the UAM
allow-list is active. The technician enters **only an employee ID** — the
server resolves name, email and role (`POST /uam/login` kiosk path; the
email + ID Settings path is unchanged) — plus the **Production #** (the chamber
or system they will work on). Both persist for the shift and sit in a home
chip; tap it to change the Production # or switch technician. A 401 on the
launch refresh (revoked access) reopens the gate. The gate is deterministic:
it renders as soon as no shift is set and owns the server connection itself
(connecting state, cold-start retries, Retry, dormant-UAM auto-skip).

With Chamber Configurations the gate became two steps: employee ID, then by
role — **Technician**: Production / Slot # (the configuration comes from the
chamber QR); **Engineer+**: "I'm authoring" (pick the configuration, "+ New
configuration" inline) or "I'm operating". Known pre-SSO trade-off: the
employee ID alone authenticates on kiosk iPads until corporate SSO lands; the
allow-list remains the gate and the SSO swap point is unchanged.

## AR OMS Usage Log

*2026.4.45 · server + portal + iOS.* A durable, per-step usage record for every
guide run, derived server-side from the live-session event stream: step
enter/exit times, duration, outcome (completed / failed / left), session
totals, token-verified operator identity, the shift's **work context**
(Production # in AR OMS; other products relabel it) and — since Chamber
Configurations — the chamber's configuration at open. It survives restarts,
unlike the intentionally ephemeral live session. `GET /guide-sessions/usage`
(`?workContext=` / `?guideId=`) serves it; the portal's AR Guides tab has a
📊 Usage Log view grouped by Production # with per-step timing tables, evidence
photos, a configuration filter and an Excel export (`/guide-sessions/usage/export.xlsx`,
Configuration + Chamber columns).

**Live evidence.** Evidence photos upload during the run
(`PUT /guide-sessions/live/:id/evidence/:stepId`) and the usage log is the
system of record; a later sign-off de-duplicates against it. Offline sign-offs
finalise the record at link time even when the submit event never arrived.
Validation verdicts (`perception:result`), overrides (`validation.overridden`)
and environment drift (`environment:drift`) land on the same step entry.

## Production-verified resume

*2026.4.45 · iOS.* An interrupted guide run belongs to its Production #.
Resume snapshots are stamped with the shift's work context; picking one up on
the same Production # works silently. A snapshot from a different Production #
gets an explicit prompt — **Switch & Resume** (moves the shift to that #) or
**Start fresh on the current #** — so work is never logged against the wrong
system. Snapshots saved before Production # stamping resume as before. Pilot hardening in the
same release: fail-branch action, offline sign-off queue, name prefill from the
kiosk identity, incomplete-submit warning and redirect toast.

## Step validation (SSIM, cone, quick-shot, never-stuck)

*2026.4.45 · iOS + server.* A guide step can demand a validation verdict before
it completes, scored by the **same comparator engine** tag inspection uses
(coarse registration + SSIM / patch-grid, on-device feature-print match
combined as `max(fp, ssim)`, PASS ≥ 0.60).

- **Training (Author).** Three modes, all inside "Place Steps in AR":
  🛡 **cone** — the multi-angle sweep anchored at the step's pin, references
  stored as a pass-state under a hidden step-validation tag
  (`POST /guides/:id/steps/:stepId/validation-trained` stamps
  `validationMode: 'cone'`); 📷 **quick-shot** — one raw frame plus the
  author's stance (`cone_dist_m`, `shot_dir_*`) as a one-image pass-state;
  and the original single reference photo
  (`PUT /guides/:id/steps/:stepId/validation-ref`, Verify with
  `POST …/validate`). A toast reads *Hold steady → Training… → Trained*.
  Removing training cascades tag and pass-states; switching modes leaves no
  orphans. References on encrypted anchors are decrypted in memory only.
- **Run time (Operator).** The cone or the author's **ghost frame**
  (`GET /guides/:id/steps/:stepId/validation-ref.jpg`) guides distance, line
  of sight and aim; a RAW camera frame is scored best-of against every
  reference. **Dwell auto-capture** fires after 0.8 s steady; **image
  alignment** (feature-print ≥ 0.60 every 0.5 s) also fires it, so a moved
  QR cannot trap anyone; after 8 s the shutter becomes *Capture anyway*.
  **Focus mode** hides panels, pins and arrows during validation — target
  ring, one guidance line, ghost thumbnail, filling shutter ring, ✕.
- **Outcome.** PASS auto-completes with the score; FAIL offers Retry, the
  recovery branch, or **Proceed anyway** (usage log `validation.overridden`,
  portal badge "FAIL · proceeded", Excel "— operator proceeded"). An
  untrained-but-required step falls back to manual Pass/Fail.
- **Evidence.** A validated step always yields evidence: "Require
  validation" locks "Require evidence photo" on (server-enforced), the
  validation frame *is* the evidence photo, uploaded before scoring. Authors
  can also require a photo on any step (`evidenceRequired`, carried through
  the Procedure Designer round-trip); the operator cannot complete it
  without one.
- **Drift.** Place Steps uploads the author's camera pose with the step-1
  reference photo (`referenceCameraPose`, `GET /worldmap/guide/:id/meta`).
  At "I'm Here" the operator's pose is compared: > 0.5 m or > 25° yaw →
  "Scene may have changed — pins may be off", guidance switches to the ghost,
  `environment:drift` is logged (⚠ chip in the portal).

## Chamber Configurations

*2026.4.45 · server + portal + iOS.* A configuration is a chamber **type**
("Producer XP · Cfg A"); many physical chambers (anchors / QRs) share it.
Server: `ChamberConfig` catalog (`GET/POST /chamber-configs`,
`PATCH/DELETE /chamber-configs/:id` — engineer+; delete only when no chamber
references it), `Anchor.configId`, `PATCH /anchors/:id { assetId?, configId? }`.
Portal: Admin → 🏭 Chamber Configs; anchor cards show the configuration with
an inline assign dropdown; the Create Anchor dialog has a configuration select;
the Guide Library is grouped configuration → chamber with **⧉⧉ All N** (copy a
guide to every other chamber of the configuration as drafts, skipping chambers
that already have one of that name). iOS: role-aware kiosk (above); the
operator front door is **Scan chamber QR** (`ChamberScanView`) — the
configuration resolves from the scan, unassigned chambers and GembaWalk / iLOTO
QRs are explained; a chamber scanned in the last 10 min opens its guides
without a second scan. The author directory during an authoring shift leads
with that configuration's chambers. Content (guides, inspection sets, training)
stays per chamber — author on one, copy to the rest, place per chamber.

## Copy guide · duplicate anchor · model slots

*2026.4.45 · server + portal + iOS.*

- **Copy guide to anchor** — `POST /guides/:id/copy { anchorId, name? }`
  clones steps, titles, voice, links, step photos, branch links (re-pointed),
  completion / validation / evidence flags and 3D model assignments. Pin
  positions, model placement, validation training and the sharing list stay
  with the source anchor's world map; the copy is an unpublished draft until
  re-placed. iOS swipe "Copy to…"; portal "⧉ Copy".
- **Duplicate anchor** — `POST /anchors/:id/duplicate { assetId? }` creates a
  template copy: new id, new QR, its own encryption key, the source's
  metadata (`duplicatedFrom`), anchor type, QR print size and model kit, plus
  every guide copied as above. World map, tags, loc-tags and LOTO points are
  not copied — they describe the source's physical location.
- **Model slots** — a guide step carries up to three model slots
  (`GuideStep.models[]`), each with its own scale, opacity and device-owned
  placement; slot 1 mirrors into the legacy `modelId` fields both ways so
  older builds, the compiler, imports and the portal keep working. Place
  Steps adjusts each slot in turn, a cube toggle hides the active step's
  models, **Copy models to…** stamps them onto other placed steps. Procedure
  Designer's Inspector edits the same slots. Ghost **opacity** has a live
  slider in AR and a quick-adjust in the Guide Library.

## Sealed world maps (one localization doctrine)

*2026.4.46 · iOS + server.* *The author's world map is the origin; the QR is
the key and a drift check.* An Author **seals** the map on QR lock: the map is
uploaded together with the gravity-normalised QR pose in that map's frame
(`POST/GET /anchors/:id/worldmap/meta`). Operators relocalize into the sealed
map and place tags from the author's pose; the live QR is only compared
against it (> 5 cm / 10° → "QR moved? Using the sealed map"), with a
"reduced accuracy" fallback on timeout. Operator scans never upload a map any
more. Unsealed anchors behave exactly as before until an author scans them.
Portal shows **🗺 Map sealed · date**; `Anchor.mapSealedAt` is derived.
`DELETE /anchors/:id/worldmap` unseals (map + meta);
`DELETE /worldmap/guide/:id` resets a guide's map, photo, meta and un-places
its steps. One shared loader (`WorldMapCache`) serves the QR gate, guide
sessions and model placement — meta first, local copy reused when
`capturedAt` matches, offline degrades to the cache. Place Steps relocalizes
into the guide map too (ghost + "I'm Here", frozen pins until localized), so
author pins land where they were.

## Anchor trust layer & Anchor Lab (measured accuracy)

*2026.4.46 · iOS + server + portal.* Why tags landed "slightly off" and what
changed. The sealed origin used to be a fixed matrix (`meta.anchorPose`) and
tags were plain nodes at fixed world coordinates; ARKit's relocalization gives
a **coarse first alignment** the moment tracking turns normal, then refines its
map for a few seconds — but nothing we drew moved with it, and the tags had
already spawned.

- **The origin lives in the map.** Sealing plants an `ARAnchor` named
  `sib-origin` at the QR pose *inside* the world map. On relocalization ARKit
  restores that anchor and keeps refining its transform as the map settles;
  `lockedAnchorTransform` follows it, so every surface that repositions on
  that publisher rides the refinement. Legacy sealed maps without the anchor
  still work from the meta pose.
- **Convergence gate.** `originConfidence` goes *relocalizing → aligning →
  locked* only once the origin has been still (< 3 mm, < 0.3°) for 1.5 s with
  normal tracking; the QR gate shows *Aligning…* and holds the handoff so tags
  spawn on the settled frame. An 8 s ceiling yields *approximate* — usable,
  and it says so.
- **The QR is a witness, never ignored.** While the map or object is the
  origin, the live QR's disagreement with it is published (`qrDiscrepancy`,
  mm / °) and recorded in the session's lock report together with relocalize
  and converge seconds, ambient light and approach angle.
- **Anchor Lab** (Settings → *Anchor Lab*, Operator mode). A card shows the
  lock report; pick a tag, aim the crosshair at the **physical** feature it
  was placed on, *Mark where it really is* — the LiDAR raycast gives the real
  point, the error is the distance to where the tag rendered. Each mark is
  one `AnchorAccuracySample` (`POST /anchors/:id/accuracy`; numbers only,
  never an image) with the lock report, device, OS, app version and a free
  run label ("door · evening · 2 m"). The portal's anchor card shows
  **Lab · n · median mm**; the Lab view charts error per mark over time
  (own SVG, one colour per device, 10 / 25 mm bands) and buckets by device,
  origin source and run. `GET /anchors/:id/accuracy` returns samples +
  summary; `DELETE` clears. Protocol for the home rig:
  `docs/ar-ojt/ANCHOR-LAB.md`.
- **The Anchor Lab door.** A fourth product door for the team assessing
  anchoring, shown only to users explicitly entitled to `lab` (UAM
  products; unlike the others it is *not* implied by "all products").
  Inside: **rigs** — anchors of type `LAB` that never appear in production
  directories or the portal grid (a *Lab rigs* toggle reveals them) — each
  with *Tap to tag* (no code: the rig's world map is the origin — tap a real
  feature and the pin drops exactly as in AR OMS, named *Tag N*; Save seals
  the map with the origin anchor; re-opening relocalizes first so tags
  accumulate),
  *Place with the QR* (the full Author flow, secondary), *Run* and
  *History*. A run is one of two types operators meet in production:
  **Map only** (relocalize into the sealed map, no code in view — what AR
  work-instruction runs do) or **QR + map** (through the gate — what
  Spatial Inspection does), labelled from the protocol's chips (author
  spot, door, opposite side, evening, dim, second person, after move). The
  lean run view holds tags until the origin settles, keeps the screen clean
  (origin axes and the lab panel are toggles), and to report drift the
  tester taps a tag and aims the orange 3-D ring; every Done stores a run
  record, a clean run grows the rig's map (Lab only — the measurement before
  production gets it), and a ghost photo can be turned on to show where the
  map was made; it shows the lock report
  and the mark-truth tool, and ends in a summary: this run's median vs the
  rig's history split by run type. Samples carry `runType`; the portal Lab
  view adds a *Run type* table. Settings gain *LiDAR scene mesh* (on by
  default on LiDAR devices; the Lab is where its worth gets measured).

## Object anchoring (scan · origin · movable equipment · shape ghost)

*2026.4.46 · iOS + server.* A chamber can be found by its **shape**.

- **Scan & store.** `ARObjectScanningConfiguration` on the iPad: tap the
  floor, size the box, walk around while the point count grows, *Save
  object*. The `.arobject` (sparse point cloud — no mesh, no photo) is stored
  with `POST/GET/DELETE /anchors/:id/object` (30 MB cap) and
  `GET /anchors/:id/object/meta`. Save requires ≥ 600 points from ≥ 3 of 6
  sides; **Improve scan on this device** merges a second iPhone's scan
  (`?merge=1`) in the original frame; provenance (`scannedOn`, `mergedFrom`,
  `sides`) shows in Anchor Hub and the portal.
- **Object as origin.** `Anchor.originSource` = `worldMap` | `object`.
  Tags stay QR-relative and pins map-relative — the object supplies the frame
  through stored calibrations: `objectPoseInQR` (object meta,
  `PATCH /anchors/:id/object/meta`) and `objectPoseInMap` (guide map meta,
  `PATCH /worldmap/guide/:id/meta`). The QR gate derives the frame with
  priority **object › sealed map › live QR**; Place Steps and guide sessions
  re-base the world onto the map frame the moment the object is recognised.
- **Movable equipment.** A watchdog re-detects the object and, on a
  real move (delta + hysteresis), re-aligns with a "Chamber moved —
  re-aligned · Undo" toast; a tracking pill offers manual re-align through a
  timed finder; object-only sessions can start without a QR. The same overlay
  runs in Spatial Inspection Author / Operator and iLOTO.
- **Shape model ghost.** Pick a USDZ from the chamber's kit, fit it once
  on the chamber (`shapeModelPose` / `shapeModelScale` in the object's
  frame); every recognition and re-alignment flashes it as an indigo ghost for
  ~6 s so a glance confirms the frame.

## Presence & coaching (multi-user)

*2026.4.46 · iOS + server.* Because every device localises into the chamber's
shared frame, a colleague's camera pose is directly comparable — no ARKit
collaborative session. Server: in-memory heartbeat
`POST /anchors/:id/presence` (~2×/s; UAM-signed names cannot be spoofed),
`GET /anchors/:id/presence`, `DELETE /anchors/:id/presence/:userId`, fanned out
on `/anchors/:id/subscribe` as `presence` / `presence:joined` / `presence:left`;
nothing persisted, entries dropped after 30 s. iOS: a world-locked **lens**
(initials, name, site), a **view cone**, a pulsing **gaze dot**, edge arrows
when off screen, a roster chip and join/leave toasts. **Edit echo:** a
colleague's saved steps or tags move into place with a pulse and "Name · just
now"; a step both moved keeps yours. **Soft lock:** the step a colleague is on
carries their initials. Frames never mix: Place Steps shows people on the same
guide (map frame), Spatial Inspection Author shows Author/Operator colleagues
(QR frame), Gemba walks show auditors on the same space.

**Coaching.** The operator's guide session publishes presence too, so an
author in Place Steps sees where they are and which step. **Coach** on the
roster entry opens a message field, quick phrases and **Point here** (next
tap sends a look-here marker). `POST /guide-sessions/live/:id/hints` queues a
human hint on the same consume-once channel the AI adapter uses
(`AIHint.source: 'human'`, `from`, optional `pointer`); a `coach-hint` nudge
on the chamber feed makes the operator fetch it at once. The operator sees
"Priya says …", a haptic, and a pulsing ring + beam + "look here" label for
20 s; coach hints bypass stall/retry cool-downs.

## In-AR moment coach

*2026.4.46 · iOS.* A **moment card** appears over the live AR view the first
time a control becomes relevant — one line, one glyph, *Got it* — never
covering the camera or the AR panels. Place Steps: tap a pin to move it ·
drag/pinch/twist · ⬢1 ⬢2 ⬢3 model slots · seal vs camera training · eye/cube
declutter · Save vs Done. Guide session: tap the pill to expand · ✓ ✕ 📷 ·
one-panel eye · ghost alignment capture · ✨ hints · sign-off. Remembered
**per person** (employee ID) so a shared kiosk still teaches the next
technician. The **?** icon opens a Controls cheat-sheet, Replay tips and the
overview. Companion: the AR floating panels were redesigned (adaptive height,
state bands, chips, minimized pill) and the pulsing "tap here" hand returned
everywhere.

## Device logs (QA logging)

*2026.4.46 · iOS + server + portal.* A work iPhone cannot hand over its
console, so the app ships log lines to SIB. iOS `AppLog`: `info/warn/error`
always, `debug` with **QA Mode** (Settings → Diagnostics; per device,
auto-off after 24 h, orange badge), batches every 5 s / 50 lines, errors flush
at once, keys/tokens/base64 redacted before send, abnormal-exit marker on next
launch. Server: `POST /logs` → JSONL per device per day under
`DATA_DIR/logs/`, the server console mirrored to `server.jsonl`,
`LOG_RETENTION_DAYS` (14) pruning, `GET /logs`, `GET /logs/devices`,
`GET /logs/export.txt`, SSE `GET /logs/tail` — reads behind the admin gate.
Portal **Admin → Device Logs**: device / level / module / window / search,
live tail, Copy last 200, Download .txt. Full doc: [QA-LOGGING.md](QA-LOGGING.md).

## SIB Compass

*2026.4.46 · every web surface.* `sib/portal/compass.js`, injected by
`brand.js`: a brand-hex button bottom-right opens a radial map — SIB in the
centre; Portal / Admin / Platform / Roadmap / Catalogue / Wireframe around it
with their stops fanning out; the current node lit with the path drawn; every
node one click. Live counts from `/stats` ride on the nodes (chambers, people
on tools, runs live/today, guides placed, open findings, active locks, QA
devices); the button pulses while a guide run is live. Clickable breadcrumb
bottom-left, "Where next?" chips from the getting-started ladder, Recents.
Keys: `g g` map, `g h/p/m/r/c/w/a`, Esc. Reduced motion respected.

## Portal guided assistance

*2026.4.45 · portal.* The portal's FTUE, in the iOS tour's voice. A 🧭
**Getting started** checklist with five milestones that turn green from live
`/stats` (configuration → chamber + QR → guide → steps placed → first run),
each a link into the right page; it minimises at 3/5 and celebrates at 5/5.
**Page tours** — a spotlight walkthrough of the controls that matter on Home,
Chambers, Guide Library, AR Guides and Admin, once per page per browser; ❔
Show me replays. **Empty states become next steps.** A Guided assistance
toggle in ⚙ Settings; technicians never see it. The portal itself opens on a
tile-grid Home with a hash router and admin sub-pages.

## Platform story (/platform)

*2026.4.45–46 · web.* `/platform` is one stylised chamber that the platform
happens to as you scroll, in the order a fab adopts it: one chamber, one
origin → the work instruction lands where the hands go → SIB checks the work,
not the checkbox → the ME and the technician on the same pin → a live fab grid
from `/stats` presence → iPad today, glasses tomorrow (FY27 device POCs,
readiness cards from `/platform-media/trl.json`) → the Connected Worker
ladder (Level 1 Digital instructions · 2 Spatial & validated · 3 Connected &
coached · 4 Autonomous systems) with a six-question self-assessment. Three.js
is vendored with a 2D fallback; the full write-up lives at `/platform/long`.

## Gemba Walk additions (2026.4.46)

Covered in depth in [GEMBA-WALK.md](GEMBA-WALK.md): Audit Reference Library,
reference-list findings with category and risk, pick-don't-type
capture with six captioned photos and floating finding panels, PencilKit
photo markup with persisted strokes, walk sessions with header, summary
and a three-sheet Excel that embeds every photo, walking together
(presence on a walk), phone-down navigation with a Live Activity, resume with a
checkpoint after background or kill, custom free-text entries logged
truthfully as `custom`, and no walk without a session header.
