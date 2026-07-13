// ARGuideSessionView.swift — AR OMS Phase 3
//
// Full-screen AR session for an Operator running a published Guide.
//
// State machine:
//   .loading      — download ARWorldMap + reference photo (steps pre-fetched by caller)
//   .relocalizing — ghost photo overlay + "I'm Here" + ARKit worldmap matching
//   .navigating(index:) — 3D pins + world-anchored floating panels + distance telemetry
//   .submitted    — done overlay after sign-off
//
// Phase 3 additions:
//   • 3D world-anchored floating panel per step (SCNPlane + SCNBillboardConstraint)
//     – Minimized pill:  step title · audio · distance · expand chevron
//     – Maximized card:  description · reference image · audio · evidence camera ·
//                        mark-complete (auto-advance) · sign-off on final step
//   • Evidence photo capture per step (optional, one photo, included in sign-off)
//   • Bug fix: reference photo captured at Step-1 placement (done in GuideStepPlacementView)

import SwiftUI
import ARKit
import SceneKit
import simd
import AVFoundation

// ── Main view ─────────────────────────────────────────────────────────────────

struct ARGuideSessionView: View {

    let anchor: Anchor
    let guide:  ARGuide
    let steps:  [GuideStep]   // sorted by sequenceNumber, pre-fetched by GuideListView

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    // ── AR session ────────────────────────────────────────────────────────────
    @StateObject private var arManager = ARSessionManager()

    // ── State machine ─────────────────────────────────────────────────────────
    private enum Phase: Equatable {
        case loading
        case relocalizing
        case navigating(index: Int)
        case submitted
    }

    @State private var phase:     Phase  = .loading
    @State private var loadError: String? = nil

    // ── In-session step state ─────────────────────────────────────────────────
    @State private var progresses:   [GuideStepProgress] = []
    @State private var sessionStart  = Date()

    // ── 3D scene ──────────────────────────────────────────────────────────────
    @State private var pinNodes:  [String: SCNNode] = [:]
    @State private var arrowNode: SCNNode? = nil

    // ── 3D floating panels (Phase 3) ──────────────────────────────────────────
    /// Container node per step — added to scene ROOT (not pin child) so it
    /// doesn't inherit the pin's pulsing opacity animation.
    @State private var panelContainers: [String: SCNNode] = [:]
    /// true = minimized pill shown, false = maximized card shown (default).
    @State private var panelMinimized:  [String: Bool]    = [:]

    // ── Navigation telemetry (10 Hz) ──────────────────────────────────────────
    @State private var distanceM:        Float?   = nil
    @State private var targetScreenPos:  CGPoint? = nil
    @State private var targetIsOnScreen: Bool     = false
    /// True when Operator is within arrivedM of the step — shows full content panel.
    @State private var showContentPanel: Bool     = false

    // ── Re-localization photo ──────────────────────────────────────────────────
    @State private var referencePhoto:          UIImage? = nil
    @State private var userConfirmedRelocalize: Bool     = false
    @State private var showRelocalizingTimeout: Bool     = false
    @State private var ghostOpacity:            Double   = 0.38

    // ── Step reference photo cache ────────────────────────────────────────────
    @State private var stepImages: [String: UIImage] = [:]

    // ── TTS ───────────────────────────────────────────────────────────────────
    @State private var synthesizer = AVSpeechSynthesizer()
    @State private var isSpeaking  = false

    // ── Sign-off ──────────────────────────────────────────────────────────────
    @State private var showSignOff = false

    // ── Evidence capture (Phase 3) ────────────────────────────────────────────
    @State private var showEvidencePicker      = false
    @State private var evidencePickerStepIndex: Int? = nil

    // ── Ticker ────────────────────────────────────────────────────────────────
    private let navTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── Thresholds ────────────────────────────────────────────────────────────
    private let arrivedM:     Float = 0.5
    private let approachingM: Float = 1.0

    // ── Computed ──────────────────────────────────────────────────────────────

    var sortedSteps: [GuideStep] {
        steps.sorted { $0.sequenceNumber < $1.sequenceNumber }
    }

    var allRequiredDone: Bool {
        guard progresses.count == sortedSteps.count else { return false }
        return zip(sortedSteps, progresses).allSatisfy { step, prog in
            !step.completionRequired || prog.isCompleted
        }
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // AR camera — always present so the feed stays live
            ARContainerView(arManager: arManager, onTap: handleARTap)
                .ignoresSafeArea()
                .onAppear {
                    appState.activeARSession?.pause()
                    appState.activeARSession = nil
                    arManager.startSession()
                    arManager.disableQRScanning()
                }
                .onDisappear {
                    stopSpeaking()
                    removeArrow()
                    // Remove scene-root panel containers (they are NOT pin children,
                    // so they must be cleaned up manually on view teardown)
                    for (_, container) in panelContainers {
                        container.removeFromParentNode()
                    }
                    panelContainers.removeAll()
                    arManager.pauseSession()
                }
                .onChange(of: arManager.isRelocalizing) { stillRelocalizing in
                    guard !stillRelocalizing, phase == .relocalizing else { return }
                    transitionToNavigating()
                }

            // Ghost reference-photo overlay (re-localization phase only)
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

            // Phase-specific UI
            Group {
                switch phase {
                case .loading:
                    loadingOverlay
                case .relocalizing:
                    relocalizingOverlay
                case .navigating(let index):
                    navigationUI(index: index)
                case .submitted:
                    submittedOverlay
                }
            }

            // Top bar — always visible
            topBar
        }
        .onReceive(navTicker) { _ in
            if case .navigating(let index) = phase {
                updateNavTelemetry(index: index)
            }
        }
        .onAppear {
            progresses   = sortedSteps.map { GuideStepProgress(step: $0) }
            sessionStart = Date()
            if !progresses.isEmpty { progresses[0].enter() }
            if let first = sortedSteps.first { Task { await loadStepImage(for: first) } }
        }
        .task { await loadData() }
        .sheet(isPresented: $showSignOff) {
            SessionSignOffView(
                guide:      guide,
                anchor:     anchor,
                progresses: progresses,
                startedAt:  sessionStart
            ) {
                showSignOff = false
                phase       = .submitted
                stopSpeaking()
                arManager.pauseSession()
            }
            .environmentObject(settings)
        }
        // Evidence camera picker (Phase 3)
        .sheet(isPresented: $showEvidencePicker) {
            if let idx = evidencePickerStepIndex {
                CameraPickerView(sourceType: .camera) { img in
                    progresses[idx].evidencePhoto = img
                    let stepId = sortedSteps[idx].id
                    refreshPanelTextures(stepId: stepId)
                    showEvidencePicker = false
                }
            }
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                stopSpeaking()
                removeArrow()
                arManager.pauseSession()
                dismiss()
            } label: {
                Label("Exit", systemImage: "xmark")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }

            Spacer()

            Text(guide.name)
                .font(.headline).foregroundStyle(.white)
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: 200)

            Spacer()

            if case .navigating(let index) = phase {
                Text("\(index + 1) / \(sortedSteps.count)")
                    .font(.subheadline.monospacedDigit())
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
                    Text("Could not start guide").font(.headline).foregroundStyle(.white)
                    Text(err).font(.caption).foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center).padding(.horizontal, 32)
                    Button("Exit") { dismiss() }
                        .buttonStyle(.bordered).tint(.white)
                }
            } else {
                VStack(spacing: 16) {
                    ProgressView().scaleEffect(1.4).tint(.white)
                    Text("Loading guide…").font(.headline).foregroundStyle(.white)
                    Text("Downloading world map and reference photo")
                        .font(.caption).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    // ── Re-localizing overlay ─────────────────────────────────────────────────

    private var relocalizingOverlay: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 16) {
                VStack(spacing: 4) {
                    Text("Go to the Starting Point")
                        .font(.title3.bold()).foregroundStyle(.white)
                    Text(referencePhoto != nil
                         ? "Align the live view with the ghost image, then tap \"I'm Here\"."
                         : "Stand where the guide was set up, then tap \"I'm Here\".")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.8).tint(.indigo)
                    Text("ARKit is matching the space…")
                        .font(.caption).foregroundStyle(.white.opacity(0.55))
                }

                if showRelocalizingTimeout {
                    Text("Still searching. Try walking closer to where the Author placed the first step.")
                        .font(.caption)
                        .foregroundStyle(.orange.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .transition(.opacity)
                }

                if referencePhoto != nil {
                    HStack(spacing: 10) {
                        Image(systemName: "photo.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                        Slider(value: $ghostOpacity, in: 0.15...0.65)
                            .tint(.indigo)
                        Image(systemName: "eye.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                    }
                }

                Button {
                    userConfirmedRelocalize = true
                    transitionToNavigating()
                } label: {
                    Label("I'm Here", systemImage: "mappin.and.ellipse")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.indigo)
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

    // ── Navigation UI ─────────────────────────────────────────────────────────

    @ViewBuilder
    private func navigationUI(index: Int) -> some View {
        if index < sortedSteps.count {
            let step     = sortedSteps[index]
            let progress = index < progresses.count ? progresses[index] : nil

            ZStack {
                // Screen-edge chevron (when placed pin is off-screen)
                if !targetIsOnScreen, let rawPos = targetScreenPos, step.worldPosition != nil {
                    GeometryReader { geo in
                        let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
                        let dx     = rawPos.x - center.x
                        let dy     = rawPos.y - center.y
                        let angle  = Angle(radians: atan2(Double(dy), Double(dx)))
                        let edge   = clampToEdge(rawPos, size: geo.size, padding: 52)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(.indigo)
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                            .rotationEffect(angle)
                            .position(edge)
                    }
                    .ignoresSafeArea()
                }

                // Bottom 2D panel: full content when arrived, mini nav card en-route
                VStack {
                    Spacer()
                    if showContentPanel || step.worldPosition == nil {
                        GuideContentPanel(
                            step:            step,
                            progress:        progress,
                            stepNumber:      index + 1,
                            totalSteps:      sortedSteps.count,
                            referenceImage:  stepImages[step.id],
                            evidenceImage:   index < progresses.count ? progresses[index].evidencePhoto : nil,
                            isSpeaking:      isSpeaking,
                            canGoBack:       index > 0,
                            canGoNext:       index < sortedSteps.count - 1 && canAdvanceFrom(index: index),
                            canSkip:         !step.completionRequired && !(progress?.isCompleted ?? false),
                            allRequiredDone: allRequiredDone,
                            distanceM:       distanceM,
                            onPrev:          { navigateTo(index: index - 1) },
                            onNext:          { navigateTo(index: index + 1) },
                            onSkip:          { navigateTo(index: index + 1) },
                            onComplete:      { markComplete(at: index); autoAdvance(from: index) },
                            onSpeak:         { toggleSpeech(for: step) },
                            onSignOff:       { showSignOff = true },
                            onEvidence:      { openEvidencePicker(for: index) },
                            onMinimize:      { showContentPanel = false }
                        )
                    } else {
                        miniNavCard(step: step, index: index)
                    }
                }
            }
        }
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

    /// Compact card shown by default. Tap anywhere to expand to the full content panel.
    private func miniNavCard(step: GuideStep, index: Int) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Color.indigo.opacity(0.2)).frame(width: 40, height: 40)
                    Text("\(step.sequenceNumber)")
                        .font(.headline.bold()).foregroundStyle(.indigo)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Step \(step.sequenceNumber) of \(sortedSteps.count)")
                        .font(.caption.bold()).foregroundStyle(.white.opacity(0.55))
                    Text(step.text)
                        .font(.subheadline).foregroundStyle(.white)
                        .lineLimit(2)
                }
                Spacer()
                VStack(spacing: 4) {
                    distancePill
                    Image(systemName: "chevron.up")
                        .font(.caption2.bold())
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.horizontal, 16)

            if !step.completionRequired {
                Button { navigateTo(index: index + 1) } label: {
                    Text("Skip")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.38))
                }
                .padding(.bottom, 2)
            }
        }
        .padding(.top, 14)
        .padding(.bottom, 34)
        .background(.ultraThinMaterial)
        .contentShape(Rectangle())
        .onTapGesture { showContentPanel = true }
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

    // ── Submitted overlay ─────────────────────────────────────────────────────

    private var submittedOverlay: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 60)).foregroundStyle(.green)
                Text("Guide Complete")
                    .font(.title2.bold()).foregroundStyle(.white)
                Text("\(sortedSteps.count) step\(sortedSteps.count == 1 ? "" : "s") signed off")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent).tint(.green)
            }
        }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private func loadData() async {
        let client = SIBClient(settings: settings)
        do {
            async let mapFetch   = client.fetchGuideWorldMap(guideId: guide.id)
            async let photoFetch = client.fetchGuideWorldMapPhoto(guideId: guide.id)
            let (mapData, photoData) = try await (mapFetch, photoFetch)

            if let pd = photoData { referencePhoto = UIImage(data: pd) }

            if let data = mapData {
                arManager.startSessionWithWorldMap(data)
                arManager.disableQRScanning()
                phase = .relocalizing
                showRelocalizingTimeout = false
                Task {
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    guard case .relocalizing = phase else { return }
                    showRelocalizingTimeout = true
                }
            } else {
                transitionToNavigating()
            }
        } catch {
            loadError = friendlyMessage(for: error)
        }
    }

    // ── Transition to navigating ──────────────────────────────────────────────

    private func transitionToNavigating() {
        placePins()
        placeArrow()
        if sortedSteps.isEmpty {
            phase = .submitted
        } else {
            phase = .navigating(index: 0)
            highlightPin(index: 0)
            if sortedSteps[0].worldPosition == nil { showContentPanel = true }
            // loadStepImage (called from onAppear) may have finished before placePins()
            // created the panel containers, making its refreshPanelTextures() a no-op.
            // Flush any images already in the cache into the newly-created panels now.
            for step in sortedSteps where stepImages[step.id] != nil {
                refreshPanelTextures(stepId: step.id)
            }
        }
    }

    // ── Place 3D pins + floating panels ──────────────────────────────────────

    private func placePins() {
        for (i, step) in sortedSteps.enumerated() {
            guard pinNodes[step.id] == nil,
                  let pos = step.worldPosition else { continue }
            let node = makeGuidePin(number: step.sequenceNumber, isActive: i == 0)
            node.simdPosition = pos
            arManager.sceneView.scene.rootNode.addChildNode(node)
            pinNodes[step.id] = node
            // Attach the 3D floating panel above this pin
            attachFloatingPanel(to: node, for: step, index: i)
        }
    }

    // ── Floating panel construction (Phase 3) ─────────────────────────────────

    /// Attaches a world-anchored floating panel directly to the scene root — NOT as a
    /// child of the pin node.  Keeping it at root-level prevents it from inheriting the
    /// pin's pulsing opacity animation (which was the primary blink cause).
    /// The panel floats 0.55 m above the pin and is connected by a dotted dash line.
    /// Materials are fully opaque so freeAxes = .all works without alpha-sort flicker.
    private func attachFloatingPanel(to pinNode: SCNNode, for step: GuideStep, index: Int) {
        let container = SCNNode()
        container.name = "panel_container_\(step.id)"

        // Position: 0.55 m above the pin in world space (panel bottom at ~0.34 m)
        let pp = pinNode.simdPosition
        container.simdPosition = simd_float3(pp.x, pp.y + 0.55, pp.z)

        // Full billboard — panel always directly faces the camera on every axis,
        // which maximises readability. Opaque materials avoid alpha-sort flicker.
        let billboard = SCNBillboardConstraint()
        billboard.freeAxes = .all
        container.constraints = [billboard]

        // Default: minimized pill visible
        panelMinimized[step.id] = true

        // ── Opaque material helper ────────────────────────────────────────────
        func opaqueMat(image: UIImage) -> SCNMaterial {
            let m = SCNMaterial()
            m.diffuse.contents = image
            m.lightingModel    = .constant
            m.isDoubleSided    = true
            // blendMode stays at default (.none = opaque) — no alpha blending,
            // no per-frame depth-sort, no flicker.
            return m
        }

        // ── Minimized pill (0.30 × 0.055 m → texture 512 × 94 pt) ───────────
        let pillPlane = SCNPlane(width: 0.30, height: 0.055)
        pillPlane.firstMaterial = opaqueMat(image: renderPillTexture(step: step, index: index))
        let pillNode = SCNNode(geometry: pillPlane)
        pillNode.name     = "pill_\(step.id)"
        pillNode.isHidden = false
        container.addChildNode(pillNode)

        // ── Maximized card (0.30 × 0.40 m → texture 512 × 683 pt) ───────────
        let cardPlane = SCNPlane(width: 0.30, height: 0.40)
        cardPlane.firstMaterial = opaqueMat(image: renderCardTexture(step: step, index: index, referenceImage: nil))
        let cardNode = SCNNode(geometry: cardPlane)
        cardNode.name     = "card_\(step.id)"
        cardNode.isHidden = true
        container.addChildNode(cardNode)

        // ── Invisible hit-test buttons (card local: x ∈ [−0.15,0.15], y ∈ [−0.20,0.20])
        cardNode.addChildNode(makeHitButton(w: 0.06, h: 0.05, x:  0.12,  y:  0.183, name: "btn_min_\(step.id)"))
        // Larger hit areas for audio/camera to match the increased 34pt icon size
        cardNode.addChildNode(makeHitButton(w: 0.08, h: 0.07, x: -0.10,  y: -0.170, name: "btn_audio_\(step.id)"))
        cardNode.addChildNode(makeHitButton(w: 0.08, h: 0.07, x: -0.025, y: -0.170, name: "btn_camera_\(step.id)"))
        cardNode.addChildNode(makeHitButton(w: 0.11, h: 0.05, x:  0.068, y: -0.170, name: "btn_complete_\(step.id)"))
        pillNode.addChildNode(makeHitButton(w: 0.30, h: 0.055, x: 0, y: 0, name: "btn_expand_\(step.id)"))

        // ── Dotted connector: vertical dashes from pin top to panel bottom ────
        // Pin-local y=0.06 (above torus) → y=0.34 (panel bottom in pin-local space)
        // Panel bottom in world = pp.y+0.55−0.20 = pp.y+0.35 → local y≈0.35
        let dotCount = 7
        for i in 0..<dotCount {
            let t = Float(i) / Float(dotCount - 1)
            let y = 0.06 + t * 0.28          // 0.06 m to 0.34 m above pin
            let dash = SCNCylinder(radius: 0.004, height: 0.018)
            let dMat = SCNMaterial()
            dMat.diffuse.contents = UIColor.white.withAlphaComponent(0.45)
            dMat.lightingModel    = .constant
            dash.firstMaterial    = dMat
            let dNode = SCNNode(geometry: dash)
            dNode.position = SCNVector3(0, y, 0)
            pinNode.addChildNode(dNode)
        }

        // ── Add panel to SCENE ROOT (not pin child) — avoids pulse inheritance ─
        arManager.sceneView.scene.rootNode.addChildNode(container)
        panelContainers[step.id] = container
    }

    /// Creates a nearly-invisible (but hit-testable) flat button node.
    private func makeHitButton(w: CGFloat, h: CGFloat, x: Float, y: Float, name: String) -> SCNNode {
        let plane = SCNPlane(width: w, height: h)
        let mat   = SCNMaterial()
        mat.diffuse.contents  = UIColor.white.withAlphaComponent(0.01)
        mat.lightingModel     = .constant
        mat.isDoubleSided     = true
        plane.firstMaterial   = mat
        let node = SCNNode(geometry: plane)
        node.name     = name
        node.position = SCNVector3(x, y, 0.001)
        return node
    }

    // ── Panel hit-test tap handler ────────────────────────────────────────────

    private func handleARTap(at point: CGPoint) {
        // Only process taps during navigation
        guard case .navigating(let currentIndex) = phase else { return }

        // Use .all so every node at the tap point is returned — alpha-blended
        // planes don't write depth reliably, making .closest pick the wrong node.
        let hits = arManager.sceneView.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue,
        ])

        // Walk up hit node hierarchy to find a named button or pill/card
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                guard let name = n.name else { candidate = n.parent; continue }

                if name.hasPrefix("btn_min_") {
                    let stepId = String(name.dropFirst("btn_min_".count))
                    togglePanel(stepId: stepId, minimize: true)
                    return
                }
                if name.hasPrefix("btn_expand_") || name.hasPrefix("pill_") {
                    let stepId = name.hasPrefix("pill_")
                        ? String(name.dropFirst("pill_".count))
                        : String(name.dropFirst("btn_expand_".count))
                    togglePanel(stepId: stepId, minimize: false)
                    return
                }
                if name.hasPrefix("btn_audio_") {
                    let stepId = String(name.dropFirst("btn_audio_".count))
                    if let step = sortedSteps.first(where: { $0.id == stepId }) {
                        toggleSpeech(for: step)
                    }
                    return
                }
                if name.hasPrefix("btn_camera_") {
                    let stepId = String(name.dropFirst("btn_camera_".count))
                    if let idx = sortedSteps.firstIndex(where: { $0.id == stepId }) {
                        openEvidencePicker(for: idx)
                    }
                    return
                }
                if name.hasPrefix("btn_complete_") {
                    let stepId = String(name.dropFirst("btn_complete_".count))
                    if let idx = sortedSteps.firstIndex(where: { $0.id == stepId }) {
                        // If this is the last step and all required are done → sign-off
                        if idx == sortedSteps.count - 1 && allRequiredDone {
                            showSignOff = true
                        } else {
                            markComplete(at: idx)
                            autoAdvance(from: idx)
                        }
                        refreshPanelTextures(stepId: stepId)
                    }
                    return
                }
                candidate = n.parent
            }
        }
    }

    /// Toggle a panel between minimized pill and maximized card.
    /// No animation — instant switch to avoid flicker against AR background.
    private func togglePanel(stepId: String, minimize: Bool) {
        panelMinimized[stepId] = minimize
        guard let container = panelContainers[stepId] else { return }
        let pillNode = container.childNode(withName: "pill_\(stepId)", recursively: true)
        let cardNode = container.childNode(withName: "card_\(stepId)", recursively: true)
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0
        pillNode?.isHidden = !minimize
        cardNode?.isHidden = minimize
        SCNTransaction.commit()
    }

    /// Re-renders and applies the current card/pill textures for a step.
    /// Called after: step completion, evidence capture, or step image load.
    private func refreshPanelTextures(stepId: String) {
        guard let container = panelContainers[stepId],
              let step      = sortedSteps.first(where: { $0.id == stepId }),
              let index     = sortedSteps.firstIndex(where: { $0.id == stepId }) else { return }

        let isMinimized  = panelMinimized[stepId] ?? false
        let refImage     = stepImages[stepId]
        let progIdx      = index < progresses.count ? index : nil
        let evidenceImg  = progIdx.map { progresses[$0].evidencePhoto } ?? nil

        // Re-render pill texture
        let pillNode = container.childNode(withName: "pill_\(stepId)", recursively: true)
        if let pillGeo = pillNode?.geometry as? SCNPlane {
            pillGeo.firstMaterial?.diffuse.contents = renderPillTexture(step: step, index: index)
        }
        _ = isMinimized  // suppress unused warning (visibility already set in togglePanel)

        // Re-render card texture
        let cardNode = container.childNode(withName: "card_\(stepId)", recursively: true)
        if let cardGeo = cardNode?.geometry as? SCNPlane {
            cardGeo.firstMaterial?.diffuse.contents = renderCardTexture(
                step: step, index: index, referenceImage: refImage, evidenceImage: evidenceImg)
        }
    }

    // ── Panel texture rendering ───────────────────────────────────────────────
    // Both textures are rendered via UIKit drawing (UIGraphicsImageRenderer) and
    // applied as SCNMaterial.diffuse.contents.  All drawing is in pixel space;
    // the SCNPlane's physical size controls real-world scale.

    /// Minimized pill (512 × 94 pt — matches SCNPlane ratio 0.30 m × 0.055 m).
    /// Fully opaque background; audio icon + distance shown in right zone.
    private func renderPillTexture(step: GuideStep, index: Int) -> UIImage {
        let W: CGFloat = 512
        let H: CGFloat = 94
        let size = CGSize(width: W, height: H)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)

            // Opaque dark background — no alpha, avoids alpha-sort flicker with freeAxes=.all
            UIColor(white: 0.11, alpha: 1.0).setFill()
            UIBezierPath(roundedRect: r, cornerRadius: 18).fill()

            // ── Step badge ────────────────────────────────────────────────────
            let badgeR = CGRect(x: 12, y: 17, width: 60, height: 60)
            UIColor.systemIndigo.setFill()
            UIBezierPath(ovalIn: badgeR).fill()
            let numStr = "\(step.sequenceNumber)" as NSString
            let numAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.boldSystemFont(ofSize: 26),
                .foregroundColor: UIColor.white,
            ]
            let numSz = numStr.size(withAttributes: numAttrs)
            numStr.draw(at: CGPoint(x: badgeR.midX - numSz.width/2,
                                    y: badgeR.midY - numSz.height/2),
                        withAttributes: numAttrs)

            // ── Title (center-aligned in middle zone) ─────────────────────────
            let titlePara = NSMutableParagraphStyle()
            titlePara.alignment     = .center
            titlePara.lineBreakMode = .byTruncatingTail
            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: UIColor.white,
                .paragraphStyle:  titlePara,
            ]
            // Middle zone: badge right edge = 72, audio left edge = 348 → width 276
            let titleR = CGRect(x: 80, y: 8, width: 260, height: H - 16)
            (step.text as NSString).draw(with: titleR,
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: titleAttrs,
                context: nil)

            // ── Audio icon ────────────────────────────────────────────────────
            let audioColor: UIColor = isSpeaking ? .systemIndigo : UIColor.white.withAlphaComponent(0.80)
            let audioAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 30),
                .foregroundColor: audioColor,
            ]
            ("🔊" as NSString).draw(at: CGPoint(x: 348, y: H / 2 - 20), withAttributes: audioAttrs)

            // ── Distance label ────────────────────────────────────────────────
            if let d = distanceM {
                let dColor: UIColor = d <= arrivedM ? .systemGreen
                    : (d <= approachingM ? .systemOrange : .white)
                let dAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
                    .foregroundColor: dColor,
                ]
                (String(format: "%.1f m", d) as NSString)
                    .draw(at: CGPoint(x: 390, y: H / 2 - 9), withAttributes: dAttrs)
            }

            // ── Expand chevron (far right) ────────────────────────────────────
            let chevAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 26, weight: .medium),
                .foregroundColor: UIColor.white.withAlphaComponent(0.50),
            ]
            ("›" as NSString).draw(at: CGPoint(x: 478, y: H / 2 - 18), withAttributes: chevAttrs)
        }
    }

    /// Maximized card (512 × 580 pt → 0.30 m × 0.40 m in world space)
    private func renderCardTexture(
        step:           GuideStep,
        index:          Int,
        referenceImage: UIImage?,
        evidenceImage:  UIImage? = nil
    ) -> UIImage {
        let W: CGFloat = 512
        let H: CGFloat = 580
        let size = CGSize(width: W, height: H)
        let progress = index < progresses.count ? progresses[index] : nil
        let isCompleted  = progress?.isCompleted ?? false
        let isLastStep   = index == sortedSteps.count - 1
        let hasEvidence  = evidenceImage != nil || (progress?.evidencePhoto) != nil

        return UIGraphicsImageRenderer(size: size).image { ctx in
            let r = CGRect(origin: .zero, size: size)

            // ── Background — fully opaque (avoids alpha-sort ordering artefacts) ──
            UIColor(white: 0.09, alpha: 1.0).setFill()
            UIBezierPath(roundedRect: r, cornerRadius: 24).fill()

            // ── Header row ────────────────────────────────────────────────────
            // Badge
            let badgeR = CGRect(x: 14, y: 14, width: 46, height: 46)
            (isCompleted ? UIColor.systemGreen : UIColor.systemIndigo).setFill()
            UIBezierPath(ovalIn: badgeR).fill()
            if isCompleted {
                let ckAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 22),
                    .foregroundColor: UIColor.white,
                ]
                ("✓" as NSString).draw(at: CGPoint(x: 23, y: 21), withAttributes: ckAttrs)
            } else {
                let numStr   = "\(step.sequenceNumber)" as NSString
                let numAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 20),
                    .foregroundColor: UIColor.white,
                ]
                let numSz = numStr.size(withAttributes: numAttrs)
                numStr.draw(at: CGPoint(x: badgeR.midX - numSz.width/2,
                                        y: badgeR.midY - numSz.height/2),
                            withAttributes: numAttrs)
            }

            // Step label — at top of header zone, small caption size
            let stepLabelAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: UIColor.white.withAlphaComponent(0.50),
            ]
            ("Step \(index + 1) of \(sortedSteps.count)" as NSString)
                .draw(at: CGPoint(x: 70, y: 16), withAttributes: stepLabelAttrs)

            // Title — below step label with a clear gap (step label ends at ~29 pt)
            let titleLinePara = NSMutableParagraphStyle()
            titleLinePara.lineBreakMode = .byTruncatingTail
            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: UIColor.white,
                .paragraphStyle:  titleLinePara,
            ]
            let titleR = CGRect(x: 70, y: 34, width: W - 130, height: 30)
            (step.text as NSString).draw(with: titleR,
                options: .truncatesLastVisibleLine,
                attributes: titleAttrs,
                context: nil)

            // Minimize chevron (top-right)
            let minAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 16, weight: .medium),
                .foregroundColor: UIColor.white.withAlphaComponent(0.45),
            ]
            ("–" as NSString).draw(at: CGPoint(x: W - 34, y: 24), withAttributes: minAttrs)

            // ── Divider ───────────────────────────────────────────────────────
            UIColor.white.withAlphaComponent(0.12).setStroke()
            let divPath = UIBezierPath()
            divPath.move(to: CGPoint(x: 14, y: 72))
            divPath.addLine(to: CGPoint(x: W - 14, y: 72))
            divPath.lineWidth = 1
            divPath.stroke()

            // ── Description (center-aligned) ──────────────────────────────────
            let descPara = NSMutableParagraphStyle()
            descPara.alignment = .center
            let descAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 13),
                .foregroundColor: UIColor.white.withAlphaComponent(0.88),
                .paragraphStyle:  descPara,
            ]
            let descR = CGRect(x: 14, y: 82, width: W - 28, height: 140)
            (step.text as NSString).draw(with: descR,
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: descAttrs,
                context: nil)

            // ── Reference image ───────────────────────────────────────────────
            var nextY: CGFloat = 232
            if let img = referenceImage {
                let imgH: CGFloat = 170
                let imgR = CGRect(x: 14, y: nextY, width: W - 28, height: imgH)
                UIColor.white.withAlphaComponent(0.06).setFill()
                UIBezierPath(roundedRect: imgR, cornerRadius: 8).fill()
                // Clip and draw image — aspect-fit (no stretching)
                ctx.cgContext.saveGState()
                UIBezierPath(roundedRect: imgR, cornerRadius: 8).addClip()
                let imgAspect = img.size.width / img.size.height
                let boxAspect = imgR.width / imgR.height
                let fittedRect: CGRect
                if imgAspect > boxAspect {
                    // Image is wider than box — fit width, letterbox top/bottom
                    let fH = imgR.width / imgAspect
                    fittedRect = CGRect(x: imgR.minX,
                                        y: imgR.minY + (imgR.height - fH) / 2,
                                        width: imgR.width, height: fH)
                } else {
                    // Image is taller than box — fit height, pillarbox left/right
                    let fW = imgR.height * imgAspect
                    fittedRect = CGRect(x: imgR.minX + (imgR.width - fW) / 2,
                                        y: imgR.minY, width: fW, height: imgR.height)
                }
                img.draw(in: fittedRect)
                ctx.cgContext.restoreGState()
                nextY = imgR.maxY + 12
            }

            // ── Divider before action bar ─────────────────────────────────────
            let div2Path = UIBezierPath()
            div2Path.move(to: CGPoint(x: 14, y: H - 108))
            div2Path.addLine(to: CGPoint(x: W - 14, y: H - 108))
            div2Path.lineWidth = 1
            UIColor.white.withAlphaComponent(0.12).setStroke()
            div2Path.stroke()

            // ── Action bar (bottom 108 pt) ────────────────────────────────────
            // Icons are 34 pt; labels beneath at 9 pt; total icon+label ≈ 52 pt.
            let barY: CGFloat = H - 100

            // Audio button — icon + label
            let audioColor: UIColor = isSpeaking ? .systemIndigo : UIColor.white.withAlphaComponent(0.75)
            let speakerAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 34),
                .foregroundColor: audioColor,
            ]
            ("🔊" as NSString).draw(at: CGPoint(x: 14, y: barY + 6), withAttributes: speakerAttrs)
            let audioLabelPara = NSMutableParagraphStyle(); audioLabelPara.alignment = .center
            let audioLabelAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 9, weight: .medium),
                .foregroundColor: audioColor,
                .paragraphStyle:  audioLabelPara,
            ]
            (isSpeaking ? "SPEAKING" : "AUDIO" as NSString)
                .draw(in: CGRect(x: 6, y: barY + 46, width: 52, height: 14),
                      withAttributes: audioLabelAttrs)

            // Evidence camera button — icon + label
            let camColor: UIColor = hasEvidence ? .systemGreen : UIColor.white.withAlphaComponent(0.75)
            let camAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 34),
                .foregroundColor: camColor,
            ]
            ("📷" as NSString).draw(at: CGPoint(x: 70, y: barY + 6), withAttributes: camAttrs)
            let camLabelPara = NSMutableParagraphStyle(); camLabelPara.alignment = .center
            let camLabelAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 9, weight: .medium),
                .foregroundColor: camColor,
                .paragraphStyle:  camLabelPara,
            ]
            (hasEvidence ? "CAPTURED" : "PHOTO" as NSString)
                .draw(in: CGRect(x: 62, y: barY + 46, width: 52, height: 14),
                      withAttributes: camLabelAttrs)

            // Distance label (between icons and primary button)
            if let d = distanceM {
                let dColor: UIColor = d <= arrivedM ? .systemGreen : (d <= approachingM ? .systemOrange : .white)
                let dAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold),
                    .foregroundColor: dColor,
                ]
                (String(format: "%.1f m", d) as NSString).draw(at: CGPoint(x: 130, y: barY + 22), withAttributes: dAttrs)
            }

            // Primary action button (right side)
            let btnX: CGFloat = W - 170
            let btnR  = CGRect(x: btnX, y: barY + 10, width: 156, height: 52)
            if isLastStep && allRequiredDone {
                UIColor.systemGreen.setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: 12).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.white,
                ]
                let lbl = "✎ Sign Off" as NSString
                let lSz = lbl.size(withAttributes: btnAttrs)
                lbl.draw(at: CGPoint(x: btnR.midX - lSz.width/2,
                                     y: btnR.midY - lSz.height/2),
                         withAttributes: btnAttrs)
            } else if isCompleted {
                UIColor.systemGreen.withAlphaComponent(0.2).setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: 12).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.systemGreen,
                ]
                ("✓ Completed" as NSString).draw(
                    at: CGPoint(x: btnR.midX - 52, y: btnR.midY - 10),
                    withAttributes: btnAttrs)
            } else if step.completionRequired {
                UIColor.systemIndigo.setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: 12).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.white,
                ]
                ("✓ Mark Complete" as NSString).draw(
                    at: CGPoint(x: btnR.midX - 66, y: btnR.midY - 10),
                    withAttributes: btnAttrs)
            } else {
                UIColor.white.withAlphaComponent(0.1).setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: 12).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.systemFont(ofSize: 14),
                    .foregroundColor: UIColor.white.withAlphaComponent(0.55),
                ]
                ("→ Next Step" as NSString).draw(
                    at: CGPoint(x: btnR.midX - 48, y: btnR.midY - 10),
                    withAttributes: btnAttrs)
            }
        }
    }

    // ── Pin highlight ─────────────────────────────────────────────────────────

    private func highlightPin(index: Int) {
        guard index < sortedSteps.count else { return }
        let activeId = sortedSteps[index].id
        for (id, node) in pinNodes {
            node.removeAllActions()
            if id == activeId {
                node.opacity = 1.0
                node.runAction(.repeatForever(.sequence([
                    .fadeOpacity(to: 0.35, duration: 0.5),
                    .fadeOpacity(to: 1.00, duration: 0.5),
                ])))
            } else {
                node.runAction(.fadeOpacity(to: 0.3, duration: 0.2))
            }
        }
    }

    // ── makeGuidePin (indigo sphere + torus + badge) ──────────────────────────

    private func makeGuidePin(number: Int, isActive: Bool) -> SCNNode {
        let root  = SCNNode()
        let color = UIColor.systemIndigo

        let sphere = SCNSphere(radius: 0.015)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.6)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        let torus        = SCNTorus()
        torus.ringRadius = 0.023
        torus.pipeRadius = 0.005
        let tMat         = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(0.4)
        tMat.lightingModel     = .constant
        torus.firstMaterial    = tMat
        let ring               = SCNNode(geometry: torus)
        ring.eulerAngles       = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ring)

        let badge = makeNumberBadge(number: number)
        badge.position = SCNVector3(0, 0.055, 0)
        root.addChildNode(badge)

        return root
    }

    private func makeNumberBadge(number: Int) -> SCNNode {
        let size: CGFloat = 128
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let img = renderer.image { _ in
            let r = CGRect(origin: .zero, size: CGSize(width: size, height: size))
            UIColor.systemIndigo.withAlphaComponent(0.9).setFill()
            UIBezierPath(ovalIn: r).fill()
            UIColor.white.withAlphaComponent(0.3).setStroke()
            let border = UIBezierPath(ovalIn: r.insetBy(dx: 3, dy: 3))
            border.lineWidth = 4
            border.stroke()
            let attrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.boldSystemFont(ofSize: 64),
                .foregroundColor: UIColor.white,
            ]
            let str  = "\(number)" as NSString
            let sz   = str.size(withAttributes: attrs)
            str.draw(at: CGPoint(x: (size - sz.width) / 2, y: (size - sz.height) / 2),
                     withAttributes: attrs)
        }
        let plane = SCNPlane(width: 0.04, height: 0.04)
        plane.firstMaterial?.diffuse.contents    = img
        plane.firstMaterial?.lightingModel       = .constant
        plane.firstMaterial?.isDoubleSided       = true
        plane.firstMaterial?.blendMode           = .alpha
        let node = SCNNode(geometry: plane)
        node.constraints = [SCNBillboardConstraint()]
        return node
    }

    // ── 3D navigation arrow ───────────────────────────────────────────────────

    private func placeArrow() {
        guard arrowNode == nil else { return }
        let node = makeArrowNode()
        node.isHidden = true
        arManager.sceneView.scene.rootNode.addChildNode(node)
        arrowNode = node
    }

    private func removeArrow() {
        arrowNode?.removeFromParentNode()
        arrowNode = nil
    }

    private func makeArrowNode() -> SCNNode {
        let root = SCNNode()

        let coreMat = SCNMaterial()
        coreMat.diffuse.contents  = UIColor.systemIndigo
        coreMat.emission.contents = UIColor.systemIndigo.withAlphaComponent(0.85)
        coreMat.lightingModel     = .constant
        coreMat.transparency      = 0.70
        coreMat.isDoubleSided     = true

        let glowMat = SCNMaterial()
        glowMat.diffuse.contents  = UIColor.clear
        glowMat.emission.contents = UIColor(red: 0.35, green: 0.27, blue: 0.81, alpha: 1.0)
        glowMat.lightingModel     = .constant
        glowMat.transparency      = 0.18
        glowMat.isDoubleSided     = true

        let shaft = SCNCylinder(radius: 0.010, height: 0.12)
        shaft.firstMaterial = coreMat
        let shaftNode = SCNNode(geometry: shaft)
        shaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        shaftNode.position    = SCNVector3(0, 0, 0.04)
        root.addChildNode(shaftNode)

        let glowShaft = SCNCylinder(radius: 0.022, height: 0.12)
        glowShaft.firstMaterial = glowMat
        let glowShaftNode = SCNNode(geometry: glowShaft)
        glowShaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowShaftNode.position    = SCNVector3(0, 0, 0.04)
        root.addChildNode(glowShaftNode)

        let head = SCNCone(topRadius: 0, bottomRadius: 0.025, height: 0.06)
        head.firstMaterial = coreMat
        let headNode = SCNNode(geometry: head)
        headNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        headNode.position    = SCNVector3(0, 0, 0.13)
        root.addChildNode(headNode)

        let glowHead = SCNCone(topRadius: 0, bottomRadius: 0.042, height: 0.08)
        glowHead.firstMaterial = glowMat
        let glowHeadNode = SCNNode(geometry: glowHead)
        glowHeadNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowHeadNode.position    = SCNVector3(0, 0, 0.125)
        root.addChildNode(glowHeadNode)

        return root
    }

    // ── Navigation telemetry (10 Hz) ──────────────────────────────────────────

    private func updateNavTelemetry(index: Int) {
        guard index < sortedSteps.count,
              let frame = arManager.sceneView.session.currentFrame else { return }

        let step = sortedSteps[index]
        guard let targetW = step.worldPosition else {
            if !showContentPanel { showContentPanel = true }
            return
        }

        let camCol = frame.camera.transform.columns.3
        let camPos = simd_float3(camCol.x, camCol.y, camCol.z)
        let dist   = simd_length(targetW - camPos)
        distanceM  = dist

        // Do not auto-expand the 2D panel on arrival — user taps the mini card to open it

        let sv        = arManager.sceneView
        let projected = sv.projectPoint(SCNVector3(targetW.x, targetW.y, targetW.z))
        let pt        = CGPoint(x: CGFloat(projected.x), y: CGFloat(projected.y))
        targetScreenPos  = pt
        targetIsOnScreen = UIScreen.main.bounds.contains(pt) && projected.z < 1.0

        updateArrowNode(targetW: targetW, frame: frame)
    }

    private func updateArrowNode(targetW: simd_float3, frame: ARFrame) {
        guard let arrow = arrowNode else { return }

        let cam    = frame.camera.transform
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        let fwdX   = -cam.columns.2.x
        let fwdZ   = -cam.columns.2.z
        let fwdLen = sqrt(fwdX * fwdX + fwdZ * fwdZ)
        guard fwdLen > 0.001 else { return }

        let arrowPos = simd_float3(
            camPos.x + (fwdX / fwdLen) * 0.7,
            camPos.y - 0.25,
            camPos.z + (fwdZ / fwdLen) * 0.7
        )
        let dx   = targetW.x - arrowPos.x
        let dz   = targetW.z - arrowPos.z
        let dist = sqrt(dx * dx + dz * dz)

        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.08
        arrow.simdPosition = arrowPos
        if dist > 0.05 {
            arrow.simdEulerAngles = simd_float3(0, atan2(dx, dz), 0)
        }
        arrow.isHidden = (distanceM ?? Float.infinity) <= arrivedM
        SCNTransaction.commit()
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    private func canAdvanceFrom(index: Int) -> Bool {
        guard index < sortedSteps.count, index < progresses.count else { return false }
        let step = sortedSteps[index]
        if step.completionRequired { return progresses[index].isCompleted }
        return true
    }

    private func navigateTo(index: Int) {
        guard index >= 0, index < sortedSteps.count else { return }
        stopSpeaking()
        distanceM        = nil
        targetScreenPos  = nil
        showContentPanel = false
        phase = .navigating(index: index)
        if progresses[index].enteredAt == nil { progresses[index].enter() }
        highlightPin(index: index)
        if sortedSteps[index].worldPosition == nil { showContentPanel = true }
        let step = sortedSteps[index]
        if stepImages[step.id] == nil { Task { await loadStepImage(for: step) } }
    }

    private func markComplete(at index: Int) {
        guard index < progresses.count else { return }
        progresses[index].complete()
    }

    /// After marking complete, auto-advance to the next step if one exists.
    private func autoAdvance(from index: Int) {
        let next = index + 1
        if next < sortedSteps.count {
            navigateTo(index: next)
        }
        // If last step, panel texture will show the sign-off button on next refresh
    }

    // ── Evidence capture ──────────────────────────────────────────────────────

    private func openEvidencePicker(for index: Int) {
        evidencePickerStepIndex = index
        showEvidencePicker      = true
    }

    // ── TTS ───────────────────────────────────────────────────────────────────

    private func toggleSpeech(for step: GuideStep) {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
            isSpeaking = false
        } else {
            let utt   = AVSpeechUtterance(string: step.effectiveTTSText)
            utt.rate  = AVSpeechUtteranceDefaultSpeechRate
            utt.voice = AVSpeechSynthesisVoice(
                language: Locale.current.language.languageCode?.identifier ?? "en")
            synthesizer.speak(utt)
            isSpeaking = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 300_000_000)
                while synthesizer.isSpeaking {
                    try? await Task.sleep(nanoseconds: 200_000_000)
                }
                isSpeaking = false
            }
        }
    }

    private func stopSpeaking() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        isSpeaking = false
    }

    // ── Step reference photo ──────────────────────────────────────────────────

    private func loadStepImage(for step: GuideStep) async {
        guard let filename = step.mediaPath, stepImages[step.id] == nil else { return }
        let client = SIBClient(settings: settings)
        if let data = try? await client.fetchGuideStepImage(filename: filename),
           let img  = UIImage(data: data) {
            stepImages[step.id] = img
            // Refresh floating panel with the newly loaded image
            refreshPanelTextures(stepId: step.id)
        }
    }
}

// ── Guide Content Panel ───────────────────────────────────────────────────────
//
// The 2D bottom-screen card shown when the Operator arrives at a step (≤ 0.5 m)
// or the step has no AR position.
// Phase 3 additions: evidenceImage, onEvidence callback.

struct GuideContentPanel: View {

    let step:            GuideStep
    let progress:        GuideStepProgress?
    let stepNumber:      Int
    let totalSteps:      Int
    let referenceImage:  UIImage?
    let evidenceImage:   UIImage?   // Phase 3: captured evidence photo (or nil)
    let isSpeaking:      Bool
    let canGoBack:       Bool
    let canGoNext:       Bool
    let canSkip:         Bool
    let allRequiredDone: Bool
    let distanceM:       Float?

    let onPrev:      () -> Void
    let onNext:      () -> Void
    let onSkip:      () -> Void
    let onComplete:  () -> Void
    let onSpeak:     () -> Void
    let onSignOff:   () -> Void
    let onEvidence:  () -> Void   // Phase 3
    let onMinimize:  () -> Void   // collapse back to mini nav card

    var isCompleted: Bool { progress?.isCompleted ?? false }
    var isLastStep:  Bool { stepNumber == totalSteps }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── Step header ───────────────────────────────────────────────────
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(isCompleted ? Color.green.opacity(0.2) : Color.indigo.opacity(0.15))
                        .frame(width: 34, height: 34)
                    if isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.green)
                    } else {
                        Text("\(stepNumber)")
                            .font(.subheadline.bold())
                            .foregroundStyle(.indigo)
                    }
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text("Step \(stepNumber) of \(totalSteps)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    if step.completionRequired {
                        Label("Completion required", systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                // Distance pill
                if let d = distanceM {
                    let color: Color = d <= 0.5 ? .green : (d <= 1.0 ? .orange : .secondary)
                    Text(String(format: "%.1f m", d))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(color)
                }

                // TTS speak button
                Button(action: onSpeak) {
                    Image(systemName: isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.1")
                        .font(.system(size: 20))
                        .foregroundStyle(isSpeaking ? .indigo : .secondary)
                        .symbolEffect(.pulse, isActive: isSpeaking)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 4)

                // Minimize — collapse back to mini nav card
                Button(action: onMinimize) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 16)

            // ── Step text + reference + evidence ──────────────────────────────
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(step.text)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                    if let img = referenceImage {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .padding(.horizontal, 16)
                    } else if step.mediaPath != nil {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.1))
                            .frame(height: 60)
                            .overlay(ProgressView())
                            .padding(.horizontal, 16)
                    }

                    // Evidence row (Phase 3)
                    HStack(spacing: 10) {
                        if let ev = evidenceImage {
                            Image(uiImage: ev)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 60, height: 60)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(Color.green.opacity(0.5), lineWidth: 1.5)
                                )
                        }
                        Button(action: onEvidence) {
                            Label(evidenceImage == nil ? "Add Evidence Photo" : "Retake",
                                  systemImage: "camera.fill")
                                .font(.caption.bold())
                                .foregroundStyle(evidenceImage == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.green))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)

                    Spacer(minLength: 8)
                }
            }
            .frame(maxHeight: referenceImage != nil ? 240 : 140)

            Divider().padding(.horizontal, 16)

            // ── Action row ────────────────────────────────────────────────────
            VStack(spacing: 10) {

                if isLastStep && allRequiredDone {
                    Button(action: onSignOff) {
                        Label("Sign Off & Submit", systemImage: "signature")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.green)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if step.completionRequired && !isCompleted {
                    Button(action: onComplete) {
                        Label("Mark Complete", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.indigo)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if isCompleted {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("Completed").font(.subheadline.bold()).foregroundStyle(.green)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }

                if canSkip {
                    Button(action: onSkip) {
                        Text("Skip this step →")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(spacing: 12) {
                    Button(action: onPrev) {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                            Text("Prev")
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoBack ? .primary : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoBack)

                    Button(action: onNext) {
                        HStack(spacing: 6) {
                            Text(isLastStep ? "Done" : "Next")
                            Image(systemName: isLastStep ? "checkmark" : "chevron.right")
                        }
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(canGoNext ? Color.indigo.opacity(0.9) : Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoNext ? .white : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoNext || isLastStep)
                }
                .padding(.horizontal, 16)
            }
            .padding(.top, 12)
            .padding(.bottom, 34)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        .animation(.easeInOut(duration: 0.2), value: isCompleted)
        .animation(.easeInOut(duration: 0.2), value: allRequiredDone)
    }
}

// ── Session Sign-Off Sheet ────────────────────────────────────────────────────

struct SessionSignOffView: View {

    let guide:      ARGuide
    let anchor:     Anchor
    let progresses: [GuideStepProgress]
    let startedAt:  Date
    let onDone:     () -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var operatorName = ""
    @State private var isSubmitting = false
    @State private var error:       String? = nil

    private var completedAt: Date { Date() }

    private var durationSeconds: Double {
        completedAt.timeIntervalSince(startedAt)
    }

    private var stepCompletions: [GuideStepCompletion] {
        progresses.compactMap { $0.toCompletion() }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .center, spacing: 12) {
                        Image(systemName: "signature")
                            .font(.system(size: 44))
                            .foregroundStyle(.indigo)
                        Text("Sign Off")
                            .font(.title2.bold())
                        Text("\(guide.name) — \(anchor.assetId)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    HStack {
                        Image(systemName: "person.fill")
                            .foregroundStyle(.indigo).frame(width: 22)
                        TextField("Your name", text: $operatorName)
                            .autocorrectionDisabled()
                    }
                } header: {
                    Text("Operator Sign-Off")
                } footer: {
                    Text("Your name is recorded with this session and cannot be changed after submission.")
                }

                Section {
                    LabeledContent("Steps completed",
                                   value: "\(stepCompletions.count) / \(progresses.count)")
                    LabeledContent("Evidence photos",
                                   value: "\(progresses.filter { $0.evidencePhoto != nil }.count) captured")
                    LabeledContent("Duration",
                                   value: formatDuration(durationSeconds))
                } header: {
                    Text("Session Summary")
                }

                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Sign Off")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Submit") { Task { await submit() } }
                            .bold()
                            .disabled(operatorName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        error        = nil
        let iso      = ISO8601DateFormatter()
        let req      = CreateARGuideSessionRequest(
            guideId:         guide.id,
            anchorId:        anchor.id,
            guideName:       guide.name,
            anchorName:      anchor.assetId,
            signedOffBy:     operatorName.trimmingCharacters(in: .whitespaces),
            startedAt:       iso.string(from: startedAt),
            completedAt:     iso.string(from: completedAt),
            durationSeconds: durationSeconds,
            stepCompletions: stepCompletions
        )
        let client = SIBClient(settings: settings)
        do {
            _ = try await client.submitGuideSession(req)
            onDone()
        } catch {
            self.error = "Submission failed: \(friendlyMessage(for: error))"
        }
        isSubmitting = false
    }

    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let m     = total / 60
        let s     = total % 60
        return m > 0 ? "\(m) min \(s) sec" : "\(s) sec"
    }
}
