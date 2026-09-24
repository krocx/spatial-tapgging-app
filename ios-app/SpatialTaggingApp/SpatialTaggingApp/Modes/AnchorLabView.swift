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
// Placing tags is tap-to-tag on the rig's own world map (no code); the QR
// path (gate + AuthorModeView) remains for QR + map runs. A lab tag is a
// real tag — same metadata, same seal, same trust layer. Nothing in here is
// a second implementation of anchoring; it is the product measured.
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
    /// Tags placed and the map sealed — the only state a run makes sense in.
    private var runReady: Bool { !placedTags.isEmpty && sealedAt != nil }

    var body: some View {
        List {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(rig.assetId).font(.title3.bold())
                        Text(sealedAt == nil ? "Map not sealed yet — tap to tag, then Save" : "Sealed \(shortDate(sealedAt!))")
                            .font(.caption).foregroundStyle(sealedAt == nil ? .orange : .secondary)
                    }
                    Spacer()
                    // The code only matters for QR + map runs — no QR clutter otherwise.
                    if runReady, runType == .qr {
                        Button { showQR = true } label: { Label("QR", systemImage: "qrcode") }.buttonStyle(.bordered)
                    }
                }
            }

            Section("1 · Set up") {
                Button { showPlace = true } label: {
                    Label(placedTags.isEmpty ? "Tap to tag real features" : "Add / remove tags (\(placedTags.count))", systemImage: "mappin.and.ellipse")
                        .font(.body.bold()).frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent).tint(.cyan).foregroundStyle(.black)
                if runReady, runType == .qr {
                    Button { startPlacing() } label: {
                        Label("Place with the QR (full Author mode)", systemImage: "qrcode.viewfinder").font(.subheadline)
                    }.foregroundStyle(.secondary)
                }
                if !placedTags.isEmpty {
                    ForEach(placedTags) { t in
                        Text(t.label).font(.subheadline)
                    }
                }
                Text(runReady ? "Tap to tag again to add or remove tags; Save re-seals the map."
                              : "No code needed: tap a physical feature you can find again — a hinge pin, a screw head, a corner. Three to five is plenty. Save seals the map, with everything you looked at, as the rig's frame.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            // The run section appears only once there is something to run.
            if runReady { Section("2 · Run") {
                Picker("Run type", selection: $runType) {
                    ForEach(LabRunType.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented)
                Text(runType.detail).font(.caption).foregroundStyle(.secondary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(labRunPresets, id: \.self) { p in
                            Button(p) { runLabel = p; customLabel = "" }
                                .buttonStyle(.bordered).tint(runLabel == p ? .cyan : .gray)
                                .font(.subheadline).controlSize(.large)
                        }
                    }
                }
                TextField("or a custom run label", text: $customLabel)
                    .onChange(of: customLabel) { v in if !v.isEmpty { runLabel = v } }
                Button { startRun() } label: {
                    Label("Start run · \(runLabel)", systemImage: "play.fill")
                        .font(.body.bold()).frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent).tint(.cyan).foregroundStyle(.black)
            } }

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
    @State private var truthNodes: [SCNNode] = []
    @State private var axisNode: SCNNode? = nil
    @State private var marks: [(label: String, mm: Double, ok: Bool)] = []
    @State private var showSummary = false
    @State private var history: SIBClient.AnchorAccuracySummary? = nil
    @State private var startedAt = Date()
    @State private var started = false

    // The lab panel and the origin axes are OFF by default: a run is first of
    // all "do the tags sit on the features?" seen with a clean screen.
    @State private var showLab  = false
    @State private var showAxes = false
    @State private var armedTagId: String? = nil
    @State private var truthRing: ARFocusRing? = nil
    @State private var ringTracking = false
    @State private var sending = false
    @State private var toast: String? = nil
    @State private var tucked = Set<String>()
    private let ticker = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    private var client: SIBClient { SIBClient(settings: settings) }
    private var report: ARSessionManager.OriginLockReport { appState.originLockReport ?? arManager.lockReport }

    var body: some View {
        ZStack {
            PlacementGestureContainer(arManager: arManager, tool: .move, active: false,
                                      onTap: phase == .ready ? handleTap : nil)
                .ignoresSafeArea()

            // Top bar: Done · rig/run · toggles · progress
            VStack {
                HStack(spacing: 8) {
                    Button { finish() } label: {
                        Label("Done", systemImage: "checkmark").font(.subheadline.bold())
                            .padding(.horizontal, 16).padding(.vertical, 11)
                            .background(Color.cyan, in: Capsule()).foregroundStyle(.black)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(rig.assetId).font(.caption.bold()).foregroundStyle(.white).lineLimit(1)
                        Text("\(runType.title) · \(runLabel)").font(.caption2).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                    Spacer()
                    toggle("move.3d", on: showAxes) { showAxes.toggle(); axisNode?.isHidden = !showAxes }
                    toggle("scope",   on: showLab)  { withAnimation(.easeInOut(duration: 0.2)) { showLab.toggle() }; if !showLab { disarm() } }
                    Text("\(marks.count)/\(tags.count)").font(.caption.monospacedDigit().bold()).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4).background(Color.black.opacity(0.6), in: Capsule())
                }
                .padding(.horizontal, 16).padding(.top, 54)
                Spacer()
            }

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
                VStack {
                    Spacer()
                    if arManager.isRelocalizing {
                        hintPill("Relocalizing — hold the rig in view", icon: "arrow.triangle.2.circlepath", tint: .orange)
                    } else if showLab {
                        labPanel
                    } else if let t = toast {
                        hintPill(t, icon: "info.circle", tint: .white)
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .task {
            // A cover presented during another cover's dismissal can appear
            // twice; the session must be set up exactly once.
            guard !started else { return }
            started = true
            await start()
        }
        .onReceive(ticker) { _ in
            if phase == .ready, let cam = arManager.sceneView.session.currentFrame?.camera.transform {
                LabMarker.updateTuck(markerNodes, camera: simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z), tucked: &tucked)
            }
            guard let ring = truthRing else { return }
            ring.update(sceneView: arManager.sceneView)
            if ringTracking != ring.isTracking { ringTracking = ring.isTracking }
        }
        .sheet(isPresented: $showSummary, onDismiss: { leave() }) { summarySheet }
    }

    // ── Lab panel (bottom-docked so it never sits on the rig) ────────────────

    private var labPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Lock report — two compact columns
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    labRow("Origin", sourceLabel, tint: sourceTint)
                    if let s = report.relocalizeS { labRow("Relocalize", String(format: "%.1f s", s)) }
                    if let s = report.convergeS   { labRow("Converge",   String(format: "%.1f s", s)) }
                }
                VStack(alignment: .leading, spacing: 2) {
                    if let a = report.approachDeg { labRow("Approach", String(format: "%.0f°", a)) }
                    if let l = report.lightLux    { labRow("Light",    String(format: "%.0f", l)) }
                    labRow("Surface", ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) ? "LiDAR mesh" : "est. plane",
                           tint: ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) ? .green : .orange)
                    if let d = arManager.qrDiscrepancy {
                        labRow("QR vs origin", String(format: "%.0f mm", d.mm), tint: d.mm > 20 ? .orange : .green)
                    } else {
                        labRow("Corrections", "\(arManager.originCorrections)")
                    }
                }
            }
            Divider().overlay(Color.white.opacity(0.2))
            Text(armedTagId == nil ? "Tap a tag (or a chip), then aim the orange ring at its real feature"
                                   : (ringTracking ? "Aim the orange ring at the feature, then tap — or Mark" : "Move closer until the ring finds the surface"))
                .font(.subheadline).foregroundStyle(.white.opacity(0.8))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(tags) { tag in
                        let placed = markerNodes[tag.id] != nil
                        Button { if armedTagId == tag.id { disarm() } else { arm(tag.id) } } label: {
                            Text(tag.label).font(.subheadline.bold()).lineLimit(1)
                                .padding(.horizontal, 16).padding(.vertical, 11)
                                .background(armedTagId == tag.id ? Color.orange : Color.white.opacity(placed ? 0.14 : 0.05), in: Capsule())
                                .foregroundStyle(armedTagId == tag.id ? .black : (placed ? .white : .white.opacity(0.4)))
                        }
                        .disabled(!placed)
                    }
                }
            }
            if let id = armedTagId {
                Button { mark(tagId: id) } label: {
                    HStack {
                        if sending { ProgressView().tint(.black).scaleEffect(0.7) }
                        Text("Mark where it really is").font(.body.bold())
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(ringTracking ? Color.orange : Color.gray, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.black)
                }
                .disabled(sending || !ringTracking)
            }
            if !marks.isEmpty {
                Divider().overlay(Color.white.opacity(0.2))
                ForEach(Array(marks.suffix(3).enumerated()), id: \.offset) { _, r in
                    HStack {
                        Text(r.label).font(.caption2).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                        Spacer()
                        Text(String(format: "%.0f mm", r.mm)).font(.caption2.monospacedDigit().bold())
                            .foregroundStyle(r.mm <= 10 ? .green : r.mm <= 25 ? .orange : .red)
                        Image(systemName: r.ok ? "checkmark.icloud" : "icloud.slash").font(.caption2)
                            .foregroundStyle(r.ok ? .green : .orange)
                    }
                }
                let med = median(marks.map { $0.mm })
                labRow("Median (\(marks.count))", String(format: "%.0f mm", med), tint: med <= 10 ? .green : med <= 25 ? .orange : .red)
            }
            if let t = toast { Text(t).font(.caption2).foregroundStyle(.orange).lineLimit(2) }
        }
        .padding(12)
        .background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }

    // ── Session ───────────────────────────────────────────────────────────────

    private func start() async {
        startedAt = Date()
        // The Lab measures millimetres: pins and truth marks must land on the
        // real surface, so the scene mesh is always on here (LiDAR devices).
        arManager.wantsSceneMesh = true
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
        tucked = []
        for (i, tag) in tags.enumerated() {
            guard let x = num(tag.metadata["anchor_rel_x"]), let y = num(tag.metadata["anchor_rel_y"]), let z = num(tag.metadata["anchor_rel_z"]) else { continue }
            let p = ARCoordinateFrame.toWorldSpace(anchorRelativePos: simd_float3(Float(x), Float(y), Float(z)), anchorTransform: o)
            let node = LabMarker.pin(number: i + 1)
            node.simdPosition = p
            arManager.sceneView.scene.rootNode.addChildNode(node)
            markerNodes[tag.id] = node
        }
        // Origin axes — where the app thinks the rig's frame is. Hidden until
        // the tester asks for them.
        axisNode?.removeFromParentNode()
        let axis = LabMarker.axis()
        axis.simdTransform = o
        axis.isHidden = !showAxes
        arManager.sceneView.scene.rootNode.addChildNode(axis)
        axisNode = axis
    }

    // ── Marking ───────────────────────────────────────────────────────────────

    /// Tap on a tag → arm it (the lab panel opens, the orange ring appears).
    /// Tap anywhere while armed → mark where the ring sits.
    private func handleTap(_ point: CGPoint) {
        guard !arManager.isRelocalizing else { return }
        if let id = armedTagId {
            mark(tagId: id)
            return
        }
        let sv = arManager.sceneView
        let hits = sv.hitTest(point, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                if let entry = markerNodes.first(where: { $0.value === n }) {
                    withAnimation(.easeInOut(duration: 0.2)) { showLab = true }
                    arm(entry.key)
                    return
                }
                candidate = n.parent
            }
        }
    }

    private func arm(_ tagId: String) {
        armedTagId = tagId
        if truthRing == nil { truthRing = ARFocusRing(sceneView: arManager.sceneView, accent: .systemOrange) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func disarm() {
        armedTagId = nil
        truthRing?.cleanup(); truthRing = nil
        ringTracking = false
    }

    private func mark(tagId: String) {
        guard !sending else { return }
        guard let rendered = markerNodes[tagId]?.simdWorldPosition else { show("Tag isn't placed yet"); return }
        guard let ring = truthRing, let t = ring.lastHitTransform,
              let cam = arManager.sceneView.session.currentFrame?.camera.transform else {
            show("No surface under the ring — move closer"); return
        }
        let hit    = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        let label  = tags.first { $0.id == tagId }?.label ?? tagId
        let (sample, mm) = AnchorLabOverlay.makeSample(
            tagId: tagId, label: label, rendered: rendered, hit: hit, camera: camPos,
            originTransform: origin, confidence: arManager.originConfidence, report: report,
            qrDiscrepancy: arManager.qrDiscrepancy, run: runLabel,
            by: !settings.uamUserName.isEmpty ? settings.uamUserName : settings.authorName,
            runType: runType.rawValue)

        // Leave the truth where it was marked + a hairline to the tag, so the
        // offset is visible in the room, not just as a number.
        let truth = LabMarker.truth()
        truth.simdPosition = hit
        arManager.sceneView.scene.rootNode.addChildNode(truth)
        let line = LabMarker.line(from: hit, to: rendered)
        arManager.sceneView.scene.rootNode.addChildNode(line)
        truthNodes.append(contentsOf: [truth, line])
        ARPinFX.drop(on: truth, accent: .systemOrange)

        disarm()
        sending = true
        toast = nil
        AppLog.info("lab", String(format: "Anchor Lab mark %@: %.1f mm (%@)", label, mm, sample.originSource))
        Task {
            var ok = true
            do { try await client.postAnchorAccuracy(anchorId: rig.id, sample: sample) }
            catch { ok = false; show("Saved locally only — \(error.localizedDescription)") }
            marks.append((label, mm, ok))
            sending = false
        }
    }

    private func finish() {
        Task { history = try? await client.fetchAnchorAccuracy(anchorId: rig.id).summary }
        showSummary = true
    }

    /// Explicit exit: only now is the AR session released.
    private func leave() {
        disarm()
        arManager.pauseSession()
        appState.activeARSession = nil
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

    // ── Bits ──────────────────────────────────────────────────────────────────

    private var sourceLabel: String {
        switch arManager.originConfidence {
        case .approximate: return "approximate"
        case .relocalizing: return "relocalizing…"
        case .aligning: return "aligning…"
        default: return report.source
        }
    }
    private var sourceTint: Color {
        switch arManager.originConfidence {
        case .approximate: return .orange
        case .locked: return .green
        default: return .white
        }
    }
    private func labRow(_ k: String, _ v: String, tint: Color = .white) -> some View {
        HStack(spacing: 6) {
            Text(k).font(.caption).foregroundStyle(.white.opacity(0.6))
            Spacer(minLength: 4)
            Text(v).font(.caption.monospacedDigit()).foregroundStyle(tint)
        }
    }
    private func median(_ xs: [Double]) -> Double {
        let s = xs.sorted(); guard !s.isEmpty else { return 0 }
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }
    private func toggle(_ icon: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.body.bold())
                .frame(width: 44, height: 44)
                .background(on ? Color.cyan : Color.black.opacity(0.6), in: Circle())
                .foregroundStyle(on ? .black : .white)
        }
    }
    private func hintPill(_ text: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text).font(.caption).foregroundStyle(.white)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Color.black.opacity(0.7), in: Capsule())
    }

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
    /// The AR OMS pin — sphere, ring, numbered badge — in the Lab's cyan. The
    /// sphere's centre IS the tag position, which is what a truth mark is
    /// measured against.
    static func pin(number: Int) -> SCNNode {
        let color = UIColor.cyan
        let root  = SCNNode()

        let sphere = SCNSphere(radius: 0.015)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.55)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        let torus        = SCNTorus()
        torus.ringRadius = 0.023
        torus.pipeRadius = 0.004
        let tMat         = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(0.4)
        tMat.lightingModel     = .constant
        torus.firstMaterial    = tMat
        let ring               = SCNNode(geometry: torus)
        ring.eulerAngles       = SCNVector3(Float.pi / 2, 0, 0)
        ring.name              = "ring"
        root.addChildNode(ring)

        let badge = numberBadge(number: number, color: color)
        badge.simdPosition = simd_float3(0, 0.055, 0)
        badge.name         = "badge"
        root.addChildNode(badge)
        return root
    }

    /// AR OMS proximity tuck, verbatim: under 0.35 m the pin folds to a small
    /// dot (badge and ring fade, 220 ms); past 0.5 m it registers back. Up
    /// close the tag must not hide the feature it marks — which is also what
    /// makes a drift mark honest: the tester sees the feature, not the tag.
    static func updateTuck(_ nodes: [String: SCNNode], camera: simd_float3, tucked: inout Set<String>) {
        for (id, pin) in nodes {
            let dist = simd_length(pin.simdWorldPosition - camera)
            let was  = tucked.contains(id)
            let now  = was ? dist < 0.5 : dist < 0.35
            guard now != was else { continue }
            if now { tucked.insert(id) } else { tucked.remove(id) }
            let scale = SCNAction.scale(to: now ? 0.3 : 1.0, duration: 0.22)
            scale.timingMode = .easeOut
            pin.runAction(scale, forKey: "tuck")
            for child in pin.childNodes where child.name == "badge" || child.name == "ring" {
                child.runAction(.fadeOpacity(to: now ? 0 : 1, duration: 0.22), forKey: "tuck")
            }
        }
    }

    private static func numberBadge(number: Int, color: UIColor) -> SCNNode {
        let side: CGFloat = 96
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let img = renderer.image { _ in
            color.withAlphaComponent(0.92).setFill()
            UIBezierPath(ovalIn: CGRect(x: 4, y: 4, width: side - 8, height: side - 8)).fill()
            UIColor.white.withAlphaComponent(0.65).setStroke()
            let ring = UIBezierPath(ovalIn: CGRect(x: 5, y: 5, width: side - 10, height: side - 10))
            ring.lineWidth = 3.5; ring.stroke()
            let str  = "\(number)" as NSString
            let para = NSMutableParagraphStyle(); para.alignment = .center
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: side * 0.44, weight: .black),
                .foregroundColor: UIColor.black,
                .paragraphStyle: para,
            ]
            let ts = str.size(withAttributes: attrs)
            str.draw(at: CGPoint(x: (side - ts.width) / 2, y: (side - ts.height) / 2), withAttributes: attrs)
        }
        let plane = SCNPlane(width: 0.054, height: 0.054)
        let mat   = SCNMaterial()
        mat.diffuse.contents = img
        mat.lightingModel    = .constant
        mat.isDoubleSided    = true
        plane.firstMaterial  = mat
        let node      = SCNNode(geometry: plane)
        let billboard = SCNBillboardConstraint(); billboard.freeAxes = .all
        node.constraints = [billboard]
        return node
    }

    /// Where the tester said the feature really is: a small orange sphere.
    static func truth() -> SCNNode {
        let s = SCNSphere(radius: 0.006)
        let m = SCNMaterial()
        m.diffuse.contents  = UIColor.systemOrange
        m.emission.contents = UIColor.systemOrange.withAlphaComponent(0.6)
        m.lightingModel     = .constant
        s.firstMaterial     = m
        return SCNNode(geometry: s)
    }

    /// Hairline between the truth mark and the tag — the error, drawn.
    static func line(from a: simd_float3, to b: simd_float3) -> SCNNode {
        let d = b - a
        let len = simd_length(d)
        let cyl = SCNCylinder(radius: 0.0008, height: CGFloat(max(len, 0.001)))
        let m = SCNMaterial()
        m.diffuse.contents = UIColor.systemOrange.withAlphaComponent(0.9)
        m.lightingModel    = .constant
        cyl.firstMaterial  = m
        let node = SCNNode(geometry: cyl)
        node.simdPosition = (a + b) / 2
        if len > 0.0005 {
            let up  = simd_float3(0, 1, 0)
            let dir = d / len
            let axis = simd_cross(up, dir)
            let dot  = simd_dot(up, dir)
            if simd_length(axis) > 1e-5 {
                node.simdOrientation = simd_quatf(angle: acos(max(-1, min(1, dot))), axis: simd_normalize(axis))
            } else if dot < 0 {
                node.simdOrientation = simd_quatf(angle: .pi, axis: simd_float3(1, 0, 0))
            }
        }
        return node
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
// Tap to tag — exactly the AR OMS Place Steps gesture: tap a real feature,
// the pin drops with the pop / ring / haptic, and it is "Tag N". Lab pins are
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
    @State private var placing = false
    @State private var showTapHint = true
    @State private var toast: String? = nil
    @State private var started = false
    @State private var dirty = false
    @State private var tucked = Set<String>()
    private let ticker = Timer.publish(every: 1.0 / 20.0, on: .main, in: .common).autoconnect()

    private var client: SIBClient { SIBClient(settings: settings) }
    private var nextNumber: Int { (tags.compactMap { Int($0.label.split(separator: " ").last ?? "") }.max() ?? tags.count) + 1 }

    var body: some View {
        ZStack {
            PlacementGestureContainer(arManager: arManager, tool: .move, active: false,
                                      onTap: phase == .ready ? handleTap : nil)
                .ignoresSafeArea()

            VStack {
                HStack(spacing: 10) {
                    Button("Cancel") { leave() }
                        .font(.body).foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 12).padding(.vertical, 11)
                        .background(Color.black.opacity(0.5), in: Capsule())
                    Spacer()
                    Text(rig.assetId).font(.headline).foregroundStyle(.white).lineLimit(1)
                    Spacer()
                    Button { Task { await save() } } label: {
                        Text(phase == .saving ? "Saving…" : "Save")
                            .font(.body.bold())
                            .padding(.horizontal, 20).padding(.vertical, 11)
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
                     text: "Look at the rig from where you placed the tags. Existing tags appear once the fit is steady.")
            case .failed(let why):
                VStack(spacing: 12) {
                    card(icon: "exclamationmark.triangle.fill", tint: .orange, title: "Couldn't match the map", text: why)
                    HStack {
                        Button("Try again") { Task { await start() } }.buttonStyle(.borderedProminent)
                        Button("Start over (new map)") { Task { await startFresh() } }.buttonStyle(.bordered)
                    }
                }
            case .ready, .saving:
                if showTapHint, tags.isEmpty {
                    ARTapCoach(title: "Tap any surface to place Tag 1",
                               subtitle: "Point at a real feature — a hinge, a screw head, a corner",
                               accent: .cyan,
                               onDismiss: { withAnimation(.easeOut(duration: 0.3)) { showTapHint = false } })
                    .transition(.opacity)
                }
                VStack {
                    Spacer()
                    if !tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(tags) { t in
                                    HStack(spacing: 8) {
                                        Text(t.label).font(.subheadline.bold())
                                        Button { Task { await remove(t) } } label: { Image(systemName: "xmark.circle.fill").font(.title3) }
                                    }
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background(Color.black.opacity(0.6), in: Capsule()).foregroundStyle(.white)
                                }
                            }.padding(.horizontal, 16)
                        }
                    }
                    Text(arManager.isRelocalizing ? "Relocalizing — hold the rig in view"
                         : tags.isEmpty ? "Tap a real feature to place Tag 1"
                         : "Tap the next feature to place Tag \(nextNumber) · Save when done")
                        .font(.subheadline).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
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
            guard phase == .ready || phase == .saving, let cam = arManager.sceneView.session.currentFrame?.camera.transform else { return }
            LabMarker.updateTuck(nodes, camera: simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z), tucked: &tucked)
        }
    }

    // ── Session ───────────────────────────────────────────────────────────────

    private func start() async {
        tags = existing.filter { $0.metadata["anchor_rel_x"] != nil }
        // Always the scene mesh in the Lab: a tap must land on the feature,
        // not on the table plane behind it (that alone read as 5–7 cm "drift").
        arManager.wantsSceneMesh = true
        if let bundle = await WorldMapCache.load(.anchor(rig.id), client: client), bundle.isSealed, !tags.isEmpty {
            // Extend the existing map: relocalize, then place more tags in its frame.
            arManager.startSessionWithWorldMap(bundle.map)
            arManager.disableQRScanning()
            phase = .relocalizing
            let t0 = Date()
            while true {
                try? await Task.sleep(nanoseconds: 150_000_000)
                if arManager.relocalizationOutcome == .timedOut {
                    phase = .failed("ARKit couldn't match the rig's map in 15 s. Stand where you placed the tags, or start over with a new map."); return
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
        arManager.wantsSceneMesh = true
        arManager.startSession()
        arManager.disableQRScanning()
        origin = matrix_identity_float4x4
        phase = .starting
        // Wait for tracking so a tap has something to hit.
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
        for (i, t) in tags.enumerated() { drawPin(t, number: i + 1) }
        phase = .ready
    }

    private func drawPin(_ t: Tag, number: Int) {
        guard let x = num(t.metadata["anchor_rel_x"]), let y = num(t.metadata["anchor_rel_y"]), let z = num(t.metadata["anchor_rel_z"]) else { return }
        let p = ARCoordinateFrame.toWorldSpace(anchorRelativePos: simd_float3(Float(x), Float(y), Float(z)), anchorTransform: origin)
        let node = LabMarker.pin(number: number)
        node.simdPosition = p
        arManager.sceneView.scene.rootNode.addChildNode(node)
        nodes[t.id] = node
    }

    // ── Tap to tag ────────────────────────────────────────────────────────────

    private func handleTap(_ point: CGPoint) {
        guard phase == .ready, !placing, !arManager.isRelocalizing else { return }
        let sv = arManager.sceneView
        var pos: simd_float3? = nil
        for target in [ARRaycastQuery.Target.existingPlaneGeometry, .estimatedPlane] {
            if let q = sv.raycastQuery(from: point, allowing: target, alignment: .any),
               let h = sv.session.raycast(q).first {
                let c = h.worldTransform.columns.3; pos = simd_float3(c.x, c.y, c.z); break
            }
        }
        guard let p = pos else { show("No surface there — tap a spot on the rig"); return }
        withAnimation { showTapHint = false }
        Task { await place(at: p) }
    }

    private func place(at p: simd_float3) async {
        placing = true; defer { placing = false }
        let number = nextNumber
        let label  = "Tag \(number)"
        let rel = ARCoordinateFrame.toAnchorRelative(worldPos: p, anchorTransform: origin)
        let meta: [String: AnyCodable] = [
            "pos_x": AnyCodable(Double(p.x)), "pos_y": AnyCodable(Double(p.y)), "pos_z": AnyCodable(Double(p.z)),
            "anchor_rel_x": AnyCodable(Double(rel.x)), "anchor_rel_y": AnyCodable(Double(rel.y)), "anchor_rel_z": AnyCodable(Double(rel.z)),
            "lab": AnyCodable(true),
        ]
        let req = CreateTagRequest(anchorId: rig.id, type: .presenceCheck, label: label,
                                   expectedOutcome: "\(label) is where the tag says", checkDescription: nil,
                                   order: number, groupId: nil, metadata: meta)
        do {
            let tag = try await client.createTag(req)
            tags.append(tag)
            drawPin(tag, number: number)
            ARPinFX.drop(on: nodes[tag.id], accent: .cyan)
            dirty = true
            AppLog.info("lab", "tag placed \(label)")
        } catch { show("Couldn't save the tag: \(error.localizedDescription)") }
    }

    private func remove(_ t: Tag) async {
        do {
            try await client.deleteTag(id: t.id)
            nodes[t.id]?.removeFromParentNode(); nodes[t.id] = nil; tucked.remove(t.id)
            tags.removeAll { $0.id == t.id }
            dirty = true
        } catch { show("Couldn't delete: \(error.localizedDescription)") }
    }

    /// Seal: the map as it is NOW (with every tag's surroundings in it) + the origin.
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
            AppLog.info("lab", "rig sealed without a code (\(mapData.count / 1024) KB, \(tags.count) tags)")
            leave()
        } catch {
            WorldMapCache.store(.anchor(rig.id), map: mapData, meta: WorldMapMeta())
            show("Upload failed — kept on this device: \(error.localizedDescription)")
            phase = .ready
        }
    }

    private func leave() {
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
