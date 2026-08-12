# App Flow

A walkthrough of every screen in the platform. Open **[APP-WIREFRAME.html](APP-WIREFRAME.html)** in any browser for a clickable interactive version covering all **seven flows** — Author, Operator, AR Guides, Gemba Walk, **iLOTO**, **Procedure Designer**, and the Web Portal. No build tools required, just double-click the file.

This document details the two tag-inspection flows in depth, then summarises the newer flows with pointers to their full specs.

---

## Entry point

The app launches straight into **Mode Selection** — there's no QR gate before this point. From here you choose **Author Mode** or **Operator Mode**, both of which route through the same **Anchor Directory** → **Anchor Hub** → **QR Scan Gate** sequence before reaching the role-specific AR screen.

`SettingsView` (server URL / API key) and `HelpSheet` (contextual help) are reachable from the home screen and from inside both modes via their respective icons.

---

## Author flow

1. **Mode Selection** → tap **Author Mode** → **Anchor Directory** opens (list of all anchors on the server)
2. Tap an existing anchor, or **Create** a new one (a short 2-step wizard ending in a QR code you can save/share)
3. **Anchor Hub** — shows the anchor's tag list and an **Enter AR Session** button
4. **QR Scan Gate** — point the camera at the anchor's printed QR code. This is mandatory: it locks the AR session to that physical anchor's location. A wrong QR (belonging to a different anchor) shows a brief error and lets you retry.
5. **Author AR view** — tap any detected surface to drop a pending tag marker, which opens the **Add Tag** sheet:
   - **Train now** — saves the tag and immediately opens a capture screen (see step 6)
   - **Save & train later** — saves the tag and returns to the AR view; you train it later from the tag list
6. **Capture screen** — one of three modes depending on the tag type:
   - **Cone capture** — Author walks through a cone-shaped sweep of guide spheres around the tag, capturing as they go
   - **Honeycomb capture** — 19-zone dome of guide spheres around the tag, proximity auto-triggers each shot
   - **OCR capture** — for text/gauge-reading tags
   - On success this records the tag's **Pass** reference set. On failure (e.g. no frames captured, upload error), an inline error appears and you simply retry the same action — there's no separate failure screen.
7. **Train Fail State?** (new, optional) — right after a successful Pass capture, the app asks whether you also want to record what the *wrong* condition looks like (unplugged, closed, switched off). Choosing **Train Fail State** repeats the same capture flow against the faulty condition and stores it as a completely separate reference set — training one state never touches or merges with the other, and skipping leaves the tag exactly as it worked before this feature existed.
8. **Mark Inspection Region** (new, optional) — after Pass (and Fail, if trained), an ROI picker lets you drag a box around just the relevant feature in the reference photo, so validation later ignores the rest of the scene. Drag the box to move it, drag any of 8 corner/edge handles to resize, or tap **Skip** to validate against the full frame as before. A magnifier loupe follows your finger while resizing for precise placement, with a **Reset** button to snap back to the default centered box.
9. **Tag list** (sheet, from the list icon) — every tag for this anchor, with swipe actions:
   - **Edit** → **Edit Tag** sheet (label/description, plus buttons to re-capture Pass images, train/re-capture Fail images, and adjust the Region of Interest — each independent of the others)
   - **Delete**
   - **Train →** — re-enters the AR view in navigation mode (a pulsing target + distance readout guides you back to the tag's location) and opens the same capture screen
10. **Share QR** (icon, anytime) — opens the **QR Generator** sheet to print or send the anchor's QR to Operators
11. **Done** (top bar) — ends the session and returns to **Mode Selection**

> **Retraining behavior**: re-capturing Pass or Fail images always fully replaces that state's existing reference set (old images are deleted, new ones saved) — it never merges with or incrementally updates what's already there, and retraining one state never affects the other.

---

## Operator flow

1. **Mode Selection** → tap **Operator Mode** → **Anchor Directory** → pick an anchor → **Anchor Hub** (shows a readiness warning if any tags are still untrained)
2. **QR Scan Gate** — same mandatory QR lock as the Author flow
3. **Operator AR view** — walk near a trained tag to auto-capture and validate it, or tap **Inspect All** to validate everything in one pass. Markers are color-coded live: gray = pending, green = PASS, red = FAIL. For any tag that only has a Pass reference, validation compares against an absolute confidence threshold (adjustable via the on-screen slider). For any tag with a Fail reference also trained, validation instead uses a relative nearest-match comparison — whichever reference set (Pass or Fail) the live frame is closer to — which tends to be more reliable when the wrong condition looks meaningfully different from the right one.
4. **End Inspection** → **Validation Results** sheet — a per-tag PASS/FAIL summary. From here:
   - **Close** — back to the AR view, markers stay as last validated
   - **Re-inspect Failed Tags** / **Re-inspect All Tags** — resets the relevant markers and loops back into the AR view for another pass
   - **New Scan** — exits to **Anchor Directory** to start an inspection on a different anchor (a fresh QR Scan Gate follows)
5. **Exit** (X in top bar) — returns to **Mode Selection** at any time

---

## Capture modes at a glance

| Mode | Used for | What the Author does |
|---|---|---|
| **Cone** | General-purpose tags | Sweeps through a cone of guide spheres positioned in front of them |
| **Honeycomb** | Tags needing wide-angle coverage | Visits a 19-zone dome of guide spheres arranged around the tag |
| **OCR** | Gauges, labels, displays with readable text | Captures straight-on shots optimized for text recognition |

Each capture mode feeds the same downstream pipeline: a successful capture becomes the tag's **Pass** reference set, optionally followed by a **Fail** reference set (same capture mode, faulty condition) and an optional **Region of Interest** crop — see the Author flow steps above.

---

## iLOTO flow (Lockout/Tagout)

Full spec: **[ILOTO.md](ILOTO.md)**. An anchor with type **iLOTO** is one control panel (QR + world map). The rule that shapes everything: the event log is **append-only**, status is always derived from it, and the app is the record — the physical lock and the operator's own try test are the safety controls.

1. **Anchor Directory** → create anchor, type **iLOTO** (same QR print + mount flow as tag anchors) → **iLOTO Hub**
2. **Hub** — live status banner (x LOTO active · y safe off), six tiles. **Safe Off** and **LOTO** are locked until the user passes **My LOTO Training** (server-graded quiz, certification with expiry; question bank editable/importable by EHS in the portal)
3. **Define points** (author, per kind) — mandatory QR scan locks the AR origin, then tap breakers (**yellow Safe Off**) and switches (**red LOTO**) to place markers; optional 3D lock/tag model from the shared library, adjustable in AR (drag/pinch/twist). World map re-saves on exit
4. **Apply** — ordered checklist enforced step by step: notify affected → shut down → apply physical lock → **photo evidence (required)** → **try test** → lock serial → recorded. Safe Off uses a shortened list. The server re-validates everything
5. **Remove** — reverse checklist, own locks only (one lock, one person). Someone else's lock offers only the documented **supervisor override** (three OSHA exception confirmations + reason, pinned in every audit)
6. **Check Status** — AR walk-around: solid = locked, hollow = clear, tap any marker for owner/history/photos. The **AR LOTO Map** overlays drawn electricity-flow lines that grey out live when their feeding breaker is safe-off'd
7. **My LOTO** — every lock the user holds across all panels, with one-tap remove; the hub tile counts them in red (the shift-end nudge)
8. **Portal → iLOTO tab** — EHS review: status board, audit trail (overrides pinned, evidence lightbox), certification registry, CSV exports, training-question editor with atomic JSON/CSV import

---

## Procedure Designer flow (web canvas)

Full spec: **[PROCEDURE-DESIGNER.md](PROCEDURE-DESIGNER.md)**. Served at `/roadmap`; a **procedure** map (kind chosen at creation, immutable) compiles into an AR Work Instructions guide.

1. **Map list** → **+ New procedure** → the night-mode canvas (cards stay white — contrast is guaranteed)
2. **Draw steps** — nodes auto-size to their text; connections carry meaning: green **Next** (the operator's path), red **On failure** (recovery), dashed amber **Requires** (a rule, not a path). Enter defaults to Next; a connection's type can be changed later in the Inspector. Step numbers are **server-derived** from the graph, never typed
3. **Step content** (Inspector) — voice script, optional toggle, reference image, 3D model assignment, and a reference **link** (video/PDF/SOP — opens on the operator's phone). Notes/voice autosave on blur *and* unmount
4. **▶ Preview** — phone-frame rehearsal traversing the real graph (Complete/Failed buttons, requires-gate redirects, browser-voice playback, branch-coverage summary). Nothing is saved or sent
5. **Send to Guide Library** — pre-flight validation must pass; creates/updates a **draft** guide with new steps unplaced. AR placement happens on device and is never overwritten by a re-sync (device-owned, the platform invariant). From there the guide continues in the **AR Guides** flow

---

## See also

- **[APP-WIREFRAME.html](APP-WIREFRAME.html)** — interactive, clickable version of all seven flows
- **[ILOTO.md](ILOTO.md)** — iLOTO spec: event model, checklists, override procedure
- **[PROCEDURE-DESIGNER.md](PROCEDURE-DESIGNER.md)** — Procedure Designer spec: compiler, validation, re-sync rules
- **[FEATURE-CATALOG.md](FEATURE-CATALOG.md)** — every platform feature with its shipped version
- **[IOS-SETUP.md](IOS-SETUP.md)** — build and run the app that implements these flows
- **[SERVER-REFERENCE.md](SERVER-REFERENCE.md)** — the SIB endpoints each screen calls
