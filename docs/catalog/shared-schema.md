---
id: shared-schema
name: Shared TypeScript schema
area: platform
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: schemas.md
arch: |
  flowchart LR
    SH["@spatial/shared - shared/src/index.ts"] --> TS["Types imported by sib server + portal"]
    SH -.hand-mirrored.-> SW["Swift models in ios-app"]
    SH --> RULE["TYPES-ONLY at runtime - tsc erases type imports"]
    RULE --> WHY["A value export once resolved to .ts in production and crashed the container - constants live in the workspace that executes them"]
---
One `@spatial/shared` package types the contract across server and portal, mirrored
by hand in Swift. It is deliberately types-only at runtime — value exports from it
have crashed production builds before, so constants live in the workspace that
executes them.
