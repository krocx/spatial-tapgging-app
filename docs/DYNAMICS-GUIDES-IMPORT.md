# Import guides from Microsoft Dynamics 365 Guides

Proprietary & Confidential · Applied Materials

Status: **proposal, 2026-10-21** - for Karthik's review before backlog rows
are created. Nothing here is built.

## Why now

Microsoft has announced that Dynamics 365 Guides and Remote Assist are not
available after **31 December 2026**
([end-of-support notice](https://learn.microsoft.com/en-us/lifecycle/announcements/dynamics-365-guides-remote-assist-end-of-support)).
Every guide a team authored in Guides - the steps, the holograms placed on
the equipment, the photos and videos - lives in that tenant's Dataverse and
stops being usable on the HoloLens when the licence ends. That makes this
import two things at once: a feature (one more instruction source for the
adapter, beside xlsx, JSON and Cortona) and a **migration** with a date.
The plan is shaped for the migration: get the content out completely and
early, land it in SIB as draft guides the author finishes in the Designer
and in Place Steps in AR, and keep the Guides placements where they can be
reused.

## What a Guide is, in Dataverse

Microsoft documents the tables
([table reference](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/guides/developer-entity-reference),
[fields to create a guide](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/guides/workflow-create-guide)).
The ones that carry authored content:

| Table | What it holds | Maps to |
|---|---|---|
| `msmrw_guide` | name, description, **anchor type** (QR code, circular code, holographic / object anchor, undecided), schema version (5), folder, status | Guide name and description; the anchor decides how placements can be reused |
| `msmrw_guidetask` | a group of steps, ordered by Previous Task | **Section** (the Designer folds a long procedure by section) |
| `msmrw_guidestep` | step text, step template type (default · question · completion), Previous Step, up to N responses with action type, response step and response text; media references | Step text and order; question steps become the conditional graph; completion step is the last step |
| `msmrw_guidestepobject` + `msmrw_guidestepobjectplacement` | which 3D object sits on a step and **where it was placed in the world** - position, rotation, scale relative to the guide's anchor | Step pin and model slots; with a QR anchor, a candidate pre-placement in SIB's anchor frame |
| `msmrw_guidecompletionstepobject(placement)` | the same for the completion step | as above |
| `msmrw_3dasset` (+ `_localized`) | a 3D object file (customer models converted to glTF by Guides; Microsoft's toolkit holograms - arrows, hands, pointers) | Customer models → the model library and step slots; toolkit holograms → a marker / callout on the step, or logged as not carried |
| `msmrw_imageasset`, `msmrw_videoasset`, `msmrw_audioasset` (+ `_localized`) | step media files | Image → step image; video → reference link (SIB does not host video today); audio → text in the TTS field where a transcript exists, else a link |
| `msmrw_guide_localized` and the `_localized` tables | translations | One language per import, chosen by the user; others logged |
| `msmrw_guidesession`, `msmrw_guidesessionstepvisit` | operator runs on HoloLens: duration, step visits | Optional: historical runs into the usage log as a pre-platform **baseline** for Business Readiness (cycle time, time per step) |
| `msdyn_mrfolder` | folders | Import scope: a folder is the natural batch |

Two things to confirm against a real export before building (they decide
the placement story): the exact columns of `msmrw_guidestepobjectplacement`
(units, handedness, which point of the QR is the origin and how its axes
are oriented), and how file columns are exposed through the Web API for the
asset tables (file attribute download vs annotation). Both are an afternoon
with one guide in a sandbox tenant.

## Two ways in

**A. Dataverse Web API connector (complete, repeatable).** OData v4 at
`https://<org>.crm.dynamics.com/api/data/v9.2/`, authenticated with an
Entra app registration (client credentials) given an *application user* in
Dataverse with read on the Guides tables. SIB lists folders and guides,
pulls one guide's tables and files, and imports it. Pros: every table,
every file, scriptable, re-runnable for an update. Cons: an Entra app
registration and an application user need IT, which at AMAT is weeks, not
days; and the tenant must be reachable from where SIB runs (Render today,
on-prem later - outbound HTTPS only).

**B. Offline bundle (no IT, one guide at a time).** The model-driven Guides
app can export any table view to Excel; the asset files can be downloaded
from the same app. A small, documented procedure produces a folder - the
five table exports plus a media folder - zipped and dropped into the SIB
import modal, the way a Cortona publication is today. Pros: the ME can do
it tomorrow with the rights they already have; nothing new to approve;
works for a tenant SIB cannot reach. Cons: manual per guide, and the
placement columns depend on what the Excel export carries (to confirm).

Recommendation: build the **parser and mapping once** (it is the same
`ImportedGuide` either way), ship **B first** so migrations can start
before the Entra approval, and add **A** as the connector that calls the
same code. The adapter architecture was designed for exactly this - a
`DynamicsGuidesAdapter` beside `ManualJsonAdapter` and the Cortona
importer, producing an `ImportedGuide` for `applyImportedGuide`.

## Mapping, and the decisions in it

- **Steps.** Tasks become sections; steps keep their text and order (walked
  by Previous Step, not by creation date). Step text in Guides is short and
  plain; it goes to `text`, with the task name as the title when a step has
  none. The completion step becomes the last step with evidence required.
- **Question steps.** Guides allows several responses, each pointing at a
  step. SIB's graph has success and failure branches and a precondition.
  Two responses map cleanly (first → `nextOnSuccessSeq`, second →
  `nextOnFailureSeq`, with the response texts kept in the step text so the
  operator sees the question); three or more are imported as a linear
  sequence with a log line naming the step, and the ME resolves it in the
  Designer. The import log says how many were folded.
- **Media.** The first image on a step is the step image (downloaded and
  stored, as xlsx imports do); further images and any video become
  reference links in the step text; audio becomes the TTS text when the
  localized table carries a transcript, otherwise a link. Nothing is lost,
  some things are demoted - the log says which.
- **3D objects.** Customer models (the glTF Guides produced from the
  customer's upload) go into the model library once, de-duplicated by
  asset id, and attach to step slots with the Guides scale. Microsoft's
  toolkit holograms (arrows, hands, numbered dots, "look here" pointers)
  are not ours to carry; each becomes the step pin's marker where the
  meaning is "here", otherwise a note in the log. This is the one place
  where some authored intent is lost, and it should be said in the import
  summary, not discovered on the floor.
- **Placement.** This is the decision that matters. Guides placements are
  relative to the guide's anchor. When the anchor is a **QR code**, the
  frame is a printed marker with a known origin, which is what SIB's own
  anchor is - so with one measured transform (origin offset and axis
  order, confirmed on the sandbox guide) the step pins and model poses can
  be imported as **candidate placements** in SIB's QR frame. The author
  then prints SIB's QR at the Guides QR's position, opens Place Steps in
  AR, and sees the steps already where they were, to confirm or nudge.
  When the anchor is a circular code or an object anchor, the relative
  positions between steps are still valid; the author places the first
  pin and the rest follow (the Copy-previous / assembly placement path).
  Either way nothing is published until an author has been in AR, which
  is the lifecycle rule already.
- **Lifecycle.** Every imported guide lands as a **draft** on the chosen
  chamber, with the Guides folder as the section prefix if wanted, the
  same de-duplication prompt as the Cortona import (update the existing
  guide or create a new one), and a readiness report that names what
  still needs an author.
- **Runs (optional).** Guides sessions and step visits can be folded into
  the usage log as *pre-platform* runs - flagged as such, never counted as
  SIB runs - so the Business Readiness baselines for cycle time and time
  per step come from the tool the team actually used, not from a guess.

## What is new in SIB for this

- `sib/src/import/dynamics/` - the parser (tables → `ImportedGuide`),
  shared by the bundle and the connector; a mapping log the way the
  Cortona importer keeps one.
- `DynamicsGuidesAdapter` registered in `instructions-source-adapter.ts`;
  `sourceType: 'dynamics'` on `ImportGuideRequest`.
- `POST /guides/import/dynamics` for the bundle (zip), on the existing job
  queue with preview, apply and discard, so the ME sees the summary before
  anything is written; the connector adds `GET /integrations/dynamics/folders`,
  `.../guides` and `POST /guides/import/dynamics/pull`.
- Portal: the Import modal gains "Dynamics 365 Guides" beside Cortona, with
  the language picker, the anchor-frame note, and the summary (steps,
  sections, questions folded, media demoted, holograms not carried,
  placements imported as candidates or relative).
- `ImportedGuideStep` gains an optional `anchorPlacement` (position,
  rotation, scale in the anchor frame) that `applyImportedGuide` stores as a
  candidate the device offers in Place Steps in AR - the first time an
  import carries placement at all, which is why it stays a candidate.
- A catalogue entry, the Feature Catalog row, SERVER-REFERENCE, and a
  one-page procedure for the ME ("Export a guide from Dynamics 365 Guides").

## Phases

| Phase | Scope | Size | Needs |
|---|---|---|---|
| 0 · Confirm | One real guide from a sandbox tenant: export the tables and files, read the placement columns, measure the QR frame, write the mapping as a test fixture | 2 days | A Guides tenant with one guide, a HoloLens or the PC app to read the anchor |
| 1 · Bundle import | Parser, adapter, zip import with preview / apply / discard, steps · sections · questions · media · customer models; log and summary; catalogue and docs; the ME's export procedure | 5 days | Phase 0 fixture |
| 2 · Placements | QR-anchor candidates in SIB's frame; relative placement for other anchors; Place Steps in AR shows candidates to confirm | 3 days | the measured transform from Phase 0; one device test on a chamber with both QRs |
| 3 · Connector | Entra app registration, application user, folder / guide listing, pull and re-pull for update | 3 days + IT lead time | IT approval; outbound HTTPS from SIB |
| 4 · Runs as baseline | Guides sessions and step visits into the usage log as pre-platform runs for Business Readiness | 2 days | Phase 1 or 3 |

Phases 0-2 give a usable migration path before any IT approval; 3 makes it
repeatable; 4 is a gift to the scorecard.

## Risks and open questions

- **Placement columns and frame conventions** - the whole of Phase 2 rests
  on what `msmrw_guidestepobjectplacement` actually stores and how the QR
  anchor's origin is defined. Phase 0 answers it; until then Phase 2 is an
  estimate.
- **File access** - whether the asset files come through the Web API file
  columns, through annotations, or only through the app's download. Phase 0.
- **Toolkit holograms** - a guide that is mostly Microsoft arrows and hands
  loses most of its visual authoring; the summary must say so, and the ME
  should see it before applying.
- **Rich formatting and localisation** - Guides step text is plain; if a
  tenant used several languages, one is imported per run.
- **Tenant reach** - a Render-hosted SIB pulling from the AMAT tenant will
  need the network path approved; the bundle path has no such dependency.
- **Scale** - how many guides and folders are in scope decides whether the
  bundle path is enough. Ask the teams now; if it is dozens, Phase 3 moves
  up.
- **Licence** - Microsoft's toolkit content stays Microsoft's; we copy only
  the customer's own models and media.

## What I need from you to start

The number of guides and tenants in scope, access to a sandbox tenant with
one representative guide (ideally QR-anchored, with a customer model and a
question step), and the name of the IT contact for the Entra app
registration so Phase 3 can start in parallel with Phase 1.
