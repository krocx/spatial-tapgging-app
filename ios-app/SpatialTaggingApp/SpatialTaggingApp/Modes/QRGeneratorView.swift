// QRGeneratorView.swift — Phase 2.5 G7
// In-app QR code generator for Author mode.
//
// Generates a QR code that encodes:
//   { "anchorId": "...", "assetId": "...", "encryptionKey": "base64(key)" }
//
// Operator devices scan this QR to:
//   1. Lock the AR session to the correct anchor (anchorId + assetId)
//   2. Obtain the AES-256-GCM decryption key for pass-state images
//
// The encryption key is generated once per anchor and stored in iOS Keychain.
// It is NEVER sent to the SIB server — only distributed via QR code.
//
// QR image source priority (Phase 3 fix):
//   1. Server-generated PNG via GET /anchors/:id/qrimage  (canonical — same pattern as portal)
//   2. Local CIQRCodeGenerator fallback (offline / SIB unreachable)
// Using the server image ensures the iOS app and the portal always display
// the identical QR pixel pattern (same mask selection), eliminating user confusion.

import SwiftUI
import CoreImage.CIFilterBuiltins

struct QRGeneratorView: View {

    let anchor: Anchor
    let encryptionKey: String  // base64-encoded AES-256 key
    /// Physical QR print size in cm, read from the anchor stored in SIB.
    /// Set once at anchor creation — never changes — so every device and the
    /// portal produce the same QR pixel pattern.
    var qrSizeCm: Double = 10.0
    /// When false the "Done" button is omitted — useful when this view is
    /// embedded inside a parent sheet that provides its own navigation actions.
    var showDoneButton: Bool = true

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: AppSettings

    @State private var qrImage: UIImage? = nil
    @State private var showShareSheet = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {

                // ── QR Code ────────────────────────────────────────────────────
                Group {
                    if let img = qrImage {
                        Image(uiImage: img)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 260, height: 260)
                            .padding(16)
                            .background(Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                    } else {
                        ProgressView("Generating QR code…")
                            .frame(width: 260, height: 260)
                    }
                }
                .padding(.top, 8)

                // ── Info ───────────────────────────────────────────────────────
                VStack(spacing: 8) {
                    Label("Anchor QR Code", systemImage: "qrcode")
                        .font(.headline)

                    VStack(spacing: 4) {
                        InfoRow(label: "Asset", value: anchor.assetId)
                        InfoRow(label: "Anchor", value: String(anchor.id.prefix(18)) + "…")
                        InfoRow(label: "Encryption", value: "AES-256-GCM (embedded in QR)")
                    }
                    .padding(.horizontal, 24)
                }

                // ── Print size (read-only) ─────────────────────────────────────
                // Size is locked at anchor creation and stored in SIB so every
                // device and the portal always produce the same QR.
                HStack(spacing: 6) {
                    Image(systemName: "ruler")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("Print size: \(Int(qrSizeCm)) cm")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("(locked at creation)")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 24)

                // ── Instructions ───────────────────────────────────────────────
                VStack(alignment: .leading, spacing: 6) {
                    Text("How to use this QR code")
                        .font(.subheadline.bold())
                    Text("Print or display this code near the physical anchor location. Operator devices scan it to begin inspection. The code contains the encryption key — treat it like a physical key to the anchor.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                .padding(.horizontal, 24)

                Spacer()

                // ── Actions ────────────────────────────────────────────────────
                VStack(spacing: 12) {
                    Button {
                        showShareSheet = true
                    } label: {
                        Label("Share QR Code", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(qrImage == nil)

                    if showDoneButton {
                        Button("Done") { dismiss() }
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationTitle("Anchor QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .onAppear { generateQR() }
        .sheet(isPresented: $showShareSheet) {
            if let img = qrImage {
                ShareSheet(items: [img])
            }
        }
    }

    // ── QR generation ─────────────────────────────────────────────────────────

    private func generateQR() {
        // Attempt 1: fetch the canonical QR PNG from the server.
        // The server generates it once with the `qrcode` npm library (ECC level M)
        // so the iOS app and the portal always show the identical pixel pattern.
        let client    = SIBClient(settings: settings)
        let anchorId  = anchor.id

        Task { @MainActor in
            if let data = try? await client.fetchAnchorQRImage(anchorId: anchorId),
               let uiImage = UIImage(data: data) {
                qrImage = uiImage
                return
            }
            // Attempt 2: SIB unreachable or offline — generate locally as fallback.
            // Note: the local image may differ visually from the server image
            // (different mask selection), but it encodes the identical data and
            // will scan correctly.  It is used only for display/sharing when
            // the server cannot be reached.
            generateQRLocally()
        }
    }

    /// Local CIQRCodeGenerator fallback — used when SIB is unreachable.
    private func generateQRLocally() {
        let jsonString = QRAnchorContext.buildCanonicalPayload(
            assetId:       anchor.assetId,
            anchorId:      anchor.id,
            encryptionKey: encryptionKey.isEmpty ? nil : encryptionKey,
            qrSizeCm:      qrSizeCm
        )

        DispatchQueue.global(qos: .userInitiated).async {
            let context = CIContext()
            let filter  = CIFilter.qrCodeGenerator()
            filter.message         = Data(jsonString.utf8)
            filter.correctionLevel = "M"

            guard
                let outputImage = filter.outputImage,
                let cgImage = context.createCGImage(
                    outputImage.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
                    from: outputImage.transformed(by: CGAffineTransform(scaleX: 10, y: 10)).extent
                )
            else { return }

            let uiImage = UIImage(cgImage: cgImage)
            DispatchQueue.main.async { self.qrImage = uiImage }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private struct InfoRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).font(.caption.bold()).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption.monospaced()).lineLimit(1)
        }
    }
}

/// UIActivityViewController wrapper for sharing items.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uvc: UIActivityViewController, context: Context) {}
}
