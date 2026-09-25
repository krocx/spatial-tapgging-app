# Working in this repo - design doctrine

SIB has one design system: `sib/portal/brand/` (doctrine in `docs/BRAND.md`,
living guide at `/brand`). Anything that renders on a SIB web page follows it,
whoever or whatever writes the code.

- **Tokens only.** Colours, sizes, durations come from `sib/portal/brand/tokens.css` (`var(--ax-…)`). Never write a hex or rgb value in a page.
- **Components, not restyling.** Use `.ax-door`, `.ax-btn`, `.ax-chip`, `.ax-card`, `.ax-table`, `.ax-notice`, `.ax-input`, `.ax-tabs`, `.ax-tile`, `.ax-bar`, `.ax-heat`, `.ax-empty` from `components.css`.
- **Icons from the sprite** (`/portal/brand/icons.svg#i-<name>`, `npm run brand:icons`). Never emoji.
- **The signatures.** The wordmark is always the `.ax-wordmark` component (`appliedx`, lowercase, applied blue / x green). Focus, loading and section markers use the registration mark (`.ax-mark`); arrival uses lock-in (`.ax-lockin`). Nothing fades or slides. AR surfaces (`data-surface="ar"`) use the green rim (`.ax-rim`).
- **The iPad app is the reference.** Charcoal gradient page, 8 %-white cards with an accent stroke, white text in the app's opacity tiers, iOS system accents (blue acts · green verified/AR OMS · orange attention/Gemba · red failure/iLOTO), 18-pt cards, 14-pt CTAs, 12-pt fields, capsule chips. If the app doesn't do it, SIB doesn't invent it.
- **Never:** glass / `backdrop-filter`, drop shadows, a gradient written in a page (use `--ax-page` / `--ax-title`), a colour without a meaning, a hue the app doesn't have, `AppliedX` or a one-colour wordmark, the wordmark colours (`--ax-wm-*`) used for anything else, internal codes in user-facing text.
- **Type:** Open Sans (the company's standard web font, self-hosted from `sib/portal/brand/fonts/` via `npm run brand:fonts`) at the token scale (`--ax-h1` … `--ax-body`), `--ax-mono` for identifiers and numbers. Never load a font from a CDN.
- Before committing a page that uses the system, add it to `GOVERNED` in `scripts/brand-check.mjs` and run `npm run brand:check`.

Other standing rules for this repo live in `docs/` (versioning, catalogue checker, IP sensitivity). When in doubt, propose before changing.
