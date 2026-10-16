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

    @Environment(\.dismiss) private var dismiss
    @State private var phase: Phase = .framing
    @State private var frame: UIImage? = nil
    @State private var recognised: [Recognised] = []
    @State private var results: [StepReadingResult] = []
    @State private var typing: StepAssertion? = nil
    @State private var typedText = ""
    @State private var flash = 0.0

    private enum Phase { case framing, reading, review }
    private struct Recognised { let text: String; let box: CGRect }

    private var assertions: [StepAssertion] { step.assertions ?? [] }
    private var allPass: Bool { ReadingJudge.stepPasses(results) && results.count == assertions.count }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
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
                        if let a = assertions.first(where: { r in !(results.first { $0.assertionId == r.id }?.pass ?? false) }) {
                            Button { typing = a; typedText = "" } label: { Label("Type it instead", systemImage: "keyboard") }
                                .buttonStyle(.bordered)
                        }
                        Spacer()
                        Button { onDone(results, frame); dismiss() } label: { Text(allPass ? "Use this" : "Keep this").font(.headline) }
                            .buttonStyle(.borderedProminent).tint(allPass ? .green : .orange)
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

    private var framingHint: String {
        if assertions.contains(where: { $0.isReading }) {
            let inst = assertions.first { $0.isReading }?.instrumentWords.lowercased() ?? "display"
            return "Hold the \(inst) display steady in the camera above, close enough to read the digits, then tap Read."
        }
        return "Frame the label or the engraved number in the camera above, then tap Read."
    }

    private func icon(for a: StepAssertion) -> String {
        switch a.kind { case "text-value": return "gauge.with.needle"; case "code": return "barcode"; case "location": return "mappin.and.ellipse"; default: return "textformat" }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    private func read() {
        guard let img = frameSource(), let cg = img.cgImage else { return }
        frame = img; phase = .reading
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let request = VNRecognizeTextRequest { req, _ in
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            let found = obs.compactMap { o -> Recognised? in
                guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { return nil }
                return Recognised(text: s, box: o.boundingBox)
            }
            DispatchQueue.main.async { finish(with: found) }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false        // digits and part numbers must not be "corrected"
        DispatchQueue.global(qos: .userInitiated).async {
            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            try? handler.perform([request])
        }
    }

    private func finish(with found: [Recognised]) {
        recognised = found.sorted { $0.box.maxY > $1.box.maxY }
        let joined = recognised.map(\.text).joined(separator: " ")
        // A reading: the tallest line that carries a number is the display's main digits.
        let numeric = found.filter { ReadingJudge.parseReading($0.text) != nil }.max { $0.box.height < $1.box.height }?.text
        results = assertions.map { a in
            let read = a.isReading ? (numeric ?? joined) : joined
            return ReadingJudge.evaluate(a, read: read, typed: false)
        }
        phase = .review
        UINotificationFeedbackGenerator().notificationOccurred(allPass ? .success : .warning)
    }
}
