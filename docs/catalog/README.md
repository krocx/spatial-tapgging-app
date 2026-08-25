# Feature Catalogue — source files

This folder is the **canonical, machine-readable source** of the feature catalogue.
Everything the `/catalog` web surface shows — the graph, the cards, the flows, the
glossary chips — is derived from these files at request time. Nothing here is
generated; everything downstream of here is.

## File types

- **Feature files** (`<id>.md`) — one per capability. YAML frontmatter + a short prose body.
- **Area files** (`area-<id>.md`) — one per product area (`kind: area`), each with a
  Mermaid flowchart of how the area's features connect in use.
- **`trails.md`** — the three "start here" reading orders for new team members.

## Frontmatter contract

```yaml
---
id: qr-anchoring          # unique, kebab-case, stable forever (URLs + depends refer to it)
name: QR-anchored 6-DOF tracking
area: tags                # one of: tags | gemba | guides | designer | iloto | portal | platform
status: shipped           # shipped | beta | planned
version: baseline         # platform version stamp, or "baseline" (pre-versioning)
depends: [shared-schema]  # ids of features this one builds on (drawn as graph edges)
terms: [Anchor]           # glossary names from docs/roadmap-glossary.md (hover definitions)
spec: APP-FEATURES.md     # the deep-dive doc in docs/ (rendered in place on the card);
                          # append #heading-slug to render just that section
api: |                    # OPTIONAL endpoint list — one line each, exactly:
  GET /x — purpose (app · API key)
                          # "METHOD /path — purpose (caller · auth tier)".
                          # Callers: app | portal | designer | browser | any.
                          # Auth: API key | admin key | public. The checker
                          # validates every HTTP line against the real Express
                          # routes in sib/src — a renamed endpoint fails CI.
                          # Omit entirely for UX-only features (no filler).
wireframe: author         # flow tab in the App Wireframe (/wireframe), if one exists
flow: |                   # OPTIONAL per-feature Mermaid; omit to inherit the area flow
  flowchart LR
    A --> B
arch: |                   # OPTIONAL architecture Mermaid — the SYSTEM's story, with
  sequenceDiagram         # REAL route paths, module files and stores (e.g.
    App->>SIB: POST /x    # "POST /guides/import", "ingest.ts"). flow = what the
                          # user experiences; arch = what the system does.
---
Two to four sentences: what it does, why it exists, one operational detail
a teammate would actually need. No marketing language.
```

## Rules that keep this trustworthy

1. **Ship a feature → touch its file in the same commit.** Same rule as the
   changelog. `npm run catalog:check` (drift checker) fails CI on dangling
   `depends` ids, unknown `terms`, or missing `spec` files.
2. **Ids are forever.** Rename the `name`, never the `id`.
3. **Bodies are short on purpose.** The card links to the spec for depth;
   duplicated prose is where drift is born.
4. **Obsidian-friendly.** Open this folder as a vault and the graph view mirrors
   `/catalog` — frontmatter links are plain ids by design.

[FEATURE-CATALOG.md](../FEATURE-CATALOG.md) remains the human table-of-record view;
it now carries a "generated view" header and must agree with these files.
