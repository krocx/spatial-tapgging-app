# SIB Server Reference

Technical reference for the Spatial Intelligence Backend (SIB) — environment variables, endpoints, and data layout. For deployment steps, see [RENDER-DEPLOYMENT.md](RENDER-DEPLOYMENT.md). For running it locally, see the [README](../README.md#running-the-sib-server-locally).

---

## Environment Variables

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
| `POST` | `/perception/train` | Upload pass-state images for a tag (AES-256-GCM ciphertext, 30 MB body limit) |
| `POST` | `/perception/validate-all` | Validate all tags in one shot (Operator flow) |
| `GET` | `/sessions` | List inspection sessions |

All routes except `/health` require the `X-API-Key` header when `SIB_API_KEY` is set.

---

## SIB Data Directories

The server creates three sub-directories inside `SIB_DATA_DIR` (default `.sib-data/`):

| Directory | Contents |
|---|---|
| `anchors/` | Anchor and tag JSON (JsonFileStore) |
| `qrimages/` | Canonical QR PNGs — `<anchorId>.png` |
| `worldmaps/` | Serialised ARWorldMap binaries — `<anchorId>.worldmap` |

---

## iOS App Key Components (for reference when working on the client)

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
