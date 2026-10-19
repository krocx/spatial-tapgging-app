// ReadingCaptureSheet.swift - read an instrument display, a label or a part
// number with the camera and judge it against the step's checks (AROMS-338).
//
// A half-height sheet over the live AR camera: the operator frames the
// display above the sheet and taps Read. The current AR frame (raw camera
// image, no AR artefacts) goes through Vision on-device (ReadingEngine);
// for a reading three frames are sampled over a second and the value that
// recurs is kept (AROMS-342). Every assertion is judged (ReadingJudge) and
// said in words; the frame with the read is the step's evidence. "Type it
// instead" is the explicit fallback and is recorded as typed, not read.
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
    @State private var recognised: [ReadingEngine.Line] = []
    @State private var results: [StepReadingResult] = []
    @State private var typing: StepAssertion? = nil
    @State private var typedText = ""
    @State private var flash = 0.0

    private enum Phase { case framing, reading, review }
    /// AROMS-340: the barcodes decoded from the frame, judged and offered for Barcode checks.
    @State private var decodedCodes: [ReadingEngine.Line] = []
    /// AROMS-342: the values seen across the sampled frames, when the display moved.
    @State private var samples: [Double] = []
    @State private var stable = true

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
                                    let b = lines[i].box
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
    private func fold(_ s: String) -> String { ReadingEngine.fold(s) }

    /// The recognised lines as chips, one row per label check. The line that
    /// carries the typed expectation is pre-selected; tapping another makes it
    /// the expectation - so the step expects what the camera reads, in the
    /// camera's spelling, and a blank check is filled from the real label.
    /// The lines a check can pick from: decoded barcodes for a Barcode check, recognised text otherwise (AROMS-340).
    private func candidates(for a: StepAssertion) -> [ReadingEngine.Line] { a.kind == "code" ? decodedCodes : recognised }

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
        matchedBoxes[a.id] = lines[index].box
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

    private func read() {
        guard let first = frameSource() else { return }
        frame = first; phase = .reading
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let wantsCodes = assertions.contains { $0.kind == "code" }
        let wantsReading = assertions.contains { $0.isReading }
        let checks = assertions
        Task {
            // AROMS-342: a reading is sampled three times over about a second, so
            // a display that is still settling is seen settling, and one glitched
            // frame does not decide. Labels and barcodes read the first frame only.
            var frames: [ReadingEngine.Frame] = [await ReadingEngine.recognise(first, wantsCodes: wantsCodes)]
            if wantsReading {
                for _ in 0..<2 {
                    try? await Task.sleep(nanoseconds: 350_000_000)
                    if let img = frameSource() { frames.append(await ReadingEngine.recognise(img, wantsCodes: false)) }
                }
                if frames.count > 1, let last = frameSource() { frame = last }
            }
            let j = ReadingEngine.judge(checks, frames: frames, authoring: authoring)
            recognised   = frames.last?.lines ?? []
            decodedCodes = frames.first?.codes ?? []
            matchedBoxes = j.matchedBoxes
            picked       = j.picked
            samples      = j.samples
            stable       = j.stable
            results      = j.results
            phase = .review
            UINotificationFeedbackGenerator().notificationOccurred(allPass ? .success : .warning)
        }
    }
}
