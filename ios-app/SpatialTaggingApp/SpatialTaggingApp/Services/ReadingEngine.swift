// ReadingEngine.swift - read a frame and judge a step's checks, no UI (AROMS-342 / 352).
//
// What ReadingCaptureSheet did inline, lifted out so that (a) the operator's
// session can run the same read silently on the cone's validation frame and
// finish presence and label in one go (AROMS-352), and (b) a reading can be
// sampled over several frames and the stable value kept (AROMS-342). The
// sheet shows what this returns; nothing here touches a view.
//
// Proprietary & Confidential · Applied Materials.

import UIKit
import Vision
import NaturalLanguage

enum ReadingEngine {

    /// A recognised line, or a decoded barcode (`symbology` set, `text` the payload).
    /// Boxes are top-left normalised, as the app stores them. `language` (AROMS-355)
    /// is the script the line is written in, in words ("Korean", "Japanese",
    /// "Chinese (Simplified)"), nil for English, digits and codes.
    struct Line: Equatable { let text: String; let box: CGRect; var symbology: String? = nil; var language: String? = nil }

    /// AROMS-355: the languages a label on the floor is printed in. Vision reads
    /// Latin by default; Korean, Japanese and both Chinese scripts have to be
    /// asked for, and then the recogniser picks per line.
    static let recognitionLanguages = ["en-US", "ko-KR", "ja-JP", "zh-Hans", "zh-Hant", "de-DE", "fr-FR"]

    /// The language of a line, in words - nil for English, numbers and codes,
    /// so only what matters on the floor is said.
    static func languageWords(_ text: String) -> String? {
        let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard letters.count >= 2 else { return nil }
        // Script first: it is unambiguous for Hangul and the kana, and NLLanguageRecognizer
        // alone mistakes short Japanese for Chinese when a line is all kanji.
        if letters.contains(where: { (0xAC00...0xD7AF).contains($0.value) || (0x1100...0x11FF).contains($0.value) || (0x3130...0x318F).contains($0.value) }) { return "Korean" }
        if letters.contains(where: { (0x3040...0x30FF).contains($0.value) }) { return "Japanese" }
        let r = NLLanguageRecognizer()
        r.languageConstraints = [.english, .korean, .japanese, .simplifiedChinese, .traditionalChinese, .german, .french]
        r.processString(text)
        guard let lang = r.dominantLanguage, (r.languageHypotheses(withMaximum: 1)[lang] ?? 0) >= 0.5 else { return nil }
        switch lang {
        case .korean:             return "Korean"
        case .japanese:           return "Japanese"
        case .simplifiedChinese:  return "Chinese (Simplified)"
        case .traditionalChinese: return "Chinese (Traditional)"
        case .german:             return "German"
        case .french:             return "French"
        default:                  return nil
        }
    }

    /// One frame's recognition.
    struct Frame {
        var lines: [Line] = []       // sorted top to bottom
        var codes: [Line] = []
        var joined: String { lines.map(\.text).joined(separator: " ") }
    }

    /// The judge's output: the verdicts, where each check's text sits, and (Author
    /// mode) the candidate line pre-picked for each label or barcode check.
    struct Judgement {
        var results: [StepReadingResult] = []
        var matchedBoxes: [String: CGRect] = [:]
        var picked: [String: Int] = [:]
        /// AROMS-342: the values seen across the sampled frames for the reading, when more than one.
        var samples: [Double] = []
        var stable: Bool = true
    }

    /// AROMS-340: the symbologies a Luna label or a part tag carries.
    static let codeSymbologies: [VNBarcodeSymbology] = [.qr, .dataMatrix, .code128, .code39, .ean13, .ean8, .upce, .itf14, .pdf417, .aztec]

    // ── Recognise ─────────────────────────────────────────────────────────────

    /// Text (and, when asked, barcodes) in one frame. Off the main thread.
    static func recognise(_ image: UIImage, wantsCodes: Bool) async -> Frame {
        guard let cg = image.cgImage else { return Frame() }
        return await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let text = VNRecognizeTextRequest()
                text.recognitionLevel = .accurate
                text.usesLanguageCorrection = false        // digits and part numbers must not be "corrected"
                // AROMS-355: ask for the scripts a label may carry; Vision picks per line.
                let supported = (try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? []
                text.recognitionLanguages = recognitionLanguages.filter { supported.contains($0) }
                text.automaticallyDetectsLanguage = true
                let codes = VNDetectBarcodesRequest()
                codes.symbologies = codeSymbologies
                let handler = VNImageRequestHandler(cgImage: cg, options: [:])
                try? handler.perform(wantsCodes ? [text, codes] : [text])
                var f = Frame()
                f.lines = (text.results ?? []).compactMap { o -> Line? in
                    guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { return nil }
                    return Line(text: s, box: topLeft(o.boundingBox), language: languageWords(s))
                }.sorted { $0.box.minY < $1.box.minY }
                if wantsCodes {
                    f.codes = (codes.results ?? []).compactMap { o -> Line? in
                        guard let p = o.payloadStringValue, !p.isEmpty else { return nil }
                        return Line(text: p, box: topLeft(o.boundingBox), symbology: symbologyWords(o.symbology))
                    }
                }
                cont.resume(returning: f)
            }
        }
    }

    /// Vision boxes are bottom-left normalised; the app stores top-left normalised.
    static func topLeft(_ b: CGRect) -> CGRect { CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height) }

    static func symbologyWords(_ s: VNBarcodeSymbology) -> String {
        switch s {
        case .qr: return "QR"; case .dataMatrix: return "Data Matrix"; case .code128: return "Code 128"; case .code39: return "Code 39"
        case .ean13: return "EAN-13"; case .ean8: return "EAN-8"; case .upce: return "UPC-E"; case .itf14: return "ITF-14"
        case .pdf417: return "PDF417"; case .aztec: return "Aztec"; default: return "code"
        }
    }

    static func fold(_ s: String) -> String {
        s.precomposedStringWithCompatibilityMapping.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ").lowercased()
    }

    // ── The display's main digits (AROMS-342) ─────────────────────────────────

    /// The line that is the display's reading: the tallest line that carries a
    /// number. A leak checker often prints the mantissa large and the exponent
    /// small beside it ("1.2" … "E-09", or just "-09"), which Vision returns as
    /// two lines: an exponent-shaped line on the same row, to the right, is
    /// joined on. Returns the text and the box of the main line.
    static func mainReading(in f: Frame) -> (text: String, box: CGRect)? {
        guard let main = f.lines.filter({ ReadingJudge.parseReading($0.text) != nil }).max(by: { $0.box.height < $1.box.height }) else { return nil }
        var text = main.text
        if !ReadingJudge.hasExponent(text) {
            let sameRow = f.lines.filter { l in
                l != main && l.box.minX >= main.box.midX && abs(l.box.midY - main.box.midY) < main.box.height * 0.8
            }
            if let exp = sameRow.first(where: { ReadingJudge.isExponentFragment($0.text) }) {
                // "1.2 × 10" + "⁻⁹": the "× 10" belongs to the exponent, not the mantissa.
                let base = ReadingJudge.normaliseNotation(text).replacingOccurrences(of: #"\s*[x×X·*]\s*10\s*\^?\s*$"#, with: "", options: .regularExpression)
                let frag = ReadingJudge.normaliseNotation(exp.text).trimmingCharacters(in: .whitespaces)
                text = base + (frag.uppercased().hasPrefix("E") ? frag : "E" + frag)
            }
        }
        return (text, main.box)
    }

    // ── Judge ─────────────────────────────────────────────────────────────────

    /// Judge every check on what was read. `frames` is one frame, or several
    /// sampled in a row for a reading (the last one is the frame shown). For
    /// label and barcode checks the last frame is what counts; for a reading the
    /// value that recurs across the frames is kept, and a display still moving is
    /// said so.
    static func judge(_ assertions: [StepAssertion], frames: [Frame], authoring: Bool) -> Judgement {
        var j = Judgement()
        guard let f = frames.last else { return j }
        let joined = f.joined
        let tallestText = f.lines.max(by: { $0.box.height < $1.box.height })

        // AROMS-342: the reading over the sampled frames.
        let readings = frames.compactMap { mainReading(in: $0) }
        let values = readings.compactMap { ReadingJudge.parseReading($0.text) }
        var readingText: String? = readings.last?.text
        var readingBox: CGRect? = readings.last?.box
        if values.count >= 2 {
            j.samples = values
            // Stable: the last value agrees with at least one other within 0.5 % (or exactly).
            let last = values[values.count - 1]
            let agree = values.dropLast().contains { abs($0 - last) <= max(abs(last) * 0.005, 1e-12) }
            j.stable = agree
            if !agree, let m = median(values), let i = values.firstIndex(where: { $0 == m }) {
                // Keep the median so one glitched frame does not decide; the verdict says the display moved.
                readingText = readings[i].text; readingBox = readings[i].box
            }
        }

        for a in assertions where a.kind != "location" {
            let want = fold(a.expected)
            if a.kind == "code" {
                // AROMS-340: a Barcode check is judged on the decoded payloads - the one
                // that carries the expectation, else all of them in words. Nothing decoded
                // falls back to the digits printed under the code, said as such.
                let codes = f.codes
                let hit = codes.first { !want.isEmpty && fold($0.text).contains(want) } ?? codes.first
                if let hit {
                    var r = ReadingJudge.evaluate(a, read: hit.text, typed: false)
                    if !r.pass && codes.count > 1 {
                        r = reword(r, read: codes.map(\.text).joined(separator: " | "),
                                   words: "Barcodes read: \(codes.map { "\($0.symbology ?? "barcode") \"\($0.text)\"" }.joined(separator: ", ")) - \"\(a.expected)\" not among them")
                    } else if r.pass {
                        r = reword(r, read: hit.text, words: "\(hit.symbology ?? "Barcode") \"\(hit.text)\" - carries \"\(a.expected)\"")
                    }
                    j.results.append(r)
                    j.matchedBoxes[a.id] = hit.box
                } else {
                    var r = ReadingJudge.evaluate(a, read: joined, typed: false)
                    r = reword(r, read: r.read, words: r.pass ? "No barcode decoded; the printed text carries \"\(a.expected)\""
                               : (joined.isEmpty ? "No barcode in the frame - expected \"\(a.expected)\"" : "No barcode decoded, and the printed text doesn't carry \"\(a.expected)\""))
                    j.results.append(r)
                    if let t = tallestText { j.matchedBoxes[a.id] = t.box }
                }
                if authoring, !want.isEmpty, let i = codes.firstIndex(where: { fold($0.text).contains(want) }) { j.picked[a.id] = i }
                continue
            }
            if a.isReading {
                var r = ReadingJudge.evaluate(a, read: readingText ?? joined, typed: false)
                if !j.stable {
                    // The raw texts, not the parsed values - so a display that reads oddly can be seen in the log.
                    r = reword(r, read: r.read, words: r.words + " · display still moving (\(readings.map { "\"\($0.text)\"" }.joined(separator: " · "))) - hold steady and read again")
                }
                j.results.append(r)
                if let b = readingBox { j.matchedBoxes[a.id] = b }
                continue
            }
            var r = ReadingJudge.evaluate(a, read: joined, typed: false)
            // The line that carried the match - where the text is, and (AROMS-355) what language it is in.
            let match = f.lines.first(where: { !want.isEmpty && fold($0.text).contains(want) })
            if let hit = match ?? tallestText { j.matchedBoxes[a.id] = hit.box }
            if r.pass, let lang = match?.language { r = reword(r, read: r.read, words: r.words + " · \(lang)") }
            else if !r.pass {
                let langs = Array(Set(f.lines.compactMap(\.language))).sorted()
                if !langs.isEmpty { r = reword(r, read: r.read, words: r.words + " · label is in \(langs.joined(separator: " and "))") }
            }
            j.results.append(r)
            // AROMS-350: in Author mode, pre-select the line that carries the typed expectation.
            if authoring, !want.isEmpty, let i = f.lines.firstIndex(where: { fold($0.text).contains(want) }) { j.picked[a.id] = i }
        }
        // AROMS-339: location - the text's place now against where it was trained.
        for a in assertions where a.kind == "location" {
            let anchorText = assertions.first { $0.kind == "text-match" && $0.region != nil } ?? assertions.first { $0.kind == "text-match" }
            guard let anchorText else {
                j.results.append(StepReadingResult(assertionId: a.id, kind: a.kind, pass: false, read: "", value: nil, typed: false, onFail: "flag",
                                                   words: "No label text to check the position against - skipped", at: ISO8601DateFormatter().string(from: Date())))
                continue
            }
            j.results.append(ReadingJudge.evaluateLocation(a, trained: anchorText.region, matched: j.matchedBoxes[anchorText.id], typed: false))
        }
        return j
    }

    private static func reword(_ r: StepReadingResult, read: String, words: String) -> StepReadingResult {
        StepReadingResult(assertionId: r.assertionId, kind: r.kind, pass: r.pass, read: read, value: r.value, typed: r.typed, onFail: r.onFail, words: words, at: r.at)
    }

    private static func median(_ v: [Double]) -> Double? {
        guard !v.isEmpty else { return nil }
        let s = v.sorted(); return s[s.count / 2]
    }
}
