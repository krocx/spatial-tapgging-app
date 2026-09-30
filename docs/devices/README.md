# Device profiles

One file per wearable, YAML frontmatter, read by `GET /devices` and joined
with each step's needs into the readiness matrix (guide menu → Device
readiness). A new headset is a new file, not a release.

Fields: `id` (kebab-case, stable), `name`, `display` (full | small | text |
none), `overlay` (3d | reduced | none), `input` ([touch, voice, ring,
trackpad, gaze, hands, controller, mouse]), `delivery` (app | xrkit |
companion-text | spoken), `notes`. See
docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md for the rules that use them.
