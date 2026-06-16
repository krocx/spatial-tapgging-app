# App Features — Full iOS App, Including AR Components

This covers the whole app end to end: AR mechanics, anchor lifecycle, tag lifecycle, settings, help, and navigation. For what happens to a tag once it's trained (scoring, capture modes, calibrated thresholds), see [SIB-TRAINING-FEATURES.md](SIB-TRAINING-FEATURES.md) — this doc focuses on everything around that, including how the AR scene itself is built and rendered.

---

## 1. AR components

**Rendering framework:** SceneKit (`ARSCNView`), not RealityKit. Every AR/capture screen either shares one `ARSCNView`/`ARSession` (owned by `ARSessionManager`) or wraps its own local `ARSCNView` explicitly pointed at that same shared session. All 3D markers and guides are plain `SCNNode`/`SCNGeometry` — torus, sphere, cone, cylinder primitives — there's no RealityKit entity/component anywhere in the codebase.

**Session lifecycle:** there are two different `UIViewRepresentable` wrapper styles in play, on purpose. The primary Author/Operator AR screens pause the session on teardown (`dismantleUIView` calls `session.pause()`). The capture screens (Cone/Honeycomb/OCR) deliberately *don't* do this — their local wrapper structs skip `dismantleUIView` entirely, with comments calling it out explicitly, so that navigating into a capture screen and back never tears down the shared session the parent AR view (and the locked anchor transform) depends on.

**World tracking / relocalization:** when re-entering a previously-anchored scene, the app loads a saved `ARWorldMap` and runs the session with `.removeExistingAnchors` but *not* `.resetTracking`, so ARKit relocalizes into the same coordinate frame instead of starting a fresh one. A `isRelocalizing` flag drives the UI (an orange "Relocalising…" banner) until tracking reaches `.normal`, with a 15-second timeout that falls back to a fresh session rather than hanging. The QR scan gate downloads the anchor's world map on appear (a 404 just means "no map yet, start fresh") and uploads a new one right after a successful lock, fire-and-forget.

**QR detection:** Vision's barcode detector runs against the live AR camera frame, restricted to QR codes only, and requires 6 consecutive frames with the *same* decoded payload before it fires — this debouncing avoids false locks from a single blurry frame. The precise 6-DOF pose then comes from an AR reference-image + PnP solve, not from the flat 2D rectangle Vision returns.

**Gravity-normalized anchor frames:** this is a subtle but important piece — the same QR code, scanned from different angles, used to produce slightly different anchor coordinate frames. The fix re-derives the anchor's X/Y axes from the constant world-up vector instead of trusting the raw scan transform, with a threshold that distinguishes "this is a floor/ceiling" from "this is a wall" so each gets the right derivation. Net effect: tags land in the same relative spot regardless of the angle you scanned the QR from.

**Plane/surface detection for tag placement:** the Author-mode placement reticle raycasts against estimated planes at any alignment (not just horizontal), with exponential smoothing on the result to cut down on jitter, and a small forward offset so the reticle doesn't z-fight with the surface it's tracking.

**LiDAR depth:** uses `ARFrame.sceneDepth` where available, falls back to `estimatedDepthData`, and returns nothing at all on hardware without a depth API (pre-LiDAR devices) — so depth-assisted scoring is a bonus on supported hardware, not a hard requirement.

**AR marker/guide visuals** — four distinct systems, all unlit so they read as clean overlay graphics rather than lit 3D objects competing with the real scene lighting:
- **Placement reticle** (Author, tap-to-place): a torus ring + center dot. Cyan once it's tracking a real surface; a translucent, slowly pulsing white ring while still searching.
- **Cone aiming guide**: a ring + a translucent solid cone fill + a pulsing apex dot. Cyan while the Author is live-tracking it; reconstructed in yellow for Operator playback; turns green once your alignment angle is under the threshold that counts as "aimed correctly."
- **19-zone training dome** (the grid you sweep across during Cone capture): 19 small spheres around the tag — white/half-opaque for uncaptured zones, yellow and growing while you're actively holding on one, green with a halo once it's captured — connected to the tag's center by thin guide wires.
- **Honeycomb 7-point hemisphere**: numbered targets that go gray → cyan (active) → green (captured), plus a 3D arrow pointing toward whichever viewpoint you should move to next.
- **Operator-mode tag status markers** are colored independently of all of the above: gray = pending, green = PASS, red = FAIL.

**Crosshair / reticle (2D overlay):** a separate, simpler Apple-Measure-style 2D crosshair exists for QR-lock contexts — a faint pulsing dot/ring while unlocked, a crisp cyan dot + ring + four corner brackets once locked. This is distinct from the 3D placement reticle used for actually placing tags.

---

## 2. Anchor lifecycle

- **Creation:** a short wizard in the Anchor Directory — name the asset, the server generates the QR code, done. The same canonical QR PNG is what gets shown/shared afterward.
- **QR-locking:** scanning the anchor's QR is a mandatory gate before entering AR, for both roles. A 4-corner dot overlay tracks the QR's pose live as it's being detected. Scanning the wrong anchor's QR shows a brief error and lets you retry — it doesn't silently fail or hard-stop.
- **Encryption key handling on scan:** if the scanned QR was generated by the app, it carries the anchor's encryption key directly. If it's a bare/legacy QR without an embedded key, the app falls back to a previously-stored key in Keychain; if neither is available for an Operator, a clear warning explains inspections will show 0% confidence and to ask the Author to share the in-app QR instead.
- **Readiness gate (Operator only):** if zero tags are trained yet, "Continue to Operator Mode" is disabled outright with an explanatory message. If only some tags are trained, a softer non-blocking warning tells you how many, and lets you continue anyway (untrained tags just show as PENDING).
- **Directory → Hub → QR Gate → AR view** is the same chain for both roles — Author and Operator share the literal same directory/hub/gate components, just with role-specific actions surfaced (Author gets a "+" to create anchors and a Share-QR action; Operator doesn't).

## 3. Tag lifecycle

- **Creation (`AddTagSheet`):** pick a capture mode (Honeycomb / Cone / OCR), which also sets a sensible default tag type; or start from a quick-suggestion chip (e.g. "Pressure Gauge," "Safety Label," "Cable Routing," "Serial Number") that pre-fills both label and type. A tag can't be saved without an actual AR surface placement — if you didn't hit a real surface, the sheet tells you to close it and tap again rather than letting a position-less tag get created. Two ways to finish: **Train now** (jumps straight into capture) or **Save & train later** (leaves it pending).
- **Editing (`EditTagSheet`):** a standard system Form — read-only type/ID at the top, editable label/check-description/expected-outcome below, and a retrain button whose label changes based on state ("Capture Pass Images" if never trained, "Re-capture Pass Images" if it has been, with an explicit warning that re-capturing replaces the existing trained state).
- **Deletion / retraining navigation:** the tag list sheet supports swipe-to-edit and swipe-to-delete, plus a "Train →" action on untrained tags that re-enters the AR view in a guided navigation mode — a pulsing target plus a live distance readout walks you back to that tag's exact physical location before dropping you into the capture screen.

### Tag types, icons, and colors

| Tag type | Icon | Color | Default capture mode |
|---|---|---|---|
| Inspection Point | magnifying glass | blue | Honeycomb |
| Defect | warning triangle | red | Cone |
| Instruction | bullet list | purple | Cone |
| Warning | shield exclamation | orange | OCR |
| Measurement | ruler | cyan | Cone |
| Presence Check | checkmark square | green | Cone |
| Language Check | book | indigo | OCR |
| Routing Check | branching arrow | yellow | Cone |
| Configuration Check | gear | gray (custom, not the system gray) | Cone |
| Part Check | puzzle piece | mint | Cone |

Language Check and Warning are the only two types that use OCR text capture instead of photo capture; Inspection Point is the only one that defaults to the 7-point Honeycomb sweep; everything else defaults to the Cone sweep.

## 4. Settings

- SIB server URL and API key live in a Settings screen, persisted in **UserDefaults** — plain, not Keychain.
- By contrast, the per-anchor AES-256-GCM image-encryption keys *are* stored in Keychain. So there's an intentional split: server credentials are casual local prefs, anchor encryption secrets get the more secure store. Worth knowing if the API key is ever treated as more sensitive than it currently is.
- Settings also includes a way to export inspection logs as a share sheet, for pulling debug data off a device.
- The API key header is only meaningful if the server has `SIB_API_KEY` set — if the server doesn't require it, the header is sent but simply ignored.

## 5. Help system

Built from short, numbered step-cards, with different content depending on where you open it:
- **Home screen:** explains the Author/Operator split, the "Continue Session" shortcut, and sharing an anchor's QR.
- **Author mode:** placing tags, the optional QR scan (tags placed before scanning use estimated positions and auto-upgrade once you do scan), training each tag, what "training complete" means, and sharing the QR with the team.
- **Operator mode:** scanning the anchor QR, inspecting each tag, reading PASS/FAIL results, and re-inspecting failures.
- **Anchor directory:** browsing anchors, creating a new one, the QR-scan-at-session-start step, and the existence of a web portal version of the directory.

## 6. Navigation & UX

- The app launches straight into Mode Selection — there's no onboarding flow and no QR gate before that point.
- From there it's Directory → Hub → QR Scan Gate → role-specific AR view, for both roles.
- Tag creation/editing, the QR generator, and inspection results all appear as sheets; the three capture screens (Cone/Honeycomb/OCR) behave like full-screen takeovers with their own top/bottom chrome and an explicit close button, rather than relying on a standard nav-bar back button.
- **Status banners** give plain-language feedback at every AR step: "Scanning for QR Code…", "QR Detected — Locking…", "Anchor Locked ✓" for the scan gate; and separately, tracking-quality banners like "Moving too fast — slow down," "Not enough visual detail — point at a textured surface," and "Relocalising — slowly scan the environment" whenever ARKit's own tracking confidence drops.

## 7. Known limitations (confirmed, not guessed)

- **Accessibility is minimal.** There's exactly one VoiceOver label in the entire app (the show/hide-tag-markers toggle in Operator mode). No Dynamic Type scaling support exists anywhere — text sizes are fixed regardless of the system's accessibility text-size setting.
- **API key isn't in Keychain.** Worth revisiting if the server's auth model gets more serious — see "Settings" above.
- **Possible leftover/dead code:** an older 2D hex-grid HUD component for Honeycomb capture appears to have been superseded by a newer diagram component, but wasn't fully traced to confirm it's unused — flagging it rather than asserting it's dead.
- **Two overlapping QR-scan-and-lock screens exist in the codebase** with very similar functionality. Which one is the actual live path versus a leftover alternate implementation wasn't conclusively resolved — worth a follow-up check before assuming both are equally "current" if you're modifying that flow.
- **OCR/Language-Check tags are trained from a single reference image**, by design (a printed label doesn't benefit from multi-angle capture the way a 3D object does) — but that also makes them more sensitive to lighting and glare than the multi-viewpoint Cone/Honeycomb tags, and there's no extra mitigation for that beyond the generic SSIM fallback score.
- **First session on a brand-new anchor has no saved world map yet**, so tag placement that very first session is subject to a bit more positional noise than every session after it, once the map exists and later sessions can relocalize against it.
- Two specific issues are explicitly flagged in `PHASE-HISTORY.md` as deferred rather than fixed: occasional validation failures even when re-capturing what looks like the same trained area, and further payload-size optimization on the client side.

---

See also: [SIB-TRAINING-FEATURES.md](SIB-TRAINING-FEATURES.md) for scoring/training-specific detail, [APP-FLOW.md](APP-FLOW.md) for the screen-by-screen walkthrough, and [APP-WIREFRAME.html](APP-WIREFRAME.html) for the clickable wireframe.
