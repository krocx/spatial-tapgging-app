---
id: shared-schema
name: Shared TypeScript schema
area: platform
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: schemas.md
---
One `@spatial/shared` package types the contract across server and portal, mirrored
by hand in Swift. It is deliberately types-only at runtime — value exports from it
have crashed production builds before, so constants live in the workspace that
executes them.
