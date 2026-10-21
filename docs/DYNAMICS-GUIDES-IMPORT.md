# Import guides from Microsoft Dynamics 365 Guides

Proprietary & Confidential · Applied Materials

Status: **built, 2026-10-21** (AROMS-364 core, 365 tests, 366 wiring;
367 holds the nice-to-haves). Round one is two guides moved by hand; the
deadline behind it is Microsoft's: Guides and Remote Assist stop working
after **31 December 2026**
([notice](https://learn.microsoft.com/en-us/lifecycle/announcements/dynamics-365-guides-remote-assist-end-of-support)).
Implementation notes for engineers live in
[`sib/src/import/dynamics/README.md`](../sib/src/import/dynamics/README.md).

## Scope, as agreed

A person exports a guide on the Microsoft side with their own Microsoft
login (the same authentication Guides itself uses - no new IT contract) and
imports the resulting `.guide` file with the SIB Import tool, which turns it
into a draft AR guide the way the Cortona and xlsx imports do today. The
author then places and trains it in AR. No Entra app registration, no
connector, no scaling work until that workflow has been reviewed on the two
guides.

## The `.guide` package

"Export guide" writes a single file: a plain POSIX tar, no compression, no
directories. Entries are named by kind, part, GUID and ETag:

| Entry | Holds |
|---|---|
| `Guide_Manifest` | guide id, solution version, schema version |
| `Guide_Body` | the `msmrw_guide` row with its child tables expanded (OData JSON: raw option-set numbers plus `@OData.Community.Display.V1.FormattedValue` labels, `_x_value` lookups) |
| `Metadata_<guid>` | one per asset: name, format, version |
| `Model_Body_<guid>_<etag>` · `Image_Body…` · `Video_Body…` · `Audio_Body…` | the asset files; `…_SmallThumbnail_…` thumbnails |

The reader is ours and defensive: paths, `..`, links, devices, oversize and
over-count archives and bad checksums are refused before anything is parsed;
file types are decided by magic bytes, not by the `Format` field.

## What a guide is, and what it becomes in SIB

| Guides | Becomes in SIB |
|---|---|
| Guide name, description | Guide name and description |
| Task (ordered by Previous Task) | Section; the step title is the task name |
| Step (ordered by Previous Step) - text, picture | Step with the text and the picture (written into the step-image store) |
| Question step with responses (Go to next · Go to step · No action) | First acting response → success branch, second → failure branch; the response texts stay in the step as a numbered list (SIB has no response buttons); a third acting response is reported for the Designer |
| Completion step, its objects and placements | Last step, evidence required, its objects shown |
| Placed 3D objects - the author's models and Microsoft's stock holograms alike | Nodes `pl:<placementGuid>` of **one merged assembly GLB** per guide in the Guides anchor frame; per-step show / hide / X-ray (ghost) / colour deltas; the assembly's initial state hides everything |
| Attention director | `effect: 'flash'` on its object and the step's `cadPosition`; without a director, the shown objects' centroid |
| Anchor type (holographic, QR, circular, object) | Recorded in the report; the author places the assembly once at the SIB QR, which is the equivalent of the Guides anchor |
| Unity coordinates (left-handed, Y up) | Converted (x, y, −z; quaternion −x, −y, z, w) behind one flag, `?flipZ=0` to keep the source frame for diagnosis |
| Triggers, interactables, anchor 3D object, animation takes / speed / direction, videos, audio, folder tree, `Invisible` behaviour | **Not represented** - counted and listed in the report, never imported half-way (`Invisible` is imported hidden by default, or dropped with `?invisible=drop`) |

Why one assembly rather than per-step model slots: SIB already has the
CAD-driven content model (`GuideAssembly` + per-step `nodes[]` +
`cadPosition`) for Cortona; reusing it means Place Assembly, the Studio,
iOS and the XR kit work unchanged, and nothing touches the USDZ pipeline.

## The workflow, end to end

1. The ME exports the guide on the Microsoft side and gets `<name>.guide`.
2. Portal → Content → Import → choose the `.guide` → the job reads it in a
   worker (one at a time, like Cortona) and answers with the guide, the
   assembly model and the report; if a guide with that name exists, the
   usual update / new / cancel prompt.
3. The draft guide is in the library with its sections, branches, pictures
   and assembly; the import log (guide menu) holds the content-free report
   and the source guide's GUID and asset versions.
4. Author: Place Assembly on the anchor, then place steps, train, publish -
   as today.

From a terminal, `npm run guide:inspect -- file.guide --tree` dry-runs a
package and writes nothing; `--json` for the machine-readable report,
`--out <dir>` to look at the merged GLB in a viewer, `--make-sample x.guide`
to write a synthetic package for a rehearsal.

## Privacy

Real guides may contain proprietary procedures. The importer never logs
instruction text, asset names or URLs at info level - counts and GUIDs only -
and the report kept with the guide is the same. No real guides were used
to build it; the whole test suite runs on synthetic packages.

## Open points

- `GuideAssembly.source` and `ImportGuideRequest.sourceType` (shared types)
  gain the word `'dynamics'` once agreed; until then a Dynamics assembly is
  recorded as a placed CAD model and the guide menu's Import log button
  keys on that word.
- A Dynamics assembly's USDZ status stays `pending` (the app renders the
  GLB with per-part control, as for Cortona); marking it `not-needed` is a
  one-token change in `routes/models.ts` once agreed.
- Videos stay unlinked (SIB has no guide video store); the report counts
  them. AROMS-367: batch import, idempotent re-import by GUID + version,
  a Dataverse Web API source on the same mapper.
