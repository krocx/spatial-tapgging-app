# Changelog

One section per platform version (see [docs/VERSIONING.md](docs/VERSIONING.md)),
newest first. Written in the same PR as the change — if a teammate would notice
it, it gets a line.

## 2026.4.45 — 2026-09-01

### Added
- **Step validation via Spatial Inspection (K4)** — a guide step can now
  demand a validation verdict before it completes. The Author trains it
  in-app (capture a reference photo → Verify with a live test compare →
  publish with the guide; Retrain/Remove any time); the reference is scored
  by the SAME comparator engine tag inspection uses (coarse registration +
  SSIM/patch-grid) via new step-scoped endpoints
  (`PUT/DELETE /guides/:id/steps/:stepId/validation-ref`,
  `POST …/validate`; `validationTrainedAt` is server-stamped). At run time
  a trained step asks the Operator for a photo and returns a system PASS
  (auto-completes, score shown) or FAIL (Retry / take the recovery branch);
  an untrained-but-required step falls back to explicit manual Pass/Fail.
  Every verdict — system score or manual choice — rides the live stream as
  `perception:result` and lands on the step's usage-log entry.
- **Evidence-required steps (K5)** — Authors can mark a step "Require
  evidence photo" (App editor toggle + Designer inspector checkbox, carried
  through the procedure compiler and reverse-compiler round-trip). Operators
  cannot complete such a step until a photo is attached — the camera opens
  with a notice instead. Closes the parked post-pilot P1.
- **Production-verified resume (K3)** — an interrupted guide run belongs to
  its Production #: resume snapshots are stamped with the shift's work
  context, and picking one up on the SAME Production # works as before.
  A snapshot from a different Production # gets an explicit prompt —
  "Switch & Resume" (moves the shift to that #) or "Start fresh on the
  current #" — so work is never silently logged against the wrong system.
  Pre-K3 (unstamped) snapshots keep resuming normally.
- **AR OMS Usage Log (K2)** — a durable, per-step usage record for every
  guide run, derived server-side from the live-session event stream: step
  enter/exit times, duration (operator-measured when available), outcome
  (completed / failed / left), session totals, operator identity (token-
  verified kiosk sign-in wins over client-typed fields) and the shift's
  **work context** — labelled Production # in AR OMS; other products relabel
  it (GembaWalk: audit/project name). Survives restarts, unlike the
  intentionally-ephemeral live session. `GET /guide-sessions/usage`
  (?workContext= / ?guideId=) serves it; the portal's AR Guides tab gains a
  📊 Usage Log toggle grouped by Production # with expandable per-step
  timing tables. iOS sends workContext + identity when opening a live
  session. Offline sign-offs finalise the record at link time even when the
  submit event never arrived. 3 new tests (159 total).
- **Kiosk shift start (K1)** — the iPad now opens on a shift screen when the
  allow-list is active: the technician enters ONLY their employee ID (the
  server resolves name/email/role — `POST /uam/login` gained an
  employee-ID-only kiosk path; the email+ID Settings path is unchanged) plus
  the **Production #** (chamber/system) they'll work on. Both persist for
  the shift and show in a home-screen chip — tap it to change the Production
  # or switch technician between shifts. A 401 on the launch refresh
  (revoked access) reopens the gate. The gate is deterministic: it renders
  immediately whenever no shift is set and owns the server connection itself
  (connecting state, cold-start retries, Retry button, dormant-UAM
  auto-skip) — it never waits on a network probe to appear. Known pre-SSO
  trade-off, approved:
  employee ID alone authenticates on kiosk iPads until HYPR SSO lands; the
  allow-list remains the gate and the SSO swap point is unchanged.
- **Canvas: precise connections, new shapes, self-loops** — edges now attach
  to the actual shape OUTLINE (diamonds/hexagons no longer show gaps where
  the old math hit the invisible bounding box), and every node gains four
  anchor ports (top/right/bottom/left, shown on hover): drag from a port to
  pin the edge's start, drop on a port to pin its end — pinned ends stay put
  as nodes move, unpinned ends keep auto-adjusting. Curves leave pinned
  ports perpendicular to the side. Three new shapes: circle, parallelogram
  (flowchart input/output), cylinder (data/store). Self-connections are
  allowed (one loop per node), drawn as an arc leaving one port and
  re-entering another. Curved is now the DEFAULT connector style — existing
  maps flip once; picking Straight now persists explicitly. One geometry
  source (insideShape/shapePathD) drives the canvas, edge attachment and
  the SVG export, so they cannot drift. 2 new server tests (155 total).
- **Solid-fill nodes** — designer cards are now solid-filled in a darkened
  layer palette (`NODE_FILL_COLORS`, tuned so white text passes WCAG AA on
  every fill) with white labels and white/near-white ornaments; the left
  color bar is gone — the fill IS the layer color. Selection and preview
  states became a light glow ring (a colored stroke vanishes on a colored
  fill); status dots keep a white ring, review verdicts sit on a white chip,
  the milestone diamond is ringed in the card fill, and the inline editor
  uses a dark scrim so editing never flashes white. SVG export matches.
  New doctrine (colors.ts): every future in-card ornament is designed
  against the dark fills — the white-card rule is retired.
- **Roadmap home redesign (S5)** — the map list is now a proper front door:
  a night-sky hero ("What will you build today?") with two glowing door
  cards — 🗺 Roadmap (gold) and 🧩 Procedure (teal), matching the canvas
  edge-role palette — that open an inline name field and create in place.
  Maps became a card gallery with kind badges (list API now returns `kind`),
  node/edge counts, relative updated time and the draft 🔒 badge. Import
  JSON / whiteboard photo / unlock-draft moved into a ⋯ menu; display name
  and API key live in a corner 👤 chip. All previous behaviour is preserved —
  only the arrangement changed.
- **Designer: issues drawer + autosaving node text (S5)** — the pre-flight
  warnings list no longer stacks inline: a count chip in the census row
  toggles a scrollable drawer grouped into "Blocking — fix before sending"
  and "Warnings — sending still allowed", so 20+ findings stay usable.
  Node text now autosaves while typing (500 ms debounce) and on blur —
  Enter is no longer required, and Escape simply closes the editor since
  nothing can be lost.
- **iOS RBAC (S4, beta)** — the app joins UAM. Settings → Identity gains
  Work Email + Employee ID and a "Verify Access" button: both must match the
  allow-list record; success caches the token + role (shown as a badge) and
  every request now carries X-User-Token, so per-user guide sharing and role
  enforcement apply on device. Technicians see operator surfaces only —
  Author Mode and the Continue-last-session card are hidden (and refused
  server-side regardless). On launch the app silently re-verifies: role
  changes propagate, revocation (401) clears the session, and offline keeps
  the cached role working. Transition note: a device that never verifies
  remains an unidentified legacy caller until the pilot enforces
  identified-only access.
- **Per-user guide sharing (S3, beta)** — guides can be shared with specific
  technicians. `Guide.sharedWith` holds allow-list emails (validated on
  write; unknown addresses are refused); the Guide Library gains a 👥 Share
  dialog listing technicians from UAM (new Engineer-readable
  `GET /uam/technicians`), with a share-count badge on the card. One
  visibility predicate gates the guide list, the single-guide read AND the
  steps read — excluded technicians get 404, never confirmation. Empty/no
  list = visible to all technicians (existing guides unchanged); Engineer+
  always see everything; only Engineer+ may edit sharing. Verified live:
  share/normalize/unknown-email-400, per-role list contents, deep-link 404s,
  clear-to-everyone. 4 new unit tests.
- **UAM — User Access Management, S1 server core (beta)** — RBAC ahead of
  corporate SSO. A manually managed allow-list (email + employee ID + role)
  gates sign-in: `POST /uam/login` rejects anyone not in the table and issues
  a 7-day HMAC token (cookie for the portal, header for iOS). Four roles —
  Owner, Manager, Engineer, Technician — with server-enforced rules: Managers
  manage everyone except Owner records and can never grant Owner; the last
  Owner can be neither demoted nor removed. Tokens carry identity only; the
  role is re-read per request, so changes and removals take effect
  immediately. Owners/Managers now pass the destructive-action gate by role
  (legacy admin key still honoured — and acts as Owner for bootstrap: unlock
  admin, add yourself, roles take over). All logins and user-table changes
  land in the ops log. SSO swap point: token issuing only. 5 new unit tests
  + a 14-step live authorization matrix.
  S2 — portal surface: with users in the list (`/config.uamActive`), the
  portal shows an email sign-in before anything loads; the header gains an
  identity chip (name · role) with Sign out; the Admin page gains the 👥
  User Access Management table (add / edit role / remove, with server-refused
  changes snapping back); only Owners/Managers see the Admin tab, and their
  session lifts the destructive-UI lock by role — no shared admin key needed
  day-to-day. Empty list = login off (bootstrap unchanged).
  Field fix from first deploy: on servers WITHOUT SIB_ADMIN_KEY, the gate-off
  fallback made every caller admin-equivalent, so the sign-in screen never
  appeared and anonymous callers could act destructively once users existed.
  The fallback now applies only while the allow-list is EMPTY — the moment
  users exist, management and destructive actions require an Owner/Manager
  sign-in (or the configured admin key), and the portal always shows the
  sign-in screen when UAM is active.
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
  `step:failed` added to the shared event union. Follow-up from testing with
  a real branching guide: (7) sign-off no longer demands completion of
  required steps on paths never taken (branch skips made it unreachable);
  (8) sequential auto-advance skips failure-only steps, so the happy-path
  terminal no longer walks into "Tag Out of Service"; (9) sign-off is
  offered on ANY terminal step — the happy end and failure dead-ends alike.
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
## 2026.4.42 — 2026-08-11

### Added
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
