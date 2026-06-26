// OCRCaptureView.swift — G12
// Single-capture OCR training screen for TagType.languageCheck tags.
//
// Flow:
//  1. Author sees live camera with "Point at label" instruction (ready state).
//  2. Taps "Scan Label" — camera snapshot + Vision VNRecognizeTextRequest run in parallel.
//  3. Detected text shown in an editable field so Author can correct misreads.
//  4. "Confirm & Train" →
//       a. PATCH /tags/:id to store detected text in tag.expectedOutcome
//          (Operator uses this for client-side text comparison during validation).
//       b. POST /perception/train with the single reference image (AES-encrypted)
//          as an SSIM fallback in case OCR fails on the Operator device.
//
// Why one image, not seven?
//   Warning / language labels are 2D printed text. A single straight-on
//   capture is sufficient for both OCR extraction and visual SSIM backup.
//   Walking around a paper label in 3D gives no additional information.
//
// OCR engine: Apple Vision VNRecognizeTextRequest — on-device, free, no network.
// Supported scripts: Latin + all scripts supported by the OS locale.

import SwiftUI
import Vision
import ARKit

struct OCRCaptureView: View {

    let tag:             Tag
    let anchor:          Anchor
    let parentArManager: ARSessionManager   // shared from AuthorModeView
    let onTrained:       (String) -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss)  private var dismiss

    // ── Own ARSCNView that shares parentArManager's session ───────────────────
    @StateObject private var svHolder = SceneViewHolder()

    private final class SceneViewHolder: ObservableObject {
        let sceneView: ARSCNView = {
            let v = ARSCNView()
            v.autoenablesDefaultLighting = true
#if DEBUG
            v.debugOptions = [.showFeaturePoints]
#endif
            return v
        }()
    }

    /// Wraps the local ARSCNView with NO dismantleUIView so dismissing this
    /// view never accidentally pauses parentArManager's session.
    private struct OwnSCNViewContainer: UIViewRepresentable {
        let sceneView: ARSCNView
        func makeUIView(context: Context) -> ARSCNView { sceneView }
        func updateUIView(_ uiView: ARSCNView, context: Context) {}
        // No dismantleUIView — session lifecycle owned by parentArManager
    }

    // ── State ─────────────────────────────────────────────────────────────────
    private enum Phase { case ready, scanning, review, uploading }
    @State private var phase: Phase = .ready

    @State private var capturedImage: UIImage?   = nil
    @State private var capturedJpeg:  Data?      = nil
    @State private var detectedText:  String     = ""
    @State private var editedText:    String     = ""
    @State private var ocrWordCount:  Int        = 0
    @State private var trainError:    String?    = nil
    @State private var showSuccess    = false
    @State private var flashOpacity:  Double     = 0

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            OwnSCNViewContainer(sceneView: svHolder.sceneView).ignoresSafeArea()

            Color.white.opacity(flashOpacity)
                .ignoresSafeArea().allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer()
                centerContent
                Spacer()
                bottomBar
            }

            if showSuccess { successOverlay }
        }
        .onAppear {
            // Link our local ARSCNView to AuthorModeView's already-running session.
            // No startSession() — that would reset the world frame and invalidate
            // the anchor transform that was locked in QRScanGateView.
            svHolder.sceneView.session = parentArManager.sceneView.session
        }
        .onDisappear {
            // DO NOT pause — session belongs to parentArManager (AuthorModeView).
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [.black.opacity(0.70), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 130).allowsHitTesting(false)

            HStack(alignment: .center, spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white, Color.black.opacity(0.4))
                }
                Spacer()
                VStack(spacing: 3) {
                    Text(tag.label)
                        .font(.subheadline.bold()).foregroundColor(.white).lineLimit(1)
                    // OCR badge
                    HStack(spacing: 4) {
                        Image(systemName: "text.viewfinder")
                        Text("OCR Training")
                    }
                    .font(.caption.bold())
                    .foregroundStyle(.indigo)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.ultraThinMaterial, in: Capsule())
                }
                Spacer()
                Color.clear.frame(width: 36)
            }
            .padding(.horizontal, 20).padding(.top, 56)
        }
    }

    // ── Center content — switches on phase ────────────────────────────────────

    @ViewBuilder
    private var centerContent: some View {
        switch phase {

        case .ready:
            // Framing guide — crosshair to align the label in the center
            VStack(spacing: 14) {
                Image(systemName: "text.viewfinder")
                    .font(.system(size: 52, weight: .light))
                    .foregroundStyle(.white.opacity(0.80))
                    .shadow(color: .black.opacity(0.5), radius: 4)
                Text("Frame the label in the centre, then tap Scan")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(0.4), radius: 3)
            }
            .padding(.horizontal, 32)

        case .scanning:
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.4)
                    .tint(.white)
                Text("Scanning label…")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
            }

        case .review:
            VStack(spacing: 0) {
                // Captured image thumbnail
                if let img = capturedImage {
                    Image(uiImage: img)
                        .resizable().scaledToFill()
                        .frame(height: 160)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.indigo.opacity(0.6), lineWidth: 1.5))
                        .padding(.horizontal, 24)
                        .padding(.bottom, 14)
                }

                // Detected text editor
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Label("Detected text", systemImage: "character.magnify")
                            .font(.caption.bold())
                            .foregroundStyle(.indigo)
                        Spacer()
                        if ocrWordCount > 0 {
                            Text("\(ocrWordCount) word\(ocrWordCount == 1 ? "" : "s")")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    TextEditor(text: $editedText)
                        .font(.body)
                        .frame(minHeight: 80, maxHeight: 130)
                        .padding(10)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.indigo.opacity(0.3), lineWidth: 1))

                    if editedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No text detected — type the label content manually.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    } else {
                        Text("Edit if Vision misread any characters, then tap Confirm.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 24)
            }

        case .uploading:
            VStack(spacing: 12) {
                ProgressView().tint(.white).scaleEffect(1.2)
                Text("Training tag…")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.75))
            }
        }
    }

    // ── Bottom bar ────────────────────────────────────────────────────────────

    @ViewBuilder
    private var bottomBar: some View {
        VStack(spacing: 12) {
            if let err = trainError {
                Text(err)
                    .font(.caption).foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            switch phase {
            case .ready:
                Button { scanLabel() } label: {
                    Label("Scan Label", systemImage: "text.viewfinder")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                }
                .buttonStyle(.borderedProminent)
                .tint(.indigo)
                .padding(.horizontal, 24)

            case .scanning:
                EmptyView()

            case .review:
                VStack(spacing: 10) {
                    // Confirm — stores text + uploads image
                    Button { Task { await confirmAndTrain() } } label: {
                        Label("Confirm & Train", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                    .disabled(editedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .padding(.horizontal, 24)

                    // Rescan — go back to ready state
                    Button { rescan() } label: {
                        Label("Rescan", systemImage: "arrow.counterclockwise")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                    }
                    .buttonStyle(.bordered)
                    .tint(.indigo)
                    .padding(.horizontal, 24)
                }

            case .uploading:
                EmptyView()
            }
        }
        .padding(.bottom, 48)
    }

    // ── Success overlay ───────────────────────────────────────────────────────

    private var successOverlay: some View {
        ZStack {
            Color.black.opacity(0.82).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "text.badge.checkmark")
                    .font(.system(size: 72))
                    .foregroundStyle(.indigo)
                    .symbolEffect(.bounce, value: showSuccess)
                Text("Label Trained!")
                    .font(.title.bold()).foregroundColor(.white)
                Text("\"\(tag.label)\" — OCR expected text stored.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center).padding(.horizontal, 32)
                let preview = editedText.count > 80
                    ? String(editedText.prefix(80)) + "…"
                    : editedText
                Text("\u{201C}\(preview)\u{201D}")
                    .font(.caption.italic())
                    .foregroundStyle(.white.opacity(0.55))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Done") { onTrained(tag.id); dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                    .controlSize(.large)
            }
        }
        .transition(.opacity)
    }

    // ── Scan ──────────────────────────────────────────────────────────────────

    private func scanLabel() {
        // Use raw camera image (zero AR artifacts) — same fix as honeycomb/cone
        let frame    = svHolder.sceneView.session.currentFrame
        let snapshot = frame.flatMap { HoneycombCaptureView.rawCameraImage(from: $0) }
                       ?? svHolder.sceneView.snapshot()
        guard let jpeg = snapshot.jpegData(compressionQuality: 0.85) else { return }
        capturedImage = snapshot
        capturedJpeg  = jpeg
        phase = .scanning

        // Flash
        flashOpacity = 0.55
        withAnimation(.easeOut(duration: 0.25)) { flashOpacity = 0 }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()

        // Vision OCR — accurate mode, language correction on
        guard let cgImage = snapshot.cgImage else {
            detectedText = ""; editedText = ""; phase = .review; return
        }

        let request = VNRecognizeTextRequest { req, _ in
            let observations = req.results as? [VNRecognizedTextObservation] ?? []
            // Collect all recognised strings, sorted top → bottom by Y position
            let sorted = observations.sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
            let lines  = sorted.compactMap { $0.topCandidates(1).first?.string }
            let joined = lines.joined(separator: " ")
            DispatchQueue.main.async {
                detectedText  = joined
                editedText    = joined
                ocrWordCount  = joined.components(separatedBy: .whitespaces)
                                      .filter { !$0.isEmpty }.count
                phase = .review
            }
        }
        request.recognitionLevel    = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages   = ["en-US", "en-GB"]   // extend as needed

        DispatchQueue.global(qos: .userInitiated).async {
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try? handler.perform([request])
        }
    }

    private func rescan() {
        capturedImage = nil; capturedJpeg = nil
        detectedText  = "";  editedText   = ""; ocrWordCount = 0
        trainError    = nil
        phase = .ready
    }

    // ── Train ─────────────────────────────────────────────────────────────────

    private func confirmAndTrain() async {
        phase = .uploading
        trainError = nil
        let finalText = editedText.trimmingCharacters(in: .whitespacesAndNewlines)
        let client    = SIBClient(settings: settings)

        // 1. Store expected OCR text in tag.expectedOutcome on SIB.
        //    Operator's client-side validation reads this field to compare
        //    against Vision OCR results on the live Operator frame.
        do {
            _ = try await client.updateTag(
                id: tag.id,
                req: UpdateTagRequest(
                    label:            nil,
                    expectedOutcome:  finalText.isEmpty ? nil : finalText,
                    checkDescription: nil,
                    order:            nil,
                    metadata:         nil
                )
            )
        } catch {
            // Non-fatal — log and continue so the reference image is still uploaded
            print("[OCRCapture] Could not update expectedOutcome: \(error.localizedDescription)")
        }

        // 2. Upload the single reference image as a pass-state backup.
        //    SIB SSIM will run against this if OCR can't extract text on the Operator device.
        guard let jpeg = capturedJpeg else { trainError = "No image captured"; return }

        let encKey = appState.anchorEncryptionKey
            ?? AnchorEncryption.getOrCreateKey(for: anchor.id)
        if appState.anchorEncryptionKey == nil { appState.anchorEncryptionKey = encKey }

        let payload: String
        if let encrypted = try? AnchorEncryption.encrypt(
            imageBase64: jpeg.base64EncodedString(), using: encKey
        ) { payload = encrypted } else { payload = jpeg.base64EncodedString() }

        let now   = ISO8601DateFormatter().string(from: Date())
        let image = PassStateImage(
            id: nil, tagId: tag.id, anchorId: anchor.id, assetId: anchor.assetId,
            imageBase64: payload, mimeType: "image/jpeg",
            // Identity pose — single straight-on capture, position not meaningful
            pose: CameraPose(position: .zero, rotation: .identity),
            capturedAt: now
        )

        do {
            try await client.trainPassState(
                CreatePassStateRequest(tagId: tag.id, anchorId: anchor.id,
                                       assetId: anchor.assetId, images: [image])
            )
            withAnimation(.easeIn(duration: 0.3)) { showSuccess = true }
        } catch {
            trainError = friendlyMessage(for: error) // #75: actionable copy, not raw error text
            phase = .review
        }
    }
}
