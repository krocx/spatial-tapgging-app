// AnchorScanView.swift — Phase 2.5
// Shared QR scan + anchor lock screen used by both Author and Operator modes.
// Phase 2.5 additions:
//  • Extracts AES-256-GCM encryptionKey from QR payload → stored in AppState
//  • G1: Operator mode checks anchor readiness (blocks if no tags trained)
//  • G3: Improved error display with specific offline / auth failure messages

import SwiftUI
import CryptoKit

struct AnchorScanView: View {

    let mode: AppMode
    let onAnchorReady: (Anchor, [Tag]) -> Void
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @StateObject private var arManager = ARSessionManager()

    @State private var isLoadingAnchor = false
    @State private var anchorLoadError: String? = nil
    @State private var loadedAnchor:    Anchor?  = nil
    @State private var loadedTags:      [Tag]    = []
    // G1 — Operator readiness gate
    @State private var readinessWarning: String? = nil
    @State private var anchorIsReady:    Bool     = true
    // trainedTagCount: used to distinguish "some untrained" (warn, allow)
    // from "none trained" (block) — prevents over-aggressive G1 blocking.
    @State private var trainedTagCount:  Int      = 0

    var body: some View {
        ZStack {
            // Full-screen AR camera
            ARContainerView(arManager: arManager).ignoresSafeArea()

            VStack {
                // Top overlay
                VStack(spacing: 8) {
                    modeChip
                    ScanStatusBanner(scanState: arManager.scanState)
                    // Tracking confidence banner — shown when ARKit needs more
                    // scene data before a QR lock will be accepted.
                    if case .limited(let reason) = arManager.trackingState,
                       case .scanning = arManager.scanState {
                        TrackingLimitedBanner(reason: reason)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8)

                Spacer()

                // Bottom card
                if isLoadingAnchor || anchorLoadError != nil || loadedAnchor != nil {
                    bottomCard.padding(.horizontal, 16).padding(.bottom, 32)
                }
            }

            // Cancel button (top-left)
            VStack {
                HStack {
                    Button(action: onCancel) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white, .black.opacity(0.4))
                    }
                    Spacer()
                }
                .padding(.horizontal, 20).padding(.top, 56)
                Spacer()
            }
        }
        .onAppear { arManager.startSession() }
        .onDisappear { arManager.pauseSession() }
        .onChange(of: arManager.scanState) { newState in
            if case .locked(let ctx) = newState {
                Task { await loadAnchor(context: ctx) }
            }
        }
        .overlay(cornerOverlay)
    }

    // ── Sub-views ─────────────────────────────────────────────────────────────

    /// 4-corner dot overlay shown while ARKit is computing the image anchor pose.
    /// The dots snap to the physical QR corners as ARKit tracks the image,
    /// giving the user visual confirmation that the scan is being processed.
    @ViewBuilder
    private var cornerOverlay: some View {
        if case .detected = arManager.scanState,
           arManager.detectedQRCorners.count == 4 {
            GeometryReader { geo in
                let size = geo.size
                ForEach(0..<4, id: \.self) { i in
                    let corner = arManager.detectedQRCorners[i]
                    // Vision: bottom-left origin, y-up → screen: top-left origin, y-down
                    let sx = corner.x * size.width
                    let sy = (1 - corner.y) * size.height
                    ZStack {
                        Circle()
                            .fill(Color.cyan.opacity(0.9))
                            .frame(width: 14, height: 14)
                        Circle()
                            .stroke(Color.white, lineWidth: 2)
                            .frame(width: 14, height: 14)
                    }
                    .position(x: sx, y: sy)
                    .shadow(color: .cyan.opacity(0.6), radius: 4)
                }
                // Draw lines connecting adjacent corners (QR frame outline)
                Path { path in
                    let pts = arManager.detectedQRCorners.map {
                        CGPoint(x: $0.x * size.width, y: (1 - $0.y) * size.height)
                    }
                    path.move(to: pts[0])
                    for p in pts.dropFirst() { path.addLine(to: p) }
                    path.closeSubpath()
                }
                .stroke(Color.cyan.opacity(0.55), lineWidth: 1.5)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.2), value: arManager.detectedQRCorners.count)
        }
    }

    private var modeChip: some View {
        HStack {
            Image(systemName: mode == .author ? "pencil.circle.fill" : "eye.circle.fill")
            Text(mode == .author ? "Author Mode" : "Operator Mode").font(.headline)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14).padding(.vertical, 6)
        .background(.ultraThinMaterial).clipShape(Capsule())
    }

    @ViewBuilder
    private var bottomCard: some View {
        if isLoadingAnchor {
            HStack(spacing: 12) {
                ProgressView()
                Text("Loading anchor from SIB…").font(.subheadline).foregroundColor(.secondary)
            }
            .padding().frame(maxWidth: .infinity)
            .background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 16))

        } else if let error = anchorLoadError {
            VStack(alignment: .leading, spacing: 10) {
                Label("SIB Error", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.bold()).foregroundColor(.red)
                Text(error).font(.caption).foregroundColor(.secondary)
                Button("Retry") {
                    anchorLoadError = nil
                    if case .locked(let ctx) = arManager.scanState {
                        Task { await loadAnchor(context: ctx) }
                    }
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
            }
            .padding().frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 16))

        } else if let anchor = loadedAnchor {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(anchor.assetId).font(.caption).foregroundColor(.secondary)
                        Text(anchor.id).font(.subheadline.bold()).lineLimit(1)
                    }
                    Spacer()
                    Label("\(loadedTags.count) checks", systemImage: "tag.fill")
                        .font(.caption.bold()).foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(loadedTags.isEmpty ? Color.orange : Color.green)
                        .clipShape(Capsule())
                }

                // G1: Operator readiness warning
                if mode == .operator, let warning = readinessWarning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.vertical, 4)
                }

                // No-key warning: Operator scanned a QR without an embedded encryption key
                // and no Keychain entry was found (different device from Author).
                // Results will be ~0% confidence until they scan the app-generated QR.
                if mode == .operator && appState.anchorEncryptionKey == nil && !loadedTags.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Decryption key missing", systemImage: "lock.trianglebadge.exclamationmark.fill")
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                        Text("This QR code doesn't contain an encryption key. Inspections will show 0% confidence. Ask the Author to share the in-app QR code (Author mode → QR icon in top bar).")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    onAnchorReady(anchor, loadedTags)
                } label: {
                    Label("Continue to \(mode == .author ? "Author" : "Operator") Mode",
                          systemImage: mode == .author ? "pencil" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                // G1: block Operator only when anchor exists but has ZERO trained tags.
                // Partially-trained anchors (some done, some pending) show a warning
                // banner above but allow the Operator to proceed — untrained tags
                // simply return PENDING in the validation result.
                .disabled(mode == .operator && !loadedTags.isEmpty && trainedTagCount == 0)
            }
            .padding()
            .background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    // ── SIB loading ───────────────────────────────────────────────────────────

    private func loadAnchor(context: QRAnchorContext) async {
        isLoadingAnchor  = true
        anchorLoadError  = nil
        readinessWarning = nil
        anchorIsReady    = true
        let client = SIBClient(settings: settings)

        do {
            // ── Phase 2.5: extract encryption key from QR payload ─────────────
            // Author mode: QR key → Keychain (so it persists if Author re-opens this anchor)
            // Operator mode: QR key → AppState (for use in validate-all)
            if let keyB64 = context.encryptionKey {
                // App-generated QR — has the encryption key embedded.
                if let symmetricKey = AnchorEncryption.key(fromBase64: keyB64) {
                    appState.anchorEncryptionKey = symmetricKey
                }
            } else {
                // Original physical QR — no key embedded.
                // For Author mode: look up (or create) the key in Keychain.
                // For Operator mode: try Keychain first (same device that did Author work);
                //   if not found the key will remain nil and a warning is shown.
                let keychainKey = AnchorEncryption.loadExistingKey(anchorId: context.anchorId)
                appState.anchorEncryptionKey = keychainKey
                if mode == .operator && keychainKey == nil {
                    print("[AnchorScan] Operator: no encryption key in QR or Keychain for \(context.anchorId). " +
                          "Validation confidence will be ~0. Use the app-generated QR from Author mode.")
                }
            }

            // ── Fetch or create anchor ────────────────────────────────────────
            let anchor: Anchor
            do {
                anchor = try await client.fetchAnchor(id: context.anchorId)
            } catch SIBClientError.httpError(404, _) {
                // Author scanning a brand-new anchor for the first time
                anchor = try await client.createAnchor(CreateAnchorRequest(
                    id: context.anchorId,
                    assetId: context.assetId,
                    coordinateSystem: .assetFrame,
                    position: .zero,
                    rotation: .identity,
                    metadata: [:],
                    encryptionKey: context.encryptionKey,
                    qrSizeCm: context.qrSizeCm ?? 10.0
                ))
                // Ensure we have a key for this new anchor in Keychain
                if appState.anchorEncryptionKey == nil {
                    appState.anchorEncryptionKey = AnchorEncryption.getOrCreateKey(for: anchor.id)
                }
            }
            let tags = try await client.fetchTags(anchorId: anchor.id)

            // ── G1: Operator readiness check ──────────────────────────────────
            if mode == .operator && !tags.isEmpty {
                do {
                    let readiness = try await client.fetchAnchorReadiness(id: anchor.id)
                    anchorIsReady   = readiness.isReady
                    trainedTagCount = readiness.trainedTags

                    if !readiness.isReady {
                        let untrained = readiness.untrainedTagIds.count
                        if readiness.trainedTags == 0 {
                            // Nothing trained at all — block Operator
                            readinessWarning = "No checks trained yet — Author must train all tags before inspection."
                        } else {
                            // Some trained, some not — warn but allow
                            readinessWarning = "\(untrained) of \(readiness.totalTags) check\(untrained == 1 ? "" : "s") not yet trained — untrained tags will show as PENDING."
                        }
                    }
                } catch {
                    // Non-fatal — readiness check failure shouldn't block Operator
                    print("[AnchorScan] Readiness check failed: \(error.localizedDescription)")
                }
            }

            loadedAnchor = anchor
            loadedTags   = tags

            // Store the normalised anchor transform for this session.
            // ARSessionManager.lockAnchor() already applied gravity-alignment,
            // so lockedAnchorTransform is the stable, scan-angle-independent frame.
            // AddTagSheet will use appState.toAnchorRelative() to store tag positions
            // relative to this frame (anchor_rel_x/y/z), which will be valid in any
            // future session that re-detects the same QR with the same normalisation.
            appState.anchorNormalisedTransform = arManager.lockedAnchorTransform

        } catch SIBClientError.httpError(401, _) {
            anchorLoadError = "Unauthorised — check the API key in Settings."
        } catch SIBClientError.networkError {
            anchorLoadError = "Cannot reach SIB server. Check your network connection and the server URL in Settings."
        } catch {
            anchorLoadError = error.localizedDescription
        }
        isLoadingAnchor = false
    }
}
