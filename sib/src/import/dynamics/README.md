# Dynamics 365 Guides `.guide` importer

Reads the package "Export guide" writes and maps it onto SIB's existing
guide model (`ImportedGuide` + `GuideAssembly` + per-step `nodes[]`). No
parallel model: anything SIB has no place for is reported as unmapped.
Product view: `docs/DYNAMICS-GUIDES-IMPORT.md`. Backlog: AROMS-364..367.

## Files

| File | Does |
|---|---|
| `tar.ts` | Safe POSIX tar reader. Flat names only; refuses `/`, `..`, links, devices, control characters, over-count / oversize entries, bad checksums. GNU long names handled. `parseEntryName` → kind / part / GUID / ETag. |
| `enums.ts` | Every option-set value in one place (`9373800xx`), `labelOf`, `styleToNode` (raw value first, FormattedValue label as fallback, never a throw), stock-hologram names. |
| `body.ts` | `Guide_Body` OData JSON → `GuideRoot` (tasks, steps + responses + attention, step objects, placements, completion objects). Missing arrays = empty + a `missing` entry; unknown root keys counted. `orderByPrevious` walks the previous-task / previous-step chains and tolerates cycles, dangling links and several heads. |
| `assets.ts` | Magic-byte sniffing (glb / gltf / png / jpeg / mp4 / webm / mp3 / wav); Unity left-handed → right-handed conversion behind `FrameConversion{flipZ}`; quaternion → axis-angle. |
| `glb-merge.ts` | N GLBs + placement specs → one GLB. Meshes / materials / textures shared per asset, one node subtree per placement named `pl:<placementGuid>` (extras: asset GUID, style, step), animations and skins re-targeted, `KHR_materials_pbrSpecularGlossiness` folded to metallic-roughness, a default material where a primitive has none, external URIs refused, world bounds computed. |
| `importer.ts` | `importGuidePackage(bytes, opts)` - the mapping, the report (`DynamicsImportReport`) and `reportText`. |
| `fixture.ts` | Declarative synthetic package builder for tests and `--make-sample` (tiny GLBs incl. animated / spec-gloss / no-material / corrupt, tiny PNG / JPEG / MP4, exact entry names and OData shapes, shuffle, drop arrays, unknown enums, dangling links…). Not used in production. |

Wiring: `import/jobs.ts` + `worker.ts` (kind `dynamics`, same one-at-a-time
queue as Cortona), `routes/guides.ts` (`POST /guides/import/dynamics`,
shared apply / discard, step images written beside their steps, report and
provenance kept in the import log), `adapters/dynamics-guides-adapter.ts`
(`sourceType: 'dynamics'` on the generic `POST /guides/import` - text only),
`scripts/guide-inspect.mjs` (`npm run guide:inspect`).

## Mapping

| Guides | SIB |
|---|---|
| task | `section` (step title = task name) |
| step text | `text` |
| question responses | 1st acting → `nextOnSuccessSeq` (omitted when it is simply the next step), 2nd → `nextOnFailureSeq`; a 3rd+ counted as `foldedToLinear`; texts appended as `1. … 2. …` |
| completion step | last step, `completionRequired`, `evidenceRequired`; its objects shown |
| placement (`isPlaced` only) | node `pl:<guid>` (the web player's `isPartName` and the server's `models/colour.ts` accept `cmp:*` and top-level `pl:*`), TRS converted, `label` = the asset's display name; per step: hide the previous step's nodes, show mine with style → `show: solid | ghost`, `color` |
| attention director at a placement / position | `effect: 'flash'` on that node, `cadPosition`; else the centroid of the step's shown nodes |
| step image | out of the package, by sequence number, into the step-image store (route layer) |
| `GuideAssembly` | `modelId`, `initialNodes` (everything hidden), `bounds`, `source: 'dynamics'` |

Option sets, as read: step template 937380000 Default / 001 Question / 002
Completion; response action 937380000 NoAction / 001 GoToNextStep / 002
GoToStep; object style 937380000 Original … 007 XRay … 009 Green; anchor
type 937380000 Holographic. Unknown values fall back to the FormattedValue
label (`labelsUsed`), then to a safe default (`unknownValues`), with a
warning.

Coordinates: Guides placements are in the Guides anchor frame (Unity,
left-handed, Y up, metres). `convertPosition` → `(x, y, −z)`,
`convertRotation` → `(−x, −y, z, w)`, scale unchanged. Placement quaternions go through `normalizeQuat` first: a (0,0,0,0) or non-finite rotation (seen on every placement of a real guide) becomes identity and is counted as `objects.rotationRepaired` - SceneKit would otherwise build a zero matrix and draw nothing. The SIB assembly
frame is right-handed Y up; the author places the assembly at the QR.
`flipZ: false` keeps the source frame (diagnosis only).

## Rules

- **Content-free logs.** Nothing at info level carries instruction text,
  asset names or URLs - counts, labels and GUIDs only. The report must stay
  that way (the golden test checks for leaks).
- **No real guides** in the repo or the tests; `fixture.ts` builds every
  package the suite needs.
- Limits: `DEFAULT_TAR_LIMITS` (2000 entries, 512 MB per entry, 1.5 GB
  total) and the route's 600 MB body cap; the worker's heap cap catches the
  rest without taking the service down.

## Tests

`sib/test/dynamics-import.test.ts` - one test per layer (tar, names,
ordering, enums, coordinates, sniffing, merge) and the nine scenarios
(minimal; shuffled; question across tasks; many objects incl. unplaced /
Invisible / unknown style; media + attention; completion objects; anchor
types; corrupt and edge cases; malicious tars) plus a golden report-shape
and content-leak check.

## Known gaps (reported as unmapped, not imported)

Triggers (step / object), interactables, the anchor 3D object, animation
mode / speed / direction / take, videos and audio, the folder hierarchy,
localisation tables, `Invisible` as a behaviour (imported hidden, or dropped
with `invisible: 'drop'`). Step pictures that are PNG are stored and served
as the step-image store does every imported image (`.jpg` name,
`image/jpeg` header - clients sniff).
