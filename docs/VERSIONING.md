# Versioning Standard — AR Operations Platform

Status: **adopted** (approved 2026-08-11)
Applies to: iOS app, SIB server, portal, roadmap client, shared schema — the whole release train.

---

## 1. The scheme

One platform version, fiscal CalVer:

```
YEAR.QUARTER.WEEK[.BUILD]
e.g.  2026.4.42        (platform version — server, portal, roadmap)
      2026.4.42.02     (a specific iOS archive: platform version + build counter)
```

| Component | Meaning | When it changes |
|---|---|---|
| `YEAR` | Fiscal year | Fiscal year rollover |
| `QUARTER` | Fiscal quarter (1–4) | Quarter rollover |
| `WEEK` | Fiscal week | **Monday of each release week** |
| `BUILD` | Per-artifact archive counter (iOS only: `CFBundleVersion`) | Each archive/re-spin: 01, 02, … |

### Fiscal calendar

The fiscal year ends in late October (**FY26 ends 2026-10-23**; FY27 week 1
begins the following week). Quarters are 13-week blocks:

| Quarter | Fiscal weeks |
|---|---|
| Q1 | 1–13 |
| Q2 | 14–26 |
| Q3 | 27–39 |
| Q4 | 40–52 (53 in a 53-week fiscal year) |

So fiscal week 42 → Q4 → `2026.4.42`. The quarter is always derivable from the
week with this table — if the two components ever disagree, the week wins and
the quarter is a typo.

This is the scheme `AppVersion.swift` has documented since the version display
shipped — this standard promotes it from an iOS convention to the platform
convention. There is deliberately **no notion of major/minor/breaking** in the
number: the platform deploys as one unit from one repo, nobody runs old versions
by choice, so the useful information is *when a build shipped*, not a
compatibility promise. (That is the SemVer-vs-CalVer trade-off; we choose CalVer
for the same reason Ubuntu and JetBrains do. Apple, for reference, uses
SemVer-shaped marketing versions on an annual calendar cadence plus a separate
always-increasing build number — we keep their two-identifier *mechanics* with
calendar semantics.)

The `QUARTER` component is derivable from `WEEK` and therefore redundant — it is
kept deliberately because fiscal quarters are how progress is communicated to
leadership, and it costs one digit.

## 2. Source of truth and surfaces

The version is defined in **exactly one place** and read everywhere else:

| Where | Role |
|---|---|
|  `sib/src/version.ts` → `PLATFORM_VERSION` | **The source of truth.** A string like `'2026.4.42'`. (Lives in sib, not @spatial/shared — the shared package is types-only at runtime; a value import of it crashes compiled server code.) |
| `GET /config` → `platformVersion` | How any client or human asks a server what it's running. |
| Portal header | Displays `v<version>` fetched from `/config`. |
| Roadmap client | Displays the same (from `/config`) — wire in the next client build. |
| iOS `MARKETING_VERSION` (Xcode) | Set manually to match `PLATFORM_VERSION` at release time; `CFBundleVersion` is the per-archive BUILD counter. |

The iOS value cannot read the TypeScript constant, so keeping them in step is a
release-checklist item, verified by comparing the app's Settings screen against
the portal header.

## 3. Release procedure

On the Monday of a release week (or whenever cutting a release):

1. Bump `PLATFORM_VERSION` in `sib/src/version.ts`.
2. Set `MARKETING_VERSION` in Xcode to the same value; reset
   `CURRENT_PROJECT_VERSION` to `01`.
3. Add a section to `CHANGELOG.md` (see §5) titled with the new version.
4. Stamp new/changed rows in `docs/FEATURE-CATALOG.md` with the new version.
5. `npm run build:roadmap` if the client changed; verify with the bundle grep
   gate before committing.
6. One commit: version bump + changelog + catalog stamps + bundle. Tag it
   `v<version>` in git.

Hotfixes within a week do **not** bump the platform version — they increment the
iOS BUILD counter and/or redeploy the server; the changelog entry goes under the
current week's section marked *(hotfix)*.

## 4. Feature versioning in the catalog

Features change more often than they are born, so the catalog tracks both:

- **Introduced** — the platform version in which the feature first shipped.
- **Updated** — the version of its most recent meaningful change (behaviour,
  not refactors). Add the column to a row the first time it's needed.
- Features shipped before this standard are stamped `baseline` and left alone —
  back-dating versions from git archaeology is guesswork and adds nothing.

Status transitions (`Beta → Shipped`, `Stub → Shipped`) are recorded by editing
the status and stamping *Updated* — the changelog carries the narrative.

## 5. Changelog

`CHANGELOG.md` at the repo root, one section per platform version, newest first,
in [Keep a Changelog](https://keepachangelog.com) spirit but with our sections:

```markdown
## 2026.3.36 — 2026-08-11
### Added
- Procedure Designer: procedure maps on the Roadmap canvas compile to draft guides.
### Changed
- Guide import now routes through the shared ingestion service (placement-safe upserts).
### Fixed
- Blank page on creating the first node on any map (React #310 in Minimap).
```

Rule of thumb: if a teammate would notice it, it gets a line; pure refactors
don't. The changelog is written **in the same PR** as the change, not
reconstructed at release time.

## 6. What this standard does not cover (deliberately)

- **API compatibility between iOS builds and server builds.** CalVer makes no
  compatibility promise. If drift becomes a real problem, the right tool is an
  explicit check — iOS compares `/config.platformVersion` against its own and
  warns past a threshold — not a switch to SemVer. Tracked as a future item.
- **Per-component versions.** Rejected: everything ships from one repo as one
  train; four independent numbers would drift and answer no question anyone asks.
- **The shared schema's `v1.0` header comment** — historical, not a version in
  this scheme.
