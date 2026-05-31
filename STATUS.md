# Spatial Tagging App — Project Status
> Last updated: 2026-05-24 | Phase 1 complete, Phase 2 planned

---

## What This Is

A web-based AR inspection platform for industrial workflows.
Two roles work in sequence on the same physical asset:

- **Author** — Expert trains each inspection point (tag) once, from 8 angles.
- **Operator** — Any operator scans, navigates to the tag, captures a frame, gets PASS/FAIL.

No app install. Runs in iPhone Safari via HTTPS.

---

## Monorepo Structure

```
spatial-tagging-app/
├── shared/          @spatial/shared — canonical TypeScript types
├── sib/             @spatial/sib    — Express REST backend (SIB)
└── ar-client/       Vite + Three.js + WebAR frontend
```

---

## How to Run

```bash
# Terminal 1 — SIB backend (port 3001)
cd sib && npm run dev

# Terminal 2 — AR client (port 5173, HTTPS via mkcert)
cd ar-client && npm run dev

# iPhone: https://<your-mac-ip>:5173
# (mkcert cert must be installed as trusted profile on iPhone)
```

---

## Phase 1 — COMPLETE ✓

### Features Shipped

| Feature | Status | Notes |
|---------|--------|-------|
| Camera AR (getUserMedia) | ✓ | `facingMode: environment`, rear camera |
| Device orientation tracking | ✓ | DeviceOrientationEngine, iOS permission-gated |
| QR scanning (jsQR) | ✓ | Decodes any standard QR with `{ assetId, anchorId }` JSON |
| Placement reticle | ✓ | Green ring + laser line, 1.5m ahead of camera |
| Honeycomb capture sphere | ✓ | 8 Fibonacci nodes, screen-space 500ms dwell alignment |
| Virtual sticky-note TagMarker | ✓ | Canvas texture, set-once orientation, gold dot + pin |
| Off-screen direction arrow | ✓ | CSS gold triangle, angle-clamped to screen edge |
| Spatial guide lines | ✓ | Dashed gold Three.js lines from QR origin → tags |
| QR-relative tag positions | ✓ | `qrRelativeRotation` quaternion + `tagDistance` in metadata |
| JSON file persistence | ✓ | `JsonFileStore` survives SIB restarts; `.sib-data/*.json` |
| Real PASS/FAIL detection | ✓ | SSIM + histogram intersection via jimp@0.22 |
| iOS pinch-zoom prevention | ✓ | `gesturestart/end` prevention + CSS `touch-action: none` |
| Multi-tag per session | ✓ | All tags for an anchor loaded in Operator mode |

### Key Architecture Decisions

**No WebXR (by design for Phase 1)**
WebXR requires HTTPS + browser flag + specific device support.
We use `DeviceOrientationEvent` (rotation only) + fixed camera position at origin.
Limitation: Tags don't persist across camera movement (no positional tracking).

**QR as Spatial Origin**
QR codes carry `{ assetId, anchorId }` JSON. The `anchorId` is used as the SIB anchor ID
(same value), so Operator can always look up tags by scanning the same QR.
Author stores `qrRelativeRotation` (quaternion from QR-scan orientation to tag-placement
orientation) and `tagDistance` in tag metadata. Operator reconstructs position by composing
its own QR-scan quaternion with the stored relative quaternion.

**SSIM + Histogram for PASS/FAIL**
```
combined = 0.65 × SSIM + 0.35 × histogramIntersection
PASS if combined ≥ PASS_THRESHOLD (default 0.60, env-overridable)
```
Both images decoded via jimp, resized 256×256, converted to greyscale.
SSIM: global single-window (mean, variance, covariance).
Histogram: 64-bin intersection normalised by pixel count.

**DeviceOrientationEngine**
Must be started inside a user-gesture handler on iOS 13+.
Fixed in Phase 1: NOW started for BOTH Author AND Operator mode (button click handlers).
Without this, camera quaternion is identity → tag position reconstruction is wrong.

---

## File Reference

### `shared/src/index.ts`
All canonical types. Key additions:
- `QRAnchorContext` now has `scanQuaternion?: Quaternion` (set by main.ts after QR scan)

### `ar-client/src/main.ts`
- Bootstraps camera, renderer, DeviceOrientationEngine
- Role selection: BOTH Author and Operator buttons now request orientation permission
- After QR scan, captures `renderer.camera.quaternion` → `qrContext.scanQuaternion`

### `ar-client/src/modes/author-mode.ts`
- Placement reticle → `waitForPlaceTag()` → anchor creation (uses QR anchorId as SIB id)
- After placement: computes `relQ = qrScanQ.invert().multiply(tagPlacementQ)`
- Stores in tag metadata: `{ qrRelativeRotation, tagDistance, sessionId, authorId }`
- Honeycomb sphere → 8-viewpoint capture → `submitPassState()`

### `ar-client/src/modes/operator-mode.ts`
- Loads ALL tags for anchor, sorts newest-first
- Reconstructs tag world position: `(0,0,-1).applyQuaternion(opScanQ × relQ) × dist`
- Shows SpatialGuide (QR origin → all tags), TagMarker, TagDirectionArrow
- Capture → POST /perception/validate → PASS/FAIL with real confidence %

### `ar-client/src/visualizations/`
- `honeycomb-sphere.ts` — 8 Fibonacci nodes, billboard rings, dwell progress
- `placement-reticle.ts` — green ring + laser line for tag placement
- `tag-marker.ts` — sticky note in 3D, set-once orientation, bob animation
- `spatial-guide.ts` — dashed gold lines from QR origin to each tag

### `ar-client/src/ui/tag-direction-arrow.ts`
- CSS gold SVG triangle, screen-edge clamped, angle-computed from tag screen position

### `sib/src/perception/image-comparator.ts`
- `compareAgainstPassState(referenceBase64s[], liveBase64)` — returns score + status
- jimp@0.22 for image decode/resize/greyscale; pure JS, no native dependencies

### `sib/src/stores/json-file-store.ts`
- Extends InMemoryStore, persists to `.sib-data/{storeName}.json`
- Used by: anchors, tags, sessions, pass-states stores

### `sib/src/routes/training.ts`
- POST /perception/train — stores multi-viewpoint pass state
- POST /perception/validate — real SSIM+histogram comparison (no longer stubbed)
- GET /perception/pass-state/:tagId — loads pass state for Operator mode

---

## Phase 2 — Planned

### Goal: True Positional Tracking + Fleet Management

| Feature | Approach |
|---------|----------|
| Surface anchoring | ARKit (iOS) / ARCore (Android) via WebXR with hit-test API |
| Persistent anchors | Cloud Anchors (ARCore) or ARKit World Map serialisation |
| Multi-device sync | Real-time pass state sync via WebSocket or SSE |
| Fleet management | Multiple assets, multiple anchors, audit dashboard |
| Cloud storage | Replace JsonFileStore with PostgreSQL + S3 for images |
| Improved AI | Feature-based matching (ORB/SIFT) or embedding distance |
| Native app option | React Native + ViroReact or Unity AR Foundation |

### Phase 2 Entry Criteria
1. jimp installed (`cd sib && npm install`)
2. mkcert cert trusted on test device
3. Author + Operator cycle validated with real asset (not laptop screen)
4. PASS_THRESHOLD tuned per asset type

---

## Known Limitations (Phase 1)

1. **No positional tracking** — camera stays at world origin; tags appear to "follow" as you move
2. **Single device session** — no real-time sync between Author and Operator devices
3. **Relative position accuracy** — depends on how similarly Author and Operator hold phone at QR
4. **jimp requires `npm install`** — not auto-installed in sandbox; run manually in `/sib`
5. **iOS 16+ pinch-zoom** — `user-scalable=no` ignored; fixed via `gesturestart` prevention
6. **DeviceOrientationEvent** — not available on desktop; app works but orientation is identity

---

## QR Code Format

QR codes must encode JSON matching `QRAnchorContext`:
```json
{ "assetId": "asset-001", "anchorId": "anchor-unique-id" }
```
Use qr.io or similar to generate. Same QR for same physical anchor across sessions.

---

## Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| `VITE_USER_ID` | `user-001` | Author/Operator user identity |
| `VITE_ASSET_ID` | `asset-001` | Fallback asset ID |
| `PASS_THRESHOLD` | `0.60` | SSIM+histogram combined threshold for PASS |

---

## Resuming Phase 2

When you start Phase 2, read this file first, then:
1. Check `.sib-data/*.json` for any persisted tags from Phase 1 testing
2. Start with WebXR hit-test API for surface detection (replaces PlacementReticle estimation)
3. Add Cloud Anchors for persistent cross-session spatial memory
4. Swap JsonFileStore → database for production readiness
