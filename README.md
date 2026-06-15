# Spatial Tagging App

A native iOS AR inspection platform for industrial workflows. Authors train inspection checkpoints once; Operators run repeatable PASS/FAIL inspections against them anywhere, on any team device.

---

## What It Does

Two roles work in sequence on the same physical asset:

- **Author** — An expert places inspection tags at key points on an asset, captures reference images from multiple angles, and generates a QR code that encodes the anchor + encryption key.
- **Operator** — Any team member scans the QR code, points the phone at the asset, and gets per-tag PASS/FAIL results — no training required.

All reference images are encrypted on-device (AES-256-GCM) before upload. The server never stores plaintext images.

---

## Project Structure

```
spatial-tagging-app/
├── ios-app/          Native iOS app (Swift + ARKit + SwiftUI)
│   └── SpatialTaggingApp/
├── sib/              Spatial Intelligence Backend (Node.js + TypeScript)
│   ├── src/
│   └── Dockerfile
├── shared/           Shared TypeScript types (@spatial/shared)
├── ar-client/        Phase 1 web AR client (archived — superseded by iOS app)
├── docs/             Architecture docs and deployment guides
└── skills/           Claude Cowork guidelines and coding standards
```

---

## Phase History

### Phase 1 — Web AR Client ✓ Complete

A browser-based AR inspection tool that ran in iPhone Safari with no app install required.

**How it worked:** QR codes encoded `{ assetId, anchorId }`. The AR client used `DeviceOrientationEvent` for camera rotation tracking. Authors placed tags and captured 8 reference viewpoints via a honeycomb sphere UI. Operators scanned the same QR, reconstructed tag positions from stored relative quaternions, and validated via SSIM + histogram comparison on the SIB backend.

**Key limitation:** No positional tracking — camera stayed at world origin, so tags appeared to drift as the user moved. This motivated the Phase 2 native app.

**Tech stack:** Vite · Three.js · AR.js · WebXR-free · jimp (SSIM) · JsonFileStore

---

### Phase 2 — Native iOS App ✓ Complete

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

### Phase 2.5 — Security + Cloud Readiness ✓ Complete

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

### Phase 3 — AR Stability & QR Consistency ✓ Complete

Resolved two field-reported issues: QR codes visually mismatching between the iOS app and the portal, and inspection tags spawning at different world positions when scanned from different viewpoints.

#### Problem 1: QR visual mismatch (iOS vs portal)

**Root cause:** The iOS app used CoreImage `CIQRCodeGenerator` while the portal used the `qrcodejs` library. The QR specification defines 8 mask patterns; each encoder independently scores all 8 and picks the one with the lowest penalty — they don't have to agree. The encoded data was always identical and scannable, but the pixel patterns looked different, causing operator confusion.

**Fix — canonical server-side QR image:**

| Component | Change |
|---|---|
| **SIB** | `POST /anchors` now calls `generateAndStoreQRImage()` immediately after anchor creation. Uses the `qrcode` npm package (ECC level M, 512×512 px, fixed mask). PNG stored at `.sib-data/qrimages/<anchorId>.png` |
| **Portal** | Removed `qrcodejs` CDN dependency. `loadQRImage()` fetches the PNG from `GET /anchors/:id/qrimage`, displays it via a Blob URL (`URL.createObjectURL`) |
| **iOS app** | `QRGeneratorView.generateQR()` tries `GET /anchors/:id/qrimage` first; falls back to local `CIQRCodeGenerator` only if SIB is unreachable |

Both clients now display the pixel-identical PNG. The local fallback remains for offline use but is clearly noted as potentially visually different from the server image.

#### Problem 2: Tags spawning at different positions per scan

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

## Installing and Running the iOS App

### Prerequisites

- Mac running macOS 13+ with Xcode 15+
- iPhone with iOS 16+ (ARKit required; simulator won't work for AR features)
- Apple Developer account (free account works for personal device testing)
- SIB server running — either locally (see below) or on Render (see `docs/RENDER-DEPLOYMENT.md`)

### 1. Open the project in Xcode

```
ios-app/SpatialTaggingApp/SpatialTaggingApp.xcodeproj
```

### 2. Set your development team

In Xcode: select the `SpatialTaggingApp` target → **Signing & Capabilities** → set **Team** to your Apple ID.

### 3. Connect your iPhone and build

- Plug in your iPhone via USB
- Select your device in the Xcode toolbar
- Press **⌘R** (or the Run button)
- The first time: on your iPhone go to **Settings → General → VPN & Device Management** and trust the developer certificate

### 4. Configure the server URL

In the app, tap the **gear icon** (Settings):

| Field | Value |
|---|---|
| **SIB Server URL** | `https://sib-server-hiul.onrender.com` |
| **API Key** | `sk-sib-a8f3d2e1b4c7f9a0d3e6b2c5f8a1d4e7` |

Tap **Save** → **Test Connection** — you should see a green "Connected" banner.

> For local development, use `http://<your-mac-ip>:3001` as the URL and leave the API Key blank.

---

## Running the SIB Server Locally (Development)

```bash
# Install dependencies
cd sib && npm install

# Start in development mode (hot-reload, no API key required)
npm run dev
# Server runs at http://localhost:3001

# Find your Mac's LAN IP so the iPhone can reach it
ipconfig getifaddr en0
# Use http://<that-ip>:3001 as the SIB URL in the iOS app
```

The server persists data to `.sib-data/` in the `sib/` folder. This directory is git-ignored.

---

## Deploying to Render (Team Sharing)

Full step-by-step instructions are in **`docs/RENDER-DEPLOYMENT.md`**, including:
- Pushing the project to GitHub
- Creating the Render Web Service (Docker runtime)
- Setting environment variables and persistent disk
- Connecting the iOS app to the live server
- Future Bitbucket migration steps

---

## QR Code Workflow

### Generating the Anchor QR (Author)

The canonical QR image is generated once by the SIB at anchor creation and stored server-side. This ensures every client — iOS app, portal, any future client — displays the pixel-identical QR pattern.

1. Open the app → **Author Mode** → select or create an anchor
2. Tap the **QR code icon** in the top bar (`QRGeneratorView`)
3. The app fetches the PNG from `GET /anchors/:id/qrimage` — same pixel pattern as the portal
4. Tap **Share QR Code** to print or send it — this is the QR Operators will scan

> The QR payload `{ assetId, anchorId, encryptionKey }` embeds the AES-256-GCM key. Treat the printed QR like a physical key to the anchor.

### QR Scan Gate (both modes)

Both Author and Operator modes are entered through `QRScanGateView`, a mandatory full-screen AR camera gate:

1. On appear, the gate downloads any existing `ARWorldMap` from SIB and starts the session in **relocalisation mode** (orange spinner: "Relocalizing… look around the anchor area")
2. Once ARKit tracking reaches `.normal`, the gate shows the standard QR viewfinder
3. User points the camera at the printed anchor QR
4. On successful scan: encryption key extracted into `AppState`; gravity-aligned anchor transform stored; `ARSession` preserved in `AppState.activeARSession`
5. In background: current `ARWorldMap` serialised and uploaded to SIB for future sessions
6. Gate auto-advances to `AuthorModeView` or `OperatorModeView` (0.9 s visual feedback)

**Session continuity:** `QRScanGateView` uses `OwnSCNViewContainer` (no `dismantleUIView`) so the `ARSession` keeps running when the view is dismissed. Successor views call `arManager.linkToExistingSession()` instead of `startSession()`, preserving the locked world frame and all detected anchors.

---

## iOS App Navigation Flow

```
ContentView
└── AnchorDirectoryView          ← list of all anchors on SIB
    └── AnchorHubView            ← per-anchor detail + tag list
        └── QRScanGateView       ← mandatory AR QR gate (both modes)
            ├── AuthorModeView   ← place/train tags
            │   ├── HoneycombCaptureView  ← 7-viewpoint sphere training
            │   ├── ConeCaptureView       ← cone-pattern training
            │   └── OCRCaptureView        ← text/gauge training
            └── OperatorModeView ← validate tags, show PASS/FAIL
                └── ValidationResultsView
```

---

## Environment Variables (SIB Server)

| Variable | Default | Description |
|---|---|---|
| `SIB_API_KEY` | *(none)* | Required in production. All requests must include `X-API-Key: <value>`. Unset = no auth (local dev). |
| `SIB_DATA_DIR` | `.sib-data/` | Directory for persisted JSON data. Set to `/data/.sib-data` on Render. |
| `PORT` | `3001` | HTTP port the server listens on. |
| `NODE_ENV` | `development` | Set to `production` on Render. |
| `PASS_THRESHOLD` | `0.60` | SSIM+histogram combined threshold for PASS verdict. Range 0.40–0.90. |

---

## Key SIB Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — no auth required |
| `GET` | `/anchors` | List all anchors |
| `POST` | `/anchors` | Create anchor (also generates canonical QR PNG) |
| `DELETE` | `/anchors/:id` | Delete anchor, tags, QR image, and world map |
| `GET` | `/anchors/:id/readiness` | Check if all tags for an anchor have been trained |
| `GET` | `/anchors/:id/qrimage` | Serve canonical QR PNG (back-fills on-demand if missing) |
| `POST` | `/anchors/:id/qrimage` | Force-regenerate the canonical QR PNG |
| `GET` | `/anchors/:id/worldmap` | Download serialised `ARWorldMap` binary (404 if none stored) |
| `POST` | `/anchors/:id/worldmap` | Upload serialised `ARWorldMap` binary (`application/octet-stream`, 50 MB max) |
| `GET` | `/tags?anchorId=` | List tags for an anchor |
| `POST` | `/tags` | Create tag |
| `PATCH` | `/tags/:id` | Update tag |
| `DELETE` | `/tags/:id` | Delete tag |
| `POST` | `/perception/train` | Upload pass-state images for a tag (AES-256-GCM ciphertext) |
| `POST` | `/perception/validate-all` | Validate all tags in one shot (Operator flow) |
| `GET` | `/sessions` | List inspection sessions |

All routes except `/health` require `X-API-Key` header when `SIB_API_KEY` is set.

### SIB Data Directories

The server creates three sub-directories inside `SIB_DATA_DIR` (default `.sib-data/`):

| Directory | Contents |
|---|---|
| `anchors/` | Anchor and tag JSON (JsonFileStore) |
| `qrimages/` | Canonical QR PNGs — `<anchorId>.png` |
| `worldmaps/` | Serialised ARWorldMap binaries — `<anchorId>.worldmap` |


---

## iOS App Key Components

| File | Role |
|---|---|
| `Services/ARSessionManager.swift` | Owns the `ARSession`. `startSession()`, `startSessionWithWorldMap(_:)`, `saveCurrentWorldMap()`, `linkToExistingSession()` |
| `Services/SIBClient.swift` | All network calls: anchors, tags, perception, QR image, world map |
| `Services/AnchorEncryption.swift` | AES-256-GCM via CryptoKit; Keychain read/write |
| `Models/AppState.swift` | Shared state: `activeAnchor`, `activeTags`, `anchorNormalisedTransform`, `anchorEncryptionKey`, `activeARSession` |
| `Modes/QRScanGateView.swift` | Mandatory session gate: world map download, QR scan, world map upload |
| `Modes/AuthorModeView.swift` | Tag placement, training mode launcher, QR generator |
| `Modes/OperatorModeView.swift` | Tag rendering, validate-all, `ValidationResultsView` |
| `Modes/QRGeneratorView.swift` | Fetches canonical PNG from SIB; local fallback for offline use |
| `Services/ARCoordinateFrame.swift` | `normalised()` — gravity-aligns the QR world transform for consistent tag placement |

---

## Ownership

Vision, Architecture & Code: Karthik
