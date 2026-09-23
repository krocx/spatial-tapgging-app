# Changelog

One section per platform version (see [docs/VERSIONING.md](docs/VERSIONING.md)),
newest first. Written in the same PR as the change — if a teammate would notice
it, it gets a line.

## 2026.4.46 — 2026-09-08

### Fixed
- **Anchoring — tags no longer freeze on ARKit's first coarse alignment.**
  The sealed origin was a fixed matrix and tags spawned the moment tracking
  turned normal, before relocalization had settled, so every session
  carried a small, viewpoint-dependent offset. The origin now travels
  inside the sealed map as an `ARAnchor` (`sib-origin`) that ARKit restores
  and refines; `lockedAnchorTransform` follows it; the QR gate holds the
  handoff (*Aligning…*) until the origin has been still for 1.5 s (8 s
  ceiling → *approximate*, said on screen). The live QR's disagreement with
  the origin is published instead of ignored. Legacy sealed maps keep
  working from the meta pose until the author re-seals. Guide maps carry
  the same origin anchor (planted by Place Steps near the pins): guide runs
  and Place Steps hold their pins until it settles, and whenever ARKit later
  refines the anchor the world is re-based onto it, so pins, tags, cones
  and models are corrected together instead of drifting apart.
- **QR gate no longer stalls on a sealed map.** Staring at a 10 cm code gives
  ARKit too little to match the map against, and every detection was refused
  for 15 s. The gate now says "QR found — look around the chamber for a
  moment", and after 6 s with the QR in view and no match it falls back to
  the QR origin instead of waiting out the timeout. Vision QR detection is
  throttled to ~8 Hz (the pose comes from ARImageAnchor anyway), leaving
  ARKit the headroom it needs.
- **Camera frames no longer queue behind the UI.** ARKit delivered every
  frame callback on the main thread, so during pin/panel creation or a
  network post it kept one `ARFrame` alive per queued callback ("delegate
  is retaining 11–12 ARFrames") and then throttled the camera. The session
  delegate now runs on its own queue; the delegate only hops to the main
  actor to publish.
- **Wrong QR no longer discards the sealed map.** Scanning another
  chamber's code used to restart a fresh session; the session and its
  relocalized frame are now kept and only the wrong code's reference image
  is dropped.
- **XR kit — model drift on Android.** The kit never pinned three.js's
  reference space, so the camera rendered in `local-floor` while hit-test
  poses were taken in `local`; ARCore keeps re-estimating the floor, so the
  two spaces moved apart during a session and the placed assembly slid.
  Both now use `local` (as the three.js hit-test sample does), and the
  placement is attached to an `XRAnchor` (hit-test or image-tracking) that
  the assembly follows every frame, so map corrections move the model with
  the world instead of away from it.
- **Portal on Windows.** Modals, panels, popovers and the tour card were on
  8 %-white paper — see-through over the page. Everything that floats is
  now opaque (`--ax-solid`); native controls follow the dark scheme
  (`color-scheme: dark`, so `<select>` popups and date pickers stop
  rendering white); paragraphs no longer inherit the prose measure, which
  had pushed the home subtitle off-centre.
- **Completion log** orders anchors and guides by their most recent
  session, newest first, like the Usage Log and Intelligence.
- **Contextual intelligence — it now fires when it should.** Signals were
  purely baseline-relative, so a fresh guide (or one whose baseline was a
  tester's own wrong taps) never coached: the wrong-part cap was the past
  p90 (the more you tested, the higher it climbed), attention-off needed to
  be *below* everyone else, look-away waited 45 s, and a hint shown 5 times
  retired. Now: absolute floors (3 wrong taps · attention under 20 % over
  15 s · look-away after 20 s); baselines can only make a trigger earlier,
  never later; retirement needs 10 low-effect shows (mute: 4 of 6); the app
  flushes a wrong tap / validation attempt immediately and polls hints every
  2 s (was 5). Tests updated for the new contract.
- **AR guide session — chips no longer overlap the panel.** "Look from
  here" and the part chip sit above the measured height of the bottom
  stack (assist + panel), whatever is expanded.
- **Cortona import — findings from two real decks.** Leaf shapes with an
  empty `Material {}` now inherit the colour from their `ObjectVM`
  (greyscale imports); decks whose cameras look at the model upside-down are
  rotated so up is +Y (`__frame` root, views carried along, logged); part
  numbers join by `DocItem/@id` = DEF before the numeric `objectID`; work
  Items without text fall back to their SubStep / Step text. Tests cover all
  four; the three public demo decks import unchanged.
- **Cortona3D import failed on some publications with "Cannot read
  properties of undefined (reading 'translation')".** Small publications
  re-use an assembly with a top-level `USE X` (and IS-bound children inside
  PROTO bodies); the scene builder treated the reference as a node and read
  its transform. References now resolve through the DEF table (or are
  skipped), and every field reader tolerates a reference where a node was
  expected. Regression test added.
- **XR kit run crashed the live-session open** (`workContext.trim is not a
  function`): the kit sent an object where the iPad sends a Production #.
  The kit now sends a string and the server ignores non-string values.
- **Catalogue reads for everyone.** Internal build-phase codes (C1/C2/C3,
  B1–B3, G1–G8, R1–R5, M1/M2…) are gone from every catalogue card and the
  specs it serves (Contextual Intelligence, Connected Worker, Gemba Walk,
  .tag format, Unity runtime) — sections are named by what they do.
- **Catalogue flow + architecture diagrams are readable.** Each diagram now
  wears its product's colour (node fill, borders, arrows, and a colour bar
  on the box — the same colour as the product chip and the map), uses the
  catalogue palette and font, renders at natural size with a larger type
  (scroll sideways in the panel when wider), and the enlarge view opens at
  reading size (≥ 1.4× natural, ≥ 760 px). The side panel is wider (520 px).
- **XR kit: no animations, no part selection.** Three's GLTFLoader strips
  `:` from node names, so every `cmp:` part went unmatched. The page now
  restores the original glTF names from the loader's node associations
  (fallback `extras.def`), warns on the start card when step nodes are not
  found in the model, and ignores the click at the end of an orbit drag.
- **Part highlight spoiled the model / "Show me" lit the tapped part.** The
  highlight is now a rim glow (own Metal shader modifier): the part keeps its
  colour and shading, a cyan light hugs its silhouette and breathes. Tapping
  a part gives a white rim that fades in 1.2 s and no longer replaces the
  step focus, so "Show me" always flashes the step's own parts.
- **Assist card overlapped the part / look-from-here chips.** The chips step
  aside while the hint card is open. Portal Usage Log step rows now show
  **Attention** (on-target %, wrong-part taps, replays, aligned seconds,
  validation attempts, stall) and **Hints** (which signals fired, with the
  phrasing route in the tooltip).
- **Place Assembly showed two copies of the model while aiming / re-aiming.**
  `load()` could run twice on the same view, leaving the first node behind at
  its old pose. Load is now guarded, any stale `assembly` root is removed
  before adding, the model stays hidden until the first surface hit, Re-aim
  ghosts it and pauses the step preview (resumed after Place here).
- **AR OJT: imported assembly parts vanished after their animation.** The
  importer now reproduces the viewer's command semantics: `SwitchOFF` reads
  `Parameters` (default off, explicit on) instead of `keyValue`; absent
  command fields take PROTO defaults; `period` fractions × SubStep duration
  give real `delaySec`/`durationSec`; transparency/colour commands routed to
  Material DEFs reach their owning parts via `materialOwners`; one delta per
  part per time window, chronological; repeated colour keys become
  `effect: "flash"`. Initial hidden parts come from the scene Switches plus
  the set-up step. iOS `AssemblyNode.play` schedules each delta at its own
  offset (speed-scaled), cancels pending deltas on step change and pulses
  emission for flashes; parts stay in their final assembled location. Portal
  Guide Preview shows the part timeline. Shared: `GuideStepNode.delaySec`,
  `effect`.
- **Imported Cortona3D assembly rendered black in AR.** Our GLB carries no
  normals (viewers shade it flat); the portal's USDZ export wrote all-zero
  normals for such meshes, so SceneKit lit nothing. The converter now
  un-indexes and computes flat normals for any mesh without them before
  export. Re-run the conversion (Models → ↻ next to the USDZ badge) for models imported earlier.
- **/platform on Windows — ghost text and a stage that didn't follow the
  copy.** Root cause: the *document* scrolled long copy over full-viewport
  `position:fixed` layers (stage, veil, 2D fallback) — the Chromium ghost-
  trail bug, worst in software raster, which is exactly where a laptop with
  WebGL off lands. The document no longer scrolls at all: the copy lives in
  its own scroller (`<main>`, fixed, overflow) and the stage sits behind it
  as a plain sibling. Wheel, keys and touch over the canvas are forwarded to
  the scroller so drag-to-turn still reaches the chamber. The 3D stage now follows the **section the reader is on**
  (interpolated between section tops) instead of the page fraction, so tall
  sections on small laptops / 150 % zoom no longer push the chamber ahead of
  the text, and the last stop is always reachable; the dots and scroll map
  agree again.
- **Feature Catalogue — the stack is a staircase.** When the disc lifts,
  each floor turns so its product wedge sits one step (360°/7) further
  around the spine than the floor below — a helix, so no wedge ever piles
  onto another and the eye climbs the stack floor by floor. The turn eases
  in with the lift (the wedges swing into place during the 2D→3D flight) and
  every dependency link follows its two floors' turns. Fly-to-feature and
  the preset framing account for it.
- **Feature Catalogue — the unselected stack reads cleanly; the stack is
  alive.** Floors used to overlap in perspective before anything was selected
  (98 px apart against a 480 px disc). The disc now tightens by 24 % as it
  lifts, the gap grows to 150 and the Stack preset pitches steeper, so the
  floors sit apart. **Depth cues**: far floors, nodes and links fade with
  distance (never the selection or its neighbours); every floor casts a soft
  shadow on the one below (hidden in Under). **Idle motion**: after 4 s
  without input the stack drifts slowly, and it leans a few degrees with the
  mouse — both Full-tier, 3D-only, paused while a flight or drag runs and
  when the tab is hidden, so Lite machines pay nothing.
- **Feature Catalogue — a camera, not a slide.** Four presets (keys 1–4):
  **Top** (the flat disc), **Stack**, **Side** (floors edge-on — cross-layer
  dependencies read as wiring between storeys) and **Under** (looking up the
  spine from SIB); smooth flights between them, each framed to fill the
  viewport. **Free camera**: horizontal drag orbits, vertical drag tilts from
  top-down to beneath the floor, shift-drag pans, wheel dollies. **The camera
  goes to the feature**: selecting a node in 3D swings its product wedge to
  face you, dollies in, and makes its layer the floor you stand on — the
  floors above lift away and the ones below drop back, both faded — while
  its related nodes on other floors stay lit. Deselecting settles the floors
  back. `?cam=stack|side|under` in links; `?3d` still works.
- **Feature Catalogue — persistent scene (smooth on Windows).** The map
  used to regenerate ~90 KB of SVG markup on every frame of the 2D→3D
  rotation, every orbit step and every hover — the real reason a laptop iGPU
  sat at 10–15 fps. The scene is now built once; rotation, orbit, hover,
  selection, focus and filters only update attributes (a few hundred writes
  per frame). The disc rotation is kept as designed, now at display rate on
  both platforms.
- **Feature Catalogue frame rate on Windows.** Pan and zoom no longer
  rebuild the SVG — they move the two top-level groups (a rebuild happens
  only when the zoom crosses the label / focus thresholds); the 3D static
  layer is cached and rebuilt only when camera, filters or stats change; and
  an **effects tier** measures the first two seconds of frames and drops to
  *Lite* (no breathing nodes, turning halos, ripples or frosted-glass blur —
  each of which repaints the whole SVG every frame) when the median frame is
  over 20 ms. ✦ in the controls toggles Full / Lite and remembers it.
- **Feature Catalogue on Windows — drag selected text, flow never showed.**
  Dragging the map over SVG labels started a native text selection on Windows
  Chromium and swallowed the pan, so the page looked frozen; the map now
  disables selection and native drag, claims the pointer on `pointerdown`,
  and recovers from `pointercancel` / lost capture. The dependency **flow
  particles** were SMIL `animateMotion`, which stayed silent there — they are
  now driven from the frame loop (`getPointAtLength`), identical on every
  platform.
- **Feature Catalogue** — the live pulse (rim lines + ripples) steps aside
  while a feature is in focus, so the relationship view is uncluttered.
- **SIB Compass map was cramped; brand strip overlapped the Procedure
  Designer toolbar.** The map is now larger (up to 1180×780), hubs get
  sectors sized by their stop count, and a push-apart pass keeps every node
  ≥150 px from its neighbours. `brand.js` docks the strip into a
  `[data-brand-slot]` when a surface provides one (Procedure Designer home
  corner and editor toolbar) instead of floating over it.
- **Guide run wayfinding — arrow only when you can't see the pin (iOS)**.
  The 3D floor arrow stayed up while the pin was plainly on screen, floating
  over the model. It now hides whenever the pin is in view (central 85 % of
  the screen, in front of the camera, after a 300 ms settle so edge-grazing
  doesn't flicker) and keeps the 0.5 m arrival rule. Behind-camera fix: a pin
  behind you projects mirrored, so the edge chevron pointed the wrong way —
  the point is now flipped back, and past 120° the chevron gives way to a
  "Behind you — turn left/right · 1.2 m" pill so the technician takes the
  short turn instead of chasing a chevron around the edge.
- **Fail-state cone training froze on guide steps (iOS)**. The Fail-state
  capture is a second `ConeCaptureView` opened from the Pass-state success
  overlay. In the guide-step flow the subject position arrives as
  `forcedTagWorldPos` (the step pin) — it was not passed to the nested view,
  which then waited for a QR lock that object / sealed-map sessions never
  have: no cone, and Start Training did nothing. The pin now flows through,
  and `spawnGuide()` falls back to camera-forward instead of returning
  without a guide (never-stuck rule).
- **Step model invisible at 100 % opacity (iOS)**. Below 1.0 SceneKit renders
  a node through its transparent pass with a uniform alpha; at exactly 1.0 it
  trusts the exported materials, and USDZ converted from GLB can carry
  state that draws nothing there (opacity 0 from an alpha-blend export, fully
  metallic PBR with no environment, flipped single-sided faces). New
  `Components/ModelNodeStyle.swift` (add to the Xcode target) normalises
  materials once at load — applied in Place Steps, Place-in-AR and the
  operator ghost — and `ARSessionManager` enables `environmentTexturing`
  so PBR surfaces have something to reflect. A one-line diagnostic is
  printed per model (`[ModelNodeStyle] …`).
- **Guide evidence written outside the data root (company server)** — the
  Completion / Usage logs showed a broken thumbnail for a beat, then nothing,
  and the xlsx export had no photos. Root cause: two data roots. JSON stores,
  world maps and inspection evidence live under `SIB_DATA_DIR`; guide-session
  evidence, step-validation references and platform media used a separate
  `DATA_DIR` that defaulted to `./data` — inside the git checkout when only
  `SIB_DATA_DIR` is set (the in-house server), so the photos were outside every
  backup and gone once the checkout was touched. `sib/src/data-dir.ts` now
  resolves one root (`DATA_DIR` → `SIB_DATA_DIR` → `./data`); readers also
  look in the legacy `./data` so surviving photos still display; a startup
  notice says when that folder still has files; `sib/data/` is gitignored;
  the portal hides evidence thumbnails until the blob has loaded.
- **Object scan box edges** — the scan box was drawn with SceneKit's
  1 px `.lines` fill mode, which is hard to see and also draws the triangle
  diagonals across each face. Edges are now real tubes (thickness scales
  with the box: 2 % of its smallest side, min 4 mm) with corner beads.
- **Procedure Designer never caught up with the guide (D)** — "Edit in
  Designer" reopened the stored map as-is and only warned when the guide had
  moved on; a step added on iOS never reached the canvas, and sending from
  that canvas would have dropped it. Doctrine now: *the guide is the source
  of truth; the map is a view that keeps its presentation.* On open, when
  the guide is newer, the map is **refreshed from the guide** by per-node
  provenance — content updated in place, new steps added beside their
  predecessor, removed steps dropped with their edges, layout / shapes /
  icons / comments / annotation nodes kept, role edges rebuilt (ids reused).
  Silent with a toast ("Updated from the guide · +1 step (NewStep)") when the
  Designer has nothing unsent; otherwise a real choice: **Refresh from
  guide**, **Send my Designer edits first, then refresh**, or **Open as-is**.
  `POST /guides/:id/edit-map?mode=refresh|asis` (`conflict: true` when both
  sides changed). Unit tests (add / change / delete / layout kept /
  annotations kept / branch edges) + e2e. Roadmap client unchanged.
- **Place Steps: eye did nothing once every step was placed (iOS)** — the
  "all placed" sentinel left no active step, so focus mode had nothing to
  focus on and showed everything. Focus now follows its own memory (last pin
  tapped or placed, else Step 1) and the eye works in every state. The action
  bar's rarer actions (*Copy models to other steps…*, *Clear all pins…*) moved
  into a ⋯ menu so Save / Done never wrap on a phone.
- **Guide Library order (portal)** — newest-touched first at every level:
  guides inside a chamber, chambers inside a configuration, configurations
  themselves (iOS step edits count — they bump the guide's `updatedAt`).
- **Place Steps opened in the wrong frame — author pins never where they were
  placed (A, iOS)** — Place Steps started a fresh ARKit session and drew the
  saved pin coordinates (which belong to the original session's frame) in it,
  so pins landed wherever the new origin happened to be, and Save wrote those
  positions back. Nothing to do with QR distance — the map was never loaded.
  Place Steps now opens like the operator session: the guide map loads through
  `WorldMapCache`, the Step-1 ghost photo shows, and pins stay hidden until
  ARKit reports the space matched — then they snap in by themselves (haptic),
  exactly like the operator session. If matching times out (15 s) the author chooses **Keep looking** or
  **Re-place all pins in a fresh map** — never a silent wrong frame. Save/Done
  upload a map only when the session frame is the map's frame (extending it);
  in re-place mode, steps not re-placed have their stale position cleared so
  no pin can point into the old frame. Guides saved before maps existed get
  the same choice.
- **Validation ghost rotated 90° on iPad Pro in landscape (C, iOS)** — five
  capture sites rotated the sensor buffer with a hard-coded "screen is
  portrait" (`.oriented(.right)`), so references trained on a landscape iPad
  were sideways against the live view and the comparator scored rotated
  frames. One helper, `ARFrameImage.screenOriented`, rotates by the current
  interface orientation at every site (quick-shot, cone, honeycomb, guide
  validation, inspection). Author and operator captures now match whenever
  both work in the same orientation. References already trained in landscape
  on an iPad need one re-train. New file `Services/ARFrameImage.swift` (add to
  the Xcode target).
- **Place Steps: only one model could be adjusted (iOS)** — model slots were
  reachable only through the pin-drop chain, so a step whose pin was already
  placed (or whose 2nd/3rd model was added later in the editor) had no way to
  position the extra models, and re-tapping the pin restarted the chain from
  slot 1. Every placed step's tray chip now shows one ⬢1 / ⬢2 / ⬢3 button per
  model (indigo = positioned, orange = not yet); tapping it adjusts that slot
  alone — loaded at its saved offsets, or at the pin if never positioned —
  with Confirm returning to pin placement and Cancel restoring the model.

### Added
- **Anchor Lab — anchoring accuracy as a number.** Settings → *Anchor Lab*
  adds a card in Operator mode with the session's lock report (origin
  source, relocalize / converge seconds, approach angle, light, QR vs
  origin) and a per-tag *Mark where it really is* tool: aim the crosshair
  at the physical feature, the LiDAR raycast gives the true point, the
  rendered-vs-physical error in mm is sent as an `AnchorAccuracySample`
  (`POST /anchors/:id/accuracy` — numbers only, never images) with device,
  OS, app version and a free run label. Portal anchor cards show
  **Lab · n · median mm**; the Lab view charts error per mark over time
  (own SVG, colour per device, 10 / 25 mm bands) and buckets by device,
  origin and run; `GET`/`DELETE /anchors/:id/accuracy`. Home protocol:
  `docs/ar-ojt/ANCHOR-LAB.md`.
- **Anchor Lab door.** A product door for the team assessing anchoring,
  visible only to users explicitly entitled to `lab` (UAM products — not
  implied by "all"). Rigs (anchors of type `LAB`, hidden from every
  production directory and from the portal grid unless *Lab rigs* is
  ticked) with Print QR, Place tags (the real Author flow), Run and
  History. Runs are *Map only* (relocalize, no code in view) or *QR + map*
  (through the gate), labelled from the protocol's chips; the lean run view
  holds tags until the origin settles, offers the mark-truth tool, and ends
  in a summary against the rig's history by run type. `runType` on
  accuracy samples; portal Lab view gains a Run-type table. Settings:
  *LiDAR scene mesh* (on by default on LiDAR devices).
- **Per-step operator context.** In the Designer (parts block and Parts
  Studio) each step chooses what the operator sees around the parts being
  installed: *Installed only* (default), *Whole · ghost* (the whole assembly
  as a faint outline — orientation without losing progress) or *Whole ·
  solid*, with "all steps" to apply it everywhere. The 3D preview shows the
  chosen context; `GuideStep.context` carries it (compiler, reverse compiler,
  ingest); on the iPad the step opens in that context and the cube button
  still overrides per step; the portal Guide Preview notes it.

### Fixed
- **XR kit on headsets: step navigation was invisible.** The card was an
  HTML overlay (WebXR `dom-overlay`), which Android Chrome draws inside the
  session and Meta Quest Browser does not — on Quest you could place the
  model and then saw no steps. When a session starts without a DOM overlay
  the same card is now drawn in the world (`xr-panel.js`: canvas texture on a
  plane that lazily follows the head, ~1.1 m ahead) with the same buttons —
  Lock placement, Back / Replay / Show me / Next, Pass / Fail, hint "Got it",
  End session — hit by controller ray, hand pinch or screen tap, with hover
  highlight and a short pointer ray. The DOM stays the source of truth (the
  panel mirrors it and clicks the matching button); sign-off leaves immersive
  mode so the HTML form shows. `?panel=1` forces the panel on Android for
  testing.
### Fixed
- **Cortona3D import: DEF names with spaces.** Some publications name nodes
  straight from part descriptions ("DEF Callout_P/N_-_0022-22449_HOUSING
  LIFT_e0c"), which VRML97 forbids but Cortona's viewer accepts; the parser
  failed with `expected "{"`. DEF now takes everything up to the node type,
  and USE / ROUTE resolve those names too.
### Fixed
- **Operator top bar on phones.** The icon cluster wrapped ("2 / 18" stacked
  vertically) and the title truncated mid-word. The bar now keeps Exit and
  the icons at their natural size, gives the title the remaining width, drops
  the redundant "n / total" (the panel already says "Step 2 of 18" — the
  progress ring stays) and strips the Designer's "[Guide] " prefix.
### Fixed
- **Build-up guides start empty.** A part no step installs was treated as a
  visible "base", so a build-up from a full CAD assembly showed the whole
  thing and only highlighted the step's part. Build-up now hides the model's
  root nodes in the initial state (ingest) and the designer preview/tree treat
  unassigned parts as "later"; take-apart is unchanged. `GuideAssembly.start`
  carries the mode; the iPad registers unnamed nodes under the same
  `node<i>` name the server uses.

### Added
- **Parts Studio, auto-pins and part sets (Procedure Designer).** The parts
  picker opens full-screen as the *Parts Studio*: model large on the left,
  parts on the right, ◀ ▶ / ← → and a step strip along the bottom to walk the
  whole procedure without leaving the view (the model stays loaded). A ticked
  group covers all its children and a ticked child overrides its group — the
  same rule in the preview, the tree, the compiler and on the iPad. Steps that
  list parts now get their CAD pin automatically at the centre of those parts
  (from the GLB's accessor bounds, no geometry decoding), so once the assembly
  is placed on device every step is placed — Place Steps is no longer needed
  for a designer-authored assembly guide. Reusable **part sets** ("Bolt set
  A") are saved on the map and applied to a step with one click. Fixes:
  three.js strips `:` from node names — the preview now matches on the
  original name; imported initial-hidden parts count as "later".
- **Parts per step in the Procedure Designer + whole-assembly context on
  device.** A procedure map binds one assembly model (procedure bar: model +
  *build up* / *take apart*); every step then picks the parts it installs from
  a searchable part tree with an in-browser 3D preview (this step / installed
  earlier / later, click a part to toggle it). No server GPU: the part tree is
  read from the GLB's JSON chunk (`GET /models/:id/nodes`) and the preview
  renders in the author's browser with the vendored three.js. The compiler
  derives per-step node deltas and the initial state; warnings for a step with
  no parts, a part listed twice, and parts without an assembly. Cortona3D
  presentation (motion, view, CAD pins) round-trips through the designer
  verbatim — re-sending an imported guide no longer drops it. On the iPad every
  named GLB node is now a part (not only `cmp:*`), and the operator gets a
  "Show whole assembly" button that ghosts the not-yet-installed parts for
  orientation (per step). Rebuild the designer bundle on the Mac before pushing:
  `npm run build --workspace=@spatial/roadmap-client`.
- **Model orientation per step + one-tool-at-a-time placement (iOS).** A part
  that the operator flips over between steps can now be shown flipped: every
  model slot carries `modelRotationX` / `modelRotationZ` (tilt / roll) beside
  the existing Y turn, persisted by the server, honoured by the operator's
  ghost overlay and copied with the guide. Placing a model — Place Model,
  per-step slot adjustment and Place Assembly — now uses one shared toolbar
  (`PlacementTools.swift`): pick **Move · Lift · Turn · Tilt · Scale** and
  only that gesture is live, so a pinch can no longer sneak a scale into a
  turn. Turn/Tilt snap softly to 15° with a live readout; quick actions
  **Flip 180°**, **Turn 90°**, **Reset** and **Copy previous** (same slot on
  the nearest earlier step, re-based on this step's pin). One-time coach line
  on first use. Guide Library step rows show the orientation ("turn 180° ·
  tilt 90°") so an author can see which steps flip the part.
- **Insights** — the leadership view under AR Guides Sessions. Headline
  tiles (runs, completion rate, typical run time, hints that helped, wrong
  parts per run) each with a sparkline and a delta against the previous
  period; runs-per-day bars with completions; the "hints that helped" line;
  a per-guide table with typical / slowest-tenth times and the Intelligence
  heat strip per step, linking to the hottest step. 7 / 30 / 90-day window,
  configuration and guide filters, *Save as image* for decks. Own SVG, no
  chart library. `GET /guide-sessions/insights` (`oms/insights.ts`, pure,
  tested) derives everything from the usage log.
- **Icons are identity.** Section tabs carry their icons; the brain marks
  Intelligence everywhere and the four-point sparkle (the app's contextual
  hint mark) sits on every hints column, tile and chart. Two sprite
  additions: `sparkles`, `insights`.
- **Portal home** — larger tiles with product-coloured icon tiles and
  stat chips (the same family as the SIB home doors and the Roadmap home);
  the registration mark no longer sits before the wordmark in the header.
- **Demo / training mode per guide.** `Guide.ciMode = 'demo'` (Guide Library
  → *Demo* button; `PATCH /guides/:id { ciMode }`): floors only, no
  baselines, no retirement — every run coaches the same way. Intelligence
  shows an *Engine* line per step with what it currently needs to fire
  (wrong taps · attention % · look-away s · dwell s, and the mode).
- **AR guide tag — tucks when you're close.** Under 0.35 m the 3D pin folds
  to a small dot (badge and ring fade, 220 ms); past 0.5 m it registers
  back. Explained once. The pin is sized to the part it marks (2.5 cm ring
  minimum, full size from ~9 cm parts). The eye button now cycles
  tag + panel → all steps → panel only → tag only → hidden, with a 1.5 s
  label; remembered per device.
- **Intelligence — "why this number".** The heat chip on every step now
  explains itself: hover or focus it for the weighted breakdown (each
  signal's rate × weight, the sum, the bands). Steps with fewer than 3
  completed visits show heat as *provisional* in grey — in the chip, the
  card edge and the strip — with a note on how far one visit moves the score.
- **Design system — slice 2: the Portal.** `sib/portal/index.html` now runs on
  `brand.css`: its palette is the app's tokens (charcoal page, 8 %-white
  cards, the iOS accents, product colours on the home tiles), every emoji
  (175 of them) is a sprite icon or plain text, the header carries the
  registration mark and the `appliedx` wordmark component, the Intelligence
  page is built from `.ax-card--product` / `.ax-tiles` / `.ax-heat` /
  `.ax-table` / `.ax-chip` / `.ax-bar`, and the portal joins the governed
  list — `npm run brand:check` passes with it. No behaviour changes.
- **Design system — slice 1.** SIB now has one look, written down once in
  `sib/portal/brand/`, and it is the iPad app's look: tokens transcribed
  from the kiosk, hubs and sheets (charcoal gradient page, 8 %-white cards
  with accent strokes, white text in the app's opacity tiers, the iOS system
  accents, 18-pt cards / 14-pt CTAs / 12-pt fields / capsule chips), the
  door colours as product colours, components shaped like their iPad
  counterparts (doors, buttons, chips, cards, tables, notices, forms, tiles,
  bars, heat strips, empty states), the appliedx wordmark component, the
  registration mark + lock-in motion, Arial (the company standard) at the
  app's text scale, and an icon sprite that replaces
  every emoji (`npm run brand:icons`, 96 icons). `/brand` is the living
  brand guidelines site — chapters with a tracking side nav (principles,
  "same family" kiosk-beside-portal, wordmark with do/don't, colour, mark
  & motion, typography, components in use, the AR surface, icons, voice,
  rules, roadmap) rendered from that same CSS; `npm run brand:check` fails a
  governed page on any drift; `docs/BRAND.md` is the doctrine and
  `CLAUDE.md` states it for anyone generating pages in this repo. No
  existing page changed yet — portal and catalogue migrate next.
- **Effectiveness loop + portal Intelligence page (C3).** Every automatic
  hint is now scored by what happened after it — from the raw observation
  samples and the visit outcome (completed within the window, no more
  wrong-part taps, attention back on the part, viewpoint reached, validation
  passed). Per step and signal, over the last 50 visits, a hint that helps
  fewer than 30 % of the time (≥ 5 shown) or is muted half the time (≥ 4)
  is **retired** on that step — C2 stops firing it — and comes back on its
  own when newer runs improve; where LLM and template phrasings both have
  evidence and the LLM scores lower, the step falls back to the template.
  `GET /guide-sessions/intelligence/:guideId` returns per-step heat (left /
  validation / wrong-part / stall / attention / viewpoint rates), the hint
  table and author-facing fix notes. Portal: AR Guides Sessions → **🧠
  Intelligence** (guide picker, heat strip, rate tiles, hint table with 🔕
  retired badges, notes). Tests `intelligence.test.ts`.
- **XR assessment kit — `/xr?guide=<id>` (B3).** A guide runs in any WebXR
  browser (headset browser, Android Chrome) or as a desktop 3D preview with
  no game engine and no third-party tracking: own code on the vendored
  Three.js and the browser's WebXR API. It loads the Guide Bundle and the
  GLB, tap-places the assembly (bottom-centre rule, facing the operator;
  the printed QR confirms identity where the browser offers image tracking
  and places directly for configuration poses), plays the same cumulative
  timeline as the iPad (pure engine in `sib/portal/xr-engine.js`, tested
  against UNITY-RUNTIME §4), shows step text + part chips + viewpoint
  marker, takes manual Pass/Fail on validation steps, and posts the same
  live session, step events, 1 Hz observations, hint polls and sign-off —
  so headset runs land in the Usage Log and baselines next to iPad runs.
  Portal Guide Library: **🥽 XR kit** link per guide. Catalogue `xr-kit`.
- **.tag v1.1 — the frame, spelled out (B2).** Envelopes now carry
  `frame` (`kind: "qr"`, `markerId`, `markerSizeM`, sealed `anchorPose`,
  `originSource`) and assembly members repeat `spatial` + `type`, so a reader
  on any engine places every part from one envelope without ARKit. Additive:
  `tag/1.0` still validates; iOS accepts every `tag/1.x`. JSON Schema at
  `docs/schema/tag-envelope.schema.json` (`GET /catalog/schema/tag-envelope`);
  `npm run tag:verify -- envelope.json [--pubkey] [--sib url --key k]`
  verifies structure, determinism, canonical hash and Ed25519 signature
  offline and re-hashes members against a live server — the reference a
  C# / Kotlin / Rust reader is checked against.
- **Contextual hints — spotlight + operator controls.** The step's parts
  now glow (cyan pulse) with a leader line from the pin; "Show me" on a hint
  or tapping the part chip flashes the right parts while the rest ghosts for
  2.5 s; Replay is a labelled pill. Hints can be muted for this step (auto-
  clears on step change), for this guide (session) or device-wide (Settings →
  Contextual hints); the ✨ top-bar control shows the state and unmutes. Coach
  hints are never muted. Delivery is reported back (`hint:shown` /
  `hint:muted {scope}`) onto the visit's hint record for C3; the Usage Log
  strikes through muted hints. Imported step nodes carry a friendly `label`
  (object name → BOM description → part number) used by hints.
- **Contextual intelligence C2 — deviations become hints.** After each
  observation batch SIB compares the current visit with the step's learned
  baseline and queues one hint per new deviation: `dwell` (past the p90),
  `attention-off` (below the p10), `wrong-part` (beyond the p90), `look-away`
  (viewed step, never aligned, past the median), `validate-retry` (3 misses).
  Hints carry `signal`, `evidence` and `via`; text is a template quoting the
  baseline and part names, or the Ask-SIB model (`ASK_LLM_URL`, 8 s budget)
  with the template as fallback. Recorded on the visit for C3. iOS shows the
  reason per signal and opens the card for wrong-part / validate-retry. The
  LLM call moved to `ask/llm.ts`, shared with Ask SIB.
- **Contextual intelligence C1 — observations + learned baselines.** The
  operator session streams engine-neutral 1 Hz observations (attention
  target, distance/aim to the step target, look-from-here alignment,
  movement, interactions: tap-part / tap-wrong-part / replay / panel /
  validate-attempt / realign / look-aligned / stall) in 5-second batches to
  `POST /guide-sessions/live/:id/observations`. SIB rolls them into the usage
  record per visit (`OmsUsageStepEntry.observations`), keeps the raw samples
  as JSONL, and learns per-guide/per-step baselines from completed visits —
  dwell p50/p90, on-target ratio, wrong-part taps, replays, validation fail
  rate, stall rate — at `GET /guide-sessions/baselines/:guideId`. Nothing
  hard-coded. Spec `docs/CONTEXTUAL-INTELLIGENCE.md`; catalogue
  `contextual-intelligence`.
- **Guide Bundle — the engine-neutral guide contract (B1).**
  `GET /guides/:id/bundle` returns one versioned JSON (`sib.guide-bundle/1`)
  with the guide, ordered steps, model manifest (GLB/USDZ URLs), the anchor
  and every frame it offers (QR marker size + sealed pose, anchor world map,
  guide world map + reference camera pose, scanned object + calibration),
  validation references and verdict URLs, and the playback conventions
  (metres, Y-up, right-handed, axis-angle, xyzw, column-major, cumulative
  timeline). JSON Schema at `docs/schema/guide-bundle.schema.json`, served
  by `GET /catalog/schema/guide-bundle`; a test builds a bundle and checks it
  against the schema. Catalogue entry `guide-bundle`; UNITY-RUNTIME.md §0.
- **Product doors — context per product, not at the kiosk (A).** The kiosk
  asks for identity only (plus authoring/operating for engineers). The home
  screen asks "What are you working on?" with three doors: **AR OMS**
  (Spatial Inspection + AR work instructions — operators enter a Production #
  then scan the chamber QR; authors pick the chamber configuration), **Gemba
  Audit** (Project ID stays at walk start) and **iLOTO** (new **Test bay #**,
  the raceway the panel sits in; stamped on every lock/tag event, shown in
  the iLOTO hub, portal event list and CSV export). Every prompt is prefilled
  from local memory with a "Change" affordance, the last-used door is badged,
  and the anchor directory opens scoped to the product (chambers / Gemba
  areas / iLOTO panels) with the new-anchor type fixed. "Browse all anchors"
  keeps the unscoped list. Shared: `LotoEvent.testBay?`.
- **New Anchor: the Location Name field is unmissable.** Bordered, accented
  field with a pin icon, a REQUIRED badge, clear button, auto-focus, and the
  type picker collapses to a chip when the product door already fixed it.
- **AR OJT "look from here".** Imported steps carry the source procedure's
  viewpoint (`step.view`); the assembly now shows a small pulsing blue camera
  marker at that viewpoint, aimed at the step's target. Operator: a chip says
  "Look from here · 1.2 m" / "Turn to the marker" until the device is within
  0.5 m / 30°, then "Good view" and the marker hides (returns if the operator
  drifts past 0.9 m / 45°). Author: the marker appears per step in Preview
  steps. iOS only; no schema change.
- **AR OJT: parts fading / vanishing during animation.** Visibility is now
  applied on materials with parents-first ordering, so a group ghosted by a
  step (e.g. "whole bike 91 % transparent") no longer dims the child part
  the same step makes solid; a hidden part that moves is shown moving; a
  part that is moved and then hidden travels first and hides at the end.
  Assembly GLBs are cached on disk (`AssemblyModelCache`), the download
  timeout is 180 s, and failures show the real reason (404 = model deleted →
  re-import; network) with a Retry in Place Assembly.
- **AR OJT: animation speed + author preview.** `Guide.assembly.animationSpeed`
  (default 0.5× — Cortona timings are authored for a desktop viewer) with
  `PATCH /guides/:id { assemblyAnimationSpeed }`; Place Assembly gets a
  **Preview steps** toggle (◀ ▶ step through, ↻ replay) and a tortoise/hare
  speed slider saved with the guide; per-motion floor of 1.2 s. The
  per-step ghost copy of the assembly slot is never shown once the guide's
  assembly is placed (it duplicated the live assembly while it loaded);
  double-load guard on the operator side.
- **AR OJT slices 2–4 (iOS) — the assembly in AR, one tap to place, steps
  drive the parts.** Own GLB→SceneKit loader (`Services/GLBLoader.swift`:
  node names + extras preserved, flat normals; USDZ export renamed nodes so
  per-part control was impossible), `AssemblyStateEngine` (cumulative part
  state from `initialNodes` + step deltas, replay-safe) and `AssemblyNode`
  (apply / play insert-remove-move animations / focus pulse / hit-test →
  part info). Author: **Place Assembly in AR** in the guide editor — the
  ghost follows a reticle on the surface (bottom-centre of the geometry,
  facing the author); one tap saves the pose and every CAD step's pin
  follows; drag / twist / pinch to nudge; a fresh session uploads its world
  map on first save. Operator: the assembly appears at the saved pose in
  its initial state; each step applies its deltas cumulatively, animates
  the parts it installs/removes on a loop (↻ replay), pulses the focus
  part with a name + part-number chip, and a tap on any part shows what it
  is. Per-step ghost copies of the assembly slot are suppressed while the
  live assembly is shown.
- **AR OJT slice 1 — one placement for the whole assembly (server/shared).**
  `Guide.assembly` (model, `pose`, `initialNodes`, `bounds`) and
  `GuideStep.cadPosition`; `PATCH /guides/:id { assemblyPose }` derives every
  CAD step's pin and assembly-slot offsets from a single pose (`null` clears
  and un-places). Cortona imports compute per-step pins from part bounds and
  carry the set-up step as `initialNodes`. `ChamberConfig.defaultAssemblyPose`
  places a guide at import with no author tap (`source: config`). Portal:
  assembly badge on guide cards; Guide Preview shows the cumulative part
  state after each step. Tests: `guide-assembly.test.ts`.
- **Cortona3D import validated on real publications (DITA WI, RWI, S1000D).**
  Guide steps now come from the document's own step list
  (`interactivity.xml` `<Procedure>/<Item>`), one per work item with the
  animation sub-steps it plays merged into a single `nodes[]` presentation —
  18 / 7 / 122 real steps instead of 61 / 59 / 671 animation atoms; set-up
  steps (`simulate FALSE`) are dropped; SubStep-per-step remains the fallback.
  Parametric geometry PROTOs (BOX, SPHERE, CYLNDR, TORUS, WASHER) are
  regenerated so the assembly is complete; hoses/cables are counted in a
  warning. Parser fixes: IS-bound events in Script nodes, BOM-prefixed side
  XML, `Set_Viewpoint2`, ignored widget PROTOs (arrows, dimensions, `Set_ID`,
  `Set_emissiveColor`). Multi-file launcher `.htm` now explains to zip the
  publication folder. Log fields: `setupSubsteps`, `workItems`, `stepSource`,
  `unreferencedSubsteps`; parse errors carry content-free token context.
- **Cortona3D RapidManual import (AR OJT slice CI-1…4, `feature/ar-ojt`).**
  `POST /guides/import/cortona` takes a published single-file `.htm` (or its
  extracted `solo+zip` bundle) and produces a draft guide plus the assembly
  as a GLB `Model3D`. Everything is our own code, dependency-free: a ZIP
  reader, a VRML97 parser that **keeps PROTO declarations and instances**
  (the procedure — `Procedure → Step → SubStep → Set_* / SwitchOFF` — lives
  entirely in proprietary PROTOs bound by `ROUTE`, which stock loaders drop
  silently), a scene builder (`ObjectVM`/`Transform`/`Switch` +
  `IndexedFaceSet`, content-hash mesh dedupe, VRML transform composition),
  a minimal glTF 2.0 writer (nodes named `cmp:<DEF>`, `extras` with
  objectID / part number / description from `DocItems`), an
  `interactivity.xml` + `rwi` reader (titles, body text, BOM; the `rwi`
  is never a step source), and RTF/HTML-to-text for callout widgets.
  One guide step per SubStep with `nodes[]` deltas (`SwitchOFF` /
  `Set_transparency` → hidden / ghost / solid; `Set_translation` /
  `Set_rotation` → from/to, classified insert / remove / move against the
  rest pose; `Set_diffuseColor` → highlight; `Set_Viewpoint` → suggested
  view), callout text folded into the step, source duration kept. New
  shared types `GuideStepNode` / `GuideStepView` on `GuideStep` and
  `ImportedGuideStep` (optional; older app builds ignore them). Portal:
  the Import Guide modal accepts `.htm`, shows a strict-mode toggle, opens a
  **content-free import log** (counts, PROTO names, publish options,
  warnings — copy / download) and kicks off the usual browser-side GLB→USDZ
  conversion; Guide Preview lists the parts each step shows / hides / moves;
  step rows carry a 🧩 parts chip. Tests: synthetic bundle generator built
  from both reconnaissance reports' schemas (`sib/test/cortona-fixture.ts`),
  parser / bundle / importer / GLB / strict-mode / text tests.
- **Feature Catalogue — live, touring, three views, shareable.** (1) **Live
  pulse**: each product wedge carries a line from `/stats` under its rim name
  (chambers, runs live / today, walks open, locks active, people on tools, QA
  devices, guides placed) and **ripples** while something is happening right
  now; the core beats faster while people are on tools (30 s refresh, quiet
  on failure). (2) **▶ Tour** (header) runs the first trail as a story: each
  stop flies the camera into focus with a caption card; ▶ Auto advances
  every 9 s with a progress bar; Space / → next, ← back, Esc out — present it
  standing at the screen. (3) **Map · Grid · Timeline** views: Grid is cards
  by product; Timeline is columns by platform version with the current
  release lit — "what shipped when" in one glance. (4) **Filters** for
  status (shipped / beta / planned) and version (✦ new in 2026.4.46 · since
  2026.4.45) apply to every view; the match count reads "N of 87". (5)
  **Navigation**: ← Back in the card panel walks the cards you visited;
  **⧉ Share** copies a link that carries the whole view (`#feature?3d&view=…
  &areas=…&status=…&v=…`) so it opens exactly as you saw it; `/` focuses
  search. (6) In 3D the SIB core now sits a full layer *below* the floor,
  painted first, so no product ever overlaps it; rim names are hard-fitted
  to their arc (`textLength`) so nothing clips at any angle.
- **Feature Catalogue — Focus.** A quick look at one node's relationships
  without the rest diluting it: **◎ Focus** (bottom-right when a feature is
  selected), key **F**, or a double-click pins focus and flies to the node;
  it also engages by itself once you are zoomed in (≥ 1.35×) on a selection.
  First-degree neighbours stay bright and labelled with flow on their links,
  second-degree ghost in at 30 % for context, everything else — nodes,
  edges, untouched product wedges / layers — recedes; **Esc** leaves. Rim
  names now size themselves to their arc (2D and, per frame, the
  foreshortened arc in 3D) instead of clipping.
- **Feature Catalogue — 2D ⇄ 3D.** A `2D | 3D` switch (keys `2` / `3`)
  lifts each product wedge to its own layer along the SIB **spine**; the flat
  disc is the same picture seen from above, so the switch is one camera move
  (tilt + layer spacing, ~1.3 s, reduced-motion snaps). Layer order is
  computed: Platform Foundations is the floor, every other product ranks by
  net dependency flow (providers low, consumers high) so links point upward —
  today: Foundations → Spatial Inspection → Gemba → AR Work Instructions →
  Designer → iLOTO → Portal. In-layer edges stay flat; cross-layer edges rise
  between their layers and still light up with flow on hover / select;
  selecting a feature fades every layer it doesn't touch. Drag orbits the
  stack, scroll zooms, labels stay collision-free (nearest layer wins),
  `#feature?3d` links open stacked. Pseudo-3D projection in the same SVG — no
  WebGL, text stays crisp, every interaction unchanged.
- **Feature Catalogue — "The Core".** The map now tells the SIB thesis by
  its shape: **SIB sits in the centre** as a glowing core (pulsing, with the
  four ontology halos — spatial · perception · semantic · reasoning — turning
  slowly around it); products are clean **radar wedges** with their names
  set along the rim arc (never upside down, never on a node); faint **depth
  rings** read *foundations · core · surface*, so inner = what everything
  builds on. Edges are curved arcs that bow toward the core; hover or select
  a feature and **light flows** along its dependencies. Features stamped
  with the current version carry a green **new-this-release** tick (legend
  updated). Labels are collision-avoided (flip above, then yield) so nothing
  overprints at any zoom. **Ignite** once per session — core lights, wedges
  sweep in, nodes pop ring by ring (~2.5 s, any input skips, reduced-motion
  honoured). Header, panel, tooltip and zoom controls are frosted glass.
- **Feature Catalogue map — sector layout, hover, zoom controls (slice A).** At 87 features the free force layout had product headings
  landing on nodes and labels on labels. The map is now laid out by
  **sector**: each product area owns a wedge of the disc (width ∝ feature
  count), features sit on rings by dependency depth (foundations inward),
  deterministic — no random start. A soft **territory** hull is drawn behind
  each area's nodes and the heading is pinned *outside* the disc on the
  sector's bearing, so it can never sit on a node. **Semantic labels**: below
  0.9× zoom only the hovered, selected, neighbouring, searched and trail
  nodes are labelled; zoom in and everything reads. **Hover** grows the node,
  lights its edges, dims the rest and shows a tooltip (area · status ·
  version · first sentence). **Controls**: + − ⛶ fit ↺ reset (top-right),
  click a product heading or chip to zoom to that territory, double-click a
  node to zoom to it and its neighbours; dragged positions are remembered per
  browser. Header ⚡ replaced by the appliedx wordmark. Slices B (Grid /
  Timeline views, status + version filters) and C (panel history, related
  rail, keyboard, shareable view URLs) are proposed next.
- **Platform wordmark — "appliedx Connected Worker AR OMS Platform".** The
  home page, portal header, catalogue, /platform and the long-form page now
  carry the team's wordmark the way it is written in decks: *applied* in
  AppliedX blue (#66b3ff), *x* in green (#35c635), Roboto Regular (fetched
  when reachable, system sans on the LAN). `brand.js` renders any element
  with `data-ax-wordmark` so a page never hand-copies the colours; the ⚡ is
  gone from the home header.
- **Feature Catalogue caught up to 2026.4.46.** Fifteen new cards for
  everything shipped after the `.tag` emitter — kiosk shift start, usage log,
  production-verified resume, step validation, chamber configurations, copy /
  duplicate / model slots, sealed world maps, object anchoring, presence &
  coaching, moment coach, device logs, SIB Compass, portal guided assistance,
  the /platform story and the Gemba "walk together" set — each with API lines
  validated against the real routes and an architecture diagram. Existing
  cards (LocTags, walk sessions, ghost overlays, evidence, guide move) and
  the four area flows were updated; the deep dives live in the new
  `docs/CONNECTED-WORKER.md`; `docs/FEATURE-CATALOG.md` gains section 8.
- **Gemba Walk — every photo in the Excel export, plus Summary and Photos
  sheets.** Auditors expect the workbook to carry the evidence, not just the
  first picture. The walk export is now three sheets: **Summary** (one row per
  walk — header, counts by category, max risk, photos, notes), **Findings**
  (one row per finding with *all six* photos embedded side by side, each
  caption beside its image, marked-up copy preferred) and **Photos** (one row
  per photo for filtering by caption / markup). `xlsx-lite` gained multi-sheet
  workbooks, any number of anchored images per row and columns beyond Z, still
  with zero dependencies. `?walkIds=a,b,c` exports a chosen set (≤ 200).
- **Walk Sessions — filters that scale.** Auditor dropdown, **From / To** date
  window (default last 90 days, applied server-side via `GET /gemba/walks?from=&to=`,
  *All time* to clear), 50-row paging with *Show more*, and **⬇ .xlsx (N shown)**
  which exports exactly the filtered table.
- **Gemba Walk — custom entries + no header-less walks.** Free-text findings
  now collect exactly what library findings do — typed focus area + question /
  observation, the same Finding Category (required) and Preliminary risk — and
  are stored with `referenceSource: 'custom'` and no codes, so the report is
  true: portal rows show a *Custom* badge, the walk `.xlsx` and CSV carry a
  `Source` column (`library` / `custom` / `legacy`). The start sheet lists
  **every** open walk on the space (yours → *Continue*, a colleague's →
  *Join*) instead of only the auditor's own; *Begin* always records a walk
  (all header fields optional) — *Tag without a walk header* is gone, replaced
  by an offline fallback that appears only after a failed *Begin*. Findings
  without a walk (offline / older builds) are counted on the start sheet and
  offered for inclusion once a walk begins (`POST /gemba/walks/:id/adopt`).
- **Gemba Walk — Audit Reference Library (G1)**. The PowerApps Gemba Audit
  tool bound its pickers to SharePoint reference lists (Focus Area → Question);
  auditors chose, never typed. That vocabulary now lives in SIB:
  `GET /gemba/library` serves focus areas with their questions plus the fixed
  finding categories (Strength / OFI / NC) and risk ratings (0–3) in one call;
  Corporate Quality maintains it under Portal → GembaWalks → **📚 Audit
  Library** (add / edit / deactivate / delete, admin-gated writes) or imports
  the same Excel/CSV they already keep — choose file → preview → import,
  atomic, append-by-code or replace, mirroring Import Guide. Findings will
  record the question *code* so later library edits never rewrite history.
  Fresh servers seed the 15 focus areas from the PowerApps tool (no
  questions — those come from the import); already-seeded servers gain the
  missing areas on restart and lose the four demo 6S questions if untouched. `sib/src/gemba/library-core.ts`, `routes/gemba-library.ts`,
  tests, `docs/GEMBA-WALK.md`, catalogue `audit-library`. Slices G2–G8
  (finding model, capture flow, walk sessions, markup, multi-auditor,
  phone-down navigation) are listed there and follow.
- **Gemba Walk — reference-list findings (G3)**. A finding (`LocTag`) can now
  be logged against an Audit Library question: `POST /loc-tags` takes
  `questionCode` and snapshots focus area + question (code, title, text) onto
  the finding, plus `findingCategory` (Strength / OFI / NC), optional
  `riskRating` 0–3 and up to six photos with captions (`photosBase64`).
  `referenceImagePath` keeps mirroring the first photo, so older app builds
  and the portal keep working. New: `POST /loc-tags/:id/photos` (append),
  `DELETE /loc-tags/:id/photos/:file`, `PUT …/photos/:file/markup` (G5
  hook). Portal Walks table shows the category pill + risk, the question
  under the title, and a captioned photo strip in the detail row; CSV gains
  the new columns. iOS models + `SIBClient` (`fetchGembaLibrary`,
  `appendLocTagPhotos`, `deleteLocTagPhoto`, `uploadLocTagMarkup`) are in;
  the capture flow lands with G4. `sib/src/gemba/finding-core.ts`, tests.
- **Gemba Walk — pick, don't type (G4, iOS)**. The finding sheet now runs
  the Corporate Quality flow: **Focus Area → Question** (searchable pickers
  from the Audit Reference Library, last focus area remembered) → **Category**
  Strength / OFI / NC → optional **risk 0–3** → up to **six photos, each with
  a caption** (camera or library, reorderable). Free text only when the
  library is empty or the auditor flips the toggle. Every finding gets a
  **floating panel** in AR — the AR OMS pill/card language: collapsed pill
  (stop #, title, category chip) by default so the view stays clear; tap →
  card with code, question, risk, notes, photo count; tap the card to collapse,
  its **Open ›** band for the full sheet. Warm light surface, dark text, orange
  accents (badge · ring · chips) — easier on the eye than orange-on-black. Operators see the same panels while walking (non-target ones dimmed)
  and can open any finding from its card. Peek / completion / edit sheets show
  the reference question, category, risk and a captioned photo strip with a
  lightbox; edit changes category, risk and captions. Library is cached on
  device and refreshed at walk start. `Components/FindingPanelNode.swift`,
  `FindingDetailSections.swift`, `Services/GembaLibraryStore.swift`,
  `Modes/LocTagFormSheet.swift` (rewrite), `LocTagAuthorView`,
  `LocTagOperatorView`, `LocTagPeekSheet`, `LocTagOperatorSheet`,
  `LocTagEditSheet`.
- **Gemba Walk — walk sessions, summary and Excel (G2 + G8)**. Starting a
  walk now collects the header the PowerApps tool did — auditor (kiosk
  identity), **Project ID, Organization, BU, Area, Location** — from pick
  lists Corporate Quality maintains under Audit Library → *Walk header pick
  lists* ("Other…" allows a typed value; last values remembered; an open walk
  on the same space can be continued). Findings carry `walkId`; **Finish**
  uploads the map, submits the walk and shows a **Session Summary** (counts
  by Strength / OFI / NC, max risk, photos, the log). Portal → GembaWalks →
  **🚶 Walk Sessions**: one row per walk with category chips, expandable
  findings with captioned photos, **⬇ .xlsx** per walk or all (one row per
  finding, first photo embedded), reopen / delete. `GET /gemba/walks`,
  `POST /gemba/walks`, `POST /gemba/walks/:id/submit`, `GET
  /gemba/walks/export.xlsx`, `PUT /gemba/library/lists/:kind`; `/stats`
  gains `openGembaWalks`. `sib/src/gemba/walk-core.ts`,
  `routes/gemba-walks.ts`, `oms/xlsx-lite.ts` (`buildTableXlsx`), iOS
  `Modes/GembaWalkSheets.swift`, tests.
- **Gemba Walk — mark up the photo (G5, iOS)**. Tap a photo thumbnail while
  logging a finding (or the pencil on a photo in the peek sheet) to draw on
  it — PencilKit, finger or Apple Pencil, orange / red / white / black, two
  widths, undo, clear. *Done* flattens the strokes onto a full-resolution copy
  stored beside the original (`markupPath`); the original is never changed.
  The floating panel, sheets, portal strips and the walk Excel all prefer the
  marked-up copy. The strokes are stored beside the image (`drawingPath`,
  PencilKit data, image-pixel coordinates) so re-opening a marked photo shows
  the marks and they can be edited; **Save** keeps them, **Clear & Save**
  removes the markup (`{ clear: true }`). `Components/PhotoMarkupView.swift`,
  `LocTagFormSheet`, `FindingDetailSections`,
  `PUT /loc-tags/:id/photos/:file/markup` (from G3).
- **Gemba Walk — walk together (G7)**. Auditors on the same space see each
  other: the presence lens / view cone / roster chip from AR OMS now run on
  Gemba walks (surface `gembaWalk`, poses in the shared world-map frame,
  withheld while relocalising). A finding saved, edited or deleted by a
  colleague arrives live (`loc-tags` presence event) — its pin and floating
  panel appear on everyone's device with a toast. `sse/presence.ts`,
  `PresenceService.findingsChanged`, `LocTagAuthorView` presence section.
- **Gemba Walk — phone-down navigation (G6)**. Operators walk with the
  phone at their side: a **Live Activity** in the Dynamic Island / Lock
  Screen shows the next finding, distance and progress; arriving fires a
  haptic and a green tick; tracking lost (phone lowered) shows the last
  distance and "Raise your phone to update" — raising re-localises and
  updates resume. Needs the `GembaWalkWidget` extension target (one-time,
  `ios-app/XCODE-SETUP.md` step 10); without it the calls are no-ops.
  `Shared/GembaWalkActivity.swift`, `Services/GembaLiveActivity.swift`,
  `GembaWalkWidget/`, `NSSupportsLiveActivities` in Info.plist.
- **Gemba Walk — resume with a checkpoint (R1–R5)**. iOS suspends ARKit the
  moment the app leaves the foreground, and ARKit used to RESET its world on
  return — every pin respawned in the wrong place, silently. Now:
  *R1* the Live Activity switches to an honest posture in the background
  ("Open SpatialTagging to continue · next #4 · last 3.2 m"); *R3* completed
  findings, the current stop and the walk id are saved per space, so a cold
  restart offers "Continuing at #4" (12 h window); *R2* the AR session now
  keeps its map across interruptions (`sessionShouldAttemptRelocalization`)
  and every return runs a **Welcome back** checkpoint — blurred view, the
  last known finding's own photo as the landmark, "stand where you saw #4",
  then one question over the pin: *Is #4 where the pin shows?* Yes / No,
  re-align; no answer in 15 s → full re-localization against the saved map
  (reference photo + I'm Here) continuing at the same stop; *R5* authors get
  the same gate and cannot place a finding into an unconfirmed frame; *R4*
  on arrival at a finding the live view is compared with the finding's photo
  (`POST /loc-tags/:id/compare`, same comparator as step validation, loose
  threshold) — low similarity shows "This doesn't look like #4 — Re-align /
  Looks right" instead of a silent drift. `ARSessionManager` (`resumeCount`),
  `Components/ResumeCheckpointOverlay.swift`, `Services/WalkProgressStore.swift`,
  `LocTagOperatorView`, `LocTagAuthorView`, `GembaLiveActivity.background`.
- **SIB Compass — one navigator on every web surface (N1)**. Each surface had
  grown its own way home (⌂, ⚡, a text link, nothing) and the portal had no
  link to SIB home at all. `sib/portal/compass.js`, injected by `brand.js`
  (roadmap and wireframe now include it too): a brand-hex button bottom-right
  opens a radial map — SIB in the centre, Portal / Admin / Platform / Roadmap /
  Catalogue / Wireframe around it, their stops fanning out; the current node
  is lit with the path from the centre drawn, and every node is one click,
  leaf to leaf. Live counts from `/stats` ride on the nodes (chambers, people
  on tools, runs live/today, guides placed, open findings, active locks, QA
  devices) and the button shows a pulsing dot while a guide run is live. A
  clickable breadcrumb (`SIB › Portal › Admin › Device Logs`) sits bottom-left;
  "Where next?" offers up to three chips from the getting-started ladder;
  Recents keeps the last three places. Keys: `g g` map, `g h/p/m/r/c/w/a`,
  Esc. `/stats` gains `sessionsToday`, `liveRuns`, `qaDevices`. Reduced-motion
  respected; breadcrumb and leaves hide on narrow screens.
- **Place Steps — confirm before moving on (iOS)**. A dropped pin no longer
  auto-advances. The pin pops in with a green surface ring and a haptic, and
  a placement card takes over the bottom of the screen: step number and
  title, "Pinned · 42 cm away", **Re-tag** and **Confirm & next** (last step:
  *Confirm & finish*). While the card is up any tap on a surface moves the
  pin (tapping the pin itself confirms); the model chain and the advance run
  only after Confirm, so colleagues never see a half-placed pin. The confirm
  bar replaces the action bar in the same slot and style — nothing new covers
  the chamber. ⏩ in the top tool row (next to the eye) toggles auto-advance
  (per device, off by default; yellow = on, toast on every change): with it
  on there is no interim at all — drop and go, exactly the earlier flow.
  One-time
  coach moment; `guide: pin placed / re-tagged / confirmed` lines in the QA
  log so hesitation shows in the timeline.
- **QA logging — device logs on the server (L1–L3)**. A work iPhone can't
  hand over its console, so the app now ships its log lines to SIB. iOS
  `Services/AppLog.swift`: `info/warn/error` always, `debug` with **QA Mode**
  (Settings → Diagnostics; per device, auto-off after 24 h, orange QA badge on
  every screen); batches every 5 s / 50 lines, errors flush at once, redaction
  of keys/tokens/base64 before send, rolling anchor/guide context, abnormal-exit
  marker on next launch. ~30 `print` sites in AR/QR/cone/guide/net/model code
  now go through it. Server `logging/device-logs.ts` + `routes/logs.ts`:
  `POST /logs` (validated, redacted again) → JSONL per device per day under
  `DATA_DIR/logs/`, the server's own console mirrored to `server.jsonl`,
  `LOG_RETENTION_DAYS` (14) pruning, `GET /logs` query, `/logs/devices`,
  `/logs/export.txt`, SSE `/logs/tail`; reads sit behind the admin gate
  without flooding the ops log. Portal **Admin → Device Logs**: device / level /
  module / window / search, live tail, Copy last 200, Download .txt. Doc:
  `docs/QA-LOGGING.md`.
- **Opacity slider in AR (Place Steps)**. The model adjust bar gains the
  same ghost-opacity slider as Place-in-AR: live on the node, saved with the
  slot on Confirm, so the value is chosen against the step's real background.
  Place Steps now shows each slot at its saved opacity instead of a fixed
  preview value — what the author sees is what the operator gets.
- **Roadmap — "From a photo" door (server-side vision)**. The whiteboard /
  screenshot import was hidden in the ⋯ menu and, on the in-house server,
  waited two minutes before failing. It is now the third door on the Roadmap
  home page; the preview creates the draft as a **Roadmap** or a
  **Procedure** (arrows → *Next*, plain lines and lanes dropped). Extraction
  always ran on the SIB server — the vision endpoint is now resolved
  `SIB_VISION_URL` → `ASK_LLM_URL` → not configured, and
  `GET /mindmap/import-image/status` (key-free) lets the door say "Not set
  up on this server" up front. Ollama is one option, not a requirement: any
  OpenAI-compatible endpoint with `image_url` support works (vLLM, LM
  Studio, a company gateway). Setup in INTERNAL-SERVER-DEPLOY.md.
- **Procedure Designer — issue bubbles on nodes (DS1)**. Compiler issues
  now ride the card as a notification badge at the top-right corner: red
  with the error glyph when any error blocks *Send to guide library*, amber
  with the warning glyph otherwise, count inside, every message in the
  tooltip. The issues drawer in the procedure bar is unchanged — the bubble
  puts the same server-derived `issues[].nodeId` on the canvas.
- **Procedure Designer — night node-properties pane (DS2)**. The Inspector
  follows the canvas theme (`.editor-body.night .inspector`): black panel,
  dark inputs, dimmed chips, re-tinted review/active states. Procedure maps
  default to night, so the properties pane is black there; roadmap maps stay
  white unless flipped with the existing ☀/☾ toggle.
- **AppliedX iconography (DS3)**. `utils/icons.ts` redrawn as one stroke set
  (24-grid, 2 px round strokes, `currentColor`) and extended from 20 to 60
  icons — fab vocabulary first: chamber, wafer, gas line, breaker, torque,
  lockout, evidence, voice, ghost model, checklist, ME, technician, hazard,
  ESD, vacuum, clean, timer, Production #, spatial pin, scan. Every emoji
  in the Designer chrome (toolbar, map list, preview, procedure bar, node
  step pill) is replaced by `<Icon name>` (`components/Icon.tsx`).
- **Iconography library**. `npm run icons:doc` (`scripts/iconography.mjs`)
  generates `docs/ICONOGRAPHY.md` and the rendered sheet
  `docs/iconography.html` (day / night / on-card previews, where each icon
  is used) from `icons.ts`, and fails when a path has no meta or vice
  versa — the library cannot drift from the code.
- **Object scan robustness across devices (B1b)** — an ARKit reference
  object is a sparse point cloud tied to the camera that captured it, so a
  scan from one iPhone can be slow to recognise on another. Four changes:
  (1) the Save gate now requires **≥ 600 points from ≥ 3 of 6 sides** (the
  scanner counts the 60° sectors you have looked from; the coverage line
  reads "Good coverage · 4 of 6 sides"); (2) Anchor Hub → Object tracking
  → **Improve scan on this device** scans the same chamber with the second
  iPhone and merges it into the existing object (`ARReferenceObject.merging`
  — points land in the original's frame, so the QR/map calibrations stay
  valid; `POST /anchors/:id/object?merge=1` keeps `objectPoseInQR`); (3)
  provenance on the object meta — `scannedOn` (hardware id), `mergedFrom`,
  `sides` — shown in Anchor Hub with an amber note when this iPhone did not
  contribute; (4) the chamber finder shows, after 10 s, "Scanned on a
  different iPhone — add a scan from this one" when that is the case.
- **Multi-user co-authoring, slice 1 — presence in Place Steps (P1)** —
  two authors can work on the same guide at once and see each other in AR,
  even from different sites: because every device localises into the
  chamber's shared frame (sealed map / object), a colleague's camera pose is
  directly comparable with no ARKit collaborative session. Server: in-memory
  heartbeat `POST /anchors/:id/presence` (~2×/s per device; `userId`,
  `name`, `surface`, `pose`, `focusId`, `site`; UAM-signed names cannot be
  spoofed), `GET /anchors/:id/presence`, `DELETE /anchors/:id/presence/:userId`;
  fanned out on the existing `/anchors/:id/subscribe` SSE feed as
  `presence` / `presence:joined` / `presence:left`, entries dropped after
  30 s of silence; guide-step store writes are announced as `guide-steps`
  (edit echo). Nothing is persisted. iOS (`Services/PresenceService.swift`,
  `Components/PresenceLayer.swift` — add both to the Xcode target): a
  world-locked **lens** (initials, name, site from the time zone) at the
  colleague's head, a translucent **view cone** and a pulsing **gaze dot**
  where their view meets the chamber, smoothed between updates; edge
  arrows with the name when they are off screen; a roster chip
  ("Priya (Singapore) is here" / "3 here", tap to expand); join/leave
  toasts with a light haptic. **Edit echo:** when a colleague saves, steps
  you have not touched this session move to their new position with a
  pulse and "Name · just now"; a step both of you moved keeps yours ("yours
  wins on Save" note). **Soft lock:** the step a colleague is on shows their
  initials on its tray chip. Poses are shared only while the session frame
  IS the guide map frame (relocalized / object-snapped) — never from a
  private frame. Presence identity is per device (`employeeId@device`), so
  the same login on two iPhones is two people. Author mode (Spatial
  Inspection) and author-coaches-operator are the next slices.
- **Object tracking, slice 5 — re-align UI in the inspection modes +
  portal provenance (R1)** — Spatial Inspection Author / Operator and iLOTO
  already inherited the chamber-movement watchdog from the QR gate but only
  gave a haptic; they now get the same `ObjectTrackOverlay` the guides
  have: tracking pill (tap = manual re-align with the timed finder),
  "Chamber moved — re-aligned · Undo" toast, amber "looks different" state.
  Portal: the chamber row's object badge now carries provenance — device it
  was scanned on (+ merged devices), sides covered, calibration state and
  shape-model state, with the full detail in the tooltip (`Anchor.objectInfo`,
  derived, read-only).
- **Object tracking, slice 4 — shape model ghost (B3)** — a reference
  object is an invisible point cloud, so "chamber recognised" had nothing on
  screen to prove *where* the app thinks the chamber is. Anchor Hub → Object
  tracking → **Shape model** picks a USDZ-ready model from the chamber's kit;
  **Align shape model on the chamber** opens a one-time fit (drag slides on
  the chamber's ground plane, pinch scales, twist turns, sliders for lift
  and scale; Save when it sits on the metal) and stores `shapeModelPose` /
  `shapeModelScale` in the reference object's frame (kept across merged
  scans, reset by a fresh re-scan). From then on the QR gate, Place Steps
  and the guide session show the model as an indigo ghost on the chamber
  for ~6 s at every recognition and every B2e re-alignment, then fade it —
  a glance tells you the frame is right. Server: `PATCH
  /anchors/:id/object/meta` now takes `shapeModelId` (existing model id or
  null to clear), `shapeModelPose`, `shapeModelScale` alongside
  `objectPoseInQR`. New file `Components/ObjectShapeGhost.swift` (renderer,
  picker, align view) — add to the Xcode target.
- **Multi-user, slice 3 — an author coaches an operator (C1/C2)** — the
  operator's guide session now publishes presence too (surface `guide`,
  pose in the guide-map frame once relocalized / object-snapped, current
  step as focus, and the live session id), so an author in Place Steps on
  the same guide sees the operator's lens, cone and gaze dot and which step
  they are on. The roster entry gets a **Coach** button → a panel with a
  message field, quick phrases ("Wait for me", "Check the torque", …) and
  **Point here**: the next tap on the chamber sends a look-here marker.
  Server: `POST /guide-sessions/live/:id/hints` queues a HUMAN hint on the
  same consume-once channel the AI adapter uses (`AIHint.source: 'human'`,
  `from`, optional `pointer` x,y,z, `trigger: 'coach'`); the chamber feed
  gets a `coach-hint` nudge so the operator fetches it at once instead of
  the next 5 s poll. Operator side: the assist card opens with "Priya says
  …" (person icon, cyan), a success haptic, and a pulsing ring + beam +
  "Priya: look here" label at the point for 20 s; coach hints bypass the
  stall/retry cool-downs. `PresenceUpdate.sessionId` added.
- **Multi-user co-authoring, slice 2 — presence in Spatial Inspection Author
  mode (P5)** — the same lens / view cone / gaze dot / edge arrows / roster
  chip / join toasts, now in Author mode. Poses are shared in the **QR
  frame** (tags are QR-relative): mine is `inverse(anchorPose) × camera`,
  a colleague's renders as `anchorPose × pose`, re-based live as the QR
  pose refines — so two authors in front of two units of the same chamber
  type line up when the chamber's shape is the origin. Edit echo rides the
  existing `.tag` feed: `changed` events name `member:<tagId>`, the view
  re-fetches and adds / moves / removes only those markers with a pulse
  and "Name · just now" (own writes are skipped by `updatedAt`). Frames
  never mix: Author/Operator presence only shows Author/Operator
  colleagues, Place Steps only people on the same guide.
- **Object tracking, slice 3 — movable equipment (B2e, iOS)** — for
  object-origin chambers the shape is now the **only** frame: the QR gate,
  Place Steps and the guide session start a fresh session (no
  `initialWorldMap`) so a chamber that has moved — a gas line rolled to
  today's bay — is never pinned to where the room map last saw it. The map
  is kept as an **explicit** fallback, never a silent one. Flow:
  *"Point at the chamber"* finder with a live **elapsed timer** (the wait
  never looks frozen); after 15 s it offers *Keep looking* / *Place from
  last known position* (guides: room map, amber "Approximate · from map"
  pill; gate: *Use the QR position*) and, for authors, *Re-scan the chamber*.
  **Auto re-align while working:** ARKit never moves an object anchor once
  added, so `ARSessionManager` now runs a watchdog — every 8 s, when the
  chamber's expected position is on screen, it drops the anchor and lets
  ARKit detect again; ≤ 2 cm / 2° is ignored, a larger move confirmed by
  two agreeing detections re-bases the world (`setWorldOrigin` composes
  across re-bases) with a haptic and *"Chamber moved — steps re-aligned ·
  Undo"* (Undo suspends auto re-align until a manual one). Tap the
  tracking pill (*Tracking · chamber* / *out of view · last known* /
  amber *looks different — tap to re-align*) for a manual re-align with the
  same timed finder. Three failed re-detections with the chamber in view
  mark the shape stale (pins never jump); a re-scan from the finder voids
  the calibration until the next Save writes a fresh `objectPoseInMap`.
  Spatial Inspection: the gate re-bases the session onto the chamber and
  hands the calibration to Author / Operator / iLOTO views
  (`linkToExistingSession(_:mapOrigin:objectCalibration:)`, `AppState.
  objectCalibration`), so tags follow a moved chamber there too (haptic
  only; pill/toast on those surfaces is a follow-up). Shared UI lives in
  `ObjectScanView.swift` (`ObjectFinderCard`, `ObjectTrackPill`,
  `ObjectRealignToast`). No server change.
- **Object tracking, slice 2 — the object as origin (B2)** — a chamber can
  now be found by its **shape**. `Anchor.originSource` = `worldMap` (default)
  or `object`, chosen when creating a chamber ("How should the app find this
  chamber?") or later in Anchor Hub → Object tracking. Doctrine unchanged
  underneath: tags stay QR-relative and guide pins stay map-relative — the
  object supplies the frame through a stored **calibration**:
  `objectPoseInQR` on the object meta (written by the first Author QR scan
  that also sees the object, `PATCH /anchors/:id/object/meta`) and
  `objectPoseInMap` on each guide's map meta (written by Place Steps on save,
  `PATCH /worldmap/guide/:id/meta`; also accepted on map upload). iOS:
  `ARSessionManager` runs `detectionObjects` in every configuration and
  publishes the object pose; the QR gate derives the QR frame from it
  (priority **object › sealed map › live QR**, drift note when the QR moved,
  ≤ 6 s wait after the lock for the object); Place Steps and the guide
  session **re-base the world onto the map frame** the moment the object is
  recognised (`ARSession.setWorldOrigin`) — pins exact, no feature-point
  matching, no QR needed for guides. The reference object is cached like
  maps (`ReferenceObjectCache`, offline-capable). Portal shows "◈ Origin:
  object". Server needs `npm run build`.
- **Object tracking, slice 1 — scan & store (B1)** — an Author can now scan a
  chamber as an ARKit **reference object**, entirely on the iPad
  (`ARObjectScanningConfiguration`): tap the surface the chamber stands on,
  size the box (W · H · D sliders, drag to move), walk around it while the
  live count shows feature points inside the box, *Save object*. The exported
  `.arobject` (a sparse point cloud — no mesh, no photo) is stored on SIB:
  `POST/GET/DELETE /anchors/:id/object` (streamed, 30 MB cap, engineer+, ops
  log) + `GET …/object/meta` (extent, center, points, who, when); removed with
  the anchor. `Anchor.objectScannedAt` is a derived read-only field. iOS:
  Anchor Hub → **Object tracking** section (scan / re-scan / remove, status
  row). Portal: **◈ Object scanned · date** badge with Remove. Nothing uses
  the scan as an origin yet — that is B2. New file `Modes/ObjectScanView.swift`
  (add to the Xcode target).
- **Read the step where it lives (H, iOS)** — Place Steps tray chips now
  always show the **step number** (✓ placed and ⬢ models moved to small rim
  badges), so a 20-step guide is navigated by counting instead of reading
  9-pt titles in a cleanroom. Tapping the step text in the action bar — or
  holding any tray chip — opens a **Step card**: a half-height sheet with the
  full title, instruction, voice-over, photo, flags, models and branches,
  with ‹ › to flip through steps while the camera stays live behind it, so
  an author can show a technician the step without leaving AR. In the Guide
  editor, tapping a step's text expands the full instruction inline. New
  file `Components/StepReadCard.swift` (add to the Xcode target).
- **Remove a saved world map (G1)** — `DELETE /anchors/:id/worldmap` unseals a
  chamber (map + origin removed; tags stay, they are QR-relative; the next
  Author scan seals a new map) and `DELETE /worldmap/guide/:id` resets a
  guide's map (map, reference photo and meta removed; **every step unplaced**
  — pins only mean something inside the map they were placed in; training
  and model assignments kept, model placements dropped). Engineer+, logged to
  the admin ops log. iOS: Anchor Hub ⋯ → *Unseal world map…*; Guide editor →
  *Reset map & pins…* (count in the confirm); Place Steps' *Re-place all pins*
  now deletes the old map so it can't linger. Portal: **Unseal** next to the
  sealed badge, **🗺 Reset map** in the Guide Library.
- **Remove all at once (G2, iOS)** — Spatial Inspection tag list gains 🗑
  *Delete all tags* (confirmed; existing bulk route); Place Steps gains a
  *Clear all pins* button (every step saved as unplaced on Save/Done; map
  kept).
- **Show only the current one by default (G3, iOS)** — Place Steps' eye now
  defaults to *only the active step*; Spatial Inspection author gets the same
  eye in its top bar, showing only the tag being worked on (just placed,
  being trained, or navigated to; everything shows until there is one).
  Tapping the eye shows all. Remembered per person (`FocusPref`).
- **In-session FTUE for AR OMS (F1, iOS)** — the paged overview explained a
  mode before the camera was up and was forgotten by the time a control
  mattered ("didn't know I could move a pin / expand the panel"). Now a
  **moment card** appears over the live AR view the first time a control
  becomes relevant — one line, one glyph, *Got it* — never covering the camera
  or the AR panels. Place Steps: tap a pin to move it · drag/pinch/twist ·
  ⬢1 ⬢2 ⬢3 adjust any model later · seal vs camera training · eye/cube
  declutter · Save vs Done. Guide session: tap the pill to expand · ✓ ✕ 📷
  panel buttons · one-panel eye toggle · ghost alignment capture (on arrival
  at a validation step) · ✨ hints · sign-off. Remembered **per person**
  (employee ID) so a shared kiosk iPad still teaches the next technician.
  The **?** icon on both screens opens a *Controls* cheat-sheet (every
  control with its glyph), **Replay tips**, and the old overview. No flow,
  gate or layout changed. New file `Components/ARMomentCoach.swift` (add to
  the Xcode target).
- **The pulsing "tap here" hand is back everywhere (F1b, iOS)** — the
  Spatial Inspection tap coach only appeared on an anchor with zero tags and
  never in AR OMS. It is now a shared `ARTapCoach`: Place Steps shows it for
  the first pin ("Tap any surface to place Step N") and once more when a pin
  is tapped to re-place it ("Tap where Step N should go"); Spatial Inspection
  shows it on an empty anchor and otherwise once per person. Dismisses on the
  first tap or after 8 s; ? / Replay tips re-arm it. New file
  `Components/ARTapCoach.swift` (add to the Xcode target).
- **Training feedback in Place Steps (T1, iOS)** — camera (quick-shot) and
  cone training now show a centred toast: *Hold steady* (0.6 s, then the
  frame is read) → *Training…* → ✓ *Trained* (fades after 1.5 s; the seal
  chip remains as the record). Failures stay up with the reason and OK.

### Changed
- **/platform rebuilt as "The Chamber" (PM1)** — the poster (five boxes,
  thirty bullets) is replaced by one stylised chamber that the platform
  happens to as you scroll, in the order a fab adopts it: *One chamber. One
  origin.* (with the optional recognised-by-shape beat) → *The WI lands where
  the hands go* (pins, ghost part, step scrubber, POC target from
  `metrics.json`) → *SIB checks the work, not the checkbox* (cone + verdict)
  → *The ME and the technician, on the same pin* (John · ME and Dev · new
  hire, "look here", plus the responsible-by-design line) → *Not a slide. A
  fab.* (grid glows from live `/stats` presence; counters read from SIB) →
  *Built for iPad today. Getting ready for glasses tomorrow.* (FY27 device
  POCs, readiness cards overridable via `/platform-media/trl.json`) → the
  Connected Worker ladder (Level 1 Digital instructions · 2 Spatial &
  validated · 3 Connected & coached · 4 Autonomous systems / cobot-ready;
  tap a level to preview it on the chamber) with the six-question
  assessment in a sheet. Hero: "Spatially guiding technicians to do it
  right, the first time." ~60 words on the surface; "In the catalogue →"
  behind each stop; the full write-up is parked verbatim at `/platform/long`
  (and `docs/archive/`). Three.js is the vendored r169 with a CDN fallback;
  no WebGL → quiet 2D fallback with the same copy. `/stats` gains
  `presenceNow` / `presenceAnchors`.
- **One localization doctrine for every AR surface (B1)** — *the author's
  world map is the origin; the QR is the key and a drift check.* AR Work
  Instructions already worked this way; Spatial Inspection placed tags from
  the live QR pose on every scan (±5–15 mm, tilt-noisy, and every tag moved
  when the QR was re-stuck). Now an Author **seals** the map on QR lock: the
  map is uploaded together with the gravity-normalised QR pose in that map's
  frame (`POST/GET /anchors/:id/worldmap/meta`, `<id>.anchorpose.json`,
  removed with the anchor). Operators relocalize into the sealed map and place
  `anchor_rel` tags from the **author's** pose; the live QR is only compared
  against it (> 5 cm / 10° → "QR moved? Using the sealed map"). If
  relocalization times out the QR pose is used as before, with a "reduced
  accuracy" note. **Operator scans never upload a map any more** (previously
  every scan overwrote the author's map, often with a fresh, unrelated frame).
  Unsealed anchors (every existing one) behave exactly as before until an
  author scans them once — no data migration. Portal anchor cards show
  **🗺 Map sealed · date** / **Map not sealed**; `Anchor.mapSealedAt` is a
  derived read-only field on `GET /anchors`.
- **Shared world-map loader (iOS `WorldMapCache`)** — the QR gate, guide
  sessions and 3D-model placement load maps through one path: fetch the small
  meta first, reuse the local copy when `capturedAt` matches, otherwise
  download; offline degrades to the cached copy. Replaces the gate's
  local-first / size-diff refresh (which could keep a stale map) and the
  guides' download-every-time. Guide map saves now always stamp
  `capturedAt` in the meta (pose kept when no new photo), so the cache can
  tell a re-save apart. Drift math is one function
  (`ARCoordinateFrame.poseDelta`) for both the guide "I'm Here" check and the
  inspection gate. `ARSessionManager` gains `relocalizationOutcome` and a
  map-origin mode that ignores live ARImageAnchor refinement.
- Platform version → **2026.4.46** (server `/config`; set iOS
  MARKETING_VERSION to match). Server needs `npm run build`; Xcode target must
  add `Services/WorldMapCache.swift`.

## 2026.4.45 — 2026-09-01

### Fixed
- **Designer / Roadmap: "everything looks selected"** — a mouse drag or a
  double-click on the SVG canvas was a native text-selection gesture, so the
  browser highlighted every text node on the page (node labels, notes, the
  inspector) and the highlight survived pointer-up. The canvas and node cards
  now `preventDefault` mouse pointer-downs, clear any stray selection, block
  multi-click selection on the stage, and the whole canvas is
  `user-select: none` (textareas/inputs re-enable it). The node editor opens
  with the caret at the end instead of selecting all text, so a freshly added
  node reads normally. Roadmap bundle must be rebuilt (`npm run build:roadmap`).

### Added
- **Place Steps focus toggle (U1, iOS)** — an eye button in the Place Steps
  top bar hides every other step's pin, label and 3D model while one step is
  selected, so retraining or repositioning a pin in a dense guide isn't
  cluttered by its neighbours. Session-only; hidden pins are also skipped by
  tap hit-testing. Sign-off now prefills the operator name from the shift-start
  (kiosk / UAM) identity — the same name the usage log carries — falling back
  to the author name; the field stays editable.
- **Multiple 3D models per step (U4)** — a guide step now carries up to three
  model slots (`GuideStep.models[]`, same slot doctrine as iLOTO points: each
  slot has its own scale, opacity and device-owned placement; a slot whose
  model changes loses its placement). The server mirrors slot 1 into the
  legacy `modelId/…` fields in both directions, so older app builds, the
  procedure compiler, imports and the portal keep working unchanged; moving a
  guide to another anchor strips slot placements like it strips pins.
  `PATCH …/steps/:id { models }` (max 3, `[]` clears every model — the edit
  sheet can finally remove a model). iOS: the Edit Step sheet adds "Add another
  model" slots; Place Steps loads and adjusts each slot in turn after the pin
  drop (✕ skips a slot), a cube toggle hides the active step's models while
  the pin is repositioned, and **Copy models to…** stamps the active step's
  models — at the same physical spot — onto any other placed steps (saved on
  the next Save/Done, even when no pin moved). Operators see every slot.
  Portal step rows show a "🧊 N models" chip. Unit tests + e2e (mirroring,
  cap, placement drop, anchor move).
- **Copy guide to anchor (U2)** — `POST /guides/:id/copy { anchorId, name? }`
  clones a guide onto another anchor (or duplicates it on the same one as
  "<name> (copy)"): steps, titles, voice, links, step photos (file
  duplicated), branch links (re-pointed), completion / validation / evidence
  flags and 3D model assignments travel. Pin positions, model placement,
  validation training (photos, cone tags, pass-states) and the sharing list
  stay with the source anchor's world map; the copy is an unpublished draft
  until re-placed. Technicians can't copy. iOS: swipe "Copy to…" on a guide →
  anchor picker (optional new name) → banner. Portal: "⧉ Copy" in the Guide
  Library. Replaces re-importing a guide per anchor.
- **Duplicate anchor (U3)** — `POST /anchors/:id/duplicate { assetId? }`
  creates a template copy: a NEW anchor (new id, new QR, its own encryption
  key — never shared between tools) with the source's metadata
  (`duplicatedFrom` stamped), anchor type, QR print size and 3D model kit
  membership, plus every guide copied via U2 (drafts, unplaced, untrained).
  The world map, tags, loc-tags and LOTO points are not copied — they describe
  the source's physical location; scan the new tool and re-place. Asset name
  defaults to "<name> copy" (uniqueness suffix as usual). iOS: swipe
  "Duplicate" in the Anchor Directory → name prompt → opens the new anchor's
  hub. Portal: "⧉ Duplicate" on the anchor row. Response carries
  `copied: { guides, steps, kitModels }`.
- **Procedure Designer: multiple 3D models per step (U5)** — the Inspector's
  "3D model" picker is now a slot list (up to 3, each with its own model and
  scale; "+ Add model" / ✕), stored as `metadata.step.models[]` with the
  legacy `modelId/modelScale/modelOpacity` keys mirrored to slot 1 so older
  maps and readers still agree. Canvas nodes show "⬢×N". Compiler emits
  `ImportedGuideStep.models[]` (capped, ids trimmed, junk dropped); ingest
  writes the slot list and keeps a slot's device placement when its slotId
  and model are unchanged (a swapped model loses placement, as on device);
  the reverse-compiler (Edit in Designer) surfaces every slot, assignment
  only. Unit tests for all three paths. Roadmap bundle must be rebuilt on
  the Mac (`npm run build:roadmap`) and committed.
- **Never-stuck step validation (X1)** — the trained-stance gate (distance /
  direction / aim to the pin) is now advisory. Auto-capture also fires on
  **image alignment**: every 0.5 s the live frame's Vision feature print is
  scored against the trained references (`feature_prints` / `fp_max_dist`,
  ROI-cropped) and ≥ 0.60 counts as aligned — so a moved QR (every pin off)
  can't trap the operator. After 8 s the shutter becomes "Capture anyway"; the
  comparator still scores honestly (FAIL → Retry / Proceed anyway / Recovery).
  **Drift detection**: Place Steps now uploads the author's camera pose with
  the Step-1 reference photo (`referenceCameraPose` on the world-map upload,
  `GET /worldmap/guide/:id/meta`). At "I'm Here" the operator's pose is
  compared; > 0.5 m or > 25° yaw apart → in-app warning ("Scene may have
  changed — pins may be off"), guidance switches to the ghost, and an
  `environment:drift` event lands on the usage-log session (`drift`, shown as
  a ⚠ chip in the portal) so the author knows to re-place steps.
- **Chamber Configurations — role-aware shift start (C1–C3)** — a
  configuration is a chamber *type* ("Producer XP · Cfg A"); many physical
  chambers (anchors / QRs) share it. Server: `ChamberConfig` catalog
  (`GET/POST /chamber-configs`, `PATCH/DELETE /:id` — engineer+; delete only
  when no chamber references it), `Anchor.configId`, `PATCH /anchors/:id
  { assetId?, configId? }`; duplicate keeps the configuration. Portal:
  Admin → 🏭 Chamber Configs page; anchor cards show the configuration with
  an inline assign dropdown; search matches config codes. iOS kiosk is now
  two steps: Employee ID → then, by role, **Technician**: Production / Slot #
  (the configuration comes from the QR — nothing to pick); **Engineer+**:
  "I'm authoring" (pick the configuration; "+ New configuration" inline) or
  "I'm operating". Home chip shows the configuration when authoring, Prod #
  (+ resolved configuration · chamber) when operating. **Operator front
  door: "Scan chamber QR"** (`ChamberScanView`) — the anchor's configuration
  is resolved from the scan; unassigned chambers and GembaWalk/iLOTO QRs are
  explained and rescan offered. "Browse areas & panels" keeps GembaWalk
  areas and iLOTO panels (not chambers) reachable exactly as before. Author
  directory during an authoring shift leads with the chambers of that
  configuration, then "Other chambers" (swipe right → assign here), then
  areas & panels; unassigned chambers carry a "No configuration" hint; new
  QR anchors created in an authoring shift join the configuration. Content
  (guides, inspection sets, training) stays per chamber in this phase —
  author on one, "Copy to anchor" to the rest, place per chamber.
- **Chamber Configuration follow-ups (A–D)** — **B (iOS):** after "Scan
  chamber QR", opening a guide no longer asks for a second scan of the same
  code: the app remembers the last scanned chamber (10 min) and, with the key
  in memory, starts the guide directly (it re-localizes on its own world
  map). The gate still runs for tag inspections — there it *is* the
  localization step — and now says "Scan the chamber QR to localize".
  **A (portal):** the Create Anchor dialog has a Chamber configuration
  select (remembers the last one). **C:** usage-log sessions record the
  chamber's configuration at open (`configId`, `configCode`, server-derived);
  portal usage log gains a "Configuration · Chamber" column and a
  configuration filter; the usage .xlsx gains Configuration and Chamber
  columns. **D (portal):** the Guide Library is grouped configuration →
  chamber (unassigned chambers, then GembaWalk/iLOTO, at the end) and each
  guide gets "⧉⧉ All N" — copy to every other chamber of the configuration
  as drafts, skipping chambers that already have a guide of that name.
- **Portal guided assistance (P1)** — the portal's FTUE, in the iOS tour's
  voice. (1) A 🧭 **Getting started** checklist (bottom-right) with five
  milestones that turn green from live `/stats` data — configuration →
  chamber + QR → guide → steps placed (phone) → first run — each a link into
  the right page, with a progress bar; it minimises itself once you're 3/5,
  celebrates and disappears at 5/5. (2) **Page tours**: a spotlight
  walkthrough of the controls that matter on Home, Chambers, Guide Library,
  AR Guides and Admin, once per page per browser; **❔ Show me** in the header
  replays it; Esc skips. (3) **Empty states become next steps** (no chambers →
  "add a configuration first" / "+ New Anchor"; no guides → Import / open the
  Designer). A **Guided assistance** toggle in ⚙ Settings (on by default) with
  "Restart tours". Technicians never see it. `/stats` gains
  `chamberConfigs`, `chambersAssigned`, `guides`, `placedGuides`; the Guide
  Library toolbar gains a 🗺 Procedure Designer link.
- **Brand strip + Connected Worker narrative** — every web surface (portal,
  home, /platform, catalogue) shows the Applied Materials logo and the
  AppliedX mark top-right via `sib/portal/brand.js`; the images are
  deployment-local (`DATA_DIR/platform/media/logo-amat.png`,
  `logo-appliedx.png`, served at `/platform-media/`) and a quiet dashed
  placeholder with a hover hint stands in until they're dropped. iOS home
  subtitle is now "Connected Worker AR OMS". `/platform` re-framed for
  leadership: eyebrow "Connected Worker AR OMS initiative", headline "Every
  technician's next move, right the first time", **Adaptive Guided Work
  Instructions** as the flagship (product renamed everywhere, incl. the
  platform map and deck), a **Definition of winning** strip — Productivity ·
  Velocity · Customer Trust (fewer quality escapes at customer sites) — with
  what each is measured by, a **Why we're doing this** section (do-it-right-
  the-first-time · technicians working smarter · ready for semi-/fully-
  autonomous cleanrooms · spatial intelligence as the durable, device-
  independent asset), and a **Devices** section (iPads/iPhones today as the
  full-platform benchmark; no-display, monocular and binocular glasses each
  matched to use cases, FY27 POCs; fit & feasibility judged against the iPad
  baseline). Bundled pitch deck title slide rebuilt to match.
- **/platform for leadership (M1–M2)** — M1: hero lead shortened to the
  promise; winning tiles carry the house metrics (TTC · SLH · re-work per run;
  CT · reduced downtime; Field NCs · Y7, Y8 · Q-reports) with "Today / POC
  target" hooks filled from `DATA_DIR/platform/media/metrics.json`; an
  explicit **ask** under the strip (one BU sponsor · one configuration · one
  measured POC, decision window from the same file); the impact section is
  headlined "Ready for the autonomous cleanroom — starting with the
  technician"; industry evidence trimmed to three facts; platform-map eyebrow
  carries Connected Worker · AR OMS; "Adaptive Guided Work Instructions" wraps
  to two lines on the map and deck. M2: a **guided reading path** — a 🧭
  "Start here" pill and four spotlight stops (why → how we score → see it →
  where are you?), once per browser, Esc/Skip anytime — and a **Connected
  Worker maturity self-assessment**: six pain-point questions (iOMS instruction
  accuracy per configuration, QFE critical-step sign-off, re-work vs CT,
  new-hire time-to-qualified 16+/12/8/≤4 weeks, ME issue visibility, customer
  change-request reach), each worst → best, a four-rung ladder
  (Aware → Piloting → Operating → Autonomous-ready) with what it means, the
  biggest gap and the next rung, Share-with-AppliedX / email prefilled with
  the result. Anonymous pulse: `POST /platform/assess` (level, score, answers,
  optional area label — nothing else, store capped at 5 000) and
  `GET /platform/assess/summary`; shown on /platform and as an "areas
  assessed · avg level" tile on the home page. Questions and level copy can be
  replaced per deployment without a rebuild: drop `assessment.json` into
  `DATA_DIR/platform/media/` (format in `sib/portal/platform-media/README.txt`).
- **Validation focus mode (X2, iOS)** — validation takes over the screen:
  step panels, pins, arrow, feature-point dots, the text panel, Prev/Next and
  the failed banner are hidden; what remains is the target ring, one guidance
  line under the top bar, the ghost as a corner thumbnail (spreads over the
  live view only when you're close to aligned — ≥ 35 % match — or when
  tapped), a shutter with a ring that fills as alignment improves, and a ✕.
  Everything returns when validation ends.
- **Guided single-shot training + auto-capture (W1–W3)** — W1: a validated
  step always yields evidence: "Require validation" locks "Require evidence
  photo" on (enforced server-side on PATCH), the validation frame becomes the
  step's evidence photo (stored, rendered, live-uploaded — before scoring, so
  a FAIL or an override keeps the honest picture), and the operator is never
  asked for a second photo; untrained (manual Pass/Fail) steps still ask.
  Switching a cone-trained step to single-photo mode now deletes the hidden
  tag and pass-states (no orphans). W2: 📷 **quick-shot** training in "Place
  Steps in AR" — one raw frame from where the Author stands, plus the stance
  (`cone_dist_m`, `shot_dir_*`), stored as a one-image pass-state on the
  hidden tag so scoring/decryption/operator flow are identical to cone. New
  `GET /guides/:id/steps/:stepId/validation-ref.jpg` serves the reference
  (decrypted in-memory) for the operator's **ghost overlay**: the live view
  is lined up with the Author's frame, guidance covers distance, line of
  sight and aim. The form-camera training (no stance) is retired from Edit
  Step. W3: **dwell auto-capture** — 0.8 s steady in position fires the
  capture (cone and quick-shot alike); the manual button remains.
  Fixed: placement-flow key pinning assigned a String to a `SymmetricKey`
  (compile error) — now parses via `AnchorEncryption.key(fromBase64:)`.
- **Platform story page (`/platform`)** — a marketing-friendly, interactive
  page for BU leadership: hero value proposition; "Why AR, why now" with
  sourced facts (PTC benchmark, Boeing/Iowa State, Volvo, Fujitsu, SIA/Oxford
  Economics workforce gap, ASML's AR support in the fab) beside "Where
  Applied can be ahead"; one card per product answering *What it is · Why
  we built it · How it helps you · Where it stands* with honest readiness
  badges (pilot-ready / early prototype / in production use), a "walk a
  shift" stepper, a before/after toggle, and labelled screenshot slots
  (`sib/portal/platform-media/`, served at `/platform-media`, auto-shown
  when files exist); the platform map; live counts from `/stats` (which
  gained `guidedRuns` and `validatedSteps` aggregates); momentum timeline
  with next milestones; and contact / demo-request `mailto:` links.
  `/platform.pptx` now serves a 9-slide native-shape pitch deck built from
  the same content (title, why AR, five product slides, map, contact) —
  regenerate with `tools/platform-deck-build.py`. Capability-level only.
  Deployment-local overrides, outside git: `DATA_DIR/platform/deck.pptx`
  is served at `/platform.pptx` in place of the bundled deck (for a site's
  own template deck), and `DATA_DIR/platform/media/*.jpg` is served at
  `/platform-media/` ahead of bundled files — so confidential decks and
  real screenshots never need to be committed.
- **Settings from the kiosk gate (iOS)** — the shift-start screen now has a
  ⚙️ button (top-right) opening the full Settings sheet, so a kiosk iPad can
  be repointed at a different server (and the connection tested) before any
  employee ID or Production # is entered. Closing the sheet re-runs the
  server probe, so a changed URL takes effect immediately — including the
  auto-skip when the new server has UAM dormant.
- **Cone training for step validation (V1–V3)** — AR Work Instructions now
  use the full Spatial Inspection engine instead of a single reference photo.
  V1 (author): in "Place Steps in AR", every placed validation step carries a
  🛡 seal button that launches the existing multi-angle cone sweep, anchored
  at the step's pin; references are stored as a pass-state under a hidden
  step-validation tag (excluded from all tag lists and anchor inspection
  sweeps; deleted with the training). New route
  `POST /guides/:id/steps/:stepId/validation-trained` stamps
  `validationMode: 'cone'` + `validationTagId` (409 until the sweep uploads);
  removing training cascades tag + pass-states. The single-photo path remains
  as "quick train". V2 (operator): completing a cone-trained step shows the
  training cone at the pin with live distance/aim guidance; when in position,
  a RAW camera frame (zero AR artifacts) is scored against ALL multi-angle
  references (best-of, same comparator) — far more tolerant of operator
  viewpoint than the single-photo compare. V3 (override): the FAIL dialog
  (system and manual) gains "Proceed anyway" — the step completes, but the
  usage log records `validation.overridden`, the portal badge shows
  "FAIL · proceeded", and the Excel export prints "— operator proceeded".
  Fixed: cone-trained step validation returned 0.00 FAIL on anchors with an
  AES encryption key — ConeCaptureView encrypts every reference, and the
  cone-aware validate path fed the ciphertext straight to the comparator.
  The route now decrypts references in-memory using the key from the anchor
  record (plaintext never persisted). Fixed (2): the placement flow never
  pre-loaded the anchor's key, so ConeCaptureView fell back to a random
  LOCAL key — references the server could never read (steps trained via
  the placement flow before this fix must be retrained). The placement flow
  now pins `appState.anchorEncryptionKey` to the anchor record's key, and
  the server answers a distinct 409 "references unreadable — retrain" when
  no reference decodes, instead of a silent 0.00. Fixed (3): operator
  scoring now matches the tag-inspection rule — on-device feature-print
  match (ROI-aware, calibrated `fp_max_dist`) combined with server SSIM as
  `max(fp, ssim)`, PASS ≥ 0.60 — and "In position" is gated on the trained
  stance (`cone_dist_m` ±30 %) with closer/back guidance, so the live frame
  is comparable to the references the way the inspection flow guarantees.
- **Validation authoring discoverability (B1+B2, iOS)** — the Add Step
  sheet now carries the same Validation section as Edit Step (Require
  evidence photo / Require validation; flags ride a patch-after-create,
  training itself still happens from the step's ✏️ Edit sheet), and step
  rows in the guide editor show status badges: green ✓-seal "Trained",
  orange seal "Train" (validation on but no reference yet), and a camera
  "Evidence" chip — an at-a-glance training checklist before publishing.
  iOS-only; no server change.
- **Completion Log Excel export** — the AR Guides Completions view now
  exports as `.xlsx` with evidence photos embedded per step row
  (`GET /guide-sessions/export.xlsx`, same `?all/anchorId/guideId` filters
  as the list), alongside the existing CSV. Each completed session also
  gets its own row-level **⬇ .xlsx** and **⬇ .csv** buttons
  (`GET /guide-sessions/:id/export.xlsx`) for per-session records/hand-off.
  Export buttons across AR Guides are now labelled by format — **⬇ .xlsx**
  (images embedded) vs **⬇ .csv** (no images) — and the completion-log
  buttons hide while the Usage Log view is active. The Usage Log export
  gained a final evidence-resolution fallback: the sign-off record's
  stored `evidencePhotoPath` is consulted when the photo is in neither
  the live-upload nor the conventional sign-off directory, so evidence
  recorded by any app/server era embeds. (`oms/xlsx-lite.ts` refactored
  into one shared workbook assembler for both logs.)
- **Portal home redesign** — the portal now opens on a tile-grid Home
  (approved mockup): seven color-coded tiles — Anchors, Inspection
  Sessions, AR Guides Sessions (Completions / 📊 Usage Log sub-chips),
  Content Library (Guide Library + 3D Models), iLOTO, GembaWalks, and
  Admin (👥 User Access / 📜 Ops Log / 💾 Backups as dedicated sub-pages) —
  with live counts from /stats and the usage log, so Home doubles as a
  status glance. The 8-tab strip is retired; inside a section a slim ⌂ bar
  shows the section name and its sub-tabs. Navigation is HASH-ROUTED
  (#ar-guides/usage, #admin/uam …): the back button returns Home, refresh
  keeps your place, and views are bookmarkable/shareable. Panels themselves
  are unchanged — every table, filter, export and modal works as before;
  the Admin tile stays Owner/Manager-only (server gates unchanged).
- **Live evidence — usage log becomes the system of record** — evidence
  photos now upload THE MOMENT they are captured
  (`PUT /guide-sessions/live/:id/evidence/:stepId`, encoded off the main
  thread), stored once under the LIVE session id. The Usage Log shows them
  immediately — including for interrupted sessions that never reach
  sign-off. Sign-off DEDUPES: when the live file exists it references it
  instead of storing a second copy (old app builds that still send base64
  are deduped server-side too), and the evidence endpoint resolves
  sign-off ids through the stored path, so the Completions tab keeps
  working unchanged. New builds skip photo re-upload at sign-off entirely.
  Excel export images enlarged to 240×180 (reviewable, rows sized to fit),
  and the evidence lightbox gained a "⬇ Download JPEG" button — blob URLs
  carry no filename, which made direct saves look like an unknown format.
### Fixed
- **Sign-off screen freeze** — `SessionSignOffView` had a computed property
  that JPEG-encoded and base64'd EVERY evidence photo, referenced from
  `body` — so SwiftUI re-ran all the encodes on the main thread on every
  render (every keystroke in the name field). The UI now uses a cheap
  completed-count; the heavy encoding happens once, off the main thread,
  inside submit — and with live evidence upload, usually not at all.
  The offline "Save & sync later" queue still embeds every photo (a queued
  record may drain much later), with server-side dedupe as the safety net.

- **Usage Log: evidence photos + Excel export** — expanding a session in the
  portal's Usage Log now shows the evidence photo captured at each step
  (thumbnail → lightbox, reusing the sessions-tab loader; steps without
  evidence show nothing). New "⬇ Excel" button downloads
  `GET /guide-sessions/usage/export.xlsx`: one row per step visit with the
  evidence photo EMBEDDED in the row's Evidence cell. Built by a new
  dependency-free XLSX writer (`oms/xlsx-lite.ts` — STORED-zip + minimal
  OOXML + drawingML anchors), keeping the no-new-runtime-dependencies
  doctrine; opens in Excel, Numbers and LibreOffice.
- **AR pill refresh** — the minimized floating pill now follows the A1
  design language: solid dark surface with a state-coloured ring and badge
  (step number, ✓ when done; blue current · green done · red recovery ·
  slate upcoming), 26pt title, larger audio/expand affordances, and a
  taller plane (0.07 m) to carry the bigger type. Pill and card textures
  re-render on completion and on step advance so state colours are always
  current.
- **UAM product entitlements (E1)** — users can be scoped to platform
  products (`aroms` / `iloto` / `gemba`). Absent/empty = ALL products, so
  every existing user keeps full access until explicitly scoped. The portal
  UAM table gains per-user product checkboxes (none checked = all, shown as
  "(all)"); the server whitelists + dedupes and `[]` clears back to all.
  On device, entitlements gate AUTHORING surfaces only: the anchor-creation
  picker offers Gemba Walk / iLOTO types only to entitled users, and the
  AR Guides authoring entry requires `aroms` — operator flows stay governed
  by session/guide assignment, keeping run-time delegation uniform across
  products. The kiosk work-context label follows the product: a GembaWalk-
  only user is asked for an "Audit / project name" instead of Production #.
  `@spatial/shared` stays types-only at runtime (Render-crash doctrine) —
  the whitelist array lives with each consumer.
- **AR floating panels redesigned (A1/A4)** — the step panel now follows the
  platform design doctrine: solid dark surface, colored state band in the
  Designer's role palette (blue in-progress · green done · red recovery ·
  slate upcoming) with a "Step N / M" progress pill, 34pt title, 25pt body,
  requirement chips (Required / 🤖 Validated / 👤 Manual check / 📷 Evidence),
  and thumb-sized action buttons. Sizing rule: width fixed at 0.30 m, the
  body font NEVER shrinks — the panel's HEIGHT adapts to the text (growing
  upward, away from the machine) up to a cap, beyond which the body
  truncates behind a "▼ More" control that expands it in place. Hit targets
  reposition with the layout. Non-current panels (visible via the 👁 toggle)
  collapse to band + title, done ones adding a "✓ Completed HH:mm" stamp.
  The Designer pre-flight warns when step text exceeds ~280 characters.
  Delight pass: success haptic + green pulse on step completion, a session
  progress ring in the toolbar, and distance-aware panel scaling (beyond
  1.5 m the current panel grows up to 2.2× so type stays readable).
- **AR overlays: focus by default + live ghost opacity (A2/A3)** — the
  operator's 👁 toggle now governs the WHOLE step overlay set: numbered pins
  AND floating panels for other steps are hidden by default (current step
  only; the 3D ghost was already current-only) and appear on demand for
  orientation. Authors adjust ghost-model opacity with a live slider inside
  the AR placement view (see the effect on the machine, saved with the
  placement), and the portal's Guide Library gains a 👻 per-step opacity
  slider that saves directly — no editor round-trip. Usage Log also
  reworked into a dense grouped table (one row per session, expandable
  per-step timing, validation badges inline).
- **Step validation via Spatial Inspection (K4)** — a guide step can now
  demand a validation verdict before it completes. The Author trains it
  in-app (capture a reference photo → Verify with a live test compare →
  publish with the guide; Retrain/Remove any time); the reference is scored
  by the SAME comparator engine tag inspection uses (coarse registration +
  SSIM/patch-grid) via new step-scoped endpoints
  (`PUT/DELETE /guides/:id/steps/:stepId/validation-ref`,
  `POST …/validate`; `validationTrainedAt` is server-stamped). At run time
  a trained step asks the Operator for a photo and returns a system PASS
  (auto-completes, score shown) or FAIL (Retry / take the recovery branch);
  an untrained-but-required step falls back to explicit manual Pass/Fail.
  Every verdict — system score or manual choice — rides the live stream as
  `perception:result` and lands on the step's usage-log entry.
- **Evidence-required steps (K5)** — Authors can mark a step "Require
  evidence photo" (App editor toggle + Designer inspector checkbox, carried
  through the procedure compiler and reverse-compiler round-trip). Operators
  cannot complete such a step until a photo is attached — the camera opens
  with a notice instead. Closes the parked post-pilot P1.
- **Production-verified resume (K3)** — an interrupted guide run belongs to
  its Production #: resume snapshots are stamped with the shift's work
  context, and picking one up on the SAME Production # works as before.
  A snapshot from a different Production # gets an explicit prompt —
  "Switch & Resume" (moves the shift to that #) or "Start fresh on the
  current #" — so work is never silently logged against the wrong system.
  Pre-K3 (unstamped) snapshots keep resuming normally.
- **AR OMS Usage Log (K2)** — a durable, per-step usage record for every
  guide run, derived server-side from the live-session event stream: step
  enter/exit times, duration (operator-measured when available), outcome
  (completed / failed / left), session totals, operator identity (token-
  verified kiosk sign-in wins over client-typed fields) and the shift's
  **work context** — labelled Production # in AR OMS; other products relabel
  it (GembaWalk: audit/project name). Survives restarts, unlike the
  intentionally-ephemeral live session. `GET /guide-sessions/usage`
  (?workContext= / ?guideId=) serves it; the portal's AR Guides tab gains a
  📊 Usage Log toggle grouped by Production # with expandable per-step
  timing tables. iOS sends workContext + identity when opening a live
  session. Offline sign-offs finalise the record at link time even when the
  submit event never arrived. 3 new tests (159 total).
- **Kiosk shift start (K1)** — the iPad now opens on a shift screen when the
  allow-list is active: the technician enters ONLY their employee ID (the
  server resolves name/email/role — `POST /uam/login` gained an
  employee-ID-only kiosk path; the email+ID Settings path is unchanged) plus
  the **Production #** (chamber/system) they'll work on. Both persist for
  the shift and show in a home-screen chip — tap it to change the Production
  # or switch technician between shifts. A 401 on the launch refresh
  (revoked access) reopens the gate. The gate is deterministic: it renders
  immediately whenever no shift is set and owns the server connection itself
  (connecting state, cold-start retries, Retry button, dormant-UAM
  auto-skip) — it never waits on a network probe to appear. Known pre-SSO
  trade-off, approved:
  employee ID alone authenticates on kiosk iPads until HYPR SSO lands; the
  allow-list remains the gate and the SSO swap point is unchanged.
- **Canvas: precise connections, new shapes, self-loops** — edges now attach
  to the actual shape OUTLINE (diamonds/hexagons no longer show gaps where
  the old math hit the invisible bounding box), and every node gains four
  anchor ports (top/right/bottom/left, shown on hover): drag from a port to
  pin the edge's start, drop on a port to pin its end — pinned ends stay put
  as nodes move, unpinned ends keep auto-adjusting. Curves leave pinned
  ports perpendicular to the side. Three new shapes: circle, parallelogram
  (flowchart input/output), cylinder (data/store). Self-connections are
  allowed (one loop per node), drawn as an arc leaving one port and
  re-entering another. Curved is now the DEFAULT connector style — existing
  maps flip once; picking Straight now persists explicitly. One geometry
  source (insideShape/shapePathD) drives the canvas, edge attachment and
  the SVG export, so they cannot drift. 2 new server tests (155 total).
- **Solid-fill nodes** — designer cards are now solid-filled in a darkened
  layer palette (`NODE_FILL_COLORS`, tuned so white text passes WCAG AA on
  every fill) with white labels and white/near-white ornaments; the left
  color bar is gone — the fill IS the layer color. Selection and preview
  states became a light glow ring (a colored stroke vanishes on a colored
  fill); status dots keep a white ring, review verdicts sit on a white chip,
  the milestone diamond is ringed in the card fill, and the inline editor
  uses a dark scrim so editing never flashes white. SVG export matches.
  New doctrine (colors.ts): every future in-card ornament is designed
  against the dark fills — the white-card rule is retired.
- **Roadmap home redesign (S5)** — the map list is now a proper front door:
  a night-sky hero ("What will you build today?") with two glowing door
  cards — 🗺 Roadmap (gold) and 🧩 Procedure (teal), matching the canvas
  edge-role palette — that open an inline name field and create in place.
  Maps became a card gallery with kind badges (list API now returns `kind`),
  node/edge counts, relative updated time and the draft 🔒 badge. Import
  JSON / whiteboard photo / unlock-draft moved into a ⋯ menu; display name
  and API key live in a corner 👤 chip. All previous behaviour is preserved —
  only the arrangement changed.
- **Designer: issues drawer + autosaving node text (S5)** — the pre-flight
  warnings list no longer stacks inline: a count chip in the census row
  toggles a scrollable drawer grouped into "Blocking — fix before sending"
  and "Warnings — sending still allowed", so 20+ findings stay usable.
  Node text now autosaves while typing (500 ms debounce) and on blur —
  Enter is no longer required, and Escape simply closes the editor since
  nothing can be lost.
- **iOS RBAC (S4, beta)** — the app joins UAM. Settings → Identity gains
  Work Email + Employee ID and a "Verify Access" button: both must match the
  allow-list record; success caches the token + role (shown as a badge) and
  every request now carries X-User-Token, so per-user guide sharing and role
  enforcement apply on device. Technicians see operator surfaces only —
  Author Mode and the Continue-last-session card are hidden (and refused
  server-side regardless). On launch the app silently re-verifies: role
  changes propagate, revocation (401) clears the session, and offline keeps
  the cached role working. Transition note: a device that never verifies
  remains an unidentified legacy caller until the pilot enforces
  identified-only access.
- **Per-user guide sharing (S3, beta)** — guides can be shared with specific
  technicians. `Guide.sharedWith` holds allow-list emails (validated on
  write; unknown addresses are refused); the Guide Library gains a 👥 Share
  dialog listing technicians from UAM (new Engineer-readable
  `GET /uam/technicians`), with a share-count badge on the card. One
  visibility predicate gates the guide list, the single-guide read AND the
  steps read — excluded technicians get 404, never confirmation. Empty/no
  list = visible to all technicians (existing guides unchanged); Engineer+
  always see everything; only Engineer+ may edit sharing. Verified live:
  share/normalize/unknown-email-400, per-role list contents, deep-link 404s,
  clear-to-everyone. 4 new unit tests.
- **UAM — User Access Management, S1 server core (beta)** — RBAC ahead of
  corporate SSO. A manually managed allow-list (email + employee ID + role)
  gates sign-in: `POST /uam/login` rejects anyone not in the table and issues
  a 7-day HMAC token (cookie for the portal, header for iOS). Four roles —
  Owner, Manager, Engineer, Technician — with server-enforced rules: Managers
  manage everyone except Owner records and can never grant Owner; the last
  Owner can be neither demoted nor removed. Tokens carry identity only; the
  role is re-read per request, so changes and removals take effect
  immediately. Owners/Managers now pass the destructive-action gate by role
  (legacy admin key still honoured — and acts as Owner for bootstrap: unlock
  admin, add yourself, roles take over). All logins and user-table changes
  land in the ops log. SSO swap point: token issuing only. 5 new unit tests
  + a 14-step live authorization matrix.
  S2 — portal surface: with users in the list (`/config.uamActive`), the
  portal shows an email sign-in before anything loads; the header gains an
  identity chip (name · role) with Sign out; the Admin page gains the 👥
  User Access Management table (add / edit role / remove, with server-refused
  changes snapping back); only Owners/Managers see the Admin tab, and their
  session lifts the destructive-UI lock by role — no shared admin key needed
  day-to-day. Empty list = login off (bootstrap unchanged).
  Field fix from first deploy: on servers WITHOUT SIB_ADMIN_KEY, the gate-off
  fallback made every caller admin-equivalent, so the sign-in screen never
  appeared and anonymous callers could act destructively once users existed.
  The fallback now applies only while the allow-list is EMPTY — the moment
  users exist, management and destructive actions require an Owner/Manager
  sign-in (or the configured admin key), and the portal always shows the
  sign-in screen when UAM is active.
- **Operator pilot hardening (AR Work Instructions)** — six fixes from the
  operator-POV UX review ahead of daily technician use: (1) the authored
  failure branch is finally reachable — steps with a recovery path show
  "Step failed → go to recovery", confirm, record a `step:failed` live event
  and route to `nextOnFailure` (previously the branch existed only on paper);
  (2) session resume — step progress and evidence photos persist to the
  device after every action, and an interrupted run (call, battery, wrong
  tap) offers "Resume previous run?" for up to 12 h instead of forcing a
  redo; (3) offline sign-off queue — a failed submission offers "Save & sync
  later"; the record (evidence included) uploads automatically next time the
  guide list opens with a connection, with a green confirmation banner;
  (4) operator name prefills from Settings identity; (5) submitting with
  incomplete steps now warns with the count (warn not block — branch skips
  are legitimate); (6) precondition redirects explain themselves with a
  toast instead of silently jumping. New: Services/GuideRunStore.swift;
  `step:failed` added to the shared event union. Follow-up from testing with
  a real branching guide: (7) sign-off no longer demands completion of
  required steps on paths never taken (branch skips made it unreachable);
  (8) sequential auto-advance skips failure-only steps, so the happy-path
  terminal no longer walks into "Tag Out of Service"; (9) sign-off is
  offered on ANY terminal step — the happy end and failure dead-ends alike.
- **`.tag` live subscription (M2 — the continuous emitter)** — assembly
  envelopes' `subscribe.hints` now lead with a real SSE feed:
  `GET /anchors/:id/subscribe` sends `state` (contentVersion + payload hash)
  on connect and pushes `changed` events naming exactly which streams and
  member parts moved (`stream:worldmap`, `member:<tagId>`) so readers
  re-fetch only the delta and verify it against the new hashes. Event-driven
  server side: a store-write bus on JsonFileStore (single hook point) with a
  400 ms debounce, recomputed only for anchors with live subscribers, plus a
  30 s safety sweep for binary artifacts; heartbeats keep proxies alive. Push
  carries hashes and names only — never content. iOS gains `TagSubscription`
  (async SSE listener with auto-reconnect) in TagEnvelope.swift. Spec §7
  updated — subscribe graduates from hints-only.
- **Catalogue IP-sensitivity gate (secondary secret)** — features marked
  `sensitivity: restricted` in their frontmatter are redacted for anyone
  without the new `SIB_IP_KEY` env secret: /catalog/data strips body, flows,
  architecture, API lines and spec (node stays in the graph with a 🔒 chip +
  "Enter IP key" unlock), /catalog/doc returns 403, and Ask SIB excludes them
  from retrieval so it can't become a side-channel. Key travels as X-IP-Key
  (stored like the API key). Deliberately separate from the admin key — IP
  viewers ≠ data admins. Gate off when the env var is unset, so internal
  deployments are unchanged. All restriction decisions flow through ONE
  function (`canViewRestricted`) — the designated swap point when SSO/RBAC
  arrives. First restricted entry: the .tag format feature below. The
  browser-stored IP key expires after 7 days (shorter than the API key's 30 —
  it protects more sensitive content), after which the 🔒 prompt returns.
  Field fix: selecting a locked card no longer strands the node on the cursor
  (the missing spec button threw mid-click, skipping the drag release).
- **`.tag` virtual emitter v1 (beta)** — every tagged part and every chamber
  can now emit a signed, tamper-evident envelope (spec: docs/TAG-FORMAT.md,
  Proprietary & Confidential, patent pending). `GET /tags/:id/emit` yields a
  part envelope; `GET /anchors/:id/emit` yields the chamber assembly with a
  member manifest hashing every part beneath it (Merkle-style tree — one
  signature commits to the whole chamber's state). References + SHA-256 only,
  never inline payloads; deterministic emission (no timestamps or JSON
  numbers in the payload); Ed25519 issuer key auto-generated on first boot at
  `<data-dir>/tag-signing-key.json` (covered by data-scope backups). Zero new
  dependencies — Node built-in crypto server-side, CryptoKit on device.
  Conformance validator + 10 tests including emit→tamper→re-validate; iOS
  reference reader (TagEnvelope.swift) verifies, pins the issuer on first
  scan, and caches envelopes for offline in Documents/tags/. Subscribe is
  hints-only in v1; live per-chamber push lands in M2.
- **Per-feature API reference in the catalogue** — 47 features now carry an
  `api:` block ("METHOD /path — purpose (caller · auth tier)") rendered as an
  API section on the /catalog card between Architecture and the spec, with
  method chips and auth-tier annotations (API key / admin key / public).
  127 endpoint lines cover the full surface: anchors, tags, perception,
  sessions, guides + live SSE, models, mindmap/procedure, worldmap, Gemba,
  iLOTO, quiz admin, ask, admin/backup. `catalog:check` extracts the real
  Express routes from `sib/src` and fails on any listed endpoint that doesn't
  exist or any malformed line — the reference cannot silently drift from the
  code. UX-only features carry no API section rather than filler.
- **Catalogue "Read the spec" now section-scoped** — spec paths can carry a
  heading anchor (`spec: ../README.md#3d-model-library`) and `/catalog/doc/:id`
  serves just that section instead of the whole file. The 11 features whose
  source of truth is a README section (model library, ghost overlays, the six
  AR-OMS capabilities, guide library, task graph, encryption) now show only
  their section; features with dedicated deep-dive docs are unchanged.
  `catalog:check` validates anchors against real headings so a renamed README
  heading fails CI instead of silently degrading to full-file.
- **Rename 3D models in the portal** — each card in the 3D Models tab gains a
  ✏️ Rename action (display name only, via the existing `PATCH /models/:id`;
  files, kit assignments and step references untouched).
- **Three.js vendored (supply-chain hardening)** — the portal's 3D preview and
  browser GLB→USDZ converter no longer depend on unpkg at runtime:
  `npm run catalog:vendor` now also downloads Three.js r169 (core + GLTFLoader,
  USDZExporter, OrbitControls and their addon dependencies) into
  `sib/portal/vendor/three/`, and the portal's import map prefers the vendored
  copies, falling back to the CDN only when they're absent. Closes the last
  un-pinned third-party script on a page that holds an API key, and makes the
  converter work on networks that block CDNs.
## 2026.4.42 — 2026-08-11

### Added
- **Full site lock-down for internet-facing deployments** — with `SIB_API_KEY`
  set, EVERY surface now requires the key: home, portal, roadmap, wireframe,
  catalogue (+data/spec endpoints), Ask SIB, /stats, QR print pages. Browsers
  unlock once via a minimal public `/unlock` page (validates the key, sets a
  30-day HttpOnly cookie, pre-fills the portal's stored key); apps and APIs
  keep using the `X-API-Key` header. Only `/health`, `/unlock`, and a reduced
  `/config` (auth booleans only — `platformVersion` now requires auth) remain
  public. Internal deployments without the key are completely unchanged.
  Motivated by IP review: pre-filing material must not sit on public URLs.
- **Backup & restore** — the missing production-readiness piece: admin-gated
  `GET /admin/backup?scope=data|full` streams a timestamped `.tar.gz` of the
  data directory (data = JSON stores, small, weekly habit; full = evidence
  photos, world maps, 3D models too, before upgrades), with ⬇ buttons in the
  portal's ⚙ Settings behind the 🔒 Admin unlock. Restore is a documented
  stop → unpack → start procedure (INTERNAL-SERVER-DEPLOY.md) — deliberately
  not an endpoint. Verified by an automated drill: back up, restore into a
  fresh directory, boot, data intact. All /admin/* paths now require the
  admin key, and the home page gains a 🛠 Admin & Backups tile that deep-links
  to the portal's admin settings (/portal#admin) with the unlock prompt.
  Follow-up fixes from field testing: the Backups card now actually lives in
  ⚙ Settings (a bad insertion had landed it inside the anchor-card template),
  downloads show LIVE streamed progress ("42.3 MB received…") with locked
  buttons and inline success/failure status instead of a vanishing toast, and
  a new **🗒 Ops log** (Render-logs-style) records every admin-gated action —
  DELETEs, quiz admin, backups with size — as allowed/denied/gate-off with
  timestamp and IP, self-pruned to the newest 1,000, served by admin-gated
  `GET /admin/events` and viewable in Settings.
- **Guide Preview in the portal** — ▶ Preview on any Guide Library row walks
  the step sequence exactly as an operator would, no headset needed: a
  phone-frame modal with Complete ✓ / Failed ✗ / Skip traversal of the REAL
  branch graph (nextOnSuccess/nextOnFailure, requires-gate redirects shown
  explicitly), reference images, browser voice playback, reference links, and
  an exit summary listing steps never reached and failure branches never
  exercised. A placement banner ("N of M placed — operators can't run this
  yet") keeps content review honest about runnability. Client-side only.
- **Edit any guide in the Designer (round-trip)** — ✏️ Edit in Designer in the
  Guide Library opens the guide's procedure map, GENERATING one (named
  "[Guide] <name>") via a new reverse-compiler when none exists: steps become
  nodes, nextOnSuccess/nextOnFailure/precondition become Next/On-failure/
  Requires edges, voice/images/models/links carry over, and per-node provenance
  makes every re-sync an in-place update — AR placement always survives.
  Published-guide policy: content-only edits apply LIVE (operators just see
  better wording); structural edits require confirmation and unpublish until
  the new steps are placed. A stale flag warns when the guide changed
  elsewhere since the map last agreed with it. Designer supports
  /roadmap?map=<id> deep links.
- **In-AR assist UI (fix + redesign)** — AI hints were fetched and logged but
  drawn inside the content panel, which is hidden by default: invisible in the
  field. Assist is now its own overlay layer above the panel in every state —
  a glanceable ✨ chip that expands into a card with the hint, a Recovery-step
  button (nextOnFailure), and Replay voice. Stall-triggered hints auto-expand
  (the operator is stuck); retry hints stay collapsed. One hint at a time, soft
  haptic on arrival, 30 s per-step cooldown after dismissal, auto-clear on step
  completion, and a "Hints this session" tray so dismissed hints are
  recoverable. Server: AIHint gains an optional `trigger` (stall/retry) so the
  client knows why it fired — backward compatible.
- **Ask SIB** (beta) — a docs-grounded assistant: 💬 drawer on /catalog (and a
  home card) answering questions strictly from the Feature Catalogue and the
  dictionary, with cited features as permalink chips. Two tiers: retrieval
  (keyword-ranked sources + definitions — works on every deployment) and
  generation via any **OpenAI-compatible local model endpoint** — llama.cpp's
  llama-server or Ollama, chosen by `ASK_LLM_URL`/`ASK_LLM_MODEL` env vars, no
  code change. Public but rate-limited; grounding carries no site data; a down
  model degrades to retrieval with a note, never a hard failure.
- **Portal pilot-hardening**: (1) **Admin gate** — set `SIB_ADMIN_KEY` and every
  destructive action (all DELETEs, the LOTO quiz editor) requires unlocking
  🔒 Admin in the portal header; the server refuses without `X-Admin-Key`
  (the middleware is the guarantee, the hidden buttons are convenience), and
  deployments without the env var behave exactly as before. (2) **Filters +
  pagination** — Sessions, Gemba and AR Guides tabs gain free-text search,
  per-anchor and date-range filters, and show-more pagination (50 at a time),
  so review stays usable as pilot data grows. (3) **Tablet layout** — nav
  scrolls, tables scroll horizontally, bigger tap targets.
- **Home page live pulse** — `/` now shows anchors, sessions this week, open
  Gemba findings and **active LOTO locks right now** (red when any are held),
  fed by a new public `GET /stats` that returns aggregate counts only.
- **Catalogue durability + deep links** — `npm run catalog:vendor` downloads
  mermaid + marked into `sib/portal/vendor/` (loaded local-first, CDN
  fallback) so blocked CDNs can't blank the diagrams; `/catalog#feature-id`
  permalinks select the card on load (linkable from Slack/PRs/specs); the
  wireframe buttons deep-link to the right flow via `/wireframe#<flow>`.
- **Visual Feature Catalogue** (`/catalog`) — docs-as-data: `docs/catalog/`
  holds one YAML-frontmatter markdown file per feature (63 files, 7 area files
  with Mermaid flows, 3 role trails) as the canonical source;
  `GET /catalog/data` derives the full JSON graph from them live (also the
  future AI-grounding feed, with a reserved `?format=toon` seam) and
  `GET /catalog/doc/:id` serves each feature's deep-dive spec. The `/catalog`
  page renders it all as a connected graph — area clusters, shipped/beta/
  planned node styling, dependency edges, search, glossary hover definitions
  (glossary gained an iLOTO section), per-feature Mermaid flows, spec
  rendered in place, and three "start here" role trails for new team members.
  `npm run catalog:check` fails on any drift (dangling depends, unknown
  terms, missing specs) using the same rules as the endpoint;
  FEATURE-CATALOG.md is now explicitly a generated view of these files.
- **Portal — AR Guides import UX overhaul**: import from **Excel (.xlsx)**
  with a downloadable template (columns: Step, Title, Instruction, Voice,
  ImageURL, LinkURL, Optional, OnSuccess, OnFailure, Requires — header
  order-free), or JSON file, or pasted JSON. A parse **preview** (step count,
  media, branches, per-step warnings) gates the Import button; after import
  the portal jumps to the Guide Library, expands the new guide and flashes
  it — no more invisible imports. Guide Library gains an Import button, a
  live filter, and **⇄ Move to another anchor** (server moves the steps too,
  clears their placement — positions belong to the old anchor's world map —
  and unpublishes until re-placed).
- **SIB Home page** — GET / is now a landing with cards for the Web Portal,
  Roadmap & Procedure Designer, and the interactive App Wireframe (served at
  /wireframe), plus live server status and platform version.
- **iLOTO — up to 3 3D assets per point**: points now hold model SLOTS (e.g.
  lock + tag + hasp), each with its own device-owned AR placement; unadjusted
  slots fan out slightly to avoid overlap. Server enforces the cap and strips
  placement per-slot when that slot's model changes — other slots untouched.
  Legacy single-model points keep working (lifted into one synthetic slot).
- **Gemba Walk — minimized completion form**: arriving at a checkpoint now
  opens the completion sheet at a compact height with the AR view visible AND
  interactive behind it — drag up to expand. Dismissing no longer bounces it
  straight back open; it re-arms only after walking away (>1 m).
- **iLOTO — questionnaire editor + import**: the portal iLOTO tab gains a
  Training questions section — add/edit/delete questions inline (radio marks
  the correct answer), import from JSON or CSV (append or replace, validated
  ATOMICALLY server-side so a half-imported bank cannot exist), export JSON
  backup. New admin routes carry answers; the public quiz endpoint still
  strips them. Editing never touches issued certifications — future takers
  face the current bank.
- **iLOTO — model adjust gestures + reassignment**: drag / pinch / twist the
  3D lock model in AR (H/V pan modes, scale, Y-rotation — the AR Work
  Instructions gesture kit), saved as device-owned placement offsets on the
  point. Point detail gains a 3D model section for authors: assign, change or
  remove a model on EXISTING points; switching models resets placement
  server-side (a shape's placement dies with the shape), and "Adjust model in
  AR" jumps straight from the sheet into the gesture phase.
- **iLOTO — 3D lock/tag models on points**: assign a lock or tag model from
  the 3D Model library when placing a Safe Off / LOTO point; the marker then
  renders the USDZ model GHOST (translucent) while the point is clear — "a
  lock belongs here, this kind" — and SOLID the moment a lock is applied.
  Models upgrade in place as USDZs download; the ring stays as tap affordance
  and state colour. Uses the existing library end-to-end: upload in the
  portal, assign to the anchor kit or mark General.
- **iLOTO slice 4 — AR LOTO map**: draw the panel's electricity flow in AR by
  tapping vertices along the conduit; starting a line on a Safe Off marker
  links it to that breaker, making the map STATUS-AWARE — lock out the breaker
  and its lines turn grey and pulse-free live, restore it and the teal flow
  pulse returns. Versioned saves (history kept), view/edit/delete home screen.
- **iLOTO fix — QR-gated AR sessions**: every iLOTO AR surface (point
  authoring, status walk, map drawing) now starts with the mandatory panel-QR
  scan, exactly like AR Work Instructions: QR locks the session origin,
  ARWorldMap relocalizes (local → SIB → fresh), and the live session is
  adopted without a frame reset — positions consistent across devices and
  sessions. Found in field testing: slice 2 sessions skipped the gate.
- **Portal iLOTO tab** — EHS review surface: live status board for every
  control panel (per-point state, owner, serial), audit trail with override
  events pinned first and evidence photos in the lightbox, certification
  registry (valid / expired / failed), and one-click CSV export of events and
  certifications. Read-only by design.
- **iLOTO slice 3** — the gate opens: training quiz UI (one question at a
  time, server-graded, failed attempts reviewed with the correct answer and
  explanation — the explanations ARE the training), certification issuance
  live with expiry; My LOTO view — every lock the user holds across all
  panels with a one-tap deep-link into the Remove flow; hub My LOTO tile
  turns red with a live count when any locks are held (the shift-end nudge).
- **iLOTO slice 2** — the working loop: AR point authoring (tap breakers/
  switches to place yellow/red markers; panel ARWorldMap saved on author exit
  so every later session relocalizes), ordered Apply checklists (notify →
  shutdown → lock → photo → try test → serial) and Remove checklists with the
  supervisor-override form behind an explicit second decision, Check Status as
  list + AR walk (solid = locked, hollow = clear), and a point-detail sheet
  with the append-only event history and evidence photos. Server 4xx messages
  surface verbatim — the client makes the right path easy; the server stays
  the referee.
- **iLOTO slice 1** — spatial Lockout/Tagout foundation
  ([docs/ILOTO.md](docs/ILOTO.md)): 'LOTO' anchor type (one anchor per control
  panel, full QR + worldmap flow), authored isolation points (yellow Safe Off
  on breakers / red LOTO on switches), **append-only event log** with
  server-enforced rules — per-kind checklists incl. the mandatory try test,
  photo evidence on apply, one-lock-one-person removal, OSHA-exception
  supervisor override as a distinct event type — derived status endpoints
  (panel banner + cross-anchor My LOTO), seeded 16-question OSHA 1910.147
  training bank with server-side grading and expiring certifications, and the
  iOS iLOTO hub (status banner, six tiles, live certification gate). Apply/
  Remove flows, AR authoring, quiz UI and the AR LOTO map follow in slices 2–4.
- **Preview mode** — ▶ Preview in the procedure bar walks the procedure as the
  operator will experience it: phone-frame step card (title, instruction,
  reference image, voice playback via browser speech synthesis),
  Complete ✓ / Failed ✗ buttons that traverse the real edge graph, canvas
  highlight of the current step, requires-gate redirects, and an exit summary
  listing branches never exercised. Purely client-side; nothing is saved or sent.
- Reference link per step — any http(s) URL (video, PDF, SOP page) authored in
  the Inspector, carried through compile → export → ingest, and shown as a
  tappable "Reference" button on the iOS AR step panel (opens in Safari; the
  platform stores no copy).
- Auto-sizing nodes — cards wrap titles up to four lines and grow to fit
  instead of truncating at 20 characters; edge anchors, minimap, marquee,
  auto-layout, presentation bounds and SVG export all follow the real height.
- Edge type switcher — select a connection on a procedure map and change
  Next / On failure / Requires in the side panel (no more delete-and-redraw).
- Canvas legend + role explainer — line swatches in the procedure bar census
  and a ? panel explaining paths (Next / On failure) vs rules (Requires);
  RolePicker copy rewritten in operator language, Enter confirms Next.
- Step content glyphs (voice / image / model) enlarged onto a white pill so
  they stay legible on the night canvas.
- Procedure Designer slice 2 — step content authoring on the canvas: voice
  script, optional-step toggle, reference images (uploaded to a content-addressed
  designer store, copied into the guide at export) and 3D model assignment with
  scale. Model semantics: canvas owns assignment, device owns AR placement;
  switching models clears stale placement.
- Day/night canvas theme — procedure maps default to a dark canvas so an
  executable procedure is visually distinct from a planning roadmap; toggle in
  the toolbar, per-map-kind preference. Node cards stay white in both themes so
  nothing inside them can lose contrast.
- **Procedure Designer** — `procedure` maps on the Roadmap canvas: role-typed
  edges (Next / On failure / Requires) with a relationship picker, server-derived
  step numbers, pre-flight validation, and one-click send to the Guide Library as
  a draft. Re-sync updates steps in place and never overwrites AR placement.
  ([docs/PROCEDURE-DESIGNER.md](docs/PROCEDURE-DESIGNER.md))
- Guide ingestion service (`sib/src/guides/ingest.ts`) — single create/upsert
  path shared by JSON import and procedure export, with spatial preservation as
  a tested invariant.
- `step:stalled` live-session event + iOS dwell watchdog (90 s) feeding the AI
  guide adapter, alongside the existing retry trigger.
- Guide Library ⬡ Graph: link census header (steps / success / failure /
  precondition / lanes) and a purely-sequential-guide notice.
- Feature catalog ([docs/FEATURE-CATALOG.md](docs/FEATURE-CATALOG.md)),
  versioning standard ([docs/VERSIONING.md](docs/VERSIONING.md)), and
  `PLATFORM_VERSION` surfaced at `/config` and in the portal header.
- Operator FTUE for AR Guide sessions + always-available ? help.

### Changed
- `POST /guides/import` now routes through the shared ingestion service
  (behaviour pinned by tests before the refactor).
- AI hints: stale hints are discarded at poll time and auto-dismissed when their
  step completes.
- Guide Library graph lane algorithm rewritten: failure branches get their own
  lanes; forks are detected against the success target rather than sequence
  position, so adjacent-detour procedures render correctly.

### Fixed
- Notes and voice-script edits silently lost when clicking from the field
  straight onto the canvas — the panel unmounted before blur fired, so the
  save-on-blur handler never ran (reported as "can't save notes unless we add
  a comment"). Fields now commit on blur AND on unmount, with a Saved ✓ tick.
- Blank page when creating the first node on any map — React #310 caused by a
  hook after an early return in `Minimap.tsx` (pre-existing; exposed during
  Procedure Designer testing).
- `sanitizeEdge` / `saveMindmap` silently dropping new fields (`role`, `kind`,
  `anchorId`) on save.
