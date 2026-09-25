# Request to the RapidManual team - re-publish one procedure with glTF / X3D on

Purpose: find out what Cortona3D's publisher emits when its glTF and X3D output
options are enabled, so our importer can use standard geometry instead of
parsing VRML. Ten minutes for someone who uses RapidManual daily. Nothing
leaves the company network: the outputs go to Karthik / the office Cowork only.

Context they may want: the sample we analysed was published from
RapidManual 13.1 with the publisher (Cortona3D Solo 2.8.0, exporter 2512.x)
configured `GLTF=No`, `X3D=No`, `SingleHTMLBundle=Yes`. We would like the same
procedure published with those first two set to **Yes**.

---

## Hand-off sheet (copy to the RapidManual user)

**What we need:** the same procedure you published as `<title>.htm`, published
again from RapidManual with the glTF and X3D output options enabled, into a
*folder* (not a single-file HTML bundle), so any extra files appear separately.

1. Open the project in RapidManual (the `.vmp`).
2. Start the publish command you normally use for the HTML procedure
   (typically **File ▸ Publish…**, or the Publish button/wizard on the toolbar).
3. In the publish dialog, open the **options / settings** for the HTML
   procedure publication. The options are listed by name; please look for and
   set:
   - **glTF** (may appear as "glTF", "GLTF", "Export glTF", or "Export static
     geometry to glTF") → **Yes / checked**
   - **X3D** (may appear as "X3D", "Export X3D", or "X3D output") → **Yes / checked**
   - **Single HTML bundle** (or "SingleHTMLBundle", "Single-file HTML")
     → **No / unchecked**, so the publication is a folder of files
   - leave everything else as it was.
4. Publish to a new, empty folder, e.g. `C:\cortona-republish\`.
5. Send back **three things** (no procedure content is needed):
   a. a screenshot or list of the *option names* shown in the publish
      options dialog (so we know exactly which options exist in your version),
   b. `dir /s C:\cortona-republish` - the file list with sizes,
   c. **Help ▸ About** version strings for RapidManual and the publisher.
6. If a "glTF" or "X3D" option **does not exist** in the dialog, tell us that -
   it is a useful answer on its own (the option may be a RapidDataConverter /
   Teamcenter feature not present in your edition). If publishing fails with
   those options on, send the error text.

Optional, if easy: also publish once more with the *same* options but
**Single HTML bundle = Yes**, into a second folder, so we can compare.

---

## What we do with it

The office Cowork runs `sib/tools/cortona-recon.py` on `C:\cortona-republish\`
and answers only these questions (content-free, patterns only):

1. Is there a `.gltf`/`.glb`/`.bin` and/or `.x3d` file? Sizes?
2. glTF: number of `nodes`, `meshes`, `animations`, `skins`; do node `name`s
   follow the `A+_A+_A+` slug pattern, a part-number pattern, or hex ids? Is
   there an `extras` block on nodes (key names only)? Any `extensionsUsed`?
3. X3D: does it contain standard `PositionInterpolator` /
   `OrientationInterpolator` / `TimeSensor` / `ROUTE`, or the same
   `Procedure`/`Step`/`SubStep`/`Set_*` PROTOs as the VRML?
4. Does the HTML publication still carry the `solo+zip` payload, or does it
   now reference the glTF/X3D files?

If (2) shows `animations > 0` or (3) shows standard interpolators, the
importer's animation path simplifies substantially. If not, we keep the
PROTO parser for steps/commands and use glTF for geometry only - still a
net win over parsing `IndexedFaceSet`s ourselves.

---

## Larger sample - delta questionnaire for the office Cowork

Run `cortona-recon.py` on the larger sample as before, then answer **only**
these (same confidentiality rules as CORTONA3D-RECON-PROMPT.md; skip anything
that is identical to the first report):

1. Version strings (RapidManual, Solo, exporter) - same or different?
2. Published `solo+zip` ZIP: still exactly 3 entries? Sizes.
3. `Procedure`/`Step`/`SubStep` counts; command histogram (`Set_*`,
   `SwitchOFF`); any command types not seen before.
4. Any `ROUTE` whose target field is not in {translation, rotation,
   transparency, center, diffuseColor, whichChoice, set_viewpoint}.
5. `DocItems` row count vs `ObjectVM` count vs published `DEF` count - does the
   id→part-number table cover more parts this time?
6. Any branching / conditional / `goto`-like construct in `interactivity.xml`
   or the PROTO tree; any `Step` with `simulate = FALSE`.
7. `Set_Viewpoint` 9-number tuples: list 3 tuples with the numbers replaced by
   their *magnitude class* (e.g. `~1`, `~0.01`, `0`, `>10`) so we can infer
   the layout (position / centre / orientation / fov).
8. Callout widget counts by type; any type not seen before.
9. Units/axes reading - still metres, Y-up?
10. New traps (anything under Q13 of the first report that changed).
