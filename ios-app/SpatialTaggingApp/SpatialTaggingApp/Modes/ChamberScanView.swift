// ChamberScanView.swift — C3 (2026.4.45): the operator's front door.
//
// The operator never picks a chamber configuration. They scan the chamber's
// QR; the anchor's `configId` resolves the configuration (and therefore the
// Inspection and Guide libraries) — nothing to choose, nothing to get wrong.
//
//   scan QR ──► fetch anchor ──► chamber with a configuration? ──► AnchorHubView (operator)
//                                 └─ unassigned / not a chamber ──► explain, rescan
//
// GembaWalk areas and iLOTO panels are not chambers; they keep their own
// entry ("Browse areas & panels" on the home screen).

import SwiftUI

struct ChamberScanView: View {
    let onSessionReady: (Anchor, [Tag]) -> Void
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @StateObject private var arManager = ARSessionManager()

    private enum Phase: Equatable { case scanning, resolving, blocked(String) }
    @State private var phase: Phase = .scanning
    @State private var hubAnchor: Anchor? = nil
    @State private var configLabel: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                ARContainerView(arManager: arManager).ignoresSafeArea()

                VStack {
                    // Top: who / what shift
                    VStack(spacing: 6) {
                        Text("Scan the chamber's QR code")
                            .font(.title3.bold()).foregroundStyle(.white)
                        Text(settings.productionNumber.isEmpty
                             ? "The configuration comes from the QR — no need to pick it."
                             : "Prod # \(settings.productionNumber) · the configuration comes from the QR")
                            .font(.footnote).foregroundStyle(.white.opacity(0.7))
                            .multilineTextAlignment(.center)
                    }
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.top, 60).padding(.horizontal, 24)

                    Spacer()

                    // Bottom: state
                    Group {
                        switch phase {
                        case .scanning:
                            Label(scanHint, systemImage: "qrcode.viewfinder")
                                .font(.subheadline).foregroundStyle(.white.opacity(0.85))
                        case .resolving:
                            HStack { ProgressView().tint(.white); Text("Looking up chamber…") }
                                .font(.subheadline).foregroundStyle(.white)
                        case .blocked(let msg):
                            VStack(spacing: 10) {
                                Label(msg, systemImage: "exclamationmark.triangle.fill")
                                    .font(.subheadline).foregroundStyle(.orange)
                                    .multilineTextAlignment(.center)
                                Button("Scan again") { phase = .scanning; arManager.resetScan() }
                                    .font(.subheadline.bold()).foregroundStyle(.cyan)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 24).padding(.bottom, 40)
                }
            }
            .overlay(cornerDots)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }.foregroundStyle(.white)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .navigationDestination(item: $hubAnchor) { anchor in
                AnchorHubView(
                    anchor: anchor,
                    mode: .operator,
                    onSessionReady: { a, tags in onSessionReady(a, tags) },
                    onBack: { hubAnchor = nil; phase = .scanning; arManager.resetScan(); arManager.startSession() }
                )
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
            }
        }
        .onAppear { arManager.startSession() }
        .onDisappear { if appState.activeARSession == nil { arManager.pauseSession() } }
        .onChange(of: arManager.scanState) { state in
            if case .locked(let ctx) = state, phase == .scanning { resolve(ctx) }
        }
    }

    private var scanHint: String {
        if case .detected = arManager.scanState { return "Hold steady…" }
        return "Point the camera at the QR on the chamber"
    }

    /// QR → anchor → configuration. Only chambers with a configuration pass;
    /// everything else explains why and offers a rescan.
    private func resolve(_ ctx: QRAnchorContext) {
        phase = .resolving
        Task {
            let client = SIBClient(settings: settings)
            do {
                let anchor = try await client.fetchAnchor(id: ctx.anchorId)
                guard anchor.isChamber else {
                    phase = .blocked("This QR belongs to a \(anchor.anchorType == .loto ? "LOTO panel" : "GembaWalk area"), not a chamber. Use \"Browse areas & panels\" instead.")
                    return
                }
                guard let cfgId = anchor.configId else {
                    phase = .blocked("\"\(anchor.assetId)\" isn't assigned to a chamber configuration yet — ask your ME to assign it in the portal.")
                    return
                }
                // Label for the home chip (best effort — the id is what matters).
                if let cfg = (try? await client.fetchChamberConfigs())?.first(where: { $0.id == cfgId }) {
                    configLabel = cfg.label
                } else {
                    configLabel = ""
                }
                settings.chamberConfigId    = cfgId
                settings.chamberConfigLabel = configLabel
                settings.lastChamberAssetId = anchor.assetId
                // Same key handling as the classic scan gate: the QR carries the
                // anchor's AES key so the device can read training data.
                if let k = ctx.encryptionKey, let key = AnchorEncryption.key(fromBase64: k) {
                    appState.anchorEncryptionKey = key
                }
                appState.noteScanned(anchorId: anchor.id)   // B: no second scan for guides
                arManager.pauseSession()
                hubAnchor = anchor
            } catch SIBClientError.httpError(404, _) {
                phase = .blocked("This QR isn't registered on the server (\(ctx.assetId)).")
            } catch {
                phase = .blocked(friendlyMessage(for: error))
            }
        }
    }

    @ViewBuilder
    private var cornerDots: some View {
        if case .detected = arManager.scanState, arManager.detectedQRCorners.count == 4 {
            GeometryReader { geo in
                let size = geo.size
                ForEach(0..<4, id: \.self) { i in
                    let c = arManager.detectedQRCorners[i]
                    ZStack {
                        Circle().fill(Color.cyan.opacity(0.9)).frame(width: 14, height: 14)
                        Circle().stroke(Color.white, lineWidth: 2).frame(width: 14, height: 14)
                    }
                    .position(x: c.x * size.width, y: (1 - c.y) * size.height)
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }
}
