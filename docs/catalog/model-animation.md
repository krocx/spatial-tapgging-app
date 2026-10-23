---
id: model-animation
name: Built-in animation from imported models (play per step, switch where the author is)
area: guides
status: shipped
version: 2026.4.50
depends: [dynamics-guides-import, cortona3d-import, guide-ingestion]
terms: [Assembly Model]
spec: DYNAMICS-GUIDES-IMPORT.md
api: |
  PATCH /guides/:id/steps/:stepId/node-clip - { node, play, loop? } the author's switch for an object's built-in animation on one step: writes `clip` into the step's delta for that node; the app, the XR kit and the Designer Studio follow it (app · designer · API key)
  GET /guides/:id/bundle - the step deltas in the bundle carry `clip { play, loop }` for every player, including the Unity HoloLens client (browser · app · API key)
wireframe: author
---
Some imported objects carry their own animation inside the model file - a
Dynamics 365 Guides turning arrow or pointing hand is a glTF animation clip
baked in the asset. SIB's own motion is authored per step (insert, remove,
move with keyframes), and until now nobody played the clips: the app's loader
skipped them and neither browser player created a mixer, so an animated
Guides object sat still on every surface.

A step delta now carries `clip { play, loop }` for the node that owns the
clip. The importer sets it for every animated placement; the three players
honour it while the object is shown on that step - a three.js mixer bound
per owning part in Preview 3D, the XR kit and the Designer Studio, and
SceneKit keyframe sampling on the iPad. Authored motion and a clip can
combine; a Cortona or CAD model, having no clips, is untouched.

The switch is wherever the author is looking at the model: on the iPad an
"Animation" row under the step text on Place Steps, on Place Assembly's step
preview and on the guide session's step card - one capsule per animated
object, lit while it plays, tap to switch, saved at once; "Anim." on the
Edit Guide rows. In the Studio a ▷ / ▶ beside every part that owns a clip,
in the parts tree and the Chosen chips, a "1 of 2 animated playing" count in
the step header, and the focus-card button; whichever node of a placement
is selected, the switch lands on its top-level owner, the node every player
reads. The placed assembly now also shows on Place Steps, playing the
active step, so pins are placed against the model the operator will see.
