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
- **SIB Server URL:** `https://your-server.onrender.com` (or `http://your-mac-ip:3001` for local)
- **API Key:** your `SIB_API_KEY` value
- Tap **Save** → **Test Connection** — you should see a green "Connected" banner

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

## Generating a QR Code (Author Workflow)

1. Open the app → tap **Author Mode**
2. Scan an existing anchor QR, or point the camera at a new QR code you want to register as an anchor
3. Once the anchor is loaded, tap the **QR code icon** in the top bar
4. The app generates a QR with the anchor ID, asset ID, and embedded encryption key
5. Share or print it — this is the QR Operators will scan

> The QR code is the only place the encryption key leaves the Author's device. Treat it like a physical key to the anchor.

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
| `POST` | `/anchors` | Create anchor |
| `GET` | `/anchors/:id/readiness` | Check if all tags for an anchor have been trained |
| `GET` | `/tags?anchorId=` | List tags for an anchor |
| `POST` | `/tags` | Create tag |
| `POST` | `/perception/train` | Upload 7-viewpoint pass-state images for a tag |
| `POST` | `/perception/validate-all` | Validate all tags in one shot (Operator flow) |
| `GET` | `/sessions` | List inspection sessions |

All routes except `/health` require `X-API-Key` header when `SIB_API_KEY` is set.

---

## Cowork Guidelines (for Claude Sessions)

When starting a new Cowork session on this project:

1. Read this `README.md` for project context and phase history
2. Read `STATUS.md` for the current task list and what's in progress
3. Read the relevant docs in `/docs/` for the area you're working on
4. Read `/skills/cowork-guidelines.md` for coding standards
5. Keep the iOS app and SIB in sync — shared types live in `shared/src/index.ts`
6. Never send plaintext images from SIB to the client; decryption is in-memory only
7. All new SIB routes must be added after the `apiKeyAuth` middleware in `app.ts`

---

## Ownership

Vision & architecture: Karthik
Implementation: Karthik + Claude Cowork
