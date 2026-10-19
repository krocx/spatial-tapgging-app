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
| AROMS-339 | Labels as assertions: languageCheck tags on the same shape (no behaviour change), location from the trained region, engraved part numbers | ios, server | PO | doing | 2026.4.50 | 2026-10-16 | | in the next app build; test with a label on the chamber |
| AROMS-340 | Barcode checks (kind `code` on the wire): the reading sheet decodes 1D (Code 128/39, EAN, UPC, ITF-14), QR, Data Matrix, PDF417 and Aztec on the same frame as the text and judges the check on the payload; several codes in frame are listed by kind; nothing decoded falls back to the printed digits, said as such; training chips show the decoded codes by symbology; "Code" renamed "Barcode" everywhere people read it (step page, Designer, library chip, verdicts) | ios, server, designer, portal | PO | done | 2026.4.50 | 2026-10-19 | | confirmed on device by Karthik 2026-10-19; symbology not yet in the run record |
| AROMS-341 | Import intelligence: recognise reading, label and part-number steps in iOMS / publication text and pre-fill the assertion for the ME to confirm | server, portal | PO | todo | | 2026-10-16 | | after 337 and 338 |
| AROMS-342 | Instrument displays: a reading is sampled over three frames and the recurring value kept, a display still settling said so with the values seen (median used); scientific notation as leak checkers print it (superscripts, ×10⁻⁹, x10^-9, E -09) folded on both ends; mantissa and exponent on separate lines joined; recognition and judging lifted into ReadingEngine (no UI) | ios, server | PO | done | 2026.4.50 | 2026-10-19 | | cleanroom test 2026-10-20: torque display, leak checker; thresholds (0.5 % agreement, 350 ms spacing) to tune on real displays |
| AROMS-343 | iOS: onChange(of:perform:) deprecation (iOS 17) - all 53 sites moved to the two-parameter or zero-parameter form; clean build log for TestFlight | ios | PO | done | 2026.4.50 | 2026-10-16 | | Karthik to confirm the build |
| AROMS-344 | iOS build warnings before TestFlight: UIScreen.main → the scene view's bounds (5), unused values, trailing-closure form, project-level MARKETING_VERSION so the widget's CFBundleShortVersionString matches, App Store icon without alpha, loose icon variants moved out of the icon set | ios | PO | done | 2026.4.50 | 2026-10-16 | | the two hitTest(_:types:) deprecations stay (AROMS-345) |
| AROMS-345 | iOS: ARSCNView.hitTest(_:types:) (deprecated iOS 14) → raycastQuery in AuthorModeView and LocTagAuthorView; needs a placement regression test on device | ios | PO | todo | | 2026-10-16 | | behaviour change risk - not before a TestFlight build |
| AROMS-346 | Author journey for readings and labels (UX review): position as a switch on the Text check, one status line on the step page, one Train chip and sheet in Place Steps with the label reading chained after presence training, untrained position flagged not blocking for operators, library chip says "position needs training" | ios, designer, portal | PO | done | 2026.4.50 | 2026-10-16 | | spec §8; Karthik to confirm on device |
| AROMS-347 | Market research: GridRaster SPIDER - overlap with SIB, gaps, competitors, reliability; verdict: no investment, no platform collaboration (data posture); docs/research/GRIDRASTER-2026-10.md | research, programme | PO | done | | 2026-10-19 | | VisionLib was evaluated in FY25 and found unsuitable for wearables - not to be re-proposed |
| AROMS-348 | GridRaster technical briefing (no data shared): markerless CAD registration, full-fidelity streaming, Vision Pro demo, their view of WebXR and display-only glasses; learnings into the research note; actions decided after | research, programme | PO | todo | | 2026-10-19 | | next steps depend on the briefing |
| AROMS-349 | Text checks mean "must say", not "says only": default match is contains (per line and whole frame, case/space-folded), verdict words say found / not on it; a blank Text check cannot strand the operator (dropped on save on the iPad as SIB already does; legacy blank → flagged "No expected text - skipped") | ios, server, designer | PO | done | 2026.4.50 | 2026-10-19 | | found on device with a PIXMA box: exact never passed; spec §8 |
| AROMS-350 | Training captures the words: in Place Steps in AR the label reading shows the recognised lines as chips; tapping one sets the expectation and the trained position; a typed expectation pre-selects the chip the camera actually read so the author sees OCR's spelling; "Read the label to set the words" offered for text-only checks, blank words chained after presence training like an untrained position | ios | PO | done | 2026.4.50 | 2026-10-19 | | confirmed on device by Karthik 2026-10-19 (chip pre-selection on a substring; Try it after Save reads the new words) |
| AROMS-351 | "Try it as the operator" on any step's Train chip in Place Steps: presence scored from where the author stands with the operator's rule (PresenceScorer - feature print ∨ server SSIM, PASS ≥ 0.60) and said in a toast, then the label checks in the operator's own sheet on trial; nothing recorded - no save / publish / mode switch to re-check a step trained earlier | ios | PO | done | 2026.4.50 | 2026-10-19 | | confirmed on device by Karthik 2026-10-19; full-guide preview stays the Operator mode; ARGuideSessionView / OperatorModeView still carry their own copies of the rule - fold into PresenceScorer behind a device regression test |
| AROMS-352 | One validation on the floor, not two: when presence validates, read the label on that same frame silently; both pass in one go when the text is found, else the reading sheet opens with "come closer to the label"; needs field data on how far the cone fires from a legible label | ios | PO | done | 2026.4.50 | 2026-10-19 | | cleanroom test 2026-10-20: how far the cone fires from a legible label |
| AROMS-353 | Reads in the Usage Log: a "Reads" column on every step visit (reading, label, barcode chips, the same as the Completion Log) so a test run that never completes still shows what the camera read; scientific notation printed as 1.2 × 10⁻⁹. Found with it: a false pass - SIB derived the bounds of "1.0 × 10⁻¹²" as 1.0 (notation not folded) and the display's "1 × ⁻¹²" (the 10 lost) parsed as 1; both ends now fold the notation, bounds are re-derived from the wording on every save, and the settling verdict lists the raw texts | server, portal, ios | PO | done | 2026.4.50 | 2026-10-19 | | re-save the leak-check step once so its bounds are re-derived (any edit on the step page or in the Designer) |
| AROMS-354 | Readings in Intelligence and Insights (proposal, needs Karthik's go): per step - first-time-right rate, typed-instead rate, and the measured values over runs (min · median · max with unit, sparkline) as a new heat signal "reads failed" and a tile; Insights - headline tiles "Reads first-time right" and "Typed instead", and a "Measured values" panel per guide/step over the period, so a leak rate or torque drifting across chambers is seen before it fails | server, portal | PO | todo | | 2026-10-19 | | design in docs/SPATIAL-READINGS.md §9; no code until approved |
| AROMS-355 | Labels in Korean, Japanese and Chinese: Vision asked for ko / ja / zh-Hans / zh-Hant (and de / fr) with per-line detection; each line's language named from its script (Hangul, kana) or NLLanguageRecognizer; the verdict says "· Japanese" on a pass and "label is in Korean" on a miss; training chips show the language | ios | PO | done | 2026.4.50 | 2026-10-19 | | Karthik to confirm on a Korean and a Japanese label; Mandarin / Cantonese are spoken - written it is Simplified or Traditional, which is what is named |
| AROMS-356 | TestFlight notes from the repo: `npm run testflight:notes` pushes WhatToTest.en-US.txt to the newest build's What to Test and docs/TESTFLIGHT.md's description to the Beta App Description through the App Store Connect API (ES256 JWT, no dependencies; key on the Mac, never in the repo); `--dry` shows the text, `--build N` targets a build | tooling | PO | done | | 2026-10-19 | | Karthik creates the API key (App Manager) once: ASC_KEY_ID, ASC_ISSUER_ID, ~/.appstoreconnect/AuthKey_<id>.p8 |
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
