# Cortona3D RapidManual → SIB import - assessment plan

Status: v0.2 (2026-09-18) · branch `feature/ar-ojt` · **Stage 2 implemented** (`sib/src/import/cortona/`, `POST /guides/import/cortona`, portal Import modal)

## Decision

Build the importer **into SIB** (a `rapidmanual` source for `POST /guides/import`,
next to the existing xlsx / instructions adapters, plus a VRML→USDZ converter
in our own model pipeline). One-off manual conversion instructions would have to
be repeated for every procedure and would lose the part-node links that make
CAD-driven content (CAD-CONTENT.md) possible. The importer is written against
the *structure* of a real export, which is obtained by the two-stage process
below without moving any procedure content off the company network.

## Stage 1 - structural reconnaissance (office side, ~10 minutes)

Run `sib/tools/cortona-recon.py` on the export. It reads the `.vmp` (a ZIP
container in every version we know of - the script also handles the case where
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

No free text, part numbers, labels, coordinates or geometry are included - the
report is safe to send back here. Verified on synthetic inputs: zero content
strings survive into the report.

### Instructions to pass to the office Cowork (copy verbatim)

> 1. Put the `.vmp` and the `.htm` (with the folder it references - usually a
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

## Findings from the office reconnaissance (2026-09-18)

Sample: RapidManual 13.1 (RapidGenerator 9.9, MicroStation import), published with
Cortona3D Solo 2.8.0 as a single self-contained `.htm` (WebAssembly/WebGL viewer,
no plugin). The findings report is content-free and stays with the office
Cowork; this is the structural digest that drives the importer.

**The import source is the published `.htm`, not the `.vmp`.** Script block 2
(`type="application/solo+zip"`, a base64 `data:application/x-cortona3d` URI)
decodes to a ZIP with exactly three entries: `<title>.wrl` (gzip VRML97, one
merged scene, ~3.3 MB), `<title>.interactivity.xml` (step/action index +
`DocItems` part table), `<title>.xml` (the `rwi` step list). This replaces the
`.vmp`'s 75 hash-named entries, two disjoint id spaces, a mis-extensioned 8.5 MB
XML "`.wrl`", double compression and 772 KB of build logs carrying source paths.

**Animation lives in proprietary VRML PROTOs, nowhere else.** Zero standard
interpolators in the `.vmp`; in the published `.wrl` the procedure is a PROTO
tree `Procedure → Step → SubStep{duration} → commands`, and each command is a
PROTO instance sharing one interface (`key`, `keyValue`, `period`, `objectID`,
`attributeName`, `value_changed`) bound to its target by
`ROUTE <cmd>.value_changed TO <targetDEF>.<field>`. Command mix in the sample:
`Set_transparency` 44, `SwitchOFF` 39, `Set_Viewpoint` 21, `Set_translation` 9,
`Set_rotation` 7, `Set_center` 2, `Set_diffuseColor` 2, `Set_Arrow2` 1 (125
total; 83 are visibility, 16 are motion). A stock VRML loader drops all of it
silently - our parser must keep PROTO declarations and instances.

**Scene graph:** 36 `ObjectVM` PROTO instances (`translation`, `rotation`,
`center`, `scale`, `parent`, `children`, `name`, `whichChoice`…) + 42 standard
`Transform`s; leaf meshes are plain `IndexedFaceSet`. Units metres, Y-up as
written by RapidGenerator (MicroStation source is Z-up - verify against one
known-orientation part per configuration). Viewpoints per SubStep
(`Set_Viewpoint`, 9-number tuple whose layout must be decoded empirically).

**Part identity is the weak point.** Published `DEF` names are lossy slugs of
display text (`A+_A+_A+`, truncated ≈30 chars, collision-suffixed) plus some
part-number-like `A+9-9999999_9`; `objectID` is an opaque 32-bit key (not an
index); the id→part-number table (`DocItems`, `rwi/bom`) has only 2 rows against
thousands of units. The importer keys nodes on `DEF` + `objectID` and treats
part numbers as *enrichment*, verified against a procedure with a known BOM.

**Steps:** three counts disagree (39 authoring `step` / 9 `Step` + 21 `SubStep`
runtime / 11 `rwi` steps). Canonical = the **21 SubSteps** (the level that
carries `duration` and commands), grouped under 9 Steps. Titles/text come from
`interactivity.xml` (`Description`, `Comment`, `Text`); `rwi` titles are bare
integers - never use them for UI. Order = document order; no branching.

**Callouts:** 15 annotation widgets (`PanelImg`, `CalloutM`, `VMTighten`,
`VMRope`, `PanelHtml`) with model-coordinate parameters (`pos`, `Point1/2`,
`translation`) and body copy as RTF/HTML (`richtext`, `htmlbody`) → tags bound
to nodes, text via an RTF/HTML-to-plain pass. **No POI construct, no
AR/REFLEKT export** in this sample - tracking is entirely ours (PartFrame).

**Traps to encode as tests:** sniff magic bytes never extensions; gunzip inside
stored ZIP entries; `GeometryID` is a decoy (`presentation@id + ".wrl"` is the
real link in the `.vmp`, irrelevant on the published path); 13 VRML `Script`
nodes with inline JavaScript (behaviour partly imperative - ignore, we
re-implement presentation from commands); `PublicPath` internal URL (strip);
mixed LF/CRLF.

**Single most actionable item:** the publisher was configured `GLTF=No`,
`X3D=No`. Re-publishing the same procedure with `GLTF=Yes` (and `X3D=Yes`)
may hand us standard geometry and possibly standard animation, retiring most
of the VRML/PROTO work. Test before writing the parser.

## Sample 2 confirmation (2026-09-18)

A second, ~26× larger procedure (394 `.vmp` entries, 3,290 animation commands,
203 steps / 210 SubSteps, 12.5 MB `.htm`) from the same toolchain. **Every
structural invariant held**: flat ZIP; the mis-extensioned XML "`.wrl`"; gzip
VRML97 flat leaf meshes; `presentation@id + .wrl` resolving 375/375; assembly
tree in XML `unit` nesting; metres / Y-up / `UpRight=No`; no VRML interpolators
anywhere; the same `Procedure → Step → SubStep → Set_* / SwitchOFF` PROTO
command tree with the same interface, wired by `ROUTE`; `DEF`+`ROUTE` linkage
in the published scene; SubStep count agreeing across `interactivity.xml` and
the `.wrl` (210 = 210); no branching; no POI construct; no AR export;
`GLTF=No`, `X3D=No`. Command histogram at scale: `SwitchOFF` 1,006,
`Set_translation` 807, `Set_transparency` 637, `Set_rotation` 315,
`Set_diffuseColor` 218, `Set_Viewpoint` 210, `Set_Arrow2` 169, `Set_center`
128. 4,896 ROUTEs; new target fields `addChildren` / `removeChildren` (170 each).

**Resolved:** part identity. `DocItems` has 68 rows and `rwi/bom/part` 238 -
sample 1's two-row table was a small-procedure artefact, not a format limit.
Q3 confidence → high. Part numbers are recoverable from RapidManual.

**Differences are features, not format** - design for the union and fail
loudly on anything unrecognised rather than dropping it:

- wider PROTO / handler surface: `VMSectionPlane`, `ClippingPlane`,
  `ClippingPlaneCanceller`, `CompositeTexture3D`, `Loupe5`, `ScreenedShape`,
  `PanelImg11`, heavy `Set_Arrow2`; `param_handler` ProgIDs `PanelHtml8` 22,
  `PanelImg8` 16, `CalloutM5` 13 (+ singles);
- 2D illustrations: `.cgm` in the `.vmp` → `.svg` in the published bundle
  (bundle = **5** entries here: `.wrl`, `.interactivity.xml`, `rwi .xml`, 2 × `.svg`);
  consume the bundle's SVG, never parse CGM;
- mixed `.png` / `.PNG` filename case → case-insensitive matching;
- `rwi` has **0** `step` elements (68 `task` only) - `rwi` is BOM + job/task
  index only, never a step source;
- no build-log XML in this archive - treat as optional, skip by root element;
- `IPCCfgVersion` 4.5 vs 5.1, `template_id` 8 vs 12 distinct - read, tolerate,
  never switch on.

**Still opaque, still non-blocking:** `.vmp` keyframe payload internals and
`template_id` semantics (off the published path); the 9-number
`Set_Viewpoint` tuple layout (decode empirically once the parser exists; only
affects the optional "suggested view").

**Decision:** the format is stable across decks; one importer targeting the
published bundle, keeping PROTOs, is viable now. The glTF/X3D republish test
stays worthwhile (it would remove the mesh-parsing half) but is no longer a
prerequisite - the parser is written against a schema that two independent
samples corroborate.

## Stage 2 - importer (implemented)

Code: `sib/src/import/cortona/` - `zip-lite.ts` (stored/deflate ZIP),
`bundle.ts` (solo+zip extraction, magic-byte sniffing), `vrml.ts` (VRML97
parser keeping PROTO/EXTERNPROTO/ROUTE/DEF/USE), `scene.ts` (ObjectVM /
Transform / Switch graph, IndexedFaceSet triangulation, content-hash mesh
dedupe), `glb.ts` (glTF 2.0 binary writer, `cmp:<DEF>` nodes + extras),
`procedure.ts` (Procedure → Step → SubStep → commands, ROUTE binding, PROTO
classification handled / ignored / unknown), `widgets.ts` (callout widgets,
RTF/HTML → text), `interactivity.ts` (`interactivity.xml`, `rwi`),
`importer.ts` (orchestration + content-free log). Route:
`POST /guides/import/cortona?anchorId&createdBy&strict&name` with the raw
`.htm` body. Tests: `sib/test/cortona-import.test.ts` against
`sib/test/cortona-fixture.ts` (synthetic bundle from both samples' schemas).

### Validated on three public Cortona3D demo publications (2026-09-18)

Motorcycle (DITA WI, 22 MB scene), Axle (RWI, 12 MB), Bee drone (S1000D,
131 MB). All import in strict mode with zero unknown PROTOs. What real bytes
changed versus the reconnaissance-based design:

- **The document step is `interactivity.xml` `<Procedure>/<Item>`, not the
  SubStep.** Every spec has two trees: `<Simulation>` (animation atoms -
  "Move the STEM", "Flash the BEARING") and `<Procedure>` whose leaf `<Item>`
  is the human work step ("Apply grease to the stem (1).") listing the
  `<Action>` ids it plays (== SubStep ids). Counts: motorcycle 18 work steps
  for 55 sub-steps, axle 7 / 16, drone 122 / 432. The importer now emits **one
  guide step per leaf Item**, merging its sub-steps' node deltas (last state
  wins; motion spans first `from` → last `to`; insert/remove outrank a plain
  move; durations add; last view kept). SubStep-per-step remains the fallback
  when a publication has no Procedure tree; sub-steps the document never
  references are appended at the end and counted in the log.
- **The first VRML `Step` has `simulate FALSE`** (title "0"): scene set-up
  commands (6 / 43 / 239 sub-steps). Never a guide step.
- **Parametric geometry PROTOs** (`BOX`, `SPHERE`, `CYLNDR`, `TORUS`,
  `WASHER`; `BOXDUMMY` hidden) are built at runtime by an embedded script from
  a few parameters - regenerated in `primitives.ts` so the GLB is complete.
  Hose/cable/rope sweeps (`HoseSplineFlow*`, `VMHose*`, `CableFlat*`,
  `VMRope*`) are not rendered; the log warns with a count.
- Script nodes IS-bind `eventIn`/`eventOut` inside PROTO bodies (parser fix);
  side XML may carry a UTF-8 BOM; `Set_Viewpoint2` ≡ `Set_Viewpoint`;
  `Set_ID` / `Set_emissiveColor` / arrows / dimension lines are ignored
  widgets. RWI numbers its Items ("1", "2"); a numeric section title is
  replaced by the Simulation Step title or the Text's `<h3>` heading line.
- Resource note: the 131 MB scene parses in 3.6 s but peaks at ~1.9 GB RSS
  (token objects). Acceptable for one-off imports; streaming tokenizer if it
  ever matters.

### Command semantics - what the viewer actually does (2026-09-18)

Read from the PROTO bodies, not guessed; the importer reproduces them so a
step plays "part appears → animation → part stays" exactly as in the viewer:

- **PROTO defaults apply to absent fields.** Commands share one interface
  (`key/keyValue/period/objectID/attributeName`); a command that omits a
  field takes the PROTO default (`fieldOr`).
- **`SwitchOFF` is driven by `Parameters`, not `keyValue`.** Default
  `[0,-1]` = turn OFF; explicit `[-1,0]` = turn ON. An empty `keyValue`
  never means hidden.
- **`Set_transparency` default `keyValue [0,1]` = fade out; `[1,0]` = fade
  in.** These commands ROUTE to *Material* DEFs; the scene builder records
  `materialOwners` (material → owning part DEFs) so the delta lands on parts.
- **`period` is a fraction of the SubStep `duration`** (`[start,end,…]`;
  PROTO default duration 5 s). Delta timing is `delaySec = period[0]·duration`,
  `durationSec = (period[1]−period[0])·duration` - seconds, never fractions.
- **One delta per (part, time window)**, chronological. A part that is made
  solid at 0.1 s, faded 0.2–1.0 s and moved 1.5–4.0 s yields three ordered
  deltas; the cumulative engine applies them in array order, last state wins.
- **`Set_diffuseColor` with ≥ 3 keys returning to the start colour is a
  flash** (`effect: "flash"`, no lasting state). Colour changes with two keys
  are highlights.
- Parts hidden in the scene (Switch `whichChoice −1`) plus the set-up Step's
  timeline become `assembly.initialNodes`; the runtime starts from that state.

Runtime (iOS `AssemblyNode.play`): each delta is scheduled at
`delaySec / speed`, applied on its own transaction, and never reverts -
the part stays where the last delta left it. Pending deltas are cancelled
on step change; flash is an emission pulse. The portal Guide Preview uses
the same timeline (`gpAssemblyStateAt`).

Office validation: import both samples through the portal (Import Guide →
choose the `.htm`), then send back only the **import log** (Copy / Download
in the log dialog) - it contains counts, PROTO type names, publish options
and warnings, never text or part numbers. If `protos UNKNOWN` is non-empty,
those names are the next thing to add to `procedure.ts`.

### Office review of two real decks (2026-09-22) - what changed in the importer

An office-side review of two Applied decks (kept there; only the patterns
came back) found four things the demo publications never showed. All four
are now handled, each with a synthetic test:

* **Colour on the `ObjectVM`, not the leaf.** Some publications put an empty
  `Material {}` on the leaf `Shape` and the real `diffuseColor` on the
  enclosing `ObjectVM.appearance`. A leaf whose material carries no colour
  now inherits the nearest ObjectVM's. (`Set_diffuseColor` was already
  honoured as a per-step colour delta.)
* **Upside-down decks.** One deck is authored in a frame where the model is
  inverted and every stored camera carries the compensating ~π rotation; the
  source viewer looks right only through those cameras. The importer now
  reads the cameras (`Viewpoint` + every `Set_Viewpoint`), averages their up
  vectors, and when that mean points down (Y < −0.5) wraps the scene in a
  `__frame` root that rotates the mean up onto +Y. Step views are carried
  into the same frame. Decks whose cameras agree with +Y, or merely look from
  above, are untouched; the log's `frame` block and a warning say when it
  fired. `UpRight=Yes` at publish remains the cleaner fix when available.
* **Part join by DEF.** `DocItem/@id` is the part's DEF in every publication
  seen, while the numeric `objectID` handles need not line up across files.
  Part numbers now join by DEF first and fall back to objectID.
* **Step text fallback.** A work Item without `Text`/`Comment` takes its
  first Action's SubStep text, then the Step's.

"Only the current step's parts visible" is **not** deck data: it is the
viewer's *Context geometry rendering mode* (Material / X-ray / Translucent
shell / Hidden), computed in the viewer engine; only its initial value is
published (`InitialBackgroundObjectsRenderingMode`, `0` = Material in every
deck seen). Everything the author hid or ghosted per step is imported as-is.

### Original plan

From the report we learn, without seeing content: how steps are delimited and
referenced (XML vocabulary), whether part links are `DEF` names or ids, how
step animations are encoded (VRML interpolators + ROUTEs vs. scripted JS
timelines vs. baked per-step `.wrl` files), whether the published HTML carries
a step list (13.1 "Generate Step List File"), units and axis convention, and
whether an AR/REFLEKT scenario file is present. That fixes the adapter design:

| RapidManual | SIB | Adapter work |
|---|---|---|
| `.htm` script block 2 (`solo+zip` base64) | - | extract, unzip, gunzip (magic-byte sniffing) |
| published `.wrl`: `ObjectVM`/`Transform` graph + `IndexedFaceSet` leaves | assembly USDZ, nodes `base` + `cmp:<DEF>` (+ `objectID` as stable key) | own VRML97 parser **with PROTO support** → glTF → USDZ; metres, Y-up; one rigid frame transform per configuration |
| `Procedure → Step → SubStep{duration}` PROTOs | guide steps: 21 SubSteps grouped by Step; `duration` kept | `rapidmanual` source in `instructions-source-adapter` |
| `Set_transparency` / `SwitchOFF` commands + ROUTE targets | `nodes[].show = ghost / hidden / solid` | 83 of 125 commands - do first |
| `Set_translation` / `Set_rotation` (`key`/`keyValue` over `period`) | `nodes[].animate = insert`, `axis`, `travel` from first/last key | 16 commands; intermediate keys dropped in v1 |
| `Set_Viewpoint` (9-number tuple) | optional "suggested view" | decode layout empirically; ignored by tracked-part runtime |
| `interactivity.xml` `Description`/`Comment`/`Text`, `DocItems` | step title/text; part-number enrichment | verify BOM coverage - only 2 rows in the sample |
| callout widgets (`pos`, `Point1/2`, `richtext`/`htmlbody`) | tags bound to nodes; plain text | RTF/HTML → text |
| `rwi` step list | job metadata only | titles are integers - never display |
| `Script` nodes, `PublicPath`, build logs | - | ignored / stripped |

Acceptance: import the sample; the Guide Library shows the steps in order with
text; the Guide Preview plays each step's node presentation on the converted
model; a Procedure Designer round-trip (edit-map) preserves node bindings.

## Stage 3 - validation on the real sample (office side)

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
