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

## Cloning & Setup

```bash
git clone https://bitbucket.org/<your-workspace>/spatial-tagging-app.git
cd spatial-tagging-app
```

This is a monorepo — the iOS app, the server, and shared types all live in one clone. There's nothing else to fetch separately.

| If you want to... | Go to |
|---|---|
| Build and run the iOS app on your iPhone | **[docs/IOS-SETUP.md](docs/IOS-SETUP.md)** |
| Walk through every screen, or see the clickable wireframe | **[docs/APP-FLOW.md](docs/APP-FLOW.md)** / **[docs/APP-WIREFRAME.html](docs/APP-WIREFRAME.html)** |
| Run the SIB server locally for development | [Running the SIB server locally](#running-the-sib-server-locally) below |
| Deploy the SIB server for the team (Render) | **[docs/RENDER-DEPLOYMENT.md](docs/RENDER-DEPLOYMENT.md)** |
| Look up server env vars / endpoints | **[docs/SERVER-REFERENCE.md](docs/SERVER-REFERENCE.md)** |
| Read how we got here, phase by phase | **[docs/PHASE-HISTORY.md](docs/PHASE-HISTORY.md)** |
| See the whole app's features, including how the AR components work | **[docs/APP-FEATURES.md](docs/APP-FEATURES.md)** |
| See what SIB Training can do today vs. what's still planned | **[docs/SIB-TRAINING-FEATURES.md](docs/SIB-TRAINING-FEATURES.md)** |
| Understand why we're on Render, and how it stacks up against a local/in-house server | **[docs/WHY-RENDER.md](docs/WHY-RENDER.md)** |
| Move the SIB server off Render to an in-house server | **[docs/RENDER-TO-INHOUSE-MIGRATION.md](docs/RENDER-TO-INHOUSE-MIGRATION.md)** |

---

## Running the SIB Server Locally

```bash
cd sib && npm install
npm run dev
# Server runs at http://localhost:3001

# Find your Mac's LAN IP so an iPhone on the same WiFi can reach it
ipconfig getifaddr en0
# Use http://<that-ip>:3001 as the SIB URL in the iOS app's Settings screen
```

The server persists data to `.sib-data/` in the `sib/` folder (git-ignored). For team use, the server should instead be deployed to Render — see [docs/RENDER-DEPLOYMENT.md](docs/RENDER-DEPLOYMENT.md) — so every team member points their app at the same shared, always-on URL instead of a teammate's laptop.

---

## Ownership

Vision, Architecture & Code: Karthik
