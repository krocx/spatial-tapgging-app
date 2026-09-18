# Cortona3D RapidManual → SIB import — assessment plan

Status: v0.1 (2026-09-18) · branch `feature/ar-ojt`

## Decision

Build the importer **into SIB** (a `rapidmanual` source for `POST /guides/import`,
next to the existing xlsx / instructions adapters, plus a VRML→USDZ converter
in our own model pipeline). One-off manual conversion instructions would have to
be repeated for every procedure and would lose the part-node links that make
CAD-driven content (CAD-CONTENT.md) possible. The importer is written against
the *structure* of a real export, which is obtained by the two-stage process
below without moving any procedure content off the company network.

## Stage 1 — structural reconnaissance (office side, ~10 minutes)

Run `sib/tools/cortona-recon.py` on the export. It reads the `.vmp` (a ZIP
container in every version we know of — the script also handles the case where
it isn't) and the published `.htm` folder, and writes a **report.md /
report.json** that contains only the *shape* of the data:

- file inventory with sizes (file names generalised: letters→`A`, digits→`9`);
- XML: element and attribute vocabulary with counts, value *shapes*
  (`float`, `vec3`, `id-like(13)`, `text(31 chars)`), namespaces, and a
  value-free tree skeleton;
- VRML/X3D: node types, `DEF` name *patterns*, ROUTE field pairs,
  interpolator/TimeSensor counts (= how animations are encoded), a units hint;
- HTML/JS: script/link file names, embedded asset extensions, `data-*`
  attributes, id patterns, JSON key vocabulary.

No free text, part numbers, labels, coordinates or geometry are included — the
report is safe to send back here. Verified on synthetic inputs: zero content
strings survive into the report.

### Instructions to pass to the office Cowork (copy verbatim)

> 1. Put the `.vmp` and the `.htm` (with the folder it references — usually a
>    sibling folder of the same name containing `.wrl`/`.x3d`/`.js`/`.xml`) in
>    one directory, e.g. `C:\cortona-sample\`.
> 2. Copy `sib/tools/cortona-recon.py` from the `feature/ar-ojt` branch of
>    `spatial-tagging-app` next to it. It needs only Python 3.8+ (no packages).
> 3. Run: `python cortona-recon.py C:\cortona-sample --out C:\cortona-recon`
> 4. Open `C:\cortona-recon\report.md`, confirm it contains no procedure text
>    or part numbers (names appear as patterns like `AA_9999-99999`), then
>    send `report.md` and `report.json` to Karthik.
> 5. Also answer, from opening the `.htm` in a browser: (a) does the procedure
>    play 3D animation in the page, or is it static images? (b) roughly how
>    many steps? (c) does any step show a 3D callout/POI on the model?
> 6. If the script errors, send the full error text and the output of
>    `dir /s C:\cortona-sample` with file *sizes* only.

## Stage 2 — importer (here, against the report)

From the report we learn, without seeing content: how steps are delimited and
referenced (XML vocabulary), whether part links are `DEF` names or ids, how
step animations are encoded (VRML interpolators + ROUTEs vs. scripted JS
timelines vs. baked per-step `.wrl` files), whether the published HTML carries
a step list (13.1 "Generate Step List File"), units and axis convention, and
whether an AR/REFLEKT scenario file is present. That fixes the adapter design:

| RapidManual | SIB | Adapter work |
|---|---|---|
| `.wrl`/X3D with `DEF` names | assembly USDZ, nodes `base` + `cmp:<DEF>` | VRML97 parser (own code) → glTF → USDZ via existing pipeline; one rigid frame transform + unit scale per configuration |
| procedure XML / step list | guide steps (`title`, `text`, `nodes[]`) | new `rapidmanual` source in `instructions-source-adapter` |
| interpolator keyframes routed to a part | `nodes[].animate = insert`, `axis`, `travel` from first/last key | keyframe reduction; intermediate keys dropped in v1 |
| callouts / POIs with positions | tags bound to nodes (`node` + offset) | positions already in the model frame |
| information screens / text | step text, reference link | direct |
| viewpoints | optional "suggested view" | ignored by the tracked-part runtime |
| REFLEKT/VisionLib tracking config | — | discarded; PartFrame shape prior + `base` replace it |

Acceptance: import the sample; the Guide Library shows the steps in order with
text; the Guide Preview plays each step's node presentation on the converted
model; a Procedure Designer round-trip (edit-map) preserves node bindings.

## Stage 3 — validation on the real sample (office side)

Run the importer on the office machine against the same files (SIB runs on the
company server; the sample never leaves it) and send back only the import log,
which the adapter writes content-free (counts, unmapped element names, unit
warnings).

## What we already know about the format (public sources)

`.vmp` is the RapidManual project container; geometry is VRML97/X3D with
`DEF` names from CAD part IDs; procedures are XML under a specification
component (Generic / DITA / S1000D); step animations can be exported as partial
`.vmp`; 13.1 added an AR Specification Component that publishes POIs,
information screens and animated procedures to REFLEKT ONE, whose model
tracking (VisionLib) configuration is not portable and not needed.
