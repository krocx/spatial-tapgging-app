# Gemba Walk — reference-list findings (2026.4.46)

> Proprietary & Confidential · Applied Materials · AppliedX

The Gemba Walk is being brought up to the workflow Corporate Quality already
runs in the PowerApps *Gemba Audit* tool, with the things only AR can add
(findings pinned in space, re-found on the next walk). This document tracks
the slices as they land.

| Slice | What | Status |
|---|---|---|
| **G1 Audit Reference Library** | Focus Areas → Questions, finding categories, risk ratings. Portal CRUD + Excel/CSV/JSON import. | **shipped** |
| **G3 Finding model** | LocTag gains focus area, question code, finding category, risk rating, multiple photos, markup hook. | **shipped** |
| **G4 Capture flow (iOS)** | Tap surface → Focus Area → Question → photos with captions → category + rating. Findings as collapsible floating panels. | **shipped** |
| **G2 + G8 Walk session** | Project ID, Org, BU, Area, Location header; session summary; portal report + xlsx. | **shipped** |
| **G5 Markup** | Draw on the captured photo (PencilKit); anchored 3D strokes later. | **shipped** |
| **G7 Multi-auditor** | Presence on a walk — several auditors, findings appear live for each other. | **shipped** |
| **G6 Phone-down walking** | Live Activity / Dynamic Island: next finding + distance + haptics; raise to relocalize. | **shipped** (needs widget target) |

Walks never depend on a chamber or QR code — auditors walk and tag anywhere,
exactly as today.

---

## G1 · Audit Reference Library

### What it is
Three lists, served in one call:

* **Focus areas** — numbered groups as auditors know them (`14 — 6S Audits`).
* **Questions** — pre-defined prompts under a focus area, each with a code
  (`P5142 — Concept Understanding`: *"Ask people to explain the 6S program to
  you in their own words…"*).
* **Finding categories** — `Strength`, `OFI`, `NC` — and **risk ratings**
  `0 No risk · 1 Minor · 2 Medium · 3 High` (fixed vocabulary).

Auditors *pick*; they never type a category. Findings store the question
**code** and title they were logged against, so editing the library later
never changes what was recorded (the same doctrine as the LOTO quiz bank vs
issued certifications). Prefer **inactive** over delete when an item might
come back — inactive items leave the picker but stay for history.

### Where it lives
* Portal → **GembaWalks → 📚 Audit Library**. Add / edit / deactivate / delete
  inline. Writes need the admin key (or an Owner/Manager sign-in); reading
  does not.
* Data: `SIB_DATA_DIR/gemba-focus-areas.json`, `gemba-questions.json`.
  Included in `/admin/backup`.
* A fresh server seeds the 15 focus areas from the PowerApps tool (1 Quality
  policy awareness … 15 Shipment Release and Controls) with no questions —
  questions come from the import. On an already-seeded server, startup adds
  any missing seed area by code and removes the four demo 6S questions from
  the first seed if nobody edited them. Titles and imported questions are
  never touched.

### Importing the SharePoint lists
Same flow as *Import Guide*: choose file → preview counts and warnings →
Import. Nothing is written until the whole file validates.

Excel / CSV columns (order-free, case-insensitive; **⬇ Excel template** in
the portal gives the exact layout):

| Focus Area # | Focus Area | Question Code | Question Title | Question |
|---|---|---|---|---|
| 14 | 6S Audits | P5141 | 6S Procedure Awareness | Ask people whether they know where… |
| 14 | 6S Audits | P5142 | Concept Understanding | Ask people to explain the 6S program… |
| 15 | ESD Controls | | | |

One row per question; the focus-area columns repeat. A row with only the
focus-area columns adds the area on its own. JSON in the shape of **⬇ Export**
is also accepted.

Modes:
* **Append / update by code** (default, safe) — rows whose code already exists
  update that row; new codes are added; nothing is removed.
* **Replace whole library** — wipes both lists first. Use for a clean
  re-load; findings keep their codes regardless.

### API
```
GET    /gemba/library                 { data: { focusAreas:[{…, questions:[…]}], categories, ratings, version } }
GET    /gemba/library?all=true        include inactive
GET    /gemba/library/export.json     re-importable
POST   /gemba/library/import          { mode, rows:[{areaCode, areaTitle, code, title, text}] }  or  { mode, focusAreas:[…] }
POST   /gemba/library/focus-areas     { code, title, order?, active? }
PATCH  /gemba/library/focus-areas/:id
DELETE /gemba/library/focus-areas/:id  (removes its questions)
POST   /gemba/library/questions       { focusAreaId, code, title?, text, order?, active? }
PATCH  /gemba/library/questions/:id   (may move: focusAreaId)
DELETE /gemba/library/questions/:id
```
Codes are trimmed and upper-cased on the way in (`p5142` → `P5142`) and must
be unique within their list. `version` is the newest `updatedAt` across both
lists — clients cache the library by it.

Code: `sib/src/gemba/library-core.ts` (validation, import plan, seed),
`sib/src/routes/gemba-library.ts`, portal `gembaShowSub` / `loadGembaLibrary`
/ `openGembaLibImport` in `sib/portal/index.html`. Tests:
`sib/test/gemba-library.test.ts`.

---

## G3 · Reference-list findings

A finding (`LocTag`) logged through the new flow carries, in addition to the
legacy fields:

| Field | Source | Notes |
|---|---|---|
| `focusAreaCode`, `focusAreaTitle` | snapshot from the library | what the auditor chose |
| `questionCode`, `questionTitle`, `questionText` | snapshot | title defaults to `CODE — Title` when the client sends none |
| `findingCategory` | `STRENGTH` / `OFI` / `NC` | |
| `riskRating` | `0`–`3`, optional | |
| `photos[]` | `{ path, caption?, markupPath?, capturedAt }` | max 6; `referenceImagePath` mirrors `photos[0]` |
| `walkId` | G2 | the walk session |

Legacy findings (defect category + one photo) are untouched; the app's
`allPhotos` accessor folds the single reference image into the same list.

```
POST   /loc-tags                       + questionCode, findingCategory, riskRating, photosBase64:[{base64, caption?}], walkId
PATCH  /loc-tags/:id                   + questionCode, findingCategory, riskRating, photos:[{path, caption}] (caption edits)
POST   /loc-tags/:id/photos            { photosBase64:[…] }         append
DELETE /loc-tags/:id/photos/:file                                   remove one (admin-gated like all deletes)
PUT    /loc-tags/:id/photos/:file/markup { base64 }                 G5: attach the marked-up copy
```
An unknown `questionCode` is rejected (400) before any image is written.
Code: `sib/src/gemba/finding-core.ts`, `routes/loc-tags.ts`; iOS
`Models/LocTagModels.swift` (`LocTagPhoto`, `GembaFindingCategory`,
`GembaRiskRating`, `GembaLibrary`), `SIBClient` Gemba section.

---

## G4 · Capture flow (iOS)

**Author (log a finding).** Tap a surface → *Log Finding* sheet:

1. **Focus Area** — searchable list (code, title, question count). The last
   chosen area is pre-selected on the next finding.
2. **Question** — the area's questions with code, title and the prompt text;
   the chosen prompt is shown under the row.
3. **Category** — Strength / OFI / NC (segmented, required) and **Preliminary
   risk** 0–3 (optional). Notes are free text.
4. **Photos** — up to six; camera or library; each row has a caption
   ("Area identifier · issue description"); drag to reorder; first photo is the
   thumbnail everywhere.

The title is derived (`P5142 — Concept Understanding`). A toggle at the bottom
switches to the legacy free-text finding; it is also the automatic fallback when
the server has no library yet.

**Floating panels.** Every finding carries a world-anchored panel 0.42 m above
its pin (`FindingPanel`): a pill (stop #, title, category chip, ring coloured by
category) that expands on tap into a card (code, question, category + risk,
notes, photo count, *Open ›*). Tapping the card collapses it; the *Open ›* band
opens the peek (author) or completion (operator) sheet; tapping empty space
collapses. Surface is a warm light "frosted" card with dark text — orange stays
the accent (badge, ring, chips, Open button). Operators see the
non-target panels dimmed while navigating and may open any finding directly.

**Sheets.** `FindingDetailSections` is the one read-only body used by the peek
and completion sheets: reference question, category/risk (or legacy defect
category/severity), notes, and the photo strip with captions (tap → lightbox;
marked-up copies preferred when present). The edit sheet changes category, risk,
notes, title and captions; the question is fixed at log time.

Library on device: `GembaLibraryStore` (UserDefaults cache by `version`,
refreshed at walk start and when the sheet opens, 60 s debounce).

---

## G2 + G8 · Walk sessions, summary, Excel

**On the phone.** Opening a Gemba Walk shows *Start Gemba Walk*: auditor (from
the kiosk identity, not editable), Project ID, and Organization / BU / Area /
Location pickers fed by the library's pick lists (**Other…** reveals a text
field; last values are remembered per device). If the auditor has an open walk
on the same space it is offered under *Continue*. *Tag without a walk header*
skips it — findings then save without a `walkId`. Every finding logged during
the walk carries `walkId`. **Finish** → *Submit Walk & Save Map* uploads the
world map, submits the walk and shows the **Session Summary** — header, counts
by Strength / OFI / NC, max risk, photos, and the findings log.

**In the portal.** GembaWalks → **🚶 Walk Sessions**: one row per walk (date,
auditor + employee id, project, org/BU, area · location, space, findings with
category chips and max risk, status). Expand for the findings with question
text, notes and captioned photos. **⬇ .xlsx** per walk or for all walks: one
row per finding, walk header repeated, first photo embedded. Submitted walks
can be **reopened** (admin) to fix the header; deleting a walk detaches its
findings but keeps them.

**Pick lists** live under Audit Library → *Walk header pick lists* (one value
per line, Save). They ride along in `export.json` / import.

```
POST   /gemba/walks                    { anchorId, auditorName, auditorId?, projectId?, organization?, bu?, area?, location? }
GET    /gemba/walks?anchorId=&auditorId=&status=open|submitted     newest first, summary derived
GET    /gemba/walks/:id                { walk, findings }
PATCH  /gemba/walks/:id                header / notes (submitted walks: notes only)
POST   /gemba/walks/:id/submit         { notes? }
POST   /gemba/walks/:id/reopen         (admin)
DELETE /gemba/walks/:id                (admin) — findings detached, not deleted
GET    /gemba/walks/export.xlsx?walkId=  |  ?all=true
PUT    /gemba/library/lists/:kind      { values: string[] }   kind ∈ organization | bu | area | location
```
Data: `gemba-walks.json`, `gemba-lists.json`. Code: `sib/src/gemba/walk-core.ts`,
`routes/gemba-walks.ts`, `oms/xlsx-lite.ts` (`buildTableXlsx`); iOS
`Modes/GembaWalkSheets.swift`, `LocTagAuthorView` (walk state, submit, summary).

---

## G5 · Photo markup

While logging a finding, tap a photo thumbnail (or the orange pencil on a photo
in the author's peek sheet) to open **Mark up photo**: a PencilKit canvas over
the image — finger or Apple Pencil, orange / red / white / black, thin or thick,
undo, clear. *Done* flattens the strokes onto a full-resolution copy; the draft
keeps the strokes so the markup can be re-edited before saving. On save, each
marked photo is sent with `PUT /loc-tags/:id/photos/:file/markup` after the
finding exists (a failed markup never loses the finding). The original photo is
untouched — `path` and `markupPath` live side by side — and every consumer
(panel card, sheets, portal strips, walk Excel) shows the marked-up copy when
present. Anchored 3D strokes in AR remain a later phase.

---

## G7 · Walk together

Several auditors can walk one space at once. The presence system from AR OMS
(`PresenceService` + `PresenceLayer`) runs on the walk with surface
`gembaWalk`; poses are camera transforms in the world-map frame — on a fresh
walk that is the author's own frame, after the map is uploaded everyone who
relocalises shares it. Poses are withheld while a device is still relocalising
so nobody is drawn in the wrong place. Colleagues appear as the usual lens /
view cone / roster chip, with join/leave toasts.

Findings travel live: any `loc-tags` store write (create, edit, markup, delete)
is fanned out as a `loc-tags` presence event to every device on that anchor;
the walk view refetches and adds new pins + panels (toast "A colleague logged a
finding"), re-renders changed ones, and removes deleted ones. Server:
`sib/src/sse/presence.ts`; iOS: `PresenceService.Event.findingsChanged`,
`LocTagAuthorView.syncFindingsFromColleagues()`.

---

## G6 · Phone-down navigation

Operators walk with the phone at their side. A **Live Activity** shows the walk
in the Dynamic Island and on the Lock Screen: pin, next finding title, distance
(0.1 m buckets, throttled to ~2/s), progress `done/total`; arriving turns it
green with a success haptic; lowering the phone (ARKit tracking limited/lost)
switches to *Raise your phone to update* keeping the last distance; raising it
re-localises against the world map and updates resume; finishing shows *Gemba
walk complete* for five minutes. Honest limit: ARKit cannot track a covered
camera — this is "phone down between findings", not continuous tracking.

Setup: one-time Widget Extension target (`ios-app/XCODE-SETUP.md` step 10).
Code: `Shared/GembaWalkActivity.swift` (attributes, both targets),
`Services/GembaLiveActivity.swift` (start / update / finish / end),
`GembaWalkWidget/GembaWalkLiveActivity.swift` (presentation).

---

## R1–R5 · Resume with a checkpoint (background, kill, drift)

**The constraint.** iOS suspends the camera and ARKit whenever the app leaves
the foreground; nothing can track in the background. On return ARKit used to
reset its world origin, so pins respawned in the wrong place with no warning —
unacceptable for an auditor in a cleanroom.

**What happens now**

* **Background (R1)** — the Live Activity flips to *Open SpatialTagging to
  continue · next #4 · last 3.2 m*, greyed. No fake live distance.
* **Kill / restart (R3)** — completed findings, the current stop and the walk
  id are stored per space on the device (`WalkProgressStore`, 12 h). Re-opening
  the walk shows *Continuing at #4 · 3 of 7 done* and starts navigation there.
* **Return to foreground (R2)** — `ARSessionManager` now answers
  `sessionShouldAttemptRelocalization` with `true`, so ARKit keeps the previous
  map and tries to relocalize into it. Every interruption end bumps
  `resumeCount`; the walk view shows the **Welcome back** checkpoint: blurred AR,
  the last known finding's own photo (or the walk's reference photo) as the
  landmark, *Stand where you saw #4 and point the phone at it*. When tracking
  returns to normal the view un-blurs with one question over the pin —
  **Is #4 where the pin shows?** *Yes, continue* / *No, re-align*. No answer in
  15 s, or *No* → the full world-map re-localization (reference photo + I'm
  Here) and navigation continues at the same stop. Nothing is trusted (no
  auto-arrival, no drift check) while the checkpoint is up.
* **Authors (R5)** — the same checkpoint; taps are ignored until confirmed, so
  no finding is placed into a drifted frame. *No, re-align* uses the space's
  uploaded map when there is one; on a fresh walk without a map the checkpoint
  keeps waiting with the landmark photo (the previous session is the only frame).
* **Drift check on arrival (R4)** — the first time an operator reaches a finding,
  the live view is scored against the finding's photo(s):
  `POST /loc-tags/:id/compare { imageBase64 }` → `{ score, status }` (the step-
  validation comparator, threshold 0.40 because the operator stands roughly
  where the photo was taken). `FAIL` → *This doesn't look like #4 — Re-align /
  Looks right* with a warning haptic. Once per finding; reset by a re-align.
  Never stored, never logged.

Code: `Services/ARSessionManager.swift` (`resumeCount`, relocalization opt-in),
`Components/ResumeCheckpointOverlay.swift`, `Services/WalkProgressStore.swift`,
`Modes/LocTagOperatorView.swift` (checkpoint, resume index, drift prompt),
`Modes/LocTagAuthorView.swift` (author checkpoint), `Services/GembaLiveActivity.swift`
(`background`), `sib/src/routes/loc-tags.ts` (`/compare`).
