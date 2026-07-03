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

## Expected Behaviour — What to Know Before Your First Trial

### Inspection speed

Under normal conditions, each inspection takes **1–3 seconds** from the moment you tap Inspect to seeing the PASS/FAIL result on screen. This is the benchmark to hold in your head when evaluating the app.

There are two specific situations where a first inspection takes noticeably longer. Both are one-time costs — every inspection after the first is fast.

**1. After a fresh server deployment**

When the server restarts (e.g. after a code update is pushed to Render), it runs a brief self-warm-up in the background. From that point, the very first person to trigger an inspection on any tag may see a slightly longer result — typically under 5 seconds, not the 1–3 second norm. After that single inspection, the server is fully warmed and all subsequent inspections across all tags are back to 1–3 seconds.

*What this means in practice:* Before sharing the app with a new group of testers after a deployment, do one inspection yourself on any tag to absorb the warm-up cost. Your team will then see consistent speeds.

**2. After an Author trains a brand-new tag**

When a new tag is trained for the first time, the server has to process its reference images before it can run comparisons. Because the images are stored in encrypted form, this processing can only happen when an Operator triggers the first inspection — not during training. That first inspection may take up to **20–25 seconds**. Every inspection after that is back to 1–3 seconds.

*What this means in practice:* The Author (or someone acting as a "seed" tester) should always run one inspection on a newly-trained tag before the tag is handed over to the wider team. This is a one-time action per tag, per training session. If a tag is re-trained, the first inspection of the re-trained version will again be slow.

### Summary table

| Situation | First inspection | All subsequent |
|---|---|---|
| After a server deployment | ~3–5 s (slightly longer) | 1–3 s |
| Brand-new tag (just trained) | Up to ~25 s (one time only) | 1–3 s |
| Normal operation | 1–3 s | 1–3 s |

---

## How to Review the App Thoroughly

This is a suggested walk-through for anyone assessing the app for the first time. Go through it in order — each section builds on the one before.

### 1. Author flow — training a new tag

- Open the app and navigate to Author mode.
- Select (or create) an anchor on a physical asset.
- Place a new tag at a specific inspection point — something with a visible, repeatable state, like a switch, valve, cable, or indicator light.
- Complete the honeycomb capture (the multi-angle photo sequence). Aim to hold the phone steady and capture from the angles the app prompts.
- If the app offers an ROI (region of interest) step — a box you draw around the specific feature — use it. This meaningfully improves inspection accuracy by telling the server exactly where to look.
- Generate the QR code for this anchor and note it.

*What to check:* the training flow feels smooth, the QR generates without errors, and the app confirms the tag has been saved.

### 2. Seed inspection — absorbing the first-time cost

- Switch to Operator mode on the same device (or a second device that has scanned the QR).
- Run one inspection on the newly-trained tag. **Expect up to 25 seconds for this first result.** This is normal — see the explanation above.
- Confirm you get a PASS result (since the asset is in the trained reference state).

*What to check:* the result arrives (even if slow), and it correctly shows PASS.

### 3. Operator flow — normal inspection speed

- Run three or four more inspections in quick succession on the same tag.
- Each should complete in 1–3 seconds.
- Physically change the state of the inspected feature (remove a cable, flip a switch, cover a valve) and run another inspection — expect a FAIL result.
- Restore the correct state and inspect again — expect PASS.

*What to check:* PASS/FAIL results are accurate, response times are consistent, and the confidence score (shown alongside the result) is meaningfully different between a real PASS and a real FAIL.

### 4. Multi-tag anchor

- Train a second tag on the same anchor, pointing at a different feature.
- Run a validate-all inspection (which checks all tags on the anchor from a single image).
- Confirm both tags return independent results.
- Deliberately leave one feature in the wrong state and confirm only that tag shows FAIL while the other remains PASS.

*What to check:* the multi-tag result is accurate per-tag, not a single blanket result.

### 5. Lighting and angle tolerance

- Inspect the same PASS tag under different lighting (bright, dim, a different room if possible).
- Inspect from slightly different angles and distances compared to where the reference was trained.
- The result should still be PASS, with confidence staying comfortably above 60 %.

*What to check:* if a PASS tag consistently FAILs under reasonable real-world variation, the ROI may need to be redrawn more tightly, or the tag may need more reference images.

### 6. Confidence score as a health check

Each inspection reports a confidence score (0–100 %). Use this as a signal, not just the binary result:

- A PASS at 85 %+ is a strong, reliable match.
- A PASS at 60–70 % is valid but borderline — consider re-training with better lighting or more varied angles.
- A FAIL at under 30 % is a clear mismatch.
- A FAIL at 50–59 % is close to the threshold — the trained reference may be ambiguous, or the live shot may have had a large angle/lighting shift.

---

## Ownership

Vision, Architecture & Code: Karthik
