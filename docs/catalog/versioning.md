---
id: versioning
name: Platform versioning + feature catalog discipline
area: platform
status: shipped
version: 2026.4.42
depends: []
terms: [SIB]
spec: VERSIONING.md
---
A single `PLATFORM_VERSION` stamp surfaced at `/config` and in the portal header —
the first thing to check when a deployment looks stale. The changelog, the feature
catalog and these catalogue files are updated in the same commit as the change they
describe; that rule is the entire defence against documentation drift.
