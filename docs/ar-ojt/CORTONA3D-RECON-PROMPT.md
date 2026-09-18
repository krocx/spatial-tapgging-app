# Prompt for the office Cowork — Cortona3D export structural findings

Copy everything below the line into the office Cowork, with the folder that
contains the `.vmp`, the `.htm` (+ its asset folder) and `recon/report.md`,
`recon/report.json` connected. The answer it produces is safe to forward.

---

You are helping an engineer design an importer for Cortona3D RapidManual
exports into our own AR platform. In the connected folder you have a RapidManual
project file (`.vmp`), a published HTML procedure (`.htm` plus its asset
folder), and a structural report (`recon/report.md`, `recon/report.json`)
produced by a script that deliberately removed all content.

Produce a **findings report** that describes the *structure and encoding* of
these files so the importer can be written without access to them.

**Strict confidentiality rule:** the report must contain **no procedure
content**. Do not include step text, titles, part numbers, part names,
descriptions, coordinates, callout text, image contents, file names that
contain part numbers, or the equipment name. Describe *names of elements,
attributes, node types, keys and file types*, counts, and patterns (write
identifiers as patterns: letters→A, digits→9, e.g. `AA_9999-99999`). When you
need to show an example, show the **skeleton with values replaced by their type**
(`<step id="id" duration="float"><title>text</title>…`). If in doubt, leave it
out and say "omitted (content)".

Answer these questions in order, each with a short heading. Say "not present"
or "could not determine" where that is the truth — do not guess.

1. **Container.** Is the `.vmp` a ZIP? List the entry types inside it (by
   extension) with counts and approximate sizes. Is there an obvious project
   manifest (XML/JSON) at the root? Give its root element name and its top-level
   child element names.

2. **Geometry files.** Which format(s) carry 3D geometry (`.wrl` VRML97,
   `.x3d`, `.x3dv`, other)? One file or many? If many, how are they related to
   steps (one per step? one master + per-step overrides?). Header line of one
   file (e.g. `#VRML V2.0 utf8`).

3. **Part identity.** How are parts named in the geometry — VRML `DEF` names?
   Metadata nodes? Give the `DEF` name **pattern(s)** and say whether they look
   like CAD part numbers, internal IDs, or both. Is there a mapping table
   anywhere (XML/JSON) from internal ID → part number → display name? If so,
   give its element/key names (not values).

4. **Hierarchy.** Do `Transform` nodes nest to reflect the assembly tree, or is
   the scene flat? Is there a single root node for the base part? What is the
   nesting depth, roughly?

5. **Units and axes.** From translation magnitudes and any explicit unit
   declarations, are coordinates in millimetres or metres? Which axis is "up"
   (any `viewpoint`/`Viewpoint` orientation, or a documented convention)?

6. **Animations — where do they live?** This is the most important question.
   Choose all that apply and give evidence (node/element/key names, counts):
   (a) VRML `PositionInterpolator` / `OrientationInterpolator` + `TimeSensor`
   + `ROUTE` statements inside the geometry file(s);
   (b) per-step geometry files with parts already displaced (baked poses);
   (c) a JavaScript/JSON timeline in the published HTML assets (give the key
   names of one animation record, e.g. `{part:id, from:vec3, to:vec3, t:float}`);
   (d) an XML animation/step document (give element and attribute names);
   (e) something else.
   For each mechanism, how is a part linked to its animation — by `DEF` name,
   by numeric id, by node path?

7. **Steps.** Which file defines the step sequence? Give the element/key names
   for: step id, step order, step title/text (name only, not content), which
   parts are involved, duration, and any next/previous or branching links. Is
   there a separate "step list" file (RapidAuthor 13.1 "Generate Step List
   File")? Total number of steps (a count is fine).

8. **Callouts / POIs / 3D annotations.** Are there 3D-positioned annotations
   (callouts, points of interest, hotspots, XML callouts)? Give element/key
   names and whether positions are in model coordinates or screen coordinates.
   Count only.

9. **Viewpoints / cameras.** Are per-step camera viewpoints stored? Element or
   node name and count.

10. **Publication runtime.** Does the `.htm` play the 3D via a browser
    plugin/ActiveX (Cortona3D Viewer), via a JavaScript viewer bundled in the
    asset folder (list the script file names), or via a hosted viewer URL
    (domain only)? Does the page load the `.vmp` directly or converted assets?

11. **AR / REFLEKT scenario.** Is there any AR-specific export (files or
    elements mentioning AR, REFLEKT, tracking, POI, information screen)? Give
    file types and element/key names only.

12. **Media.** Counts by type of images/video/audio referenced by steps, and
    how they are referenced (element/attribute names).

13. **Anything unusual** an importer would trip on: encrypted or compressed
    entries, binary blobs, proprietary node types (list the node type names
    that are not standard VRML97/X3D), external references to files not in the
    folder, non-UTF-8 encodings.

Finish with a **10-line summary** of the recommended import path in your own
words, and a **confidence note** for each of questions 3, 6 and 7 (high /
medium / low, and why).

Before sending, re-read your report once and remove anything that could
identify the equipment, a part, or a procedure step. Patterns and names of
structural elements are fine; values are not.
