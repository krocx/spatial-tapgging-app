// ModelARPlacementView.swift — AR OMS: Author 3D Model Placement
//
// Lets the Author position a 3D model in the guide's AR world space so it
// aligns precisely with the real-world component.
//
// Interactions (same as iOS AR Quick Look + vertical mode):
//   1-finger pan     → translate model on XZ plane (H mode) or up/down Y (V mode)
//   H/V button       → toggle between Horizontal and Vertical pan mode
//   2-finger pinch   → uniform scale
//   2-finger rotate  → Y-axis rotation
//
// On save, PATCHes the step with new modelOffsetX/Y/Z (relative to step pin),
// modelScale, and modelRotationY.

import SwiftUI
import ARKit
import SceneKit
import simd

// ── UIViewRepresentable for gesture-enhanced AR container ─────────────────────

struct ARModelGestureContainer: UIViewRepresentable {

    @ObservedObject var arManager: ARSessionManager

    // Pan (1-finger translate)
    var onPanBegan:   ((CGPoint) -> Void)?
    var onPanChanged: ((CGPoint) -> Void)?
    var onPanEnded:   (() -> Void)?

    // Pinch (2-finger scale)
    var onPinchBegan:   (() -> Void)?
    var onPinchChanged: ((CGFloat) -> Void)?
    var onPinchEnded:   ((CGFloat) -> Void)?

    // Rotation (2-finger Y-axis rotate)
    var onRotBegan:   (() -> Void)?
    var onRotChanged: ((CGFloat) -> Void)?
    var onRotEnded:   ((CGFloat) -> Void)?

    // ── Coordinator ───────────────────────────────────────────────────────────

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: ARModelGestureContainer

        init(_ parent: ARModelGestureContainer) { self.parent = parent }

        // All three gesture recognizers run simultaneously
        func gestureRecognizer(
            _ g1: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith g2: UIGestureRecognizer
        ) -> Bool { true }

        @objc func handlePan(_ r: UIPanGestureRecognizer) {
            // Only track 1-finger pans; 2-finger gestures go to pinch/rotate
            guard r.numberOfTouches == 1, let v = r.view else { return }
            let pt = r.location(in: v)
            switch r.state {
            case .began:             parent.onPanBegan?(pt)
            case .changed:           parent.onPanChanged?(pt)
            case .ended, .cancelled: parent.onPanEnded?()
            default: break
            }
        }

        @objc func handlePinch(_ r: UIPinchGestureRecognizer) {
            switch r.state {
            case .began:
                r.scale = 1
                parent.onPinchBegan?()
            case .changed:
                parent.onPinchChanged?(r.scale)
            case .ended, .cancelled:
                parent.onPinchEnded?(r.scale)
            default: break
            }
        }

        @objc func handleRotation(_ r: UIRotationGestureRecognizer) {
            switch r.state {
            case .began:
                r.rotation = 0
                parent.onRotBegan?()
            case .changed:
                parent.onRotChanged?(r.rotation)
            case .ended, .cancelled:
                parent.onRotEnded?(r.rotation)
            default: break
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = arManager.sceneView
        let c = context.coordinator

        let pan = UIPanGestureRecognizer(target: c, action: #selector(Coordinator.handlePan(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.delegate = c
        view.addGestureRecognizer(pan)

        let pinch = UIPinchGestureRecognizer(target: c, action: #selector(Coordinator.handlePinch(_:)))
        pinch.delegate = c
        view.addGestureRecognizer(pinch)

        let rot = UIRotationGestureRecognizer(target: c, action: #selector(Coordinator.handleRotation(_:)))
        rot.delegate = c
        view.addGestureRecognizer(rot)

        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        // Refresh all closure captures so SwiftUI @State is always current
        context.coordinator.parent = self
    }

    // Session is paused by ModelARPlacementView.onDisappear — not here
    static func dismantleUIView(_ uiView: ARSCNView, coordinator: Coordinator) {}
}

// ── Main placement view ───────────────────────────────────────────────────────

struct ModelARPlacementView: View {

    enum PanMode { case horizontal, vertical }

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    let guide: ARGuide
    let step:  GuideStep    // must have worldPosition set
    let model: Model3D      // pre-validated: isReady == true

    // ── AR Manager ────────────────────────────────────────────────────────────

    @StateObject private var arManager = ARSessionManager()

    // ── Transform state ───────────────────────────────────────────────────────

    /// Absolute world-space position of the model (updated live during gestures).
    @State private var position:  simd_float3 = .zero
    @State private var scale:     Float       = 1.0
    @State private var rotationY: Float       = 0.0

    // ── Gesture baseline values (captured at gesture begin) ───────────────────

    @State private var panBasePosition: simd_float3 = .zero
    @State private var panDepthZ:       Float       = 0.5    // NDC depth for unproject
    @State private var panStartWorld:   simd_float3 = .zero

    @State private var scaleBase: Float = 1.0
    @State private var rotYBase:  Float = 0.0

    // ── Node & UI state ───────────────────────────────────────────────────────

    @State private var modelNode: SCNNode? = nil
    @State private var phase:     Phase    = .loading
    @State private var isSaving:  Bool     = false
    @State private var error:     String?  = nil
    @State private var panMode:   PanMode  = .horizontal

    enum Phase { case loading, placing }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .bottom) {

            // Full-screen AR + gesture container
            ARModelGestureContainer(
                arManager: arManager,
                onPanBegan:     handlePanBegan,
                onPanChanged:   handlePanChanged,
                onPanEnded:     handlePanEnded,
                onPinchBegan:   handlePinchBegan,
                onPinchChanged: handlePinchChanged,
                onPinchEnded:   handlePinchEnded,
                onRotBegan:     handleRotBegan,
                onRotChanged:   handleRotChanged,
                onRotEnded:     handleRotEnded
            )
            .ignoresSafeArea()

            // Loading spinner
            if phase == .loading {
                loadingOverlay
            }

            // Gesture hint + save bar (visible once placed)
            if phase == .placing {
                bottomBar
            }
        }
        .overlay(alignment: .top) { topBar }
        .overlay { if isSaving { savingOverlay } }
        .task { await loadAndPlace() }
        .onDisappear {
            modelNode?.removeFromParentNode()
            modelNode = nil
            arManager.pauseSession()
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.leading, 16)

            Spacer()

            VStack(spacing: 2) {
                Text("Place Model")
                    .font(.headline.bold()).foregroundStyle(.white)
                Text(model.name)
                    .font(.caption).foregroundStyle(.white.opacity(0.65))
                    .lineLimit(1)
            }

            Spacer()

            // Mirror for centering
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(.clear)
                .padding(.trailing, 16)
        }
        .padding(.vertical, 10)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Loading overlay ───────────────────────────────────────────────────────

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().scaleEffect(1.2).tint(.white)
                Text("Loading AR session…")
                    .font(.headline).foregroundStyle(.white)
                Text("Loading world map and preparing \(model.name)")
                    .font(.caption).foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
    }

    // ── Bottom bar ────────────────────────────────────────────────────────────

    private var bottomBar: some View {
        VStack(spacing: 0) {
            // Error banner
            if let err = error {
                Text(err)
                    .font(.caption).foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.red.opacity(0.85))
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Hint row + H/V mode toggle
            HStack(alignment: .top, spacing: 16) {
                gestureHint(
                    icon:  panMode == .horizontal ? "hand.draw.fill"    : "arrow.up.and.down",
                    label: panMode == .horizontal ? "Drag\nto move"     : "Drag\nup/down"
                )
                gestureHint(icon: "arrow.up.left.and.arrow.down.right", label: "Pinch\nto scale")
                gestureHint(icon: "rotate.right.fill", label: "Twist\nto rotate")

                // Pan-mode toggle
                Button {
                    panMode = (panMode == .horizontal) ? .vertical : .horizontal
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: panMode == .horizontal
                              ? "arrow.left.and.right" : "arrow.up.and.down")
                            .font(.system(size: 18))
                            .foregroundStyle(.white.opacity(0.9))
                        Text(panMode == .horizontal ? "H" : "V")
                            .font(.system(size: 10).bold())
                            .foregroundStyle(.white.opacity(0.75))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(panMode == .horizontal
                                ? Color.white.opacity(0.12)
                                : Color.indigo.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 6)

            // Scale / rotation readout
            HStack(spacing: 24) {
                Label("\(String(format: "%.2f", scale))×", systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(.caption).foregroundStyle(.white.opacity(0.7))
                Label("\(Int(rotationY * 180 / .pi))°", systemImage: "rotate.right")
                    .font(.caption).foregroundStyle(.white.opacity(0.7))
            }
            .padding(.bottom, 8)

            // Save button
            Button {
                Task { await savePlacement() }
            } label: {
                Label("Save Placement", systemImage: "checkmark.circle.fill")
                    .font(.headline.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.indigo)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isSaving)
            .padding(.horizontal, 16)
            .padding(.bottom, 34)   // safe area buffer
        }
        .background(.ultraThinMaterial)
        .animation(.easeInOut(duration: 0.2), value: error)
    }

    private func gestureHint(icon: String, label: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(.white.opacity(0.8))
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
    }

    // ── Saving overlay ────────────────────────────────────────────────────────

    private var savingOverlay: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().scaleEffect(1.3).tint(.white)
                Text("Saving placement…")
                    .font(.headline).foregroundStyle(.white)
            }
        }
    }

    // ── Load world map + download + place model ───────────────────────────────

    private func loadAndPlace() async {
        let client = SIBClient(settings: settings)

        // 1. Download guide's ARWorldMap (re-localize into Author's session coordinate frame)
        if let mapData = try? await client.fetchGuideWorldMap(guideId: guide.id) {
            arManager.startSessionWithWorldMap(mapData)
        } else {
            arManager.startSession()
        }
        arManager.disableQRScanning()

        // 2. Initialize transform from step's current values
        let pinPos = step.worldPosition ?? simd_float3(0, 0, -0.5)
        position  = simd_float3(
            pinPos.x + Float(step.modelOffsetX  ?? 0),
            pinPos.y + Float(step.modelOffsetY  ?? 0),
            pinPos.z + Float(step.modelOffsetZ  ?? 0)
        )
        scale     = Float(step.modelScale     ?? 1.0)
        rotationY = Float(step.modelRotationY ?? 0.0)

        // 3. Download model file (USDZ preferred — SCNScene loads it natively on iOS 12+)
        let ext:  String
        let data: Data?
        if model.hasUSDZ {
            data = try? await client.downloadModelUSDZ(id: model.id)
            ext  = "usdz"
        } else {
            data = try? await client.downloadModelGLB(id: model.id)
            ext  = "glb"
        }

        guard let data else {
            error = "Failed to download model file. Check network connection."
            return
        }

        // 4. Write to temp file
        let cacheDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ar-oms-placement", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let fileURL = cacheDir.appendingPathComponent("\(model.id).\(ext)")
        guard (try? data.write(to: fileURL)) != nil else {
            error = "Failed to cache model file."
            return
        }

        // 5. Build and place node (off-main so SceneKit parsing doesn't block UI)
        let builtNode: SCNNode? = await Task.detached(priority: .utility) { () -> SCNNode? in
            guard let scene = try? SCNScene(url: fileURL, options: [
                SCNSceneSource.LoadingOption.checkConsistency: false,
                SCNSceneSource.LoadingOption.flattenScene: false,
            ]) else { return nil }
            let children = scene.rootNode.childNodes
            guard !children.isEmpty else { return nil }
            let wrapper = SCNNode()
            wrapper.name = "placement_model"
            children.forEach { wrapper.addChildNode($0.clone()) }
            return wrapper
        }.value

        guard let node = builtNode else {
            error = "Failed to load 3D model. The file may be corrupted."
            return
        }

        node.simdWorldPosition = position
        node.simdScale         = simd_float3(scale, scale, scale)
        node.eulerAngles       = SCNVector3(0, rotationY, 0)

        arManager.sceneView.scene.rootNode.addChildNode(node)
        modelNode = node
        phase = .placing
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    private func savePlacement() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)

        // Compute offsets relative to the step's pin position
        let pinPos = step.worldPosition ?? .zero
        var req = UpdateGuideStepRequest()
        req.modelOffsetX   = Double(position.x - pinPos.x)
        req.modelOffsetY   = Double(position.y - pinPos.y)
        req.modelOffsetZ   = Double(position.z - pinPos.z)
        req.modelScale     = Double(scale)
        req.modelRotationY = Double(rotationY)
        // modelId and modelOpacity are not changed here — EditStepSheet owns those

        do {
            _ = try await client.updateGuideStep(guideId: guide.id, stepId: step.id, req: req)
            dismiss()
        } catch {
            self.error = "Save failed: \(error.localizedDescription)"
        }
        isSaving = false
    }

    // ── Pan handlers (1-finger translate) ────────────────────────────────────

    private func handlePanBegan(_ screenPt: CGPoint) {
        panBasePosition = position
        let sv = arManager.sceneView
        // projectPoint returns SCNVector3 whose .z is the NDC depth (0=near, 1=far)
        let proj = sv.projectPoint(SCNVector3(position.x, position.y, position.z))
        panDepthZ = proj.z  // Float
        // Unproject the finger's starting screen point at the node's depth
        let worldPt = sv.unprojectPoint(SCNVector3(Float(screenPt.x), Float(screenPt.y), panDepthZ))
        panStartWorld = simd_float3(worldPt.x, worldPt.y, worldPt.z)
    }

    private func handlePanChanged(_ screenPt: CGPoint) {
        let sv      = arManager.sceneView
        let worldPt = sv.unprojectPoint(SCNVector3(Float(screenPt.x), Float(screenPt.y), panDepthZ))
        let delta: simd_float3
        switch panMode {
        case .horizontal:
            // Lock Y — move on the XZ ground plane only
            delta = simd_float3(
                worldPt.x - panStartWorld.x,
                0,
                worldPt.z - panStartWorld.z
            )
        case .vertical:
            // Lock XZ — move up/down (Y axis) only
            delta = simd_float3(
                0,
                worldPt.y - panStartWorld.y,
                0
            )
        }
        let newPos = panBasePosition + delta
        position = newPos
        modelNode?.simdWorldPosition = newPos
    }

    private func handlePanEnded() {
        // position is already committed in handlePanChanged
    }

    // ── Pinch handlers (scale) ────────────────────────────────────────────────

    private func handlePinchBegan() {
        scaleBase = scale
    }

    private func handlePinchChanged(_ factor: CGFloat) {
        let newScale = max(0.05, min(20.0, scaleBase * Float(factor)))
        scale = newScale
        modelNode?.simdScale = simd_float3(newScale, newScale, newScale)
    }

    private func handlePinchEnded(_ factor: CGFloat) {
        // scale already committed
    }

    // ── Rotation handlers (Y-axis) ────────────────────────────────────────────

    private func handleRotBegan() {
        rotYBase = rotationY
    }

    private func handleRotChanged(_ rotation: CGFloat) {
        let newRot = rotYBase + Float(rotation)
        rotationY = newRot
        modelNode?.eulerAngles = SCNVector3(0, newRot, 0)
    }

    private func handleRotEnded(_ rotation: CGFloat) {
        // rotationY already committed
    }
}
