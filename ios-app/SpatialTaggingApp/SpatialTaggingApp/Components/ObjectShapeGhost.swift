// ObjectShapeGhost.swift — B3 (2026.4.46): a library 3D model as a ghost ON
// the detected chamber.
//
// Why: a reference object is an invisible point cloud. When the app says
// "chamber recognised", nothing on screen proves WHERE it thinks the chamber
// is. Attaching the chamber's own 3D model (from the library) as a translucent
// ghost at the detected pose makes recognition — and every B2e re-alignment —
// visible at a glance: if the ghost sits on the metal, the frame is right.
//
//   ObjectShapeGhost      SceneKit node = objectPose × shapeModelPose, scaled;
//                         `flash()` shows it for a few seconds after a
//                         recognition / re-align, then fades (never clutters)
//   ShapeModelPicker      choose a USDZ-ready model from the anchor's kit
//   ObjectModelAlignView  one-time alignment: drag / pinch / twist the ghost
//                         onto the real chamber, Save → shapeModelPose in the
//                         object's frame (survives merges, not fresh re-scans)

import SwiftUI
import SceneKit
import ARKit
import simd

// ── Ghost renderer ───────────────────────────────────────────────────────────

@MainActor
final class ObjectShapeGhost {
    private let sceneView: ARSCNView
    private(set) var node: SCNNode? = nil
    private var poseInObject: simd_float4x4
    private var scale: Float
    private var baseOpacity: CGFloat
    private var loading = false

    init(sceneView: ARSCNView, meta: AnchorObjectMeta, opacity: CGFloat = 0.35) {
        self.sceneView    = sceneView
        self.poseInObject = meta.shapeModelPoseTransform
        self.scale        = meta.shapeModelScale ?? 1
        self.baseOpacity  = opacity
    }

    /// Download (cached in tmp) and build the node. Idempotent.
    func load(modelId: String, client: SIBClient) async {
        guard node == nil, !loading else { return }
        loading = true
        defer { loading = false }
        guard let url = await ObjectShapeGhost.cachedUSDZ(modelId: modelId, client: client) else { return }
        let built: SCNNode? = await Task.detached(priority: .utility) { () -> SCNNode? in
            guard let scene = try? SCNScene(url: url, options: [
                SCNSceneSource.LoadingOption.checkConsistency: false,
                SCNSceneSource.LoadingOption.flattenScene:     false,
            ]) else { return nil }
            let w = SCNNode(); w.name = "shape-ghost"
            scene.rootNode.childNodes.forEach { w.addChildNode($0.clone()) }
            return w
        }.value
        guard let built else { return }
        built.opacity = 0
        built.enumerateHierarchy { n, _ in
            n.geometry?.materials.forEach { m in
                m.lightingModel = .constant
                m.emission.contents = UIColor.systemIndigo.withAlphaComponent(0.25)
                m.writesToDepthBuffer = false
                m.readsFromDepthBuffer = true
            }
        }
        sceneView.scene.rootNode.addChildNode(built)
        node = built
    }

    static func cachedUSDZ(modelId: String, client: SIBClient) async -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("shape-\(modelId).usdz")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        guard let data = try? await client.downloadModelUSDZ(id: modelId) else { return nil }
        do { try data.write(to: url, options: .atomic); return url } catch { return nil }
    }

    /// Place at the object's current pose (session world frame).
    func update(objectTransform: simd_float4x4?) {
        guard let node, let objT = objectTransform else { return }
        SCNTransaction.begin(); SCNTransaction.animationDuration = 0.25
        node.simdWorldTransform = objT * poseInObject
        node.simdScale = simd_float3(repeating: scale)
        SCNTransaction.commit()
    }

    func setPose(_ p: simd_float4x4, scale s: Float) { poseInObject = p; scale = s }

    /// Recognition / re-align moment: show for `seconds`, then fade out.
    func flash(seconds: TimeInterval = 6) {
        guard let node else { return }
        node.removeAllActions()
        node.runAction(.sequence([.fadeOpacity(to: baseOpacity, duration: 0.3), .wait(duration: seconds), .fadeOpacity(to: 0, duration: 1.0)]))
    }

    func show() { node?.removeAllActions(); node?.opacity = baseOpacity }
    func hide() { node?.removeAllActions(); node?.opacity = 0 }
    func remove() { node?.removeFromParentNode(); node = nil }
}

// ── Picker ───────────────────────────────────────────────────────────────────

struct ShapeModelPicker: View {
    let anchorId: String
    let current: String?
    let onPick: (Model3D?) -> Void
    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @State private var models: [Model3D] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            List {
                if loading { ProgressView("Loading library…") }
                else if models.isEmpty {
                    Text("No USDZ-ready models in this chamber's kit. Upload one on the portal (3D Models) and assign it to the chamber.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(models) { m in
                    Button {
                        onPick(m); dismiss()
                    } label: {
                        HStack {
                            Image(systemName: "cube.transparent").foregroundStyle(.indigo)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.name).foregroundStyle(.primary)
                                Text(m.originalFilename).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if m.id == current { Image(systemName: "checkmark").foregroundStyle(.indigo) }
                        }
                    }
                }
                if current != nil {
                    Button(role: .destructive) { onPick(nil); dismiss() } label: { Label("Remove shape model", systemImage: "trash") }
                }
            }
            .navigationTitle("Shape model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                let all = (try? await SIBClient(settings: settings).fetchModels(anchorId: anchorId)) ?? []
                models = all.filter { $0.hasUSDZ || $0.usdzStatus == "ready" }
                loading = false
            }
        }
    }
}

// ── Align view ───────────────────────────────────────────────────────────────

struct ObjectModelAlignView: View {
    let anchor: Anchor
    let meta: AnchorObjectMeta
    let modelId: String
    let onDone: (AnchorObjectMeta?) -> Void

    @EnvironmentObject private var settings: AppSettings
    @StateObject private var arManager = ARSessionManager()
    @State private var ghost: ObjectShapeGhost? = nil
    @State private var pose:  simd_float4x4 = matrix_identity_float4x4
    @State private var scale: Float = 1
    @State private var lift:  Float = 0
    @State private var detected = false
    @State private var isSaving = false
    @State private var error: String? = nil
    @State private var searchStart = Date()

    var body: some View {
        ZStack {
            ARContainerView(arManager: arManager).ignoresSafeArea()

            VStack {
                VStack(spacing: 4) {
                    Text(detected ? "Fit the model onto the chamber" : "Point at the chamber")
                        .font(.title3.bold()).foregroundStyle(.white)
                    Text(detected
                         ? "Drag to slide · pinch to scale · twist to turn · slider to lift. Save when it sits on the metal."
                         : "The ghost appears the moment the chamber is recognised.")
                        .font(.footnote).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                }
                .padding(16).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 60).padding(.horizontal, 24)

                Spacer()

                VStack(spacing: 12) {
                    if !detected {
                        ObjectFinderCard(title: "Finding the chamber…", startedAt: searchStart, objectMeta: meta)
                    } else {
                        HStack(spacing: 10) {
                            Text("Lift").font(.caption.bold()).foregroundStyle(.white.opacity(0.7))
                            Slider(value: Binding(get: { Double(lift) }, set: { lift = Float($0); applyPose() }), in: -0.5...0.5).tint(.indigo)
                            Text(String(format: "%+.2f m", lift)).font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.85)).frame(width: 64, alignment: .trailing)
                        }
                        HStack(spacing: 10) {
                            Text("Scale").font(.caption.bold()).foregroundStyle(.white.opacity(0.7))
                            Slider(value: Binding(get: { Double(scale) }, set: { scale = Float($0); applyPose() }), in: 0.2...5.0).tint(.indigo)
                            Text(String(format: "×%.2f", scale)).font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.85)).frame(width: 64, alignment: .trailing)
                        }
                    }
                    if let error { Text(error).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center) }
                    HStack(spacing: 10) {
                        Button("Cancel") { arManager.pauseSession(); onDone(nil) }
                            .font(.subheadline.bold()).foregroundStyle(.white.opacity(0.85))
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                        if detected {
                            Button { resetPose() } label: {
                                Text("Reset").font(.subheadline.bold()).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                            }
                            Button { Task { await save() } } label: {
                                HStack(spacing: 6) {
                                    if isSaving { ProgressView().tint(.white) }
                                    Text(isSaving ? "Saving…" : "Save alignment").font(.subheadline.bold())
                                }
                                .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(Color.indigo, in: RoundedRectangle(cornerRadius: 12))
                            }
                            .disabled(isSaving)
                        }
                    }
                }
                .padding(16).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 16).padding(.bottom, 32)
            }
        }
        .onAppear {
            pose  = meta.shapeModelPoseTransform
            scale = meta.shapeModelScale ?? 1
            lift  = pose.columns.3.y
            let client = SIBClient(settings: settings)
            let g = ObjectShapeGhost(sceneView: arManager.sceneView, meta: meta, opacity: 0.55)
            ghost = g
            Task {
                let ob = await ReferenceObjectCache.load(anchorId: anchor.id, client: client)
                arManager.setReferenceObject(ob?.archive, name: anchor.id)
                arManager.startSession()
                arManager.disableQRScanning()
                await g.load(modelId: modelId, client: client)
                g.setPose(pose, scale: scale)
                g.update(objectTransform: arManager.objectTransform)
                if arManager.objectTransform != nil { g.show(); detected = true }
            }
            installGestures()
        }
        .onDisappear { arManager.pauseSession() }
        .onChange(of: arManager.objectTransform) { t in
            guard let t else { return }
            if !detected { detected = true; UINotificationFeedbackGenerator().notificationOccurred(.success) }
            ghost?.show()
            ghost?.update(objectTransform: t)
        }
    }

    // ── Gestures: pan slides on the object's ground plane, pinch scales, twist yaws ──
    @MainActor
    final class Gestures: NSObject {
        var onPan:    ((CGPoint, UIGestureRecognizer.State) -> Void)?
        var onPinch:  ((CGFloat) -> Void)?
        var onRotate: ((CGFloat) -> Void)?
        private var last: CGPoint = .zero
        @objc func pan(_ g: UIPanGestureRecognizer) {
            if g.state == .began { last = .zero }
            let p = g.translation(in: g.view)
            let d = CGPoint(x: p.x - last.x, y: p.y - last.y)
            onPan?(d, g.state)
            last = (g.state == .ended || g.state == .cancelled) ? .zero : p
        }
        @objc func pinch(_ g: UIPinchGestureRecognizer) { onPinch?(g.scale); g.scale = 1 }
        @objc func rotate(_ g: UIRotationGestureRecognizer) { onRotate?(g.rotation); g.rotation = 0 }
    }
    @State private var gestures = Gestures()

    private func installGestures() {
        let v = arManager.sceneView
        let mgr = arManager
        gestures.onPan = { d, _ in
            guard let cam = mgr.sceneView.session.currentFrame?.camera.transform else { return }
            // Screen dx → camera right, dy → camera forward, projected on the ground (object XZ).
            let right = simd_normalize(simd_float3(cam.columns.0.x, 0, cam.columns.0.z))
            let fwd   = simd_normalize(simd_float3(-cam.columns.2.x, 0, -cam.columns.2.z))
            let world = right * Float(d.x) * 0.002 - fwd * Float(d.y) * 0.002
            guard let objT = mgr.objectTransform else { return }
            // Express the world delta in the object's frame (rotation only).
            let r = simd_float3x3(simd_float3(objT.columns.0.x, objT.columns.0.y, objT.columns.0.z),
                                  simd_float3(objT.columns.1.x, objT.columns.1.y, objT.columns.1.z),
                                  simd_float3(objT.columns.2.x, objT.columns.2.y, objT.columns.2.z))
            let local = simd_inverse(r) * world
            pose.columns.3 += simd_float4(local.x, 0, local.z, 0)
            applyPose()
        }
        gestures.onPinch  = { s in scale = max(0.2, min(5, scale * Float(s))); applyPose() }
        gestures.onRotate = { r in
            let yaw = simd_float4x4(simd_quatf(angle: -Float(r), axis: simd_float3(0, 1, 0)))
            let t = pose.columns.3
            var p = pose; p.columns.3 = simd_float4(0, 0, 0, 1)
            p = yaw * p; p.columns.3 = t
            pose = p; applyPose()
        }
        v.addGestureRecognizer(UIPanGestureRecognizer(target: gestures, action: #selector(Gestures.pan(_:))))
        v.addGestureRecognizer(UIPinchGestureRecognizer(target: gestures, action: #selector(Gestures.pinch(_:))))
        v.addGestureRecognizer(UIRotationGestureRecognizer(target: gestures, action: #selector(Gestures.rotate(_:))))
    }

    private func applyPose() {
        pose.columns.3.y = lift
        ghost?.setPose(pose, scale: scale)
        ghost?.update(objectTransform: arManager.objectTransform)
    }

    private func resetPose() { pose = matrix_identity_float4x4; scale = 1; lift = 0; applyPose() }

    private func save() async {
        isSaving = true; error = nil
        defer { isSaving = false }
        do {
            let m = try await SIBClient(settings: settings).setObjectShapeModel(anchorId: anchor.id, modelId: modelId, pose: pose, scale: scale)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            arManager.pauseSession()
            onDone(m)
        } catch { self.error = friendlyMessage(for: error) }
    }
}
