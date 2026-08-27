# Changelog

One section per platform version (see [docs/VERSIONING.md](docs/VERSIONING.md)),
newest first. Written in the same PR as the change — if a teammate would notice
it, it gets a line.

## 2026.4.42 — 2026-08-11

### Added
- **Operator pilot hardening (AR Work Instructions)** — six fixes from the
  operator-POV UX review ahead of daily technician use: (1) the authored
  failure branch is finally reachable — steps with a recovery path show
  "Step failed → go to recovery", confirm, record a `step:failed` live event
  and route to `nextOnFailure` (previously the branch existed only on paper);
  (2) session resume — step progress and evidence photos persist to the
  device after every action, and an interrupted run (call, battery, wrong
  tap) offers "Resume previous run?" for up to 12 h instead of forcing a
  redo; (3) offline sign-off queue — a failed submission offers "Save & sync
  later"; the record (evidence included) uploads automatically next time the
  guide list opens with a connection, with a green confirmation banner;
  (4) operator name prefills from Settings identity; (5) submitting with
  incomplete steps now warns with the count (warn not block — branch skips
  are legitimate); (6) precondition redirects explain themselves with a
  toast instead of silently jumping. New: Services/GuideRunStore.swift;
  `step:failed` added to the shared event union.
- **`.tag` live subscription (M2 — the continuous emitter)** — assembly
  envelopes' `subscribe.hints` now lead with a real SSE feed:
  `GET /anchors/:id/subscribe` sends `state` (contentVersion + payload hash)
  on connect and pushes `changed` events naming exactly which streams and
  member parts moved (`stream:worldmap`, `member:<tagId>`) so readers
  re-fetch only the delta and verify it against the new hashes. Event-driven
  server side: a store-write bus on JsonFileStore (single hook point) with a
  400 ms debounce, recomputed only for anchors with live subscribers, plus a
  30 s safety sweep for binary artifacts; heartbeats keep proxies alive. Push
  carries hashes and names only — never content. iOS gains `TagSubscription`
  (async SSE listener with auto-reconnect) in TagEnvelope.swift. Spec §7
  updated — subscribe graduates from hints-only.
- **Catalogue IP-sensitivity gate (secondary secret)** — features marked
  `sensitivity: restricted` in their frontmatter are redacted for anyone
  without the new `SIB_IP_KEY` env secret: /catalog/data strips body, flows,
  architecture, API lines and spec (node stays in the graph with a 🔒 chip +
  "Enter IP key" unlock), /catalog/doc returns 403, and Ask SIB excludes them
  from retrieval so it can't become a side-channel. Key travels as X-IP-Key
  (stored like the API key). Deliberately separate from the admin key — IP
  viewers ≠ data admins. Gate off when the env var is unset, so internal
  deployments are unchanged. All restriction decisions flow through ONE
  function (`canViewRestricted`) — the designated swap point when SSO/RBAC
  arrives. First restricted entry: the .tag format feature below. The
  browser-stored IP key expires after 7 days (shorter than the API key's 30 —
  it protects more sensitive content), after which the 🔒 prompt returns.
  Field fix: selecting a locked card no longer strands the node on the cursor
  (the missing spec button threw mid-click, skipping the drag release).
- **`.tag` virtual emitter v1 (beta)** — every tagged part and every chamber
  can now emit a signed, tamper-evident envelope (spec: docs/TAG-FORMAT.md,
  Proprietary & Confidential, patent pending). `GET /tags/:id/emit` yields a
  part envelope; `GET /anchors/:id/emit` yields the chamber assembly with a
  member manifest hashing every part beneath it (Merkle-style tree — one
  signature commits to the whole chamber's state). References + SHA-256 only,
  never inline payloads; deterministic emission (no timestamps or JSON
  numbers in the payload); Ed25519 issuer key auto-generated on first boot at
  `<data-dir>/tag-signing-key.json` (covered by data-scope backups). Zero new
  dependencies — Node built-in crypto server-side, CryptoKit on device.
  Conformance validator + 10 tests including emit→tamper→re-validate; iOS
  reference reader (TagEnvelope.swift) verifies, pins the issuer on first
  scan, and caches envelopes for offline in Documents/tags/. Subscribe is
  hints-only in v1; live per-chamber push lands in M2.
- **Per-feature API reference in the catalogue** — 47 features now carry an
  `api:` block ("METHOD /path — purpose (caller · auth tier)") rendered as an
  API section on the /catalog card between Architecture and the spec, with
  method chips and auth-tier annotations (API key / admin key / public).
  127 endpoint lines cover the full surface: anchors, tags, perception,
  sessions, guides + live SSE, models, mindmap/procedure, worldmap, Gemba,
  iLOTO, quiz admin, ask, admin/backup. `catalog:check` extracts the real
  Express routes from `sib/src` and fails on any listed endpoint that doesn't
  exist or any malformed line — the reference cannot silently drift from the
  code. UX-only features carry no API section rather than filler.
- **Catalogue "Read the spec" now section-scoped** — spec paths can carry a
  heading anchor (`spec: ../README.md#3d-model-library`) and `/catalog/doc/:id`
  serves just that section instead of the whole file. The 11 features whose
  source of truth is a README section (model library, ghost overlays, the six
  AR-OMS capabilities, guide library, task graph, encryption) now show only
  their section; features with dedicated deep-dive docs are unchanged.
  `catalog:check` validates anchors against real headings so a renamed README
  heading fails CI instead of silently degrading to full-file.
- **Rename 3D models in the portal** — each card in the 3D Models tab gains a
  ✏️ Rename action (display name only, via the existing `PATCH /models/:id`;
  files, kit assignments and step references untouched).
- **Three.js vendored (supply-chain hardening)** — the portal's 3D preview and
  browser GLB→USDZ converter no longer depend on unpkg at runtime:
  `npm run catalog:vendor` now also downloads Three.js r169 (core + GLTFLoader,
  USDZExporter, OrbitControls and their addon dependencies) into
  `sib/portal/vendor/three/`, and the portal's import map prefers the vendored
  copies, falling back to the CDN only when they're absent. Closes the last
  un-pinned third-party script on a page that holds an API key, and makes the
  converter work on networks that block CDNs.
- **Full site lock-down for internet-facing deployments** — with `SIB_API_KEY`
  set, EVERY surface now requires the key: home, portal, roadmap, wireframe,
  catalogue (+data/spec endpoints), Ask SIB, /stats, QR print pages. Browsers
  unlock once via a minimal public `/unlock` page (validates the key, sets a
  30-day HttpOnly cookie, pre-fills the portal's stored key); apps and APIs
  keep using the `X-API-Key` header. Only `/health`, `/unlock`, and a reduced
  `/config` (auth booleans only — `platformVersion` now requires auth) remain
  public. Internal deployments without the key are completely unchanged.
  Motivated by IP review: pre-filing material must not sit on public URLs.
- **Backup & restore** — the missing production-readiness piece: admin-gated
  `GET /admin/backup?scope=data|full` streams a timestamped `.tar.gz` of the
  data directory (data = JSON stores, small, weekly habit; full = evidence
  photos, world maps, 3D models too, before upgrades), with ⬇ buttons in the
  portal's ⚙ Settings behind the 🔒 Admin unlock. Restore is a documented
  stop → unpack → start procedure (INTERNAL-SERVER-DEPLOY.md) — deliberately
  not an endpoint. Verified by an automated drill: back up, restore into a
  fresh directory, boot, data intact. All /admin/* paths now require the
  admin key, and the home page gains a 🛠 Admin & Backups tile that deep-links
  to the portal's admin settings (/portal#admin) with the unlock prompt.
  Follow-up fixes from field testing: the Backups card now actually lives in
  ⚙ Settings (a bad insertion had landed it inside the anchor-card template),
  downloads show LIVE streamed progress ("42.3 MB received…") with locked
  buttons and inline success/failure status instead of a vanishing toast, and
  a new **🗒 Ops log** (Render-logs-style) records every admin-gated action —
  DELETEs, quiz admin, backups with size — as allowed/denied/gate-off with
  timestamp and IP, self-pruned to the newest 1,000, served by admin-gated
  `GET /admin/events` and viewable in Settings.
- **Guide Preview in the portal** — ▶ Preview on any Guide Library row walks
  the step sequence exactly as an operator would, no headset needed: a
  phone-frame modal with Complete ✓ / Failed ✗ / Skip traversal of the REAL
  branch graph (nextOnSuccess/nextOnFailure, requires-gate redirects shown
  explicitly), reference images, browser voice playback, reference links, and
  an exit summary listing steps never reached and failure branches never
  exercised. A placement banner ("N of M placed — operators can't run this
  yet") keeps content review honest about runnability. Client-side only.
- **Edit any guide in the Designer (round-trip)** — ✏️ Edit in Designer in the
  Guide Library opens the guide's procedure map, GENERATING one (named
  "[Guide] <name>") via a new reverse-compiler when none exists: steps become
  nodes, nextOnSuccess/nextOnFailure/precondition become Next/On-failure/
  Requires edges, voice/images/models/links carry over, and per-node provenance
  makes every re-sync an in-place update — AR placement always survives.
  Published-guide policy: content-only edits apply LIVE (operators just see
  better wording); structural edits require confirmation and unpublish until
  the new steps are placed. A stale flag warns when the guide changed
  elsewhere since the map last agreed with it. Designer supports
  /roadmap?map=<id> deep links.
- **In-AR assist UI (fix + redesign)** — AI hints were fetched and logged but
  drawn inside the content panel, which is hidden by default: invisible in the
  field. Assist is now its own overlay layer above the panel in every state —
  a glanceable ✨ chip that expands into a card with the hint, a Recovery-step
  button (nextOnFailure), and Replay voice. Stall-triggered hints auto-expand
  (the operator is stuck); retry hints stay collapsed. One hint at a time, soft
  haptic on arrival, 30 s per-step cooldown after dismissal, auto-clear on step
  completion, and a "Hints this session" tray so dismissed hints are
  recoverable. Server: AIHint gains an optional `trigger` (stall/retry) so the
  client knows why it fired — backward compatible.
- **Ask SIB** (beta) — a docs-grounded assistant: 💬 drawer on /catalog (and a
  home card) answering questions strictly from the Feature Catalogue and the
  dictionary, with cited features as permalink chips. Two tiers: retrieval
  (keyword-ranked sources + definitions — works on every deployment) and
  generation via any **OpenAI-compatible local model endpoint** — llama.cpp's
  llama-server or Ollama, chosen by `ASK_LLM_URL`/`ASK_LLM_MODEL` env vars, no
  code change. Public but rate-limited; grounding carries no site data; a down
  model degrades to retrieval with a note, never a hard failure.
- **Portal pilot-hardening**: (1) **Admin gate** — set `SIB_ADMIN_KEY` and every
  destructive action (all DELETEs, the LOTO quiz editor) requires unlocking
  🔒 Admin in the portal header; the server refuses without `X-Admin-Key`
  (the middleware is the guarantee, the hidden buttons are convenience), and
  deployments without the env var behave exactly as before. (2) **Filters +
  pagination** — Sessions, Gemba and AR Guides tabs gain free-text search,
  per-anchor and date-range filters, and show-more pagination (50 at a time),
  so review stays usable as pilot data grows. (3) **Tablet layout** — nav
  scrolls, tables scroll horizontally, bigger tap targets.
- **Home page live pulse** — `/` now shows anchors, sessions this week, open
  Gemba findings and **active LOTO locks right now** (red when any are held),
  fed by a new public `GET /stats` that returns aggregate counts only.
- **Catalogue durability + deep links** — `npm run catalog:vendor` downloads
  mermaid + marked into `sib/portal/vendor/` (loaded local-first, CDN
  fallback) so blocked CDNs can't blank the diagrams; `/catalog#feature-id`
  permalinks select the card on load (linkable from Slack/PRs/specs); the
  wireframe buttons deep-link to the right flow via `/wireframe#<flow>`.
- **Visual Feature Catalogue** (`/catalog`) — docs-as-data: `docs/catalog/`
  holds one YAML-frontmatter markdown file per feature (63 files, 7 area files
  with Mermaid flows, 3 role trails) as the canonical source;
  `GET /catalog/data` derives the full JSON graph from them live (also the
  future AI-grounding feed, with a reserved `?format=toon` seam) and
  `GET /catalog/doc/:id` serves each feature's deep-dive spec. The `/catalog`
  page renders it all as a connected graph — area clusters, shipped/beta/
  planned node styling, dependency edges, search, glossary hover definitions
  (glossary gained an iLOTO section), per-feature Mermaid flows, spec
  rendered in place, and three "start here" role trails for new team members.
  `npm run catalog:check` fails on any drift (dangling depends, unknown
  terms, missing specs) using the same rules as the endpoint;
  FEATURE-CATALOG.md is now explicitly a generated view of these files.
- **Portal — AR Guides import UX overhaul**: import from **Excel (.xlsx)**
  with a downloadable template (columns: Step, Title, Instruction, Voice,
  ImageURL, LinkURL, Optional, OnSuccess, OnFailure, Requires — header
  order-free), or JSON file, or pasted JSON. A parse **preview** (step count,
  media, branches, per-step warnings) gates the Import button; after import
  the portal jumps to the Guide Library, expands the new guide and flashes
  it — no more invisible imports. Guide Library gains an Import button, a
  live filter, and **⇄ Move to another anchor** (server moves the steps too,
  clears their placement — positions belong to the old anchor's world map —
  and unpublishes until re-placed).
- **SIB Home page** — GET / is now a landing with cards for the Web Portal,
  Roadmap & Procedure Designer, and the interactive App Wireframe (served at
  /wireframe), plus live server status and platform version.
- **iLOTO — up to 3 3D assets per point**: points now hold model SLOTS (e.g.
  lock + tag + hasp), each with its own device-owned AR placement; unadjusted
  slots fan out slightly to avoid overlap. Server enforces the cap and strips
  placement per-slot when that slot's model changes — other slots untouched.
  Legacy single-model points keep working (lifted into one synthetic slot).
- **Gemba Walk — minimized completion form**: arriving at a checkpoint now
  opens the completion sheet at a compact height with the AR view visible AND
  interactive behind it — drag up to expand. Dismissing no longer bounces it
  straight back open; it re-arms only after walking away (>1 m).
- **iLOTO — questionnaire editor + import**: the portal iLOTO tab gains a
  Training questions section — add/edit/delete questions inline (radio marks
  the correct answer), import from JSON or CSV (append or replace, validated
  ATOMICALLY server-side so a half-imported bank cannot exist), export JSON
  backup. New admin routes carry answers; the public quiz endpoint still
  strips them. Editing never touches issued certifications — future takers
  face the current bank.
- **iLOTO — model adjust gestures + reassignment**: drag / pinch / twist the
  3D lock model in AR (H/V pan modes, scale, Y-rotation — the AR Work
  Instructions gesture kit), saved as device-owned placement offsets on the
  point. Point detail gains a 3D model section for authors: assign, change or
  remove a model on EXISTING points; switching models resets placement
  server-side (a shape's placement dies with the shape), and "Adjust model in
  AR" jumps straight from the sheet into the gesture phase.
- **iLOTO — 3D lock/tag models on points**: assign a lock or tag model from
  the 3D Model library when placing a Safe Off / LOTO point; the marker then
  renders the USDZ model GHOST (translucent) while the point is clear — "a
  lock belongs here, this kind" — and SOLID the moment a lock is applied.
  Models upgrade in place as USDZs download; the ring stays as tap affordance
  and state colour. Uses the existing library end-to-end: upload in the
  portal, assign to the anchor kit or mark General.
- **iLOTO slice 4 — AR LOTO map**: draw the panel's electricity flow in AR by
  tapping vertices along the conduit; starting a line on a Safe Off marker
  links it to that breaker, making the map STATUS-AWARE — lock out the breaker
  and its lines turn grey and pulse-free live, restore it and the teal flow
  pulse returns. Versioned saves (history kept), view/edit/delete home screen.
- **iLOTO fix — QR-gated AR sessions**: every iLOTO AR surface (point
  authoring, status walk, map drawing) now starts with the mandatory panel-QR
  scan, exactly like AR Work Instructions: QR locks the session origin,
  ARWorldMap relocalizes (local → SIB → fresh), and the live session is
  adopted without a frame reset — positions consistent across devices and
  sessions. Found in field testing: slice 2 sessions skipped the gate.
- **Portal iLOTO tab** — EHS review surface: live status board for every
  control panel (per-point state, owner, serial), audit trail with override
  events pinned first and evidence photos in the lightbox, certification
  registry (valid / expired / failed), and one-click CSV export of events and
  certifications. Read-only by design.
- **iLOTO slice 3** — the gate opens: training quiz UI (one question at a
  time, server-graded, failed attempts reviewed with the correct answer and
  explanation — the explanations ARE the training), certification issuance
  live with expiry; My LOTO view — every lock the user holds across all
  panels with a one-tap deep-link into the Remove flow; hub My LOTO tile
  turns red with a live count when any locks are held (the shift-end nudge).
- **iLOTO slice 2** — the working loop: AR point authoring (tap breakers/
  switches to place yellow/red markers; panel ARWorldMap saved on author exit
  so every later session relocalizes), ordered Apply checklists (notify →
  shutdown → lock → photo → try test → serial) and Remove checklists with the
  supervisor-override form behind an explicit second decision, Check Status as
  list + AR walk (solid = locked, hollow = clear), and a point-detail sheet
  with the append-only event history and evidence photos. Server 4xx messages
  surface verbatim — the client makes the right path easy; the server stays
  the referee.
- **iLOTO slice 1** — spatial Lockout/Tagout foundation
  ([docs/ILOTO.md](docs/ILOTO.md)): 'LOTO' anchor type (one anchor per control
  panel, full QR + worldmap flow), authored isolation points (yellow Safe Off
  on breakers / red LOTO on switches), **append-only event log** with
  server-enforced rules — per-kind checklists incl. the mandatory try test,
  photo evidence on apply, one-lock-one-person removal, OSHA-exception
  supervisor override as a distinct event type — derived status endpoints
  (panel banner + cross-anchor My LOTO), seeded 16-question OSHA 1910.147
  training bank with server-side grading and expiring certifications, and the
  iOS iLOTO hub (status banner, six tiles, live certification gate). Apply/
  Remove flows, AR authoring, quiz UI and the AR LOTO map follow in slices 2–4.
- **Preview mode** — ▶ Preview in the procedure bar walks the procedure as the
  operator will experience it: phone-frame step card (title, instruction,
  reference image, voice playback via browser speech synthesis),
  Complete ✓ / Failed ✗ buttons that traverse the real edge graph, canvas
  highlight of the current step, requires-gate redirects, and an exit summary
  listing branches never exercised. Purely client-side; nothing is saved or sent.
- Reference link per step — any http(s) URL (video, PDF, SOP page) authored in
  the Inspector, carried through compile → export → ingest, and shown as a
  tappable "Reference" button on the iOS AR step panel (opens in Safari; the
  platform stores no copy).
- Auto-sizing nodes — cards wrap titles up to four lines and grow to fit
  instead of truncating at 20 characters; edge anchors, minimap, marquee,
  auto-layout, presentation bounds and SVG export all follow the real height.
- Edge type switcher — select a connection on a procedure map and change
  Next / On failure / Requires in the side panel (no more delete-and-redraw).
- Canvas legend + role explainer — line swatches in the procedure bar census
  and a ? panel explaining paths (Next / On failure) vs rules (Requires);
  RolePicker copy rewritten in operator language, Enter confirms Next.
- Step content glyphs (voice / image / model) enlarged onto a white pill so
  they stay legible on the night canvas.
- Procedure Designer slice 2 — step content authoring on the canvas: voice
  script, optional-step toggle, reference images (uploaded to a content-addressed
  designer store, copied into the guide at export) and 3D model assignment with
  scale. Model semantics: canvas owns assignment, device owns AR placement;
  switching models clears stale placement.
- Day/night canvas theme — procedure maps default to a dark canvas so an
  executable procedure is visually distinct from a planning roadmap; toggle in
  the toolbar, per-map-kind preference. Node cards stay white in both themes so
  nothing inside them can lose contrast.
- **Procedure Designer** — `procedure` maps on the Roadmap canvas: role-typed
  edges (Next / On failure / Requires) with a relationship picker, server-derived
  step numbers, pre-flight validation, and one-click send to the Guide Library as
  a draft. Re-sync updates steps in place and never overwrites AR placement.
  ([docs/PROCEDURE-DESIGNER.md](docs/PROCEDURE-DESIGNER.md))
- Guide ingestion service (`sib/src/guides/ingest.ts`) — single create/upsert
  path shared by JSON import and procedure export, with spatial preservation as
  a tested invariant.
- `step:stalled` live-session event + iOS dwell watchdog (90 s) feeding the AI
  guide adapter, alongside the existing retry trigger.
- Guide Library ⬡ Graph: link census header (steps / success / failure /
  precondition / lanes) and a purely-sequential-guide notice.
- Feature catalog ([docs/FEATURE-CATALOG.md](docs/FEATURE-CATALOG.md)),
  versioning standard ([docs/VERSIONING.md](docs/VERSIONING.md)), and
  `PLATFORM_VERSION` surfaced at `/config` and in the portal header.
- Operator FTUE for AR Guide sessions + always-available ? help.

### Changed
- `POST /guides/import` now routes through the shared ingestion service
  (behaviour pinned by tests before the refactor).
- AI hints: stale hints are discarded at poll time and auto-dismissed when their
  step completes.
- Guide Library graph lane algorithm rewritten: failure branches get their own
  lanes; forks are detected against the success target rather than sequence
  position, so adjacent-detour procedures render correctly.

### Fixed
- Notes and voice-script edits silently lost when clicking from the field
  straight onto the canvas — the panel unmounted before blur fired, so the
  save-on-blur handler never ran (reported as "can't save notes unless we add
  a comment"). Fields now commit on blur AND on unmount, with a Saved ✓ tick.
- Blank page when creating the first node on any map — React #310 caused by a
  hook after an early return in `Minimap.tsx` (pre-existing; exposed during
  Procedure Designer testing).
- `sanitizeEdge` / `saveMindmap` silently dropping new fields (`role`, `kind`,
  `anchorId`) on save.
