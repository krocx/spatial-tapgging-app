// GuideStepPlacementView.swift — AR OMS Phase 2 + 3D Model Placement
//
// Author AR view for placing numbered step pins in world space, with integrated
// 3D model positioning immediately after each pin is dropped.
//
// Flow:
//   1. Start a fresh AR session with plane detection.
//   2. Pre-place pins for steps that already have saved positions (resume mode).
//   3. Active step = first unplaced step (or first if all were already placed).
//   4. Tap any surface → raycast → place pin for active step.
//      If that step has a 3D model → download it and enter Model Adjust mode.
//   5. Model Adjust mode: 1-finger pan (H/V), 2-finger pinch (scale),
//      2-finger rotate (Y-axis). Confirm → save transform, advance to next step.
//      Skip → discard model placement for this step, advance.
//   6. Tap an existing pin → make that step active for re-placement.
//   7. Tap a step chip in the bottom tray → make it active for (re-)placement.
//   8. Save / Done → PATCH each changed step position + model offsets to SIB
//      + upload ARWorldMap + reference photo.

import SwiftUI
import ARKit
import SceneKit
import simd
import CoreImage
import CryptoKit

// ── Model transform captured during adjustment ────────────────────────────────

private struct ModelTransformState {
    var position:  simd_float3  // absolute world position
    var scale:     Float        // uniform scale factor
    var rotationY: Float        // Y-axis rotation in radians
}

// ── Placement phase state machine ─────────────────────────────────────────────

private enum PlacementPhase: Equatable {
    case placingPins
    case loadingModel(stepId: String)
    case adjustingModel(stepId: String)

    static func == (lhs: PlacementPhase, rhs: PlacementPhase) -> Bool {
        switch (lhs, rhs) {
        case (.placingPins, .placingPins):                         return true
        case (.loadingModel(let a), .loadingModel(let b)):         return a == b
        case (.adjustingModel(let a), .adjustingModel(let b)):     return a == b
        default:                                                   return false
        }
    }

    var isAdjusting: Bool {
        if case .adjustingModel = self { return true }
        return false
    }
    var isPlacingPins: Bool { self == .placingPins }
}

// ── Pan mode for model adjustment ────────────────────────────────────────────

private enum ModelPanMode { case horizontal, vertical }

// ── Combined AR gesture container ─────────────────────────────────────────────
//
// Single UIViewRepresentable that wraps arManager.sceneView and adds tap,
// pan, pinch, and rotate recognisers in one pass (no view-swap required).
// Phase-conditional callbacks let the SwiftUI layer decide what each gesture does.

private struct ARPlacementContainer: UIViewRepresentable {

    @ObservedObject var arManager: ARSessionManager

    // Tap (pin placement)
    var onTap:          ((CGPoint) -> Void)?

    // 1-finger pan (model translate)
    var onPanBegan:     ((CGPoint) -> Void)?
    var onPanChanged:   ((CGPoint) -> Void)?
    var onPanEnded:     (() -> Void)?

    // Pinch (model scale)
    var onPinchBegan:   (() -> Void)?
    var onPinchChanged: ((CGFloat) -> Void)?
    var onPinchEnded:   ((CGFloat) -> Void)?

    // Rotation (model Y-axis)
    var onRotBegan:     (() -> Void)?
    var onRotChanged:   ((CGFloat) -> Void)?
    var onRotEnded:     ((CGFloat) -> Void)?

    // ── Coordinator ───────────────────────────────────────────────────────────

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: ARPlacementContainer
        init(_ parent: ARPlacementContainer) { self.parent = parent }

        // All recognisers run simultaneously (pan + pinch + rotate)
        func gestureRecognizer(
            _ g1: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith g2: UIGestureRecognizer
        ) -> Bool { true }

        @objc func handleTap(_ r: UITapGestureRecognizer) {
            guard r.state == .ended, let v = r.view else { return }
            parent.onTap?(r.location(in: v))
        }

        @objc func handlePan(_ r: UIPanGestureRecognizer) {
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
            case .began:             r.scale = 1; parent.onPinchBegan?()
            case .changed:           parent.onPinchChanged?(r.scale)
            case .ended, .cancelled: parent.onPinchEnded?(r.scale)
            default: break
            }
        }

        @objc func handleRotation(_ r: UIRotationGestureRecognizer) {
            switch r.state {
            case .began:             r.rotation = 0; parent.onRotBegan?()
            case .changed:           parent.onRotChanged?(r.rotation)
            case .ended, .cancelled: parent.onRotEnded?(r.rotation)
            default: break
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = arManager.sceneView
        let c    = context.coordinator

        let tap = UITapGestureRecognizer(target: c, action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = c
        view.addGestureRecognizer(tap)

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

    // Always update coordinator so latest closures are used
    func updateUIView(_ uiView: ARSCNView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ uiView: ARSCNView, coordinator: Coordinator) {}
}

// ── Main view ─────────────────────────────────────────────────────────────────

/// V1: everything ConeCaptureView needs to train one step's validation,
/// bundled so a single fullScreenCover(item:) drives the presentation.
private struct StepTrainingTarget: Identifiable {
    let step:     GuideStep
    let tag:      Tag
    let anchor:   Anchor
    let worldPos: simd_float3
    var id: String { step.id }
}

struct GuideStepPlacementView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState: AppState   // ConeCaptureView requires it

    let guide:  ARGuide
    let steps:  [GuideStep]
    let models: [Model3D]
    /// Called after all positions are saved. Receives the server-updated step list.
    let onDone: ([GuideStep]) -> Void

    @StateObject private var arManager = ARSessionManager()

    // ── Pin placement state ───────────────────────────────────────────────────
    @State private var stepPositions:  [String: simd_float3] = [:]
    @State private var activeStepIndex: Int                  = 0
    @State private var stepNodes:      [String: SCNNode]     = [:]

    // ── V1: cone training for validation steps ────────────────────────────────
    @State private var trainingTarget:      StepTrainingTarget? = nil
    @State private var isPreparingTraining  = false
    @State private var coneTrainedStepIds:  Set<String>         = []
    @State private var sessionTagIds:       [String: String]    = [:]  // stepId → hidden tag id (this session)
    @State private var anchorRecord:        Anchor?             = nil

    // ── Phase + model state ───────────────────────────────────────────────────
    @State private var placementPhase:  PlacementPhase       = .placingPins
    @State private var modelNodes:      [String: SCNNode]    = [:]
    /// Confirmed transforms for steps adjusted in this session.
    @State private var modelTransforms: [String: ModelTransformState] = [:]

    // Live adjustment values (populated when entering .adjustingModel)
    @State private var modelPosition: simd_float3  = .zero
    @State private var modelScale:    Float        = 1.0
    @State private var modelRotY:     Float        = 0.0
    @State private var modelPanMode:  ModelPanMode = .horizontal

    // Gesture baselines
    @State private var panBasePos:    simd_float3 = .zero
    @State private var panDepthZ:     Float       = 0.5
    @State private var panStartWorld: simd_float3 = .zero
    @State private var scaleBase:     Float       = 1.0
    @State private var rotYBase:      Float       = 0.0

    // ── Save state ────────────────────────────────────────────────────────────
    @State private var isSaving:           Bool    = false
    @State private var savingIsExit:       Bool    = false
    @State private var saveError:          String? = nil
    @State private var lastSaveSucceeded:  Bool    = false
    @State private var firstStepPhotoData: Data?   = nil
    /// Resume sessions may refresh the Step-1 reference once, only when looking at it.
    @State private var resumeRefCaptureArmed = true

    // ── Focus ring ────────────────────────────────────────────────────────────
    @State private var focusRing: ARFocusRing? = nil
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── Resolved model library ────────────────────────────────────────────────
    /// Seeded from the `models` parameter on appear, then refreshed from the
    /// server so placeActiveStep works even if the parent's anchorModels loaded
    /// too late (async race between GuideEditorView.onAppear and sheet open).
    @State private var resolvedModels: [Model3D] = []

    // ── Pre-cached model files ────────────────────────────────────────────────
    /// Local temp-file URLs for each model ID, downloaded on appear so the
    /// model is ready the instant a step pin is placed (no wait on tap).
    @State private var modelFileCache: [String: URL] = [:]

    // ── UX ────────────────────────────────────────────────────────────────────
    @State private var showTapHint: Bool = true

    // ── Pin colours ───────────────────────────────────────────────────────────
    private let indigoColor = UIColor.systemIndigo
    private let activeColor = UIColor.systemBlue

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Body
    // ─────────────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .bottom) {

            // Single AR container — never swapped, always live
            ARPlacementContainer(
                arManager:      arManager,
                // Tap only fires in pin-placement phase
                onTap:          placementPhase.isPlacingPins ? handleTap : nil,
                // Pan/pinch/rotate only fire in model-adjust phase
                onPanBegan:     placementPhase.isAdjusting  ? handleModelPanBegan   : nil,
                onPanChanged:   placementPhase.isAdjusting  ? handleModelPanChanged : nil,
                onPanEnded:     placementPhase.isAdjusting  ? { handleModelPanEnded()   } : nil,
                onPinchBegan:   placementPhase.isAdjusting  ? { handleModelPinchBegan() } : nil,
                onPinchChanged: placementPhase.isAdjusting  ? handleModelPinchChanged   : nil,
                onPinchEnded:   placementPhase.isAdjusting  ? handleModelPinchEnded     : nil,
                onRotBegan:     placementPhase.isAdjusting  ? { handleModelRotBegan()   } : nil,
                onRotChanged:   placementPhase.isAdjusting  ? handleModelRotChanged     : nil,
                onRotEnded:     placementPhase.isAdjusting  ? handleModelRotEnded       : nil
            )
            .ignoresSafeArea()

            // First-tap hint
            if placementPhase.isPlacingPins && showTapHint && stepPositions.isEmpty {
                VStack {
                    tapHintBanner
                    Spacer()
                }
                .padding(.top, 80)
                .animation(.easeOut(duration: 0.35), value: showTapHint)
            }

            // Model loading overlay
            if case .loadingModel = placementPhase {
                modelLoadingOverlay
            }

            // Bottom UI switches between step tray and model adjust bar
            switch placementPhase {
            case .placingPins, .loadingModel:
                VStack(spacing: 0) { stepTray; actionBar }
            case .adjustingModel(let stepId):
                if let idx = steps.firstIndex(where: { $0.id == stepId }) {
                    modelAdjustBar(for: steps[idx])
                }
            }
        }
        .navigationBarHidden(true)
        .overlay(alignment: .top) { topBar }
        .overlay { if isSaving { savingOverlay } }
        // V1: Spatial Inspection cone training for a validation step. Shares
        // this view's AR session (same pattern as Author-mode tag training) and
        // anchors the dome at the step's pin via forcedTagWorldPos.
        .fullScreenCover(item: $trainingTarget) { target in
            ConeCaptureView(tag:             target.tag,
                            anchor:          target.anchor,
                            parentArManager: arManager,
                            onTrained:       { tagId in
                                Task { await finishConeTraining(step: target.step, tagId: tagId) }
                            },
                            forcedTagWorldPos: target.worldPos)
                .environmentObject(settings)
                .environmentObject(appState)
        }
        .onAppear {
            arManager.startSession()
            arManager.disableQRScanning()
            initFromExistingPositions()
            // V1: seed training badges + tag reuse from server state
            for s in steps where s.coneTrained {
                coneTrainedStepIds.insert(s.id)
                if let t = s.validationTagId { sessionTagIds[s.id] = t }
            }
            focusRing = ARFocusRing(sceneView: arManager.sceneView)
            // Seed from parent immediately (may be non-empty if parent loaded in time)
            if !models.isEmpty { resolvedModels = models }
            // Fetch fresh from server regardless — guarantees models are available
            // even when the parent's async fetch hadn't finished before this view opened.
            // Then pre-download the file for every step that has a model, so the
            // model is ready the instant the author taps to place a pin.
            Task {
                if let m = try? await SIBClient(settings: settings)
                    .fetchModels(anchorId: guide.anchorId), !m.isEmpty {
                    resolvedModels = m
                    await prefetchStepModels(from: m)
                }
            }
        }
        .onDisappear {
            for node in modelNodes.values { node.removeFromParentNode() }
            focusRing?.cleanup()
            focusRing = nil
            arManager.pauseSession()
        }
        .task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            withAnimation { showTapHint = false }
        }
        .onReceive(crosshairTicker) { _ in
            if placementPhase.isPlacingPins {
                focusRing?.update(sceneView: arManager.sceneView)
                captureResumeReferenceIfLookingAtStep1()
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Top bar
    // ─────────────────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                if case .adjustingModel(let stepId) = placementPhase {
                    skipModelPlacement(stepId: stepId)
                } else {
                    onDone(steps)
                }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.leading, 16)

            Spacer()

            VStack(spacing: 2) {
                switch placementPhase {
                case .placingPins:
                    Text("Place Steps")
                        .font(.headline.bold()).foregroundStyle(.white)
                    Text("\(placedCount) / \(steps.count) placed")
                        .font(.caption).foregroundStyle(.white.opacity(0.65))
                case .loadingModel(let stepId):
                    Text("Loading Model")
                        .font(.headline.bold()).foregroundStyle(.white)
                    Text("Preparing \(displayTitle(stepId: stepId))")
                        .font(.caption).foregroundStyle(.white.opacity(0.65))
                case .adjustingModel(let stepId):
                    Text("Adjust Model")
                        .font(.headline.bold()).foregroundStyle(.white)
                    Text("Positioning model for \(displayTitle(stepId: stepId))")
                        .font(.caption).foregroundStyle(.white.opacity(0.65))
                        .lineLimit(1)
                }
            }

            Spacer()

            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 26)).foregroundStyle(.clear)
                .padding(.trailing, 16)
        }
        .padding(.vertical, 10).padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Tap hint
    // ─────────────────────────────────────────────────────────────────────────

    private var tapHintBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "hand.tap.fill").foregroundStyle(.indigo)
            let seq = activeStepIndex < steps.count
                ? "Step \(steps[activeStepIndex].sequenceNumber)"
                : "a step"
            Text("Tap any surface to place \(seq)").font(.subheadline)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.horizontal, 24)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model loading overlay
    // ─────────────────────────────────────────────────────────────────────────

    private var modelLoadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().scaleEffect(1.2).tint(.white)
                Text("Loading 3D model…")
                    .font(.headline).foregroundStyle(.white)
                Text("Tap ✕ above to skip")
                    .font(.caption).foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model adjust bar
    // ─────────────────────────────────────────────────────────────────────────

    private func modelAdjustBar(for step: GuideStep) -> some View {
        VStack(spacing: 0) {
            // Gesture hints + H/V toggle
            HStack(alignment: .top, spacing: 16) {
                modelGestureHint(
                    icon:  modelPanMode == .horizontal ? "hand.draw.fill"    : "arrow.up.and.down",
                    label: modelPanMode == .horizontal ? "Drag\nto move"     : "Drag\nup/down"
                )
                modelGestureHint(icon: "arrow.up.left.and.arrow.down.right", label: "Pinch\nto scale")
                modelGestureHint(icon: "rotate.right.fill", label: "Twist\nto rotate")

                Button {
                    modelPanMode = (modelPanMode == .horizontal) ? .vertical : .horizontal
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: modelPanMode == .horizontal
                              ? "arrow.left.and.right" : "arrow.up.and.down")
                            .font(.system(size: 18)).foregroundStyle(.white.opacity(0.9))
                        Text(modelPanMode == .horizontal ? "H" : "V")
                            .font(.system(size: 10).bold()).foregroundStyle(.white.opacity(0.75))
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(modelPanMode == .horizontal
                                ? Color.white.opacity(0.12) : Color.indigo.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.top, 10).padding(.bottom, 4)

            // Scale / rotation readout
            HStack(spacing: 24) {
                Label("\(String(format: "%.2f", modelScale))×",
                      systemImage: "arrow.up.left.and.arrow.down.right")
                    .font(.caption).foregroundStyle(.white.opacity(0.7))
                Label("\(Int(modelRotY * 180 / .pi))°", systemImage: "rotate.right")
                    .font(.caption).foregroundStyle(.white.opacity(0.7))
            }
            .padding(.bottom, 8)

            // Confirm + Skip
            HStack(spacing: 12) {
                Button { skipModelPlacement(stepId: step.id) } label: {
                    Text("Skip")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.white.opacity(0.12))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                Button { confirmModelPlacement(stepId: step.id) } label: {
                    Label("Confirm", systemImage: "checkmark.circle.fill")
                        .font(.headline.bold())
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.green)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 34)
        }
        .background(.ultraThinMaterial)
    }

    private func modelGestureHint(icon: String, label: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(.white.opacity(0.8))
            Text(label).font(.system(size: 10)).foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Step tray
    // ─────────────────────────────────────────────────────────────────────────

    private var stepTray: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { idx, step in
                        stepTrayChip(idx: idx, step: step)
                            .id(step.id)
                            .onTapGesture { activateStep(idx) }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
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
        let isActive  = idx == activeStepIndex
        let placed    = stepPositions[step.id] != nil
        let hasModel  = modelTransforms[step.id] != nil

        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(isActive ? Color.blue :
                          placed   ? Color.indigo.opacity(0.85) : Color.gray.opacity(0.4))
                    .frame(width: 36, height: 36)
                if placed && !isActive {
                    Image(systemName: hasModel ? "cube.fill" : "checkmark")
                        .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                } else {
                    Text("\(step.sequenceNumber)")
                        .font(.headline.bold()).foregroundStyle(.white)
                }
            }
            Text(step.displayTitle)
                .font(.system(size: 9))
                .foregroundStyle(isActive ? .white : .white.opacity(0.55))
                .lineLimit(2).multilineTextAlignment(.center).frame(width: 62)

            // V1: cone training for validation steps — tap the seal to train
            // this step with the Spatial Inspection dome sweep. Only shown
            // once the step has a pin (the cone anchors at the pin).
            if step.needsValidation && placed {
                let trained = coneTrainedStepIds.contains(step.id) || step.coneTrained
                HStack(spacing: 4) {
                    // Multi-angle cone sweep (most robust)
                    Button {
                        Task { await beginConeTraining(for: step) }
                    } label: {
                        Label(trained ? "Trained" : "Cone",
                              systemImage: trained ? "checkmark.seal.fill" : "seal")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(trained ? Color.green : Color.orange)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Color.black.opacity(0.35), in: Capsule())
                    }
                    // W2: quick-shot — one frame from where you stand now, with
                    // the stance recorded so the operator is guided back to it.
                    Button {
                        Task { await quickShotTrain(for: step) }
                    } label: {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.cyan)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Color.black.opacity(0.35), in: Capsule())
                    }
                    .accessibilityLabel("Quick-shot train from here")
                }
                .disabled(isPreparingTraining)
            }
        }
        .padding(6)
        .background(isActive ? Color.blue.opacity(0.18) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .stroke(isActive ? Color.blue : Color.clear, lineWidth: 1.5))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Action bar (pin-placement mode)
    // ─────────────────────────────────────────────────────────────────────────

    private var actionBar: some View {
        VStack(spacing: 0) {
            if let err = saveError {
                Text(err)
                    .font(.caption).foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.red.opacity(0.85))
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    if activeStepIndex < steps.count {
                        let s = steps[activeStepIndex]
                        Text("Tap to place step \(s.sequenceNumber):")
                            .font(.caption2).foregroundStyle(.white.opacity(0.55))
                        Text(s.displayTitle)
                            .font(.caption.bold()).foregroundStyle(.white).lineLimit(1)
                        if s.title != nil {
                            Text(s.text).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                        }
                    } else {
                        Text("All steps placed")
                            .font(.subheadline.bold()).foregroundStyle(.green)
                        Text("Tap an existing pin to re-place it")
                            .font(.caption).foregroundStyle(.white.opacity(0.55))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 8) {
                    Button { Task { await savePins() } } label: {
                        Text(lastSaveSucceeded ? "Saved ✓" : "Save")
                            .font(.subheadline.bold())
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(placedCount == 0
                                        ? Color.gray.opacity(0.5)
                                        : (lastSaveSucceeded
                                           ? Color.green.opacity(0.8)
                                           : Color.indigo.opacity(0.8)))
                            .foregroundStyle(.white).clipShape(Capsule())
                    }
                    .disabled(placedCount == 0 || isSaving)

                    Button { Task { await saveAndExit() } } label: {
                        Label("Done", systemImage: "checkmark.circle.fill")
                            .font(.subheadline.bold())
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(placedCount == 0 ? Color.gray.opacity(0.5) : Color.indigo)
                            .foregroundStyle(.white).clipShape(Capsule())
                    }
                    .disabled(placedCount == 0 || isSaving)
                }
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 32)
        }
        .background(.ultraThinMaterial)
        .animation(.easeInOut(duration: 0.2), value: saveError)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: V1 — cone training for validation steps
    // ─────────────────────────────────────────────────────────────────────────

    /// Resolve the anchor (once), pin the SERVER encryption key, and get the
    /// hidden step-validation tag (created on first train, reused after).
    /// Shared by cone training and quick-shot training.
    @MainActor
    private func prepareValidationTag(for step: GuideStep) async -> (Tag, Anchor, SymmetricKey)? {
        let client = SIBClient(settings: settings)
        do {
            if anchorRecord == nil {
                anchorRecord = try await client.fetchAnchor(id: guide.anchorId)
            }
            guard let anchor = anchorRecord else { return nil }

            // ConeCaptureView encrypts every reference with
            // appState.anchorEncryptionKey — and falls back to a LOCAL random
            // key when that is nil. The server validates step references on
            // its own (no operator-supplied key), so the references MUST be
            // encrypted with the key stored on the anchor record. Pin it here.
            guard let serverKeyB64 = anchor.encryptionKey,
                  let serverKey = AnchorEncryption.key(fromBase64: serverKeyB64) else {
                saveError = "This anchor has no encryption key on the server — regenerate its QR from the portal, then train."
                return nil
            }
            appState.anchorEncryptionKey = serverKey

            let meta: [String: AnyCodable] = ["step_validation": AnyCodable(true),
                                              "guide_id":        AnyCodable(guide.id),
                                              "step_id":         AnyCodable(step.id)]
            let tag: Tag
            if let existingId = sessionTagIds[step.id] ?? step.validationTagId {
                // Reuse the existing hidden tag record — retraining replaces
                // its pass-state; no need to fetch, the fields are deterministic.
                tag = Tag(id: existingId, anchorId: anchor.id, type: .configurationCheck,
                          label: "\(step.displayTitle) — validation",
                          expectedOutcome: "Step completed correctly",
                          checkDescription: nil, order: nil, roi: nil, groupId: nil,
                          metadata: meta, isTrained: true, hasFailState: nil, createdAt: "", updatedAt: "")
            } else {
                tag = try await client.createTag(CreateTagRequest(
                    anchorId:        anchor.id,
                    type:            .configurationCheck,   // captureMode == .cone
                    label:           "\(step.displayTitle) — validation",
                    expectedOutcome: "Step completed correctly",
                    checkDescription: nil, order: nil, groupId: nil, metadata: meta))
            }
            sessionTagIds[step.id] = tag.id
            return (tag, anchor, serverKey)
        } catch {
            saveError = "Couldn't start training: \(error.localizedDescription)"
            return nil
        }
    }

    /// Cone (multi-angle) training — presents ConeCaptureView at the pin.
    @MainActor
    private func beginConeTraining(for step: GuideStep) async {
        guard !isPreparingTraining, let pos = stepPositions[step.id] else { return }
        isPreparingTraining = true
        defer { isPreparingTraining = false }
        guard let (tag, anchor, _) = await prepareValidationTag(for: step) else { return }
        trainingTarget = StepTrainingTarget(step: step, tag: tag, anchor: anchor, worldPos: pos)
    }

    /// W2 — Quick-shot training: ONE raw frame from where the Author is
    /// standing right now, plus the stance (distance + direction from the
    /// pin) so the operator can be guided back to the same viewpoint with a
    /// ghost overlay. Stored as a one-image pass-state on the hidden tag —
    /// so scoring, decryption and the operator flow are identical to cone.
    @MainActor
    private func quickShotTrain(for step: GuideStep) async {
        guard !isPreparingTraining, let pin = stepPositions[step.id],
              let frame = arManager.sceneView.session.currentFrame else { return }
        isPreparingTraining = true
        defer { isPreparingTraining = false }
        guard let (tag, anchor, key) = await prepareValidationTag(for: step) else { return }

        // Stance
        let t = frame.camera.transform
        let cam = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let vec = cam - pin
        let dist = simd_length(vec)
        let dir  = dist > 0.001 ? simd_normalize(vec) : simd_float3(0, 0, 1)

        // Raw frame (zero AR artifacts — same path as cone training)
        guard let img = rawCameraImage(from: frame),
              let jpeg = img.jpegData(compressionQuality: 0.65) else {
            saveError = "Couldn't capture the camera frame — try again."
            return
        }
        let client = SIBClient(settings: settings)
        do {
            let payload = (try? AnchorEncryption.encrypt(imageBase64: jpeg.base64EncodedString(), using: key))
                          ?? jpeg.base64EncodedString()
            let now = ISO8601DateFormatter().string(from: Date())
            try await client.trainPassState(CreatePassStateRequest(
                tagId: tag.id, anchorId: anchor.id, assetId: anchor.assetId, state: .pass,
                images: [PassStateImage(id: nil, tagId: tag.id, anchorId: anchor.id, assetId: anchor.assetId,
                                        imageBase64: payload, mimeType: "image/jpeg",
                                        pose: CameraPose(position: .zero, rotation: .identity), capturedAt: now)]))

            // Feature print (viewpoint-tolerant half of the verdict) + stance
            var meta: [String: AnyCodable] = [
                "training_kind": AnyCodable("shot"),
                "cone_dist_m":   AnyCodable(Double(dist)),
                "shot_dir_x":    AnyCodable(Double(dir.x)),
                "shot_dir_y":    AnyCodable(Double(dir.y)),
                "shot_dir_z":    AnyCodable(Double(dir.z)),
            ]
            if let fp = await TagFeaturePrint.extract(from: img) {
                meta["feature_prints"] = AnyCodable([fp.base64])
            }
            _ = try? await client.updateTag(id: tag.id, req: UpdateTagRequest(
                label: nil, expectedOutcome: nil, checkDescription: nil, order: nil, metadata: meta))

            try await client.markStepConeTrained(guideId: guide.id, stepId: step.id, tagId: tag.id)
            coneTrainedStepIds.insert(step.id)
            saveError = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            saveError = "Quick-shot training failed: \(error.localizedDescription)"
        }
    }

    /// Raw sensor frame, portrait, ≤ 800 px — identical to ConeCaptureView's
    /// capture so quick-shot references are comparable to cone references.
    private func rawCameraImage(from frame: ARFrame) -> UIImage? {
        let ci = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let ctx = CIContext(options: [.useSoftwareRenderer: false])
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return nil }
        let full = UIImage(cgImage: cg)
        let longest = max(full.size.width, full.size.height)
        guard longest > 800 else { return full }
        let scale = 800 / longest
        let size  = CGSize(width: (full.size.width * scale).rounded(), height: (full.size.height * scale).rounded())
        return UIGraphicsImageRenderer(size: size).image { _ in full.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// The cone sweep finished uploading its pass-state — stamp the step so
    /// the operator flow knows a system verdict is available (mode 'cone').
    private func finishConeTraining(step: GuideStep, tagId: String) async {
        do {
            try await SIBClient(settings: settings)
                .markStepConeTrained(guideId: guide.id, stepId: step.id, tagId: tagId)
            await MainActor.run { coneTrainedStepIds.insert(step.id) }
        } catch {
            await MainActor.run {
                saveError = "Training captured, but marking the step failed — retry from the seal button. (\(error.localizedDescription))"
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Saving overlay
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private var placedCount: Int { stepPositions.count }

    private func displayTitle(stepId: String) -> String {
        steps.first(where: { $0.id == stepId })?.displayTitle ?? "step"
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Init from existing server positions
    // ─────────────────────────────────────────────────────────────────────────

    private func initFromExistingPositions() {
        for step in steps {
            if let pos = step.worldPosition { stepPositions[step.id] = pos }
        }

        if let firstUnplaced = steps.firstIndex(where: { $0.worldPosition == nil }) {
            activeStepIndex = firstUnplaced
        } else if !steps.isEmpty {
            activeStepIndex = steps.count   // all placed — user taps pins to re-place
        }

        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            for (idx, step) in steps.enumerated() {
                guard let pos = stepPositions[step.id],
                      stepNodes[step.id] == nil else { continue }
                let node = makePin(number: step.sequenceNumber, isActive: idx == activeStepIndex)
                node.simdPosition = pos
                arManager.sceneView.scene.rootNode.addChildNode(node)
                stepNodes[step.id] = node
            }
        }

        // NOTE: no blind timed snapshot here. The re-localization reference
        // must be a view of STEP 1 — on resume it is captured by the ticker
        // only while the camera is actually looking at Step 1's pin (see
        // captureResumeReferenceIfLookingAtStep1). A 2 s snapshot of wherever
        // the Author happened to point (e.g. Step 3, opened just to train it)
        // was overwriting the Step-1 reference and misleading operators.
    }

    /// Resume sessions: opportunistically capture the Step-1 reference photo
    /// while the camera is on Step 1's pin (in view, ≤ 1.5 m). Fires once.
    private func captureResumeReferenceIfLookingAtStep1() {
        guard firstStepPhotoData == nil, resumeRefCaptureArmed,
              let first = steps.first, let node = stepNodes[first.id],
              let pov = arManager.sceneView.pointOfView,
              let frame = arManager.sceneView.session.currentFrame else { return }
        let cam  = simd_float3(frame.camera.transform.columns.3.x, frame.camera.transform.columns.3.y, frame.camera.transform.columns.3.z)
        let dist = simd_length(cam - node.simdWorldPosition)
        guard dist <= 1.5, arManager.sceneView.isNode(node, insideFrustumOf: pov) else { return }
        // Must also be roughly centred — projected within the middle 60 % of the screen.
        let p  = arManager.sceneView.projectPoint(node.worldPosition)
        let b  = arManager.sceneView.bounds
        let px = CGFloat(p.x), py = CGFloat(p.y)
        guard p.z > 0, px > b.width * 0.2, px < b.width * 0.8, py > b.height * 0.2, py < b.height * 0.8 else { return }
        firstStepPhotoData = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
        resumeRefCaptureArmed = false
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Activate step
    // ─────────────────────────────────────────────────────────────────────────

    private func activateStep(_ idx: Int) {
        guard idx < steps.count else { return }
        let prevIdx = activeStepIndex
        activeStepIndex = idx
        if prevIdx < steps.count { updatePinStyle(for: steps[prevIdx].id, isActive: false) }
        updatePinStyle(for: steps[idx].id, isActive: true)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Tap handler (pin placement)
    // ─────────────────────────────────────────────────────────────────────────

    private func handleTap(_ point: CGPoint) {
        let sv = arManager.sceneView

        // Check if tapping an existing pin → activate it
        let hits = sv.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue,
        ])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                for (stepId, pinNode) in stepNodes where n === pinNode {
                    if let idx = steps.firstIndex(where: { $0.id == stepId }) { activateStep(idx) }
                    return
                }
                candidate = n.parent
            }
        }

        // Surface raycast → place active step
        guard activeStepIndex < steps.count else { return }
        guard let pos = rayCastSurface(from: point, in: sv) else { return }
        placeActiveStep(at: pos)
        withAnimation { showTapHint = false }
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

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Pin placement
    // ─────────────────────────────────────────────────────────────────────────

    private func placeActiveStep(at position: simd_float3) {
        guard activeStepIndex < steps.count else { return }
        let step   = steps[activeStepIndex]
        let stepId = step.id

        if activeStepIndex == 0 {
            firstStepPhotoData = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
        }

        stepPositions[stepId] = position

        if let existing = stepNodes[stepId] {
            SCNTransaction.begin(); SCNTransaction.animationDuration = 0.22
            existing.simdPosition = position
            SCNTransaction.commit()
        } else {
            let node = makePin(number: step.sequenceNumber, isActive: true)
            node.simdPosition = position
            arManager.sceneView.scene.rootNode.addChildNode(node)
            stepNodes[stepId] = node
        }

        // If step has a model, enter model-placement flow.
        // Use resolvedModels (fetched on appear) to get correct hasUSDZ/hasGLB flags.
        // Pass the pre-cached file URL so downloadAndPlaceModel skips the network call.
        if let modelId = step.modelId,
           let model   = resolvedModels.first(where: { $0.id == modelId && $0.isReady }) {
            let cachedURL = modelFileCache[modelId]  // nil if pre-fetch not done yet
            placementPhase = .loadingModel(stepId: stepId)
            Task { await downloadAndPlaceModel(model: model, step: step, pinPos: position, cachedURL: cachedURL) }
        } else {
            advanceFromStep(stepId: stepId)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model pre-fetch + placement
    // ─────────────────────────────────────────────────────────────────────────

    /// Download + cache files for every model used by this guide's steps.
    /// Called on appear so the file is ready before the author taps to place a pin.
    private func prefetchStepModels(from models: [Model3D]) async {
        let neededIds = Set(steps.compactMap { $0.modelId })
        let targets   = models.filter { neededIds.contains($0.id) && $0.isReady && $0.hasUSDZ }
        await withTaskGroup(of: Void.self) { group in
            for model in targets { group.addTask { await self.cacheModelFile(model) } }
        }
    }

    /// Download the USDZ file and write it to the temp cache.
    /// Only USDZ is supported on iOS — GLB requires the ModelIO→SceneKit bridge removed in iOS 26.
    private func cacheModelFile(_ model: Model3D) async {
        guard await MainActor.run(resultType: URL?.self) { modelFileCache[model.id] } == nil else { return }
        guard model.hasUSDZ else { return }   // skip models still pending browser conversion
        let client  = SIBClient(settings: settings)
        let data    = try? await client.downloadModelUSDZ(id: model.id)
        guard let data else { return }
        let cacheDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ar-oms-placement", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let fileURL = cacheDir.appendingPathComponent("\(model.id).usdz")
        guard (try? data.write(to: fileURL)) != nil else { return }
        await MainActor.run { modelFileCache[model.id] = fileURL }
    }

    /// Place a 3D model in the scene at the given pin position.
    /// Uses the pre-cached file URL when available; falls back to downloading on demand.
    private func downloadAndPlaceModel(model: Model3D, step: GuideStep, pinPos: simd_float3,
                                       cachedURL: URL? = nil) async {
        // Resolve file URL — use pre-cache if available, otherwise download now.
        let fileURL: URL
        if let cached = cachedURL {
            fileURL = cached
        } else {
            // On-demand download: only proceed if USDZ is available.
            // GLB is not renderable on iOS 26+ — the portal converts it in the browser.
            guard model.hasUSDZ else {
                await MainActor.run { placementPhase = .placingPins; advanceFromStep(stepId: step.id) }
                return
            }
            let client = SIBClient(settings: settings)
            let data   = try? await client.downloadModelUSDZ(id: model.id)
            guard let data else {
                await MainActor.run { placementPhase = .placingPins; advanceFromStep(stepId: step.id) }
                return
            }
            let cacheDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("ar-oms-placement", isDirectory: true)
            try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
            let url = cacheDir.appendingPathComponent("\(model.id).usdz")
            guard (try? data.write(to: url)) != nil else {
                await MainActor.run { placementPhase = .placingPins; advanceFromStep(stepId: step.id) }
                return
            }
            fileURL = url
        }

        // Build SCNNode off-main thread; also compute bounding box for base-snapping.
        // SCNScene(url:) loads USDZ natively (iOS 12+). GLB requires ModelIO which
        // was removed in iOS 26 — the server auto-converts GLB → USDZ so hasUSDZ
        // will be true for all models by the time the iOS app downloads them.
        let buildResult: (SCNNode, Float)? = await Task.detached(priority: .utility) { () -> (SCNNode, Float)? in
            guard let scene = try? SCNScene(url: fileURL, options: [
                SCNSceneSource.LoadingOption.checkConsistency: false,
                SCNSceneSource.LoadingOption.flattenScene: false,
            ]) else { return nil }
            let children = scene.rootNode.childNodes
            guard !children.isEmpty else { return nil }
            let wrapper = SCNNode(); wrapper.name = "model_\(model.id)"
            children.forEach { wrapper.addChildNode($0.clone()) }
            // bb.min.y = bottom of model in local space (at scale = 1).
            // Used to snap the model's base to the pin position on first placement.
            let bb = wrapper.boundingBox
            return (wrapper, bb.min.y)
        }.value

        guard let (node, baseY) = buildResult else {
            await MainActor.run { placementPhase = .placingPins; advanceFromStep(stepId: step.id) }
            return
        }

        await MainActor.run {
            // Remove stale node for this step (re-placement)
            modelNodes[step.id]?.removeFromParentNode()

            // Initial transform: preserve existing step values, fall back to model defaults
            let initScale = Float(step.modelScale    ?? model.defaultScale ?? 1.0)
            let initRotY  = Float(step.modelRotationY ?? 0.0)

            // On first placement (no saved Y offset), auto-snap the model's base to the
            // pin position. baseY is bbMin.y at scale=1; -baseY * scale shifts the node
            // so the model's bottom face sits at pinPos.y instead of floating above it.
            // When the user has already manually adjusted Y (modelOffsetY != nil), use
            // their saved value directly — the auto-offset was already baked in on save.
            let hasManualY:  Bool  = step.modelOffsetY != nil
            let autoYOffset: Float = hasManualY ? 0.0 : (-baseY * initScale)
            let initPos   = simd_float3(
                pinPos.x + Float(step.modelOffsetX ?? 0),
                pinPos.y + Float(step.modelOffsetY ?? 0) + autoYOffset,
                pinPos.z + Float(step.modelOffsetZ ?? 0)
            )

            // Set position BEFORE addChildNode — simdPosition (local) is correct here
            // because the parent IS the scene root, so local == world.
            // simdWorldPosition requires the node to already be in the scene;
            // calling it on an unattached node silently leaves position at zero.
            node.simdPosition = initPos
            node.simdScale    = simd_float3(initScale, initScale, initScale)
            node.eulerAngles  = SCNVector3(0, initRotY, 0)
            node.opacity      = 0.65

            arManager.sceneView.scene.rootNode.addChildNode(node)
            modelNodes[step.id] = node

            modelPosition = initPos
            modelScale    = initScale
            modelRotY     = initRotY
            modelPanMode  = .horizontal

            placementPhase = .adjustingModel(stepId: step.id)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model confirm / skip
    // ─────────────────────────────────────────────────────────────────────────

    private func confirmModelPlacement(stepId: String) {
        modelTransforms[stepId] = ModelTransformState(
            position: modelPosition, scale: modelScale, rotationY: modelRotY
        )
        modelNodes[stepId]?.opacity = 0.55
        placementPhase = .placingPins
        advanceFromStep(stepId: stepId)
    }

    private func skipModelPlacement(stepId: String) {
        modelNodes[stepId]?.removeFromParentNode()
        modelNodes.removeValue(forKey: stepId)
        placementPhase = .placingPins
        advanceFromStep(stepId: stepId)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Advance to next step
    // ─────────────────────────────────────────────────────────────────────────

    private func advanceFromStep(stepId: String) {
        guard let idx = steps.firstIndex(where: { $0.id == stepId }) else { return }

        let nextUnplaced =
            steps.indices.first(where: { i in i > idx && stepPositions[steps[i].id] == nil })
            ?? steps.indices.first(where: { i in stepPositions[steps[i].id] == nil })

        if let next = nextUnplaced {
            updatePinStyle(for: stepId, isActive: false)
            activeStepIndex = next
            updatePinStyle(for: steps[next].id, isActive: true)
        } else {
            updatePinStyle(for: stepId, isActive: false)
            activeStepIndex = steps.count   // all-placed sentinel
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Pin factory
    // ─────────────────────────────────────────────────────────────────────────

    private func makePin(number: Int, isActive: Bool) -> SCNNode {
        let root  = SCNNode()
        let color = isActive ? activeColor : indigoColor

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
        root.addChildNode(ring)

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
                .foregroundColor: UIColor.white,
                .paragraphStyle: para,
            ]
            let ts = str.size(withAttributes: attrs)
            str.draw(at: CGPoint(x: (side - ts.width) / 2, y: (side - ts.height) / 2),
                     withAttributes: attrs)
        }
        let plane = SCNPlane(width: 0.054, height: 0.054)
        let mat   = SCNMaterial()
        mat.diffuse.contents = img
        mat.lightingModel    = .constant
        mat.isDoubleSided    = true
        plane.firstMaterial  = mat
        let node       = SCNNode(geometry: plane)
        let billboard  = SCNBillboardConstraint(); billboard.freeAxes = .all
        node.constraints = [billboard]
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

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model gesture handlers
    // ─────────────────────────────────────────────────────────────────────────

    private func handleModelPanBegan(_ pt: CGPoint) {
        panBasePos = modelPosition
        let sv   = arManager.sceneView
        let proj = sv.projectPoint(SCNVector3(modelPosition.x, modelPosition.y, modelPosition.z))
        panDepthZ    = proj.z
        let worldPt  = sv.unprojectPoint(SCNVector3(Float(pt.x), Float(pt.y), panDepthZ))
        panStartWorld = simd_float3(worldPt.x, worldPt.y, worldPt.z)
    }

    private func handleModelPanChanged(_ pt: CGPoint) {
        let sv      = arManager.sceneView
        let worldPt = sv.unprojectPoint(SCNVector3(Float(pt.x), Float(pt.y), panDepthZ))
        let delta: simd_float3
        switch modelPanMode {
        case .horizontal: delta = simd_float3(worldPt.x - panStartWorld.x, 0,                      worldPt.z - panStartWorld.z)
        case .vertical:   delta = simd_float3(0,                            worldPt.y - panStartWorld.y, 0)
        }
        let newPos = panBasePos + delta
        modelPosition = newPos
        if case .adjustingModel(let stepId) = placementPhase {
            modelNodes[stepId]?.simdWorldPosition = newPos
        }
    }

    private func handleModelPanEnded() {}

    private func handleModelPinchBegan() { scaleBase = modelScale }

    private func handleModelPinchChanged(_ factor: CGFloat) {
        let newScale = max(0.05, min(20.0, scaleBase * Float(factor)))
        modelScale = newScale
        if case .adjustingModel(let stepId) = placementPhase {
            modelNodes[stepId]?.simdScale = simd_float3(newScale, newScale, newScale)
        }
    }

    private func handleModelPinchEnded(_ factor: CGFloat) {}

    private func handleModelRotBegan() { rotYBase = modelRotY }

    private func handleModelRotChanged(_ rotation: CGFloat) {
        let newRot = rotYBase + Float(rotation)
        modelRotY = newRot
        if case .adjustingModel(let stepId) = placementPhase {
            modelNodes[stepId]?.eulerAngles = SCNVector3(0, newRot, 0)
        }
    }

    private func handleModelRotEnded(_ rotation: CGFloat) {}

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Save helpers
    // ─────────────────────────────────────────────────────────────────────────

    @MainActor
    private func patchChangedPositions() async -> (updated: [GuideStep], errors: [String]) {
        let client = SIBClient(settings: settings)
        var updatedSteps = steps
        var errors: [String] = []

        for (idx, step) in steps.enumerated() {
            guard let newPos = stepPositions[step.id] else { continue }

            let serverPos  = step.worldPosition
            let unchanged  = serverPos.map {
                abs($0.x - newPos.x) < 0.0001 &&
                abs($0.y - newPos.y) < 0.0001 &&
                abs($0.z - newPos.z) < 0.0001
            } ?? false
            if unchanged { continue }

            var req            = UpdateGuideStepRequest()
            req.posX           = Double(newPos.x)
            req.posY           = Double(newPos.y)
            req.posZ           = Double(newPos.z)
            req.isPlaced       = true
            req.positionSource = "tap"

            // Persist model placement if confirmed this session
            if let t = modelTransforms[step.id] {
                req.modelOffsetX   = Double(t.position.x - newPos.x)
                req.modelOffsetY   = Double(t.position.y - newPos.y)
                req.modelOffsetZ   = Double(t.position.z - newPos.z)
                req.modelScale     = Double(t.scale)
                req.modelRotationY = Double(t.rotationY)
            }

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

    @MainActor
    private func savePins() async {
        guard placedCount > 0 else { return }
        isSaving = true; savingIsExit = false; saveError = nil; lastSaveSucceeded = false
        let (_, errors) = await patchChangedPositions()
        isSaving = false
        if errors.isEmpty {
            withAnimation { lastSaveSucceeded = true }
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                withAnimation { lastSaveSucceeded = false }
            }
        } else {
            saveError = "Save incomplete — " + errors.joined(separator: "; ")
        }
    }

    @MainActor
    private func saveAndExit() async {
        guard placedCount > 0 else { return }
        isSaving = true; savingIsExit = true; saveError = nil
        let client    = SIBClient(settings: settings)
        // nil → the server keeps the existing Step-1 reference (it only
        // writes a photo when one is supplied). Never send a snapshot of
        // wherever the Author is standing at Save time.
        let photoData = firstStepPhotoData
        let mapData   = await arManager.saveCurrentWorldMap()
        let (updatedSteps, errors) = await patchChangedPositions()
        if let mapData {
            do {
                try await client.uploadGuideWorldMap(
                    guideId: guide.id, mapData: mapData, referencePhotoData: photoData)
            } catch {
                print("[GuideStepPlacementView] World map upload failed (non-fatal): \(error)")
            }
        }
        isSaving = false
        if errors.isEmpty { onDone(updatedSteps) }
        else { saveError = "Save incomplete — " + errors.joined(separator: "; ") }
    }
}
