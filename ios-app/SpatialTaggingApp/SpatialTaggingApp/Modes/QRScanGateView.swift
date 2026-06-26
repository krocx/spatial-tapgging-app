// QRScanGateView.swift — Phase 3 (+ ARWorldMap local + remote persistence)
// Mandatory session initialiser shared by both Author and Operator modes.
//
// Role:
//   • Presents a full-screen AR camera that scans the physical anchor QR.
//   • On successful scan it:
//       1. Reads the encryption key from the QR payload → stores in AppState.
//       2. Captures the gravity-aligned QR world transform → stores in AppState.
//       3. Calls onSessionReady() automatically (no extra tap needed).
//       4. Saves the ARWorldMap to LOCAL file (Documents/WorldMaps/{anchorId}.worldmap)
//          AND uploads to SIB in the background for cross-device sync.
//   • On startup, loads a saved ARWorldMap with this priority:
//       1. LOCAL file — instant, offline-capable (no network needed)
//       2. SIB server — cross-device authoritative backup (requires network)
//       3. Fresh session — fallback when neither exists
//     Using a saved map lets ARKit relocalize into the ORIGINAL feature-point
//     cloud so all tag positions match across sessions without requiring the user
//     to "scan around" to rebuild the world map from scratch.
//   • No "Skip" button — QR scan is mandatory to lock the session origin.
//
// Prerequisites:
//   • appState.activeAnchor and appState.activeTags must already be set before
//     presenting this view (done by AnchorHubView when "Enter AR Session" is tapped).
//
// Flow:
//   AnchorHubView → QRScanGateView → AuthorModeView / OperatorModeView

import SwiftUI
import ARKit
import CryptoKit

struct QRScanGateView: View {

    let mode: AppMode                       // .author or .operator
    let onSessionReady: () -> Void          // called once QR locked + anchor set
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @StateObject private var arManager = ARSessionManager()

    // UX state
    @State private var scanPhase: ScanPhase = .waiting
    @State private var scanError: String? = nil
    // #63: safety net for the wrong-QR path. The scanner itself is fixed to
    // recognise a re-scan now (see ARSessionManager.resetScan), but a user who
    // keeps scanning the wrong physical QR (e.g. wrong asset entirely) would
    // otherwise be stuck on this screen indefinitely with only a Cancel button.
    // Auto-return to anchor selection after a short idle window so they're not
    // left stranded.
    @State private var wrongQRTimeoutWorkItem: DispatchWorkItem? = nil
    private let wrongQRTimeoutSeconds: TimeInterval = 45

    // ── SIBClient — used for world-map upload/download ────────────────────────
    private var sibClient: SIBClient { SIBClient(settings: settings) }

    // ── Local WorldMap storage ────────────────────────────────────────────────
    // Saves ARWorldMap data to Documents/WorldMaps/{anchorId}.worldmap so the
    // app can relocalize without network access.  Local is tried first on every
    // startup (instant, offline-capable); SIB is the authoritative remote backup.

    private static func localWorldMapURL(anchorId: String) -> URL? {
        guard let docs = FileManager.default.urls(for: .documentDirectory,
                                                   in: .userDomainMask).first else { return nil }
        let dir = docs.appendingPathComponent("WorldMaps", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir,
                                                  withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(anchorId).worldmap")
    }

    private static func loadLocalWorldMap(anchorId: String) -> Data? {
        guard let url = localWorldMapURL(anchorId: anchorId) else { return nil }
        return try? Data(contentsOf: url)
    }

    private static func saveLocalWorldMap(anchorId: String, data: Data) {
        guard let url = localWorldMapURL(anchorId: anchorId) else { return }
        do {
            try data.write(to: url, options: .atomic)
            print("[QRScanGateView] ✓ World map saved locally (\(data.count / 1024) KB) for anchor \(anchorId)")
        } catch {
            print("[QRScanGateView] Local world map save failed: \(error.localizedDescription)")
        }
    }

    private enum ScanPhase: Equatable {
        case waiting          // scanning, no QR detected yet
        case detected         // QR found, stabilising
        case locking          // verifying anchor match
        case locked           // success — short feedback before auto-proceed
        case error(String)
    }

    // ── Session-preserving AR view ────────────────────────────────────────────
    // We use OwnSCNViewContainer (no dismantleUIView) instead of ARContainerView
    // so that the ARSession is NOT paused when QRScanGateView is dismissed.
    // After lockSession() the session is stored in appState.activeARSession and
    // picked up by AuthorModeView / OperatorModeView without a world-frame reset.
    private struct OwnSCNViewContainer: UIViewRepresentable {
        let sceneView: ARSCNView
        func makeUIView(context: Context) -> ARSCNView { sceneView }
        func updateUIView(_ uiView: ARSCNView, context: Context) {}
        // Intentionally no dismantleUIView — session lifecycle is owned by AppState.
    }

    var body: some View {
        ZStack {
            // ── Full-screen AR camera ──────────────────────────────────────────
            OwnSCNViewContainer(sceneView: arManager.sceneView).ignoresSafeArea()

            VStack(spacing: 0) {
                // ── Top instruction / status ───────────────────────────────────
                VStack(spacing: 8) {
                    modeChip
                    statusCard
                }
                .padding(.horizontal, 16).padding(.top, 8)

                Spacer()

                // ── Corner QR frame guide ──────────────────────────────────────
                if scanPhase == .waiting || scanPhase == .detected {
                    qrFrameGuide
                        .transition(.opacity)
                }

                // ── Locked confirmation ────────────────────────────────────────
                if case .locked = scanPhase {
                    lockedCard
                        .padding(.horizontal, 24).padding(.bottom, 48)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                Spacer().frame(maxHeight: 60)
            }

            // ── Cancel ─────────────────────────────────────────────────────────
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
        .animation(.easeInOut(duration: 0.3), value: scanPhase == .locked)
        .onAppear {
            // WorldMap loading priority:
            //   1. LOCAL file (Documents/WorldMaps/{anchorId}.worldmap) — instant, offline-capable
            //   2. SIB server download — requires network, used when local is missing/stale
            //   3. Fresh session (no relocalization) — fallback when neither is available
            //
            // Using a saved map lets ARKit relocalize into the ORIGINAL feature-point
            // cloud so all tag positions match regardless of the operator's starting
            // viewpoint.  This removes the need to "walk around to trace the worldmap".
            Task {
                guard let anchorId = appState.activeAnchor?.id else {
                    arManager.startSession()
                    return
                }

                // ── 1. Try local file first (offline-capable, no latency) ──────
                if let localData = QRScanGateView.loadLocalWorldMap(anchorId: anchorId) {
                    print("[QRScanGateView] Using LOCAL world map (\(localData.count / 1024) KB) — starting relocalization")
                    await MainActor.run { arManager.startSessionWithWorldMap(localData) }
                    // Still try to refresh from SIB in background in case a newer
                    // map was uploaded from another device (non-blocking).
                    Task {
                        if let remoteData = try? await sibClient.fetchWorldMap(anchorId: anchorId),
                           remoteData.count != localData.count {
                            print("[QRScanGateView] Remote map differs — updating local cache")
                            QRScanGateView.saveLocalWorldMap(anchorId: anchorId, data: remoteData)
                        }
                    }
                    return
                }

                // ── 2. Try SIB server ─────────────────────────────────────────
                if let remoteData = try? await sibClient.fetchWorldMap(anchorId: anchorId) {
                    print("[QRScanGateView] Downloaded world map from SIB (\(remoteData.count / 1024) KB) — caching locally and starting relocalization")
                    QRScanGateView.saveLocalWorldMap(anchorId: anchorId, data: remoteData)
                    await MainActor.run { arManager.startSessionWithWorldMap(remoteData) }
                    return
                }

                // ── 3. Fresh session ──────────────────────────────────────────
                print("[QRScanGateView] No world map available (local or remote) — starting fresh session")
                arManager.startSession()
            }
        }
        .onDisappear {
            // Only pause if the session was NOT handed off to a successor view.
            // After lockSession() appState.activeARSession is set — the session
            // must stay running so AuthorModeView / OperatorModeView can link to it.
            // If the user cancelled before a lock, no handoff happened → pause now.
            if appState.activeARSession == nil {
                arManager.pauseSession()
            }
            // #63: this view is already gone one way or another — don't let a
            // pending auto-return fire onCancel() a second time later.
            wrongQRTimeoutWorkItem?.cancel()
            wrongQRTimeoutWorkItem = nil
        }
        .onChange(of: arManager.scanState) { state in
            if case .detected = state { scanPhase = .detected }
            if case .locked(let ctx) = state {
                scanPhase = .locking
                lockSession(context: ctx)
            }
        }
        .overlay(cornerDots)
    }

    // ── Sub-views ─────────────────────────────────────────────────────────────

    private var modeChip: some View {
        HStack {
            Image(systemName: mode == .author ? "pencil.circle.fill" : "eye.circle.fill")
            Text(mode == .author ? "Author Mode" : "Operator Mode").font(.headline)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14).padding(.vertical, 6)
        .background(.ultraThinMaterial).clipShape(Capsule())
    }

    private var statusCard: some View {
        HStack(spacing: 10) {
            switch scanPhase {
            case .waiting:
                if arManager.isRelocalizing {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.orange)
                    Text("Relocalizing… look around the anchor area")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                } else {
                    Image(systemName: "qrcode.viewfinder")
                        .foregroundStyle(.cyan)
                    Text("Point at the anchor QR code")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                }
            case .detected:
                ProgressView().tint(.cyan).scaleEffect(0.8)
                Text("Stabilising…").font(.subheadline).foregroundStyle(.white)
            case .locking:
                ProgressView().tint(.cyan).scaleEffect(0.8)
                Text("Locking origin…").font(.subheadline).foregroundStyle(.white)
            case .locked:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Origin locked").font(.subheadline.bold()).foregroundStyle(.white)
            case .error(let msg):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text(msg).font(.caption).foregroundStyle(.white).lineLimit(2)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var qrFrameGuide: some View {
        GeometryReader { geo in
            let side: CGFloat = min(geo.size.width, geo.size.height) * 0.5
            let cx = geo.size.width / 2
            let cy = geo.size.height / 2
            let cornerLen: CGFloat = 28
            let thick: CGFloat = 3
            let r: CGFloat = 6
            let color = scanPhase == .detected ? Color.cyan : Color.white.opacity(0.7)

            ZStack {
                // Dark vignette to focus attention on the centre
                Color.black.opacity(0.45).ignoresSafeArea()
                    .mask {
                        Rectangle().overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .frame(width: side, height: side)
                                .blendMode(.destinationOut)
                        )
                        .compositingGroup()
                    }

                // Subtly animated corner brackets
                Group {
                    // Top-left
                    cornerBracket(at: CGPoint(x: cx - side/2, y: cy - side/2),
                                  hDir: 1, vDir: 1, len: cornerLen, thick: thick, radius: r, color: color)
                    // Top-right
                    cornerBracket(at: CGPoint(x: cx + side/2, y: cy - side/2),
                                  hDir: -1, vDir: 1, len: cornerLen, thick: thick, radius: r, color: color)
                    // Bottom-left
                    cornerBracket(at: CGPoint(x: cx - side/2, y: cy + side/2),
                                  hDir: 1, vDir: -1, len: cornerLen, thick: thick, radius: r, color: color)
                    // Bottom-right
                    cornerBracket(at: CGPoint(x: cx + side/2, y: cy + side/2),
                                  hDir: -1, vDir: -1, len: cornerLen, thick: thick, radius: r, color: color)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var lockedCard: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(Color.green.opacity(0.18)).frame(width: 44, height: 44)
                Image(systemName: "lock.fill").font(.title3).foregroundStyle(.green)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Origin locked").font(.headline).foregroundStyle(.white)
                Text("Entering \(mode == .author ? "Author" : "Operator") mode…")
                    .font(.caption).foregroundStyle(.white.opacity(0.6))
            }
            Spacer()
            ProgressView().tint(.white)
        }
        .padding(16)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    /// Dots on physical QR corners detected by ARKit Vision scan
    @ViewBuilder
    private var cornerDots: some View {
        if case .detected = arManager.scanState,
           arManager.detectedQRCorners.count == 4 {
            GeometryReader { geo in
                let size = geo.size
                ForEach(0..<4, id: \.self) { i in
                    let corner = arManager.detectedQRCorners[i]
                    let sx = corner.x * size.width
                    let sy = (1 - corner.y) * size.height
                    ZStack {
                        Circle().fill(Color.cyan.opacity(0.9)).frame(width: 14, height: 14)
                        Circle().stroke(Color.white, lineWidth: 2).frame(width: 14, height: 14)
                    }
                    .position(x: sx, y: sy)
                    .shadow(color: .cyan.opacity(0.6), radius: 4)
                }
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

    // ── Lock the session ──────────────────────────────────────────────────────

    private func lockSession(context: QRAnchorContext) {
        // Verify the QR matches the pre-loaded anchor (if we have one).
        // Mismatch means the user scanned the wrong QR.
        if let active = appState.activeAnchor,
           context.anchorId != active.id {
            arManager.resetScan()
            scanPhase = .error("Wrong QR — this code belongs to a different anchor. Scan the QR for \(active.assetId).")
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                if case .error = scanPhase { scanPhase = .waiting }
            }
            // #63: arm (or re-arm) the auto-return safety net on every wrong-QR
            // hit. Cancelled below once the correct QR locks successfully.
            wrongQRTimeoutWorkItem?.cancel()
            let workItem = DispatchWorkItem { [onCancel] in
                onCancel()
            }
            wrongQRTimeoutWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + wrongQRTimeoutSeconds, execute: workItem)
            return
        }

        // Correct anchor — cancel any pending auto-return from an earlier
        // wrong-QR scan in this session.
        wrongQRTimeoutWorkItem?.cancel()
        wrongQRTimeoutWorkItem = nil

        // ── Extract encryption key ─────────────────────────────────────────────
        if let keyB64 = context.encryptionKey, let symKey = AnchorEncryption.key(fromBase64: keyB64) {
            // QR has the key embedded (new-style QR)
            appState.anchorEncryptionKey = symKey
        } else {
            // Legacy QR or same-device Author — try Keychain
            if let kbKey = AnchorEncryption.loadExistingKey(anchorId: context.anchorId) {
                appState.anchorEncryptionKey = kbKey
            } else if mode == .author {
                // Author on a new device — create a key for this anchor
                appState.anchorEncryptionKey = AnchorEncryption.getOrCreateKey(for: context.anchorId)
            }
        }

        // ── Store the gravity-aligned anchor transform ─────────────────────────
        appState.anchorNormalisedTransform = arManager.lockedAnchorTransform

        // ── Preserve the live ARSession for AuthorModeView / OperatorModeView ──
        // By storing the session here (before QRScanGateView dismisses), the
        // successor view can call arManager.linkToExistingSession() instead of
        // startSession(), keeping the world frame and the live ARImageAnchor intact.
        appState.activeARSession = arManager.sceneView.session

        // ── Serialise, cache locally, and upload the ARWorldMap ──────────────
        // Save to the local Documents/WorldMaps/ directory FIRST (no network needed),
        // then upload to SIB in the background.  On next app launch the local copy
        // is used immediately (no download latency, works offline), and the SIB
        // copy is used as a cross-device authoritative backup.
        let client = sibClient
        let aid    = context.anchorId
        Task {
            if let mapData = await arManager.saveCurrentWorldMap() {
                // ── Local save (instant, offline-capable) ─────────────────────
                QRScanGateView.saveLocalWorldMap(anchorId: aid, data: mapData)

                // ── Remote upload (non-blocking, non-fatal) ───────────────────
                do {
                    try await client.uploadWorldMap(anchorId: aid, data: mapData)
                    print("[QRScanGateView] ✓ World map uploaded to SIB for anchor \(aid)")
                } catch {
                    print("[QRScanGateView] SIB upload failed (non-fatal, local copy saved): \(error.localizedDescription)")
                }
            }
        }

        // ── Disable further QR scanning (origin is locked for this session) ────
        arManager.disableQRScanning()

        // ── Brief visual feedback then auto-proceed ───────────────────────────
        withAnimation { scanPhase = .locked }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            onSessionReady()
        }
    }

    // ── Corner bracket geometry ───────────────────────────────────────────────

    private func cornerBracket(at corner: CGPoint,
                                hDir: CGFloat, vDir: CGFloat,
                                len: CGFloat, thick: CGFloat, radius: CGFloat,
                                color: Color) -> some View {
        Path { path in
            // Horizontal arm
            path.move(to: CGPoint(x: corner.x + hDir * radius, y: corner.y))
            path.addLine(to: CGPoint(x: corner.x + hDir * len, y: corner.y))
            // Corner arc
            path.move(to: CGPoint(x: corner.x + hDir * radius, y: corner.y))
            path.addArc(center: CGPoint(x: corner.x + hDir * radius, y: corner.y + vDir * radius),
                        radius: radius,
                        startAngle: .degrees(vDir > 0 ? -90 : 90),
                        endAngle:   .degrees(hDir > 0 ? 180 : 0),
                        clockwise: hDir * vDir > 0)
            // Vertical arm
            path.move(to: CGPoint(x: corner.x, y: corner.y + vDir * radius))
            path.addLine(to: CGPoint(x: corner.x, y: corner.y + vDir * len))
        }
        .stroke(color, lineWidth: thick)
    }
}
