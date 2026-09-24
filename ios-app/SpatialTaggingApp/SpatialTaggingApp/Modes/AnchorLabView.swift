// AnchorLabView.swift — the Anchor Lab door (2026.4.46)
//
// A playground for the team that has to believe the anchoring: rigs instead
// of chambers, tags instead of procedures, and every run ends with a number.
//
//   AnchorLabHomeView   rigs (anchors of type LAB — never listed anywhere else)
//   LabRigView          one rig: Print QR · Place tags · Run · History
//   LabRunView          lean AR: relocalize, tags appear on the settled frame,
//                       mark truth per tag, run summary vs the rig's history
//   LabHistoryView      the portal's Lab numbers, on the device
//
// Two run types, because operators meet both in production:
//   Map only  relocalize into the rig's sealed map — no code in view at all
//             (what AR work-instruction runs do)
//   QR + map  through the QR gate (what Spatial Inspection does)
//
// Placing tags reuses the real Author flow (gate + AuthorModeView) so a lab
// tag is a real tag — same metadata, same seal, same trust layer. Nothing in
// here is a second implementation of anchoring; it is the product measured.
//
// Visible only to users explicitly entitled to `lab` (UAM products).

import SwiftUI
import ARKit
import SceneKit
import simd

// ── Run vocabulary ────────────────────────────────────────────────────────────

enum LabRunType: String, CaseIterable, Identifiable {
    case map = "map", qr = "qr"
    var id: String { rawValue }
    var title: String { self == .map ? "Map only" : "QR + map" }
    var detail: String { self == .map ? "Relocalize into the sealed map — no code in view" : "Through the QR gate, like Spatial Inspection" }
}

/// The protocol's run labels (docs/ar-ojt/ANCHOR-LAB.md) as chips.
let labRunPresets = ["author spot", "door", "opposite side", "evening", "dim", "second person", "after move"]

// ── Home: rigs ────────────────────────────────────────────────────────────────

struct AnchorLabHomeView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager
    @Environment(\.dismiss) private var dismiss

    @State private var rigs: [Anchor] = []
    @State private var loading = true
    @State private var error: String? = nil
    @State private var showCreate = false
    @State private var newName = ""
    @State private var creating = false

    private var client: SIBClient { SIBClient(settings: settings) }

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Loading rigs…") }
                else if rigs.isEmpty { emptyState }
                else { rigList }
            }
            .navigationTitle("Anchor Lab")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { newName = ""; showCreate = true } label: { Label("New rig", systemImage: "plus") }
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .alert("New rig", isPresented: $showCreate) {
                TextField("Name (AirPods Max shelf, HomePod…)", text: $newName)
                Button("Create") { Task { await create() } }.disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("A rig is an anchoring test bed: a printed QR, a few tags on real features, and runs that end in millimetres. It never appears in the production directories.")
            }
            .overlay(alignment: .bottom) {
                if let e = error {
                    Text(e).font(.caption).foregroundStyle(.white).padding(10)
                        .background(Color.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10)).padding()
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "scope").font(.system(size: 44)).foregroundStyle(.cyan)
            Text("No rigs yet").font(.title3.bold())
            Text("Create a rig, print its QR, put it next to something with real features (a controller, headphones, a shelf corner), place tags on those features, then run.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 32)
            Button { newName = ""; showCreate = true } label: { Label("New rig", systemImage: "plus") }.buttonStyle(.borderedProminent)
        }
    }

    private var rigList: some View {
        List {
            Section {
                ForEach(rigs) { rig in
                    NavigationLink { LabRigView(rig: rig, onChanged: { Task { await load() } }) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(rig.assetId).font(.headline)
                            HStack(spacing: 8) {
                                Label(rig.mapSealedAt == nil ? "Not sealed" : "Sealed", systemImage: rig.mapSealedAt == nil ? "circle.dashed" : "checkmark.seal.fill")
                                    .font(.caption).foregroundStyle(rig.mapSealedAt == nil ? .orange : .green)
                                Text(String(rig.id.prefix(8))).font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .onDelete { idx in Task { await deleteRigs(idx) } }
            } footer: {
                Text("Rigs are anchors of type LAB. Swipe to delete a rig with its tags, map and marks.")
            }
        }
    }

    private func load() async {
        loading = rigs.isEmpty
        do {
            rigs = try await client.fetchAnchors().filter { $0.anchorType == .lab }
                .sorted { $0.createdAt > $1.createdAt }
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        creating = true
        let id = UUID().uuidString.lowercased()
        let key = AnchorEncryption.getOrCreateKey(for: id)
        let req = CreateAnchorRequest(
            id: id, assetId: name, encryptionKey: AnchorEncryption.base64(for: key), qrSizeCm: 10.0,
            anchorType: .lab, createdBy: settings.authorName)
        do {
            let rig = try await client.createAnchor(req)
            AppLog.info("lab", "rig created: \(name)")
            rigs.insert(rig, at: 0)
        } catch { self.error = error.localizedDescription }
        creating = false
    }

    private func deleteRigs(_ idx: IndexSet) async {
        for i in idx.sorted(by: >) {
            let rig = rigs[i]
            do { try await client.deleteAnchor(id: rig.id); rigs.remove(at: i) }
            catch { self.error = error.localizedDescription }
        }
    }
}

// ── One rig ───────────────────────────────────────────────────────────────────

struct LabRigView: View {
    let rig: Anchor
    let onChanged: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @State private var tags: [Tag] = []
    @State private var history: SIBClient.AnchorAccuracySummary? = nil
    @State private var showQR = false
    @State private var showPlaceGate = false
    @State private var showPlace = false          // LabPlaceView (no code)
    @State private var sealedAt: String? = nil    // refreshed after every Place / Save
    @State private var runType: LabRunType = .map
    @State private var runLabel: String = UserDefaults.standard.string(forKey: "anchor_lab_run") ?? "author spot"
    @State private var customLabel = ""
    @State private var showRunGate = false        // QR + map → gate first
    @State private var showRun = false            // LabRunView
    @State private var pendingRun = false         // gate locked → open the run after its cover dismisses
    @State private var error: String? = nil

    private var client: SIBClient { SIBClient(settings: settings) }
    private var placedTags: [Tag] { tags.filter { $0.metadata["anchor_rel_x"] != nil } }

    var body: some View {
        List {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(rig.assetId).font(.title3.bold())
                        Text(sealedAt == nil ? "Map not sealed yet — place pins, then Save" : "Sealed \(shortDate(sealedAt!))")
                            .font(.caption).foregroundStyle(sealedAt == nil ? .orange : .secondary)
                    }
                    Spacer()
                    Button { showQR = true } label: { Label("QR", systemImage: "qrcode") }.buttonStyle(.bordered)
                }
            }

            Section("1 · Set up") {
                Button { showPlace = true } label: {
                    Label(placedTags.isEmpty ? "Place pins on real features" : "Add / remove pins (\(placedTags.count))", systemImage: "mappin.and.ellipse")
                }
                Button { startPlacing() } label: {
                    Label("Place with the QR (full Author mode)", systemImage: "qrcode.viewfinder").font(.subheadline)
                }.foregroundStyle(.secondary)
                if !placedTags.isEmpty {
                    ForEach(placedTags) { t in
                        Text(t.label).font(.subheadline)
                    }
                }
                Text("No code needed: aim the ring at a physical feature you can find again — a hinge pin, a screw head, a corner — and place a pin. Three to five is plenty. Save seals the map, with everything you looked at, as the rig's frame.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("2 · Run") {
                Picker("Run type", selection: $runType) {
                    ForEach(LabRunType.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented)
                Text(runType.detail).font(.caption).foregroundStyle(.secondary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(labRunPresets, id: \.self) { p in
                            Button(p) { runLabel = p; customLabel = "" }
                                .buttonStyle(.bordered).tint(runLabel == p ? .cyan : .gray)
                                .font(.caption)
                        }
                    }
                }
                TextField("or a custom run label", text: $customLabel)
                    .onChange(of: customLabel) { v in if !v.isEmpty { runLabel = v } }
                Button { startRun() } label: {
                    Label("Start run · \(runLabel)", systemImage: "play.fill")
                }
                .disabled(placedTags.isEmpty || sealedAt == nil)
                if placedTags.isEmpty || sealedAt == nil {
                    Text("Place pins first (Save seals the map).").font(.caption).foregroundStyle(.orange)
                }
            }

            Section("3 · History") {
                if let h = history, h.n > 0 {
                    NavigationLink { LabHistoryView(rig: rig) } label: {
                        HStack {
                            Text("\(h.n) marks · median").foregroundStyle(.secondary)
                            Spacer()
                            Text(String(format: "%.0f mm", h.medianMm)).font(.headline.monospacedDigit())
                                .foregroundStyle(h.medianMm <= 10 ? .green : h.medianMm <= 25 ? .orange : .red)
                        }
                    }
                } else {
                    Text("No marks yet").foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Rig")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showQR) {
            QRGeneratorView(anchor: rig,
                            encryptionKey: rig.encryptionKey ?? AnchorEncryption.base64(for: AnchorEncryption.getOrCreateKey(for: rig.id)),
                            qrSizeCm: rig.qrSizeCm ?? 10.0)
        }
        // Place tags: the real Author flow. AuthorModeView replaces the home
        // screen; `returnToLab` brings us back here when it ends.
        .fullScreenCover(isPresented: $showPlaceGate) {
            QRScanGateView(mode: .author, onSessionReady: {
                showPlaceGate = false
                appState.returnToLab = true
                // ModeSelectionView closes the Lab cover, then enters Author
                // mode — never swap the root view under a live cover.
                appState.labPendingMode = .author
            }, onCancel: { showPlaceGate = false })
            .environmentObject(settings).environmentObject(appState).environmentObject(tour)
        }
        // QR + map run: gate first, then the lean run view on the same session.
        .fullScreenCover(isPresented: $showRunGate, onDismiss: {
            // Present the run only once the gate cover is fully gone —
            // stacking covers mid-dismiss re-runs the run view's task.
            if pendingRun { pendingRun = false; showRun = true }
        }) {
            QRScanGateView(mode: .operator, onSessionReady: {
                pendingRun = true
                showRunGate = false
            }, onCancel: { showRunGate = false })
            .environmentObject(settings).environmentObject(appState).environmentObject(tour)
        }
        .fullScreenCover(isPresented: $showPlace, onDismiss: { Task { await load() } }) {
            LabPlaceView(rig: rig, existing: tags) { showPlace = false }
                .environmentObject(settings).environmentObject(appState)
        }
        .fullScreenCover(isPresented: $showRun, onDismiss: { Task { await load() } }) {
            LabRunView(rig: rig, tags: placedTags, runType: runType, runLabel: runLabel) { showRun = false }
                .environmentObject(settings).environmentObject(appState)
        }
        .overlay(alignment: .bottom) {
            if let e = error {
                Text(e).font(.caption).foregroundStyle(.white).padding(10)
                    .background(Color.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10)).padding()
            }
        }
    }

    private func load() async {
        async let t = client.fetchTags(anchorId: rig.id)
        async let h = client.fetchAnchorAccuracy(anchorId: rig.id)
        async let a = client.fetchAnchor(id: rig.id)
        do { tags = try await t } catch { self.error = error.localizedDescription }
        history = (try? await h)?.summary
        sealedAt = (try? await a)?.mapSealedAt ?? rig.mapSealedAt
        onChanged()
    }

    private func startPlacing() {
        appState.activeAnchor = rig
        appState.activeTags   = tags
        appState.anchorEncryptionKey = AnchorEncryption.loadExistingKey(anchorId: rig.id) ?? AnchorEncryption.getOrCreateKey(for: rig.id)
        showPlaceGate = true
    }

    private func startRun() {
        UserDefaults.standard.set(runLabel, forKey: "anchor_lab_run")
        appState.activeAnchor = rig
        appState.activeTags   = placedTags
        appState.anchorEncryptionKey = AnchorEncryption.loadExistingKey(anchorId: rig.id)
        appState.activeARSession = nil
        appState.sealedMapOrigin = nil
        appState.originLockReport = nil
        if runType == .qr { showRunGate = true } else { showRun = true }
    }

    private func shortDate(_ iso: String) -> String {
        guard let d = ISO8601DateFormatter().date(from: iso) ?? ISO8601DateFormatter.withFractional.date(from: iso) else { return iso }
        return d.formatted(date: .abbreviated, time: .shortened)
    }
}

private extension ISO8601DateFormatter {
    static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}

// ── The run ───────────────────────────────────────────────────────────────────

struct LabRunView: View {
    let rig: Anchor
    let tags: [Tag]
    let runType: LabRunType
    let runLabel: String
    let onDone: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @StateObject private var arManager = ARSessionManager()

    private enum Phase: Equatable { case loading, relocalizing, ready, failed(String) }
    @State private var phase: Phase = .loading
    @State private var origin: simd_float4x4? = nil
    @State private var markerNodes: [String: SCNNode] = [:]
    @State private var marks: [(label: String, mm: Double, ok: Bool)] = []
    @State private var showSummary = false
    @State private var history: SIBClient.AnchorAccuracySummary? = nil
    @State private var startedAt = Date()
    @State private var started = false

    private var client: SIBClient { SIBClient(settings: settings) }

    var body: some View {
        ZStack {
            ARContainerView(arManager: arManager).ignoresSafeArea()

            // Top bar
            VStack {
                HStack(spacing: 10) {
                    Button { finish() } label: {
                        Label("Done", systemImage: "checkmark").font(.caption.bold())
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.cyan, in: Capsule()).foregroundStyle(.black)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(rig.assetId).font(.caption.bold()).foregroundStyle(.white).lineLimit(1)
                        Text("\(runType.title) · \(runLabel)").font(.caption2).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                    Spacer()
                    Text("\(marks.count)/\(tags.count)").font(.caption.monospacedDigit().bold()).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4).background(Color.black.opacity(0.6), in: Capsule())
                }
                .padding(.horizontal, 16).padding(.top, 54)
                Spacer()
            }

            // Phase cards
            switch phase {
            case .loading:
                statusCard(icon: "arrow.down.circle", tint: .white, title: "Loading the rig's map…", text: nil)
            case .relocalizing:
                statusCard(icon: "arrow.triangle.2.circlepath", tint: .green,
                           title: arManager.originConfidence == .aligning ? "Matched — settling the fit" : "Relocalizing…",
                           text: arManager.originConfidence == .aligning ? "Hold the view a moment. Tags appear once the origin is still."
                                                                          : "Look at the rig from roughly where the tags were placed. No code needed.")
            case .failed(let why):
                VStack(spacing: 12) {
                    statusCard(icon: "exclamationmark.triangle.fill", tint: .orange, title: "Couldn't localize", text: why)
                    HStack {
                        Button("Try again") { Task { await start() } }.buttonStyle(.borderedProminent)
                        Button("Leave") { leave() }.buttonStyle(.bordered)
                    }
                }
            case .ready:
                AnchorLabOverlay(
                    anchorId: rig.id, tags: tags,
                    report: appState.originLockReport ?? arManager.lockReport,
                    confidence: arManager.originConfidence,
                    qrDiscrepancy: arManager.qrDiscrepancy,
                    renderedPosition: { id in markerNodes[id].map { $0.simdWorldPosition } },
                    probe: { probe() },
                    originTransform: origin,
                    client: client,
                    by: !settings.uamUserName.isEmpty ? settings.uamUserName : settings.authorName,
                    runType: runType.rawValue,
                    presetRun: runLabel,
                    onMark: { l, mm, ok in marks.append((l, mm, ok)) }
                )
            }
        }
        .task {
            // A cover presented during another cover's dismissal can appear
            // twice; the session must be set up exactly once.
            guard !started else { return }
            started = true
            await start()
        }
        .sheet(isPresented: $showSummary, onDismiss: { leave() }) { summarySheet }
    }

    // ── Session ───────────────────────────────────────────────────────────────

    private func start() async {
        startedAt = Date()
        switch runType {
        case .qr:
            // The gate did the work: relocalized (or not), origin chosen, report filled.
            guard let session = appState.activeARSession, let o = appState.anchorNormalisedTransform else {
                phase = .failed("The QR gate's session is gone — leave and start the run again."); return
            }
            arManager.linkToExistingSession(session, mapOrigin: appState.sealedMapOrigin, objectCalibration: nil)
            arManager.disableQRScanning()
            origin = o
            placeMarkers()
            phase = .ready
        case .map:
            phase = .loading
            arManager.wantsSceneMesh = settings.lidarMeshEnabled
            guard let bundle = await WorldMapCache.load(.anchor(rig.id), client: client), bundle.isSealed else {
                phase = .failed("This rig has no sealed map yet. Place tags first — Save seals it."); return
            }
            arManager.startSessionWithWorldMap(bundle.map)
            arManager.disableQRScanning()
            phase = .relocalizing
            // Wait for the trust layer: locked / approximate, or the 15 s fallback.
            // Hard stop at 40 s so a stuck session can never hang the run.
            let waitStart = Date()
            while true {
                try? await Task.sleep(nanoseconds: 150_000_000)
                if Date().timeIntervalSince(waitStart) > 40 {
                    phase = .failed("The origin never settled. Move closer to the rig and try again."); return
                }
                if arManager.relocalizationOutcome == .timedOut {
                    phase = .failed("ARKit couldn't match the map in 15 s. Stand where the tags were placed, look at the rig, and try again."); return
                }
                switch arManager.originConfidence {
                case .locked, .approximate: break
                default: continue
                }
                break
            }
            let o = arManager.currentOriginPose ?? bundle.meta.anchorPoseTransform ?? matrix_identity_float4x4
            arManager.adoptMapOrigin(o)
            origin = o
            appState.originLockReport = arManager.lockReport
            AppLog.info("lab", String(format: "map-only run localized: converge %.1f s relocalize %.1f s", arManager.lockReport.convergeS ?? 0, arManager.lockReport.relocalizeS ?? 0))
            placeMarkers()
            phase = .ready
        }
    }

    private func placeMarkers() {
        guard let o = origin else { return }
        markerNodes.values.forEach { $0.removeFromParentNode() }
        markerNodes = [:]
        for tag in tags {
            guard let x = num(tag.metadata["anchor_rel_x"]), let y = num(tag.metadata["anchor_rel_y"]), let z = num(tag.metadata["anchor_rel_z"]) else { continue }
            let p = ARCoordinateFrame.toWorldSpace(anchorRelativePos: simd_float3(Float(x), Float(y), Float(z)), anchorTransform: o)
            let node = LabMarker.make(label: tag.label)
            node.simdPosition = p
            arManager.sceneView.scene.rootNode.addChildNode(node)
            markerNodes[tag.id] = node
        }
        // Origin marker — a small cyan axis at the rig's origin, so the tester
        // can also see where the app thinks the QR is.
        let axis = LabMarker.axis()
        axis.simdTransform = o
        arManager.sceneView.scene.rootNode.addChildNode(axis)
    }

    private func probe() -> (hit: simd_float3, camera: simd_float3)? {
        let view = arManager.sceneView
        let centre = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        guard let cam = view.session.currentFrame?.camera.transform else { return nil }
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        for target in [ARRaycastQuery.Target.existingPlaneGeometry, .estimatedPlane] {
            if let q = view.raycastQuery(from: centre, allowing: target, alignment: .any),
               let hit = view.session.raycast(q).first {
                let p = hit.worldTransform.columns.3
                return (simd_float3(p.x, p.y, p.z), camPos)
            }
        }
        return nil
    }

    private func finish() {
        Task { history = try? await client.fetchAnchorAccuracy(anchorId: rig.id).summary }
        showSummary = true
    }

    /// Explicit exit: only now is the AR session released.
    private func leave() {
        arManager.pauseSession()
        appState.activeARSession = nil
        onDone()
    }

    private func num(_ any: AnyCodable?) -> Double? {
        guard let any else { return nil }
        if let d = any.value as? Double { return d }
        if let i = any.value as? Int { return Double(i) }
        return nil
    }

    // ── Bits ──────────────────────────────────────────────────────────────────

    private func statusCard(icon: String, tint: Color, title: String, text: String?) -> some View {
        VStack {
            Spacer()
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title2).foregroundStyle(tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline).foregroundStyle(.white)
                    if let text { Text(text).font(.caption).foregroundStyle(.white.opacity(0.75)) }
                }
                Spacer()
            }
            .padding(16).background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24).padding(.bottom, 60)
        }
    }

    private var summarySheet: some View {
        let mms = marks.map { $0.mm }.sorted()
        let median: Double = mms.isEmpty ? 0 : (mms.count % 2 == 1 ? mms[mms.count / 2] : (mms[mms.count / 2 - 1] + mms[mms.count / 2]) / 2)
        let report = appState.originLockReport ?? arManager.lockReport
        return NavigationStack {
            List {
                Section("This run · \(runType.title) · \(runLabel)") {
                    HStack { Text("Marks"); Spacer(); Text("\(marks.count) of \(tags.count)").foregroundStyle(.secondary) }
                    HStack { Text("Median error"); Spacer()
                        Text(marks.isEmpty ? "—" : String(format: "%.0f mm", median)).font(.headline.monospacedDigit())
                            .foregroundStyle(median <= 10 ? .green : median <= 25 ? .orange : .red) }
                    if let s = report.relocalizeS { HStack { Text("Relocalize"); Spacer(); Text(String(format: "%.1f s", s)).foregroundStyle(.secondary) } }
                    if let s = report.convergeS   { HStack { Text("Converge");   Spacer(); Text(String(format: "%.1f s", s)).foregroundStyle(.secondary) } }
                    HStack { Text("Origin"); Spacer(); Text(report.source).foregroundStyle(.secondary) }
                    HStack { Text("Corrections"); Spacer(); Text("\(arManager.originCorrections)").foregroundStyle(.secondary) }
                    HStack { Text("Duration"); Spacer(); Text(String(format: "%.0f s", Date().timeIntervalSince(startedAt))).foregroundStyle(.secondary) }
                }
                if !marks.isEmpty {
                    Section("Marks") {
                        ForEach(Array(marks.enumerated()), id: \.offset) { _, m in
                            HStack { Text(m.label); Spacer()
                                Text(String(format: "%.0f mm", m.mm)).monospacedDigit()
                                    .foregroundStyle(m.mm <= 10 ? .green : m.mm <= 25 ? .orange : .red)
                                if !m.ok { Image(systemName: "icloud.slash").foregroundStyle(.orange) } }
                        }
                    }
                }
                Section("Rig so far") {
                    if let h = history, h.n > 0 {
                        HStack { Text("All runs"); Spacer(); Text(String(format: "%d marks · median %.0f mm", h.n, h.medianMm)).foregroundStyle(.secondary) }
                        ForEach(h.byRunType ?? []) { b in
                            HStack { Text(b.key == "map" ? "Map only" : "QR + map"); Spacer(); Text(String(format: "%d · %.0f mm", b.n, b.medianMm)).foregroundStyle(.secondary) }
                        }
                    } else { Text("First marks for this rig.").foregroundStyle(.secondary) }
                }
                Section {
                    Text("≤ 10 mm good · ≤ 25 mm acceptable · above: check relocalize time, approach angle, lighting. Two viewpoints per tag cancel most aiming error.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Run summary")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSummary = false } } }
        }
    }
}

// ── History ───────────────────────────────────────────────────────────────────

struct LabHistoryView: View {
    let rig: Anchor
    @EnvironmentObject private var settings: AppSettings
    @State private var record: SIBClient.AnchorAccuracyRecord? = nil
    @State private var error: String? = nil

    var body: some View {
        List {
            if let r = record {
                Section("Summary") {
                    row("Marks", "\(r.summary.n)")
                    row("Median", String(format: "%.0f mm", r.summary.medianMm))
                    row("p90", String(format: "%.0f mm", r.summary.p90Mm))
                    row("Worst", String(format: "%.0f mm", r.summary.maxMm))
                }
                bucketSection("Run type", r.summary.byRunType ?? [], rename: { $0 == "map" ? "Map only" : $0 == "qr" ? "QR + map" : $0 })
                bucketSection("Device", r.summary.byDevice)
                bucketSection("Origin", r.summary.byOrigin)
                bucketSection("Run", r.summary.byRun)
                Section("All marks (\(r.samples.count))") {
                    ForEach(Array(r.samples.reversed().prefix(200).enumerated()), id: \.offset) { _, s in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(s.tagLabel ?? s.tagId).font(.subheadline)
                                Text([s.run, s.runType.map { $0 == "map" ? "map only" : "QR + map" }, s.device].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(String(format: "%.0f mm", s.errorMm)).monospacedDigit()
                                .foregroundStyle(s.errorMm <= 10 ? .green : s.errorMm <= 25 ? .orange : .red)
                        }
                    }
                }
                Section {
                    Button("Clear all marks for this rig", role: .destructive) {
                        Task { try? await SIBClient(settings: settings).clearAnchorAccuracy(anchorId: rig.id); record = nil; await load() }
                    }
                }
            } else if let e = error { Text(e).foregroundStyle(.red) } else { ProgressView() }
        }
        .navigationTitle("History")
        .task { await load() }
    }

    private func load() async {
        do { record = try await SIBClient(settings: settings).fetchAnchorAccuracy(anchorId: rig.id) }
        catch { self.error = error.localizedDescription }
    }
    private func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k); Spacer(); Text(v).foregroundStyle(.secondary).monospacedDigit() }
    }
    @ViewBuilder
    private func bucketSection(_ title: String, _ rows: [SIBClient.AnchorAccuracyBucket], rename: @escaping (String) -> String = { $0 }) -> some View {
        if !rows.isEmpty {
            Section(title) {
                ForEach(rows) { b in
                    HStack { Text(rename(b.key)); Spacer()
                        Text(String(format: "%d · median %.0f · p90 %.0f mm", b.n, b.medianMm, b.p90Mm)).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                }
            }
        }
    }
}

// ── Markers ───────────────────────────────────────────────────────────────────

enum LabMarker {
    /// A 2.5 cm cyan sphere with a floating label — deliberately plain so the
    /// eye judges the sphere's centre against the physical feature.
    static func make(label: String) -> SCNNode {
        let root = SCNNode()
        let s = SCNSphere(radius: 0.0125)
        s.firstMaterial?.diffuse.contents = UIColor.cyan
        s.firstMaterial?.emission.contents = UIColor.cyan.withAlphaComponent(0.5)
        root.addChildNode(SCNNode(geometry: s))
        let text = SCNText(string: label, extrusionDepth: 0.2)
        text.font = UIFont.systemFont(ofSize: 6, weight: .semibold)
        text.firstMaterial?.diffuse.contents = UIColor.white
        text.flatness = 0.3
        let tn = SCNNode(geometry: text)
        let (mn, mx) = text.boundingBox
        tn.scale = SCNVector3(0.004, 0.004, 0.004)
        tn.position = SCNVector3(-(mx.x - mn.x) * 0.002, 0.02, 0)
        tn.constraints = [SCNBillboardConstraint()]
        root.addChildNode(tn)
        return root
    }

    /// A 6 cm axis triad at the origin (x red, y green, z blue).
    static func axis() -> SCNNode {
        let root = SCNNode()
        for (dir, color) in [(SCNVector3(1, 0, 0), UIColor.systemRed), (SCNVector3(0, 1, 0), UIColor.systemGreen), (SCNVector3(0, 0, 1), UIColor.systemBlue)] {
            let cyl = SCNCylinder(radius: 0.0015, height: 0.06)
            cyl.firstMaterial?.diffuse.contents = color
            let n = SCNNode(geometry: cyl)
            n.position = SCNVector3(dir.x * 0.03, dir.y * 0.03, dir.z * 0.03)
            if dir.x == 1 { n.eulerAngles.z = -.pi / 2 } else if dir.z == 1 { n.eulerAngles.x = .pi / 2 }
            root.addChildNode(n)
        }
        return root
    }
}

// ── Place tags without a code ─────────────────────────────────────────────────
//
// The Lab measures the world-map anchoring, so authoring should not depend on
// the QR either: the rig is picked from the list (identity known), the map's
// own frame is the origin, and Save seals the map with `sib-origin` in it.
// Looks and behaves like Place Steps in AR OMS: focus ring at the crosshair,
// one button to drop a pin where the ring sits, name it, Save. Lab pins are
// real tags (anchor_rel_* relative to the map origin), so every run type —
// Map only or QR + map — reads them unchanged.

struct LabPlaceView: View {
    let rig: Anchor
    let existing: [Tag]
    let onDone: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @StateObject private var arManager = ARSessionManager()

    private enum Phase: Equatable { case starting, relocalizing, ready, saving, failed(String) }
    @State private var phase: Phase = .starting
    @State private var origin: simd_float4x4 = matrix_identity_float4x4
    @State private var tags: [Tag] = []
    @State private var nodes: [String: SCNNode] = [:]
    @State private var focusRing: ARFocusRing? = nil
    @State private var ringTracking = false
    @State private var pendingPos: simd_float3? = nil
    @State private var askLabel = false
    @State private var newLabel = ""
    @State private var toast: String? = nil
    @State private var started = false
    @State private var dirty = false
    private let ticker = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    private var client: SIBClient { SIBClient(settings: settings) }

    var body: some View {
        ZStack {
            ARContainerView(arManager: arManager).ignoresSafeArea()

            VStack {
                HStack(spacing: 10) {
                    Button("Cancel") { leave() }
                        .font(.body).foregroundStyle(.white.opacity(0.85))
                    Spacer()
                    Text(rig.assetId).font(.headline).foregroundStyle(.white).lineLimit(1)
                    Spacer()
                    Button { Task { await save() } } label: {
                        Text(phase == .saving ? "Saving…" : "Save")
                            .font(.body.bold())
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(Color.cyan, in: Capsule()).foregroundStyle(.black)
                    }
                    .disabled(phase != .ready || tags.isEmpty)
                }
                .padding(.horizontal, 16).padding(.top, 54)
                Spacer()
            }

            switch phase {
            case .starting:
                card(icon: "camera.viewfinder", tint: .white, title: "Starting…", text: nil)
            case .relocalizing:
                card(icon: "arrow.triangle.2.circlepath", tint: .green,
                     title: arManager.originConfidence == .aligning ? "Matched — settling" : "Matching the rig's map…",
                     text: "Look at the rig from where you placed the tags. Existing pins appear once the fit is steady.")
            case .failed(let why):
                VStack(spacing: 12) {
                    card(icon: "exclamationmark.triangle.fill", tint: .orange, title: "Couldn't match the map", text: why)
                    HStack {
                        Button("Try again") { Task { await start() } }.buttonStyle(.borderedProminent)
                        Button("Start over (new map)") { Task { await startFresh() } }.buttonStyle(.bordered)
                    }
                }
            case .ready, .saving:
                VStack {
                    Spacer()
                    // Pin strip
                    if !tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(tags) { t in
                                    HStack(spacing: 4) {
                                        Text(t.label).font(.caption.bold())
                                        Button { Task { await remove(t) } } label: { Image(systemName: "xmark.circle.fill") }
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(Color.black.opacity(0.6), in: Capsule()).foregroundStyle(.white)
                                }
                            }.padding(.horizontal, 16)
                        }
                    }
                    HStack(spacing: 12) {
                        Text(ringTracking ? "Aim the ring at a real feature, then place" : "Move the phone slowly until the ring finds a surface")
                            .font(.subheadline).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                        Button {
                            guard let t = focusRing?.lastHitTransform else { return }
                            pendingPos = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
                            newLabel = "Pin \(tags.count + 1)"
                            askLabel = true
                        } label: {
                            Image(systemName: "plus").font(.title2.bold())
                                .frame(width: 56, height: 56)
                                .background(ringTracking ? Color.cyan : Color.gray, in: Circle()).foregroundStyle(.black)
                        }
                        .disabled(!ringTracking || phase == .saving)
                    }
                    .padding(.horizontal, 16).padding(.bottom, 28)
                }
            }

            if let t = toast {
                VStack { Spacer(); Text(t).font(.caption).foregroundStyle(.white).padding(10)
                    .background(Color.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 10)).padding(.bottom, 120) }
            }
        }
        .task { guard !started else { return }; started = true; await start() }
        .onReceive(ticker) { _ in
            guard phase == .ready, let ring = focusRing else { return }
            ring.update(sceneView: arManager.sceneView)
            if ringTracking != ring.isTracking { ringTracking = ring.isTracking }
        }
        .alert("Name this pin", isPresented: $askLabel) {
            TextField("hinge pin, screw head, corner…", text: $newLabel)
            Button("Place") { Task { await place() } }
            Button("Cancel", role: .cancel) { pendingPos = nil }
        } message: { Text("Name the physical feature so a tester can aim at it later.") }
    }

    // ── Session ───────────────────────────────────────────────────────────────

    private func start() async {
        tags = existing.filter { $0.metadata["anchor_rel_x"] != nil }
        arManager.wantsSceneMesh = settings.lidarMeshEnabled
        if let bundle = await WorldMapCache.load(.anchor(rig.id), client: client), bundle.isSealed, !tags.isEmpty {
            // Extend the existing map: relocalize, then place more pins in its frame.
            arManager.startSessionWithWorldMap(bundle.map)
            arManager.disableQRScanning()
            phase = .relocalizing
            let t0 = Date()
            while true {
                try? await Task.sleep(nanoseconds: 150_000_000)
                if arManager.relocalizationOutcome == .timedOut {
                    phase = .failed("ARKit couldn't match the rig's map in 15 s. Stand where you placed the pins, or start over with a new map."); return
                }
                if Date().timeIntervalSince(t0) > 40 { phase = .failed("The origin never settled."); return }
                if case .locked = arManager.originConfidence { break }
                if case .approximate = arManager.originConfidence { break }
            }
            origin = arManager.currentOriginPose ?? bundle.meta.anchorPoseTransform ?? matrix_identity_float4x4
            arManager.adoptMapOrigin(origin)
        } else {
            await startFresh()
            return
        }
        becomeReady()
    }

    /// New map: the session's own frame is the rig's frame; origin = identity.
    private func startFresh() async {
        tags = []
        nodes.values.forEach { $0.removeFromParentNode() }; nodes = [:]
        arManager.startSession()
        arManager.disableQRScanning()
        origin = matrix_identity_float4x4
        phase = .starting
        // Wait for tracking so the ring has something to hit.
        for _ in 0..<100 {
            if case .normal = arManager.trackingState { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        arManager.plantOriginAnchor(at: origin)
        arManager.noteQROrigin()
        dirty = true
        becomeReady()
    }

    private func becomeReady() {
        focusRing = ARFocusRing(sceneView: arManager.sceneView)
        for t in tags { drawPin(t) }
        phase = .ready
    }

    private func drawPin(_ t: Tag) {
        guard let x = num(t.metadata["anchor_rel_x"]), let y = num(t.metadata["anchor_rel_y"]), let z = num(t.metadata["anchor_rel_z"]) else { return }
        let p = ARCoordinateFrame.toWorldSpace(anchorRelativePos: simd_float3(Float(x), Float(y), Float(z)), anchorTransform: origin)
        let node = LabMarker.make(label: t.label)
        node.simdPosition = p
        arManager.sceneView.scene.rootNode.addChildNode(node)
        nodes[t.id] = node
    }

    private func place() async {
        guard let p = pendingPos else { return }
        let label = newLabel.trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return }
        pendingPos = nil
        let rel = ARCoordinateFrame.toAnchorRelative(worldPos: p, anchorTransform: origin)
        let meta: [String: AnyCodable] = [
            "pos_x": AnyCodable(Double(p.x)), "pos_y": AnyCodable(Double(p.y)), "pos_z": AnyCodable(Double(p.z)),
            "anchor_rel_x": AnyCodable(Double(rel.x)), "anchor_rel_y": AnyCodable(Double(rel.y)), "anchor_rel_z": AnyCodable(Double(rel.z)),
            "lab": AnyCodable(true),
        ]
        let req = CreateTagRequest(anchorId: rig.id, type: .presenceCheck, label: label,
                                   expectedOutcome: "\(label) is where the tag says", checkDescription: nil,
                                   order: tags.count + 1, groupId: nil, metadata: meta)
        do {
            let tag = try await client.createTag(req)
            tags.append(tag)
            drawPin(tag)
            dirty = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        } catch { show("Couldn't save the pin: \(error.localizedDescription)") }
    }

    private func remove(_ t: Tag) async {
        do {
            try await client.deleteTag(id: t.id)
            nodes[t.id]?.removeFromParentNode(); nodes[t.id] = nil
            tags.removeAll { $0.id == t.id }
            dirty = true
        } catch { show("Couldn't delete: \(error.localizedDescription)") }
    }

    /// Seal: the map as it is NOW (with every pin's surroundings in it) + the origin.
    private func save() async {
        phase = .saving
        arManager.ensureOriginAnchor(fallback: origin)
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard let mapData = await arManager.saveCurrentWorldMap() else { show("Couldn't capture the map — move a little and try again"); phase = .ready; return }
        let sealedBy = !settings.uamUserName.isEmpty ? settings.uamUserName : settings.authorName
        do {
            try await client.uploadWorldMap(anchorId: rig.id, data: mapData)
            let meta = try await client.uploadWorldMapMeta(anchorId: rig.id, anchorPose: origin, sealedBy: sealedBy)
            WorldMapCache.store(.anchor(rig.id), map: mapData, meta: meta)
            AppLog.info("lab", "rig sealed without a code (\(mapData.count / 1024) KB, \(tags.count) pins)")
            leave()
        } catch {
            WorldMapCache.store(.anchor(rig.id), map: mapData, meta: WorldMapMeta())
            show("Upload failed — kept on this device: \(error.localizedDescription)")
            phase = .ready
        }
    }

    private func leave() {
        focusRing?.cleanup(); focusRing = nil
        arManager.pauseSession()
        onDone()
    }

    private func show(_ s: String) {
        toast = s
        Task { try? await Task.sleep(nanoseconds: 3_000_000_000); if toast == s { toast = nil } }
    }

    private func num(_ any: AnyCodable?) -> Double? {
        guard let any else { return nil }
        if let d = any.value as? Double { return d }
        if let i = any.value as? Int { return Double(i) }
        return nil
    }

    private func card(icon: String, tint: Color, title: String, text: String?) -> some View {
        VStack {
            Spacer()
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title2).foregroundStyle(tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline).foregroundStyle(.white)
                    if let text { Text(text).font(.caption).foregroundStyle(.white.opacity(0.75)) }
                }
                Spacer()
            }
            .padding(16).background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24).padding(.bottom, 60)
        }
    }
}
