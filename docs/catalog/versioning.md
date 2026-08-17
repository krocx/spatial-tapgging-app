---
id: versioning
name: Platform versioning + feature catalog discipline
area: platform
status: shipped
version: 2026.4.42
depends: []
terms: [SIB]
spec: VERSIONING.md
arch: |
  flowchart LR
    V["sib/src/version.ts - PLATFORM_VERSION"] --> CFG["GET /config exposes it"]
    CFG --> PORT["Portal header + home page footer"]
    CFG --> DIAG["First stale-deployment check: version missing or old = rebuild needed"]
    RULE["Changelog + FEATURE-CATALOG + docs/catalog updated in the SAME commit as the change"] --> TRUST["The only defence against doc drift"]
---
A single `PLATFORM_VERSION` stamp surfaced at `/config` and in the portal header —
the first thing to check when a deployment looks stale. The changelog, the feature
catalog and these catalogue files are updated in the same commit as the change they
describe; that rule is the entire defence against documentation drift.
