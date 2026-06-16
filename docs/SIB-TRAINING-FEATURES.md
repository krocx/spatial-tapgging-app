# SIB Training — Feature List

What "training" actually means in this app: an Author captures reference images (and sometimes depth/text) for a tag, those references get encrypted and stored, and later an Operator's live camera frame gets scored against them. This doc lists what's real today versus what's only sketched out in planning docs.

The important thing to understand first: **training/validation is a layered pipeline, not one backend feature.** The SIB server itself only does generic image comparison (SSIM + color histogram). Everything tag-type-specific — feature prints, cone alignment, LiDAR depth, OCR — happens entirely on the iOS client, in Swift, using Apple's Vision framework. SIB never sees a "feature print" or a "depth map"; it only ever sees JPEGs.

---

## Implemented

### Reference image capture, encryption, upload
- Three distinct capture UIs, chosen automatically by tag type (`TagType.captureMode` in `SIBTypes.swift`):
  - **Honeycomb** (`HoneycombCaptureView.swift`) — 7 fixed viewpoints with proximity auto-trigger. Used only for `inspectionPoint`.
  - **Cone** (`ConeCaptureView.swift`) — a guided sweep across a dome of capture spheres, plus LiDAR depth. Used for `presenceCheck`, `routingCheck`, `configurationCheck`, `partCheck`.
  - **OCR** (`OCRCaptureView.swift`) — a single straight-on capture read by Apple Vision's text recognizer. Used for `languageCheck` and `warning`.
- Captured JPEGs are encrypted client-side with AES-256-GCM (CryptoKit) before they ever leave the device — `Services/AnchorEncryption.swift`.
- `POST /perception/train` (`sib/src/routes/training.ts`) accepts the encrypted images, decrypts them in memory only (plaintext is never written to disk), and replaces any existing trained state for that tag.
- Body size limit raised from 10MB to 30MB so a full 14–19 image cone sweep fits in one request.

### Scoring
- **Server-side (generic, all tag types):** SSIM + color-histogram blend in `sib/src/perception/image-comparator.ts` — the only scoring SIB itself does. It has no concept of tag type.
- **Client-side feature prints (all tag types):** Apple Vision `VNGenerateImageFeaturePrintRequest`, compared by L2 distance to the nearest reference print (`Services/TagFeaturePrint.swift`). Score only ever raises the SIB score (`max(ssimScore, featurePrintScore)`) — except for `partCheck` (see below).
- **Per-tag calibrated thresholds (real, all tag types):** instead of one global cutoff, each tag's "max distance" is computed from the spread of its own reference prints (max pairwise distance × 2.5, floored at 0.8). Falls back to a global default (2.0) if a tag has fewer than 2 reference prints.
- **Part-check center-crop override (real, `partCheck` only):** a second, center-cropped feature print is stored alongside the full-frame one, and its score is *authoritative* — it can flip a PASS to a FAIL or vice versa, unlike every other tag type where feature-print score only ever helps.
- **Cone alignment + LiDAR depth (real, any tag trained via the Cone capture UI):** `OperatorModeView.swift` computes an alignment factor from camera angle, and if a depth map was captured during training, blends 60% image score / 40% depth score.
- **OCR text matching (real, `languageCheck` only):** live Vision OCR output is matched word-by-word (case-insensitive substring match) against the tag's expected text; a strong match can raise the score, same pattern as feature prints.

### Anchoring & world persistence
- `POST/GET /anchors/:id/worldmap` stores/retrieves a binary ARKit `ARWorldMap` so tags reliably reappear in the same physical spot across sessions, instead of drifting by the few centimeters ARKit's relocalization is naturally prone to.
- 15-second relocalization timeout with a fresh-session fallback if the saved map doesn't lock in time.

### QR / anchor distribution
- `POST /anchors` auto-generates the canonical QR PNG server-side (fixed mask, fixed ECC level) so the iOS app and the web portal always render pixel-identical codes — this used to mismatch when each side generated its own.
- QR encodes both the anchor ID and the AES key needed to decrypt that anchor's images.

### Readiness check
- `GET /anchors/:id/readiness` reports whether every tag on an anchor has a trained pass-state yet, which is what drives the orange/red warning banner Operators see before starting an inspection.

---

## Planned / not yet implemented

These are real gaps confirmed against the code — not guesses. Most come from `CLOUD-MIGRATION-SPEC.md`, which describes a future state that nothing in `sib/src/` currently implements.

- **Most tag types have no type-specific scoring at all.** Only `partCheck` (center-crop override) and `languageCheck` (OCR override) get real differentiated logic. `inspectionPoint`, `defect`, `instruction`, `warning`, `measurement`, `routingCheck`, and `configurationCheck` all fall back to plain SSIM + generic full-frame feature print — no logic written specifically for what each of those check types actually means.
- **`defect`, `instruction`, `warning`, and `measurement` look like legacy/unused tag types in the current UI** — none of them appear in the tag-creation suggestion list in `AddTagSheet.swift`. `warning` is the only one with a deliberate capture-mode mapping; the rest just fall through Swift's `default` case to Cone capture, which may not even be the right capture method for them.
- **No real authentication beyond one shared API key.** The cloud-migration plan calls for per-device JWT auth (`POST /auth/register-device`, `POST /auth/token`) — neither endpoint exists. Today it's a single `X-API-Key` header, and that check is a no-op entirely if `SIB_API_KEY` isn't set (which it isn't, locally, by default).
- **No real database.** Everything — anchors, tags, pass-states, sessions — is flat JSON files on disk (`JsonFileStore`). A full Postgres schema is specified in the migration spec but nothing in code touches a database.
- **No multi-tenancy.** No `orgId` concept exists anywhere in the shared types; the planned `POST /admin/orgs` endpoint doesn't exist.
- **No object storage offload.** Every training image is stored as an inline base64 string inside the JSON pass-state file. The migration spec's plan to move images to S3/R2 (`storage_key` references instead of inline blobs) hasn't started.
- **No web dashboard.** No Next.js/Vercel code exists anywhere in the repo — this is 100% future work.
- **No real audit log.** The plan calls for structured audit events (`ANCHOR_CREATED`, `TAG_TRAINED`, `INSPECTION_RUN`, `AUTH_FAILURE`, etc.); today there's only `console.log` plus a flat inspection-log file that roughly covers `INSPECTION_RUN` and nothing else.
- **`/admin/inspection-logs` endpoints are written but never mounted.** The logging code (`inspection-logger.ts`) has the handlers ready with a comment literally calling them out for "future web dashboard," but `app.ts` never wires them up to a route.
- **Deferred reliability work** (stated directly in `PHASE-HISTORY.md`): occasional validation failures even when capturing what looks like the same trained area, and further payload-size optimization on the client side. Both were explicitly punted to a later session.
- **Known scaling debt:** tag lookup by ID is an unindexed linear scan over the JSON store (`pass-state-store.ts`) — fine at current data volumes, not fine forever.
- **`/perception/analyze-image` is dead code from an earlier phase** — it only ever calls a stub adapter (`StubPerceptionAdapter`) and isn't part of the real training/validation flow. Don't mistake it for an active feature.

A couple of older docs in the repo describe states that no longer match reality — `STATUS.md` is dated and still references the pre-iOS web-AR architecture, and `docs/technical-architecture.md` is explicitly an aspirational/vision document, not a description of what's built. Neither should be read as "current state."

---

See also: [APP-FLOW.md](APP-FLOW.md) for how these capture modes fit into the screen-by-screen flow, and [SERVER-REFERENCE.md](SERVER-REFERENCE.md) for the full endpoint list.
