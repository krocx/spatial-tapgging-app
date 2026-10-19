// ReadingJudge.swift - judge a step's readings and text checks (AROMS-338).
//
// A port of sib/src/oms/assertions.ts `parseReading` + `evaluate`, so the
// iPad says the same words the server would. The bounds (min / max / unit)
// come from the assertion as SIB derived them from the ME's wording; the
// device never re-parses the expectation, only the reading.
//
// Proprietary & Confidential · Applied Materials.

import Foundation
import CoreGraphics

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

    private static let numberPattern = try! NSRegularExpression(pattern: #"[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:E[-+]?\d+)?"#)
    private static let exponentFragment = try! NSRegularExpression(pattern: #"^\s*(?:E\s*)?[-+]\s*\d{1,3}\s*$"#, options: .caseInsensitive)

    /// AROMS-342: what instrument displays print for "× 10 to the", folded to
    /// "E": superscript digits and minus ("1.2×10⁻⁹"), "x10^-9", "x10-9",
    /// "·10-9", "E -09" and "e-9". A port of the same step in assertions.ts.
    static func normaliseNotation(_ text: String) -> String {
        var t = text
        let supers: [Character: Character] = ["⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+"]
        t = String(t.map { supers[$0] ?? $0 })
        for d in ["−", "–", "—"] { t = t.replacingOccurrences(of: d, with: "-") }
        // "× 10 ^ -9", "x10-9", "·10-9", "*10^-9" → "E-9" (only when an exponent follows)
        t = t.replacingOccurrences(of: #"\s*[x×X·*]\s*10\s*\^?\s*([-+]?\d+)"#, with: "E$1", options: .regularExpression)
        // The recogniser often drops the small "10" and keeps the superscript: "1 × ⁻¹²" → "1E-12"
        t = t.replacingOccurrences(of: #"(\d)\s*[x×X]\s*([-+]\d+)"#, with: "$1E$2", options: .regularExpression)
        // "e -9", "E -09" → "E-9"
        t = t.replacingOccurrences(of: #"[eE]\s*([-+]?)\s*(\d+)"#, with: "E$1$2", options: .regularExpression)
        return t
    }

    /// The number on a display, from what the recogniser read ("79.6 Ω",
    /// "1.2E-9", "1.2×10⁻⁹ mbar·l/s", "12,3 Nm"). Nil when none ("OL", "----").
    static func parseReading(_ text: String) -> Double? {
        let t = normaliseNotation(text)
        let range = NSRange(t.startIndex..., in: t)
        guard let m = numberPattern.firstMatch(in: t, range: range), let r = Range(m.range, in: t) else { return nil }
        let v = Double(String(t[r]).replacingOccurrences(of: ",", with: "."))
        return v.flatMap { $0.isFinite ? $0 : nil }
    }

    /// Whether a reading already carries an exponent after normalisation.
    static func hasExponent(_ text: String) -> Bool { normaliseNotation(text).contains("E") }

    /// A line that is only an exponent ("E-09", "-09", "+2") - the small part a
    /// leak checker prints beside the mantissa (AROMS-342).
    static func isExponentFragment(_ text: String) -> Bool {
        let t = normaliseNotation(text)
        return exponentFragment.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil
    }

    private static func fold(_ s: String) -> String {
        s.precomposedStringWithCompatibilityMapping
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            .lowercased()
    }

    static func fmt(_ v: Double) -> String {
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
        // AROMS-349: a blank expectation is a configuration slip, never a wall -
        // flagged in words so the operator is not stuck on a check nobody wrote.
        if want.isEmpty {
            return StepReadingResult(assertionId: a.id, kind: a.kind, pass: false, read: read, value: nil, typed: typed, onFail: "flag", words: "No expected text on this step - skipped (the author types it on the step)", at: now)
        }
        var pass = false
        switch a.match ?? "contains" {
        case "exact":    pass = got == want
        case "any-of":   pass = want.components(separatedBy: CharacterSet(charactersIn: "|,;")).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.contains { got == $0 || got.contains($0) }
        case "regex":    pass = (try? NSRegularExpression(pattern: a.expected, options: .caseInsensitive))?.firstMatch(in: read, range: NSRange(read.startIndex..., in: read)) != nil
        default:         pass = got.contains(want)       // "must say", not "says only" (AROMS-349)
        }
        let what = a.kind == "code" ? "Barcode" : "Read"
        if pass { return base(true, nil, "\(what) \"\(a.expected)\" - found") }
        return base(false, nil, got.isEmpty ? "Nothing readable in the frame - expected \"\(a.expected)\"" : "\(what) \"\(read)\" - \"\(a.expected)\" not on it")
    }

    /// AROMS-339: a `location` assertion - the text the step reads sits where it
    /// was read when the step was trained. `trained` is the region stored on the
    /// step's text-match assertion; `matched` is the box of the line that matched
    /// it now (both top-left normalised). Within 0.2 of the frame in centre
    /// distance passes; untrained or unmatched is a miss said in words.
    static func evaluateLocation(_ a: StepAssertion, trained: StepAssertion.AssertionRegion?, matched: CGRect?, typed: Bool) -> StepReadingResult {
        let now = ISO8601DateFormatter().string(from: Date())
        let mk = { (pass: Bool, onFail: String, words: String) in
            StepReadingResult(assertionId: a.id, kind: a.kind, pass: pass, read: matched.map { "\(Int($0.midX * 100)),\(Int($0.midY * 100))" } ?? "", value: nil, typed: typed, onFail: onFail, words: words, at: now)
        }
        // Untrained position never stops the floor: it is flagged (recorded, the
        // step proceeds), the way an untrained presence check falls back to manual.
        guard let t = trained else { return mk(false, "flag", "Label position not trained - skipped (the author trains it in Place Steps in AR)") }
        guard let m = matched else { return mk(false, a.onFail, "Label text not found, so where it sits could not be checked") }
        let dx = (m.midX - (t.x + t.w / 2)), dy = (m.midY - (t.y + t.h / 2))
        let d = (dx * dx + dy * dy).squareRoot()
        let pass = d <= 0.2
        return mk(pass, a.onFail, pass ? "Label is where it should be" : "Label is \(dx > 0.1 ? "to the right of" : dx < -0.1 ? "to the left of" : dy > 0.1 ? "below" : dy < -0.1 ? "above" : "away from") where it should be")
    }

    /// The step's verdict: every blocking assertion passed. Flagged misses are reported, not blocking.
    static func stepPasses(_ results: [StepReadingResult]) -> Bool {
        !results.contains { !$0.pass && $0.onFail != "flag" }
    }
}
