// version.ts — THE platform version. Single source of truth for the release
// train; see docs/VERSIONING.md.
//
// Why this lives in sib and not @spatial/shared: the shared package's exports
// point at TypeScript SOURCE (./src/index.ts), which works for `import type`
// (erased at compile) and for bundlers (vite compiles it), but a compiled
// server cannot execute .ts at runtime — a value import of @spatial/shared
// crashed the Render deploy with ERR_MODULE_NOT_FOUND the first time one
// existed. @spatial/shared is therefore a TYPES-ONLY package at runtime;
// runtime values belong to the workspace that executes them.
//
// Scheme: YEAR.QUARTER.WEEK  (fiscal calendar, e.g. "2026.4.42")
//   Fiscal year ends late October (FY26 ends 2026-10-23); quarters are
//   13-week blocks — Q1 = weeks 1–13, Q2 = 14–26, Q3 = 27–39, Q4 = 40–52.
//
// Consumers: GET /config (server truth), portal header, roadmap footer (both
// fetch /config), and iOS MARKETING_VERSION (set manually in Xcode to match).
//
// Bump on the Monday of each release week, in the SAME commit as the release.
export const PLATFORM_VERSION = '2026.4.45';
