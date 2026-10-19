// ReadingCaptureSheet.swift - read an instrument display, a label or a part
// number with the camera and judge it against the step's checks (AROMS-338).
//
// A half-height sheet over the live AR camera: the operator frames the
// display above the sheet and taps Read. The current AR frame (raw camera
// image, no AR artefacts) goes through Vision text recognition on-device;
// for a reading the largest line that carries a number is the display's
// main digits. Every assertion is judged (ReadingJudge) and said in words;
// the frame with the read is the step's evidence. "Type it instead" is the
// explicit fallback and is recorded as typed, not read.
//
// Proprietary & Confidential · Applied Materials.

import SwiftUI
import Vision
import ARKit

struct ReadingCaptureSheet: View {
    let step:        GuideStep
    let frameSource: () -> UIImage?
    let onDone:      (_ results: [StepReadingResult], _ frame: UIImage?) -> Void
    /// AROMS-339: Author mode - "Save as trained" hands back where each text
    /// was read (top-left normalised), to be stored as the assertion's region.
    var authoring:   Bool = false
    /// AROMS-350: what training hands back - where each label check's text sits
    /// and the words the camera actually read for it (the expectation from now on).
    struct LabelTraining { var regions: [String: StepAssertion.AssertionRegion] = [:]; var expected: [String: String] = [:] }
    var onTrained:   ((_ training: LabelTraining) -> Void)? = nil
    /// AROMS-351: Author mode "Try it" - the operator's sheet, the operator's
    /// verdict, nothing recorded. The one button is Done.
    var trial:       Bool = false
    /// AROMS-350: the checks as saved by label training this session, when the
    /// caller's `step` is older than that; nil means the step's own.
    var assertionsOverride: [StepAssertion]? = nil
    @State private var matchedBoxes: [String: CGRect] = [:]
    /// AROMS-350: in Author mode, the recognised line picked for each label check
    /// (index into `recognised`). Pre-filled with the line that carries the
    /// typed expectation; the author taps another to make it the expectation.
    @State private var picked: [String: Int] = [:]

    @Environment(\.dismiss) private var dismiss
    @State private var phase: Phase = .framing
    @State private var frame: UIImage? = nil
    @State private var recognised: [Recognised] = []
    @State private var results: [StepReadingResult] = []
    @State private var typing: StepAssertion? = nil
    @State private var typedText = ""
    @State private var flash = 0.0

    private enum Phase { case framing, reading, review }
    /// A recognised line, or (AROMS-340) a decoded code - `symbology` set, `text` the payload.
    private struct Recognised { let text: String; let box: CGRect; var symbology: String? = nil }
    /// AROMS-340: the codes decoded from the frame, judged and offered for Code checks.
    @State private var decodedCodes: [Recognised] = []

    private var assertions: [StepAssertion] { assertionsOverride ?? step.assertions ?? [] }
    private var allPass: Bool { ReadingJudge.stepPasses(results) && results.count == assertions.count }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                if trial {
                    Label("Trial - what the operator will see; nothing is recorded", systemImage: "eye")
                        .font(.caption).foregroundStyle(Color.orange)
                }
                // What to frame, in words.
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(assertions) { a in
                        HStack(spacing: 8) {
                            Image(systemName: icon(for: a)).foregroundStyle(.white.opacity(0.7)).frame(width: 18)
                            Text(a.words).font(.subheadline).foregroundStyle(.white)
                            Spacer()
                            if let r = results.first(where: { $0.assertionId == a.id }) {
                                Image(systemName: r.pass ? "checkmark.circle.fill" : (r.onFail == "flag" ? "flag.fill" : "xmark.circle.fill"))
                                    .foregroundStyle(r.pass ? .green : (r.onFail == "flag" ? .orange : .red))
                            }
                        }
                    }
                }

                switch phase {
                case .framing:
                    Text(framingHint).font(.footnote).foregroundStyle(.white.opacity(0.65))
                    Button { read() } label: { Label("Read", systemImage: "camera.viewfinder").font(.headline).frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).tint(.blue)
                case .reading:
                    HStack { ProgressView(); Text("Reading…").foregroundStyle(.white.opacity(0.7)) }
                case .review:
                    if let img = frame {
                        Image(uiImage: img).resizable().scaledToFit().frame(maxHeight: 140)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.white.opacity(0.2)))
                            .overlay(alignment: .bottomLeading) {
                                if !recognised.isEmpty {
                                    Text(recognised.map(\.text).joined(separator: " · "))
                                        .font(.caption2).lineLimit(2).padding(6)
                                        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6)).padding(6)
                                }
                            }
                    }
                    if authoring { labelPicker }
                    ForEach(results) { r in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: r.pass ? "checkmark.circle.fill" : (r.onFail == "flag" ? "flag.fill" : "xmark.circle.fill"))
                                .foregroundStyle(r.pass ? .green : (r.onFail == "flag" ? .orange : .red))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.words).font(.subheadline).foregroundStyle(.white)
                                if r.typed { Text("Typed, not read - recorded as typed").font(.caption2).foregroundStyle(.orange) }
                                else if !r.pass && r.onFail == "flag" { Text("Flagged - the step can proceed").font(.caption2).foregroundStyle(.orange) }
                                else if !r.pass { Text("Blocks the step until it reads right").font(.caption2).foregroundStyle(.red) }
                            }
                        }
                    }
                    HStack(spacing: 10) {
                        Button { phase = .framing; frame = nil; recognised = []; results = [] } label: { Label("Read again", systemImage: "arrow.counterclockwise") }
                            .buttonStyle(.bordered)
                        if let a = assertions.first(where: { r in r.kind != "location" && !(results.first { $0.assertionId == r.id }?.pass ?? false) }) {
                            Button { typing = a; typedText = "" } label: { Label("Type it instead", systemImage: "keyboard") }
                                .buttonStyle(.bordered)
                        }
                        Spacer()
                        if authoring {
                            Button {
                                // AROMS-350: the picked line is both the place and the words.
                                var t = LabelTraining()
                                for a in labelChecks {
                                    let lines = candidates(for: a)
                                    guard let i = picked[a.id], i < lines.count else { continue }
                                    let b = topLeft(lines[i].box)
                                    t.regions[a.id]  = StepAssertion.AssertionRegion(x: b.minX, y: b.minY, w: b.width, h: b.height)
                                    t.expected[a.id] = lines[i].text
                                }
                                onTrained?(t); dismiss()
                            } label: { Text("Save as trained").font(.headline) }
                                .buttonStyle(.borderedProminent).tint(.green)
                                .disabled(labelChecks.contains { picked[$0.id] == nil })
                        } else if trial {
                            Button { dismiss() } label: { Text(allPass ? "Works - done" : "Done").font(.headline) }
                                .buttonStyle(.borderedProminent).tint(allPass ? .green : .orange)
                        } else {
                            Button { onDone(results, frame); dismiss() } label: { Text(allPass ? "Use this" : "Keep this").font(.headline) }
                                .buttonStyle(.borderedProminent).tint(allPass ? .green : .orange)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(Color.black.opacity(0.92))
            .navigationTitle("Read and check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .alert("Type the value", isPresented: Binding(get: { typing != nil }, set: { if !$0 { typing = nil } }), presenting: typing) { a in
                TextField(a.isReading ? "e.g. 79.6" : "the text", text: $typedText)
                Button("Record as typed") {
                    let r = ReadingJudge.evaluate(a, read: typedText, typed: true)
                    results.removeAll { $0.assertionId == a.id }; results.append(r)
                    results.sort { lhs, rhs in (assertions.firstIndex { $0.id == lhs.assertionId } ?? 0) < (assertions.firstIndex { $0.id == rhs.assertionId } ?? 0) }
                    if phase != .review { phase = .review }
                }
                Button("Cancel", role: .cancel) { }
            } message: { a in
                Text("Only when the camera cannot read it. The record will say the value was typed, not read. Expected: \(a.expected)")
            }
        }
        .preferredColorScheme(.dark)
    }

    // ── AROMS-350: training captures the words ───────────────────────────────

    private var labelChecks: [StepAssertion] { assertions.filter { $0.kind == "text-match" || $0.kind == "code" } }
    private func fold(_ s: String) -> String {
        s.precomposedStringWithCompatibilityMapping.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ").lowercased()
    }
    /// Vision boxes are bottom-left normalised; the app stores top-left normalised.
    private func topLeft(_ b: CGRect) -> CGRect { CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height) }

    /// The recognised lines as chips, one row per label check. The line that
    /// carries the typed expectation is pre-selected; tapping another makes it
    /// the expectation - so the step expects what the camera reads, in the
    /// camera's spelling, and a blank check is filled from the real label.
    /// The lines a check can pick from: decoded barcodes for a Barcode check, recognised text otherwise (AROMS-340).
    private func candidates(for a: StepAssertion) -> [Recognised] { a.kind == "code" ? decodedCodes : recognised }

    @ViewBuilder
    private var labelPicker: some View {
        ForEach(labelChecks) { a in
            let lines = candidates(for: a)
            let isCode = a.kind == "code"
            VStack(alignment: .leading, spacing: 6) {
                if lines.isEmpty {
                    Text(isCode ? "No barcode decoded in the frame - fill the camera with it and Read again."
                                : "Nothing readable in the frame - move closer to the label and Read again.")
                        .font(.footnote).foregroundStyle(Color.orange)
                } else if let i = picked[a.id], i < lines.count {
                    Text(fold(lines[i].text) == fold(a.expected)
                         ? "The step will expect \"\(lines[i].text)\" - as the camera reads it."
                         : a.expected.isEmpty
                            ? "The step will expect \"\(lines[i].text)\"."
                            : "The step will expect \"\(lines[i].text)\" (was \"\(a.expected)\").")
                        .font(.footnote).foregroundStyle(.white.opacity(0.8))
                } else {
                    Text(a.expected.isEmpty
                         ? (isCode ? "Tap the barcode the step must find." : "Tap the line the label must say.")
                         : "The camera didn't read \"\(a.expected)\" - tap the \(isCode ? "barcode" : "line") it did read, or Read again.")
                        .font(.footnote).foregroundStyle(Color.orange)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                            let on = picked[a.id] == i
                            Button { pick(a, index: i) } label: {
                                Label(line.symbology.map { "\($0) · \(line.text)" } ?? line.text, systemImage: on ? "checkmark.circle.fill" : (isCode ? "barcode" : "textformat"))
                                    .font(.caption.weight(on ? .bold : .regular)).lineLimit(1)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(on ? Color.green.opacity(0.25) : Color.white.opacity(0.08), in: Capsule())
                                    .overlay(Capsule().strokeBorder(on ? Color.green : Color.white.opacity(0.15)))
                                    .foregroundStyle(on ? Color.green : .white)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func pick(_ a: StepAssertion, index: Int) {
        let lines = candidates(for: a)
        guard index < lines.count else { return }
        picked[a.id] = index
        matchedBoxes[a.id] = topLeft(lines[index].box)
        // The verdict follows the pick, so the author sees the operator's words for this choice.
        var chosen = a; chosen.expected = lines[index].text; chosen.match = "contains"
        let r = ReadingJudge.evaluate(chosen, read: a.kind == "code" ? lines[index].text : recognised.map(\.text).joined(separator: " "), typed: false)
        results.removeAll { $0.assertionId == a.id }; results.append(r)
        results.sort { lhs, rhs in (assertions.firstIndex { $0.id == lhs.assertionId } ?? 0) < (assertions.firstIndex { $0.id == rhs.assertionId } ?? 0) }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private var framingHint: String {
        if assertions.contains(where: { $0.isReading }) {
            let inst = assertions.first { $0.isReading }?.instrumentWords.lowercased() ?? "display"
            return "Hold the \(inst) display steady in the camera above, close enough to read the digits, then tap Read."
        }
        if assertions.contains(where: { $0.kind == "code" }) && !assertions.contains(where: { $0.kind == "text-match" }) {
            return "Fill the camera above with the barcode, QR or Data Matrix, square on, then tap Read."
        }
        if assertions.contains(where: { $0.kind == "code" }) {
            return "Frame the label with its barcode in the camera above, then tap Read."
        }
        return "Frame the label or the engraved number in the camera above, then tap Read."
    }

    private func icon(for a: StepAssertion) -> String {
        switch a.kind { case "text-value": return "gauge.with.needle"; case "code": return "barcode"; case "location": return "mappin.and.ellipse"; default: return "textformat" }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /// AROMS-340: the symbologies a Luna label or a part tag carries - 1D
    /// (Code 128 / 39, EAN, UPC, ITF-14), QR, Data Matrix, PDF417, Aztec.
    private static let codeSymbologies: [VNBarcodeSymbology] = [.qr, .dataMatrix, .code128, .code39, .ean13, .ean8, .upce, .itf14, .pdf417, .aztec]

    private func read() {
        guard let img = frameSource(), let cg = img.cgImage else { return }
        frame = img; phase = .reading
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let wantsCodes = assertions.contains { $0.kind == "code" }
        let text = VNRecognizeTextRequest()
        text.recognitionLevel = .accurate
        text.usesLanguageCorrection = false        // digits and part numbers must not be "corrected"
        let codes = VNDetectBarcodesRequest()
        codes.symbologies = Self.codeSymbologies
        DispatchQueue.global(qos: .userInitiated).async {
            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            try? handler.perform(wantsCodes ? [text, codes] : [text])
            let found = (text.results ?? []).compactMap { o -> Recognised? in
                guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { return nil }
                return Recognised(text: s, box: o.boundingBox)
            }
            // A decoded code is a line like any other, prefixed so the author sees
            // what kind it was; the payload alone is what is judged and saved.
            let decoded = wantsCodes ? (codes.results ?? []).compactMap { o -> Recognised? in
                guard let p = o.payloadStringValue, !p.isEmpty else { return nil }
                return Recognised(text: p, box: o.boundingBox, symbology: Self.symbologyWords(o.symbology))
            } : []
            DispatchQueue.main.async { finish(with: found, codes: decoded) }
        }
    }

    private static func symbologyWords(_ s: VNBarcodeSymbology) -> String {
        switch s {
        case .qr: return "QR"; case .dataMatrix: return "Data Matrix"; case .code128: return "Code 128"; case .code39: return "Code 39"
        case .ean13: return "EAN-13"; case .ean8: return "EAN-8"; case .upce: return "UPC-E"; case .itf14: return "ITF-14"
        case .pdf417: return "PDF417"; case .aztec: return "Aztec"; default: return "code"
        }
    }

    private func finish(with found: [Recognised], codes: [Recognised]) {
        recognised = found.sorted { $0.box.maxY > $1.box.maxY }
        decodedCodes = codes
        let joined = recognised.map(\.text).joined(separator: " ")
        // A reading: the tallest line that carries a number is the display's main digits.
        let numeric = found.filter { ReadingJudge.parseReading($0.text) != nil }.max { $0.box.height < $1.box.height }?.text
        matchedBoxes = [:]
        picked = [:]
        var out: [StepReadingResult] = []
        for a in assertions where a.kind != "location" {
            let want = fold(a.expected)
            if a.kind == "code" {
                // AROMS-340: a Code check is judged on the decoded payloads - the
                // one that carries the expectation, else all of them in words. With
                // nothing decoded, the digits printed under the code are the fallback,
                // said as such, so a scuffed barcode still has a way through.
                let hit = codes.first { !want.isEmpty && fold($0.text).contains(want) } ?? codes.first
                if let hit {
                    var r = ReadingJudge.evaluate(a, read: hit.text, typed: false)
                    if !r.pass && codes.count > 1 {
                        r = StepReadingResult(assertionId: r.assertionId, kind: r.kind, pass: false, read: codes.map(\.text).joined(separator: " | "), value: nil, typed: false, onFail: r.onFail,
                                              words: "Barcodes read: \(codes.map { "\($0.symbology ?? "barcode") \"\($0.text)\"" }.joined(separator: ", ")) - \"\(a.expected)\" not among them", at: r.at)
                    } else if r.pass {
                        r = StepReadingResult(assertionId: r.assertionId, kind: r.kind, pass: true, read: hit.text, value: nil, typed: false, onFail: r.onFail,
                                              words: "\(hit.symbology ?? "Barcode") \"\(hit.text)\" - carries \"\(a.expected)\"", at: r.at)
                    }
                    out.append(r)
                    matchedBoxes[a.id] = topLeft(hit.box)
                } else {
                    var r = ReadingJudge.evaluate(a, read: joined, typed: false)
                    r = StepReadingResult(assertionId: r.assertionId, kind: r.kind, pass: r.pass, read: r.read, value: nil, typed: false, onFail: r.onFail,
                                          words: r.pass ? "No barcode decoded; the printed text carries \"\(a.expected)\"" : (joined.isEmpty ? "No barcode in the frame - expected \"\(a.expected)\"" : "No barcode decoded, and the printed text doesn't carry \"\(a.expected)\""), at: r.at)
                    out.append(r)
                    if let tallest = found.max(by: { $0.box.height < $1.box.height }) { matchedBoxes[a.id] = topLeft(tallest.box) }
                }
                if authoring, !want.isEmpty, let i = codes.firstIndex(where: { fold($0.text).contains(want) }) { picked[a.id] = i }
                continue
            }
            let read = a.isReading ? (numeric ?? joined) : joined
            let r = ReadingJudge.evaluate(a, read: read, typed: false)
            out.append(r)
            // The line that carried the match (or, for a reading, the digits) - where the text is.
            let tallest = a.isReading ? nil : found.max(by: { $0.box.height < $1.box.height })
            if let hit = found.first(where: { a.isReading ? $0.text == numeric : (!want.isEmpty && fold($0.text).contains(want)) }) ?? tallest {
                matchedBoxes[a.id] = topLeft(hit.box)
            }
            // AROMS-350: in Author mode, pre-select the line that carries the typed
            // expectation; a blank or unread one waits for the author's tap.
            if authoring && !a.isReading, !want.isEmpty,
               let i = recognised.firstIndex(where: { fold($0.text).contains(want) }) {
                picked[a.id] = i
            }
        }
        // AROMS-339: location - the text's place now against where it was trained
        // (the region stored on the step's first trained text-match).
        for a in assertions where a.kind == "location" {
            let anchorText = assertions.first { $0.kind == "text-match" && $0.region != nil } ?? assertions.first { $0.kind == "text-match" }
            if anchorText == nil {
                // A position with no label text to anchor it is a configuration slip, said in words, never a block.
                out.append(StepReadingResult(assertionId: a.id, kind: a.kind, pass: false, read: "", value: nil, typed: false, onFail: "flag", words: "No label text to check the position against - skipped", at: ISO8601DateFormatter().string(from: Date())))
                continue
            }
            let matched = anchorText.flatMap { matchedBoxes[$0.id] }
            out.append(ReadingJudge.evaluateLocation(a, trained: anchorText?.region, matched: matched, typed: false))
        }
        results = out
        phase = .review
        UINotificationFeedbackGenerator().notificationOccurred(allPass ? .success : .warning)
    }
}
