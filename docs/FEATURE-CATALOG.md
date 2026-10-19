# Feature Catalog - appliedx Connected Worker AR OMS Platform

> **This table is now a human-readable VIEW.** The canonical, machine-readable
> source is [docs/catalog/](catalog/README.md) - one YAML-frontmatter file per
> feature, rendered live at `/catalog`. When a feature ships or changes, update
> its `docs/catalog/<id>.md` file **and** the row here in the same commit; the
> drift checker treats disagreement between the two as a build failure.

The canonical index of everything the platform does. One row per capability, with a
status and a link to the deep documentation. **Update the relevant row in the same
commit that ships or changes a feature** - that rule is what keeps this document
trustworthy where prose feature docs go stale.

- **Status**: `Shipped` (in production use) · `Beta` (works, limited validation) ·
  `Stub` (interface real, implementation deliberately minimal) · `Planned`
- **Introduced / Updated**: platform version stamps. Features shipped before this
  catalog existed are marked `baseline`; stamps apply from the first release after
  the versioning standard is adopted (see [VERSIONING.md](VERSIONING.md)).

Audience-specific views (the leadership capability overview, release notes) are
**generated from the platform, never hand-maintained in parallel** - this catalog and
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

## 2. Gemba Walk - audit rounds (iOS + SIB)

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Markerless issue pinning (LocTags) | Tap any surface to drop a finding - no QR, no preparation | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
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
| MES connector | Production instruction-source adapter | Stub | - | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
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
| Edit any guide in Designer (round-trip) | ✏️ button in Guide Library opens (or generates) the linked procedure map; content edits to published guides apply live, structural edits unpublish until placed; stale-map warning | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Step content authoring | Voice script, optional toggle, reference image and 3D model assignment on canvas nodes; compiled into the guide at export | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Day/night canvas | Dark canvas for procedure maps (default) with a toolbar toggle; node cards stay white so contents never lose contrast | Shipped | 2026.4.42 | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Preview mode | Phone-frame walkthrough of a procedure: real edge-graph traversal (Complete/Failed), voice playback, requires-gate redirects, canvas highlight, branch-coverage exit summary | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Reference link per step | Any http(s) URL (video, PDF, SOP) authored on a step; "Reference" button on the iOS AR panel opens it in Safari | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Auto-sizing nodes | Cards wrap titles up to 4 lines and grow to fit; all geometry (edges, minimap, layout, export) follows the real height | Shipped | 2026.4.42 | [roadmap-mindmapper](roadmap-mindmapper.md) |
| Edge type switcher + legend | Change Next / On failure / Requires on a selected connection; census line-swatch legend + role explainer panel | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |

## 6b. iLOTO - spatial Lockout/Tagout

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
| Guide import (xlsx/JSON) with preview | Excel template + header-flexible parse, pre-import validation preview, post-import jump-and-flash to the new guide | Shipped | 2026.4.42 | - |
| Guide move-to-anchor | Reassign a guide (and steps) to another anchor; placement cleared, guide unpublished until re-placed | Shipped | 2026.4.42 | - |
| SIB home page | Landing at / with cards for Portal, Roadmap/Procedure Designer, App Wireframe (/wireframe); live status + version | Shipped | 2026.4.42 | - |
| Ask SIB | /ask + drawer on /catalog - docs-grounded Q&A citing features; retrieval everywhere, generation via any OpenAI-compatible local model (llama.cpp / Ollama) | Beta | 2026.4.42 | [catalog/README](catalog/README.md) |
| Guide Preview (portal) | ▶ Preview walks the real branch graph in a phone frame - Complete/Failed/Skip, requires redirects, images, voice, coverage summary, placement banner | Shipped | 2026.4.42 | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) |
| Backup & restore | Admin-gated `GET /admin/backup?scope=data\|full` streams a timestamped tar.gz of the data dir; portal Settings buttons; documented manual restore | Shipped | 2026.4.42 | [INTERNAL-SERVER-DEPLOY](INTERNAL-SERVER-DEPLOY.md) |
| Visual Feature Catalogue | /catalog - connected graph of all features generated live from docs/catalog/ frontmatter: flows, dependencies, glossary hovers, role trails, spec deep-dives; drift-checked via `npm run catalog:check` | Shipped | 2026.4.42 | [catalog/README](catalog/README.md) |

## 7. Platform foundations

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Self-hosted end to end | Render or on-prem (Windows + NSSM); no third party sees site data | Shipped | baseline | [WHY-RENDER](WHY-RENDER.md) / [INTERNAL-SERVER-DEPLOY](INTERNAL-SERVER-DEPLOY.md) |
| No cloud AI dependency | Every intelligent feature local or behind an owned interface | Shipped | baseline | [README](../README.md) |
| Adapter architecture | Perception, instruction sources, AI guidance, vision - all pluggable with working defaults | Shipped | baseline | [technical-architecture](technical-architecture.md) |
| Shared TypeScript schema | One `@spatial/shared` package typed across server, portal and (mirrored) iOS | Shipped | baseline | [schemas](schemas.md) |
| Guided onboarding (FTUE) | Six per-workflow walkthroughs + spotlight tour + contextual help | Shipped | baseline | [APP-FEATURES](APP-FEATURES.md) |
| Guide ingestion service | Single create/upsert path for guides; spatial placement can never be overwritten by an import or canvas write | Shipped | baseline | [PROCEDURE-DESIGNER](PROCEDURE-DESIGNER.md) §8 |

## 8. Connected Worker - shipped in 2026.4.45 → 2026.4.46

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| `.tag` virtual emitter + live subscribe | Signed, tamper-evident part / assembly envelopes; SSE change feed per chamber | Beta | 2026.4.45 | [TAG-FORMAT](TAG-FORMAT.md) |
| User Access Management (RBAC) + guide sharing | Allow-list of users with four roles; per-user guide sharing; iOS identity | Beta | 2026.4.45 | [catalog/uam](catalog/uam.md) |
| Kiosk shift start | Employee-ID-only sign-in + Production #; role-aware two-step gate | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#kiosk-shift-start) |
| AR OMS Usage Log | Durable per-step record derived from live events; live evidence; Excel | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#ar-oms-usage-log) |
| Production-verified resume | Resume snapshots bound to the Production #; Switch & Resume prompt; pilot hardening | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#production-verified-resume) |
| Step validation (cone · quick-shot · never-stuck) | Camera-verified step completion via the inspection comparator; focus mode; override with audit; drift check | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#step-validation-ssim-cone-quick-shot-never-stuck) |
| Chamber Configurations | Chamber types; role-aware authoring / operating; Guide Library grouped by configuration; copy to all chambers | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#chamber-configurations) |
| Copy guide · duplicate anchor · model slots | Roll authoring out across chambers; three 3D model slots per step | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#copy-guide-duplicate-anchor-model-slots) |
| Portal guided assistance | Getting-started checklist from live stats, page tours, empty-state next steps | Shipped | 2026.4.45 | [CONNECTED-WORKER](CONNECTED-WORKER.md#portal-guided-assistance) |
| Sealed world maps | The author's map is the origin, the QR the key and drift check; shared loader | Shipped | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#sealed-world-maps-one-localization-doctrine) |
| Object anchoring | Scan a chamber's shape; object as origin; movable equipment re-align; shape-model ghost | Beta | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#object-anchoring-scan-origin-movable-equipment-shape-ghost) |
| Presence & coaching | Colleagues visible in AR on the same chamber; author coaches the operator with look-here markers | Shipped | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#presence-coaching-multi-user) |
| In-AR moment coach | Contextual one-line cards the first time a control matters, per person; panel redesign | Shipped | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#in-ar-moment-coach) |
| Device logs (QA logging) | iPhone log lines shipped to SIB; QA Mode; portal live tail and export | Shipped | 2026.4.46 | [QA-LOGGING](QA-LOGGING.md) |
| SIB Compass | One radial navigator with live counts on every web surface | Shipped | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#sib-compass) |
| Platform story (/platform) | "The Chamber" scroll story with the Connected Worker ladder and self-assessment | Shipped | 2026.4.46 | [CONNECTED-WORKER](CONNECTED-WORKER.md#platform-story-platform) |
| Gemba Walk - Audit Reference Library | Focus Areas → Questions, categories, ratings, pick lists; import from Excel/CSV | Shipped | 2026.4.46 | [GEMBA-WALK](GEMBA-WALK.md) |
| Gemba Walk - findings, photos, markup | Reference or custom entries, Strength/OFI/NC, risk, six captioned photos, PencilKit markup, floating panels | Shipped | 2026.4.46 | [GEMBA-WALK](GEMBA-WALK.md) |
| Gemba Walk - sessions + Excel | Walk header, continue/join, summary, three-sheet Excel with every photo, filtered export | Shipped | 2026.4.46 | [GEMBA-WALK](GEMBA-WALK.md) |
| Gemba Walk - together, phone-down, checkpoint | Multi-auditor presence, Live Activity navigation, welcome-back checkpoint, drift check | Shipped | 2026.4.46 | [GEMBA-WALK](GEMBA-WALK.md) |
| Contextual intelligence | 1 Hz observations from the run, signals → hints with operator controls, effectiveness loop and per-guide Intelligence page (step heat, hints that helped, retirement) | Shipped | 2026.4.46 | [CONTEXTUAL-INTELLIGENCE](CONTEXTUAL-INTELLIGENCE.md) |
| Insights | The leadership view: tiles with sparkline and delta, runs per day, hints that helped, time per guide, heat strip to the hottest step; 7/30/90 days, filters, Save as image, Excel | Shipped | 2026.4.46 | [CONTEXTUAL-INTELLIGENCE §3](CONTEXTUAL-INTELLIGENCE.md#part-3---effectiveness-loop-portal-shipped) |
| Demo / training mode per guide | Floors only, patient hints, runs never counted as production | Shipped | 2026.4.46 | [CONTEXTUAL-INTELLIGENCE](CONTEXTUAL-INTELLIGENCE.md) |
| Validation plan per step | Quick shot or cone chosen by the author in the Designer and on the iPad; Place Steps offers the plan first | Shipped | 2026.4.50 | [CONNECTED-WORKER](CONNECTED-WORKER.md#step-validation-ssim-cone-quick-shot-never-stuck) |
| Step navigator | Tap the progress ring for every step with its state; jump to any | Shipped | 2026.4.50 | [APP-FEATURES](APP-FEATURES.md) |
| Danger zone key | Wipe-all routes behind `SIB_DANGER_KEY` on top of the Owner / admin gate; refusals logged | Shipped | 2026.4.50 | [SERVER-REFERENCE](SERVER-REFERENCE.md) |
| Portal dialogs on the design system | axAlert / axConfirm / axPrompt / axChoose / axForm replace browser dialogs | Shipped | 2026.4.50 | [BRAND](BRAND.md) |

## 9. Spatial readings - shipped in 2026.4.50

What the camera reads on a step, judged on the device and said in words. Spec: [SPATIAL-READINGS](SPATIAL-READINGS.md); catalogue entry `spatial-readings`.

| Feature | What it does | Status | Introduced | Docs |
|---|---|---|---|---|
| Readings and text checks on a step | A step carries assertions: an instrument reading, words on a label, a barcode; the ME types the expectation as the work instruction says it; SIB derives the bounds; one judge on both ends | Shipped | 2026.4.50 | [SPATIAL-READINGS §2](SPATIAL-READINGS.md#2-assertions) |
| iPad reading sheet | Frame the display or label, tap Read; on-device Vision; verdict per check in words; the frame is the evidence; "Type it instead" recorded as typed | Shipped | 2026.4.50 | [SPATIAL-READINGS §4](SPATIAL-READINGS.md#4-operator-side) |
| Label position | A Text check can also require the label where it was trained; the author reads it once in Place Steps in AR; untrained is flagged, never blocking | Shipped | 2026.4.50 | [SPATIAL-READINGS §8](SPATIAL-READINGS.md#8-author-journey-reviewed-2026-10-16-aroms-346) |
| "Must say", not "says only" | Text and barcode checks pass when the label carries the words (contains; "a \| b" for either); a blank check is not saved and cannot strand the operator | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.1](SPATIAL-READINGS.md#81-a-text-check-means-must-say-2026-10-19-aroms-349) |
| Training captures the words | Reading the real label sets the expectation as the camera spells it (tap the line); blank checks filled from the label | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.1a](SPATIAL-READINGS.md#81a-training-captures-the-words-2026-10-19-aroms-350) |
| Try it as the operator | Any trained step's chip runs the operator's presence rule and reading sheet, nothing recorded | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.2](SPATIAL-READINGS.md#82-try-it-as-the-operator-2026-10-19-aroms-351) |
| Barcode checks | 1D, QR, Data Matrix, PDF417, Aztec decoded on the same frame; judged on the payload; printed digits as the said fallback | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.3](SPATIAL-READINGS.md#83-barcodes-2026-10-19-aroms-340) |
| Instrument displays | Three frames sampled, the recurring value kept, a settling display said so; scientific notation as leak checkers print it; split mantissa / exponent joined | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.5](SPATIAL-READINGS.md#85-instrument-displays-2026-10-19-aroms-342) |
| One validation on the floor | Presence first; the checks read on the cone's own frame; the sheet only when not legible from there | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.4](SPATIAL-READINGS.md#84-one-validation-on-the-floor-2026-10-19-aroms-352) |
| Labels in Korean, Japanese and Chinese | Scripts asked of Vision per line; the language named with the verdict and on the chips | Shipped | 2026.4.50 | [SPATIAL-READINGS §8.6](SPATIAL-READINGS.md#86-labels-in-korean-japanese-and-chinese-2026-10-19-aroms-355) |
| Reads in the portal | Reading, label and barcode chips on the Completion Log and on every step visit in the Usage Log; notation printed as 1.2 × 10⁻⁹ | Shipped | 2026.4.50 | [SPATIAL-READINGS](SPATIAL-READINGS.md) |
| Readings in Intelligence and Insights | First-time-right and typed-instead rates per step; measured values over runs | Proposed | - | [BACKLOG AROMS-354](BACKLOG.md) |
| TestFlight notes from the repo | `npm run testflight:notes` sets What to Test and the Beta App Description through the App Store Connect API | Shipped | 2026.4.50 | [TESTFLIGHT](TESTFLIGHT.md) |
