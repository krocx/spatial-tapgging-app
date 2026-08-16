# AR Platform Roadmap — Dictionary of Terms

*Companion to the platform roadmap ("Do. Or do not. There is no try." — [docs/roadmaps/](roadmaps/)). One shared language for leadership, IT, and the build team — because transformation compounds when people and processes evolve together, and shared language is where that starts.*

Each term below is a technical capability on the roadmap or a foundation it stands on. Definitions lead with what the capability lets us do; the technical detail follows. Status markers — **✅ shipped**, **🔄 in progress**, **▢ planned** — reflect the roadmap at the time of writing; the roadmap itself (in the Roadmap tool at `/roadmap`) is always the source of truth.

---

## Reading the Roadmap

- **Pillar** — one of the five capability areas the platform is built from: Authoring Suite, Operator Runtime, Perception & AI, Enterprise Platform, Integrations & Robotics. Every roadmap node belongs to exactly one pillar.
- **Now / Next / Later** — delivery lanes. *Now* is shipped or actively being built; *Next* is the coming two–three quarters; *Later* holds the platform bets that the Next items unlock.
- **Milestone** (gold diamond) — a node whose completion changes what the platform *is*, not just what it has. Example: the AR SDK Layer is a milestone because glasses and cobots become cheap to add once it exists.
- **Status vs. Review** — status tracks execution (planned / in-progress / done / blocked); review tracks agreement (approved ✓ / rejected ✗ / needs validation ?). A node can be in-progress *and* needs-validation — the two axes are independent on purpose.

---

## Platform Foundations

- **SIB — Spatial Intelligence Backend** ✅ — the platform's core: a self-hosted backend that unifies spatial context (where things are), semantic meaning (what they are), and perception (what the camera sees). Every client — iPhone today, glasses and cobots tomorrow — is a thin, replaceable front-end to SIB. No cloud dependency; data stays on our servers.
- **Author Mode** ✅ — the expert's side of the platform: place anchors and tags, capture reference images, build guides. Authoring is done once, by the person who knows the asset.
- **Operator Mode** ✅ — the technician's side: scan, follow, inspect. Designed to require zero training — the Author's knowledge arrives through the phone.
- **Anchor** ✅ — a fixed spatial origin on a physical asset (today established by scanning a printed QR code). Every tag, guide, and overlay is positioned relative to an anchor, which is what makes content repeatable across visits and devices.
- **Tag / Spatial Tagging** ✅ — an inspection checkpoint pinned in 3D space on an anchor, typed by what it checks (presence, language, routing, configuration, part). Tags are the atoms of the platform.
- **Pass State** ✅ — the trained reference for a tag: multi-angle images of the asset in its known-good condition, captured in-app by the Author. Inspections compare live camera frames against the pass state.
- **Ontology (SIB layers)** ✅ — the platform's shared classification: spatial (blue), perception (purple), semantic (green), reasoning (orange). Roadmap nodes, data schemas, and architecture diagrams all use the same four layers — one vocabulary from whiteboard to code.
- **Adapter** ✅ — SIB's pattern for anything external: perception models, vision SDKs, MES connectors, AI backends. Each is an isolated, swappable module behind a stable interface — no vendor ever gets hard-coded into the platform.

---

## Pillar 1 — Authoring Suite

- **AR Work Instructions / AR Guides (AR OMS)** ✅ — step-by-step procedures anchored in space: sequenced steps with images, draft→publish control, and per-step completion tracking when Operators run them. The manual-authoring foundation the AI capabilities below build on.
- **Instruction Import** ▢ — bring existing SOPs (PDF, Word, spreadsheets) into the platform: parsers propose guide steps, the Author approves. Nobody retypes documentation we already own.
- **AI Dynamic Instructions** ▢ *milestone* — the flagship AI-first capability: instructions generated and adapted on the fly from live context — the anchor in view, perception results, operator history, the active work order. Runs on local models via adapter; every generated step is traceable and reviewable before use.
- **CAD Import & Conversion** ✅ — bring engineering 3D models into AR: native GLB/USDZ directly, with OBJ/FBX/STEP converted automatically (headless Blender pipeline) and attached to anchors as overlays.
- **CAD Optimisation** ▢ — making imported models AR-ready: polygon reduction, levels of detail, and compression so overlays render smoothly on a phone without draining the battery.
- **AI 3D Generation** ▢ — model creation on the go: scan a part with a phone, get an AR-ready overlay in minutes (photogrammetry / Gaussian-splatting reconstruction). Removes the dependency on CAD availability.
- **CMS — Content Management System** ▢ — one versioned home for guides, models, tags, and media, with draft→review→publish workflow, rollback, and content lineage. The governance layer that makes authoring scale beyond one expert.

## Pillar 2 — Operator Runtime

- **QR Spatial Anchoring** ✅ — six-degrees-of-freedom (6-DOF: position and orientation) tracking from a printed QR code at exact physical size. Cheap, robust, works on day one in any environment.
- **Batch Validation** ✅ — one scan, every answer: a single anchor scan returns PASS/FAIL for all tags on that anchor, not one at a time.
- **Gemba Walk (Loc-Tags)** ✅ — audit-walk mode without QR codes: tap any surface to log a finding (defect category, photo, notes); the space itself is remembered (see ARWorldMap) so findings re-appear in place on the next walk. Each finding is tracked to closure — resolved, still present, or escalated.
- **ARWorldMap / Re-localisation** ✅ — Apple's saved "memory of a space": the device recognises a previously-mapped area and restores anchors without any marker. What makes Gemba findings persistent.
- **Evidence Capture** ✅ — photo evidence attached to inspections and findings, stored with the result. The raw material for audit trails — and, later, for training defect-detection models.
- **Object Anchoring** ▢ — anchoring on the part itself, no QR: the device recognises the object's shape (from a scan or its CAD model) and attaches content directly. Fallback chain: object → QR → world map.
- **AR SDK Layer** ▢ *milestone* — one abstraction over ARKit (Apple), ARCore (Android), VisionOS, and OpenXR. Clients negotiate capabilities with SIB per session; adding a new device class stops being a rewrite and becomes an adapter.
- **AR Glasses Exploration** 🔄 — hands-on evaluation of AR glasses (RayNeo, Apple Vision Pro, others) for tracking stability, anchor persistence, ergonomics, and battery — feeding the go/no-go decision on a production glasses client (▢ *Glasses Operator*).

## Pillar 3 — Perception & AI

- **Perception Layer** ✅ — the platform's eyes: everything that turns camera frames into judgements, always behind the adapter interface so models remain swappable.
- **SSIM Validation** ✅ — our in-house pass/fail comparison (Structural Similarity Index): live frame vs. trained pass state, returning a result with a confidence score. No external vendor calls.
- **Train in App** ✅ — pass states are trained on the shop floor, in the app, by the people who know the part — multi-angle capture with regions of interest. No data scientist in the loop.
- **Vision SDK Integration** ▢ — plugging specialised vision stacks in as adapters: on-device CoreML, object detectors, OCR for language checks — each benchmarked against the same test sets before promotion.
- **Defect Detection** ▢ — AI classification of defects mapped to our existing defect ontology, trained from the evidence photos the platform is already collecting. The data flywheel is running before the model exists.
- **On-Device Models** ▢ — compressed models pushed to the device itself: sub-second offline validation, results synced when back online.
- **Continuous Learning** ▢ *milestone* — closing the loop: operator verdicts and evidence become training signal; the platform detects model drift, proposes retraining, and promotes new models only after human approval. Perception that improves with every inspection.

## Pillar 4 — Enterprise Platform

- **Anchor Portal** ✅ — the browser console for the team: anchor directory, print-exact QR generation, and data administration.
- **Roadmap Tool** ✅ — the collaborative roadmapping and mind-mapping tool hosted on SIB (`/roadmap`) — real-time collaboration, lanes, reviews, presentation mode, whiteboard-photo import. The roadmap this dictionary describes lives in it.
- **RBAC — Role-Based Access Control** ▢ — named roles (Admin, Author, Operator, Viewer) with per-site scoping, replacing today's shared API key. Who can do what, enforced by the platform.
- **SSO — Single Sign-On (OIDC/SAML)** ▢ — sign in with corporate credentials via the company identity provider, using a self-hosted broker so authentication never leaves our network. Per-user identity flows into audit and collaboration.
- **Audit Logs** 🔄 — today: structured inspection logs (who validated what, when, with what result). Next: an immutable, tamper-evident event trail across all platform actions, exportable for QA and compliance review.
- **DB Store Adapter** ▢ — swapping file-based storage for a proper database behind the existing storage interface — invisible to users, prerequisite for multi-site scale.
- **Multi-Site Deploy** ▢ *milestone* — per-plant SIB instances with governed content promotion between them and a fleet-level view. The Platform v1.0 gate.

## Pillar 5 — Integrations & Robotics

- **MES / iOMS Integration** ▢ *milestone* — order context in, results out: work orders from iOMS/MES determine which guide and anchor the Operator sees; completions and results post back to the system of record. Connectors (SAP, direct SQL, webhooks) are adapters — one per system, none hard-coded.
- **Data Lake Export** ▢ — scheduled feeds of inspection results and session telemetry to enterprise analytics (SQL/Hadoop), enabling yield and defect trend analysis without opening SIB itself.
- **AI Ops Copilot** ▢ — ask the platform questions in plain language — "why did line 3 fail more this week?" — answered from inspection history, audit logs, and order context. Local inference, read-only to start.
- **Cobot Collaboration** ▢ *milestone* — AR and collaborative robots sharing SIB's spatial truth: the same anchors serve as a common world frame, enabling task handoff (operator flags → cobot executes → operator verifies in AR) and safety-zone visualisation. The "spatial OS" thesis made real; ROS2 bridge as the first adapter.

---

## iLOTO — Lockout/Tagout

- **LOTO — Lockout/Tagout** ✅ — the OSHA 29 CFR 1910.147 procedure for controlling hazardous energy during service: isolate the energy source, apply a personal lock and tag, verify, work, remove. iLOTO is the platform's spatial implementation — the app records; the physical lock protects.
- **Energy Isolation Point** ✅ — a breaker, switch or valve where energy is cut, marked in AR on the control panel. Yellow **Safe Off** points mark out-of-service isolation on breakers; red **LOTO** points mark personal lockout on switches.
- **Try Test** ✅ — the mandatory verification step of a LOTO apply: after locking, attempt to start the equipment and confirm it does not respond. The server refuses to record an apply without it.
- **One Lock, One Person** ✅ — only the person who applied a lock may remove it; the server rejects any other removal. The one exception is the supervisor override, recorded as its own event type.
- **Supervisor Override** ✅ — the OSHA-exception removal path: three explicit confirmations, a supervisor identity and a written reason, appended to the audit log and pinned first in every review surface.
- **LOTO Certification** ✅ — an expiring credential issued by passing the in-app OSHA 1910.147 training quiz (server-graded). Applying or removing a lock requires a valid certification; the portal manages the question bank.

---

## Acronym Quick Reference

| Acronym | Expansion |
|---|---|
| 6-DOF | Six Degrees of Freedom (position x/y/z + rotation) |
| AR / XR | Augmented Reality / Extended Reality (umbrella term) |
| ARKit / ARCore | Apple's / Google's AR frameworks |
| CAD | Computer-Aided Design (engineering 3D models) |
| CMS | Content Management System |
| CoreML | Apple's on-device machine-learning framework |
| GLB / USDZ | AR-ready 3D file formats (web/Android · Apple) |
| iOMS | Assembly-instruction and quality-verification system of record |
| LOD | Level of Detail (graduated model complexity) |
| MES | Manufacturing Execution System |
| OCR | Optical Character Recognition |
| OIDC / SAML | Single sign-on federation protocols |
| OpenXR | Cross-vendor open XR standard |
| RBAC | Role-Based Access Control |
| ROS2 | Robot Operating System 2 (robotics middleware) |
| SIB | Spatial Intelligence Backend |
| SSIM | Structural Similarity Index (image comparison) |
| SSO | Single Sign-On |
| VLM | Vision-Language Model (AI that reads images) |

---

*Maintained alongside the roadmap — when a node is added or renamed in the Roadmap tool, add or rename its entry here. Suggestions welcome; a dictionary only works if it's ours, not mine.*
