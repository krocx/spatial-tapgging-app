# Device profiles

One file per wearable, YAML frontmatter, read by `GET /devices` and joined
with each step's needs into the readiness matrix (guide menu → Device
readiness). A new headset is a new file, not a release.

Fields: `id` (kebab-case, stable), `name`, `display` (full | small | text |
none), `overlay` (3d | reduced | none), `input` ([touch, voice, ring,
trackpad, gaze, hands, controller, mouse, buttons]), `delivery` (app | xrkit |
companion-text | spoken), `notes`. See
docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md for the rules that use them.

`hands` (tracked | pinch) says what the XR kit's hand input can do on the
device: `tracked` gives joints (the four held gestures, the part lighting as
the hand approaches, the wrist card, grab to inspect, hands-at-the-part
evidence); `pinch` is pinch-as-select only.

The device gallery (`/devices/gallery`) reads the same files and adds, all
optional: `class` (handheld | binocular-headset | binocular-glasses |
monocular | no-display - the grouping by eye), `what` (one plain sentence),
`displaySpec`, `fov`, `weight`, `battery`, `cleanroom` (what matters on the
floor), `poc` (how SIB runs it), `officialUrl` (the maker's page, the "Learn
more" link), `specSource` (where the figures came from and when they were
read - the card prints it, so nothing is unsourced), and the picture:
`image` (a file name served from `/devices-media/`: put it in
`DATA_DIR/devices/media/` on the server, outside git, or in
`sib/portal/devices-media/`; use the maker's press image only if its usage
terms allow it, and say so in the credit),
`imageCredit` and `imageCreditUrl` (printed under the picture). Without an
image the card shows the class icon.
