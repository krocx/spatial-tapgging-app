# The SIB design system — doctrine

Status: slice 1 shipped 2026-09-21 (`sib/portal/brand/`, `/brand`, `brand:check`),
re-based on the iPad app's look the same day; slice 2 (the Portal) shipped
2026-09-21. Slice 3 migrates the remaining pages; slice 4 lands the same
tokens in the iPad app.

Proprietary & Confidential · Applied Materials.

## Why a system, not a theme

Every SIB web surface used to carry its own palette, and all of them looked
like the dashboard any assistant generates by default: navy, electric blue,
glass blur, emoji for icons. People who had produced one of those themselves
saw ours and said "same thing". Meanwhile the iPad app already had a look
the team likes and will not change. So the system is that look, transcribed
to the web, written down once, enforced automatically, and carrying a few
signatures — the wordmark, the registration mark, lock-in, the AR rim — that
a template cannot copy.

## The direction: the app is the reference

The iPad app already has a look people like and will not change. SIB carries
it to the web exactly: the kiosk's charcoal gradient, 8 %-white cards with an
accent stroke and 18-pt corners, white text in the app's opacity tiers
(100 / 70 / 50 / 35 %), the iOS system accents in their dark appearance, the
blue→cyan title gradient, capsule chips, 14-pt CTAs and 12-pt fields. If the
app does it, SIB does it; if the app doesn't, SIB doesn't invent it. On top
of that, four signatures make a SIB page unmistakably ours:

* **The registration mark** — four brackets closing on a target. It is the
  QR finder square, the wafer alignment cross and the AR anchor at once. It is
  the focus ring, the loading state, the section marker and the wordmark's
  dot. `<span class="ax-mark"><i></i><em></em></span>`.
* **Lock-in** — elements *register* (scale 1.35 → 1, 220 ms, the brand
  ease). Nothing fades or slides.
* **The rim-light** — in AR, green breathes around the part to look at, the
  same highlight the iPad app draws on the 3D model.
* **The wordmark** — `appliedx`, lowercase, *applied* in `66B3FF` and *x* in
  `35C635`, regular weight, on every surface; those two colours belong to the
  wordmark alone.

## Colour — the app's palette, transcribed

| Token | Value | In the app | Meaning |
|---|---|---|---|
| `--ax-bg` → `--ax-bg-2` | `121212` → `1F1F1F` | `Color(white: 0.07)` → `0.12` gradient | the page |
| `--ax-paper` | white 8 % | `Color.white.opacity(0.08)` | cards, doors, rows |
| `--ax-rule` | white 15 % | strokes | hairlines |
| `--ax-ink` / `-2` / `-3` / `-4` | white 100 / 70 / 50 / 35 % | `.white.opacity(…)` | text tiers |
| `--ax-blue` | `0A84FF` | `.blue` | actions · Author · Spatial Inspection |
| `--ax-cyan` | `64D2FF` | `.cyan` | title gradient · links · Portal |
| `--ax-green` | `30D158` | `.green` | AR OMS · verified · AR rim |
| `--ax-orange` | `FF9F0A` | `.orange` | Gemba Audit · checking / attention |
| `--ax-red` | `FF453A` | `.red` | iLOTO · failure · destructive |
| `--ax-indigo` / `--ax-teal` | `5E5CE6` / `40C8E0` | `.indigo` / `.teal` | Procedure Designer · hub features |
| `--ax-wm-blue` / `--ax-wm-green` | `66B3FF` / `35C635` | the wordmark | *applied* / *x* only |

Status follows the app: green verified, orange attention, red failure. A
colour is never decoration — every hue has one meaning, and there is no hue
the app does not have.

Products (`--ax-p-*`): Spatial Inspection blue, AR OMS green, iLOTO red,
Gemba Audit orange, Procedure Designer indigo, Portal cyan, Platform grey —
the door colours, carried to chips, cards, diagram bars and the catalogue map.

## Type — Arial, the company standard, at the team library scale

Heading Bold 24/32 · Title Medium 22/30 and 20/28 · Label Medium 16 ·
Regular 16 · Regular 13 · LABEL 12 caps tracked · Paragraph 14/21 Regular /
Medium / Bold. Arial ships with Windows, macOS and iPadOS, so nothing is
vendored and the LAN server needs no internet; Arial is not redistributable,
so on Android / headset browsers the stack falls to Liberation Sans
(metric-compatible) or the system sans. Identifiers, part numbers and every
number in a table use the platform monospace (`--ax-mono`).

## Where it lives

```
sib/portal/brand/
  tokens.css        every colour, size, duration — the only place a value is written
  components.css    .ax-btn .ax-chip .ax-card .ax-table .ax-notice .ax-mark … one implementation each
  brand.css         the single include:  <link rel="stylesheet" href="/portal/brand/brand.css">  + class="ax" on <html>
  icons.svg         the sprite: AppliedX icon library + the UI set that replaces every emoji
sib/portal/brand.html   → /brand   the living style guide, rendered from the same CSS
scripts/brand-icons.mjs  npm run brand:icons   (source: roadmap-client icons.ts + UI set)
scripts/brand-check.mjs  npm run brand:check   (fails on drift — see below)
```

In AR (over live video) scope a subtree with `data-surface="ar"`: cards
become opaque near-black and `.ax-rim` is the breathing green outline on the
part to look at.

## Rules — enforced by `npm run brand:check`

Governed files (the list in `brand-check.mjs` grows as pages migrate) may not
contain: a hex or rgb colour outside `tokens.css`; an emoji; `backdrop-filter`;
a gradient written in a page (the page and title gradients are tokens); a
`box-shadow` that is not the token ring/rim; a `font-family` outside the brand
stack; a border-radius that is not one of the app's (18 · 14 · 12 · capsule).
A line may carry `/* brand-check: allow */` for a justified exception, which
a reviewer will see.

For anyone generating code in this repo — including assistants — the short
form is in `CLAUDE.md` at the repo root: tokens only, sprite icons only, the
mark and lock-in, the app's corners and colours, no glass, no emoji.

## Portal patterns — every element earns its place

The tokens make the portal look like the app; these patterns make it *behave*
like it. Chambers (Anchors) is the reference page; every list page adopts the
same shape, and each decision below carries its reason so the next page is
built from the pattern, not reinvented.

**The page has one job.** Chambers answers "what is the state of my fleet, and
take me to one" — nothing else. Everything on the page serves that; anything
that doesn't (the QR code on every card, the UUID as a title, six equal
buttons per chamber) was removed or moved.

**A list, not a gallery.** Many things with the same fields want rows: the
eye compares down a column, and a scan of the *Origin* and *Tags* columns
finds the chamber that needs attention without reading. Cards are for a few
things that differ in kind (the Home doors), never for a fleet.

**Only what changes a decision is a column.** Name · configuration · origin
(sealed / not sealed / object) · tags (n · trained) · lab median · last
activity. IDs, creation dates and internal codes are not decisions; they live
in the panel, in mono, with a copy button.

**One primary per screen.** *New chamber* in the header is the only filled
blue button. Every row action sits in a `⋯` menu — reachable, never
shouting. Destructive actions are quiet, red only in colour, always behind a
confirmation that says what will be lost. *Delete all* is not on the page at
all; it is a danger-zone action in Admin next to Backups.

**Detail opens beside the list.** Clicking a row opens the chamber in a
panel on the same page (`.ax-lockin` arrival, the app's signature), so the
place in the list is never lost. The panel holds the QR at print-preview size
with the one thing you do with it (Print), the origin state, the
configuration, the tag list with edit / delete, and the quiet actions.
Esc closes, ↑ ↓ move between rows, Enter opens.

**Empty states say the next step.** "No chambers yet — create the first one
and print its code" with the button that does it. A filtered-empty list says
what was filtered, never a generic "nothing found".

**Copy in the app's voice.** Chamber, not anchor, in user-facing text (Lab
rigs are called that). Sentence case. No internal codes (`ASSET_FRAME`,
`QR`), no jargon a technician wouldn't say.

**Nothing decorative.** No icon that doesn't identify, no chip that doesn't
carry a state, no animation that doesn't confirm something real. The
registration mark marks loading and empty; the wordmark is the only
flourish.

Adoption order: Chambers (shipped) → Guide Library → Sessions → the Lab
modal → Admin pages.

## Migration plan

1. **Slice 1 (this):** `brand/`, `/brand`, icon sprite, checker, doctrine. No existing page touched.
2. **Slice 2 (shipped):** the Portal (`index.html`, incl. the Intelligence page) — the most seen. It dropped its own palette, imports `brand.css`, swapped 175 emoji for sprite icons, and joined the governed list.
3. **Slice 3:** Catalogue, Platform, Wireframe, Roadmap client, XR kit, Home, Unlock — same recipe, one page at a time.
4. **Slice 4:** `Brand.swift` in the iPad app — no visual change; it names the values the app already uses so both sides read one list.
