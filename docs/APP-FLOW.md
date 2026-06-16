# App Flow

A walkthrough of every screen in the app, for both the Author and Operator roles. Open **[APP-WIREFRAME.html](APP-WIREFRAME.html)** in any browser for a clickable interactive version of this flow — no build tools required, just double-click the file.

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
   - **Honeycomb capture** — 7 fixed viewpoints around the tag, proximity auto-triggers each shot
   - **OCR capture** — for text/gauge-reading tags
   - On success, tap **Done** — the marker turns green ("trained") and you're back in the AR view. On failure (e.g. no frames captured, upload error), an inline error appears and you simply retry the same action — there's no separate failure screen.
7. **Tag list** (sheet, from the list icon) — every tag for this anchor, with swipe actions:
   - **Edit** → **Edit Tag** sheet (label/description, plus a button to re-capture training images)
   - **Delete**
   - **Train →** — re-enters the AR view in navigation mode (a pulsing target + distance readout guides you back to the tag's location) and opens the same capture screen
8. **Share QR** (icon, anytime) — opens the **QR Generator** sheet to print or send the anchor's QR to Operators
9. **Done** (top bar) — ends the session and returns to **Mode Selection**

---

## Operator flow

1. **Mode Selection** → tap **Operator Mode** → **Anchor Directory** → pick an anchor → **Anchor Hub** (shows a readiness warning if any tags are still untrained)
2. **QR Scan Gate** — same mandatory QR lock as the Author flow
3. **Operator AR view** — walk near a trained tag to auto-capture and validate it, or tap **Inspect All** to validate everything in one pass. Markers are color-coded live: gray = pending, green = PASS, red = FAIL.
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
| **Honeycomb** | Tags needing wide-angle coverage | Visits 7 fixed viewpoints arranged around the tag |
| **OCR** | Gauges, labels, displays with readable text | Captures straight-on shots optimized for text recognition |

---

## See also

- **[APP-WIREFRAME.html](APP-WIREFRAME.html)** — interactive, clickable version of this flow
- **[IOS-SETUP.md](IOS-SETUP.md)** — build and run the app that implements this flow
- **[SERVER-REFERENCE.md](SERVER-REFERENCE.md)** — the SIB endpoints each screen calls
