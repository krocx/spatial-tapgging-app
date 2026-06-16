# Phase History

Detailed build history of the project, phase by phase. For the current state and setup instructions, see the [README](../README.md).

---

## Phase 1 — Web AR Client ✓ Complete

A browser-based AR inspection tool that ran in iPhone Safari with no app install required.

**How it worked:** QR codes encoded `{ assetId, anchorId }`. The AR client used `DeviceOrientationEvent` for camera rotation tracking. Authors placed tags and captured 8 reference viewpoints via a honeycomb sphere UI. Operators scanned the same QR, reconstructed tag positions from stored relative quaternions, and validated via SSIM + histogram comparison on the SIB backend.

**Key limitation:** No positional tracking — camera stayed at world origin, so tags appeared to drift as the user moved. This motivated the Phase 2 native app.

**Tech stack:** Vite · Three.js · AR.js · WebXR-free · jimp (SSIM) · JsonFileStore

---

## Phase 2 — Native iOS App ✓ Complete

Replaced the web client with a native Swift app backed by ARKit for real positional tracking.

**Sub-phases shipped:**

| Sub-phase | Deliverables |
|---|---|
| **2A** | SwiftUI app skeleton, ARSessionManager, QR scanning, Author/Operator mode split |
| **2B** | Tag management (create/delete/edit), 3D honeycomb AR guide (7 viewpoints), proximity auto-capture |
| **2C** | Operator mode: AR tag markers, single-shot validate-all, ValidationResultsView |
| **2D** | SIB batch validation endpoint, AnchorValidationResult schema |
| **2E** | Re-inspect failed tags, PASS threshold slider, persistent last-session resume, inspection session logger |

**Key architecture decisions:**
- ARKit image tracking on QR codes for reliable real-world anchor locking
- Tags are placed in 3D space relative to the anchor; positions stored in tag metadata (`pos_x`, `pos_y`, `pos_z`)
- 7-viewpoint honeycomb capture: Author physically walks to 7 AR guide spheres placed around the tag; proximity auto-triggers each capture
- SIB runs on a Mac on the local LAN; iOS app connects over WiFi

---

## Phase 2.5 — Security + Cloud Readiness ✓ Complete

Hardened the system for shared team use and cloud deployment.

| Feature | Detail |
|---|---|
| **Client-side encryption** | AES-256-GCM (CryptoKit) — images encrypted on iOS before upload; server stores only ciphertext |
| **Keychain key storage** | Encryption key stored in iOS Keychain per anchor; never in UserDefaults or code |
| **QR key distribution** | Author embeds base64 encryption key in the QR code; Operator devices receive it on scan |
| **In-memory decryption** | SIB decrypts images in-memory during validation only; plaintext never re-persisted |
| **API key auth** | All SIB routes protected by `X-API-Key` header; configurable via `SIB_API_KEY` env var |
| **HTTPS enforced** | `NSAllowsArbitraryLoads` removed from iOS app; ATS permits LAN-only HTTP for local dev |
| **Render deployment** | Dockerfile (multi-stage TypeScript build) + persistent disk for data |
| **G1 — Readiness gate** | `GET /anchors/:id/readiness` — Operator mode warns/blocks if tags haven't been trained yet |
| **G3 — Error UX** | Specific messages for 401 (bad API key) vs network failure vs server error |
| **G4 — Unpositioned tags** | Author tag list flags tags missing 3D position data with an orange indicator |
| **G6 — Session ID visible** | Active session ID shown in Operator mode top bar for audit traceability |
| **G7 — In-app QR generator** | Author generates and shares the anchor QR code from within the app |

---

## Phase 3 — AR Stability & QR Consistency ✓ Complete

Resolved two field-reported issues: QR codes visually mismatching between the iOS app and the portal, and inspection tags spawning at different world positions when scanned from different viewpoints.

### Problem 1: QR visual mismatch (iOS vs portal)

**Root cause:** The iOS app used CoreImage `CIQRCodeGenerator` while the portal used the `qrcodejs` library. The QR specification defines 8 mask patterns; each encoder independently scores all 8 and picks the one with the lowest penalty — they don't have to agree. The encoded data was always identical and scannable, but the pixel patterns looked different, causing operator confusion.

**Fix — canonical server-side QR image:**

| Component | Change |
|---|---|
| **SIB** | `POST /anchors` now calls `generateAndStoreQRImage()` immediately after anchor creation. Uses the `qrcode` npm package (ECC level M, 512×512 px, fixed mask). PNG stored at `.sib-data/qrimages/<anchorId>.png` |
| **Portal** | Removed `qrcodejs` CDN dependency. `loadQRImage()` fetches the PNG from `GET /anchors/:id/qrimage`, displays it via a Blob URL (`URL.createObjectURL`) |
| **iOS app** | `QRGeneratorView.generateQR()` tries `GET /anchors/:id/qrimage` first; falls back to local `CIQRCodeGenerator` only if SIB is unreachable |

Both clients now display the pixel-identical PNG. The local fallback remains for offline use but is clearly noted as potentially visually different from the server image.

### Problem 2: Tags spawning at different positions per scan

**Root cause:** `ARCoordinateFrame.normalised()` corrected the rotation component of the QR world transform (gravity-aligning it) but did nothing about the translation component. ARKit's monocular PnP solver estimates the QR centre position with ±5–15 mm of noise depending on scan angle and distance. Each new session produced a slightly different origin, so every tag was displaced by the same random translation offset. Task #81's session-continuity work (`OwnSCNViewContainer`, `AppState.activeARSession`) preserved the world frame across view transitions but didn't eliminate the per-session PnP noise.

**Fix — ARWorldMap persistence:**

ARKit exposes `getCurrentWorldMap()` which serialises the current feature-point cloud (`ARWorldMap`, an `NSSecureCoding`-compliant object). When passed back as `config.initialWorldMap`, ARKit relocalises the new session into the same coordinate frame instead of building a fresh one. Once tracking reaches `.normal` state after relocalisation, any detected QR anchor fires an `ARImageAnchor` at the _original_ world position — making tag placement viewpoint-independent.

| Component | Change |
|---|---|
| **SIB** | New binary-body route `POST /anchors/:id/worldmap` (uses `express.raw`, 50 MB limit) stores `<anchorId>.worldmap`; `GET /anchors/:id/worldmap` serves it back. Returns 404 (not an error) if no map stored yet |
| **ARSessionManager** | `startSessionWithWorldMap(_ data: Data)` — deserialises via `NSKeyedUnarchiver`, runs `session.run(config, options: .removeExistingAnchors)` **without** `.resetTracking`. Sets `isRelocalizing = true`; clears flag when tracking state reaches `.normal`. 15-second timeout fallback to fresh session |
| **ARSessionManager** | `saveCurrentWorldMap() async -> Data?` — wraps `getCurrentWorldMap()` callback in `withCheckedContinuation`; serialises with `NSKeyedArchiver` |
| **QRScanGateView** | `.onAppear` downloads world map before starting (falls back to fresh session on 404 or offline). `lockSession()` uploads world map in background after QR lock (fire-and-forget, non-fatal on failure) |
| **QRScanGateView** | Relocating status shown via orange `arrow.triangle.2.circlepath` indicator when `arManager.isRelocalizing == true` |
| **SIBClient** | `uploadWorldMap(anchorId:data:)` — sends `Content-Type: application/octet-stream`. `fetchWorldMap(anchorId:) -> Data?` — returns `nil` on 404 (no throw), throws on other errors |

**First-session behaviour:** No world map exists yet. Session starts fresh. After QR lock, the world map is uploaded to SIB. On all subsequent sessions, the existing map is downloaded and the session starts in relocalisation mode.

---

## Phase 4 — Distribution Prep (in progress)

Preparing the app for internal team testing and feedback.

| Issue | Fix |
|---|---|
| **"Payload too large" on training uploads** | Server's global `express.json` body limit raised from `10mb` to `30mb` in `sib/src/app.ts`. A full 14–19 image training sweep (800px JPEGs at quality 0.65, base64-encoded, then AES-256-GCM encrypted and base64-encoded again) can run several MB; 10mb was tripping the limit even at the minimum capture count on noisier frames. |
| **Training sphere placement (Author capture UX)** | `ConeCaptureView.swift` locked the training sphere distance using `d = dist + offset`, but the sphere axis points from the tag *toward* the camera — so the offset pushed the sphere cluster behind the Author instead of in front. Fixed by subtracting the offset instead (`d = max(kMinDist, rawDist - offset)`), floored at a minimum distance so the sphere never collapses onto the tag. |
| **Repo distribution readiness** | See the [README](../README.md#cloning--setup) and [iOS Setup Guide](IOS-SETUP.md) for the current clone/build path. |

Deferred to a future session: deeper training-reliability issues (occasional validation fails despite capturing the same trained area) and further payload-size optimization on the client side.
