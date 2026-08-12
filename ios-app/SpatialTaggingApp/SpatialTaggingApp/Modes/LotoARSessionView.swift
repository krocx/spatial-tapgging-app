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
    /// Draw/edit the electricity-flow map: tap to place polyline vertices;
    /// snapping a stroke's FIRST vertex onto a Safe Off marker links the
    /// stroke to that breaker (fedByPointId) → status-aware rendering.
    case mapEdit
}

struct LotoARSessionView: View {

    let anchor: Anchor
    let mode:   LotoARMode
    let isCertified: Bool
    let onExit: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState: AppState

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

    // ── Flow map state ──────────────────────────────────────────────────────
    @State private var flowMap: LotoMap? = nil
    /// Editing buffer: existing strokes (EDIT starts from the current map).
    @State private var workingStrokes: [LotoMapStroke] = []
    /// The stroke being drawn right now.
    @State private var currentVertices: [simd_float3] = []
    @State private var currentFedBy: String? = nil
    @State private var currentCircuit: String? = nil
    @State private var isSavingFlowMap = false
    /// All rendered flow-line nodes live under this container for easy redraws.
    @State private var flowContainer: SCNNode? = nil

    @State private var focusRing: ARFocusRing? = nil
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    private var authorKind: LotoPointKind? {
        if case .author(let kind) = mode { return kind }
        return nil
    }

    private var isMapEditing: Bool { mode == .mapEdit }

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

                if isMapEditing {
                    mapEditBar
                } else {
                    bottomHint
                }
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
            if authorKind != nil || isMapEditing { focusRing?.update(sceneView: arManager.sceneView) }
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
        case .mapEdit:          return "Draw electricity flow"
        }
    }

    private var subtitleText: String {
        let visible = authorKind != nil ? points.filter { $0.kind == authorKind }.count : points.count
        let locked  = statuses.values.filter { $0.isLocked }.count
        switch mode {
        case .author:  return "\(visible) placed · tap the \(authorKind == .loto ? "switch" : "breaker") to add"
        case .status:  return "\(locked) locked of \(points.count) points"
        case .mapEdit: return "\(workingStrokes.count) line\(workingStrokes.count == 1 ? "" : "s") · \(currentVertices.count) vertices in current"
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

    /// Map-editing controls: undo vertex · finish line · save all.
    private var mapEditBar: some View {
        VStack(spacing: 8) {
            Text(currentVertices.isEmpty
                 ? "Tap a Safe Off marker to START a line at its breaker, or tap any surface"
                 : "Tap along the conduit to extend · \(currentVertices.count) vertices")
                .font(.caption).foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
            HStack(spacing: 10) {
                Button {
                    undoVertex()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .disabled(currentVertices.isEmpty)

                Button {
                    finishCurrentStroke()
                } label: {
                    Label("End line", systemImage: "checkmark")
                }
                .disabled(currentVertices.count < 2)

                Button {
                    Task { await saveFlowMap() }
                } label: {
                    if isSavingFlowMap { ProgressView().tint(.white) }
                    else { Label("Save map", systemImage: "square.and.arrow.down").bold() }
                }
                .disabled(isSavingFlowMap || (workingStrokes.isEmpty && currentVertices.count < 2))
            }
            .font(.caption.bold())
            .buttonStyle(.borderedProminent)
            .tint(.teal)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    private var bottomHint: some View {
        Group {
            if let kind = authorKind {
                Text("Tap a \(kind == .loto ? "switch" : "circuit breaker") on the panel to place a \(kind == .loto ? "red LOTO" : "yellow Safe Off") point · tap a marker to review")
            } else {
                Text("Tap any marker for details · solid = locked, hollow = clear · grey lines = de-energized")
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
        // ── Session origin: the QR gate, always ──────────────────────────────
        // This view is ONLY presented after QRScanGateView locked the origin
        // from the physical QR on the panel and loaded the ARWorldMap
        // (local → SIB → fresh). Adopting that live session keeps the world
        // frame and the locked ARImageAnchor — every marker position is
        // QR-anchored, consistent across devices and sessions. The fallback
        // below exists only for defensive robustness; it should never run in
        // the shipped flow (and says so loudly).
        if let existingSession = appState.activeARSession {
            arManager.linkToExistingSession(existingSession)
            arManager.disableQRScanning()
            hadWorldMap = true
        } else {
            arManager.startSession()
            arManager.disableQRScanning()
            showToast("⚠️ No QR-locked session — positions may not match other devices. Re-enter via the QR scan.")
        }

        let client = SIBClient(settings: settings)
        do {
            async let pointsFetch = client.fetchLotoPoints(anchorId: anchor.id)
            async let statusFetch = client.fetchLotoStatus(anchorId: anchor.id)
            async let mapFetch    = client.fetchLotoMap(anchorId: anchor.id)
            let (pts, st, fm) = try await (pointsFetch, statusFetch, mapFetch)
            points   = pts
            statuses = Dictionary(uniqueKeysWithValues: st.points.map { ($0.point.id, $0) })
            flowMap  = fm
            if isMapEditing { workingStrokes = fm?.strokes ?? [] }   // EDIT starts from current
            placeMarkers()
            renderFlowMap()
        } catch {
            showToast("Could not load panel data: \(error.localizedDescription)")
        }
        focusRing = ARFocusRing(sceneView: arManager.sceneView)
        isLoadingSession = false
    }

    private func exitSession() async {
        // Authoring sessions (points + map drawing) persist the worldmap so
        // operators can relocalize. Re-saved every time: it improves per scan.
        if authorKind != nil || isMapEditing {
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

        // Existing marker?
        let hits = sv.hitTest(point, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                if let id = n.name, let hitPoint = points.first(where: { $0.id == id }) {
                    if isMapEditing {
                        // SNAP: vertex lands exactly on the point's position.
                        // First vertex on a Safe Off breaker → the stroke is
                        // fed by it (status-aware rendering downstream).
                        addMapVertex(simd_float3(Float(hitPoint.position.x),
                                                 Float(hitPoint.position.y),
                                                 Float(hitPoint.position.z)),
                                     snappedTo: hitPoint)
                    } else {
                        detailStatus = statuses[id] ?? LotoPointStatus(
                            point: hitPoint, state: "clear", lockedBy: nil, lockedByName: nil,
                            lockedAt: nil, lockSerial: nil, lastEventId: nil)
                    }
                    return
                }
                candidate = n.parent
            }
        }

        // Map editing: surface tap → next vertex of the current stroke.
        if isMapEditing {
            guard let pos = rayCastSurface(from: point, in: sv) else {
                showToast("No surface found — move closer to the panel.")
                return
            }
            addMapVertex(pos, snappedTo: nil)
            return
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

    // ── Flow map: drawing ───────────────────────────────────────────────────

    private func addMapVertex(_ pos: simd_float3, snappedTo point: LotoPoint?) {
        if currentVertices.isEmpty, let p = point {
            // First vertex snapped onto a marker: a Safe Off breaker FEEDS the
            // stroke (status-aware rendering); circuit id rides along.
            if p.kind == .safeoff { currentFedBy = p.id }
            currentCircuit = p.circuitId
            showToast(p.kind == .safeoff
                      ? "Line starts at \(p.label) — it will grey out when that breaker is safe-off'd."
                      : "Line starts at \(p.label).")
        }
        currentVertices.append(pos)
        renderFlowMap()
    }

    private func undoVertex() {
        guard !currentVertices.isEmpty else { return }
        currentVertices.removeLast()
        if currentVertices.isEmpty { currentFedBy = nil; currentCircuit = nil }
        renderFlowMap()
    }

    private func finishCurrentStroke() {
        guard currentVertices.count >= 2 else { return }
        workingStrokes.append(LotoMapStroke(
            id:           UUID().uuidString,
            points:       currentVertices.map { SIBVector3(x: Double($0.x), y: Double($0.y), z: Double($0.z)) },
            circuitId:    currentCircuit,
            fedByPointId: currentFedBy
        ))
        currentVertices = []
        currentFedBy = nil
        currentCircuit = nil
        renderFlowMap()
    }

    private func saveFlowMap() async {
        if currentVertices.count >= 2 { finishCurrentStroke() }
        guard !workingStrokes.isEmpty else { return }
        isSavingFlowMap = true
        do {
            let saved = try await SIBClient(settings: settings).saveLotoMap(SaveLotoMapRequest(
                anchorId:  anchor.id,
                strokes:   workingStrokes,
                createdBy: settings.authorName
            ))
            flowMap = saved
            showToast("Flow map v\(saved.version) saved.")
        } catch {
            showToast("Save failed: \(error.localizedDescription)")
        }
        isSavingFlowMap = false
    }

    // ── Flow map: rendering ─────────────────────────────────────────────────
    //
    // Energized lines are emissive teal with a pulse travelling the polyline
    // (direction = drawing order, breaker → loads). A line whose feeding
    // Safe Off breaker is LOCKED renders grey, translucent, pulse-free —
    // de-energized at a glance. This is a VISUAL AID: the try test at the
    // panel remains the verification, and the hub says so.

    private var strokesToRender: [LotoMapStroke] {
        isMapEditing ? workingStrokes : (flowMap?.strokes ?? [])
    }

    private func isDeEnergized(_ stroke: LotoMapStroke) -> Bool {
        guard let fedBy = stroke.fedByPointId else { return false }
        return statuses[fedBy]?.isLocked == true
    }

    private func renderFlowMap() {
        flowContainer?.removeFromParentNode()
        let container = SCNNode()
        arManager.sceneView.scene.rootNode.addChildNode(container)
        flowContainer = container

        for stroke in strokesToRender {
            let pts = stroke.points.map { simd_float3(Float($0.x), Float($0.y), Float($0.z)) }
            addPolyline(pts, deEnergized: isDeEnergized(stroke), inProgress: false, to: container)
        }
        // The stroke currently being drawn: always "live" colour, dashed feel
        // via smaller radius, so the author sees what is uncommitted.
        if currentVertices.count >= 1 {
            addPolyline(currentVertices, deEnergized: false, inProgress: true, to: container)
        }
    }

    private func addPolyline(_ pts: [simd_float3], deEnergized: Bool, inProgress: Bool, to container: SCNNode) {
        let color: UIColor = deEnergized ? .systemGray : .systemTeal
        let radius: CGFloat = inProgress ? 0.0025 : 0.004
        let mat = SCNMaterial()
        mat.diffuse.contents  = color.withAlphaComponent(deEnergized ? 0.4 : 0.9)
        mat.emission.contents = color.withAlphaComponent(deEnergized ? 0.08 : 0.5)
        mat.lightingModel = .constant

        // Vertex beads — visible feedback for every placed vertex.
        for p in pts {
            let bead = SCNNode(geometry: { let s = SCNSphere(radius: radius * 1.8); s.firstMaterial = mat; return s }())
            bead.simdPosition = p
            container.addChildNode(bead)
        }
        guard pts.count >= 2 else { return }

        // Segments as thin cylinders (axis +Y → aim with look(localFront:)).
        for i in 0..<(pts.count - 1) {
            let a = pts[i], b = pts[i + 1]
            let dist = simd_distance(a, b)
            guard dist > 0.001 else { continue }
            let cyl = SCNCylinder(radius: radius, height: CGFloat(dist))
            cyl.firstMaterial = mat
            let seg = SCNNode(geometry: cyl)
            seg.simdPosition = (a + b) / 2
            seg.look(at: SCNVector3(b), up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))
            container.addChildNode(seg)
        }

        // Flow pulse — only on committed, energized lines.
        if !deEnergized && !inProgress {
            let pulse = SCNNode(geometry: {
                let s = SCNSphere(radius: 0.009)
                let m = SCNMaterial()
                m.diffuse.contents  = UIColor.white
                m.emission.contents = UIColor.systemTeal
                m.lightingModel = .constant
                s.firstMaterial = m
                return s
            }())
            pulse.simdPosition = pts[0]
            container.addChildNode(pulse)
            var actions: [SCNAction] = []
            for i in 0..<(pts.count - 1) {
                let dist = simd_distance(pts[i], pts[i + 1])
                actions.append(.move(to: SCNVector3(pts[i + 1]), duration: Double(dist) / 0.25))
            }
            actions.append(.move(to: SCNVector3(pts[0]), duration: 0))
            pulse.runAction(.repeatForever(.sequence(actions)))
        }
    }

    // ── Status updates from flows ───────────────────────────────────────────

    private func applyStatusChange(_ fresh: LotoPointStatus) {
        statuses[fresh.point.id] = fresh
        refreshMarker(for: fresh.point.id)
        // A Safe Off apply/remove flips downstream lines live — the payoff
        // moment of the status-aware map.
        renderFlowMap()
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

// ════════════════════════════════════════════════════════════════════════════
// MARK: - QR-gated entry flow
// ════════════════════════════════════════════════════════════════════════════
//
// EVERY iLOTO AR session — authoring, status walk, map editing — starts with
// the mandatory QR scan, exactly like AR Work Instructions. The QR mounted on
// the panel locks the session origin (a physical "I'm here" with a
// millimetre-grade pose), then the ARWorldMap relocalizes the feature cloud,
// and the live session is handed to LotoARSessionView via
// AppState.activeARSession. Without this, positions drift per-session and
// nothing lines up across devices.

struct LotoARGateFlow: View {

    let anchor: Anchor
    let mode:   LotoARMode
    let isCertified: Bool
    let onExit: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var tour:     GuidedTourManager

    @State private var qrLocked = false

    var body: some View {
        Group {
            if qrLocked {
                LotoARSessionView(
                    anchor: anchor,
                    mode: mode,
                    isCertified: isCertified,
                    onExit: { cleanupAndExit() }
                )
            } else {
                QRScanGateView(
                    mode: {
                        // Authoring surfaces (points + map drawing) scan as
                        // author; the status walk scans as operator.
                        switch mode {
                        case .author, .mapEdit: return .author
                        case .status:           return .operator
                        }
                    }(),
                    onSessionReady: { qrLocked = true },
                    onCancel: { cleanupAndExit() }
                )
            }
        }
        .onAppear {
            // QRScanGateView requires the anchor context in AppState.
            appState.activeAnchor = anchor
            appState.activeTags   = []
        }
    }

    private func cleanupAndExit() {
        // Release the preserved ARSession so it doesn't outlive the flow.
        appState.activeARSession = nil
        onExit()
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
