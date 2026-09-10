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
    @EnvironmentObject private var tour:      GuidedTourManager

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

    // ── World map (B1, 2026.4.46) ─────────────────────────────────────────────
    // Loaded through WorldMapCache — the same loader AR Work Instructions use
    // (meta-checked local copy → SIB → fresh session). Doctrine: the AUTHOR's
    // world map is the origin; the QR is the key and a drift check.
    //
    //   relocalized + sealed → origin = sealed pose; QR only checked for drift
    //   relocalized, unsealed (legacy map) → origin = live QR (as before)
    //   timed out → origin = live QR, "reduced accuracy" note
    //
    // Only AUTHOR sessions seal/re-upload the map, and only when the session
    // frame is the map's frame (relocalized) or no map existed yet. Operator
    // scans never overwrite it.
    @State private var mapBundle: WorldMapBundle? = nil
    @State private var originNote: String? = nil
    // B2: reference object (loaded whenever the chamber has a scan; used as the
    // origin only when the anchor's originSource is 'object' and it is calibrated).
    @State private var objectBundle: ReferenceObjectCache.Bundle? = nil
    @State private var originIsObject = false
    // B2e: object-origin chamber → after the QR lock we wait for the chamber's
    // shape with a visible timer; the QR position is an explicit fallback.
    @State private var objectWaitStart: Date? = nil
    @State private var pendingLockContext: QRAnchorContext? = nil
    private var objectExtent: simd_float3? {
        guard let e = objectBundle?.meta.extent else { return nil }
        return simd_float3(Float(e.x), Float(e.y), Float(e.z))
    }

    /// Drift tolerance between the sealed pose and the live QR.
    private let driftMetres: Float  = 0.05
    private let driftDegrees: Float = 10

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

                // ── B2e: chamber finder (object-origin, after the QR lock) ─────
                if scanPhase == .locking, let t0 = objectWaitStart {
                    ObjectFinderCard(
                        title:         "Point at the chamber",
                        extent:        objectExtent,
                        startedAt:     t0,
                        onFallback:    { useQRPositionInstead() },
                        fallbackLabel: "Use the QR position",
                        objectMeta:    objectBundle?.meta
                    )
                    .padding(.horizontal, 24).padding(.bottom, 48)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
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
                // B2: reference object (when the chamber has one) — detection runs
                // in every configuration from here on. Always probed (cheap 404):
                // the anchor record in AppState may predate a scan made this shift.
                if appState.activeAnchor?.isChamber ?? false {
                    let ob = await ReferenceObjectCache.load(anchorId: anchorId, client: sibClient)
                    await MainActor.run {
                        objectBundle = ob
                        arManager.setReferenceObject(ob?.archive, name: anchorId)
                    }
                    // Refresh the anchor so originSource / objectScannedAt are current.
                    if let fresh = try? await sibClient.fetchAnchor(id: anchorId) {
                        await MainActor.run { appState.activeAnchor = fresh }
                    }
                }
                // B1: one loader for every AR surface (meta-checked cache → SIB).
                let bundle = await WorldMapCache.load(.anchor(anchorId), client: sibClient)
                await MainActor.run {
                    mapBundle = bundle
                    // B2e: object-origin + calibrated → the chamber's shape is the
                    // frame. No initialWorldMap: a moved chamber must not be pinned
                    // to where the room map last saw it. (Map kept for the seal.)
                    if appState.activeAnchor?.usesObjectOrigin == true,
                       objectBundle?.meta.objectPoseInQR != nil {
                        print("[QRScanGateView] Object-origin chamber — fresh session, finding it by shape")
                        arManager.startSession()
                    } else if let b = bundle {
                        print("[QRScanGateView] World map \(b.source == .local ? "from cache" : "downloaded") — sealed=\(b.isSealed) — relocalizing")
                        arManager.startSessionWithWorldMap(b.map)
                    } else {
                        print("[QRScanGateView] No world map (local or remote) — starting fresh session")
                        arManager.startSession()
                    }
                }
            }
        }
        .onDisappear {
            // Only pause if the session was NOT handed off to a successor view.
            // After lockSession() appState.activeARSession is set — the session
            // must stay running so AuthorModeView / OperatorModeView can link to it.
            // If the user cancelled before a lock, no handoff happened → pause now.
            if appState.activeARSession == nil {
                arManager.pauseSession()
            } else {
                arManager.stopObjectWatchdog()      // B2e: the mode view's manager owns it now
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
        // Tour: banner shown while waiting for QR scan
        .overlay {
            let qrStep: TourStep = mode == .author ? .scanQRAuthor : .scanQROperator
            if tour.isActive && tour.currentStep == qrStep {
                CoachMarkOverlay(
                    step:       qrStep,
                    targetRect: nil,
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: tour.currentStep)
            }
        }
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
                    // B: for operators this is the LOCALIZATION step (tag
                    // positions live in the QR's frame), not a login.
                    Text(mode == .operator ? "Scan the chamber QR to localize" : "Point at the anchor QR code")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                }
            case .detected:
                ProgressView().tint(.cyan).scaleEffect(0.8)
                Text("Stabilising…").font(.subheadline).foregroundStyle(.white)
            case .locking:
                ProgressView().tint(.cyan).scaleEffect(0.8)
                if let t0 = objectWaitStart {
                    TimelineView(.periodic(from: t0, by: 1)) { ctx in
                        let s = max(0, Int(ctx.date.timeIntervalSince(t0)))
                        Text(String(format: "QR locked · finding the chamber by shape… %d:%02d", s / 60, s % 60))
                            .font(.subheadline.monospacedDigit()).foregroundStyle(.white)
                    }
                } else {
                    Text("Locking origin…").font(.subheadline).foregroundStyle(.white)
                }
            case .locked:
                if let note = originNote {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(note).font(.caption).foregroundStyle(.white).lineLimit(2)
                } else {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text(originIsObject ? "Origin locked · chamber object" : (appState.sealedMapOrigin != nil ? "Origin locked · sealed map" : "Origin locked"))
                        .font(.subheadline.bold()).foregroundStyle(.white)
                }
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
                Text(originIsObject ? "Origin locked · chamber object" : (appState.sealedMapOrigin != nil ? "Origin locked · sealed map" : "Origin locked"))
                    .font(.headline).foregroundStyle(.white)
                Text(originNote ?? "Entering \(mode == .author ? "Author" : "Operator") mode…")
                    .font(.caption).foregroundStyle(originNote == nil ? .white.opacity(0.6) : .orange)
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

        appState.noteScanned(anchorId: context.anchorId)   // B

        // B2: when the object is the chosen origin and calibrated, give ARKit a
        // moment to find it after the QR lock (it usually has by now).
        let wantsObject = (appState.activeAnchor?.usesObjectOrigin ?? false)
                       && objectBundle?.meta.objectPoseInQR != nil
        if wantsObject && arManager.objectTransform == nil {
            // B2e: wait with a visible timer (never looks frozen). After 15 s the
            // finder offers "Use the QR position" — the fallback is a choice.
            withAnimation { scanPhase = .locking }
            objectWaitStart    = Date()
            pendingLockContext = context
            Task {
                while pendingLockContext != nil && arManager.objectTransform == nil {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                guard let ctx = pendingLockContext else { return }   // user chose the QR
                pendingLockContext = nil
                objectWaitStart    = nil
                finishLock(context: ctx)
            }
        } else {
            finishLock(context: context)
        }
    }

    /// B2e fallback from the finder: lock on the QR now.
    private func useQRPositionInstead() {
        guard let ctx = pendingLockContext else { return }
        pendingLockContext = nil
        objectWaitStart    = nil
        finishLock(context: ctx)
    }

    /// Origin choice + seal + handoff. Priority: object › sealed map › live QR.
    private func finishLock(context: QRAnchorContext) {
        // ── Choose the origin (B1 + B2) ───────────────────────────────────────
        // object (calibrated) → derive the QR frame from the live object pose;
        // sealed map + relocalized → the author's pose; else the live QR.
        let livePose    = arManager.lockedAnchorTransform
        let relocalized = arManager.relocalizationOutcome == .succeeded
        var originPose  = livePose
        originNote      = nil
        originIsObject  = false
        let objectNow   = arManager.objectTransform
        appState.objectCalibration = nil
        if let objT = objectNow, let cal = objectBundle?.meta.objectPoseInQRTransform,
           appState.activeAnchor?.usesObjectOrigin == true {
            // QR frame = objectPose_now × inverse(objectPoseInQR)
            let derived = objT * simd_inverse(cal)
            if let live = livePose {
                let d = ARCoordinateFrame.poseDelta(derived, live)
                if d.metres > driftMetres || d.degrees > driftDegrees {
                    originNote = String(format: "QR moved? Using the chamber object (Δ %.0f cm · %.0f°)", d.metres * 100, d.degrees)
                }
            }
            // B2e: re-base the SESSION onto the QR frame (world origin = QR) so
            // the movement watchdog can shift every tag with the chamber. The
            // origin the successor views adopt is therefore the identity.
            arManager.rebaseWorld(objectPoseInFrame: cal)
            originPose     = matrix_identity_float4x4
            originIsObject = true
            arManager.adoptMapOrigin(matrix_identity_float4x4)
            appState.sealedMapOrigin   = matrix_identity_float4x4
            appState.objectCalibration = cal
            print("[QRScanGateView] ✓ Origin from reference object (session re-based)")
        } else if let sealed = mapBundle?.meta.anchorPoseTransform, relocalized {
            originPose = sealed
            arManager.adoptMapOrigin(sealed)
            appState.sealedMapOrigin = sealed
            if let live = livePose {
                let d = ARCoordinateFrame.poseDelta(sealed, live)
                if d.metres > driftMetres || d.degrees > driftDegrees {
                    originNote = String(format: "QR moved? Using the sealed map (Δ %.0f cm · %.0f°)", d.metres * 100, d.degrees)
                    print("[QRScanGateView] ⚠ QR drift vs sealed origin: \(d.metres) m, \(d.degrees)°")
                }
            }
        } else {
            appState.sealedMapOrigin = nil
            if appState.activeAnchor?.usesObjectOrigin == true, objectBundle != nil, objectNow == nil {
                originNote = objectBundle?.meta.objectPoseInQR != nil
                    ? "Chamber not recognised — using the QR position (approximate if the chamber moved)"
                    : (mapBundle?.isSealed == true
                        ? "Chamber object not calibrated yet — using the sealed map / QR"
                        : "Chamber object not calibrated yet — using the QR position")
            } else if mapBundle?.isSealed == true {
                originNote = "Couldn't match the sealed map — using the QR position (reduced accuracy)"
            }
        }
        appState.anchorNormalisedTransform = originPose

        // ── B2 calibration (AUTHOR): object seen + a QR-frame origin that did
        // NOT itself come from the object → store objectPoseInQR. Refreshed on
        // every author pass so a re-scan of the object re-calibrates itself.
        if mode == .author, let objT = objectNow, let origin = originPose, !originIsObject,
           let aid = appState.activeAnchor?.id, objectBundle != nil {
            let cal = simd_inverse(origin) * objT
            let client = sibClient
            Task {
                if let meta = try? await client.calibrateAnchorObject(anchorId: aid, objectPoseInQR: cal),
                   let ob = objectBundle {
                    ReferenceObjectCache.store(aid, archive: ob.archive, meta: meta)
                    print("[QRScanGateView] ✓ Object calibrated to QR frame")
                }
            }
        }

        // ── Preserve the live ARSession for AuthorModeView / OperatorModeView ──
        // By storing the session here (before QRScanGateView dismisses), the
        // successor view can call arManager.linkToExistingSession() instead of
        // startSession(), keeping the world frame and the live ARImageAnchor intact.
        appState.activeARSession = arManager.sceneView.session

        // ── Seal the map (B1: AUTHOR only) ────────────────────────────────────
        // Upload map + origin pose when no map existed yet, or when this session
        // relocalized into the existing map (same frame — extending it is safe).
        // A timed-out session has a fresh frame: uploading would corrupt the
        // seal, so it is skipped. Operators never upload.
        let hadMap = mapBundle != nil
        if mode == .author, !hadMap || relocalized, let origin = originPose {
            let client   = sibClient
            let aid      = context.anchorId
            let sealedBy = !settings.uamUserName.isEmpty ? settings.uamUserName : settings.authorName
            Task {
                guard let mapData = await arManager.saveCurrentWorldMap() else { return }
                do {
                    try await client.uploadWorldMap(anchorId: aid, data: mapData)
                    let meta = try await client.uploadWorldMapMeta(anchorId: aid, anchorPose: origin, sealedBy: sealedBy)
                    WorldMapCache.store(.anchor(aid), map: mapData, meta: meta)
                    print("[QRScanGateView] ✓ World map sealed for anchor \(aid) (\(meta.capturedAt ?? "-"))")
                } catch {
                    // Keep the map usable offline on this device; the seal is retried
                    // on the author's next relocalized session.
                    WorldMapCache.store(.anchor(aid), map: mapData, meta: WorldMapMeta())
                    print("[QRScanGateView] Seal upload failed (non-fatal, cached locally): \(error.localizedDescription)")
                }
            }
        }

        // ── Disable further QR scanning (origin is locked for this session) ────
        arManager.disableQRScanning()

        // ── Brief visual feedback then auto-proceed ───────────────────────────
        // Tour: advance past QR scan step on successful lock (before the view
        // dismisses so the successor view starts on the correct next step).
        let qrStep: TourStep = mode == .author ? .scanQRAuthor : .scanQROperator
        tour.advancePast(qrStep)
        withAnimation { scanPhase = .locked }
        // B1: linger long enough to read a drift / reduced-accuracy note.
        DispatchQueue.main.asyncAfter(deadline: .now() + (originNote == nil ? 0.9 : 2.4)) {
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
