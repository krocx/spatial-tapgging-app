// ARGuideSessionView.swift — AR OMS Phase 2
//
// Full-screen AR session for an Operator running a published Guide.
//
// State machine:
//   .loading      — download ARWorldMap + reference photo (steps pre-fetched by caller)
//   .relocalizing — ghost photo overlay + "I'm Here" + ARKit worldmap matching
//   .navigating(index:) — 3D indigo pins + distance telemetry + content panel auto-show at 0.5m
//   .submitted    — done overlay after sign-off
//
// GuideContentPanel and SessionSignOffView live at the bottom of this file.

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
            ARContainerView(arManager: arManager, onTap: { _ in })
                .ignoresSafeArea()
                .onAppear {
                    // The QR-scan gate hands off its live ARSession via appState so it
                    // isn't paused on dismiss.  Pause it explicitly here so it doesn't
                    // compete with our own session for the device camera.
                    appState.activeARSession?.pause()
                    appState.activeARSession = nil
                    // Bare session for camera feed; real start happens after worldmap loads.
                    arManager.startSession()
                    arManager.disableQRScanning()
                }
                .onDisappear {
                    stopSpeaking()
                    removeArrow()
                    arManager.pauseSession()
                }
                // Fired when ARKit finishes matching the saved world map
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

                // Bottom panel: full content panel when arrived, mini nav card when en-route
                VStack {
                    Spacer()
                    if showContentPanel || step.worldPosition == nil {
                        GuideContentPanel(
                            step:            step,
                            progress:        progress,
                            stepNumber:      index + 1,
                            totalSteps:      sortedSteps.count,
                            referenceImage:  stepImages[step.id],
                            isSpeaking:      isSpeaking,
                            canGoBack:       index > 0,
                            canGoNext:       index < sortedSteps.count - 1 && canAdvanceFrom(index: index),
                            canSkip:         !step.completionRequired && !(progress?.isCompleted ?? false),
                            allRequiredDone: allRequiredDone,
                            distanceM:       distanceM,
                            onPrev:          { navigateTo(index: index - 1) },
                            onNext:          { navigateTo(index: index + 1) },
                            onSkip:          { navigateTo(index: index + 1) },
                            onComplete:      { markComplete(at: index) },
                            onSpeak:         { toggleSpeech(for: step) },
                            onSignOff:       { showSignOff = true }
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

    /// Compact card shown while navigating toward a step (before 0.5m arrival)
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
                distancePill
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
            // Steps are pre-fetched; only need worldmap + reference photo
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
                // No worldmap saved yet — go straight to navigating
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
            // If first step has no AR position, show content panel immediately
            if sortedSteps[0].worldPosition == nil { showContentPanel = true }
        }
    }

    // ── Place 3D pins ─────────────────────────────────────────────────────────

    private func placePins() {
        for (i, step) in sortedSteps.enumerated() {
            guard pinNodes[step.id] == nil,
                  let pos = step.worldPosition else { continue }
            let node = makeGuidePin(number: step.sequenceNumber, isActive: i == 0)
            node.simdPosition = pos
            arManager.sceneView.scene.rootNode.addChildNode(node)
            pinNodes[step.id] = node
        }
    }

    /// Indigo sphere + torus ring + numbered badge billboard — matches GuideStepPlacementView style.
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

        // Number badge billboard
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

    /// Indigo arrow (shaft + arrowhead) with soft glow halo.
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

        // Shaft — SCNCylinder extends along Y; rotate π/2 around X → extends along +Z
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

        // Head — SCNCone tip at +Y; rotate π/2 around X → tip at +Z
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
            // Unplaced step — show content panel immediately (no distance to track)
            if !showContentPanel { showContentPanel = true }
            return
        }

        let camCol = frame.camera.transform.columns.3
        let camPos = simd_float3(camCol.x, camCol.y, camCol.z)
        let dist   = simd_length(targetW - camPos)
        distanceM  = dist

        // Auto-show full content panel on arrival
        if dist <= arrivedM && !showContentPanel { showContentPanel = true }

        // Project to screen for edge chevron
        let sv        = arManager.sceneView
        let projected = sv.projectPoint(SCNVector3(targetW.x, targetW.y, targetW.z))
        let pt        = CGPoint(x: CGFloat(projected.x), y: CGFloat(projected.y))
        targetScreenPos  = pt
        targetIsOnScreen = UIScreen.main.bounds.contains(pt) && projected.z < 1.0

        // Rotate + position 3D floating arrow
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

        // Float 0.7 m ahead of camera, 0.25 m below eye level
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

    // ── Navigation ────────────────────────────────────────────────────────────

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
        // Unplaced steps have no position to walk to — open panel immediately
        if sortedSteps[index].worldPosition == nil { showContentPanel = true }
        let step = sortedSteps[index]
        if stepImages[step.id] == nil { Task { await loadStepImage(for: step) } }
    }

    private func markComplete(at index: Int) {
        guard index < progresses.count else { return }
        progresses[index].complete()
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
        }
    }
}

// ── Guide Content Panel ───────────────────────────────────────────────────────
//
// The floating UI card shown at the bottom of the AR view when the Operator
// arrives at a step (≤ 0.5 m) or the step has no AR position.
// Phase 2 additions: canSkip, distanceM, onSkip.

struct GuideContentPanel: View {

    let step:            GuideStep
    let progress:        GuideStepProgress?
    let stepNumber:      Int
    let totalSteps:      Int
    let referenceImage:  UIImage?
    let isSpeaking:      Bool
    let canGoBack:       Bool
    let canGoNext:       Bool
    let canSkip:         Bool     // true when step is NOT completionRequired and not yet done
    let allRequiredDone: Bool
    let distanceM:       Float?   // shown in header when available

    let onPrev:      () -> Void
    let onNext:      () -> Void
    let onSkip:      () -> Void
    let onComplete:  () -> Void
    let onSpeak:     () -> Void
    let onSignOff:   () -> Void

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

                // Distance pill (compact, inside panel)
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
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 16)

            // ── Step text ─────────────────────────────────────────────────────
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
                            .frame(maxHeight: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .padding(.horizontal, 16)
                    } else if step.mediaPath != nil {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.1))
                            .frame(height: 80)
                            .overlay(ProgressView())
                            .padding(.horizontal, 16)
                    }

                    Spacer(minLength: 12)
                }
            }
            .frame(maxHeight: referenceImage != nil ? 260 : 120)

            Divider().padding(.horizontal, 16)

            // ── Action row ────────────────────────────────────────────────────
            VStack(spacing: 10) {

                // Primary action: Sign Off / Mark Complete / Completed state
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

                // Skip button (non-required steps only, before completion)
                if canSkip {
                    Button(action: onSkip) {
                        Text("Skip this step →")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Prev / Next navigation
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
//
// Collects the Operator's name and submits the completed session atomically.

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
