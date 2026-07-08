// LocTagAuthorView.swift — Phase 2 (Task E)
// AR session for the Gemba audit walk Author flow:
//   • Start a fresh ARKit session (no QR lock — positions are stored in world space
//     relative to the saved ARWorldMap, not an anchor-relative frame).
//   • Tap any surface to place an orange Loc-Tag pin.
//   • Fill LocTagFormSheet (title, description, severity, defect category, optional photo).
//   • Each confirmed tag is POSTed to SIB via POST /loc-tags immediately.
//   • "Finish" → getCurrentWorldMap → NSKeyedArchiver → upload to SIB /worldmap/upload → exit.

import SwiftUI
import ARKit
import SceneKit
import simd

struct LocTagAuthorView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @StateObject private var arManager = ARSessionManager()

    // ── Session mode ──────────────────────────────────────────────────────────
    /// True when an existing ARWorldMap was found — we re-localize instead of fresh scan.
    @State private var isResuming: Bool = false
    /// True during the initial worldmap check + session startup.
    @State private var isLoadingSession: Bool = true
    /// Reference photo downloaded from SIB — shown to guide Author to starting position.
    @State private var referencePhoto: UIImage? = nil
    /// True once the Author taps "I'm Here" — dismisses the re-localization overlay.
    @State private var userConfirmedRelocalize: Bool = false
    /// True 20 seconds into re-localization — shows extended hint.
    @State private var showRelocalizingTimeout: Bool = false

    // ── Placed loc-tags ───────────────────────────────────────────────────────
    @State private var placedLocTags: [LocTag] = []
    @State private var tagNodes: [String: SCNNode] = [:]

    // ── Reference photo ───────────────────────────────────────────────────────
    /// JPEG captured at the first tag save — uploaded with the world map so
    /// Operators can see where to stand when re-localizing.
    @State private var referencePhotoData: Data? = nil

    // ── Peek sheet (pin-tap in resume mode) ───────────────────────────────────
    @State private var peekingLocTag: LocTag? = nil

    // ── Pending placement ─────────────────────────────────────────────────────
    // .sheet(item:) pattern — same race-free approach as AuthorModeView/AddTagSheet.
    private struct PendingTap: Identifiable {
        let id = UUID()
        let position: SIBVector3
    }
    @State private var pendingTap:  PendingTap? = nil
    @State private var pendingNode: SCNNode?    = nil
    @State private var tapSaved                 = false

    // ── Finish walk ───────────────────────────────────────────────────────────
    @State private var isSavingWalk      = false
    @State private var showFinishConfirm = false

    // ── Focus ring ────────────────────────────────────────────────────────────
    @State private var focusRing: ARFocusRing? = nil
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── Toast ─────────────────────────────────────────────────────────────────
    @State private var toastMsg: String? = nil

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // Full-screen AR camera
            ARContainerView(arManager: arManager, onTap: handleTap)
                .ignoresSafeArea()
                .onAppear {
                    if focusRing == nil {
                        focusRing = ARFocusRing(sceneView: arManager.sceneView)
                    }
                    arManager.disableQRScanning()
                    Task { await setupSession() }
                }
                .onDisappear {
                    focusRing?.cleanup()
                    focusRing = nil
                    guard !isSavingWalk else { return }
                    arManager.pauseSession()
                    appState.activeARSession = nil
                }

            // Re-localization overlay (resume mode, until user taps "I'm Here")
            if isResuming && arManager.isRelocalizing && !userConfirmedRelocalize {
                ZStack {
                    Color.black.opacity(0.50).ignoresSafeArea()

                    VStack(spacing: 0) {
                        Spacer()

                        VStack(spacing: 16) {
                            VStack(spacing: 4) {
                                Text("Return to the Starting Point")
                                    .font(.title3.bold()).foregroundStyle(.white)
                                Text("Stand where this photo was taken, then tap \"I'm Here\".")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.7))
                                    .multilineTextAlignment(.center)
                            }

                            if let img = referencePhoto {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(height: 200)
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14)
                                            .stroke(Color.orange.opacity(0.6), lineWidth: 1.5)
                                    )
                            } else {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 14)
                                        .fill(Color.white.opacity(0.06)).frame(height: 130)
                                    VStack(spacing: 6) {
                                        Image(systemName: "photo.fill")
                                            .font(.system(size: 28)).foregroundStyle(.white.opacity(0.3))
                                        Text("No reference photo")
                                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                                    }
                                }
                            }

                            HStack(spacing: 8) {
                                ProgressView().scaleEffect(0.8).tint(.orange)
                                Text("Re-localizing the space…")
                                    .font(.caption).foregroundStyle(.white.opacity(0.55))
                            }

                            if showRelocalizingTimeout {
                                Text("Still searching. Walk around the area where you originally recorded the session.")
                                    .font(.caption)
                                    .foregroundStyle(.orange.opacity(0.85))
                                    .multilineTextAlignment(.center)
                                    .transition(.opacity)
                            }

                            Button {
                                userConfirmedRelocalize = true
                            } label: {
                                Label("I'm Here", systemImage: "mappin.and.ellipse")
                                    .font(.headline)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 13)
                                    .background(Color.orange)
                                    .foregroundStyle(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 13))
                            }
                        }
                        .padding(20)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                        .padding(.horizontal, 16)
                        .padding(.bottom, 48)
                    }
                }
                .animation(.easeInOut(duration: 0.3), value: showRelocalizingTimeout)
                .transition(.opacity)
            }

            // Session loading spinner
            if isLoadingSession {
                ZStack {
                    Color.black.opacity(0.55).ignoresSafeArea()
                    VStack(spacing: 14) {
                        ProgressView().scaleEffect(1.4).tint(.white)
                        Text("Checking for previous session…")
                            .font(.subheadline).foregroundStyle(.white)
                    }
                }
            }

            // Top bar
            topBar

            // Toast
            if let msg = toastMsg {
                toastOverlay(msg: msg)
            }

            // Saving overlay (blocks interaction while uploading world map)
            if isSavingWalk {
                savingOverlay
            }

            // Bottom placement panel
            VStack {
                Spacer()
                bottomPanel
            }
        }
        .onReceive(crosshairTicker) { _ in
            guard pendingTap == nil else { return }
            focusRing?.update(sceneView: arManager.sceneView)
        }
        // ── Form sheet ─────────────────────────────────────────────────────────
        .sheet(item: $pendingTap, onDismiss: {
            if !tapSaved {
                pendingNode?.removeFromParentNode()
                pendingNode = nil
            }
            tapSaved = false
        }) { tap in
            if let anchor = appState.activeAnchor {
                LocTagFormSheet(
                    anchor:    anchor,
                    position:  tap.position,
                    nextOrder: placedLocTags.count + 1
                ) { newLocTag in
                    tapSaved = true
                    // Capture reference photo at the moment of the FIRST tag save.
                    // This is where the Operator must start their walk, so the photo
                    // shows the exact vantage point the Author was standing at.
                    if placedLocTags.isEmpty && referencePhotoData == nil {
                        let snapshot = arManager.sceneView.snapshot()
                        referencePhotoData = snapshot.jpegData(compressionQuality: 0.75)
                    }
                    placedLocTags.append(newLocTag)
                    if let node = pendingNode {
                        upgradeMarker(node, id: newLocTag.id)
                        pendingNode = nil
                    }
                    pendingTap = nil
                }
                .environmentObject(settings)
                .environmentObject(appState)
            }
        }
        // ── Peek sheet (tap on existing pin) ───────────────────────────────────
        .sheet(item: $peekingLocTag) { tag in
            LocTagPeekSheet(locTag: tag) { updated in
                if let idx = placedLocTags.firstIndex(where: { $0.id == updated.id }) {
                    placedLocTags[idx] = updated
                }
            }
            .environmentObject(settings)
            .environmentObject(appState)
        }
        // ── Finish confirmation ────────────────────────────────────────────────
        .confirmationDialog("Finish Audit Walk?", isPresented: $showFinishConfirm, titleVisibility: .visible) {
            Button("Save & Upload World Map") { Task { await finishWalk() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            let n = placedLocTags.count
            Text("Saves the AR world map (\(n) tag\(n == 1 ? "" : "s") placed) so Operators can re-localize to this space.")
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button("Exit") {
                arManager.pauseSession()
                appState.reset()
                appState.mode = .none
            }
            .font(.body)
            .foregroundStyle(.white.opacity(0.85))

            Spacer()

            if let anchor = appState.activeAnchor {
                Text(anchor.assetId)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            Button("Finish") {
                guard !placedLocTags.isEmpty else {
                    showToast("Place at least one tag before finishing.")
                    return
                }
                showFinishConfirm = true
            }
            .font(.body.bold())
            .foregroundStyle(placedLocTags.isEmpty ? .white.opacity(0.3) : .orange)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Bottom panel ──────────────────────────────────────────────────────────

    private var bottomPanel: some View {
        VStack(spacing: 8) {
            // Tag count strip
            if !placedLocTags.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("\(placedLocTags.count) tag\(placedLocTags.count == 1 ? "" : "s") placed")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                    Spacer()
                    Text("Tap 'Finish' when done")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.35))
                }
                .padding(.horizontal, 4)
            }

            // Instruction pill + orange FAB
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "hand.tap.fill")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Tap a surface to tag an issue")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                    Spacer()
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                // FAB — places from focus ring's last cached hit
                Button {
                    if let hitT = focusRing?.lastHitTransform {
                        let col = hitT.columns.3
                        placePendingMarker(
                            worldPos: simd_float3(col.x, col.y, col.z),
                            sibPos:   SIBVector3(x: Double(col.x), y: Double(col.y), z: Double(col.z))
                        )
                    } else {
                        let sv = arManager.sceneView
                        handleTap(at: CGPoint(x: sv.bounds.midX, y: sv.bounds.midY))
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(.orange, in: Circle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 40)
    }

    // ── Saving overlay ────────────────────────────────────────────────────────

    private var savingOverlay: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
            VStack(spacing: 18) {
                ProgressView()
                    .scaleEffect(1.4)
                    .tint(.white)
                Text("Saving world map…")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("Keep device still")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    // ── Toast overlay ─────────────────────────────────────────────────────────

    @ViewBuilder
    private func toastOverlay(msg: String) -> some View {
        VStack {
            Spacer().frame(height: 100)
            HStack(spacing: 10) {
                Image(systemName: "info.circle").foregroundStyle(.white)
                Text(msg).font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                Spacer()
                Button { toastMsg = nil } label: {
                    Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.orange.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 16)
            Spacer()
        }
        .transition(.move(edge: .top).combined(with: .opacity))
        .animation(.easeInOut(duration: 0.3), value: toastMsg)
    }

    // ── Tap handler ───────────────────────────────────────────────────────────

    private func handleTap(at screenPoint: CGPoint) {
        guard pendingTap == nil else { return }
        let sv = arManager.sceneView

        // ── Pin-tap detection: existing tags take priority ────────────────────
        // Check if the tap hit an existing placed tag node before trying to
        // place a new one on the surface.
        let scnHits = sv.hitTest(screenPoint, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue
        ])
        for hit in scnHits {
            if let tagId = nodeTagId(hit.node),
               let tag   = placedLocTags.first(where: { $0.id == tagId }) {
                peekingLocTag = tag
                return
            }
        }

        let worldPos: simd_float3?
        if let query  = sv.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .any),
           let result = sv.session.raycast(query).first {
            let c = result.worldTransform.columns.3
            worldPos = simd_float3(c.x, c.y, c.z)
        } else if let hit = sv.hitTest(screenPoint,
                     types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .featurePoint]).first {
            let c = hit.worldTransform.columns.3
            worldPos = simd_float3(c.x, c.y, c.z)
        } else {
            worldPos = nil
        }
        guard let wp = worldPos else { return }
        placePendingMarker(
            worldPos: wp,
            sibPos:   SIBVector3(x: Double(wp.x), y: Double(wp.y), z: Double(wp.z))
        )
    }

    private func placePendingMarker(worldPos: simd_float3, sibPos: SIBVector3) {
        pendingNode?.removeFromParentNode()
        let node = makePendingPin()
        node.simdPosition = worldPos
        arManager.sceneView.scene.rootNode.addChildNode(node)
        pendingNode = node
        tapSaved    = false
        pendingTap  = PendingTap(position: sibPos)
    }

    // ── Finish walk ───────────────────────────────────────────────────────────

    private func finishWalk() async {
        guard let anchor = appState.activeAnchor else { return }
        isSavingWalk = true

        do {
            let mapData = try await captureWorldMap()
            let client  = SIBClient(settings: settings)
            try await client.uploadLocTagWorldMap(anchorId: anchor.id, mapData: mapData, referencePhoto: referencePhotoData)
            arManager.pauseSession()
            appState.activeARSession = nil
            appState.reset()
            appState.mode = .none
        } catch {
            isSavingWalk = false
            if let arErr = error as? ARError, arErr.code == .insufficientFeatures {
                showToast("Not enough features mapped yet — slowly pan the camera around the room, focusing on textured objects or surfaces, then tap Finish again.")
            } else {
                showToast(friendlyMessage(for: error))
            }
        }
    }

    /// Wraps ARSession.getCurrentWorldMap in an async/await continuation.
    private func captureWorldMap() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            arManager.sceneView.session.getCurrentWorldMap { worldMap, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let map = worldMap else {
                    continuation.resume(throwing: NSError(
                        domain:   "LocTagAuthor",
                        code:     1,
                        userInfo: [NSLocalizedDescriptionKey:
                            "World map not available — walk the space more to build tracking data."]))
                    return
                }
                do {
                    let data = try NSKeyedArchiver.archivedData(
                        withRootObject:        map,
                        requiringSecureCoding: true)
                    continuation.resume(returning: data)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // ── Markers ───────────────────────────────────────────────────────────────

    private func makePendingPin() -> SCNNode {
        let node = makeLocTagPin(placed: false)
        node.runAction(.repeatForever(.sequence([
            .fadeOpacity(to: 0.35, duration: 0.45),
            .fadeOpacity(to: 1.00, duration: 0.45),
        ])))
        return node
    }

    private func upgradeMarker(_ node: SCNNode, id: String) {
        node.removeAllActions()
        node.opacity = 1
        node.name = id      // enables nodeTagId() lookup on tap
        node.childNodes.forEach { $0.removeFromParentNode() }
        let upgraded = makeLocTagPin(placed: true)
        upgraded.childNodes.forEach { child in
            child.removeFromParentNode()
            node.addChildNode(child)
        }
        tagNodes[id] = node
    }

    /// Orange sphere + ring marker. `placed` = false → dimmer ring (pending state).
    private func makeLocTagPin(placed: Bool) -> SCNNode {
        let root  = SCNNode()
        let color = UIColor.systemOrange

        // Centre sphere
        let sphere = SCNSphere(radius: 0.014)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.55)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        // Horizontal ring
        let torus        = SCNTorus()
        torus.ringRadius = 0.022
        torus.pipeRadius = 0.004
        let tMat         = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(placed ? 0.60 : 0.25)
        tMat.lightingModel     = .constant
        torus.firstMaterial    = tMat
        let ringNode           = SCNNode(geometry: torus)
        ringNode.eulerAngles   = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ringNode)

        return root
    }

    // ── Session setup ─────────────────────────────────────────────────────────

    /// Called on appear — checks for an existing ARWorldMap and resumes if found.
    private func setupSession() async {
        guard let anchor = appState.activeAnchor else {
            arManager.startSession()
            isLoadingSession = false
            return
        }

        let client = SIBClient(settings: settings)
        do {
            if let mapData = try await client.fetchLocTagWorldMap(anchorId: anchor.id) {
                // ── Resume mode ───────────────────────────────────────────────
                isResuming = true
                // Fetch reference photo + existing tags concurrently
                async let photoFetch = client.fetchLocTagReferencePhoto(anchorId: anchor.id)
                async let tagsFetch  = client.fetchLocTags(anchorId: anchor.id)
                let (photoData, existing) = try await (photoFetch, tagsFetch)

                if let pd = photoData { referencePhoto = UIImage(data: pd) }
                arManager.startSessionWithWorldMap(mapData)
                placedLocTags = existing.sorted { $0.order < $1.order }
                placePinsFromExisting()
                // Show extended timeout hint after 20 seconds if still relocalizing
                showRelocalizingTimeout = false
                Task {
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    guard isResuming && arManager.isRelocalizing else { return }
                    showRelocalizingTimeout = true
                }
            } else {
                // ── Fresh session ─────────────────────────────────────────────
                isResuming = false
                arManager.startSession()
            }
        } catch {
            // Worldmap fetch failed — fall back to a fresh session silently.
            // The author can still place new tags; any existing ones are lost
            // only from the local view (not from SIB storage).
            isResuming = false
            arManager.startSession()
            showToast("Could not load previous session — starting fresh.")
        }
        isLoadingSession = false
    }

    /// Place solid-state markers for all pre-loaded loc-tags (resume mode).
    private func placePinsFromExisting() {
        for locTag in placedLocTags {
            let node = makeLocTagPin(placed: true)
            node.name = locTag.id   // enables nodeTagId() lookup on tap
            node.simdPosition = simd_float3(
                Float(locTag.position.x),
                Float(locTag.position.y),
                Float(locTag.position.z)
            )
            arManager.sceneView.scene.rootNode.addChildNode(node)
            tagNodes[locTag.id] = node
        }
    }

    /// Walk up the node hierarchy to find the root tag node whose name matches
    /// a key in `tagNodes`.  Returns the tag ID or nil if not found.
    private func nodeTagId(_ node: SCNNode) -> String? {
        var current: SCNNode? = node
        while let n = current {
            if let name = n.name, tagNodes[name] != nil { return name }
            current = n.parent
        }
        return nil
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func showToast(_ msg: String) {
        toastMsg = msg
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if toastMsg == msg { toastMsg = nil }
        }
    }
}
