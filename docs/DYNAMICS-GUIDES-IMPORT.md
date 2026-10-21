# Import guides from Microsoft Dynamics 365 Guides

Proprietary & Confidential · Applied Materials

Status: **proposal v2, 2026-10-21** - scoped to a manual migration of two
guides, for Karthik's review before backlog rows are created. Nothing here
is built.

## Scope, as agreed

Round one is two guides, moved by hand: a person exports a guide from the
Microsoft side with their own Microsoft login, and imports the result with
the SIB import tool, which converts it into a draft AR guide the way the
Cortona and xlsx imports do today - steps, sections, media, models; the
author then places and trains it in AR. No Entra app registration, no
connector, no scaling work until that workflow has been reviewed on the two
guides. The deadline behind it is Microsoft's: Guides and Remote Assist stop
working after **31 December 2026**
([notice](https://learn.microsoft.com/en-us/lifecycle/announcements/dynamics-365-guides-remote-assist-end-of-support)).

## What "export" means on the Microsoft side

There is no "export this guide to a file" in the Guides PC app or the admin
app. A guide is rows in Dataverse tables plus files on asset rows
([table reference](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/guides/developer-entity-reference)).
Every tool that "exports" a guide - Microsoft's own
[Content Migration Tool](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/guides/migrate)
(PowerShell, Dataverse to Dataverse), and third-party exporters such as
frontline.io's `.guides` packager - reads those tables with the **user's
own sign-in** and the Dynamics CRM permission that login already carries.
That is the same authentication as using Guides itself, which is the point
Karthik made: no new IT contract.

Two manual ways to get a guide out, both with the ME's own login:

**A. Power Platform CLI export (recommended).** `pac` is Microsoft's
command-line tool; `pac auth create` signs the user in interactively (the
same Microsoft login as Guides), and `pac data export` writes the records a
schema file names into a zip. SIB ships that schema file - the Guides tables
scoped to one guide - and a one-page procedure. The ME runs three commands
and gets `<guide-name>.zip`. To confirm in Phase 0: that `pac data export`
carries the **file columns** (the glTF, images, video) and not only the rows;
if it does not, the files are downloaded from the asset records in the
Guides admin app and dropped into the same zip under `media/`.

**B. Excel export from the Guides admin app (fallback, no tooling).** The
model-driven app exports any table view to Excel: Guides, Guide Tasks,
Guide Steps, Guide Step Objects, Guide Step Object Placements, 3D Assets,
Image / Video / Audio Assets, each filtered to the guide. The files are
downloaded from the asset records. The ME zips the workbooks and the
`media/` folder. Slower, nothing to install.

The SIB importer reads either: one zip, with tables as CMT XML or as xlsx,
and a `media/` folder. One parser, one mapping.

## What a guide is, and what it becomes in SIB

| Dataverse table | Holds | Becomes |
|---|---|---|
| `msmrw_guide` | name, description, anchor type (QR · circular code · object anchor), schema version | Guide name and description; anchor type recorded for Phase 3 |
| `msmrw_guidetask` | ordered groups of steps (Previous Task) | Sections |
| `msmrw_guidestep` | text, template type (default · question · completion), Previous Step, responses | Steps in order; questions → the conditional graph; completion → last step, evidence required |
| `msmrw_guidestepobject(placement)` | which 3D object sits on a step, and where (relative to the anchor) | Model slots with the Guides scale; placement kept in the import record for Phase 3, not applied |
| `msmrw_3dasset` | customer models as glTF; Microsoft toolkit holograms (arrows, hands, dots) | Customer models → model library, de-duplicated by asset id; toolkit holograms → the step pin's marker where the meaning is "here", else a log line |
| `msmrw_imageasset` · `videoasset` · `audioasset` | step media | First image → step image; further images and video → reference links; audio → TTS text where a transcript exists, else a link |
| `_localized` tables | translations | One language per import, chosen in the modal |

The honest losses, said in the import summary before anything is written:
questions with more than two responses are folded to a linear sequence
with the step named; video and extra images are demoted to links; toolkit
holograms are not ours to carry. A guide that is mostly Microsoft arrows
loses most of its visual authoring, and the ME should see that count
before applying.

## The workflow, end to end

1. ME signs in with `pac auth create` (or opens the Guides admin app),
   exports the guide with SIB's schema (or the table views), gets a zip.
2. Portal → Import → **Dynamics 365 Guides (.zip)** → chooses the chamber
   and the language → the job parses in the worker, as Cortona does, and
   shows the summary: steps, sections, questions folded, media demoted,
   holograms not carried, models found.
3. Apply → a **draft** guide on the chamber, with the same de-duplication
   prompt as other imports (update the existing guide or create a new one).
4. Author opens Place Steps in AR, places, trains, publishes - as today.

## What is new in SIB

- `sib/src/import/dynamics/` - the parser (CMT XML and xlsx table shapes →
  `ImportedGuide`), the model and media handling, and a mapping log in the
  Cortona importer's style. `DynamicsGuidesAdapter` registered beside
  `ManualJsonAdapter`; `sourceType: 'dynamics'`.
- `POST /guides/import/dynamics` on the existing job queue with preview,
  apply and discard.
- Portal: the Import modal's third source, with the language picker and
  the summary.
- `docs/catalog/dynamics-guides-import.md`, the Feature Catalog row,
  SERVER-REFERENCE, and `docs/howto/EXPORT-FROM-DYNAMICS-GUIDES.md` - the
  one-page procedure for the ME (pac commands, the schema file, the Excel
  fallback, where to find the files).
- `ImportedGuideStep` gains an optional `sourcePlacement` that is stored but
  not applied - so Phase 3 can use it without a second export.

## Phases

| Phase | Scope | Size | Needs |
|---|---|---|---|
| 0 · Confirm the export | One of the two guides exported both ways; confirm which tables and file columns come out, the placement columns, the asset file formats; keep the export as the test fixture | 2 days | the ME's login on the tenant, one guide |
| 1 · Export procedure | SIB's `pac` schema file and the one-page procedure, tried by the ME unaided on the second guide; the Excel fallback written | 1 day | Phase 0 |
| 2 · SIB importer | Parser, adapter, zip import with preview / apply / discard, steps · sections · questions · media · models, summary and log; catalogue and docs; the two guides imported and placed in AR | 5 days | the Phase 0 fixture |
| 3 · Later, after the review | Placements reused through the QR frame as candidates in Place Steps in AR; batch export of a folder; a connector if scale asks for it; Guides sessions as pre-platform baselines for Business Readiness | - | the review of the two-guide workflow |

Eight working days to the two guides placed in AR, no IT dependency.

## Risks and open questions

- **File columns in the export.** If `pac data export` does not carry the
  asset files, the ME downloads them from the admin app - a few clicks per
  asset, fine for two guides, the first thing to automate at scale.
- **Toolkit holograms.** The share of a guide's visual authoring that is
  Microsoft arrows and hands decides how much the author re-does in AR;
  the summary says it, and Phase 0 tells us what the two guides contain.
- **Question steps with many responses** fold to linear; the ME resolves in
  the Designer.
- **Schema version.** Guides on schema v3 or v4 need Microsoft's upgrade
  first; current guides are v5.
- **Licence.** Only the customer's own models and media are copied.

## To start

The two guide names and the tenant, the ME who will run the export (with
`pac` installed - a winget / npm install, no admin rights), and whether a
HoloLens is available to look at one guide's anchor during Phase 0.
