# AppliedX iconography

Generated 2026-09-10 from `sib/roadmap-client/src/utils/icons.ts` by `npm run icons:doc` — do not edit by hand.

60 icons · 24×24 grid · 2 px round strokes · `stroke=currentColor`, `fill=none`. Rendered in-app by `components/Icon.tsx`; node cards draw the same path in white at 0.75 scale. Rendered sheet: [docs/iconography.html](iconography.html).

## Rules

- One path per icon, drawn on the 24-grid with 2 px optical weight; no fills, no emoji, no icon fonts.
- Names are lowercase, hyphenated; step glyphs are prefixed `step-`.
- Fab vocabulary first: chamber, wafer, gas line, breaker, torque, lockout, evidence, ME, technician, Production #.
- Add an icon → add path + meta in icons.ts → `npm run icons:doc` → `npm run build:roadmap`.

## Node icons — pickable in the Inspector

| Name | Label | Used in | Path |
|---|---|---|---|
| `flag` | Flag | Inspector icon grid | `M6 21V4h11l-2 3.5 2 3.5H6` |
| `star` | Star | Inspector icon grid | `M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z` |
| `bolt` | Bolt | Inspector icon grid | `M13 2.5 5.5 13.5H11l-1 8 7.5-11h-5.5z` |
| `gear` | Gear | Inspector icon grid | `M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z` |
| `eye` | Eye | Inspector icon grid | `M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z` |
| `camera` | Camera | Inspector icon grid | `M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z` |
| `cube` | Cube | Inspector icon grid | `M12 2.5 20.5 7v10L12 21.5 3.5 17V7zM12 12l8.5-5M12 12 3.5 7M12 12v9.5` |
| `robot` | Robot / cobot | Inspector icon grid | `M12 2.5v3M8 5.5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3zm1 6h.01M15 11.5h.01M9.5 15.5h5M2.5 12h2.5m14 0h2.5` |
| `wrench` | Wrench | Inspector icon grid | `M20.5 6.5a5 5 0 0 1-6.6 6.1L7.2 19.3a2.1 2.1 0 0 1-3-3l6.7-6.7A5 5 0 0 1 17 3l-3 3 .5 3 3 .5z` |
| `chip` | Chip | Inspector icon grid | `M8.5 8.5h7v7h-7zM5 5h14v14H5zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3` |
| `qr` | QR code | Inspector icon grid | `M3.5 3.5h7v7h-7zm2 2h3v3h-3zm8-2h7v7h-7zm2 2h3v3h-3zm-12 8h7v7h-7zm2 2h3v3h-3zm8-2h3v3h-3zm4 0h3m-3 4h3v3h-3m-4-3v3h3` |
| `tag` | Tag | Inspector icon grid | `M3.5 3.5h7.6l9.4 9.4-7.6 7.6-9.4-9.4zM8 8h.01` |
| `check` | Check | Inspector icon grid | `M4.5 12.5 9.5 17.5 19.5 7` |
| `alert` | Alert | Inspector icon grid | `M12 3.5 21.5 20h-19zM12 9.5v4.5m0 3v.5` |
| `bulb` | Idea | Inspector icon grid | `M9.5 18.5h5M10 21h4M8 10.5a4 4 0 1 1 8 0c0 1.6-.9 2.6-1.6 3.4-.6.7-.9 1.4-.9 2.1h-3c0-.7-.3-1.4-.9-2.1C8.9 13.1 8 12.1 8 10.5z` |
| `target` | Target | Inspector icon grid | `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z` |
| `layers` | Layers | Inspector icon grid | `M12 3.5 21 8l-9 4.5L3 8zM3 12l9 4.5 9-4.5M3 16l9 4.5 9-4.5` |
| `doc` | Document | Inspector icon grid | `M6.5 2.5h7l4.5 4.5v14.5h-11.5zM13.5 2.5v4.5H18M9.5 12.5h5m-5 3.5h5` |
| `user` | Person | Inspector icon grid | `M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c0-3.5 3.4-5.5 7.5-5.5s7.5 2 7.5 5.5` |
| `clock` | Clock | Inspector icon grid | `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13.5V12l3.5 2` |
| `chamber` | Chamber | Inspector icon grid | `M5 8.5h14M5 8.5v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M5 8.5 7 5h10l2 3.5M9 12.5h6M12 19v2.5` |
| `wafer` | Wafer | Inspector icon grid | `M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM6 8.5h12M6 15.5h12M9 5v14M15 5v14` |
| `gasline` | Gas line | Inspector icon grid | `M2.5 9h4.5l2 3-2 3H2.5M21.5 9H17l-2 3 2 3h4.5M9 12h6M12 5.5V8m0 8v2.5M10 5.5h4m-4 13h4` |
| `breaker` | Breaker | Inspector icon grid | `M7 3.5h10v17H7zM12 8v3m-2 0h4M12 15.5h.01M9.5 19.5h5` |
| `torque` | Torque | Inspector icon grid | `M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.5 8.5A8.5 8.5 0 1 0 20.5 12M20.5 5v3.5H17` |
| `lockout` | Lockout (LOTO) | Inspector icon grid | `M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13zM12 14.5v3` |
| `evidence` | Evidence photo | Inspector icon grid | `M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8zm5.5 5.5 2 2 4-4` |
| `voice` | Voice | Inspector icon grid | `M12 15.5a3 3 0 0 0 3-3v-6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4m-3 0h6` |
| `ghost` | Ghost model | Inspector icon grid | `M6 21V10a6 6 0 1 1 12 0v11l-2.5-2-2.5 2-2.5-2L8 21zm3.5-10h.01M14.5 11h.01` |
| `checklist` | Checklist | Inspector icon grid | `M4 6.5 5.5 8 8 5.5M4 12.5 5.5 14 8 11.5M4 18.5 5.5 20 8 17.5M11 6.5h9M11 12.5h9M11 18.5h9` |
| `engineer` | ME | Inspector icon grid | `M6.5 9.5a5.5 5.5 0 0 1 11 0M4 9.5h16M12 3.5v1.5M8 9.5a4 4 0 0 0 8 0M5 20.5c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5` |
| `technician` | Technician | Inspector icon grid | `M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20.5c0-3.3 2.9-5.5 6.5-5.5 1.2 0 2.3.2 3.2.7M20.5 14.5a2.5 2.5 0 0 1-3.3 3.3L15 20.1a1.3 1.3 0 0 1-1.9-1.9l2.3-2.2a2.5 2.5 0 0 1 3.3-3.3l-1.5 1.5.4 1.4 1.4.4z` |
| `hazard` | Hazard | Inspector icon grid | `M12 3.5 21.5 20h-19zM12 9.5v4.5m0 3v.5` |
| `esd` | ESD | Inspector icon grid | `M13 3 6.5 13H12l-1 8 6.5-10H12z` |
| `vacuum` | Vacuum | Inspector icon grid | `M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5v9m-4.5-4.5h9M8.8 8.8l6.4 6.4m0-6.4-6.4 6.4` |
| `clean` | Clean | Inspector icon grid | `M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8zM5 18.5l1 1m12-1-1 1M12 19v2` |
| `timer` | Timer | Inspector icon grid | `M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-12v4l2.5 1.5M9.5 2.5h5M19 5l1.5 1.5` |
| `production` | Production # | Inspector icon grid | `M4 20.5V9l5 3V9l5 3V9l6 3.5v8zM8 16.5h.01M12 16.5h.01M16 16.5h.01` |
| `pin` | Spatial pin | Inspector icon grid | `M12 21.5s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z` |
| `scan` | Scan | Inspector icon grid | `M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16M4 12h16` |

## Step content glyphs — procedure node pill

| Name | Label | Used in | Path |
|---|---|---|---|
| `step-voice` | Step has voice | NodeView step pill | `M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11` |
| `step-image` | Step has image | NodeView step pill | `M4 5.5h16v13H4zM4 15l4.5-4.5 4 4 2.5-2.5 5 5M16 9.5h.01` |
| `step-model` | Step has 3D model | NodeView step pill | `M12 2.5 20.5 7v10L12 21.5 3.5 17V7zM12 12l8.5-5M12 12 3.5 7M12 12v9.5` |

## UI chrome — toolbar, map list, panels, issues

| Name | Label | Used in | Path |
|---|---|---|---|
| `book` | Dictionary | Toolbar, GlossaryPanel, Inspector dictionary block | `M4 4.5h6a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4zM20 4.5h-6a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20z` |
| `person` | Your name | MapList identity | `M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c0-3.5 3.4-5.5 7.5-5.5s7.5 2 7.5 5.5` |
| `file` | Import JSON | MapList menu | `M6.5 2.5h7l4.5 4.5v14.5h-11.5zM13.5 2.5v4.5H18` |
| `photo` | From whiteboard photo | MapList menu | `M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z` |
| `key` | Unlock draft | MapList menu | `M7 17.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm4.5-4.5H21m-3 0v3m-3-3v2.5` |
| `lock` | Draft | Toolbar, MapList draft badge | `M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13zM12 14.5v3` |
| `map` | Roadmap | MapList door + row | `M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20` |
| `procedure` | Procedure | MapList door + row | `M4 5.5h6v5H4zM14 13.5h6v5h-6zM10 8h4v8h-4z M7 10.5V13h3` |
| `restart` | Run again | PreviewPanel | `M4 12a8 8 0 1 0 2.3-5.6M4 4.5V9h4.5` |
| `undo` | Undo | Toolbar | `M8 7.5H4v-4M4 7.5A8.5 8.5 0 1 1 3.5 12` |
| `redo` | Redo | Toolbar | `M16 7.5h4v-4M20 7.5A8.5 8.5 0 1 0 20.5 12` |
| `sun` | Day theme | Toolbar | `M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4` |
| `moon` | Night theme | Toolbar | `M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z` |
| `warning` | Warning | ProcedureBar chip, NodeView issue bubble | `M12 3.5 21.5 20h-19zM12 9.5v4.5m0 3v.5` |
| `error` | Error | ProcedureBar chip, NodeView issue bubble | `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 8.5l7 7m0-7-7 7` |
| `link` | Reference link | PreviewPanel | `M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1` |
| `blocked` | Blocked by precondition | PreviewPanel | `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8` |

