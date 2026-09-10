// ObjectScanView.swift — B1 (2026.4.46): scan a chamber as an ARKit reference object.
//
// Entirely on-device (ARObjectScanningConfiguration). The author frames the
// chamber in a box, walks around it while ARKit gathers feature points, and
// saves. The resulting ARReferenceObject — a sparse point cloud, not a mesh or
// a photo — is exported and uploaded to SIB (`POST /anchors/:id/object`) so
// every device can detect this chamber offline later (B2: origin source).
//
//   1. Aim at the chamber, tap the surface it stands on → the box appears there
//      (bottom-centre on the tap). Drag to move it, sliders for W · H · D.
//   2. Walk around. Coverage = feature points inside the box (live).
//   3. Save when coverage is good → export → upload → done.
//
// Own ARSCNView + session: ARObjectScanningConfiguration is a different
// session type from world tracking, so this view does not touch the shared
// ARSessionManager or any world map.

import SwiftUI
import ARKit
import SceneKit

struct ObjectScanView: View {
    let anchor: Anchor
    let onDone: (AnchorObjectMeta?) -> Void

    @EnvironmentObject private var settings: AppSettings
    @StateObject private var scanner = ObjectScanner()
    @State private var isSaving = false
    @State private var error: String? = nil

    private var coverageLabel: (String, Color) {
        switch scanner.pointsInBox {
        case ..<150:   return ("Sparse — keep walking around", .orange)
        case ..<600:   return ("Getting there — cover the other sides", .yellow)
        default:       return ("Good coverage", .green)
        }
    }

    var body: some View {
        ZStack {
            ObjectScanARView(scanner: scanner).ignoresSafeArea()

            VStack {
                // Top: title + state
                VStack(spacing: 4) {
                    Text(scanner.hasBox ? "Walk around the chamber" : "Tap the surface the chamber stands on")
                        .font(.title3.bold()).foregroundStyle(.white)
                    Text(scanner.hasBox
                         ? "Keep the box on the chamber. Every side you see adds points."
                         : "The scan box appears where you tap. Then size it with the sliders.")
                        .font(.footnote).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                }
                .padding(16)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 60).padding(.horizontal, 24)

                Spacer()

                // Bottom: box controls + coverage + save
                VStack(spacing: 12) {
                    if scanner.hasBox {
                        HStack(spacing: 10) {
                            Circle().fill(coverageLabel.1).frame(width: 8, height: 8)
                            Text("\(scanner.pointsInBox) points · \(coverageLabel.0)")
                                .font(.caption).foregroundStyle(.white.opacity(0.85))
                            Spacer()
                        }
                        sizeSlider("W", $scanner.extent.x)
                        sizeSlider("H", $scanner.extent.y)
                        sizeSlider("D", $scanner.extent.z)
                    }
                    if let error {
                        Text(error).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center)
                    }
                    HStack(spacing: 10) {
                        Button("Cancel") { scanner.stop(); onDone(nil) }
                            .font(.subheadline.bold()).foregroundStyle(.white.opacity(0.8))
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                        if scanner.hasBox {
                            Button { scanner.resetBox() } label: {
                                Text("Re-place box").font(.subheadline.bold()).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                            }
                            Button { Task { await save() } } label: {
                                HStack(spacing: 6) {
                                    if isSaving { ProgressView().tint(.white) }
                                    Text(isSaving ? "Saving…" : "Save object").font(.subheadline.bold())
                                }
                                .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(scanner.pointsInBox >= 150 ? Color.indigo : Color.gray.opacity(0.5),
                                            in: RoundedRectangle(cornerRadius: 12))
                            }
                            .disabled(isSaving || scanner.pointsInBox < 150)
                        }
                    }
                }
                .padding(16)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 16).padding(.bottom, 32)
            }
        }
        .onAppear { scanner.start() }
        .onDisappear { scanner.stop() }
    }

    private func sizeSlider(_ label: String, _ value: Binding<Float>) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.caption.bold()).foregroundStyle(.white.opacity(0.7)).frame(width: 16)
            Slider(value: value, in: 0.2...4.0, step: 0.05).tint(.indigo)
                .onChange(of: value.wrappedValue) { _ in scanner.updateBoxNode() }
            Text(String(format: "%.2f m", value.wrappedValue))
                .font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.85)).frame(width: 58, alignment: .trailing)
        }
    }

    private func save() async {
        isSaving = true; error = nil
        defer { isSaving = false }
        do {
            let (data, ref) = try await scanner.exportReferenceObject()
            let client = SIBClient(settings: settings)
            let by = !settings.uamUserName.isEmpty ? settings.uamUserName : settings.authorName
            let meta = try await client.uploadAnchorObject(
                anchorId: anchor.id, data: data,
                extent: ref.extent, center: ref.center, featurePoints: ref.rawFeaturePoints.points.count,
                scannedBy: by)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            scanner.stop()
            onDone(meta)
        } catch {
            self.error = friendlyMessage(for: error)
        }
    }
}

// ── Scanner (session + box + coverage) ───────────────────────────────────────

@MainActor
final class ObjectScanner: NSObject, ObservableObject {
    let sceneView = ARSCNView()
    @Published var hasBox = false
    @Published var pointsInBox = 0
    /// Box size in metres (W, H, D). Published so the sliders bind to it.
    @Published var extent = simd_float3(1.0, 1.0, 1.0)
    /// Box bottom-centre in world space (the tapped surface point).
    private(set) var base: simd_float3 = .zero
    private var boxNode: SCNNode?
    private var lastCount = Date()

    override init() {
        super.init()
        sceneView.automaticallyUpdatesLighting = true
        sceneView.session.delegate = self
        sceneView.debugOptions = [.showFeaturePoints]
    }

    func start() {
        let cfg = ARObjectScanningConfiguration()
        cfg.planeDetection = [.horizontal]
        sceneView.session.run(cfg, options: [.resetTracking, .removeExistingAnchors])
    }
    func stop() { sceneView.session.pause() }

    /// Tap → box bottom-centre on the hit surface (fallback: 1 m ahead).
    func placeBox(at screenPoint: CGPoint) {
        if let q = sceneView.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .horizontal),
           let hit = sceneView.session.raycast(q).first {
            base = simd_float3(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
        } else if let cam = sceneView.session.currentFrame?.camera.transform {
            let p = cam * simd_float4(0, -0.5, -1.0, 1)
            base = simd_float3(p.x, p.y, p.z)
        } else { return }
        hasBox = true
        updateBoxNode()
    }

    func moveBox(by delta: simd_float3) { base += delta; updateBoxNode() }
    func resetBox() { hasBox = false; boxNode?.removeFromParentNode(); boxNode = nil; pointsInBox = 0 }

    /// World transform of the box centre (gravity-aligned, no rotation).
    var boxTransform: simd_float4x4 {
        var t = matrix_identity_float4x4
        t.columns.3 = simd_float4(base.x, base.y + extent.y / 2, base.z, 1)
        return t
    }

    func updateBoxNode() {
        guard hasBox else { return }
        if boxNode == nil {
            let n = SCNNode(); n.name = "scanbox"
            sceneView.scene.rootNode.addChildNode(n); boxNode = n
        }
        guard let n = boxNode else { return }
        n.childNodes.forEach { $0.removeFromParentNode() }
        let box = SCNBox(width: CGFloat(extent.x), height: CGFloat(extent.y), length: CGFloat(extent.z), chamferRadius: 0)
        let mat = SCNMaterial()
        mat.diffuse.contents = UIColor.systemIndigo.withAlphaComponent(0.10)
        mat.isDoubleSided = true
        box.materials = [mat]
        let fill = SCNNode(geometry: box)
        let wire = SCNNode(geometry: box.copy() as? SCNGeometry)
        wire.geometry?.firstMaterial = {
            let m = SCNMaterial(); m.fillMode = .lines; m.diffuse.contents = UIColor.systemIndigo; m.lightingModel = .constant; return m
        }()
        n.addChildNode(fill); n.addChildNode(wire)
        n.simdWorldTransform = boxTransform
    }

    /// Feature points inside the box (axis-aligned; the box has no rotation).
    private func countPoints(_ frame: ARFrame) {
        guard hasBox, let pts = frame.rawFeaturePoints?.points else { return }
        let c = boxTransform.columns.3
        let half = extent / 2
        var n = 0
        for p in pts where abs(p.x - c.x) <= half.x && abs(p.y - c.y) <= half.y && abs(p.z - c.z) <= half.z { n += 1 }
        pointsInBox = n
    }

    /// Build the ARReferenceObject from the box and export the archive.
    func exportReferenceObject() async throws -> (Data, ARReferenceObject) {
        let center = simd_float3(0, 0, 0)     // relative to boxTransform (already centred)
        let ref: ARReferenceObject = try await withCheckedThrowingContinuation { cont in
            sceneView.session.createReferenceObject(transform: boxTransform, center: center, extent: extent) { obj, err in
                if let obj { cont.resume(returning: obj) }
                else { cont.resume(throwing: err ?? NSError(domain: "ObjectScan", code: 1,
                                    userInfo: [NSLocalizedDescriptionKey: "Couldn't build the reference object — walk around the chamber and try again."])) }
            }
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).arobject")
        try ref.export(to: url, previewImage: nil)
        let data = try Data(contentsOf: url)
        try? FileManager.default.removeItem(at: url)
        return (data, ref)
    }
}

extension ObjectScanner: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        Task { @MainActor in
            guard Date().timeIntervalSince(self.lastCount) > 0.25 else { return }
            self.lastCount = Date()
            self.countPoints(frame)
        }
    }
}

// ── AR view bridge with tap (place) + pan (move) ──────────────────────────────

struct ObjectScanARView: UIViewRepresentable {
    @ObservedObject var scanner: ObjectScanner

    @MainActor
    final class Coord: NSObject {
        let scanner: ObjectScanner
        var lastPan: CGPoint = .zero
        init(_ s: ObjectScanner) { scanner = s }
        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let v = g.view, !scanner.hasBox else { return }
            scanner.placeBox(at: g.location(in: v))
        }
        @objc func pan(_ g: UIPanGestureRecognizer) {
            guard scanner.hasBox, let v = g.view else { return }
            let p = g.location(in: v)
            if g.state == .began { lastPan = p; return }
            // Move the box along the tapped plane: screen dx → camera right, dy → camera forward.
            guard let cam = scanner.sceneView.session.currentFrame?.camera.transform else { return }
            let right = simd_normalize(simd_float3(cam.columns.0.x, 0, cam.columns.0.z))
            let fwd   = simd_normalize(simd_float3(-cam.columns.2.x, 0, -cam.columns.2.z))
            let dx = Float(p.x - lastPan.x) * 0.003, dy = Float(p.y - lastPan.y) * 0.003
            scanner.moveBox(by: right * dx - fwd * dy)
            lastPan = p
        }
    }
    func makeCoordinator() -> Coord { Coord(scanner) }
    func makeUIView(context: Context) -> ARSCNView {
        let v = scanner.sceneView
        v.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coord.tap(_:))))
        v.addGestureRecognizer(UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coord.pan(_:))))
        return v
    }
    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}

// ═════════════════════════════════════════════════════════════════════════════
// B2e (2026.4.46): shared tracking UI for movable equipment
//
// The object is the frame — never its world map. Three pieces every AR
// surface that tracks a chamber shares:
//   • ObjectFinderCard   "Point at the chamber" with a live elapsed timer so a
//                        long search never looks frozen; after `choiceAfter`
//                        seconds it offers an explicit fallback (never silent).
//   • ObjectTrackPill    status at a glance; tap = manual re-align.
//   • ObjectRealignToast "Chamber moved — re-aligned · Undo" after an
//                        automatic re-base (pins never move silently).
// ═════════════════════════════════════════════════════════════════════════════

struct ObjectFinderCard: View {
    var title: String = "Finding the chamber…"
    var extent: simd_float3? = nil
    let startedAt: Date
    var choiceAfter: TimeInterval = 15
    var onFallback: (() -> Void)? = nil      // "Place from last known position"
    var fallbackLabel: String = "Place from last known position"
    var onRescan: (() -> Void)? = nil        // author only
    var onCancel: (() -> Void)? = nil        // manual re-align in flight

    @State private var keepLookingSince: Date? = nil

    private var hint: String {
        if let e = extent {
            return String(format: "Frame the whole chamber (about %.1f × %.1f × %.1f m) and hold steady. Every side you show helps.", e.x, e.y, e.z)
        }
        return "Frame the whole chamber and hold steady. Every side you show helps."
    }

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
            let s = max(0, Int(ctx.date.timeIntervalSince(startedAt)))
            let since = keepLookingSince ?? startedAt
            let showChoice = onFallback != nil && ctx.date.timeIntervalSince(since) >= choiceAfter
            VStack(spacing: 14) {
                HStack(spacing: 10) {
                    ProgressView().tint(.indigo)
                    Text(title).font(.title3.bold()).foregroundStyle(.white)
                    Spacer()
                    Text(String(format: "%d:%02d", s / 60, s % 60))
                        .font(.subheadline.monospacedDigit().bold())
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Color.white.opacity(0.12), in: Capsule())
                }
                Text(hint).font(.caption).foregroundStyle(.white.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .leading)

                if showChoice {
                    VStack(spacing: 8) {
                        Text("Can't recognise the chamber yet. Still looking — or place the steps from where it was last seen?")
                            .font(.caption.bold()).foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 8) {
                            Button { keepLookingSince = ctx.date } label: {
                                Text("Keep looking").font(.subheadline.bold()).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Color.indigo, in: RoundedRectangle(cornerRadius: 12))
                            }
                            Button { onFallback?() } label: {
                                Text(fallbackLabel).font(.subheadline.bold()).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                            }
                        }
                        if let onRescan {
                            Button { onRescan() } label: {
                                Label("Re-scan the chamber (shape changed?)", systemImage: "cube.transparent")
                                    .font(.caption.bold()).foregroundStyle(.white.opacity(0.85))
                            }
                            .padding(.top, 2)
                        }
                    }
                    .transition(.opacity)
                } else if let onCancel {
                    Button { onCancel() } label: {
                        Text("Cancel").font(.subheadline.bold()).foregroundStyle(.white.opacity(0.85))
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding(18)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
            .animation(.easeInOut(duration: 0.25), value: showChoice)
        }
    }
}

struct ObjectTrackPill: View {
    let state: ARSessionManager.ObjectTrackState
    var approximate: Bool = false
    let onTap: () -> Void

    private var content: (icon: String, text: String, tint: Color) {
        if approximate { return ("exclamationmark.triangle.fill", "Approximate · from map", .orange) }
        switch state {
        case .idle:      return ("cube", "Chamber", .white.opacity(0.6))
        case .searching: return ("viewfinder", "Finding chamber…", .indigo)
        case .tracking:  return ("checkmark.circle.fill", "Tracking · chamber", .green)
        case .outOfView: return ("eye.slash", "Chamber out of view · last known", .white.opacity(0.7))
        case .stale:     return ("exclamationmark.triangle.fill", "Chamber looks different — tap to re-align", .orange)
        }
    }

    var body: some View {
        let c = content
        Button(action: onTap) {
            HStack(spacing: 6) {
                if state == .searching { ProgressView().tint(c.tint).scaleEffect(0.7) }
                else { Image(systemName: c.icon).font(.system(size: 11, weight: .bold)) }
                Text(c.text).font(.caption.bold()).lineLimit(1)
            }
            .foregroundStyle(c.tint)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(Capsule().stroke(c.tint.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .fixedSize()
        .animation(.easeInOut(duration: 0.2), value: state)
    }
}

struct ObjectRealignToast: View {
    let onUndo: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.triangle.2.circlepath").font(.caption.bold())
            Text("Chamber moved — steps re-aligned").font(.caption.bold())
            Button("Undo", action: onUndo)
                .font(.caption.bold())
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color.white.opacity(0.2), in: Capsule())
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Color.indigo.opacity(0.94), in: Capsule())
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}
