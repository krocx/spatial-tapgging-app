// LocTagOperatorView.swift — Phase 2 (Task F)
// AR session for the Gemba audit walk Operator flow:
//   1. Download ARWorldMap + LocTags from SIB in parallel.
//   2. Load world map into ARSession → wait for re-localization.
//   3. Place orange pins at each tag's world-space position.
//   4. Navigate Operator through tags in author-defined order:
//        • Screen-edge chevron when target is off-screen.
//        • Distance pill updates at 10 Hz (approaching ≤1.0 m / arrived ≤0.5 m).
//        • Auto-present LocTagOperatorSheet on arrival (≤0.5 m).
//   5. After all tags completed, show done screen.

import SwiftUI
import ARKit
import SceneKit
import simd

struct LocTagOperatorView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @StateObject private var arManager = ARSessionManager()

    // ── State machine ─────────────────────────────────────────────────────────
    private enum Phase: Equatable {
        case loading
        case relocalizing
        case navigating(index: Int)
        case done
    }

    @State private var phase:      Phase   = .loading
    @State private var locTags:    [LocTag] = []
    @State private var loadError:  String?  = nil

    // ── AR scene ──────────────────────────────────────────────────────────────
    @State private var tagNodes:  [String: SCNNode] = [:]
    @State private var arrowNode: SCNNode? = nil      // floating 3D navigation arrow

    // ── Navigation telemetry (updated by 10 Hz ticker) ────────────────────────
    @State private var distanceM:        Float?   = nil
    @State private var targetScreenPos:  CGPoint? = nil
    @State private var targetIsOnScreen: Bool     = false

    // ── Re-localization photo ──────────────────────────────────────────────────
    @State private var referencePhoto:           UIImage? = nil
    /// True once user taps "I'm Here" (manual position confirm, bypasses ARKit wait)
    @State private var userConfirmedRelocalize:  Bool     = false
    /// True after 20 seconds in .relocalizing phase — shows extra hint
    @State private var showRelocalizingTimeout:  Bool     = false
    /// Opacity of the ghost reference-photo overlay (0.15–0.65, adjustable via slider)
    @State private var ghostOpacity:             Double   = 0.38

    // ── Completion ────────────────────────────────────────────────────────────
    @State private var completingTag:   LocTag?        = nil
    @State private var completedTagIds: Set<String>    = []
    /// Guard against auto-trigger firing again while the sheet is open — and,
    /// after a dismiss, until the operator WALKS AWAY (> approachingM). The old
    /// on-dismiss reset re-opened the form instantly while still standing at
    /// the tag, hiding the very marker they were trying to look at.
    @State private var autoTriggerGuard = false
    /// Sheet detent: arrives MINIMIZED (compact header strip, AR view visible
    /// and interactive behind it) — drag up or tap Expand for the full form.
    @State private var completionDetent: PresentationDetent = .height(148)

    // ── Ticker ────────────────────────────────────────────────────────────────
    private let navTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── Thresholds ────────────────────────────────────────────────────────────
    private let arrivedM:     Float = 0.5
    private let approachingM: Float = 1.0

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // AR camera — always present so session can run in background
            ARContainerView(arManager: arManager, onTap: { _ in })
                .ignoresSafeArea()
                .onAppear {
                    // Actual session start happens in loadData() after world map arrives.
                    // Start a bare session for now so the camera feed is live.
                    arManager.startSession()
                    arManager.disableQRScanning()
                }
                .onDisappear {
                    removeArrow()
                    arManager.pauseSession()
                    appState.activeARSession = nil
                }
                // Fired when ARKit finishes matching the saved world map
                .onChange(of: arManager.isRelocalizing) { stillRelocalizing in
                    guard !stillRelocalizing, phase == .relocalizing else { return }
                    placePins()
                    if locTags.isEmpty {
                        phase = .done
                    } else {
                        phase = .navigating(index: 0)
                        highlightTag(index: 0)
                    }
                }

            // ── Ghost reference-photo overlay (re-localization phase only) ──────
            if case .relocalizing = phase, let img = referencePhoto {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .opacity(ghostOpacity)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
                    .animation(.easeOut(duration: 0.6), value: phase)
            }

            // ── Phase-specific UI ──────────────────────────────────────────────
            Group {
                switch phase {
                case .loading:
                    loadingOverlay
                case .relocalizing:
                    relocalizingOverlay
                case .navigating(let index):
                    navigationUI(index: index)
                case .done:
                    doneOverlay
                }
            }

            // Top bar (always visible)
            topBar
        }
        .onReceive(navTicker) { _ in
            if case .navigating(let index) = phase {
                updateNavTelemetry(index: index)
            }
        }
        .task { await loadData() }
        // Per-tag completion sheet — presented MINIMIZED so the operator can
        // still see (and move around) the tag location; the AR view stays
        // interactive behind the compact strip. Guard is NOT reset on dismiss:
        // it re-arms only after walking away (see updateNavTelemetry).
        .sheet(item: $completingTag) { tag in
            if let anchor = appState.activeAnchor {
                LocTagOperatorSheet(tag: tag, anchor: anchor) { completion in
                    completedTagIds.insert(tag.id)
                    completingTag = nil
                    advanceAfterCompletion(completedId: tag.id)
                }
                .environmentObject(settings)
                .environmentObject(appState)
                .presentationDetents([.height(148), .large], selection: $completionDetent)
                .presentationBackgroundInteraction(.enabled(upThrough: .height(148)))
                .presentationDragIndicator(.visible)
                .onAppear { completionDetent = .height(148) }   // always arrive minimized
            }
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

            if !locTags.isEmpty {
                Text("\(completedTagIds.count)/\(locTags.count)")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Loading overlay ───────────────────────────────────────────────────────

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.7).ignoresSafeArea()
            if let err = loadError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 44)).foregroundStyle(.orange)
                    Text("Could not load walk").font(.headline).foregroundStyle(.white)
                    Text(err).font(.caption).foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center).padding(.horizontal, 32)
                    Button("Exit") { appState.reset(); appState.mode = .none }
                        .buttonStyle(.bordered).tint(.white)
                }
            } else {
                VStack(spacing: 16) {
                    ProgressView().scaleEffect(1.4).tint(.white)
                    Text("Loading walk data…").font(.headline).foregroundStyle(.white)
                    Text("Downloading world map and tags")
                        .font(.caption).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    // ── Re-localizing overlay ─────────────────────────────────────────────────
    // Shows the reference photo captured when the Author saved their first tag,
    // so the Operator knows exactly where to stand before ARKit re-localizes.

    private var relocalizingOverlay: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 16) {
                // Header
                VStack(spacing: 4) {
                    Text("Go to the Starting Point")
                        .font(.title3.bold()).foregroundStyle(.white)
                    Text(referencePhoto != nil
                         ? "Align the live view with the ghost image, then tap \"I'm Here\"."
                         : "Stand where the walk started, then tap \"I'm Here\".")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                }

                // ARKit re-localization progress (small, secondary)
                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.8).tint(.orange)
                    Text("ARKit is matching the space…")
                        .font(.caption).foregroundStyle(.white.opacity(0.55))
                }

                // 20-second timeout hint
                if showRelocalizingTimeout {
                    Text("Still searching. Try moving closer to where the photo was taken, or walk around the area.")
                        .font(.caption)
                        .foregroundStyle(.orange.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .transition(.opacity)
                }

                // Ghost opacity slider — lets user dial the overlay up/down
                if referencePhoto != nil {
                    HStack(spacing: 10) {
                        Image(systemName: "photo.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                        Slider(value: $ghostOpacity, in: 0.15...0.65)
                            .tint(.orange)
                        Image(systemName: "eye.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                    }
                }

                // "I'm Here" — manual position confirmation
                Button {
                    userConfirmedRelocalize = true
                    placePins()
                    if locTags.isEmpty {
                        phase = .done
                    } else {
                        phase = .navigating(index: 0)
                        highlightTag(index: 0)
                    }
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
        .animation(.easeInOut(duration: 0.3), value: showRelocalizingTimeout)
    }

    // ── Done overlay ──────────────────────────────────────────────────────────

    private var doneOverlay: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 56)).foregroundStyle(.green)
                Text("Walk Complete")
                    .font(.title2.bold()).foregroundStyle(.white)
                Text("All \(locTags.count) tag\(locTags.count == 1 ? "" : "s") reviewed")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                Button("Finish") {
                    arManager.pauseSession()
                    appState.reset()
                    appState.mode = .none
                }
                .buttonStyle(.borderedProminent).tint(.green)
            }
        }
    }

    // ── Navigation UI ─────────────────────────────────────────────────────────

    @ViewBuilder
    private func navigationUI(index: Int) -> some View {
        if index < locTags.count {
        let tag = locTags[index]

        ZStack {
            // Screen-edge chevron when tag is behind or off-screen
            if !targetIsOnScreen, let rawPos = targetScreenPos {
                GeometryReader { geo in
                    let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
                    let dx = rawPos.x - center.x
                    let dy = rawPos.y - center.y
                    let angle = Angle(radians: atan2(Double(dy), Double(dx)))
                    let edge  = clampToEdge(rawPos, size: geo.size, padding: 52)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.orange)
                        .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        .rotationEffect(angle)
                        .position(edge)
                }
                .ignoresSafeArea()
            }

            // Bottom nav panel
            VStack {
                Spacer()
                navPanel(tag: tag, index: index)
            }
        }
        } // end if index < locTags.count
    }

    private func clampToEdge(_ point: CGPoint, size: CGSize, padding: CGFloat) -> CGPoint {
        let cx = size.width  / 2
        let cy = size.height / 2
        let dx = point.x - cx
        let dy = point.y - cy
        guard abs(dx) > 0.001 || abs(dy) > 0.001 else { return CGPoint(x: cx, y: padding) }
        let sx = (cx - padding) / max(abs(dx), 0.001)
        let sy = (cy - padding) / max(abs(dy), 0.001)
        let s  = min(sx, sy)
        return CGPoint(x: cx + dx * s, y: cy + dy * s)
    }

    // ── Navigation bottom panel ───────────────────────────────────────────────

    private func navPanel(tag: LocTag, index: Int) -> some View {
        VStack(spacing: 12) {
            // Tag identity row
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Color.orange.opacity(0.2)).frame(width: 40, height: 40)
                    Text("\(tag.order)")
                        .font(.headline.bold()).foregroundStyle(.orange)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(tag.title)
                        .font(.headline).foregroundStyle(.white).lineLimit(1)
                    Text(tag.defectCategory.displayName)
                        .font(.caption).foregroundStyle(.white.opacity(0.55))
                }
                Spacer()
                distancePill
            }
            .padding(.horizontal, 16)

            // Complete button
            Button {
                autoTriggerGuard = true
                completingTag    = tag
            } label: {
                Label("Complete Tag", systemImage: "checkmark.circle")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(arrivedColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 13))
            }
            .padding(.horizontal, 16)

            // Skip to next tag (if any remain)
            let remaining = locTags.indices.filter {
                !completedTagIds.contains(locTags[$0].id) && $0 != index
            }
            if let nextIdx = remaining.first(where: { $0 > index }) ?? remaining.first {
                Button {
                    advanceTo(index: nextIdx)
                } label: {
                    Text("Skip → \(locTags[nextIdx].title)")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.38))
                        .lineLimit(1)
                }
                .padding(.bottom, 2)
            }
        }
        .padding(.top, 14)
        .padding(.bottom, 34)
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private var distancePill: some View {
        if let d = distanceM {
            let arrived     = d <= arrivedM
            let approaching = d <= approachingM
            let color: Color = arrived ? .green : (approaching ? .orange : .white)
            VStack(alignment: .trailing, spacing: 1) {
                Text(String(format: "%.1f m", d))
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(color)
                if arrived {
                    Text("arrived").font(.system(size: 9, weight: .medium)).foregroundStyle(.green)
                } else if approaching {
                    Text("close").font(.system(size: 9, weight: .medium)).foregroundStyle(.orange)
                }
            }
        }
    }

    private var arrivedColor: Color {
        guard let d = distanceM else { return .orange }
        return d <= arrivedM ? .green : .orange
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private func loadData() async {
        guard let anchor = appState.activeAnchor else { return }
        let client = SIBClient(settings: settings)

        do {
            // Fetch world map, loc-tags, and reference photo concurrently
            async let mapFetch   = client.fetchLocTagWorldMap(anchorId: anchor.id)
            async let tagsFetch  = client.fetchLocTags(anchorId: anchor.id)
            async let photoFetch = client.fetchLocTagReferencePhoto(anchorId: anchor.id)
            let (mapData, fetched, photoData) = try await (mapFetch, tagsFetch, photoFetch)

            if let pd = photoData { referencePhoto = UIImage(data: pd) }
            locTags = fetched.sorted { $0.order < $1.order }

            if let data = mapData {
                arManager.startSessionWithWorldMap(data)
                arManager.disableQRScanning()
                phase = .relocalizing
                showRelocalizingTimeout = false
                // Show extended timeout hint after 20 seconds if still relocalizing
                Task {
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    guard case .relocalizing = phase else { return }
                    showRelocalizingTimeout = true
                }
            } else {
                // No world map stored yet — place pins directly (positions may drift slightly)
                arManager.disableQRScanning()
                placePins()
                if locTags.isEmpty {
                    phase = .done
                } else {
                    phase = .navigating(index: 0)
                    highlightTag(index: 0)
                }
            }
        } catch {
            loadError = friendlyMessage(for: error)
        }
    }

    // ── Place 3D pins ─────────────────────────────────────────────────────────

    private func placePins() {
        for tag in locTags {
            guard tagNodes[tag.id] == nil else { continue }
            let p    = tag.position
            let node = makeLocTagPin()
            node.simdPosition = simd_float3(Float(p.x), Float(p.y), Float(p.z))
            arManager.sceneView.scene.rootNode.addChildNode(node)
            tagNodes[tag.id] = node
        }
        placeArrow()   // create the navigation arrow when pins are ready
    }

    // ── Navigation telemetry (10 Hz) ──────────────────────────────────────────

    private func updateNavTelemetry(index: Int) {
        guard index < locTags.count,
              let frame = arManager.sceneView.session.currentFrame else { return }

        let tag    = locTags[index]
        let p      = tag.position
        let tagW   = simd_float3(Float(p.x), Float(p.y), Float(p.z))
        let camCol = frame.camera.transform.columns.3
        let camPos = simd_float3(camCol.x, camCol.y, camCol.z)
        let dist   = simd_length(tagW - camPos)
        distanceM  = dist

        // Auto-trigger completion sheet on arrival (opens minimized).
        if dist <= arrivedM && completingTag == nil && !autoTriggerGuard {
            autoTriggerGuard = true
            completingTag    = locTags[index]
        }
        // Re-arm only after the operator walks AWAY — dismissing the sheet
        // while still at the tag must not bounce it straight back open.
        if dist > approachingM && completingTag == nil && autoTriggerGuard {
            autoTriggerGuard = false
        }

        // Project tag to 2D screen for chevron
        let sv         = arManager.sceneView
        let projected  = sv.projectPoint(SCNVector3(tagW.x, tagW.y, tagW.z))
        let pt         = CGPoint(x: CGFloat(projected.x), y: CGFloat(projected.y))
        targetScreenPos  = pt
        // z < 1.0 means in front of camera; also check it's inside the viewport
        targetIsOnScreen = UIScreen.main.bounds.contains(pt) && projected.z < 1.0

        // Update floating 3D arrow
        updateArrowNode(index: index, frame: frame)
    }

    // ── Marker helpers ────────────────────────────────────────────────────────

    private func highlightTag(index: Int) {
        guard index < locTags.count else { return }
        let activeId = locTags[index].id
        for (id, node) in tagNodes {
            node.removeAllActions()
            if id == activeId {
                node.opacity = 1.0
                node.runAction(.repeatForever(.sequence([
                    .fadeOpacity(to: 0.35, duration: 0.5),
                    .fadeOpacity(to: 1.00, duration: 0.5),
                ])))
            } else {
                node.runAction(.fadeOpacity(to: 0.25, duration: 0.2))
            }
        }
    }

    private func makeLocTagPin() -> SCNNode {
        let root  = SCNNode()
        let color = UIColor.systemOrange

        let sphere = SCNSphere(radius: 0.014)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.55)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        let torus        = SCNTorus()
        torus.ringRadius = 0.022
        torus.pipeRadius = 0.004
        let tMat         = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(0.4)
        tMat.lightingModel     = .constant
        torus.firstMaterial    = tMat
        let ring               = SCNNode(geometry: torus)
        ring.eulerAngles       = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ring)

        return root
    }

    // ── 3D navigation arrow ───────────────────────────────────────────────────

    /// Create the floating orange arrow and add it to the scene.
    /// Called once by placePins() — stays alive until done or exit.
    private func placeArrow() {
        guard arrowNode == nil else { return }
        let node = makeArrowNode()
        node.isHidden = true                  // hidden until first telemetry tick
        arManager.sceneView.scene.rootNode.addChildNode(node)
        arrowNode = node
    }

    private func removeArrow() {
        arrowNode?.removeFromParentNode()
        arrowNode = nil
    }

    /// Orange cylinder + cone pointing in local +Z.
    /// Two-layer design: semi-transparent solid core + larger soft glow halo.
    private func makeArrowNode() -> SCNNode {
        let root = SCNNode()

        // ── Core material: semi-transparent orange, strong emission ────────────
        // transparency = 0.70 → 70 % opaque so the AR scene shows through slightly.
        let coreMat = SCNMaterial()
        coreMat.diffuse.contents  = UIColor.systemOrange
        coreMat.emission.contents = UIColor.systemOrange.withAlphaComponent(0.85)
        coreMat.lightingModel     = .constant
        coreMat.transparency      = 0.70
        coreMat.isDoubleSided     = true

        // ── Glow halo material: larger, nearly transparent warm-orange emission ─
        // transparency = 0.18 → 18 % opaque — just enough to see a soft halo ring.
        let glowMat = SCNMaterial()
        glowMat.diffuse.contents  = UIColor.clear
        glowMat.emission.contents = UIColor(red: 1.0, green: 0.55, blue: 0.0, alpha: 1.0)
        glowMat.lightingModel     = .constant
        glowMat.transparency      = 0.18
        glowMat.isDoubleSided     = true

        // ── Shaft ──────────────────────────────────────────────────────────────
        // SCNCylinder extends along Y; rotate π/2 around X so it extends along +Z.
        let shaft = SCNCylinder(radius: 0.010, height: 0.12)
        shaft.firstMaterial = coreMat
        let shaftNode = SCNNode(geometry: shaft)
        shaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        shaftNode.position    = SCNVector3(0, 0, 0.04)   // center z=0.04 → shaft -0.02…0.10
        root.addChildNode(shaftNode)

        // Glow shaft — wider radius, same length, halo-only
        let glowShaft = SCNCylinder(radius: 0.022, height: 0.12)
        glowShaft.firstMaterial = glowMat
        let glowShaftNode = SCNNode(geometry: glowShaft)
        glowShaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowShaftNode.position    = SCNVector3(0, 0, 0.04)
        root.addChildNode(glowShaftNode)

        // ── Head ───────────────────────────────────────────────────────────────
        // SCNCone tip at +Y; rotate π/2 around X → tip at +Z.
        let head = SCNCone(topRadius: 0, bottomRadius: 0.025, height: 0.06)
        head.firstMaterial = coreMat
        let headNode = SCNNode(geometry: head)
        headNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        headNode.position    = SCNVector3(0, 0, 0.13)   // base=0.10, tip=0.16
        root.addChildNode(headNode)

        // Glow head — slightly larger cone for the arrowhead halo
        let glowHead = SCNCone(topRadius: 0, bottomRadius: 0.042, height: 0.08)
        glowHead.firstMaterial = glowMat
        let glowHeadNode = SCNNode(geometry: glowHead)
        glowHeadNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowHeadNode.position    = SCNVector3(0, 0, 0.125)   // tip at z≈0.165
        root.addChildNode(glowHeadNode)

        return root
    }

    /// Called every 10 Hz from updateNavTelemetry.
    /// Floats the arrow 0.7 m ahead of the camera (horizontally) and rotates it
    /// around world Y so the tip points toward the active tag.
    private func updateArrowNode(index: Int, frame: ARFrame) {
        guard let arrow = arrowNode, index < locTags.count else { return }

        let tag    = locTags[index]
        let p      = tag.position
        let targetW = simd_float3(Float(p.x), Float(p.y), Float(p.z))

        let cam    = frame.camera.transform
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)

        // Camera's forward direction in world XZ plane (camera -Z column projected horizontally)
        let fwdX   = -cam.columns.2.x
        let fwdZ   = -cam.columns.2.z
        let fwdLen = sqrt(fwdX * fwdX + fwdZ * fwdZ)
        guard fwdLen > 0.001 else { return }

        // Arrow world position: 0.7 m ahead, 0.25 m below eye level.
        // Dropping below camPos.y pushes the arrow into the lower half of the
        // AR viewport, where users naturally look while walking.
        let arrowPos = simd_float3(
            camPos.x + (fwdX / fwdLen) * 0.7,
            camPos.y - 0.25,
            camPos.z + (fwdZ / fwdLen) * 0.7
        )

        // Horizontal direction from arrow to target
        let dx   = targetW.x - arrowPos.x
        let dz   = targetW.z - arrowPos.z
        let dist = sqrt(dx * dx + dz * dz)

        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.08   // smooth to 10 Hz ticks
        arrow.simdPosition = arrowPos
        if dist > 0.05 {
            // atan2(dx, dz) gives Y-rotation so local +Z aligns with (dx, 0, dz) in world space
            arrow.simdEulerAngles = simd_float3(0, atan2(dx, dz), 0)
        }
        arrow.isHidden = dist < arrivedM          // hide when inside arrived radius
        SCNTransaction.commit()
    }

    // ── Advance navigation ────────────────────────────────────────────────────

    private func advanceTo(index: Int) {
        guard index < locTags.count else {
            removeArrow()
            phase = .done
            return
        }
        distanceM        = nil
        targetScreenPos  = nil
        autoTriggerGuard = false
        phase = .navigating(index: index)
        highlightTag(index: index)
    }

    private func advanceAfterCompletion(completedId: String) {
        let currentIdx = locTags.firstIndex(where: { $0.id == completedId }) ?? 0
        let remaining  = locTags.indices.filter { !completedTagIds.contains(locTags[$0].id) }
        if remaining.isEmpty {
            removeArrow()
            phase = .done
        } else {
            let next = remaining.first(where: { $0 > currentIdx }) ?? remaining[0]
            advanceTo(index: next)
        }
    }
}
