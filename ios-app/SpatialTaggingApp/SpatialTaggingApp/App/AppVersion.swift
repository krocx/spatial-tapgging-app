// AppVersion.swift
// Central build version constant.
//
// Format: YEAR.QUARTER.WEEK.LOCAL_BUILD  (Fiscal calendar)
//   YEAR         — Fiscal year (keep as-is throughout the year)
//   QUARTER      — Fiscal quarter (1-4)
//   WEEK         — Fiscal week number; bump every Monday
//   LOCAL_BUILD  — Incremental build counter within the week (01, 02, 03 …)
//
// Examples:
//   2026.3.35.01  — FY2026, Q3, Week 35, first build
//   2026.3.35.02  — same week, second build
//   2026.3.36.01  — next Monday, new week

enum AppVersion {
    static let current = "2026.3.35.01"
}
