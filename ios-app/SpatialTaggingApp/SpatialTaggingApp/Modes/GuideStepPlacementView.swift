// GuideStepPlacementView.swift — AR OMS Phase 2
// Author AR view for placing numbered step pins in world space.
//
// Flow:
//   1. Start a fresh AR session with plane detection.
//   2. Pre-place pins for steps that already have saved positions (resume mode).
//   3. Active step = first unplaced step (or first if all were already placed).
//   4. Tap any surface → raycast → place pin for active step.
//   5. Tap an existing pin → make that step active for re-placement.
//   6. Tap a step chip in the bottom tray → make it active for (re-)placement.
//   7. Save → PATCH each changed step position to SIB + upload ARWorldMap + reference photo.

import SwiftUI
import ARKit
import SceneKit
import simd

struct GuideStepPlacementView: View {

    @EnvironmentObject private var settings: AppSettings

    let guide: ARGuide
    let steps: [GuideStep]
    /// Called after all positions are saved.  Receives the server-updated step list.
    let onDone: ([GuideStep]) -> Void

    @StateObject private var arManager = ARSessionManager()

    // ── Placement state ───────────────────────────────────────────────────────
    /// Working positions for this session (keyed by step.id).
    @State private var stepPositions: [String: simd_float3] = [:]
    /// Index into `steps` of the step currently being placed.
    @State private var activeStepIndex: Int = 0
    /// SCNNode for each placed pin (keyed by step.id).
    @State private var stepNodes: [String: SCNNode] = [:]

    // ── Save state ────────────────────────────────────────────────────────────
    @State private var isSaving:          Bool    = false
    @State private var saveError:         String? = nil
    @State private var lastSaveSucceeded: Bool    = false   // drives "Saved ✓" flash
    /// Snapshot captured when Step 1 is first placed — used as the relocalization
    /// ghost-photo for Operators.  Captures the view FROM step 1's location so the
    /// ghost overlay shows the correct starting vantage point instead of wherever
    /// the Author happened to be standing when they tapped Done.
    @State private var firstStepPhotoData: Data? = nil

    // ── 3D focus ring (surface-tracking crosshair, same as Author/Gemba modes) ─
    @State private var focusRing: ARFocusRing? = nil
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── UX ────────────────────────────────────────────────────────────────────
    @State private var showTapHint: Bool = true

    // ── Pin colour constants ──────────────────────────────────────────────────
    private let indigoColor = UIColor.systemIndigo
    private let activeColor = UIColor.systemBlue

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .bottom) {

            // Full-screen AR camera + scene
            ARContainerView(arManager: arManager, onTap: handleTap)
                .ignoresSafeArea()
                .onAppear {
                    arManager.startSession()
                    arManager.disableQRScanning()
                    initFromExistingPositions()
                    focusRing = ARFocusRing(sceneView: arManager.sceneView)
                }
                .onDisappear {
                    focusRing?.cleanup()
                    focusRing = nil
                    arManager.pauseSession()
                }

            // First-tap hint (auto-hides after 5 s or first placement)
            if showTapHint && stepPositions.isEmpty {
                VStack {
                    tapHintBanner
                    Spacer()
                }
                .padding(.top, 80)
                .animation(.easeOut(duration: 0.35), value: showTapHint)
            }

            // Bottom UI: step chips tray + action bar
            VStack(spacing: 0) {
                stepTray
                actionBar
            }
        }
        .navigationBarHidden(true)
        .overlay(alignment: .top) { topBar }
        .overlay { if isSaving { savingOverlay } }
        .task {
            // Auto-hide tap hint after 5 seconds
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            withAnimation { showTapHint = false }
        }
        .onReceive(crosshairTicker) { _ in
            focusRing?.update(sceneView: arManager.sceneView)
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                // Cancel — return unchanged steps
                onDone(steps)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.leading, 16)

            Spacer()

            VStack(spacing: 2) {
                Text("Place Steps")
                    .font(.headline.bold()).foregroundStyle(.white)
                Text("\(placedCount) / \(steps.count) placed")
                    .font(.caption).foregroundStyle(.white.opacity(0.65))
            }

            Spacer()

            // Invisible spacer so title stays centred
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(.clear)
                .padding(.trailing, 16)
        }
        .padding(.vertical, 10)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Tap hint ──────────────────────────────────────────────────────────────

    private var tapHintBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "hand.tap.fill").foregroundStyle(.indigo)
            let seq = activeStepIndex < steps.count
                ? "Step \(steps[activeStepIndex].sequenceNumber)"
                : "a step"
            Text("Tap any surface to place \(seq)")
                .font(.subheadline)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.horizontal, 24)
    }

    // ── Step tray ─────────────────────────────────────────────────────────────

    private var stepTray: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { idx, step in
                        stepTrayChip(idx: idx, step: step)
                            .id(step.id)
                            .onTapGesture {
                                activateStep(idx)
                            }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .background(.ultraThinMaterial)
            .onChange(of: activeStepIndex) { idx in
                guard idx < steps.count else { return }
                withAnimation { proxy.scrollTo(steps[idx].id, anchor: .center) }
            }
        }
    }

    @ViewBuilder
    private func stepTrayChip(idx: Int, step: GuideStep) -> some View {
        let isActive = idx == activeStepIndex
        let placed   = stepPositions[step.id] != nil

        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(isActive ? Color.blue :
                          placed   ? Color.indigo.opacity(0.85) : Color.gray.opacity(0.4))
                    .frame(width: 36, height: 36)

                if placed && !isActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                } else {
                    Text("\(step.sequenceNumber)")
                        .font(.headline.bold())
                        .foregroundStyle(.white)
                }
            }

            Text(step.text)
                .font(.system(size: 9))
                .foregroundStyle(isActive ? .white : .white.opacity(0.55))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 62)
        }
        .padding(6)
        .background(isActive ? Color.blue.opacity(0.18) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isActive ? Color.blue : Color.clear, lineWidth: 1.5)
        )
    }

    // ── Action bar ────────────────────────────────────────────────────────────

    private var actionBar: some View {
        VStack(spacing: 0) {
            // Error banner
            if let err = saveError {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.red.opacity(0.85))
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            HStack(spacing: 12) {
                // Active step description
                VStack(alignment: .leading, spacing: 2) {
                    if activeStepIndex < steps.count {
                        let s = steps[activeStepIndex]
                        Text("Tap to place step \(s.sequenceNumber):")
                            .font(.caption2).foregroundStyle(.white.opacity(0.55))
                        Text(s.text)
                            .font(.caption).foregroundStyle(.white)
                            .lineLimit(2)
                    } else {
                        Text("All steps placed")
                            .font(.subheadline.bold()).foregroundStyle(.green)
                        Text("Tap an existing pin to re-place it")
                            .font(.caption).foregroundStyle(.white.opacity(0.55))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Save (stay in view) + Done (save & exit) buttons
                HStack(spacing: 8) {
                    Button { Task { await savePins() } } label: {
                        Text(lastSaveSucceeded ? "Saved ✓" : "Save")
                            .font(.subheadline.bold())
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(placedCount == 0
                                        ? Color.gray.opacity(0.5)
                                        : (lastSaveSucceeded ? Color.green.opacity(0.8) : Color.indigo.opacity(0.8)))
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                    }
                    .disabled(placedCount == 0 || isSaving)

                    Button { Task { await saveAndExit() } } label: {
                        Label("Done", systemImage: "checkmark.circle.fill")
                            .font(.subheadline.bold())
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(placedCount == 0 ? Color.gray.opacity(0.5) : Color.indigo)
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                    }
                    .disabled(placedCount == 0 || isSaving)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 32)   // safe area buffer
        }
        .background(.ultraThinMaterial)
        .animation(.easeInOut(duration: 0.2), value: saveError)
    }

    // ── Saving overlay ────────────────────────────────────────────────────────

    @State private var savingIsExit: Bool = false   // true when Done (not Save) triggered overlay

    private var savingOverlay: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().scaleEffect(1.3).tint(.white)
                Text(savingIsExit ? "Saving…" : "Saving positions…")
                    .font(.headline).foregroundStyle(.white)
                Text(savingIsExit
                     ? "Uploading \(placedCount) pin\(placedCount == 1 ? "" : "s") + world map"
                     : "Updating \(placedCount) pin\(placedCount == 1 ? "" : "s") on server")
                    .font(.caption).foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    // ── Derived ───────────────────────────────────────────────────────────────

    private var placedCount: Int { stepPositions.count }

    // ── Initialise from server-saved positions ────────────────────────────────

    private func initFromExistingPositions() {
        // Load positions from steps that were placed in a previous session
        for step in steps {
            if let pos = step.worldPosition {
                stepPositions[step.id] = pos
            }
        }

        // Determine active step (first unplaced, or sentinel if all placed)
        if let firstUnplaced = steps.firstIndex(where: { $0.worldPosition == nil }) {
            activeStepIndex = firstUnplaced
        } else if !steps.isEmpty {
            activeStepIndex = steps.count  // all placed — let user tap pins to re-place
        }

        // Place 3D pins for already-positioned steps once session is initialised
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)   // wait for ARKit to warm up
            for (idx, step) in steps.enumerated() {
                guard let pos = stepPositions[step.id],
                      stepNodes[step.id] == nil else { continue }
                let isActive = idx == activeStepIndex
                let node = makePin(number: step.sequenceNumber, isActive: isActive)
                node.simdPosition = pos
                arManager.sceneView.scene.rootNode.addChildNode(node)
                stepNodes[step.id] = node
            }
        }
    }

    // ── Activate a step for (re-)placement ────────────────────────────────────

    private func activateStep(_ idx: Int) {
        guard idx < steps.count else { return }
        let prevIdx = activeStepIndex
        activeStepIndex = idx
        if prevIdx < steps.count {
            updatePinStyle(for: steps[prevIdx].id, isActive: false)
        }
        updatePinStyle(for: steps[idx].id, isActive: true)
    }

    // ── Tap handler ───────────────────────────────────────────────────────────

    private func handleTap(_ point: CGPoint) {
        let sv = arManager.sceneView

        // ── Check if tapping an existing pin ──────────────────────────────────
        let hits = sv.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue,
        ])
        for hit in hits {
            // Walk up to find a root pin node
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                for (stepId, pinNode) in stepNodes where n === pinNode {
                    if let idx = steps.firstIndex(where: { $0.id == stepId }) {
                        activateStep(idx)
                    }
                    return
                }
                candidate = n.parent
            }
        }

        // ── No pin hit — surface raycast for placement ────────────────────────
        guard activeStepIndex < steps.count else { return }

        guard let pos = rayCastSurface(from: point, in: sv) else { return }
        placeActiveStep(at: pos)
        withAnimation { showTapHint = false }
    }

    private func rayCastSurface(from point: CGPoint, in sv: ARSCNView) -> simd_float3? {
        if let q = sv.raycastQuery(from: point, allowing: .existingPlaneGeometry, alignment: .any),
           let h = sv.session.raycast(q).first {
            let c = h.worldTransform.columns.3
            return simd_float3(c.x, c.y, c.z)
        }
        if let q = sv.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .any),
           let h = sv.session.raycast(q).first {
            let c = h.worldTransform.columns.3
            return simd_float3(c.x, c.y, c.z)
        }
        return nil
    }

    // ── Pin placement ─────────────────────────────────────────────────────────

    private func placeActiveStep(at position: simd_float3) {
        guard activeStepIndex < steps.count else { return }
        let step    = steps[activeStepIndex]
        let stepId  = step.id
        let stepSeq = step.sequenceNumber

        // Capture reference photo the first time Step 1 is placed.
        // This photo is uploaded as the relocalization ghost so Operators see the
        // correct starting-point view — NOT wherever the Author is standing at Done.
        if activeStepIndex == 0 && firstStepPhotoData == nil && stepPositions[stepId] == nil {
            firstStepPhotoData = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
        }

        stepPositions[stepId] = position

        if let existing = stepNodes[stepId] {
            // Animate existing pin to new position
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.22
            existing.simdPosition = position
            SCNTransaction.commit()
        } else {
            let node = makePin(number: stepSeq, isActive: true)
            node.simdPosition = position
            arManager.sceneView.scene.rootNode.addChildNode(node)
            stepNodes[stepId] = node
        }

        // Advance to next unplaced step
        let nextUnplaced =
            steps.indices.first(where: { i in i > activeStepIndex && stepPositions[steps[i].id] == nil })
            ?? steps.indices.first(where: { i in stepPositions[steps[i].id] == nil })

        if let next = nextUnplaced {
            updatePinStyle(for: stepId, isActive: false)
            activeStepIndex = next
            updatePinStyle(for: steps[next].id, isActive: true)
        } else {
            // All placed — sentinel
            updatePinStyle(for: stepId, isActive: false)
            activeStepIndex = steps.count
        }
    }

    // ── 3D pin factory ────────────────────────────────────────────────────────

    private func makePin(number: Int, isActive: Bool) -> SCNNode {
        let root  = SCNNode()
        let color = isActive ? activeColor : indigoColor

        // Sphere
        let sphere = SCNSphere(radius: 0.015)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.55)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        // Torus ring
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
        root.addChildNode(ring)

        // Numbered billboard (Core Graphics badge facing camera)
        let badge = makeNumberBadge(number: number, color: color)
        badge.simdPosition = simd_float3(0, 0.055, 0)
        root.addChildNode(badge)

        if isActive {
            root.runAction(.repeatForever(.sequence([
                .fadeOpacity(to: 0.38, duration: 0.45),
                .fadeOpacity(to: 1.00, duration: 0.45),
            ])))
        }

        return root
    }

    private func makeNumberBadge(number: Int, color: UIColor) -> SCNNode {
        let side: CGFloat = 96
        let sz = CGSize(width: side, height: side)
        let renderer = UIGraphicsImageRenderer(size: sz)
        let img = renderer.image { _ in
            // Filled circle
            color.withAlphaComponent(0.92).setFill()
            UIBezierPath(ovalIn: CGRect(x: 4, y: 4,
                                        width: side - 8, height: side - 8)).fill()
            // White border ring
            UIColor.white.withAlphaComponent(0.65).setStroke()
            let ring = UIBezierPath(ovalIn: CGRect(x: 5, y: 5,
                                                   width: side - 10, height: side - 10))
            ring.lineWidth = 3.5; ring.stroke()
            // Step number
            let str  = "\(number)" as NSString
            let para = NSMutableParagraphStyle(); para.alignment = .center
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: side * 0.44, weight: .black),
                .foregroundColor: UIColor.white,
                .paragraphStyle: para,
            ]
            let ts = str.size(withAttributes: attrs)
            str.draw(at: CGPoint(x: (side - ts.width) / 2,
                                 y: (side - ts.height) / 2),
                     withAttributes: attrs)
        }

        let plane = SCNPlane(width: 0.054, height: 0.054)
        let mat   = SCNMaterial()
        mat.diffuse.contents = img
        mat.lightingModel    = .constant
        mat.isDoubleSided    = true
        plane.firstMaterial  = mat

        let node       = SCNNode(geometry: plane)
        let billboard  = SCNBillboardConstraint()
        billboard.freeAxes = .all
        node.constraints   = [billboard]
        return node
    }

    private func updatePinStyle(for stepId: String, isActive: Bool) {
        guard let node = stepNodes[stepId] else { return }
        node.removeAllActions()
        if isActive {
            node.opacity = 1.0
            node.runAction(.repeatForever(.sequence([
                .fadeOpacity(to: 0.38, duration: 0.45),
                .fadeOpacity(to: 1.00, duration: 0.45),
            ])))
        } else {
            node.runAction(.fadeOpacity(to: 0.85, duration: 0.2))
        }
    }

    // ── Save helpers ──────────────────────────────────────────────────────────

    /// PATCH each step whose position changed from the server value.
    /// Returns (updatedSteps, errorMessages).
    @MainActor
    private func patchChangedPositions() async -> (updated: [GuideStep], errors: [String]) {
        let client = SIBClient(settings: settings)
        var updatedSteps = steps
        var errors: [String] = []

        for (idx, step) in steps.enumerated() {
            guard let newPos = stepPositions[step.id] else { continue }

            // Skip if position is unchanged (avoid unnecessary network calls)
            let serverPos = step.worldPosition
            let unchanged = serverPos.map { old in
                abs(old.x - newPos.x) < 0.0001 &&
                abs(old.y - newPos.y) < 0.0001 &&
                abs(old.z - newPos.z) < 0.0001
            } ?? false
            if unchanged { continue }

            var req = UpdateGuideStepRequest()
            req.posX           = Double(newPos.x)
            req.posY           = Double(newPos.y)
            req.posZ           = Double(newPos.z)
            req.isPlaced       = true
            req.positionSource = "tap"

            do {
                let fresh = try await client.updateGuideStep(
                    guideId: guide.id, stepId: step.id, req: req)
                updatedSteps[idx] = fresh
            } catch {
                errors.append("Step \(step.sequenceNumber): \(error.localizedDescription)")
            }
        }
        return (updatedSteps, errors)
    }

    // ── Save (stay in view) ───────────────────────────────────────────────────
    //
    // Persists all currently-placed step positions to SIB without uploading
    // the ARWorldMap.  The Author can tap Save multiple times as they place
    // more pins, then hit Done when finished.

    @MainActor
    private func savePins() async {
        guard placedCount > 0 else { return }
        isSaving       = true
        savingIsExit   = false
        saveError      = nil
        lastSaveSucceeded = false

        let (_, errors) = await patchChangedPositions()

        isSaving = false

        if errors.isEmpty {
            withAnimation { lastSaveSucceeded = true }
            // Brief "Saved ✓" flash, then reset
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                withAnimation { lastSaveSucceeded = false }
            }
        } else {
            saveError = "Save incomplete — " + errors.joined(separator: "; ")
        }
    }

    // ── Done (save + upload worldmap + exit) ──────────────────────────────────
    //
    // Persists step positions AND uploads the ARWorldMap + reference photo,
    // then returns to the guide editor with the freshly updated steps.

    @MainActor
    private func saveAndExit() async {
        guard placedCount > 0 else { return }
        isSaving     = true
        savingIsExit = true
        saveError    = nil

        let client = SIBClient(settings: settings)

        // 1. Capture reference photo + serialise ARWorldMap
        // Prefer the photo captured at Step 1 placement (the correct starting vantage
        // point).  Fall back to current view only if Step 1 was never placed here.
        let photoData: Data? = firstStepPhotoData
            ?? arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
        let mapData = await arManager.saveCurrentWorldMap()

        // 2. PATCH step positions
        let (updatedSteps, errors) = await patchChangedPositions()

        // 3. Upload ARWorldMap (non-fatal)
        if let mapData {
            do {
                try await client.uploadGuideWorldMap(
                    guideId: guide.id,
                    mapData: mapData,
                    referencePhotoData: photoData
                )
            } catch {
                print("[GuideStepPlacementView] World map upload failed (non-fatal): \(error)")
            }
        }

        isSaving = false

        if errors.isEmpty {
            onDone(updatedSteps)
        } else {
            saveError = "Save incomplete — " + errors.joined(separator: "; ")
        }
    }
}
