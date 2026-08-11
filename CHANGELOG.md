# Changelog

One section per platform version (see [docs/VERSIONING.md](docs/VERSIONING.md)),
newest first. Written in the same PR as the change — if a teammate would notice
it, it gets a line.

## 2026.4.42 — 2026-08-11

### Added
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
- Blank page when creating the first node on any map — React #310 caused by a
  hook after an early return in `Minimap.tsx` (pre-existing; exposed during
  Procedure Designer testing).
- `sanitizeEdge` / `saveMindmap` silently dropping new fields (`role`, `kind`,
  `anchorId`) on save.
