# The SIB design system — doctrine

Status: slice 1 shipped 2026-09-21 (`sib/portal/brand/`, `/brand`, `brand:check`).
Slices 2–3 migrate the pages; slice 4 lands the same tokens in the iPad app.

Proprietary & Confidential · Applied Materials.

## Why a system, not a theme

Every SIB web surface used to carry its own palette, and all of them looked
like the dashboard any assistant generates by default: dark navy, electric
blue, glass blur, rounded cards, emoji for icons. People who had produced
one of those themselves saw ours and said "same thing". The remedy is not a
different colour; it is a language derived from what SIB *is*, written down
once, enforced automatically, and deep enough that copying the CSS gets the
skin and not the system.

## The direction: Cleanroom

Light paper, hairline rules, near-square corners, no shadows, no glass, no
gradients — the room the product lives in. One motif and one motion carry
recognition:

* **The registration mark** — four brackets closing on a target. It is the
  QR finder square, the wafer alignment cross and the AR anchor at once. It is
  the focus ring, the loading state, the section marker and the wordmark's
  dot. `<span class="ax-mark"><i></i><em></em></span>`.
* **Lock-in** — elements *register* (scale 1.35 → 1, 220 ms, the brand
  ease). Nothing fades or slides. In AR only, the **rim-light** in Warm green
  breathes around the part to look at — the same highlight the iPad app
  draws on the 3D model.

## Colour — the Applied team library, used the way its note asks

| Token | Value | Role |
|---|---|---|
| `--ax-bg` / `--ax-paper` | `F8F9FA` / `FFFFFF` | page / surfaces |
| `--ax-rule` | `DADCE0` | hairlines (elevation is a hairline) |
| `--ax-ink` / `-2` / `-3` | `222528` / `404040` / `6F6F6F` | text |
| `--ax-blue` | `2675C4` | Primary blue — the mark, primary actions, product Spatial Inspection (4.75:1) |
| `--ax-blue-ink` | `1B5A9A` | small text, **warnings** (7.1:1) |
| `--ax-focus` | `66B3FF` | Focus blue — rings, halos, wordmark "applied". **Never text** (2.2:1) |
| `--ax-green` | `35C635` | Warm green — fills, borders, wordmark "x", AR rim. **Never text** (2.3:1) |
| `--ax-green-ink` | `1E7F21` | verified / anchored / pass text (5.1:1) |
| `--ax-bad` | `B3261E` | the one red: real failures, destructive actions |

There is **no orange** in the system. Warnings are deep blue ink with the
mark. The only orange is the Gemba Audit product colour, kept — with iLOTO's
red — because users already know them from the app.

Products (`--ax-p-*`): Spatial Inspection `2675C4`, AR OMS `1E7F21`, iLOTO
`EF4444`, Gemba Audit `F59E0B`, Procedure Designer `4D5BC9`, Portal
`5B7C9C`, Platform `6F6F6F`. The same colour on the catalogue map, the
portal chip, the diagram bar and the app.

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

The AR surface is the one dark context: scope a subtree with
`data-surface="ar"` and the tokens switch to near-black paper, Warm green
rim, Focus blue ring.

## Rules — enforced by `npm run brand:check`

Governed files (the list in `brand-check.mjs` grows as pages migrate) may not
contain: a hex or rgb colour outside `tokens.css`; an emoji; `backdrop-filter`;
a linear/radial gradient on a surface; a `box-shadow` that is not the token
ring/rim; a `font-family` outside the brand stack; a border-radius above 4 px.
`tokens.css` itself may not contain an orange-ish value other than the Gemba
product mark. A line may carry `/* brand-check: allow */` for a justified
exception, which a reviewer will see.

For anyone generating code in this repo — including assistants — the short
form is in `CLAUDE.md` at the repo root: tokens only, sprite icons only, the
mark and lock-in, no glass, no gradients, no emoji, no orange.

## Migration plan

1. **Slice 1 (this):** `brand/`, `/brand`, icon sprite, checker, doctrine. No existing page touched.
2. **Slice 2:** Portal (`index.html`) and Catalogue (`catalog.html`) — the most seen. Each page drops its own palette, imports `brand.css`, swaps emoji for sprite icons, and joins the governed list.
3. **Slice 3:** Platform, Wireframe, Roadmap client, XR kit, Home, Unlock.
4. **Slice 4:** `Brand.swift` in the iPad app — same tokens for kiosk, hubs and sheets; AR overlays keep the rim-light.
