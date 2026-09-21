# Working in this repo — design doctrine

SIB has one design system: `sib/portal/brand/` (doctrine in `docs/BRAND.md`,
living guide at `/brand`). Anything that renders on a SIB web page follows it,
whoever or whatever writes the code.

- **Tokens only.** Colours, sizes, durations come from `sib/portal/brand/tokens.css` (`var(--ax-…)`). Never write a hex or rgb value in a page.
- **Components, not restyling.** Use `.ax-btn`, `.ax-chip`, `.ax-card`, `.ax-table`, `.ax-notice`, `.ax-input`, `.ax-tabs`, `.ax-tile`, `.ax-bar`, `.ax-heat`, `.ax-empty` from `components.css`.
- **Icons from the sprite** (`/portal/brand/icons.svg#i-<name>`, `npm run brand:icons`). Never emoji.
- **The mark and the motion.** Focus, loading and section markers use the registration mark (`.ax-mark`); arrival uses lock-in (`.ax-lockin`). Nothing fades or slides. AR surfaces (`data-surface="ar"`) use the Warm-green rim (`.ax-rim`).
- **Never:** glass / `backdrop-filter`, gradients on surfaces, drop shadows, rounded 12-px cards, pill chips, navy-and-electric-blue, orange/amber/yellow (the Gemba product mark is the one exception), Focus blue or Warm green as text.
- **Type:** Arial (company standard) at the token scale (`--ax-h1` … `--ax-body`), `--ax-mono` for identifiers and numbers. Never load a web font.
- Before committing a page that uses the system, add it to `GOVERNED` in `scripts/brand-check.mjs` and run `npm run brand:check`.

Other standing rules for this repo live in `docs/` (versioning, catalogue checker, IP sensitivity). When in doubt, propose before changing.
