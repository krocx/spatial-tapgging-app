// ReadingJudge.swift - judge a step's readings and text checks (AROMS-338).
//
// A port of sib/src/oms/assertions.ts `parseReading` + `evaluate`, so the
// iPad says the same words the server would. The bounds (min / max / unit)
// come from the assertion as SIB derived them from the ME's wording; the
// device never re-parses the expectation, only the reading.
//
// Proprietary & Confidential · Applied Materials.

import Foundation

/// One assertion's outcome - mirrors `StepReadingResult` in shared/src/index.ts.
struct StepReadingResult: Codable, Equatable, Identifiable {
    var id: String { assertionId }
    let assertionId: String
    let kind:        String
    let pass:        Bool
    let read:        String
    let value:       Double?
    let typed:       Bool
    let onFail:      String
    let words:       String
    let at:          String
}

enum ReadingJudge {

    private static let numberPattern = try! NSRegularExpression(pattern: #"[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][-+]?\d+)?"#)

    /// The number on a display, from what the recogniser read ("79.6 Ω", "1.2E-9", "12,3 Nm"). Nil when none ("OL").
    static func parseReading(_ text: String) -> Double? {
        let t = text.replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: "–", with: "-")
        let range = NSRange(t.startIndex..., in: t)
        guard let m = numberPattern.firstMatch(in: t, range: range), let r = Range(m.range, in: t) else { return nil }
        let v = Double(String(t[r]).replacingOccurrences(of: ",", with: "."))
        return v.flatMap { $0.isFinite ? $0 : nil }
    }

    private static func fold(_ s: String) -> String {
        s.precomposedStringWithCompatibilityMapping
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            .lowercased()
    }

    private static func fmt(_ v: Double) -> String {
        if abs(v) < 1e-3 || abs(v) >= 1e6 { return String(format: "%.2e", v) }
        let s = String(format: "%.3f", v)
        return s.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }

    /// Judge one assertion against what was read (or typed).
    static func evaluate(_ a: StepAssertion, read: String, typed: Bool) -> StepReadingResult {
        let now = ISO8601DateFormatter().string(from: Date())
        let base = { (pass: Bool, value: Double?, words: String) in
            StepReadingResult(assertionId: a.id, kind: a.kind, pass: pass, read: read, value: value, typed: typed, onFail: a.onFail, words: words, at: now)
        }
        if a.kind == "text-value" {
            guard let v = parseReading(read) else { return base(false, nil, "No reading found in \"\(read)\" - expected \(a.expected)") }
            let unit = a.unit.map { " \($0)" } ?? ""
            let lo = a.min.map { v >= $0 } ?? true
            let hi = a.max.map { v <= $0 } ?? true
            let pass = lo && hi
            return base(pass, v, pass ? "Read \(fmt(v))\(unit) - within \(a.expected)" : "Read \(fmt(v))\(unit) - outside \(a.expected)")
        }
        let got = fold(read), want = fold(a.expected)
        var pass = false
        switch a.match ?? "exact" {
        case "contains": pass = got.contains(want)
        case "any-of":   pass = want.components(separatedBy: CharacterSet(charactersIn: "|,;")).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.contains { got == $0 || got.contains($0) }
        case "regex":    pass = (try? NSRegularExpression(pattern: a.expected, options: .caseInsensitive))?.firstMatch(in: read, range: NSRange(read.startIndex..., in: read)) != nil
        default:         pass = got == want
        }
        let what = a.kind == "code" ? "Code" : "Read"
        return base(pass, nil, pass ? "\(what) \"\(read)\" - matches" : "\(what) \"\(read)\" - expected \(a.expected)")
    }

    /// The step's verdict: every blocking assertion passed. Flagged misses are reported, not blocking.
    static func stepPasses(_ results: [StepReadingResult]) -> Bool {
        !results.contains { !$0.pass && $0.onFail != "flag" }
    }
}
