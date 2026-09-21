---
id: brand-system
name: Design system (tokens, components, mark, icons, /brand)
area: platform
status: shipped
version: 2026.4.46
depends: [home-page, feature-catalogue]
terms: []
spec: BRAND.md
api: |
  GET /brand — the living style guide, rendered from the same CSS every page uses (browser · same gate as the portal)
wireframe: portal
arch: |
  flowchart LR
    F["Applied team library<br/>Figma: colours · Roboto scale"] --> T["tokens.css<br/>every colour, size, duration"]
    T --> C["components.css<br/>btn · chip · card · table · notice · mark · lock-in"]
    I["roadmap-client icons.ts + UI set"] -->|npm run brand:icons| S["icons.svg sprite"]
    G["Google Fonts"] -->|npm run brand:fonts, once| W["brand/fonts/*.woff2<br/>self-hosted"]
    C --> B["brand.css — the single include"]
    S --> B
    W --> B
    B --> P["every SIB page<br/>portal · catalogue · platform · wireframe · XR kit · home"]
    B --> L["/brand — living style guide"]
    K["npm run brand:check<br/>no hex outside tokens · no emoji · no glass · no gradients · no orange"] -.guards.-> P
---
SIB has one look, written down once. `sib/portal/brand/` holds the tokens
(every colour, size and duration — the Applied team library's greys, Primary
blue, Focus blue and Warm green, with contrast-safe ink variants and no
orange in the system), the components (buttons, chips, cards, tables,
notices, forms, tiles, bars, heat strips, empty states), the registration
mark and the lock-in motion, the Roboto / Roboto Mono faces self-hosted for
the LAN, and the icon sprite that replaces every emoji. `/brand` renders the
whole system from that same CSS (`/portal/brand/brand.css`, the single
include; `/portal/brand/icons.svg`, the sprite), so what you see there is
what every page gets. Gemba Audit and iLOTO keep the product colours users know from the
app. The AR surface is the one dark context: Warm green becomes the
rim-light on the part to look at, exactly as the iPad draws it.

The system is self-enforcing: `npm run brand:check` fails a governed page on
a hex outside the tokens, an emoji, glass blur, a surface gradient, a
non-brand font or a rounded corner, and `CLAUDE.md` at the repo root states
the doctrine for anyone — or any assistant — writing a page here. Pages
migrate onto the system in slices (portal and catalogue first); until a page
migrates it keeps its old look and is not yet governed.
