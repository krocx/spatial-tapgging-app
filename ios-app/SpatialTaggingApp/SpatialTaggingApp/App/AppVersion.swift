// AppVersion.swift
// Reads the display version directly from the app bundle at runtime so the
// landing screen, Settings, and Onboarding always reflect what was set in Xcode
// — no source-code edits needed when bumping the build counter.
//
// Xcode build settings → Info.plist → Bundle.main:
//   CFBundleShortVersionString = MARKETING_VERSION          (3 components, e.g. "2026.3.36")
//   CFBundleVersion            = CURRENT_PROJECT_VERSION    (build counter,  e.g. "01")
//
// Display format: YEAR.QUARTER.WEEK.BUILD  (e.g. "2026.3.36.01")
//   YEAR    — Fiscal year
//   QUARTER — Fiscal quarter (1–4)
//   WEEK    — Fiscal week; bump every Monday  → update MARKETING_VERSION in Xcode
//   BUILD   — Incremental counter: 01 for the first archive, then 02, 03 …
//             → update CURRENT_PROJECT_VERSION in Xcode before each archive
//
// How to cut a new build:
//   1. (New week only) Xcode → Project → MARKETING_VERSION: 2026.3.NN
//   2. Xcode → Project → CURRENT_PROJECT_VERSION: 01  (or 02, 03 … for re-spins)
//   3. Archive — the version string updates automatically, no code change needed.

enum AppVersion {
    /// Full display version: "\(CFBundleShortVersionString).\(CFBundleVersion)"
    /// e.g. "2026.3.36.01".  Falls back to "?.?.?.?" if bundle keys are absent
    /// (only possible in unusual simulator/test configurations).
    static var current: String {
        let info      = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build     = info?["CFBundleVersion"]             as? String ?? "?"
        return "\(marketing).\(build)"
    }
}
