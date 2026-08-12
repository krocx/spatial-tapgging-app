// LotoARSessionView.swift — iLOTO slice 2: the AR surface for a control panel.
//
// Two modes, one view:
//   .author(kind) — EHS owner tags breakers/switches: tap a surface → place a
//                   yellow/red lock marker → name it → saved to SIB. On exit
//                   the ARWorldMap is uploaded so every later session
//                   relocalizes into the same coordinate frame.
//   .status       — walk-around: markers for every point, coloured by kind,
//                   solid when locked / translucent when clear. Tap → detail
//                   sheet with contextual Apply / Remove (cert-gated).
//
// Relocalization mirrors LocTagAuthorView: fetch worldmap → if present,
// startSessionWithWorldMap (markers appear once ARKit relocalizes); first-ever
// authoring session starts fresh and CREATES the worldmap on exit.
//
// Positions are DEVICE-owned (the platform invariant): only this view, with
// the author physically at the panel, ever writes LotoPoint.position.

import SwiftUI
import SceneKit
import ARKit

enum LotoARMode: Equatable {
    case author(kind: LotoPointKind)
    case status
}

struct LotoARSessionView: View {

    let anchor: Anchor
    let mode:   LotoARMode
    let isCertified: Bool
    let onExit: () -> Void

    @EnvironmentObject private var settings: AppSettings

    @StateObject private var arManager = ARSessionManager()

    @State private var points:   [LotoPoint] = []
    @State private var statuses: [String: LotoPointStatus] = [:]   // pointId → status
    @State private var pointNodes: [String: SCNNode] = [:]

    // Author placement
    @State private var pendingPosition: simd_float3? = nil
    @State private var pendingNode: SCNNode? = nil
    @State private var showPointForm = false
    @State private var newLabel = ""
    @State private var newCircuit = ""
    @State private var isSavingPoint = false

    // Detail / flows
    @State private var detailStatus: LotoPointStatus? = nil

    // Session state
    @State private var isLoadingSession = true
    @State private var hadWorldMap = false
    @State private var isSavingMap = false
    @State private var toastMsg: String? = nil

    @State private var focusRing: ARFocusRing? = nil
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    private var authorKind: LotoPointKind? {
        if case .author(let kind) = mode { return kind }
        return nil
    }

    var body: some View {
        ZStack {
            LotoARContainer(arManager: arManager, onTap: handleTap)
                .ignoresSafeArea()

            VStack {
                topBar
                Spacer()

                if arManager.isRelocalizing {
                    relocalizingBanner
                }

                if let msg = toastMsg {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.black.opacity(0.65), in: Capsule())
                        .padding(.bottom, 8)
                }

                bottomHint
            }

            if isLoadingSession || isSavingMap {
                Color.black.opacity(0.45).ignoresSafeArea()
                VStack(spacing: 12) {
                    ProgressView().scaleEffect(1.2).tint(.white)
                    Text(isSavingMap ? "Saving panel map…" : "Loading panel…")
                        .font(.headline).foregroundStyle(.white)
                }
            }
        }
        .onAppear { Task { await setup() } }
        .onDisappear {
            focusRing?.cleanup(); focusRing = nil
            arManager.pauseSession()
        }
        .onReceive(crosshairTicker) { _ in
            if authorKind != nil { focusRing?.update(sceneView: arManager.sceneView) }
        }
        .sheet(isPresented: $showPointForm, onDismiss: cancelPendingPlacement) {
            pointForm
                .presentationDetents([.medium])
        }
        .sheet(item: $detailStatus) { st in
            LotoPointDetailSheet(
                anchor:      anchor,
                status:      st,
                isCertified: isCertified,
                allowDelete: authorKind != nil,
                onChanged:   { fresh in applyStatusChange(fresh) },
                onDeleted:   { removeDeletedPoint(st.point) }
            )
            .environmentObject(settings)
        }
    }

    // ── Chrome ──────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button { Task { await exitSession() } } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white.opacity(0.85))
            }
            Spacer()
            VStack(spacing: 2) {
                Text(titleText).font(.headline.bold()).foregroundStyle(.white)
                Text(subtitleText).font(.caption).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 26)).foregroundStyle(.clear)
        }
        .padding(.horizontal, 16).padding(.vertical, 10).padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    private var titleText: String {
        switch mode {
        case .author(let kind): return "Define \(kind.displayName) points"
        case .status:           return "Panel status"
        }
    }

    private var subtitleText: String {
        let visible = authorKind != nil ? points.filter { $0.kind == authorKind }.count : points.count
        let locked  = statuses.values.filter { $0.isLocked }.count
        switch mode {
        case .author: return "\(visible) placed · tap the \(authorKind == .loto ? "switch" : "breaker") to add"
        case .status: return "\(locked) locked of \(points.count) points"
        }
    }

    private var relocalizingBanner: some View {
        HStack(spacing: 8) {
            ProgressView().tint(.white)
            Text("Point the camera where the panel QR is mounted…")
                .font(.caption).foregroundStyle(.white)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(.black.opacity(0.6), in: Capsule())
        .padding(.bottom, 10)
    }

    private var bottomHint: some View {
        Group {
            if let kind = authorKind {
                Text("Tap a \(kind == .loto ? "switch" : "circuit breaker") on the panel to place a \(kind == .loto ? "red LOTO" : "yellow Safe Off") point · tap a marker to review")
            } else {
                Text("Tap any marker for details · solid = locked, hollow = clear")
            }
        }
        .font(.caption)
        .foregroundStyle(.white.opacity(0.85))
        .multilineTextAlignment(.center)
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
    }

    // ── Point form (author) ─────────────────────────────────────────────────

    private var pointForm: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(authorKind == .loto ? "e.g. SW-2 · Conveyor drive" : "e.g. CB-3 · Main spindle",
                              text: $newLabel)
                        .autocorrectionDisabled()
                } header: {
                    Text("Point name (required)")
                }
                Section {
                    TextField("e.g. Circuit 3 (optional)", text: $newCircuit)
                        .autocorrectionDisabled()
                } header: {
                    Text("Circuit reference")
                } footer: {
                    Text("Used by the AR LOTO map to link flow lines to this \(authorKind == .loto ? "switch" : "breaker").")
                }
            }
            .navigationTitle("New \(authorKind?.displayName ?? "") point")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showPointForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSavingPoint { ProgressView() }
                    else {
                        Button("Save") { Task { await savePendingPoint() } }
                            .disabled(newLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    // ── Session lifecycle ───────────────────────────────────────────────────

    private func setup() async {
        let client = SIBClient(settings: settings)
        do {
            async let pointsFetch = client.fetchLotoPoints(anchorId: anchor.id)
            async let statusFetch = client.fetchLotoStatus(anchorId: anchor.id)
            async let mapFetch    = client.fetchWorldMap(anchorId: anchor.id)
            let (pts, st, mapData) = try await (pointsFetch, statusFetch, mapFetch)
            points   = pts
            statuses = Dictionary(uniqueKeysWithValues: st.points.map { ($0.point.id, $0) })

            if let mapData {
                hadWorldMap = true
                arManager.startSessionWithWorldMap(mapData)
            } else {
                // First-ever session at this panel: author scans the area and
                // the map is captured on exit. Status mode without a map can
                // only show the list — warn.
                arManager.startSession()
                arManager.disableQRScanning()
                if authorKind == nil {
                    showToast("No panel map yet — markers appear after an author defines points.")
                }
            }
            placeMarkers()
        } catch {
            arManager.startSession()
            arManager.disableQRScanning()
            showToast("Could not load panel data: \(error.localizedDescription)")
        }
        focusRing = ARFocusRing(sceneView: arManager.sceneView)
        isLoadingSession = false
    }

    private func exitSession() async {
        // Author sessions persist the worldmap so operators can relocalize.
        // Always re-save after authoring: the map improves with every scan.
        if authorKind != nil {
            isSavingMap = true
            if let data = await arManager.saveCurrentWorldMap() {
                try? await SIBClient(settings: settings).uploadWorldMap(anchorId: anchor.id, data: data)
            }
            isSavingMap = false
        }
        onExit()
    }

    // ── Markers ─────────────────────────────────────────────────────────────

    private func placeMarkers() {
        for (_, node) in pointNodes { node.removeFromParentNode() }
        pointNodes.removeAll()
        let visible = authorKind != nil ? points.filter { $0.kind == authorKind } : points
        for p in visible {
            let locked = statuses[p.id]?.isLocked == true
            let node = makeLockMarker(kind: p.kind, locked: locked)
            node.name = p.id
            node.simdPosition = simd_float3(Float(p.position.x), Float(p.position.y), Float(p.position.z))
            arManager.sceneView.scene.rootNode.addChildNode(node)
            pointNodes[p.id] = node
        }
    }

    /// Lock marker: small sphere on a ring, kind-coloured. Locked points are
    /// solid + emissive; clear points are hollow/translucent — readable from
    /// across the room, matching the hub's language.
    private func makeLockMarker(kind: LotoPointKind, locked: Bool) -> SCNNode {
        let color: UIColor = kind == .loto ? .systemRed : .systemYellow
        let root = SCNNode()

        let sphere = SCNSphere(radius: 0.022)
        let sMat = SCNMaterial()
        sMat.diffuse.contents  = color.withAlphaComponent(locked ? 0.95 : 0.35)
        sMat.emission.contents = color.withAlphaComponent(locked ? 0.55 : 0.12)
        sMat.lightingModel = .constant
        sphere.firstMaterial = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        let torus = SCNTorus(ringRadius: 0.045, pipeRadius: 0.004)
        let tMat = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(locked ? 0.6 : 0.25)
        tMat.lightingModel = .constant
        torus.firstMaterial = tMat
        let ring = SCNNode(geometry: torus)
        ring.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ring)

        // Billboard so the ring always faces the viewer
        let bb = SCNBillboardConstraint()
        bb.freeAxes = .all
        ring.constraints = [bb]
        return root
    }

    private func refreshMarker(for pointId: String) {
        guard let p = points.first(where: { $0.id == pointId }) else { return }
        let locked = statuses[pointId]?.isLocked == true
        pointNodes[pointId]?.removeFromParentNode()
        let node = makeLockMarker(kind: p.kind, locked: locked)
        node.name = p.id
        node.simdPosition = simd_float3(Float(p.position.x), Float(p.position.y), Float(p.position.z))
        arManager.sceneView.scene.rootNode.addChildNode(node)
        pointNodes[p.id] = node
    }

    // ── Tap handling ────────────────────────────────────────────────────────

    private func handleTap(_ point: CGPoint) {
        let sv = arManager.sceneView

        // Existing marker? → detail sheet
        let hits = sv.hitTest(point, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                if let id = n.name, let st = statuses[id] ?? points.first(where: { $0.id == id }).map({
                    LotoPointStatus(point: $0, state: "clear", lockedBy: nil, lockedByName: nil,
                                    lockedAt: nil, lockSerial: nil, lastEventId: nil)
                }) {
                    detailStatus = st
                    return
                }
                candidate = n.parent
            }
        }

        // Author mode: surface tap → pending marker + form
        guard let kind = authorKind, !showPointForm else { return }
        guard let pos = rayCastSurface(from: point, in: sv) else {
            showToast("No surface found — move closer to the panel.")
            return
        }
        pendingPosition = pos
        let node = makeLockMarker(kind: kind, locked: false)
        node.opacity = 0.6
        node.simdPosition = pos
        sv.scene.rootNode.addChildNode(node)
        pendingNode = node
        newLabel = ""; newCircuit = ""
        showPointForm = true
    }

    private func rayCastSurface(from point: CGPoint, in sv: ARSCNView) -> simd_float3? {
        if let q = sv.raycastQuery(from: point, allowing: .existingPlaneGeometry, alignment: .any),
           let h = sv.session.raycast(q).first {
            let c = h.worldTransform.columns.3; return simd_float3(c.x, c.y, c.z)
        }
        if let q = sv.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .any),
           let h = sv.session.raycast(q).first {
            let c = h.worldTransform.columns.3; return simd_float3(c.x, c.y, c.z)
        }
        return nil
    }

    // ── Point persistence ───────────────────────────────────────────────────

    private func savePendingPoint() async {
        guard let kind = authorKind, let pos = pendingPosition else { return }
        isSavingPoint = true
        let req = CreateLotoPointRequest(
            anchorId:   anchor.id,
            kind:       kind,
            label:      newLabel.trimmingCharacters(in: .whitespaces),
            circuitId:  newCircuit.trimmingCharacters(in: .whitespaces).isEmpty ? nil : newCircuit.trimmingCharacters(in: .whitespaces),
            position:   SIBVector3(x: Double(pos.x), y: Double(pos.y), z: Double(pos.z)),
            modelId:    nil,
            modelScale: nil,
            createdBy:  settings.authorName
        )
        do {
            let saved = try await SIBClient(settings: settings).createLotoPoint(req)
            points.append(saved)
            statuses[saved.id] = LotoPointStatus(point: saved, state: "clear", lockedBy: nil,
                                                 lockedByName: nil, lockedAt: nil,
                                                 lockSerial: nil, lastEventId: nil)
            // Promote the pending node to a real, named marker.
            pendingNode?.removeFromParentNode()
            pendingNode = nil
            pendingPosition = nil
            refreshMarker(for: saved.id)
            isSavingPoint = false
            showPointForm = false
            showToast("\(saved.label) placed.")
        } catch {
            isSavingPoint = false
            showToast("Save failed: \(error.localizedDescription)")
        }
    }

    private func cancelPendingPlacement() {
        guard !isSavingPoint else { return }
        pendingNode?.removeFromParentNode()
        pendingNode = nil
        pendingPosition = nil
    }

    // ── Status updates from flows ───────────────────────────────────────────

    private func applyStatusChange(_ fresh: LotoPointStatus) {
        statuses[fresh.point.id] = fresh
        refreshMarker(for: fresh.point.id)
        detailStatus = nil
    }

    private func removeDeletedPoint(_ p: LotoPoint) {
        points.removeAll { $0.id == p.id }
        statuses.removeValue(forKey: p.id)
        pointNodes[p.id]?.removeFromParentNode()
        pointNodes.removeValue(forKey: p.id)
        detailStatus = nil
    }

    private func showToast(_ msg: String) {
        toastMsg = msg
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if toastMsg == msg { toastMsg = nil }
        }
    }
}

// ── Minimal AR container (tap only) ─────────────────────────────────────────

private struct LotoARContainer: UIViewRepresentable {
    let arManager: ARSessionManager
    let onTap: (CGPoint) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = arManager.sceneView
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        context.coordinator.onTap = onTap
    }

    final class Coordinator: NSObject {
        var onTap: (CGPoint) -> Void
        init(onTap: @escaping (CGPoint) -> Void) { self.onTap = onTap }
        @objc func handleTap(_ r: UITapGestureRecognizer) {
            onTap(r.location(in: r.view))
        }
    }
}

// Identifiable conformance so LotoPointStatus can drive .sheet(item:).
extension LotoPointStatus: Identifiable {
    var id: String { point.id }
}
