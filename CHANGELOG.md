# Changelog

One section per platform version (see [docs/VERSIONING.md](docs/VERSIONING.md)),
newest first. Written in the same PR as the change — if a teammate would notice
it, it gets a line.

## 2026.4.42 — 2026-08-11

### Added
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
