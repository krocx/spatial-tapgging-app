// AssemblyPlacementView.swift - AR OJT slice 3: place the whole assembly once.
//
// The author never places steps for an imported guide. The assembly ghost
// follows a reticle on the detected surface (bottom-centre of the geometry on
// the surface, facing the author); ONE tap ("Place here") saves the pose - the
// server derives every CAD step's pin from it. Then one tool at a time
// (PlacementTools.swift): Move slides on the surface · Turn spins it · Scale
// pinches. "Done" re-saves if anything moved.
//
// Frame: same convention as Place Steps / Place Model - the guide's world map
// frame when one exists (session relocalizes into it), else a fresh session
// whose map is uploaded with the first save so operators can relocalize.
//
// Sources: 'tap' here; 'config' is applied by the server at import when the
// chamber configuration already knows the pose; PartFrame will add its own.

import SwiftUI
import ARKit
import SceneKit
import simd

struct AssemblyPlacementView: View {

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    let guide: ARGuide
    let steps: [GuideStep]
    /// Called with the updated guide after a successful save.
    var onPlaced: ((ARGuide) -> Void)? = nil

    @StateObject private var arManager = ARSessionManager()

    enum Phase { case loading, aiming, placed, failed }
    @State private var phase: Phase = .loading
    @State private var status = "Loading assembly…"
    @State private var errorText: String? = nil

    // Assembly
    @State private var assemblyNode: AssemblyNode? = nil
    /// The one in-flight load. It runs unstructured so SwiftUI cancelling and
    /// re-firing `.task` (which it does when this cover is presented straight
    /// after the scan gate closes) cannot cancel the download underneath it.
    @State private var loadTask: Task<Void, Never>? = nil
    /// Bounds in the model's own frame; bottom-centre / size are derived per
    /// orientation (an upside-down model stands on what was its top).
    @State private var boundsMin: simd_float3 = .zero
    @State private var boundsMax: simd_float3 = .zero
    /// The model's "which way is up" before yaw: a CAD export that arrives on
    /// its side or upside down is fixed here, once, by the author.
    @State private var upright: UprightOrientation = .asImported
    /// The point of the model that sits on the tapped surface: bottom-centre
    /// (default), the model's own origin, or the centre - the portal's
    /// "origin" default on the model record.
    @State private var originRule: String = "bottomCentre"
    private var size: simd_float3 { let (lo, hi) = upright.bounds(min: boundsMin, max: boundsMax); return hi - lo }
    /// The anchor point after the upright rotation - what sits on the surface.
    private var bottomCentre: simd_float3 {
        let (lo, hi) = upright.bounds(min: boundsMin, max: boundsMax)
        switch originRule {
        case "modelOrigin": return .zero
        case "centre":      return (lo + hi) / 2
        default:            return simd_float3((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2)
        }
    }
    @State private var hadWorldMap = false

    // Pose (anchor frame)
    @State private var surfacePoint: simd_float3? = nil     // where the bottom-centre sits
    @State private var yaw: Float = 0
    @State private var scale: Float = 1
    @State private var dirty = false
    @State private var isSaving = false

    // Step preview (author checks the animation and sets its speed)
    @State private var previewOn = false
    @State private var previewIndex = 0
    @State private var speed: Double = 0.5
    @State private var speedDirty = false
    @State private var previewTask: Task<Void, Never>? = nil
    private var engine: AssemblyStateEngine { AssemblyStateEngine(initial: guide.assembly?.initialNodes, steps: steps) }

    // Gesture baselines
    @State private var panBase: simd_float3 = .zero
    @State private var panDepth: Float = 0.5
    @State private var panStartWorld: simd_float3 = .zero
    @State private var scaleBase: Float = 1
    @State private var yawBase: Float = 0
    @State private var tool: PlacementTool = .move

    private let reticleTimer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .bottom) {
            PlacementGestureContainer(
                arManager: arManager, tool: tool, active: phase == .placed,
                onPanBegan: panBegan, onPanChanged: panChanged, onPanEnded: {},
                onPinchBegan: { scaleBase = scale }, onPinchChanged: pinchChanged, onPinchEnded: { _ in }
            )
            .ignoresSafeArea()

            if phase == .aiming { reticle }
            bottomBar
        }
        .overlay(alignment: .top) { topBar }
        .overlay { if isSaving { savingOverlay } }
        .task {
            // A re-fired `.task` joins the running load instead of starting (or
            // cancelling) one; a fresh load starts only when nothing is loaded
            // and nothing is in flight.
            if let running = loadTask, !running.isCancelled {
                await running.value
                if assemblyNode != nil || phase == .failed { return }
            }
            let t = Task { @MainActor in await load() }
            loadTask = t
            await t.value
        }
        .onReceive(reticleTimer) { _ in if phase == .aiming { followReticle() } }
        .onDisappear {
            loadTask?.cancel()
            previewTask?.cancel()
            assemblyNode?.cancelPlayback()
            assemblyNode?.root.isHidden = true      // see ARGuideSessionView.teardownAssembly
            arManager.pauseSession()
        }
    }

    // MARK: - UI

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundStyle(.white.opacity(0.85))
            }.padding(.leading, 16)
            Spacer()
            VStack(spacing: 2) {
                Text("Place Assembly").font(.headline.bold()).foregroundStyle(.white)
                Text(guide.name).font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
            }
            Spacer()
            Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundStyle(.clear).padding(.trailing, 16)
        }
        .padding(.vertical, 10).padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    /// Which way is up. Each choice re-seats the model on the surface.
    private var tiltMenu: some View {
        Menu {
            ForEach(UprightOrientation.allCases) { u in
                Button { upright = u; dirty = true; applyPose() } label: {
                    if u == upright { Label(u.label, systemImage: "checkmark") } else { Text(u.label) }
                }
            }
        } label: {
            Label(upright == .asImported ? "Tilt" : upright.label, systemImage: "arrow.up.arrow.down")
                .font(.system(size: 12, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .background(Color.white.opacity(upright == .asImported ? 0.10 : 0.22))
                .foregroundStyle(.white).clipShape(Capsule())
        }
    }

    private var reticle: some View {
        VStack {
            Spacer()
            ZStack {
                Circle().stroke(Color.white.opacity(0.9), lineWidth: 2).frame(width: 44, height: 44)
                Circle().fill(Color.white.opacity(0.9)).frame(width: 6, height: 6)
            }
            .shadow(radius: 4)
            Spacer()
        }
        .allowsHitTesting(false)
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if let e = errorText {
                Text(e).font(.caption).foregroundStyle(.red).multilineTextAlignment(.center).padding(.horizontal)
            }
            Text(status).font(.subheadline).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center).padding(.horizontal)

            if phase == .placed {
                PlacementToolbar(
                    tool: $tool, tools: [.move, .turn, .scale],
                    readout: String(format: "%.2f×", scale) + "  ·  turn \(PlacementMath.degrees(yaw))°"
                        + (size == .zero ? "" : String(format: "  ·  %.2f × %.2f × %.2f m", size.x * scale, size.y * scale, size.z * scale)),
                    onTurn90: { yaw = PlacementMath.snap(yaw + .pi / 2); dirty = true; applyPose() },
                    tiltMenu: AnyView(tiltMenu)
                )
            }

            if phase == .placed { previewBar }

            HStack(spacing: 12) {
                if phase == .aiming {
                    Button { Task { await placeHere() } } label: {
                        Label("Place here", systemImage: "arkit").font(.headline.bold())
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(surfacePoint == nil ? Color.gray : Color.indigo).foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(surfacePoint == nil)
                } else if phase == .placed {
                    Button {
                        previewTask?.cancel(); assemblyNode?.cancelPlayback(); assemblyNode?.apply(state: [:])
                        assemblyNode?.root.opacity = 0.6
                        phase = .aiming; status = "Aim at the surface and tap Place here"
                    } label: {
                        Label("Re-aim", systemImage: "scope").font(.subheadline.bold())
                            .padding(.vertical, 14).padding(.horizontal, 16)
                            .background(Color.white.opacity(0.15)).foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    if scale != 1 {
                        Button { scale = 1; applyPose(); dirty = true } label: {
                            Text("1×").font(.subheadline.bold()).padding(.vertical, 14).padding(.horizontal, 14)
                                .background(Color.white.opacity(0.15)).foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    Button { Task { await done() } } label: {
                        Label(dirty ? "Save & Done" : "Done", systemImage: "checkmark.circle.fill").font(.headline.bold())
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Color.green).foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                } else if phase == .failed {
                    Button { phase = .loading; errorText = nil; Task { await load() } } label: {
                        Text("Retry").font(.headline.bold()).frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Color.indigo).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    Button { dismiss() } label: {
                        Text("Close").font(.headline.bold()).padding(.vertical, 14).padding(.horizontal, 18)
                            .background(Color.gray).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                } else {
                    ProgressView().tint(.white).padding(.vertical, 10)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
        .padding(.top, 12)
        .background(.ultraThinMaterial)
    }

    /// Step-by-step animation preview + playback speed, saved with the guide.
    private var previewBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Toggle(isOn: $previewOn) { Text("Preview steps").font(.subheadline.bold()).foregroundStyle(.white) }
                    .toggleStyle(.switch).tint(.indigo)
                    .onChange(of: previewOn) { on in
                        if on { previewIndex = 0; playPreview() } else { stopPreview() }
                    }
                if previewOn {
                    Spacer()
                    Button { previewIndex = max(0, previewIndex - 1); playPreview() } label: { Image(systemName: "chevron.left.circle.fill").font(.title2) }
                        .disabled(previewIndex == 0)
                    Text("\(previewIndex + 1) / \(max(1, steps.count))").font(.caption.monospacedDigit()).foregroundStyle(.white).frame(minWidth: 52)
                    Button { previewIndex = min(steps.count - 1, previewIndex + 1); playPreview() } label: { Image(systemName: "chevron.right.circle.fill").font(.title2) }
                        .disabled(previewIndex >= steps.count - 1)
                    Button { playPreview() } label: { Image(systemName: "arrow.counterclockwise.circle.fill").font(.title2) }
                }
            }
            .foregroundStyle(.white)
            if previewOn, previewIndex < steps.count {
                Text(steps[previewIndex].displayTitle).font(.caption).foregroundStyle(.white.opacity(0.8)).lineLimit(2).multilineTextAlignment(.center)
            }
            HStack(spacing: 8) {
                Image(systemName: "tortoise.fill").font(.caption).foregroundStyle(.white.opacity(0.7))
                Slider(value: $speed, in: 0.1 ... 2.0, step: 0.05) { _ in speedDirty = true; dirty = true; if previewOn { playPreview() } }
                    .tint(.indigo)
                Image(systemName: "hare.fill").font(.caption).foregroundStyle(.white.opacity(0.7))
                Text(String(format: "%.2f×", speed)).font(.caption.monospacedDigit()).foregroundStyle(.white).frame(width: 48)
            }
        }
        .padding(.horizontal, 16)
    }

    private func playPreview() {
        guard let node = assemblyNode, previewOn, previewIndex < steps.count else { return }
        previewTask?.cancel()
        let eng = engine
        node.apply(state: eng.state(after: previewIndex - 1))
        let dur = node.play(deltas: eng.deltas(at: previewIndex), speed: speed)
        node.focus(parts: node.visibleFocus(eng.focusParts(at: previewIndex)))
        node.setViewHint(steps[previewIndex].view)      // blue camera = where the source viewed this step from
        previewTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64((dur + 2.0) * 1_000_000_000))
            guard !Task.isCancelled, previewOn else { return }
            playPreview()
        }
    }

    private func stopPreview() {
        previewTask?.cancel(); previewTask = nil
        guard let node = assemblyNode else { return }
        node.focus(parts: [])
        node.setViewHint(nil)
        node.apply(state: [:])            // whole assembly, rest pose, solid
    }

    private var savingOverlay: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) { ProgressView().scaleEffect(1.3).tint(.white); Text("Saving placement…").font(.headline).foregroundStyle(.white) }
        }
    }

    // MARK: - Load

    private func load() async {
        // Single-flight is guaranteed by `loadTask`; this guard only protects
        // against a load after the node exists (the "duplicate assembly" on re-aim).
        guard assemblyNode == nil else {
            AppLog.warn("assembly", "placement load() called with a node present - ignored"); return
        }
        let client = SIBClient(settings: settings)
        guard let asm = guide.assembly else { phase = .failed; errorText = "This guide has no assembly model."; return }

        // Session frame - the guide's map when it has one.
        if let bundle = await WorldMapCache.load(.guide(guide.id), client: client) {
            arManager.startSessionWithWorldMap(bundle.map); hadWorldMap = true
        } else {
            arManager.startSession()
        }
        arManager.disableQRScanning()

        status = "Downloading assembly…"
        let data: Data
        let deviceBudget = GLBLoadOptions.forThisDevice().triangleBudget
        do {
            let f = try await AssemblyModelCache.glb(modelId: asm.modelId, budget: deviceBudget, client: client)
            data = f.data
            if let vb = f.variantBudget { AppLog.info("assembly", "server variant \(vb) (\(f.triangles ?? 0) tris) for budget \(deviceBudget)") }
        }
        catch {
            // A cancelled load (view dismissed mid-download) is not a failure
            // the author can act on - never show it as one.
            if Task.isCancelled || AssemblyModelCache.isCancellation(error) { return }
            phase = .failed; errorText = "Could not download the assembly model - \(AssemblyModelCache.reason(error))"; return
        }
        if Task.isCancelled { return }
        status = "Building assembly…"
        let opts: GLBLoadOptions = {
            var o = GLBLoadOptions.forThisDevice()
            o.progress = { p in Task { @MainActor in status = "Building assembly… \(Int(p * 10) * 10)%" } }
            return o
        }()
        let built: GLBAssembly? = await Task.detached(priority: .userInitiated) { try? GLBLoader.load(data: data, options: opts) }.value
        guard let glb = built, !glb.parts.isEmpty else {
            phase = .failed; errorText = "The assembly model could not be read."; return
        }
        if glb.info.reduced { status = glb.info.summary }
        let node = AssemblyNode(assembly: glb)
        // Show the complete assembly, ghosted, while aiming.
        node.root.opacity = 0.6
        if let b = asm.bounds { boundsMin = simd_float3(Float(b.min[0]), Float(b.min[1]), Float(b.min[2])); boundsMax = simd_float3(Float(b.max[0]), Float(b.max[1]), Float(b.max[2])) }
        else if let b = glb.bounds { boundsMin = b.min; boundsMax = b.max }
        // Never two assemblies in one scene: drop any stale root first.
        for stale in arManager.sceneView.scene.rootNode.childNodes where stale.name == "assembly" { stale.removeFromParentNode() }
        node.root.isHidden = true                 // shown by followReticle on the first surface hit / by applyPose
        assemblyNode = node
        arManager.sceneView.scene.rootNode.addChildNode(node.root)

        // Model defaults from the portal preview (scale, which way is up, origin).
        if let rec = try? await client.fetchModel(id: asm.modelId) {
            if let o = rec.defaultOrigin { originRule = o }
            if asm.pose == nil {
                if let u = rec.defaultOrientation.flatMap({ UprightOrientation(rawValue: $0) }) { upright = u }
                if let ds = rec.defaultScale, ds > 0 { scale = Float(ds) }
            }
        }
        // Existing pose → start in "placed" so the author can nudge.
        speed = asm.effectiveAnimationSpeed
        if let p = asm.pose {
            scale = Float(p.scale ?? 1)
            // The saved rotation is yaw · upright; recover both.
            let (u, y) = UprightOrientation.decompose(p.simdRotation)
            upright = u; yaw = y
            // pose.position is the model origin; recover the surface point (bottom-centre)
            surfacePoint = p.simdPosition + simd_act(p.simdRotation, bottomCentreInModel() * scale)
            applyPose()
            node.root.opacity = 1
            node.root.isHidden = false
            phase = .placed
            status = "Assembly placed (\(p.source)). Adjust if needed, then Done."
        } else {
            phase = .aiming
            status = "Aim the circle at the surface where the equipment stands, then tap Place here"
        }
        AppLog.info("assembly", "placement view ready parts=\(glb.parts.count) tris=\(glb.triangleCount) map=\(hadWorldMap)")
    }

    // MARK: - Aiming

    private func followReticle() {
        let sv = arManager.sceneView
        let centre = CGPoint(x: sv.bounds.midX, y: sv.bounds.midY)
        guard let q = sv.raycastQuery(from: centre, allowing: .estimatedPlane, alignment: .horizontal),
              let hit = sv.session.raycast(q).first else {
            surfacePoint = nil; assemblyNode?.root.isHidden = true; return
        }
        let t = hit.worldTransform
        let p = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        surfacePoint = p
        if let cam = sv.pointOfView?.simdWorldPosition {
            yaw = atan2(cam.x - p.x, cam.z - p.z)      // assembly +Z faces the author
        }
        assemblyNode?.root.isHidden = false
        applyPose()
    }

    /// Root transform from (surfacePoint, upright, yaw, scale): the rotated
    /// bottom-centre on the surface. Rotation = yaw about Y · upright.
    private func applyPose() {
        guard let node = assemblyNode, let p = surfacePoint else { return }
        let q = simd_quatf(angle: yaw, axis: simd_float3(0, 1, 0)) * upright.quaternion
        let origin = p - simd_act(q, bottomCentreInModel() * scale)
        node.root.simdPosition = origin
        node.root.simdOrientation = q
        node.root.simdScale = simd_float3(repeating: scale)
    }

    /// The point of the model (in its own frame) that lands on the surface.
    private func bottomCentreInModel() -> simd_float3 {
        // bottomCentre is expressed after the upright rotation; undo it.
        simd_act(upright.quaternion.inverse, bottomCentre)
    }

    private func rotateY(_ v: simd_float3, _ a: Float) -> simd_float3 {
        simd_float3(cos(a) * v.x + sin(a) * v.z, v.y, -sin(a) * v.x + cos(a) * v.z)
    }

    private func currentPose() -> AssemblyPose? {
        guard let p = surfacePoint else { return nil }
        let q = simd_quatf(angle: yaw, axis: simd_float3(0, 1, 0)) * upright.quaternion
        let origin = p - simd_act(q, bottomCentreInModel() * scale)
        return AssemblyPose(position: origin, rotation: q, scale: scale == 1 ? nil : Double(scale), source: "tap")
    }

    // MARK: - Place / save

    private func placeHere() async {
        guard surfacePoint != nil else { return }
        assemblyNode?.root.opacity = 1
        phase = .placed
        if previewOn { playPreview() }          // re-aim paused the loop
        await save()
        status = "Placed - every step now follows the assembly. Adjust if needed, then Done."
    }

    private func done() async {
        if dirty { await save() }
        dismiss()
    }

    private func save() async {
        guard let pose = currentPose() else { return }
        isSaving = true; errorText = nil
        let client = SIBClient(settings: settings)
        do {
            var updated = try await client.setAssemblyPose(guideId: guide.id, pose: pose)
            if speedDirty { updated = try await client.setAssemblyAnimationSpeed(guideId: guide.id, speed: speed); speedDirty = false }
            dirty = false
            // A fresh session has no saved map yet - upload it so operators (and
            // Place Steps) relocalize into the same frame this pose lives in.
            if !hadWorldMap, let mapData = await arManager.saveCurrentWorldMap() {
                let photo = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
                do {
                    try await client.uploadGuideWorldMap(guideId: guide.id, mapData: mapData, referencePhotoData: photo)
                    if let meta = try? await client.fetchGuideWorldMapMeta(guideId: guide.id) {
                        WorldMapCache.store(.guide(guide.id), map: mapData, meta: meta)
                    }
                    hadWorldMap = true
                } catch {
                    AppLog.warn("assembly", "World map upload failed (non-fatal): \(error)")
                }
            }
            onPlaced?(updated)
            AppLog.info("assembly", "pose saved source=tap steps=\(steps.count)")
        } catch {
            errorText = "Save failed: \(error.localizedDescription)"
        }
        isSaving = false
    }

    // MARK: - Gestures (only after placement)

    private func panBegan(_ pt: CGPoint) {
        guard phase == .placed, let p = surfacePoint else { return }
        panBase = p; yawBase = yaw
        let sv = arManager.sceneView
        panDepth = sv.projectPoint(SCNVector3(p)).z
        let w = sv.unprojectPoint(SCNVector3(Float(pt.x), Float(pt.y), panDepth))
        panStartWorld = simd_float3(w)
    }
    private func panChanged(_ pt: CGPoint, _ translation: CGPoint) {
        guard phase == .placed else { return }
        if tool == .turn {
            yaw = PlacementMath.snap(yawBase + PlacementMath.dragToRadians(translation.x)); dirty = true; applyPose()
            return
        }
        let sv = arManager.sceneView
        let w = simd_float3(sv.unprojectPoint(SCNVector3(Float(pt.x), Float(pt.y), panDepth)))
        surfacePoint = panBase + simd_float3(w.x - panStartWorld.x, 0, w.z - panStartWorld.z)
        dirty = true; applyPose()
    }
    private func pinchChanged(_ f: CGFloat) {
        guard phase == .placed else { return }
        scale = max(0.05, min(20, scaleBase * Float(f))); dirty = true; applyPose()
    }
}
