# Loading SIB guides in a Unity app

Status: reference, 2026-09-18. Nothing here is built; it records how a Unity
(AR Foundation) client would consume the guides SIB already produces, so the
contract is kept engine-neutral while the iOS runtime evolves.

Proprietary & Confidential · Applied Materials. The guide JSON and the
assembly GLB are SIB output; this document describes their consumption only.

## 0. Start here: the Guide Bundle (2026-09-20)

`GET /guides/:id/bundle` returns everything below in **one** JSON document
(`schema: "sib.guide-bundle/1"`): the guide, its ordered steps, a model
manifest with GLB URLs, the anchor and the frames it offers (QR marker size
and sealed pose, anchor world map, guide world map with reference camera
pose, scanned object), validation references and verdict URLs, and the
playback conventions spelled out. Its JSON Schema is served at
`GET /catalog/schema/guide-bundle` and lives in
`docs/schema/guide-bundle.schema.json`; `sib/test/guide-bundle.test.ts`
builds a bundle and checks it against the schema, so the server cannot drift
from the contract. A new client integrates against the bundle; the sections
below explain what each part means.

## 0a. The contract has a second implementation: `/xr` (2026-09-21)

`sib/portal/xr.html` + `sib/portal/xr-engine.js` is a WebXR client of the
bundle written on the vendored Three.js and the browser's WebXR API — no
engine, no third-party tracking. It is the reference for "did we port §4
correctly": `xr-engine.js` holds the pure state fold and schedule and
`sib/test/xr-engine.test.ts` pins them (cumulative last-write-wins, motion on
a hidden part reveals it, speed division, the 0.8 s / 0.25 s floors,
parents-first ordering, hide-after-motion, flash-only deltas change nothing,
bottom-centre placement). A Unity port should reproduce those tests one for
one. The page also shows what a non-iOS client does for frames: tap-place by
default; the printed QR (WebXR `image-tracking`, size from
`frames.qr.markerSizeM`) confirms identity and places directly only when
`assembly.pose.source === 'config'`. It posts the same live session, events,
observations and sign-off as the iOS app (`docs/catalog/xr-kit.md`).

## 1. What a guide is, engine-neutrally

A converted guide (from Cortona3D or any CAD source) is three things, all
served by SIB over HTTP and none of them Apple-specific:

| Piece | Format | Endpoint |
|---|---|---|
| Assembly model | glTF 2.0 binary (`.glb`), metres, Y-up, right-handed; every part is a node named `cmp:<DEF>` with `extras {type, def, displayName, visible?, objectID?}`; **no normals** (flat shading expected) | `GET /models/:id/file.glb` |
| Guide | JSON: `assembly {modelId, pose?, initialNodes?, bounds?, animationSpeed?}` | `GET /guides/:id` |
| Steps | JSON array, ordered; each step carries `nodes[]` (the timeline deltas), `view?`, `cadPosition?`, text, branch fields | `GET /guides/:id/steps` |

The iOS app (`GLBLoader` → SceneKit) and the portal Guide Preview (Three.js)
consume exactly these. Unity is a third consumer of the same three payloads.
There is no USDZ dependency: USDZ is an iOS-only derivative and Unity should
ignore it.

Authentication is the same as for every SIB client: `X-API-Key` where the
server is key-locked (Render), `X-User-Token` from `/uam/login` when UAM is
on; the company server on the LAN needs neither.

## 2. Loading the model

Use a glTF importer that keeps node names and hierarchy — Unity's `glTFast`
(Unity package, Apache-2.0) does. Requirements the importer must meet:

- Node names must survive verbatim: part control is by name (`cmp:<DEF>`).
  Nothing else in the file is relied on; `extras` are informational.
- Missing normals must be generated (glTFast does this; flat normals are the
  correct look for CAD tessellation — the portal generates them the same way).
- Materials: import as opaque; visibility and ghosting are applied at runtime
  by the client (§4), so the material needs an alpha-capable shader variant or
  a swap to one when a part is ghosted.
- Units: 1 glTF unit = 1 m, which is Unity's unit. `pose.scale` (default 1)
  applies on top.

Handedness: glTF is right-handed, Unity is left-handed. glTFast already
converts the *model* (it negates X by convention). Everything SIB sends
alongside the model — `pose`, `from/to`, `rotationFrom/To`, `cadPosition`,
`bounds`, `view` — is in the glTF (right-handed) frame and must be converted
with the **same** convention the importer used, or the parts will fly the
wrong way. With glTFast's default (negate X):

```
position  (x, y, z)      →  (-x,  y,  z)
quaternion(x, y, z, w)   →  ( x, -y, -z,  w)
axis-angle(ax,ay,az, θ)  →  (-ax, ay, az, -θ)   // or convert to a quaternion first
```

(UnityGLTF, the Khronos importer, negates Z instead: `(x, y, −z)` and
`(−x, −y, z, w)`.) Verify the importer's convention once against a known
part before trusting the helper; then do the conversion in that one helper
for every field and never convert the model twice.

## 3. Placing the assembly

`assembly.pose` is `{position, rotation (quaternion xyzw), scale?, source}` in
the **anchor frame** of the guide. Which physical frame that is depends on how
the guide was placed:

- `source: 'config'` — the chamber configuration's default pose, expressed in
  the anchor's QR-marker frame. A Unity client that tracks the same printed QR
  (AR Foundation image tracking, marker size from the anchor) reproduces it
  directly: `assemblyRoot = qrTransform × pose`.
- `source: 'tap'` — placed by an author in the guide's ARKit world map.
  On iOS, AR Foundation can load that map (`ARKitSessionSubsystem.ApplyWorldMap`
  with `GET /worldmap/guide/:id`), after which the pose is directly in session
  space. On other platforms there is no map; fall back to the anchor QR frame
  when `anchorPose` meta exists (`GET /anchors/:id/worldmap/meta`), else let
  the operator tap-place with the same bottom-centre rule as iOS: the
  bottom-centre of `assembly.bounds` sits on the tapped surface, the model
  origin is `surfacePoint − R·(bottomCentre·scale)`.
- `source: 'partframe'` (future) — the pose is the tracked part frame; a
  Unity client would need its own tracker or take the pose over the wire.

`cadPosition` on a step (a part centroid in the assembly frame) is what the
step pin / callout is attached to: `pinWorld = assemblyRoot × cadPosition`.

## 4. Playing steps — the timeline contract

This is the part worth getting exactly right, because it is what makes the
converted guide behave like the source viewer (part appears → animation →
part stays). The iOS implementation lives in `Services/AssemblyState.swift`
(state engine) and `Components/AssemblyNode.swift` (player); the portal
mirrors it in `gpAssemblyStateAt`. Port those, do not reinvent.

### 4.1 Delta

Each `nodes[]` entry is one delta for one part in one time window:

| Field | Meaning |
|---|---|
| `node` | glTF node name |
| `show` | `hidden` / `ghost` / `solid` (absent = unchanged) |
| `opacity` | ghost alpha (default 0.35) |
| `from`, `to` | translation start/end in the node's *parent* frame, metres |
| `rotationFrom`, `rotationTo` | axis-angle `[x,y,z,rad]` in the parent frame |
| `animate` | `insert` (implies solid), `remove`, `move` |
| `color` | diffuse override `[r,g,b]` (highlight; absent = model colour) |
| `delaySec` | start offset within the step, seconds (source timing) |
| `durationSec` | length, seconds (source timing) |
| `effect` | `flash` — transient emission pulse, leaves no state |

A step may carry several deltas for the same node; array order is
chronological.

### 4.2 State

`PartState = {show, opacity, color?, position?, rotation?}`; `position` /
`rotation` `null` = the model's rest transform.

```
initial      = fold(assembly.initialNodes)         // show and END of motion are the state
state(k)     = initial ⊕ deltas(step 0) ⊕ … ⊕ deltas(step k)   // last write wins
```

`⊕` applies a delta to the map: `show` → show/opacity; `animate=insert` or a
motion on a hidden part → solid; `to` → position; `rotationTo` → rotation;
`color` → color. Flash-only deltas change nothing.

Entering step `k`: jump (no animation) to `state(k−1)` — every part back to
rest, then each explicit state applied **parents first** so a child's own
state overrides its group's — then play `deltas(step k)`.

### 4.3 Playback

```
speed = assembly.animationSpeed ?? 0.5          // author-set, 0.1–3
for d in deltas sorted by (delaySec, depth-in-hierarchy, index):
    at  t = delaySec / speed:
        dur = (durationSec ?? 1) / speed, floored (motion ≥ 0.8 s, visibility ≥ 0.25 s)
        if effect == flash: pulse emission for dur; continue unless d also has state
        if motion: snap to (from ?? current) then tween to (to, rotationTo) over dur
                   if the part was hidden: reveal it as it starts moving
        if show/color: tween material over dur
        if motion AND show == hidden: travel first, hide at the end
        current[node] = resulting state                  // never reverts
total = max(delaySec + dur) / speed                     // loop or advance after this
```

Cancel pending deltas when the step changes. Never use a coroutine that
restores the pre-step pose on completion: the whole point is that the part
stays where the last delta left it.

Visibility in Unity: do not `SetActive(false)` a group that has a solid child
in the same step; set per-renderer material alpha instead and walk the
hierarchy parents-first, exactly as the iOS player does on materials. Ghost =
alpha `opacity`, solid = 1, hidden = renderer disabled *after* its children
were considered.

### 4.4 Interaction that the iOS app exposes (optional parity)

Tap-to-identify (raycast → nearest ancestor named `cmp:*` that is not hidden →
`extras.displayName` / part number), focus pulse on the parts a step is about
(`deltas(k).map(node)`), replay button, step prev/next, and the author-side
speed slider (`PATCH /guides/:id {assemblyAnimationSpeed}`).

## 5. Minimal C# shape

```csharp
// Pseudo-code; field names match the JSON exactly (System.Text.Json / Newtonsoft).
class GuideStepNode { string node; string show; float? opacity; string animate;
    float[] from, to, rotationFrom, rotationTo, color; float? durationSec, delaySec; string effect; }
class GuideAssembly { string modelId; AssemblyPose pose; GuideStepNode[] initialNodes;
    Bounds bounds; float? animationSpeed; }
class AssemblyPose { float[] position, rotation; float? scale; string source; }

// 1. GET /guides/{id}, GET /guides/{id}/steps, GET /models/{modelId}/file.glb
// 2. glTFast: var gltf = new GltfImport(); await gltf.Load(bytes); await gltf.InstantiateMainSceneAsync(root);
// 3. parts = root.GetComponentsInChildren<Transform>().Where(t => t.name.StartsWith("cmp:")).ToDictionary(t => t.name);
// 4. root.SetPositionAndRotation(anchor.TransformPoint(Conv(pose.position)), anchor.rotation * Conv(pose.rotation));
//    root.localScale = Vector3.one * (pose.scale ?? 1);
// 5. engine = new AssemblyStateEngine(assembly.initialNodes, steps);   // §4.2
//    player.Apply(engine.StateAfter(k - 1)); player.Play(steps[k].nodes, speed);   // §4.3
```

## 6. What stays out of Unity's way

- No Vuforia/VisionLib-class tracking is implied by anything above; the
  Unity client tracks the anchor QR (or loads the ARKit map on iOS) with AR
  Foundation only.
- Sessions, evidence, usage log, presence and coach hints are the same REST /
  SSE endpoints the iOS app uses (`docs/catalog/`); none of them assume the
  client platform.
- The `.tag` envelope remains the signed hand-off for equipment identity;
  a Unity client reads it the same way the iOS reader does.
