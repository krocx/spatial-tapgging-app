# Backlog - AROMS keys

Proprietary & Confidential · Applied Materials. The one list of work on the
Connected Worker AR OMS programme, in the form Jira will keep.

## The scheme

One key series, `AROMS-<n>`, never reused, in three bands:

| Band | What | Source of truth | Who edits |
|---|---|---|---|
| AROMS-1 … 99 | The June 2026 Jira import (server phases, WebXR, RayNeo, iOS tracks) | Jira | closed out per §3; nothing new here |
| AROMS-100 … 299 | **Capability register**: one key per feature in `docs/catalog/` (status and version are the catalogue's) | `docs/catalog/*.md` + `docs/jira/keys.json` | the catalogue; the key map grows by itself |
| AROMS-300 … | **Work items**: what is being built, by whom, shipped in which version | this file, §2 | the Product Owner (and whoever owns the item) |

Rules that keep it honest:

- Our key is ours, not Jira's. In Jira it is the Summary prefix and a label
  (`AROMS-305 · …`); Jira issues its own key, which goes in the `Jira`
  column here (and `docs/jira/keys.json` for capabilities) after the first
  import, so Friday deltas update the same ticket. Jira also holds programme
  and management tickets that never appear here.
- A key is assigned once and never renumbered. Scope moves between
  components by editing the component, not the key.
- Every commit message and every changelog entry quotes the key(s) it
  serves (`AROMS-304: …`), so `git log --grep AROMS-304` finds the work.
- Status is one of `todo` · `doing` · `done` · `parked` · `wont`. `done`
  carries the version it shipped in. `parked` needs a reason in Notes.
- Owner is one of `PO` · `AR Dev` · `DevOps` · `GIS` · `Team`.
- Component is one or more of `server` · `portal` · `designer` · `xr-kit`
  · `ios` · `unity` · `devops` · `research` · `programme`.
- Jira shape: one Epic per area (`Platform`, `AR OMS guides`, `Spatial
  tagging and inspection`, `Roadmap and Procedure Designer`, `Portal`,
  `Gemba Walks`, `iLOTO`, `SIB server`, `XR kit`, `iOS app`, `Unity
  client`, `DevOps and hosting`, `Research`, `Programme`); capabilities are
  Stories, work items are Tasks; Fix Version is the SIB version.
- Friday ritual: `npm run backlog:jira -- --since <last Friday>` writes
  `docs/jira/AROMS-delta-…csv` with the week's new and changed rows; upload
  it in Jira ("update existing issues" once Jira keys are recorded). The
  full export (`npm run backlog:jira`) rebuilds everything from 100 up.
- Versions: `2026.4.NN` as today; a work item is `done` the day it is
  committed and carries the version it will ship in. Capabilities take the
  catalogue's status (`shipped` → Done, `beta` → In Progress, `planned` → To
  Do).

## 2. Work items (AROMS-300 …)

Newest at the bottom. `Updated` is the date the row last changed.

| Key | Item | Component | Owner | Status | Version | Updated | Jira | Notes |
|---|---|---|---|---|---|---|---|---|
| AROMS-300 | Guide lifecycle: archive, 30-day trash with restore, role gates, publish needs Manager + configuration (server + portal) | server, portal | PO | done | 2026.4.50 | 2026-10-14 | | docs/GUIDE-LIFECYCLE-REVIEW.md |
| AROMS-301 | Import de-duplication: update the existing guide or create a new one; Cortona job waits for the choice | server, portal | PO | done | 2026.4.50 | 2026-10-14 | | |
| AROMS-302 | Content Library → Designer lands in the map (shared API key, opening state, tab at click time) | portal, designer | PO | done | 2026.4.50 | 2026-10-14 | | |
| AROMS-303 | Designer sections for long procedures: one band per section, wrap every 10, Outline panel, rename | server, designer | PO | done | 2026.4.50 | 2026-10-15 | | |
| AROMS-304 | Publish greyed with the reason in the library (no configuration, role below Manager, archived) | portal | PO | done | 2026.4.50 | 2026-10-14 | | |
| AROMS-305 | Step parts survive a model rebuild: resolver by objectID / part number / display name, model-check, rebind-parts, library action, XR alias | server, portal, xr-kit | PO | done | 2026.4.50 | 2026-10-15 | | |
| AROMS-306 | One 3D workflow: shared state engine (xr-engine.js) and GLB reader (assembly-model.js); Studio "Open as operator" and "Fit and defaults…" | designer, xr-kit, portal | PO | done | 2026.4.50 | 2026-10-15 | | |
| AROMS-307 | Cortona import: unreferenced sub-steps at their place in the animation order | server | PO | done | 2026.4.50 | 2026-10-15 | | re-import with Update to refresh older guides |
| AROMS-308 | XR kit: hand tracking and virtual hands chosen on the gate, remembered per browser | xr-kit | PO | done | 2026.4.50 | 2026-10-15 | | |
| AROMS-309 | Roadmap home cards: anchor, configuration, guide date and state; missing guide flagged | designer | PO | done | 2026.4.50 | 2026-10-14 | | |
| AROMS-310 | Ask SIB above the Compass on Roadmap pages | portal | PO | done | 2026.4.50 | 2026-10-14 | | |
| AROMS-311 | iOS lifecycle half: swipe-delete Owner only, Archive swipe for Managers, archived filtered from lists, the server's publish-gate sentence shown as is | ios | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-312 | Admin role for sessions management (data stewardship apart from product ownership) | server, portal | PO | parked | | 2026-10-14 | | revisit with more users; one line per route when wanted |
| AROMS-313 | Remote assist: LiveKit self-hosted under a SIB layer (Remote View page, token route, iOS camera + audio, XR audio + scene; Teams deep link as escape hatch) | server, portal, ios, xr-kit, devops | PO → AR Dev, DevOps | parked | | 2026-10-15 | | needs approval before any code; GIS firewall (UDP / TURN 443) is the critical path |
| AROMS-314 | AR on-the-job training mode: demo mode with real spatial validation | ios | PO | todo | | 2026-10-14 | | scope to review |
| AROMS-315 | Meta Oakley Vanguard camera photo for validation steps (Wearables Device Access Toolkit) | ios, research | AR Dev | todo | | 2026-10-14 | | |
| AROMS-316 | XR kit hands on hardware: Quest 3 with cleanroom gloves (scorecard), Vision Pro joint access, gesture thresholds | xr-kit, research | AR Dev | todo | | 2026-10-14 | | |
| AROMS-317 | Play the chamber: ME and Lead card wording after team feedback; station durations tuned on the wall | portal | Team | todo | | 2026-10-14 | | |
| AROMS-318 | Device pictures with credits in /devices-media; Ask SIB model tier when ASK_LLM_URL exists | portal, server | PO | todo | | 2026-10-14 | | |
| AROMS-319 | Deploy hygiene: SIB_WEB_LOCK on Render, IP key rotation, API key rotation (iOS ServerPreset + rebuild) | devops | PO → DevOps | todo | | 2026-10-14 | | keys never in the repo |
| AROMS-320 | Production-grade SIB: releases, automated backups, monitoring on /health, SSO, database and object storage decision, CI/CD POC → pilot (FY27 DevOps row; absorbs June T1-21..24, T2-9) | devops, server | DevOps | todo | | 2026-10-16 | | |
| AROMS-321 | Enterprise cloud / in-house hosting with GIS: IT review, TLS, identity (June T-3) | devops | DevOps, GIS | todo | | 2026-10-16 | | |
| AROMS-322 | iOS accessibility: VoiceOver and Dynamic Type (June T6-23) | ios | PO | todo | | 2026-10-16 | | low |
| AROMS-323 | FY27 use-cases 2 and 3 identified with WMO; TAM / SAM per component (June T-8) | programme | PO | todo | | 2026-10-16 | | |
| AROMS-324 | Unity client reading the Guide Bundle; passthrough camera on Quest 3 (FY27 AR Dev row) | unity, research | AR Dev | todo | | 2026-10-16 | | |
| AROMS-325 | Designer: Cortona section headings carry their own index ("1. 1."), stripped in sections; importer could carry `section` explicitly | server | PO | todo | | 2026-10-16 | | nice to have |
| AROMS-326 | Anchor Lab rigs (anchorType LAB) hidden from the Guide Library and from the Move / Copy chamber pickers | portal | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-327 | Portal dialogs on the design system: axAlert / axConfirm / axPrompt / axChoose / axForm replace every browser box (54 sites: Guide Library, chambers and tags, configurations, models, admin, Gemba, iLOTO, exports, catalogue IP key). Validation is inline or a toast, failures are toasts, destructive actions carry a red button and the consequence in words, choices are named buttons | portal | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik; reopen if a dialog misbehaves |
| AROMS-328 | Model check counts hose animation frames as present (they are playback nodes, not parts) and reports them in words | server, portal | PO | done | 2026.4.50 | 2026-10-16 | | |
| AROMS-329 | Designer: resizable property pane (Inspector, 240-560 px) and Studio parts panel (380-720 px); drag edge, double-click resets, remembered per browser | designer | PO | done | 2026.4.50 | 2026-10-16 | | user request |
| AROMS-330 | iOS: step navigator in AR OMS (and AR OJT): tap the progress ring for a list of every step with done / current / started / not yet, validation and evidence state; jumping is navigation only, completion stays with the step; a later step is locked ("After step N") while an earlier mandatory step is undone, optional steps can be passed over; Designer inspector gains "Requires first" for non-adjacent rules | ios, designer | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-331 | Validation mode authored per step (Quick shot / Cone): `validationPlan` set in the Designer inspector and toggled in the Guide Library (done), shown on the iOS step page (segmented Cone / Quick shot) and offered first in the AR tray's single Train / Trained chip; Retrain is explicit | server, portal, designer, ios | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-332 | OCR as part of Spatial Inspection: readings from instrument displays (multimeter, torque, leak check), labels, engraved part numbers and codes as assertions on a step or tag - spec docs/SPATIAL-READINGS.md; delivered as AROMS-337 to 342 | ios, server, portal | PO | doing | | 2026-10-16 | | scoped and agreed; build order in the spec |
| AROMS-333 | iOS Author mode: step tray chips readable (11 pt, two lines, 96 pt wide), action bar titles two lines; AR session top bar adapts to iPhone (guide name on its own line, iPad inline) | ios | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-334 | iOS: "Wrong QR" on a guide created in the app until restart - the Guide editor's Place Steps / Place assembly gates now set the active anchor to the guide's chamber before scanning | ios | PO | done | 2026.4.50 | 2026-10-17 | | confirmed by Karthik |
| AROMS-335 | Guide Library lists every QR chamber, with or without guides; an empty chamber card offers Import a guide (chamber preselected), the Designer, and Assign a configuration; a chamber created from the library appears at once | portal | PO | done | 2026.4.50 | 2026-10-16 | | Karthik to confirm |
| AROMS-336 | Danger zone behind its own key: SIB_DANGER_KEY (server, Render); the four wipe routes refuse without it or when it is unset; the portal asks for it on every use and never stores it; deploy doc updated | server, portal, devops | PO | done | 2026.4.50 | 2026-10-16 | | Karthik sets the key on both servers |
| AROMS-337 | Readings, data model and authoring: `assertions` on GuideStep and Tag; Designer step inspector and iOS step page author text-value and text-match (value, unit, tolerance, match, block / flag); server, compiler, import and re-sync carry them; Guide Library shows "Reads: …" | server, portal, designer, ios | PO | done | 2026.4.50 | 2026-10-16 | | web now; iOS step page in the next app build |
| AROMS-338 | Readings, iOS capture: Vision text recognition on a framed display or label, numeric parse with unit, on-frame highlight, verdict in words, block / flag, evidence frame with the read, typed fallback marked "typed, not read"; usage log and run record per assertion | ios, server | PO | doing | 2026.4.50 | 2026-10-16 | | in the next app build; needs a multimeter in hand to confirm |
| AROMS-339 | Labels as assertions: languageCheck tags on the same shape (no behaviour change), location from the trained region, engraved part numbers | ios, server | PO | todo | | 2026-10-16 | | |
| AROMS-340 | Code assertions: barcode / QR / Data Matrix (Luna labels) | ios, server | PO | todo | | 2026-10-16 | | |
| AROMS-341 | Import intelligence: recognise reading, label and part-number steps in iOMS / publication text and pre-fill the assertion for the ME to confirm | server, portal | PO | todo | | 2026-10-16 | | after 337 and 338 |
| AROMS-342 | Instrument cases: digital torque displays, leak-check readouts (scientific notation, multi-line), reading stability across frames | ios, research | PO, AR Dev | todo | | 2026-10-16 | | |
## 3. June 2026 import (AROMS-1 … 99): close-out

Mark in Jira, do not re-import. Where an item is superseded, the key above
is the place the work continues.

| June id | Item | Decision |
|---|---|---|
| T1-5 | Phase 4 distribution prep | Done - the team runs on the company server and Render |
| T1-20 | Per-device auth (JWT) | Done, superseded: UAM roles + device link codes |
| T1-21, T1-22 | PostgreSQL, object storage | Won't do for the POC; decision folded into AROMS-320 |
| T1-23, T1-24 | Monitoring, automated backups | Open under AROMS-320 (DevOps) |
| T2-6 | Team smoke testing on Render | Done |
| T2-7, T2-8, T2-10 | Pre-migration export, in-house server, client cut-over | Done - company server (nssm) in use, iOS presets carry both |
| T2-9 | Reverse proxy + TLS in-house | Open under AROMS-320 / AROMS-321 |
| T2-11 | Decommission Render | Won't do - Render stays the external POC |
| T-3 | Enterprise cloud migration | Open as AROMS-321 |
| T6-23 | Accessibility | Open as AROMS-322 |
| T6-24 | Duplicate QR-scan-and-lock screens | Done - front door and guide gate rework (2026-10) |
| T6-25 | Intermittent re-capture validation failures | Done, superseded: cone validation (V1) |
| T-7 | Steering committee communication | Done - FY27 resource request presented 2026-10-14 |
| T-8 | FY27 use-cases | Open as AROMS-323 |
