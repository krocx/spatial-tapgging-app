// ModelARPlacementView.swift - AR OMS: Author 3D Model Placement
//
// Lets the Author position a 3D model in the guide's AR world space so it
// aligns precisely with the real-world component.
//
// One tool at a time (PlacementTools.swift): Move · Lift · Turn · Tilt · Scale.
// Only the active tool's gesture is live, so a scale can never sneak into a
// turn. Turn/Tilt snap softly to 15°; quick actions Flip 180° · Turn 90° ·
// Reset.
//
// On save, PATCHes the step with new modelOffsetX/Y/Z (relative to step pin),
// modelScale and modelRotationX/Y/Z.

import SwiftUI
import ARKit
import SceneKit
import simd

// ── Main placement view ───────────────────────────────────────────────────────

struct ModelARPlacementView: View {

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
    @State private var rotationX: Float       = 0.0   // tilt (pitch)
    @State private var rotationY: Float       = 0.0   // turn (yaw)
    @State private var rotationZ: Float       = 0.0   // roll
    /// Where the model started this session - what Reset returns to.
    @State private var initial:   (position: simd_float3, scale: Float, rot: SCNVector3)? = nil

    // ── Gesture baseline values (captured at gesture begin) ───────────────────

    @State private var panBasePosition: simd_float3 = .zero
    @State private var panDepthZ:       Float       = 0.5    // NDC depth for unproject
    @State private var panStartWorld:   simd_float3 = .zero

    @State private var scaleBase: Float = 1.0
    @State private var rotBase:   SCNVector3 = SCNVector3Zero

    // ── Node & UI state ───────────────────────────────────────────────────────

    @State private var modelNode: SCNNode? = nil
    /// A2 (2026.4.45): live ghost opacity - adjusted here, in context, and
    /// saved with the placement. Seeded from the step's stored value.
    @State private var opacity:   Double   = 0.45
    @State private var phase:     Phase    = .loading
    @State private var isSaving:  Bool     = false
    @State private var error:     String?  = nil
    @State private var tool:      PlacementTool = .move

    enum Phase { case loading, placing }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .bottom) {

            // Full-screen AR + gesture container
            PlacementGestureContainer(
                arManager: arManager,
                tool: tool,
                active: phase == .placing,
                onPanBegan:     handlePanBegan,
                onPanChanged:   handlePanChanged,
                onPanEnded:     {},
                onPinchBegan:   { scaleBase = scale },
                onPinchChanged: handlePinchChanged,
                onPinchEnded:   { _ in }
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

            PlacementToolbar(
                tool: $tool,
                readout: readout,
                onFlip:   { nudgeTurn(.pi) },
                onTurn90: { nudgeTurn(.pi / 2) },
                onReset:  resetTransform
            )
            .padding(.top, 10)
            .padding(.bottom, 6)

            // A2: ghost opacity - live on the node, saved with the placement.
            HStack(spacing: 10) {
                Image(systemName: "circle.lefthalf.filled")
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.7))
                Slider(value: Binding(
                    get: { opacity },
                    set: { newVal in
                        opacity = newVal
                        modelNode?.opacity = CGFloat(newVal)
                    }
                ), in: 0.1...1.0)
                Text("\(Int(opacity * 100))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(width: 38, alignment: .trailing)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 4)

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

    private var readout: String {
        String(format: "%.2f×", scale)
            + "  ·  turn \(PlacementMath.degrees(rotationY))°"
            + "  ·  tilt \(PlacementMath.degrees(rotationX))°"
            + (rotationZ == 0 ? "" : "  ·  roll \(PlacementMath.degrees(rotationZ))°")
    }

    private func applyRotation() {
        modelNode?.eulerAngles = SCNVector3(rotationX, rotationY, rotationZ)
    }

    private func nudgeTurn(_ radians: Float) {
        rotationY = PlacementMath.snap(rotationY + radians)
        applyRotation()
    }

    private func resetTransform() {
        guard let i = initial else { return }
        position = i.position; scale = i.scale
        rotationX = i.rot.x; rotationY = i.rot.y; rotationZ = i.rot.z
        modelNode?.simdWorldPosition = position
        modelNode?.simdScale = simd_float3(scale, scale, scale)
        applyRotation()
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

        // 1. Guide's ARWorldMap via the shared cache (B1) - re-localize into the
        //    Author's coordinate frame.
        if let bundle = await WorldMapCache.load(.guide(guide.id), client: client) {
            arManager.startSessionWithWorldMap(bundle.map)
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
        rotationX = Float(step.modelRotationX ?? 0.0)
        rotationY = Float(step.modelRotationY ?? 0.0)
        rotationZ = Float(step.modelRotationZ ?? 0.0)
        initial   = (position, scale, SCNVector3(rotationX, rotationY, rotationZ))
        opacity   = step.modelOpacity ?? 0.45          // A2: seed the live slider

        // 3. Download model file (USDZ preferred - SCNScene loads it natively on iOS 12+)
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
            ModelNodeStyle.prepare(wrapper, label: "place-in-AR")
            return wrapper
        }.value

        guard let node = builtNode else {
            error = "Failed to load 3D model. The file may be corrupted."
            return
        }

        node.simdWorldPosition = position
        node.simdScale         = simd_float3(scale, scale, scale)
        node.eulerAngles       = SCNVector3(rotationX, rotationY, rotationZ)
        node.opacity           = CGFloat(opacity)

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
        req.modelRotationX = Double(rotationX)
        req.modelRotationY = Double(rotationY)
        req.modelRotationZ = Double(rotationZ)
        req.modelOpacity   = opacity    // A2: adjusted live in this view
        // modelId is not changed here - EditStepSheet owns it

        do {
            _ = try await client.updateGuideStep(guideId: guide.id, stepId: step.id, req: req)
            dismiss()
        } catch {
            self.error = "Save failed: \(error.localizedDescription)"
        }
        isSaving = false
    }

    // ── Drag handlers (Move · Lift · Turn · Tilt) ────────────────────────────

    private func handlePanBegan(_ screenPt: CGPoint) {
        panBasePosition = position
        rotBase = SCNVector3(rotationX, rotationY, rotationZ)
        let sv = arManager.sceneView
        // projectPoint returns SCNVector3 whose .z is the NDC depth (0=near, 1=far)
        let proj = sv.projectPoint(SCNVector3(position.x, position.y, position.z))
        panDepthZ = proj.z
        let worldPt = sv.unprojectPoint(SCNVector3(Float(screenPt.x), Float(screenPt.y), panDepthZ))
        panStartWorld = simd_float3(worldPt.x, worldPt.y, worldPt.z)
    }

    private func handlePanChanged(_ screenPt: CGPoint, _ translation: CGPoint) {
        switch tool {
        case .move, .lift:
            let sv      = arManager.sceneView
            let worldPt = sv.unprojectPoint(SCNVector3(Float(screenPt.x), Float(screenPt.y), panDepthZ))
            let delta = tool == .move
                ? simd_float3(worldPt.x - panStartWorld.x, 0, worldPt.z - panStartWorld.z)   // ground plane
                : simd_float3(0, worldPt.y - panStartWorld.y, 0)                             // up / down
            position = panBasePosition + delta
            modelNode?.simdWorldPosition = position
        case .turn:
            rotationY = PlacementMath.snap(rotBase.y + PlacementMath.dragToRadians(translation.x))
            applyRotation()
        case .tilt:
            // Dominant axis wins so a diagonal drag doesn't tip AND roll.
            if abs(translation.y) >= abs(translation.x) {
                rotationX = PlacementMath.snap(rotBase.x + PlacementMath.dragToRadians(translation.y))
            } else {
                rotationZ = PlacementMath.snap(rotBase.z - PlacementMath.dragToRadians(translation.x))
            }
            applyRotation()
        case .scale:
            break
        }
    }

    // ── Pinch (Scale) ─────────────────────────────────────────────────────────

    private func handlePinchChanged(_ factor: CGFloat) {
        let newScale = max(0.05, min(20.0, scaleBase * Float(factor)))
        scale = newScale
        modelNode?.simdScale = simd_float3(newScale, newScale, newScale)
    }
}
