# Spatial Tagging App

A native iOS AR platform for industrial workflows, powered by the **Spatial Intelligence Backend (SIB)**. Authors train inspection checkpoints once; Operators run repeatable PASS/FAIL inspections against them anywhere, on any team device. Around that core, the platform now also covers Gemba audit walks, AR work instructions, 3D model overlays, a browser portal, and a collaborative roadmap tool — all self-hosted, no cloud dependencies.

---

## What It Does

Two roles work in sequence on the same physical asset:

- **Author** — An expert places inspection tags at key points on an asset, captures reference images from multiple angles, and generates a QR code that encodes the anchor + encryption key.
- **Operator** — Any team member scans the QR code, points the phone at the asset, and gets per-tag PASS/FAIL results — no training required.

All reference images are encrypted on-device (AES-256-GCM) before upload. The server never stores plaintext images.

---

## Platform Capabilities

### Spatial inspection (the core)
QR-anchored 6-DOF tracking, multi-tag anchors with a typed check ontology (presence / language / routing / configuration / part checks), in-app pass-state training (multi-angle honeycomb capture, ROI regions, depth metadata), SSIM-based PASS/FAIL validation with confidence scores, and batch validation — one scan returns results for every tag on the anchor. **Tag Groups** organize tags into named inspection sets that can be validated as a unit.

### Gemba Walk (Loc-Tags)
Audit-walk mode with no QR required: the Author taps any surface to drop a **LocTag** (defect category, reference photo, notes); an ARWorldMap is saved so Operators re-localize in the same space later. Completions are tracked per finding — *resolved / still present / escalated* — with completion photos, giving a full audit trail for 6S/Gemba rounds.

### AR Work Instructions (AR OMS)
Step-based guided procedures anchored in space. Authors create **Guides** (draft → published) with sequenced steps, per-step images, optional voice scripts, and a 3D ghost model overlay; each step is spatially placed as a pin in AR so Operators are physically walked to the right location. Operators run the guide step-by-step, capture evidence photos per step, and sign off; **guide sessions** record per-step completions, durations, and evidence.

Beyond linear procedures, the module now covers:

- **Conditional task graph** — steps can branch on outcome (`nextOnSuccess` / `nextOnFailure`) and gate on prerequisites (`precondition`), so a failed check can route to a recovery step and rejoin the main path.
- **Instruction import** — `POST /guides/import` behind an adapter interface. A manual JSON adapter ships today (importable from the portal); an MES adapter is stubbed for production integration. Referenced images are downloaded and stored at import time, and graph links expressed as sequence numbers are resolved to step IDs server-side.
- **Live session telemetry** — an SSE stream (`/guide-sessions/live/:id/stream`) publishes `session:started`, `step:entered`, `step:completed`, `step:retried`, `step:stalled`, and `session:submitted` events while a walk is in progress, giving observers and AI agents visibility *during* the job rather than only at sign-off.
- **AI-assisted guidance** — an `AIGuideAdapter` extension point decides when to intervene and generates a contextual hint, delivered to the device via a consume-once hint queue. A self-contained stub adapter ships by default (no LLM, no cloud); a real model can be registered without touching surrounding infrastructure. Triggers on repeated retries or on a dwell-based stall (90 s on a step with no completion).

### 3D Model Library
A shared 3D asset library with per-anchor "kits": models can be assigned to specific anchors or marked `general` to be visible everywhere, with an Author-saved default scale. GLB/USDZ upload is pass-through; OBJ/FBX/STEP are converted asynchronously to GLB via headless Blender when it is available on the host. GLB→USDZ conversion runs **in the portal browser** (Three.js `USDZExporter`) and uploads the result back, so no native toolchain is required on the server. Models render on device as ghost overlays with per-step scale, opacity, offset, and Y-rotation, positioned in AR by the Author.

### Anchor Portal (`/portal`)
Browser-based team console served by SIB, with tabs for Anchors, Sessions, Gemba Walks, AR Guides, **Guide Library**, and 3D Models. Covers anchor directory and QR generation with print-exact sizing (A4 page at true physical dimensions), CSV export, and data administration — per-row and delete-all operations for anchors (cascading tags, pass-states, and blobs), sessions, AR Guides, and Gemba Walk data. Auto-detects whether the server requires an API key.

The **Guide Library** tab adds guide lifecycle management outside the app: browse guides per anchor, publish/unpublish, delete, inspect step lists with placement status, import a guide from JSON, and open a **⬡ Graph** view that renders the conditional task graph — success, failure, precondition, and sequential edges, with each failure branch laid out on its own lane and retry loops drawn as back-arcs.

### Roadmap Mind-Mapper (`/roadmap`)
A secure, collaborative mind-mapping and roadmapping tool hosted on SIB — built for roadmap design, SIB ontology graphs, and AR workflow planning. Highlights: real-time collaboration (WebSockets, live cursors, presence), swimlanes (Now/Next/Later columns, Why/What/How rows), node status + review verdicts + comments, milestones, icons/shapes/links, collapsible branches, presentation mode, view filters and custom groups, version history with restore, PNG/SVG/JSON export, cross-server JSON import, a draft→publish workflow (per-map draft keys, pre-RBAC), SIB ontology import/export, and **image import** — photograph a whiteboard and a local vision model (Ollama) turns it into an editable roadmap draft. Full docs: [docs/roadmap-mindmapper.md](docs/roadmap-mindmapper.md). The platform's own roadmap lives in it: [docs/roadmaps/](docs/roadmaps/).

---

## Project Structure

```
spatial-tagging-app/
├── ios-app/          Native iOS app (Swift + ARKit + SwiftUI)
│   └── SpatialTaggingApp/
├── sib/              Spatial Intelligence Backend (Node.js + TypeScript)
│   ├── src/          Routes, controllers, models, WS, adapters (perception, SIB↔mindmap, vision)
│   ├── portal/       Anchor Portal — static browser console served at /portal
│   ├── roadmap/      Roadmap Mind-Mapper — prebuilt bundle served at /roadmap
│   ├── roadmap-client/  Roadmap frontend source (React + TS + Vite + Zustand)
│   └── Dockerfile
├── shared/           Shared TypeScript types (@spatial/shared)
├── ar-client/        Phase 1 web AR client (archived — superseded by iOS app)
├── docs/             Architecture docs and deployment guides
│   └── roadmaps/     Importable roadmap JSON (e.g. the AR platform roadmap)
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
| Deploy on the internal company server (Windows + NSSM) | **[docs/INTERNAL-SERVER-DEPLOY.md](docs/INTERNAL-SERVER-DEPLOY.md)** |
| Use or extend the Roadmap Mind-Mapper (architecture, API, deployment) | **[docs/roadmap-mindmapper.md](docs/roadmap-mindmapper.md)** |
| Look up server env vars / endpoints | **[docs/SERVER-REFERENCE.md](docs/SERVER-REFERENCE.md)** |
| Read how we got here, phase by phase | **[docs/PHASE-HISTORY.md](docs/PHASE-HISTORY.md)** |
| See the whole app's features, including how the AR components work | **[docs/APP-FEATURES.md](docs/APP-FEATURES.md)** |
| See what SIB Training can do today vs. what's still planned | **[docs/SIB-TRAINING-FEATURES.md](docs/SIB-TRAINING-FEATURES.md)** |
| Understand why we're on Render, and how it stacks up against a local/in-house server | **[docs/WHY-RENDER.md](docs/WHY-RENDER.md)** |
| Move the SIB server off Render to an in-house server | **[docs/RENDER-TO-INHOUSE-MIGRATION.md](docs/RENDER-TO-INHOUSE-MIGRATION.md)** |

---

## Running the SIB Server Locally

```bash
npm install            # repo root — installs all workspaces
npm run dev:sib
# Server runs at http://localhost:3001
#   Anchor Portal:        http://localhost:3001/portal
#   Roadmap Mind-Mapper:  http://localhost:3001/roadmap

# Find your Mac's LAN IP so an iPhone on the same WiFi can reach it
ipconfig getifaddr en0
# Use http://<that-ip>:3001 as the SIB URL in the iOS app's Settings screen
```

Other useful scripts (repo root): `npm run test:sib` (backend unit tests), `npm run dev:roadmap` (roadmap frontend with hot reload), `npm run build:roadmap` (rebuild the `/roadmap` bundle after client changes — the compiled bundle is committed, so servers need no frontend build step).

Optional — whiteboard image import in the Roadmap tool needs a local vision model on the SIB host: install [Ollama](https://ollama.com), then `ollama pull qwen2.5vl`. No SIB config required (defaults to `localhost:11434`); images never leave the machine.

The server persists data to `.sib-data/` in the `sib/` folder (git-ignored). For team use, the server should instead be deployed to Render — see [docs/RENDER-DEPLOYMENT.md](docs/RENDER-DEPLOYMENT.md) — or the internal company server — see [docs/INTERNAL-SERVER-DEPLOY.md](docs/INTERNAL-SERVER-DEPLOY.md) — so every team member points at the same shared, always-on URL instead of a teammate's laptop.

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

### 7. Beyond inspections

Once the core flow checks out, walk the rest of the platform:

- **Gemba Walk** — start an audit walk, tap-place a LocTag with a defect category and photo, then re-open the walk on a second device and confirm it re-localizes from the saved ARWorldMap; mark the finding resolved with a completion photo.
- **AR Guides** — author a two-step guide with images, place both steps in AR, publish it, and run it in Operator mode; confirm the guide session records each step completion and any evidence photos.
- **Branching & AI hints** — import a guide with failure branches (see the Guide Library tab → ⬆ Import Guide), open ⬡ Graph and confirm branches render on separate lanes. Then run it and stand on one step for ~95 seconds without completing it: a stall event fires and the AI hint banner should appear.
- **Portal** — open `/portal`, print a QR at exact physical size, and try a per-row delete to confirm cascades behave.
- **Roadmap** — open `/roadmap`, import `docs/roadmaps/do-or-do-not.roadmap.json`, toggle the *Shipped ✓* filter, and press ▶ Present. Then photograph a whiteboard sketch and try **From image 📷** (needs Ollama running — see above).

---

## Ownership

Vision, Architecture & Code: Karthik
