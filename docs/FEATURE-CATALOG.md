# Feature Catalog — AR Operations Platform

> **This table is now a human-readable VIEW.** The canonical, machine-readable
> source is [docs/catalog/](catalog/README.md) — one YAML-frontmatter file per
> feature, rendered live at `/catalog`. When a feature ships or changes, update
> its `docs/catalog/<id>.md` file **and** the row here in the same commit; the
> drift checker treats disagreement between the two as a build failure.

The canonical index of everything the platform does. One row per capability, with a
status and a link to the deep documentation. **Update the relevant row in the same
commit that ships or changes a feature** — that rule is what keeps this document
trustworthy where prose feature docs go stale.

- **Status**: `Shipped` (in production use) · `Beta` (works, limited validation) ·
  `Stub` (interface real, implementation deliberately minimal) · `Planned`
- **Introduced / Updated**: platform version stamps. Features shipped before this
  catalog existed are marked `baseline`; stamps apply from the first release after
  the versioning standard is adopted (see [VERSIONING.md](VERSIONING.md)).

Audience-specific views (the leadership capability overview, release notes) are
**generated from the platform, never hand-maintained in parallel** — this catalog and
the linked docs are the single source of truth.

---

## 1. Spatial Inspection (iOS + SIB)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| QR-anchored 6-DOF tracking | Printed QR locks the AR coordinate frame to the asset; gravity-normalised so scan angle doesn't shift tag positions | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Typed check ontology | Five tag types: presence, language, routing, configuration, part | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Multi-angle training capture | Guided cone (19-zone dome) and honeycomb (7-point hemisphere) reference capture with depth metadata | Shipped | baseline | [SIB-TRAINING-FEATURES](SIB-TRAINING-FEATURES.md) |
| Dual PASS/FAIL reference states | Tags trained on both the correct and the defect state for sharper discrimination | Shipped | baseline | [SIB-TRAINING-FEATURES](SIB-TRAINING-FEATURES.md) |
| Region of interest (ROI) | Author draws a box around the feature that matters; scoring ignores background | Shipped | baseline | [SIB-TRAINING-FEATURES](SIB-TRAINING-FEATURES.md) |
| Patch-grid scoring with registration | Alignment before worst-percentile patch comparison; per-tag calibrated thresholds | Shipped | baseline | [SIB-TRAINING-FEATURES](SIB-TRAINING-FEATURES.md) |
| PASS/FAIL with confidence score | Every check returns a verdict plus 0–100% confidence | Shipped | baseline | [SIB-TRAINING-FEATURES](SIB-TRAINING-FEATURES.md) |
| Batch validation | One capture validates every tag on the anchor | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| Tag groups | Named inspection sets validated as a unit | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| OCR / text checks | On-device Vision text recognition compared against expected values, with image fallback | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Inspection sessions + evidence | Per-tag results, retakes, evidence photos, session reports in the portal | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| AES-256-GCM at source | Reference imagery encrypted on device; key never leaves it; server stores no plaintext | Shipped | baseline | [README](../README.md) |

## 2. Gemba Walk — audit rounds (iOS + SIB)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Markerless issue pinning (LocTags) | Tap any surface to drop a finding — no QR, no preparation | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| ARWorldMap spatial memory | Walks re-localize into the saved map so findings appear in their true positions | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Photo-guided re-localization | Author's original viewpoint shown as a reference card, with "I'm here" override | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Defect taxonomy + severity | Category and severity on every finding | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Resolution tracking | Resolved / still present / escalated, with completion photos; portal audit trail | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |

## 3. AR Work Instructions (iOS + SIB + portal)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Spatially placed guide steps | Steps pinned in AR with floating instruction panels; operator physically guided | Shipped | baseline | [README](../README.md) |
| Draft → placed → published lifecycle | Guides invisible to operators until fully placed and published | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) §6 |
| 3D ghost overlays per step | Translucent model at a step with author-set scale, opacity, offset, rotation | Shipped | baseline | [README](../README.md) |
| Voice scripts (TTS) | Optional per-step spoken instruction | Shipped | baseline | [README](../README.md) |
| Evidence capture + sign-off | Per-step photos; completion recorded with operator, timestamps, durations | Shipped | baseline | [README](../README.md) |
| Conditional task graph | Steps branch on outcome (`nextOnSuccess`/`nextOnFailure`) and gate on prerequisites | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) §4 |
| Instruction import (adapter) | `POST /guides/import` behind a pluggable adapter; manual JSON adapter shipped | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| MES connector | Production instruction-source adapter | Stub | — | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Live session telemetry (SSE) | Seven event types streamed during a walk; observers see progress in real time | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| AI-assisted guidance | Adapter decides when to help; hints delivered via consume-once queue. Rule-based stub today, model-swappable by design | Shipped (stub adapter) | baseline | [README](../README.md) |
| Stall detection | 90 s dwell on an incomplete step raises a hint automatically | Shipped | baseline | [README](../README.md) |
| **Procedure Designer** | Procedures drawn as flowcharts on the Roadmap canvas; validated; compiled to draft guides; re-sync never overwrites AR placement | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |

## 4. 3D Asset Library (SIB + portal + iOS)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Shared library with anchor kits | Models assigned per-anchor or marked `general` for all | Shipped | baseline | [README](../README.md) |
| GLB/USDZ pass-through | Native AR formats served directly | Shipped | baseline | [README](../README.md) |
| CAD/mesh conversion | OBJ/FBX/STEP → GLB via headless Blender where present | Shipped | baseline | [README](../README.md) |
| In-browser GLB→USDZ | Three.js USDZExporter in the portal; no native toolchain on the server | Shipped | baseline | [README](../README.md) |
| Saved default scale | Author-set real-world scale pre-fills every picker | Shipped | baseline | [README](../README.md) |

## 5. Team Portal (`/portal`)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Anchor directory + print-exact QR | Anchors managed in the browser; QR prints at true physical size | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| Sessions / Gemba / AR Guides review | Full history with evidence photos; CSV export | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| Guide Library | Browse, publish/unpublish, delete, import guides; per-step placement status | Shipped | baseline | [README](../README.md) |
| ⬡ Task graph visualisation | Branch logic rendered with lanes per recovery path, back-arcs for retry loops, link census header | Shipped | baseline | [README](../README.md) |
| Data administration | Per-row and bulk delete with correct cascades | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| Auth auto-detection | Portal detects whether the server enforces an API key | Shipped | baseline | [SERVER-REFERENCE](SERVER-REFERENCE.md) |

## 6. Roadmap Mind-Mapper (`/roadmap`)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Real-time collaboration | WebSocket rooms, live cursors, presence, LWW conflict resolution | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Swimlanes + groups + filters | Now/Next/Later columns, Why/What/How rows, saved node groups, view filters | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Status, review, comments, milestones | Per-node execution status, review verdicts, threaded comments | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Version history + restore | Snapshots with restore; auto-snapshot during collab sessions | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Draft → publish workflow | Per-map draft keys (pre-RBAC) | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Export / import | PNG, SVG, JSON export; cross-server JSON import; SIB ontology import/export | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Whiteboard image import | Local vision model (Ollama) turns a photo into an editable draft | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Presentation mode | Step-through walkthrough of lanes/groups | Shipped | baseline | [roadmap-mindmapper](roadmap-mindmapper.md) |
| **Procedure maps** | `kind: 'procedure'` maps with role-typed edges, server-derived step numbers, pre-flight validation, send-to-Guide-Library | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Step content authoring | Voice script, optional toggle, reference image and 3D model assignment on canvas nodes; compiled into the guide at export | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Day/night canvas | Dark canvas for procedure maps (default) with a toolbar toggle; node cards stay white so contents never lose contrast | Shipped | 2026.4.42 | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Preview mode | Phone-frame walkthrough of a procedure: real edge-graph traversal (Complete/Failed), voice playback, requires-gate redirects, canvas highlight, branch-coverage exit summary | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Reference link per step | Any http(s) URL (video, PDF, SOP) authored on a step; "Reference" button on the iOS AR panel opens it in Safari | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Auto-sizing nodes | Cards wrap titles up to 4 lines and grow to fit; all geometry (edges, minimap, layout, export) follows the real height | Shipped | 2026.4.42 | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Edge type switcher + legend | Change Next / On failure / Requires on a selected connection; census line-swatch legend + role explainer panel | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |

## 6b. iLOTO — spatial Lockout/Tagout

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| iLOTO anchors + hub | 'LOTO' anchor type (control panel, QR + worldmap); iOS hub with live status banner, six tiles, certification gate | Shipped (slice 1) | 2026.4.42 | [ILOTO](ILOTO.md) |
| Append-only LOTO audit log | Apply/remove/override events with server-enforced checklists, try test, photo evidence, one-lock-one-person; status always derived, never edited | Shipped (slice 1) | 2026.4.42 | [ILOTO](ILOTO.md) |
| LOTO training + certification | Seeded OSHA 1910.147 question bank, quiz UI with miss review, server-side grading, expiring certs gating apply/remove; portal questionnaire editor with atomic JSON/CSV import + export | Shipped | 2026.4.42 | [ILOTO](ILOTO.md) |
| My LOTO | Cross-anchor view of the user's active locks with remove deep-link; hub tile turns red with live count (shift-end nudge) | Shipped | 2026.4.42 | [ILOTO](ILOTO.md) |
| AR point authoring + apply/remove flows | Yellow/red lock placement with worldmap relocalization, ordered apply/remove checklists (photo + try test), supervisor override UI, Check Status AR walk + point history | Shipped (slice 2) | 2026.4.42 | [ILOTO](ILOTO.md) |
| 3D assets on points (≤3 slots) | Lock + tag + hasp per point from the Model3D library; each slot ghost/solid by state with its own AR-adjusted placement (H/V pan, pinch, Y-rotate); per-slot placement reset on model change | Shipped | 2026.4.42 | [ILOTO](ILOTO.md) |
| Portal iLOTO tab | Status board per panel, audit trail (overrides pinned, evidence lightbox), cert registry, CSV exports | Shipped | 2026.4.42 | [ILOTO](ILOTO.md) |
| AR LOTO map | Vertex-drawn flow lines snapped to breaker markers; live status-aware rendering (grey when safe-off'd, teal pulse when energized); versioned | Shipped | 2026.4.42 | [ILOTO](ILOTO.md) |

## 6c. Portal foundations (new)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Guide import (xlsx/JSON) with preview | Excel template + header-flexible parse, pre-import validation preview, post-import jump-and-flash to the new guide | Shipped | 2026.4.42 | — |
| Guide move-to-anchor | Reassign a guide (and steps) to another anchor; placement cleared, guide unpublished until re-placed | Shipped | 2026.4.42 | — |
| SIB home page | Landing at / with cards for Portal, Roadmap/Procedure Designer, App Wireframe (/wireframe); live status + version | Shipped | 2026.4.42 | — |
| Visual Feature Catalogue | /catalog — connected graph of all features generated live from docs/catalog/ frontmatter: flows, dependencies, glossary hovers, role trails, spec deep-dives; drift-checked via `npm run catalog:check` | Shipped | 2026.4.42 | [catalog/README](catalog/README.md) |

## 7. Platform foundations

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Self-hosted end to end | Render or on-prem (Windows + NSSM); no third party sees site data | Shipped | baseline | [WHY-RENDER](WHY-RENDER.md) / [INTERNAL-SERVER-DEPLOY](INTERNAL-SERVER-DEPLOY.md) |
| No cloud AI dependency | Every intelligent feature local or behind an owned interface | Shipped | baseline | [README](../README.md) |
| Adapter architecture | Perception, instruction sources, AI guidance, vision — all pluggable with working defaults | Shipped | baseline | [technical-architecture](technical-architecture.md) |
| Shared TypeScript schema | One `@spatial/shared` package typed across server, portal and (mirrored) iOS | Shipped | baseline | [schemas](schemas.md) |
| Guided onboarding (FTUE) | Six per-workflow walkthroughs + spotlight tour + contextual help | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Guide ingestion service | Single create/upsert path for guides; spatial placement can never be overwritten by an import or canvas write | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) §8 |
