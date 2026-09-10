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
import Combine
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
    // U4: each step can carry up to guideStepMaxModelSlots models; the chain
    // loads/adjusts them one slot at a time after the pin drop.
    case loadingModel(stepId: String, slotId: String)
    case adjustingModel(stepId: String, slotId: String)

    static func == (lhs: PlacementPhase, rhs: PlacementPhase) -> Bool {
        switch (lhs, rhs) {
        case (.placingPins, .placingPins):                                   return true
        case (.loadingModel(let a, let sa), .loadingModel(let b, let sb)):   return a == b && sa == sb
        case (.adjustingModel(let a, let sa), .adjustingModel(let b, let sb)): return a == b && sa == sb
        default:                                                             return false
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

    // F1 (2026.4.46): in-session FTUE — moment cards + ? cheat-sheet.
    @StateObject private var coach = ARMomentCoach(employeeId: {
        UserDefaults.standard.string(forKey: "uam_employee_id") ?? ""
    })
    @State private var showCheatSheet = false
    // H2: read a step in full without leaving AR (half sheet, camera stays live)
    @State private var readIndex: Int? = nil

    // ── A (2026.4.46): relocalize into the guide's world map before showing pins ──
    // Saved pin positions are coordinates in the AUTHOR's ORIGINAL session frame.
    // A fresh ARKit session has a different frame, so drawing them there put every
    // pin wherever the new origin happened to be — and Save wrote those wrong
    // positions back. Now, like the operator session, Place Steps relocalizes
    // into the guide map first; pins stay hidden until ARKit confirms the frame.
    private enum RelocState: Equatable {
        case none            // new guide / nothing placed yet → fresh frame is fine
        case relocalizing    // map loaded, waiting for ARKit + "I'm Here"
        case relocalized     // same frame as the map — pins trustworthy, Save extends the map
        case timedOut        // ARKit couldn't match — author must choose
        case replaceAll      // author chose a fresh frame: every pin is re-placed, map replaced
    }
    @State private var relocState: RelocState = .none
    @State private var relocBundle: WorldMapBundle? = nil
    @State private var relocPhoto:  UIImage? = nil
    @State private var relocGhostOpacity: Double = 0.4
    @State private var relocMissingMap = false     // pins exist but no map on SIB (legacy guide)
    // B2: the chamber's reference object. When detected and the guide map is
    // calibrated (objectPoseInMap), the session is re-based onto the map frame
    // without waiting for ARKit relocalization — pins land exactly, QR or not.
    @State private var objectBundle: ReferenceObjectCache.Bundle? = nil
    @State private var originViaObject = false
    // B2e: object is the ONLY frame for object-origin chambers (no initialWorldMap);
    // the room map is an explicit fallback. Re-scan invalidates the calibration
    // until the next Save (which writes a fresh objectPoseInMap).
    @State private var objectOnlyFrame        = false
    @State private var objectSearchStartedAt  = Date()
    @State private var approximateFromMap     = false
    @State private var objectCalibrationStale = false
    @State private var showRealignToast       = false
    @State private var showObjectRescan       = false
    @State private var shapeGhost: ObjectShapeGhost? = nil      // B3
    // P1: colleagues in front of this chamber (presence). Poses are shared
    // only while the session frame IS the guide map frame (relocalized).
    @State private var presence:        PresenceService? = nil
    @State private var presenceLayer:   PresenceLayer?   = nil
    @State private var presenceBag:     Set<AnyCancellable> = []
    @State private var presenceOthers:  [PresenceEntry] = []
    @State private var presenceLinked   = false
    @State private var presenceToast:   (text: String, color: UIColor)? = nil
    @State private var presenceFocus    = PresenceFocusBox()
    // C2: coaching an operator who is running this guide right now
    @State private var coachTarget:      PresenceEntry? = nil
    @State private var coachPointerMode  = false
    /// Server position of each step as of the last sync — the edit-echo baseline.
    @State private var remoteBaseline:  [String: simd_float3] = [:]
    private var objectExtent: simd_float3? {
        guard let e = objectBundle?.meta.extent else { return nil }
        return simd_float3(Float(e.x), Float(e.y), Float(e.z))
    }

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
    /// stepId → slotId → placed ghost node (U4: several per step).
    @State private var modelNodes:      [String: [String: SCNNode]] = [:]
    /// Confirmed transforms for steps adjusted in this session.
    /// stepId → slotId → confirmed world transform (this session).
    @State private var modelTransforms: [String: [String: ModelTransformState]] = [:]
    /// U4 "Copy models to…": target steps whose slot ASSIGNMENTS were replaced
    /// this session (saved as `models` on the next Save).
    @State private var slotOverrides:   [String: [GuideStepModel]] = [:]
    /// U4b (2026.4.46): true while adjusting ONE slot from the tray (not the
    /// pin-drop chain). Confirm/Cancel return to pin placement instead of
    /// advancing to the next slot. `adjustStart` restores the node on Cancel.
    @State private var singleSlotAdjust = false
    @State private var adjustStart: ModelTransformState? = nil

    /// T1 (2026.4.46): training feedback toast — the author sees the capture
    /// happen instead of a silent chip flip. Same toast for quick-shot and cone.
    private enum TrainingToast: Equatable {
        case holdSteady, training(String), trained, failed(String)
    }
    @State private var trainingToast: TrainingToast? = nil
    @State private var trainingToastSeq = 0
    /// U4: steps whose models are hidden while the author works on the pin.
    @State private var hiddenModelStepIds: Set<String> = []
    @State private var showCopySheet:   Bool = false

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
    /// X1: camera transform at the moment firstStepPhotoData was taken —
    /// uploaded with the world map so operators can detect drift.
    @State private var firstStepCameraPose: simd_float4x4? = nil
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
    /// F1b: "tap where Step N should go" after a pin is tapped for re-placement —
    /// until the person has seen it (shares the `placeMovePin` memory; Replay re-arms).
    @State private var showReplaceHint  = false
    private var employeeIdNow: String { UserDefaults.standard.string(forKey: "uam_employee_id") ?? "" }

    /// U1: when true, only the active step's pin/label/model is visible —
    /// declutters the scene while retraining or repositioning one step in a
    /// dense guide. Session-only (not saved). Mirrors the Operator-mode eye.
    @State private var focusActiveOnly: Bool = FocusPref.load(screen: "placeSteps")
    /// G3 fix: the step the eye focuses on. `activeStepIndex == steps.count` is
    /// the "all placed" sentinel (a surface tap must NOT re-place anything), so
    /// the focus needs its own memory — the last step tapped/placed, else Step 1.
    @State private var focusStepId: String? = nil
    // G2: "Clear all pins" — every step unplaced on Save (map kept; frame unchanged).
    @State private var clearedAllPins = false
    @State private var showClearAllConfirm = false

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

            // F1b: the pulsing hand — first pin, and once more on the first re-place.
            if placementPhase.isPlacingPins, activeStepIndex < steps.count,
               (showTapHint && stepPositions.isEmpty) || showReplaceHint {
                let n = steps[activeStepIndex].sequenceNumber
                ARTapCoach(
                    title:    showReplaceHint ? "Tap where Step \(n) should go" : "Tap any surface to place Step \(n)",
                    subtitle: showReplaceHint ? "The pin moves to your next tap" : "Point at the part, then tap",
                    accent:   .indigo,
                    onDismiss: {
                        if showReplaceHint { ARMomentStore.markSeen(.placeMovePin, employeeId: employeeIdNow) }
                        withAnimation(.easeOut(duration: 0.3)) { showTapHint = false; showReplaceHint = false }
                    }
                )
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
                .animation(.easeInOut(duration: 0.35), value: showTapHint || showReplaceHint)
            }

            // Model loading overlay
            if case .loadingModel = placementPhase {
                modelLoadingOverlay
            }

            // Bottom UI switches between step tray and model adjust bar
            switch placementPhase {
            case .placingPins, .loadingModel:
                VStack(spacing: 0) { stepTray; actionBar }
            case .adjustingModel(let stepId, let slotId):
                if let idx = steps.firstIndex(where: { $0.id == stepId }) {
                    modelAdjustBar(for: steps[idx], slotId: slotId)
                }
            }
        }
        .navigationBarHidden(true)
        .overlay(alignment: .top) { topBar }
        .sheet(isPresented: $showCopySheet) { copyModelsSheet }
        .overlay { if isSaving { savingOverlay } }
        .overlay(alignment: .center) {
            if let t = trainingToast { trainingToastView(t) }
        }
        .overlay { ARMomentCard(coach: coach, bottomInset: placementPhase.isPlacingPins ? 150 : 200, accent: .indigo) }
        .overlay { relocOverlay }
        .overlay(alignment: .top) { objectTrackOverlay }
        .overlay(alignment: .topTrailing) {
            if placementPhase.isPlacingPins, !presenceOthers.isEmpty {
                PresenceRosterChip(others: presenceOthers, connected: presenceLinked,
                                   onCoach: { coachTarget = $0; coachPointerMode = false })
                    .padding(.top, 70).padding(.trailing, 12)
            }
        }
        // C2: coach panel sits above the step tray
        .overlay(alignment: .bottom) {
            if let t = coachTarget, placementPhase.isPlacingPins {
                let live = liveCoachTarget(t)
                CoachPanel(
                    target:      live,
                    stepTitle:   coachStepTitle(live),
                    pointerMode: $coachPointerMode,
                    onSend:      { sendCoachHint($0, pointer: nil) },
                    onClose:     { coachTarget = nil; coachPointerMode = false }
                )
                .padding(.horizontal, 12).padding(.bottom, 170)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: coachTarget?.userId)
        .overlay { if !presenceOthers.isEmpty { PresenceEdgeArrows(others: presenceOthers, sceneView: arManager.sceneView) } }
        .overlay(alignment: .top) {
            if let t = presenceToast {
                PresenceToast(text: t.text, color: t.color).padding(.top, 110)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: presenceToast?.text)
        .onChange(of: relocState) { st in
            // Share my pose only once this session's frame is the guide map's.
            if st == .relocalized { startPresence() } else { stopPresence() }
        }
        .onChange(of: activeStepIndex) { idx in
            presenceFocus.stepId = idx < steps.count ? steps[idx].id : nil
        }
        .onDisappear { stopPresence() }
        .overlay(alignment: .bottom) {
            if arManager.objectRealignManual, relocState == .relocalized {
                ObjectFinderCard(title: "Re-aligning to the chamber", extent: objectExtent,
                                 startedAt: objectSearchStartedAt, onCancel: { arManager.cancelRealign() })
                    .padding(.horizontal, 16).padding(.bottom, 170)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: arManager.objectRealignManual)
        .confirmationDialog("Clear all \(placedCount) pin\(placedCount == 1 ? "" : "s")?", isPresented: $showClearAllConfirm, titleVisibility: .visible) {
            Button("Clear all pins", role: .destructive) { clearAllPins() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every step becomes unplaced when you Save. The world map, training and 3D model assignments are kept; model placements are dropped.")
        }
        .onChange(of: arManager.objectTransform) { objT in
            // B3: the ghost sits where the app thinks the chamber is.
            if objT != nil { shapeGhost?.update(objectTransform: objT); shapeGhost?.flash() }
            // B2: object found + calibrated map → re-base the world onto the map
            // frame and show the pins. Beats waiting for feature-point matching.
            // B2e: also while on the APPROXIMATE (map) frame — the chamber is the
            // truth; snap to it with Undo. Never with a stale (re-scanned) calibration.
            guard objT != nil, !originViaObject, !objectCalibrationStale,
                  relocState == .relocalizing || relocState == .timedOut || (approximateFromMap && relocState == .relocalized),
                  let cal = relocBundle?.meta.objectPoseInMapTransform else { return }
            if arManager.rebaseWorld(objectPoseInFrame: cal) {
                originViaObject = true
                let wasApproximate = approximateFromMap
                approximateFromMap = false
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                if relocState != .relocalized {
                    withAnimation { relocState = .relocalized }
                    placeExistingPinNodes()
                } else if wasApproximate {
                    flashRealignToast()
                }
            }
        }
        .onChange(of: arManager.objectRealignCount) { n in
            guard n > 0 else { return }
            flashRealignToast()
            shapeGhost?.update(objectTransform: arManager.objectTransform); shapeGhost?.flash()
        }
        // B2e: the author re-scans the chamber from the finder ("shape changed?")
        .fullScreenCover(isPresented: $showObjectRescan) {
            if let a = anchorRecord {
                ObjectScanView(anchor: a) { meta in
                    showObjectRescan = false
                    Task { await afterObjectRescan(meta) }
                }
                .environmentObject(settings)
            }
        }
        .onChange(of: arManager.relocalizationOutcome) { outcome in
            guard relocState == .relocalizing else { return }
            switch outcome {
            case .succeeded:
                // Same as the operator session: snap the moment ARKit matches —
                // no tap needed. Haptic so the author knows the pins are live.
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                withAnimation { relocState = .relocalized }
                placeExistingPinNodes()
            case .timedOut:
                relocState = .timedOut
            case .none:
                break
            }
        }
        .sheet(isPresented: $showCheatSheet) { GestureCheatSheet(screen: .placeSteps, coach: coach) }
        .sheet(isPresented: Binding(get: { readIndex != nil }, set: { if !$0 { readIndex = nil } })) {
            StepReadCard(
                steps: steps,
                index: Binding(get: { readIndex ?? 0 }, set: { readIndex = $0 }),
                models: resolvedModels,
                trainedStepIds: coneTrainedStepIds,
                placedStepIds: Set(stepPositions.keys))
            .environmentObject(settings)
        }
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
            arManager.disableQRScanning()
            initFromExistingPositions()
            if steps.contains(where: { $0.worldPosition != nil }) {
                // A: existing pins → relocalize into the guide map first.
                relocState = .relocalizing
                Task {
                    let client = SIBClient(settings: settings)
                    // B2: chamber object (if scanned) — detection runs alongside the map.
                    if let a = try? await client.fetchAnchor(id: guide.anchorId) {
                        await MainActor.run { anchorRecord = a }
                        if a.objectScannedAt != nil {
                            let ob = await ReferenceObjectCache.load(anchorId: a.id, client: client)
                            await MainActor.run { objectBundle = ob; arManager.setReferenceObject(ob?.archive, name: a.id) }
                            await loadShapeGhost(ob, client: client)
                        }
                    }
                    async let bundleFetch = WorldMapCache.load(.guide(guide.id), client: client)
                    async let photoFetch  = try? client.fetchGuideWorldMapPhoto(guideId: guide.id)
                    let (bundle, photo) = await (bundleFetch, photoFetch)
                    await MainActor.run {
                        relocBundle = bundle
                        if let pd = photo ?? nil { relocPhoto = UIImage(data: pd) }
                        if anchorRecord?.usesObjectOrigin == true, objectBundle != nil,
                           bundle?.meta.objectPoseInMap != nil {
                            // B2e: find the chamber by shape — the object is the frame.
                            // The map stays loaded only as an explicit fallback.
                            objectOnlyFrame       = true
                            objectSearchStartedAt = Date()
                            arManager.startSession()
                            arManager.disableQRScanning()
                        } else if let b = bundle {
                            arManager.startSessionWithWorldMap(b.map)
                            arManager.disableQRScanning()
                        } else {
                            // Legacy guide: pins without a map. Their frame is unknowable.
                            relocMissingMap = true
                            arManager.startSession()
                            arManager.disableQRScanning()
                            relocState = .timedOut
                        }
                    }
                }
            } else {
                // New guide: fresh frame. Still detect the object so the first
                // save can calibrate objectPoseInMap.
                Task {
                    let client = SIBClient(settings: settings)
                    if let a = try? await client.fetchAnchor(id: guide.anchorId) {
                        await MainActor.run { anchorRecord = a }
                        if a.objectScannedAt != nil {
                            let ob = await ReferenceObjectCache.load(anchorId: a.id, client: client)
                            await MainActor.run {
                                objectBundle = ob
                                arManager.setReferenceObject(ob?.archive, name: a.id)
                                arManager.startSession(); arManager.disableQRScanning()
                            }
                            await loadShapeGhost(ob, client: client)
                            return
                        }
                    }
                    await MainActor.run { arManager.startSession(); arManager.disableQRScanning() }
                }
                relocState = .none
                placeExistingPinNodes()
            }
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
            for perStep in modelNodes.values { for node in perStep.values { node.removeFromParentNode() } }
            focusRing?.cleanup()
            focusRing = nil
            arManager.pauseSession()
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
                if case .adjustingModel(let stepId, let slotId) = placementPhase {
                    skipModelPlacement(stepId: stepId, slotId: slotId)
                } else if case .loadingModel(let stepId, let slotId) = placementPhase {
                    // "Tap ✕ above to skip" — skip this slot, keep the session.
                    skipModelPlacement(stepId: stepId, slotId: slotId)
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
                case .loadingModel(let stepId, let slotId):
                    Text("Loading Model")
                        .font(.headline.bold()).foregroundStyle(.white)
                    Text("Preparing \(slotLabel(stepId: stepId, slotId: slotId)) · \(displayTitle(stepId: stepId))")
                        .font(.caption).foregroundStyle(.white.opacity(0.65))
                case .adjustingModel(let stepId, let slotId):
                    Text("Adjust \(slotLabel(stepId: stepId, slotId: slotId))")
                        .font(.headline.bold()).foregroundStyle(.white)
                    Text("Positioning for \(displayTitle(stepId: stepId))")
                        .font(.caption).foregroundStyle(.white.opacity(0.65))
                        .lineLimit(1)
                }
            }

            Spacer()

            // U1: eye toggle — hide every other step while working on one.
            // U4: cube toggle — hide the ACTIVE step's models while placing its pin.
            if placementPhase.isPlacingPins {
                if activeStepIndex < steps.count, !(modelNodes[steps[activeStepIndex].id] ?? [:]).isEmpty {
                    let sid = steps[activeStepIndex].id
                    let hidden = hiddenModelStepIds.contains(sid)
                    Button {
                        if hidden { hiddenModelStepIds.remove(sid) } else { hiddenModelStepIds.insert(sid) }
                        applyStepVisibility()
                    } label: {
                        Image(systemName: hidden ? "cube" : "cube.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(hidden ? Color.yellow : Color.white.opacity(0.85))
                            .frame(width: 26, height: 26)
                    }
                    .accessibilityLabel(hidden ? "Show this step's 3D models" : "Hide this step's 3D models")
                    .padding(.trailing, 6)
                }
                Button {
                    focusActiveOnly.toggle()
                    FocusPref.save(screen: "placeSteps", value: focusActiveOnly)   // G3: per person
                    applyStepVisibility()
                } label: {
                    Image(systemName: focusActiveOnly ? "eye.slash.fill" : "eye.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(focusActiveOnly ? Color.yellow : Color.white.opacity(0.85))
                        .frame(width: 26, height: 26)
                }
                .accessibilityLabel(focusActiveOnly ? "Show all steps" : "Show only the selected step")
                .padding(.trailing, 6)
                Button { showCheatSheet = true } label: {
                    Image(systemName: "questionmark.circle")
                        .font(.system(size: 20))
                        .foregroundStyle(.white.opacity(0.85))
                        .frame(width: 26, height: 26)
                }
                .accessibilityLabel("Controls and tips")
                .padding(.trailing, 16)
            } else {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 26)).foregroundStyle(.clear)
                    .padding(.trailing, 16)
            }
        }
        .padding(.vertical, 10).padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    /// U1: apply the focus filter to every pin + model node. With the filter
    /// off, or with no active step (all placed, nothing selected), everything
    /// is shown. Hidden nodes are also skipped by SceneKit hit-testing, so
    /// taps can't land on an invisible pin.
    private func applyStepVisibility() {
        if activeStepIndex < steps.count { focusStepId = steps[activeStepIndex].id }
        if focusStepId == nil { focusStepId = steps.first { stepPositions[$0.id] != nil }?.id ?? steps.first?.id }
        let activeId = focusStepId
        let hideOthers = focusActiveOnly && activeId != nil
        for (stepId, node) in stepNodes  { node.isHidden = hideOthers && stepId != activeId }
        for (stepId, perStep) in modelNodes {
            let hide = (hideOthers && stepId != activeId) || hiddenModelStepIds.contains(stepId)
            for node in perStep.values { node.isHidden = hide }
        }
    }

    /// U4: "Model 2 of 3 · Lock" style label for the phase header.
    private func slotLabel(stepId: String, slotId: String) -> String {
        guard let step = steps.first(where: { $0.id == stepId }) else { return "Model" }
        let slots = slots(for: step)
        let idx   = slots.firstIndex { $0.slotId == slotId } ?? 0
        let mid   = idx < slots.count ? slots[idx].modelId : nil
        let name  = resolvedModels.first { $0.id == mid }?.name
        let base  = slots.count > 1 ? "Model \(idx + 1) of \(slots.count)" : "Model"
        return name.map { "\(base) · \($0)" } ?? base
    }

    /// U4: the slots this session will render/save for a step — the copied
    /// assignments when "Copy models to…" replaced them, else the server's.
    private func slots(for step: GuideStep) -> [GuideStepModel] {
        slotOverrides[step.id] ?? step.effectiveModels
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

    private func modelAdjustBar(for step: GuideStep, slotId: String) -> some View {
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
                Button { skipModelPlacement(stepId: step.id, slotId: slotId) } label: {
                    Text(singleSlotAdjust ? "Cancel" : "Skip")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.white.opacity(0.12))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                Button { confirmModelPlacement(stepId: step.id, slotId: slotId) } label: {
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
        let hasModel  = !(modelTransforms[step.id] ?? [:]).isEmpty

        VStack(spacing: 4) {
            // H1: the NUMBER is always the face of the chip — a 20-step tray is
            // navigated by counting, not by reading. State lives on the rim.
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(isActive ? Color.blue :
                          placed   ? Color.indigo.opacity(0.85) : Color.gray.opacity(0.4))
                    .frame(width: 36, height: 36)
                Text("\(step.sequenceNumber)")
                    .font(.headline.bold()).foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                if placed {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .black)).foregroundStyle(.white)
                        .frame(width: 14, height: 14)
                        .background(Color.green, in: Circle())
                        .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 1))
                        .offset(x: 3, y: 3)
                }
                if let who = presenceOthers.first(where: { $0.focusId == step.id }) {
                    // P1 soft lock: a colleague is on this step right now.
                    Text(who.initials)
                        .font(.system(size: 7, weight: .black)).foregroundStyle(.white)
                        .frame(width: 15, height: 15)
                        .background(Color(PresencePalette.color(role: who.role, userId: who.userId)), in: Circle())
                        .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 1))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .offset(x: 4, y: -4)
                }
                if hasModel || step.hasModels {
                    Image(systemName: "cube.fill")
                        .font(.system(size: 7, weight: .black)).foregroundStyle(.white)
                        .frame(width: 14, height: 14)
                        .background(Color.cyan, in: Circle())
                        .overlay(Circle().stroke(Color.black.opacity(0.35), lineWidth: 1))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .offset(x: -3, y: 3)
                }
            }
            .frame(width: 36, height: 36)
            .contentShape(Rectangle())
            .onLongPressGesture { readIndex = idx }   // H2: read the step
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

            // U4b: per-slot adjust — every model of a PLACED step can be
            // positioned on its own, any time, without re-dropping the pin
            // (which restarts the whole chain from slot 1).
            if placed, placementPhase.isPlacingPins {
                let slotList = slots(for: step)
                if !slotList.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(Array(slotList.enumerated()), id: \.element.slotId) { i, slot in
                            let positioned = modelTransforms[step.id]?[slot.slotId] != nil || slot.hasPlacement
                            Button {
                                adjustSlot(step: step, slotId: slot.slotId)
                            } label: {
                                Text("⬢\(i + 1)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(positioned ? Color.indigo : Color.orange)
                                    .padding(.horizontal, 6).padding(.vertical, 3)
                                    .background(Color.black.opacity(0.35), in: Capsule())
                            }
                            .accessibilityLabel("Adjust model \(i + 1)\(positioned ? "" : " (not positioned yet)")")
                        }
                    }
                    .disabled(isSaving)
                }
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
                        HStack(spacing: 4) {
                            Text(s.displayTitle)
                                .font(.caption.bold()).foregroundStyle(.white).lineLimit(1)
                            Image(systemName: "info.circle").font(.caption2).foregroundStyle(.white.opacity(0.6))
                        }
                        if s.title != nil {
                            Text(s.text).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                        }
                    } else {
                        Text("All steps placed")
                            .font(.subheadline.bold()).foregroundStyle(.green)
                        Text("Tap an existing pin to re-place it · hold a step to read it")
                            .font(.caption).foregroundStyle(.white.opacity(0.55))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    // H2: read the active step (or the focused one when all are placed)
                    if activeStepIndex < steps.count { readIndex = activeStepIndex }
                    else if let f = focusStepId, let i = steps.firstIndex(where: { $0.id == f }) { readIndex = i }
                    else if !steps.isEmpty { readIndex = 0 }
                }

                HStack(spacing: 8) {
                    // ⋯ — the rarer actions live here so Save / Done never wrap.
                    let canCopy = activeStepIndex < steps.count && canCopyModels(from: steps[activeStepIndex])
                    if placedCount > 0 || canCopy {
                        Menu {
                            if canCopy {
                                Button { showCopySheet = true } label: {
                                    Label("Copy models to other steps…", systemImage: "square.on.square")
                                }
                            }
                            if placedCount > 0 {
                                Button(role: .destructive) { showClearAllConfirm = true } label: {
                                    Label("Clear all pins…", systemImage: "mappin.slash")
                                }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.subheadline.bold())
                                .padding(.horizontal, 12).padding(.vertical, 12)
                                .background(Color.white.opacity(0.14))
                                .foregroundStyle(.white).clipShape(Capsule())
                        }
                        .accessibilityLabel("More actions")
                        .disabled(isSaving)
                    }
                    Button { Task { await savePins() } } label: {
                        Text(lastSaveSucceeded ? "Saved ✓" : "Save")
                            .font(.subheadline.bold())
                            .lineLimit(1).fixedSize()
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
                            .lineLimit(1).fixedSize()
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
              arManager.sceneView.session.currentFrame != nil else { return }
        isPreparingTraining = true
        defer { isPreparingTraining = false }
        // T1: "Hold steady" beat — lets the author settle before the frame is
        // read, and makes the capture visible. The frame is re-read after it.
        showTrainingToast(.holdSteady)
        try? await Task.sleep(nanoseconds: 600_000_000)
        guard let frame = arManager.sceneView.session.currentFrame else {
            showTrainingToast(.failed("Camera frame unavailable — try again."), autoHide: false); return
        }
        showTrainingToast(.training("Building the reference for step \(step.sequenceNumber)"))
        guard let (tag, anchor, key) = await prepareValidationTag(for: step) else {
            showTrainingToast(.failed(saveError ?? "Couldn't prepare the step for training."), autoHide: false); return
        }

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
            showTrainingToast(.failed("Couldn't capture the camera frame — try again."), autoHide: false)
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
            showTrainingToast(.trained)
        } catch {
            saveError = "Quick-shot training failed: \(error.localizedDescription)"
            showTrainingToast(.failed("Training failed: \(error.localizedDescription)"), autoHide: false)
        }
    }

    /// Raw sensor frame, portrait, ≤ 800 px — identical to ConeCaptureView's
    /// capture so quick-shot references are comparable to cone references.
    private func rawCameraImage(from frame: ARFrame) -> UIImage? {
        // C: rotated to the SCREEN orientation (iPad landscape safe), ≤ 800 px.
        ARFrameImage.screenOriented(frame, maxPx: 800)
    }

    /// The cone sweep finished uploading its pass-state — stamp the step so
    /// the operator flow knows a system verdict is available (mode 'cone').
    private func finishConeTraining(step: GuideStep, tagId: String) async {
        await MainActor.run { showTrainingToast(.training("Sealing step \(step.sequenceNumber)")) }
        do {
            try await SIBClient(settings: settings)
                .markStepConeTrained(guideId: guide.id, stepId: step.id, tagId: tagId)
            await MainActor.run {
                coneTrainedStepIds.insert(step.id)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                showTrainingToast(.trained)
            }
        } catch {
            await MainActor.run {
                saveError = "Training captured, but marking the step failed — retry from the seal button. (\(error.localizedDescription))"
                showTrainingToast(.failed("Captured, but sealing the step failed — retry from the seal button."), autoHide: false)
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
    // MARK: Relocalization overlay (A)
    // ─────────────────────────────────────────────────────────────────────────

    @ViewBuilder
    private var relocOverlay: some View {
        if objectOnlyFrame, relocState == .relocalizing {
            // B2e: chamber = frame. Timer keeps the wait honest; after 15 s the
            // fallback (room map) and re-scan are explicit choices.
            VStack {
                Spacer()
                ObjectFinderCard(
                    title:      "Point at the chamber",
                    extent:     objectExtent,
                    startedAt:  objectSearchStartedAt,
                    onFallback: relocBundle != nil ? { placeFromLastKnownPosition() } : nil,
                    onRescan:   anchorRecord != nil ? { showObjectRescan = true } : nil,
                    objectMeta: objectBundle?.meta
                )
                .padding(.horizontal, 16).padding(.bottom, 48)
            }
            .transition(.opacity)
        } else if relocState == .relocalizing || relocState == .timedOut {
            ZStack {
                if relocState == .relocalizing, let img = relocPhoto {
                    Image(uiImage: img).resizable().scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .opacity(relocGhostOpacity).ignoresSafeArea().allowsHitTesting(false)
                }
                VStack {
                    Spacer()
                    VStack(spacing: 14) {
                        if relocState == .relocalizing {
                            let matched = arManager.relocalizationOutcome == .succeeded
                            VStack(spacing: 4) {
                                Text("Go to the Starting Point").font(.title3.bold()).foregroundStyle(.white)
                                Text(relocPhoto != nil
                                     ? "Line up the live view with the ghost of Step 1. Your pins appear the moment the space is matched."
                                     : "Stand where you set the guide up. Your pins appear the moment the space is matched.")
                                    .font(.caption).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                            }
                            HStack(spacing: 8) {
                                if matched {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                    Text("Space matched").font(.caption).foregroundStyle(.white.opacity(0.8))
                                } else {
                                    ProgressView().scaleEffect(0.8).tint(.indigo)
                                    Text(objectBundle != nil && relocBundle?.meta.objectPoseInMap != nil
                                         ? "Matching the space — or look at the chamber to find it by shape…"
                                         : "Matching the space…")
                                        .font(.caption).foregroundStyle(.white.opacity(0.55))
                                }
                            }
                            if relocPhoto != nil {
                                HStack(spacing: 10) {
                                    Image(systemName: "photo.fill").font(.caption).foregroundStyle(.white.opacity(0.4))
                                    Slider(value: $relocGhostOpacity, in: 0.15...0.65).tint(.indigo)
                                    Image(systemName: "eye.fill").font(.caption).foregroundStyle(.white.opacity(0.4))
                                }
                            }
                            // Pins snap in automatically on match (onChange above);
                            // this row is the "still matching" status.
                            HStack(spacing: 8) {
                                Image(systemName: "mappin.and.ellipse").foregroundStyle(.white.opacity(0.6))
                                Text(matched ? "Matched — showing your pins" : "Walk to Step 1 and hold the view steady")
                                    .font(.caption).foregroundStyle(.white.opacity(0.7))
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
                        } else {
                            VStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill").font(.title2).foregroundStyle(.orange)
                                Text(relocMissingMap ? "No world map for this guide" : "Couldn't match the space")
                                    .font(.title3.bold()).foregroundStyle(.white)
                                Text(relocMissingMap
                                     ? "These pins were saved before maps were kept, so their positions can't be trusted. Re-place them to seal a map."
                                     : "The pins can't be shown safely in an unmatched space — they would land in the wrong place and Save would keep them there.")
                                    .font(.caption).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                            }
                            if let b = relocBundle {
                                Button {
                                    relocState = .relocalizing
                                    arManager.startSessionWithWorldMap(b.map)
                                    arManager.disableQRScanning()
                                } label: {
                                    Label("Keep looking (walk to Step 1)", systemImage: "arrow.clockwise")
                                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 13)
                                        .background(Color.indigo).foregroundStyle(.white)
                                        .clipShape(RoundedRectangle(cornerRadius: 13))
                                }
                            }
                            Button { startReplaceAll() } label: {
                                Label("Re-place all pins in a fresh map", systemImage: "mappin.slash")
                                    .font(.subheadline.bold()).frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Color.orange.opacity(0.85)).foregroundStyle(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 13))
                            }
                        }
                    }
                    .padding(20)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    .padding(.horizontal, 16).padding(.bottom, 48)
                }
            }
            .transition(.opacity)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: B2e — movable chamber: fallback, re-scan, re-align UI
    // ─────────────────────────────────────────────────────────────────────────

    /// The author chose the room map over the chamber's shape. Pins are
    /// approximate until the chamber is recognised (then they snap, with Undo).
    private func placeFromLastKnownPosition() {
        guard let b = relocBundle else { return }
        objectOnlyFrame    = false
        approximateFromMap = true
        relocState         = .relocalizing
        arManager.startSessionWithWorldMap(b.map)     // object detection still runs
        arManager.disableQRScanning()
    }

    /// After a re-scan the object's own frame is new, so every stored
    /// calibration is void: relocalize through the map once and Save — the
    /// save writes objectPoseInMap for the new scan (the QR gate re-does
    /// objectPoseInQR on the author's next scan).
    @MainActor
    private func afterObjectRescan(_ meta: AnchorObjectMeta?) async {
        guard meta != nil, let a = anchorRecord else {
            // Cancelled: resume whatever we were doing.
            if objectOnlyFrame { arManager.startSession(); arManager.disableQRScanning() }
            else if let b = relocBundle, relocState == .relocalizing { arManager.startSessionWithWorldMap(b.map); arManager.disableQRScanning() }
            return
        }
        let client = SIBClient(settings: settings)
        let ob = await ReferenceObjectCache.load(anchorId: a.id, client: client)
        await MainActor.run {
            objectBundle            = ob
            objectCalibrationStale  = true
            originViaObject         = false
            arManager.setReferenceObject(ob?.archive, name: a.id)
            if relocBundle != nil {
                placeFromLastKnownPosition()
            } else {
                objectOnlyFrame = false
                arManager.startSession(); arManager.disableQRScanning()
                relocState = .timedOut
            }
        }
    }

    private func liveCoachTarget(_ t: PresenceEntry) -> PresenceEntry {
        presenceOthers.first { $0.userId == t.userId } ?? t
    }
    private func coachStepTitle(_ t: PresenceEntry) -> String? {
        guard let id = t.focusId else { return nil }
        return steps.first { $0.id == id }?.displayTitle
    }

    /// C2: send a hint to the operator's live session; a pointer draws the
    /// same marker on my side so I can see what they'll see.
    private func sendCoachHint(_ text: String, pointer: simd_float3?) {
        guard let t = coachTarget, let sid = t.sessionId else { return }
        let me = presence?.me.name
        let stepId = t.focusId
        if let p = pointer { presenceLayer?.showPointer(at: p, from: me ?? "You", color: .systemCyan, seconds: 8) }
        Task {
            do {
                try await SIBClient(settings: settings).sendCoachHint(liveSessionId: sid, text: text, from: me, stepId: stepId, pointer: pointer)
                showPresenceToast(pointer == nil ? "Sent to \(t.name)" : "Marker sent to \(t.name)", color: .systemCyan)
            } catch {
                showPresenceToast("Couldn't reach \(t.name): \(friendlyMessage(for: error))", color: .systemOrange)
            }
        }
    }

    /// B3: load the chamber's shape model (if one is set) as a ghost.
    private func loadShapeGhost(_ ob: ReferenceObjectCache.Bundle?, client: SIBClient) async {
        guard let meta = ob?.meta, let mid = meta.shapeModelId else { return }
        let g = await MainActor.run { ObjectShapeGhost(sceneView: arManager.sceneView, meta: meta) }
        await g.load(modelId: mid, client: client)
        await MainActor.run {
            shapeGhost = g
            if let t = arManager.objectTransform { g.update(objectTransform: t); g.flash() }
        }
    }

    private func flashRealignToast() {
        withAnimation { showRealignToast = true }
        Task {
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            withAnimation { showRealignToast = false }
        }
    }

    /// Status pill under the top bar + manual re-align finder + re-align toast.
    @ViewBuilder
    private var objectTrackOverlay: some View {
        if relocState == .relocalized, originViaObject || approximateFromMap, placementPhase.isPlacingPins {
            VStack(spacing: 8) {
                ObjectTrackPill(state: arManager.objectTrackState, approximate: approximateFromMap) {
                    guard originViaObject else { return }
                    objectSearchStartedAt = Date()
                    arManager.realignToObject()
                }
                if showRealignToast {
                    ObjectRealignToast {
                        arManager.undoLastRealign()
                        withAnimation { showRealignToast = false }
                    }
                }
            }
            .padding(.top, 70)
            .animation(.easeInOut(duration: 0.25), value: showRealignToast)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: P1 — presence (colleagues in front of this chamber)
    // ─────────────────────────────────────────────────────────────────────────

    private func startPresence() {
        guard presence == nil else { return }
        let svc = PresenceService(client: SIBClient(settings: settings), settings: settings,
                                  anchorId: guide.anchorId, surface: "placeSteps", guideId: guide.id)
        let mgr = arManager
        svc.poseProvider  = { mgr.sceneView.session.currentFrame?.camera.transform }
        let gid = guide.id
        svc.accepts = { $0.guideId == gid }          // same guide map frame only
        let focus = presenceFocus
        focus.stepId = activeStepIndex < steps.count ? steps[activeStepIndex].id : nil
        svc.focusProvider = { focus.stepId }
        let layer = PresenceLayer(sceneView: arManager.sceneView)
        svc.$others.receive(on: RunLoop.main).sink { list in
            presenceOthers = list
            layer.update(list)
        }.store(in: &presenceBag)
        svc.$isConnected.receive(on: RunLoop.main).sink { presenceLinked = $0 }.store(in: &presenceBag)
        svc.$event.receive(on: RunLoop.main).compactMap { $0 }.sink { ev in
            switch ev {
            case .joined(let e):
                showPresenceToast("\(e.name) joined\(e.site.map { " from \($0)" } ?? "")",
                                  color: PresencePalette.color(role: e.role, userId: e.userId))
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case .left(_, let name):
                showPresenceToast("\(name) left", color: .darkGray)
            case .stepsChanged:
                Task { await applyRemoteEdits() }
            case .tagsChanged, .coachHint:
                break                                   // not this surface
            }
            svc.event = nil
        }.store(in: &presenceBag)
        presence      = svc
        presenceLayer = layer
        svc.start()
    }

    private func stopPresence() {
        presence?.stop()
        presence = nil
        presenceBag.removeAll()
        presenceLayer?.removeAll()
        presenceLayer = nil
        presenceOthers = []
    }

    private func showPresenceToast(_ text: String, color: UIColor) {
        withAnimation { presenceToast = (text, color) }
        Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if presenceToast?.text == text { withAnimation { presenceToast = nil } }
        }
    }

    /// Edit echo: a colleague saved pins. Adopt server positions for steps I
    /// have NOT touched this session (pulse + "Name · just now"); keep mine
    /// where both of us moved the same step (mine wins on Save, with a note).
    @MainActor
    private func applyRemoteEdits() async {
        guard relocState == .relocalized,
              let fresh = try? await SIBClient(settings: settings).fetchGuideSteps(guideId: guide.id) else { return }
        var adopted = 0
        var conflicts: [String] = []
        for s in fresh {
            let serverPos = s.worldPosition
            let base      = remoteBaseline[s.id]
            let same: (simd_float3?, simd_float3?) -> Bool = { a, b in
                switch (a, b) {
                case (nil, nil): return true
                case let (x?, y?): return simd_length(x - y) < 0.0005
                default: return false
                }
            }
            guard !same(serverPos, base) else { continue }        // nothing new from the server
            let localUntouched = same(stepPositions[s.id], base)
            let who   = presenceOthers.first { $0.focusId == s.id } ?? presenceOthers.first
            let name  = who?.name ?? "A colleague"
            let color = who.map { PresencePalette.color(role: $0.role, userId: $0.userId) } ?? .systemPurple
            remoteBaseline[s.id] = serverPos
            guard localUntouched else { conflicts.append(s.displayTitle); continue }
            if let p = serverPos {
                stepPositions[s.id] = p
                if let node = stepNodes[s.id] {
                    SCNTransaction.begin(); SCNTransaction.animationDuration = 0.5
                    node.simdPosition = p
                    SCNTransaction.commit()
                } else if let idx = steps.firstIndex(where: { $0.id == s.id }) {
                    let node = makePin(number: s.sequenceNumber, isActive: idx == activeStepIndex)
                    node.simdPosition = p
                    arManager.sceneView.scene.rootNode.addChildNode(node)
                    stepNodes[s.id] = node
                }
                if let node = stepNodes[s.id] { PresenceLayer.pulse(node, color: color) }
                presenceLayer?.announceEdit(at: p, name: name, color: color)
            } else {
                stepPositions[s.id] = nil
                stepNodes[s.id]?.removeFromParentNode(); stepNodes[s.id] = nil
            }
            adopted += 1
        }
        if adopted > 0 { applyStepVisibility() }
        if !conflicts.isEmpty {
            showPresenceToast("Also moved by a colleague: \(conflicts.joined(separator: ", ")) — yours wins on Save", color: .systemOrange)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Training toast (T1)
    // ─────────────────────────────────────────────────────────────────────────

    private func showTrainingToast(_ t: TrainingToast, autoHide: Bool? = nil) {
        trainingToastSeq += 1
        let seq = trainingToastSeq
        withAnimation(.easeOut(duration: 0.2)) { trainingToast = t }
        let hide = autoHide ?? (t == .trained)
        guard hide else { return }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard trainingToastSeq == seq else { return }
            withAnimation(.easeIn(duration: 0.35)) { trainingToast = nil }
        }
    }

    @ViewBuilder
    private func trainingToastView(_ t: TrainingToast) -> some View {
        VStack(spacing: 10) {
            switch t {
            case .holdSteady:
                Image(systemName: "camera.viewfinder").font(.system(size: 34)).foregroundStyle(.cyan)
                Text("Hold steady").font(.headline).foregroundStyle(.white)
                Text("Capturing the reference from here…").font(.caption).foregroundStyle(.white.opacity(0.7))
            case .training(let detail):
                ProgressView().scaleEffect(1.3).tint(.white)
                Text("Training…").font(.headline).foregroundStyle(.white)
                Text(detail).font(.caption).foregroundStyle(.white.opacity(0.7))
            case .trained:
                Image(systemName: "checkmark.seal.fill").font(.system(size: 38)).foregroundStyle(.green)
                Text("Trained").font(.headline).foregroundStyle(.white)
            case .failed(let msg):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 30)).foregroundStyle(.orange)
                Text(msg).font(.caption).foregroundStyle(.white).multilineTextAlignment(.center)
                Button("OK") { withAnimation { trainingToast = nil } }
                    .font(.subheadline.bold()).foregroundStyle(.cyan)
            }
        }
        .padding(.horizontal, 26).padding(.vertical, 20)
        .frame(minWidth: 220)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.12)))
        .transition(.scale(scale: 0.92).combined(with: .opacity))
        .allowsHitTesting({ if case .failed = t { return true } else { return false } }())
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
            if let pos = step.worldPosition { stepPositions[step.id] = pos; remoteBaseline[step.id] = pos }
        }

        if let firstUnplaced = steps.firstIndex(where: { $0.worldPosition == nil }) {
            activeStepIndex = firstUnplaced
        } else if !steps.isEmpty {
            activeStepIndex = steps.count   // all placed — user taps pins to re-place
        }

        // Pin nodes are created by placeExistingPinNodes() — only once the
        // session frame is known to be the map's frame (A).

        // NOTE: no blind timed snapshot here. The re-localization reference
        // must be a view of STEP 1 — on resume it is captured by the ticker
        // only while the camera is actually looking at Step 1's pin (see
        // captureResumeReferenceIfLookingAtStep1). A 2 s snapshot of wherever
        // the Author happened to point (e.g. Step 3, opened just to train it)
        // was overwriting the Step-1 reference and misleading operators.
    }

    /// A: draw the saved pins. Called for a new guide immediately, or after
    /// ARKit relocalized into the guide map and the author tapped "I'm Here".
    private func placeExistingPinNodes() {
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
            applyStepVisibility()
        }
    }

    /// G2: unplace every step in this session (same frame, map kept).
    private func clearAllPins() {
        stepPositions.removeAll()
        for n in stepNodes.values { n.removeFromParentNode() }
        stepNodes.removeAll()
        for perStep in modelNodes.values { for n in perStep.values { n.removeFromParentNode() } }
        modelNodes.removeAll(); modelTransforms.removeAll(); slotOverrides.removeAll()
        activeStepIndex = 0
        clearedAllPins = true
        showTapHint = true
        applyStepVisibility()
    }

    /// A: the author gave up matching — every pin is re-placed in a fresh frame
    /// and Save/Done replaces the map. Server positions of steps not re-placed
    /// this session are cleared on Save so no pin can point into the old frame.
    private func startReplaceAll() {
        // G1: the old map must not linger on the server — Save/Done seals a new one.
        let gid = guide.id
        Task { _ = try? await SIBClient(settings: settings).deleteGuideWorldMap(guideId: gid) }
        relocBundle = nil
        stepPositions.removeAll()
        for n in stepNodes.values { n.removeFromParentNode() }
        stepNodes.removeAll()
        for perStep in modelNodes.values { for n in perStep.values { n.removeFromParentNode() } }
        modelNodes.removeAll(); modelTransforms.removeAll()
        activeStepIndex = 0
        firstStepPhotoData = nil; firstStepCameraPose = nil
        arManager.startSession()
        arManager.disableQRScanning()
        relocState = .replaceAll
        showTapHint = true
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
        firstStepPhotoData  = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
        firstStepCameraPose = frame.camera.transform
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
        applyStepVisibility()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Tap handler (pin placement)
    // ─────────────────────────────────────────────────────────────────────────

    private func handleTap(_ point: CGPoint) {
        // A: no placement until the frame is trustworthy.
        guard relocState != .relocalizing, relocState != .timedOut else { return }
        let sv = arManager.sceneView

        // C2: "Point here" — this tap is a look-here marker for the operator, not a pin.
        if coachPointerMode, coachTarget != nil {
            if let q = sv.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .any),
               let hit = sv.session.raycast(q).first {
                let p = simd_float3(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
                sendCoachHint("Look here", pointer: p)
            } else {
                showPresenceToast("No surface there — try a spot on the chamber", color: .systemOrange)
            }
            coachPointerMode = false
            return
        }

        // Check if tapping an existing pin → activate it
        let hits = sv.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue,
        ])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                for (stepId, pinNode) in stepNodes where n === pinNode {
                    if let idx = steps.firstIndex(where: { $0.id == stepId }) { activateStep(idx) }
                    // F1b: teach re-placement with the hand once per session.
                    if !ARMomentStore.seen(.placeMovePin, employeeId: employeeIdNow) {
                        withAnimation { showReplaceHint = true }
                    }
                    return
                }
                candidate = n.parent
            }
        }

        // Surface raycast → place active step
        guard activeStepIndex < steps.count else { return }
        guard let pos = rayCastSurface(from: point, in: sv) else { return }
        placeActiveStep(at: pos)
        if showReplaceHint { ARMomentStore.markSeen(.placeMovePin, employeeId: employeeIdNow) }
        withAnimation { showTapHint = false; showReplaceHint = false }
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
            firstStepPhotoData  = arManager.sceneView.snapshot().jpegData(compressionQuality: 0.72)
            firstStepCameraPose = arManager.sceneView.session.currentFrame?.camera.transform
        }

        stepPositions[stepId] = position
        // F1 moments — first pin: move it; second pin: declutter; validation step: train.
        if stepPositions.count == 1 { coach.show(.placeMovePin) }
        if stepPositions.count == 2 { coach.show(.placeDeclutter) }
        if step.needsValidation      { coach.show(.placeTrainStep) }

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

        // U4: re-placing a pin restarts the model chain — drop this session's
        // nodes/transforms for the step so every slot is positioned afresh.
        for node in (modelNodes[stepId] ?? [:]).values { node.removeFromParentNode() }
        modelNodes[stepId] = nil
        modelTransforms[stepId] = nil

        // Walk the step's model slots (U4) — each ready model is loaded and
        // adjusted in turn; steps without models advance immediately.
        startModelChain(step: step, pinPos: position, fromSlot: 0)
    }

    /// U4: load + adjust the step's model slots one after another starting at
    /// `fromSlot`; slots whose model isn't ready are skipped silently.
    private func startModelChain(step: GuideStep, pinPos: simd_float3, fromSlot: Int) {
        let slotList = slots(for: step)
        var i = fromSlot
        while i < slotList.count {
            let slot = slotList[i]
            if let model = resolvedModels.first(where: { $0.id == slot.modelId && $0.isReady }) {
                let cachedURL = modelFileCache[model.id]  // nil if pre-fetch not done yet
                placementPhase = .loadingModel(stepId: step.id, slotId: slot.slotId)
                Task { await downloadAndPlaceModel(model: model, step: step, slot: slot, pinPos: pinPos, cachedURL: cachedURL) }
                return
            }
            i += 1
        }
        placementPhase = .placingPins
        if slotList.count >= 2 { coach.show(.placeAdjustSlots) }   // F1: chain done for a multi-model step
        advanceFromStep(stepId: step.id)
    }

    /// Continue the chain after `slotId` was confirmed or skipped.
    private func continueModelChain(stepId: String, after slotId: String) {
        // U4b: a single-slot adjust from the tray ends here — back to pins.
        if singleSlotAdjust {
            singleSlotAdjust = false
            adjustStart      = nil
            placementPhase   = .placingPins
            return
        }
        guard let step = steps.first(where: { $0.id == stepId }),
              let pin  = stepPositions[stepId] else {
            placementPhase = .placingPins; advanceFromStep(stepId: stepId); return
        }
        let idx = slots(for: step).firstIndex { $0.slotId == slotId } ?? -1
        startModelChain(step: step, pinPos: pin, fromSlot: idx + 1)
    }

    /// U4b: adjust one slot of an already-placed step. Reuses this session's
    /// node when it exists; otherwise loads the model at its saved offsets
    /// (or at the pin when it was never positioned).
    private func adjustSlot(step: GuideStep, slotId: String) {
        guard placementPhase.isPlacingPins,
              let pin  = stepPositions[step.id],
              let slot = slots(for: step).first(where: { $0.slotId == slotId }) else { return }
        activateStepIfNeeded(step)
        singleSlotAdjust = true
        if let node = modelNodes[step.id]?[slotId] {
            modelPosition = node.simdPosition
            modelScale    = node.simdScale.x
            modelRotY     = node.eulerAngles.y
            modelPanMode  = .horizontal
            adjustStart   = ModelTransformState(position: modelPosition, scale: modelScale, rotationY: modelRotY)
            node.opacity  = 0.65
            hiddenModelStepIds.remove(step.id)
            applyStepVisibility()
            placementPhase = .adjustingModel(stepId: step.id, slotId: slotId)
            return
        }
        guard let model = resolvedModels.first(where: { $0.id == slot.modelId && $0.isReady }) else {
            singleSlotAdjust = false
            saveError = "Model for slot isn't ready on the server yet."
            return
        }
        adjustStart = nil
        placementPhase = .loadingModel(stepId: step.id, slotId: slotId)
        let cachedURL = modelFileCache[model.id]
        Task { await downloadAndPlaceModel(model: model, step: step, slot: slot, pinPos: pin, cachedURL: cachedURL) }
    }

    private func activateStepIfNeeded(_ step: GuideStep) {
        if let idx = steps.firstIndex(where: { $0.id == step.id }), idx != activeStepIndex {
            activateStep(idx)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model pre-fetch + placement
    // ─────────────────────────────────────────────────────────────────────────

    /// Download + cache files for every model used by this guide's steps.
    /// Called on appear so the file is ready before the author taps to place a pin.
    private func prefetchStepModels(from models: [Model3D]) async {
        let neededIds = Set(steps.flatMap { slots(for: $0).map(\.modelId) })
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
    private func downloadAndPlaceModel(model: Model3D, step: GuideStep, slot: GuideStepModel,
                                       pinPos: simd_float3, cachedURL: URL? = nil) async {
        // Resolve file URL — use pre-cache if available, otherwise download now.
        let fileURL: URL
        if let cached = cachedURL {
            fileURL = cached
        } else {
            // On-demand download: only proceed if USDZ is available.
            // GLB is not renderable on iOS 26+ — the portal converts it in the browser.
            guard model.hasUSDZ else {
                await MainActor.run { continueModelChain(stepId: step.id, after: slot.slotId) }
                return
            }
            let client = SIBClient(settings: settings)
            let data   = try? await client.downloadModelUSDZ(id: model.id)
            guard let data else {
                await MainActor.run { continueModelChain(stepId: step.id, after: slot.slotId) }
                return
            }
            let cacheDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("ar-oms-placement", isDirectory: true)
            try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
            let url = cacheDir.appendingPathComponent("\(model.id).usdz")
            guard (try? data.write(to: url)) != nil else {
                await MainActor.run { continueModelChain(stepId: step.id, after: slot.slotId) }
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
            let wrapper = SCNNode(); wrapper.name = "model_\(model.id)_\(slot.slotId)"
            children.forEach { wrapper.addChildNode($0.clone()) }
            // bb.min.y = bottom of model in local space (at scale = 1).
            // Used to snap the model's base to the pin position on first placement.
            let bb = wrapper.boundingBox
            return (wrapper, bb.min.y)
        }.value

        guard let (node, baseY) = buildResult else {
            await MainActor.run { continueModelChain(stepId: step.id, after: slot.slotId) }
            return
        }

        await MainActor.run {
            // The author skipped (✕) while this was loading — drop it silently.
            guard placementPhase == .loadingModel(stepId: step.id, slotId: slot.slotId) else { return }
            // Remove stale node for this slot (re-placement)
            modelNodes[step.id]?[slot.slotId]?.removeFromParentNode()

            // Initial transform: preserve the slot's saved values, fall back to model defaults
            let initScale = Float(slot.modelScale    ?? model.defaultScale ?? 1.0)
            let initRotY  = Float(slot.modelRotationY ?? 0.0)

            // On first placement (no saved Y offset), auto-snap the model's base to the
            // pin position. baseY is bbMin.y at scale=1; -baseY * scale shifts the node
            // so the model's bottom face sits at pinPos.y instead of floating above it.
            // When the user has already manually adjusted Y (modelOffsetY != nil), use
            // their saved value directly — the auto-offset was already baked in on save.
            let hasManualY:  Bool  = slot.modelOffsetY != nil
            let autoYOffset: Float = hasManualY ? 0.0 : (-baseY * initScale)
            let initPos   = simd_float3(
                pinPos.x + Float(slot.modelOffsetX ?? 0),
                pinPos.y + Float(slot.modelOffsetY ?? 0) + autoYOffset,
                pinPos.z + Float(slot.modelOffsetZ ?? 0)
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
            modelNodes[step.id, default: [:]][slot.slotId] = node
            hiddenModelStepIds.remove(step.id)   // adjusting → must be visible
            applyStepVisibility()

            modelPosition = initPos
            modelScale    = initScale
            modelRotY     = initRotY
            modelPanMode  = .horizontal

            placementPhase = .adjustingModel(stepId: step.id, slotId: slot.slotId)
            coach.show(.placeModelGestures)   // F1
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Model confirm / skip
    // ─────────────────────────────────────────────────────────────────────────

    private func confirmModelPlacement(stepId: String, slotId: String) {
        modelTransforms[stepId, default: [:]][slotId] = ModelTransformState(
            position: modelPosition, scale: modelScale, rotationY: modelRotY
        )
        modelNodes[stepId]?[slotId]?.opacity = 0.55
        continueModelChain(stepId: stepId, after: slotId)
    }

    private func skipModelPlacement(stepId: String, slotId: String) {
        if singleSlotAdjust {
            // Cancel: put the node back where it was (or drop a freshly loaded
            // one that was never positioned) — nothing is recorded.
            if let start = adjustStart, let node = modelNodes[stepId]?[slotId] {
                node.simdPosition = start.position
                node.simdScale    = simd_float3(start.scale, start.scale, start.scale)
                node.eulerAngles  = SCNVector3(0, start.rotationY, 0)
                node.opacity      = 0.55
            } else if modelTransforms[stepId]?[slotId] == nil {
                modelNodes[stepId]?[slotId]?.removeFromParentNode()
                modelNodes[stepId]?.removeValue(forKey: slotId)
            }
            continueModelChain(stepId: stepId, after: slotId)
            return
        }
        modelNodes[stepId]?[slotId]?.removeFromParentNode()
        modelNodes[stepId]?.removeValue(forKey: slotId)
        continueModelChain(stepId: stepId, after: slotId)
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
        applyStepVisibility()
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
        if case .adjustingModel(let stepId, let slotId) = placementPhase {
            modelNodes[stepId]?[slotId]?.simdWorldPosition = newPos
        }
    }

    private func handleModelPanEnded() {}

    private func handleModelPinchBegan() { scaleBase = modelScale }

    private func handleModelPinchChanged(_ factor: CGFloat) {
        let newScale = max(0.05, min(20.0, scaleBase * Float(factor)))
        modelScale = newScale
        if case .adjustingModel(let stepId, let slotId) = placementPhase {
            modelNodes[stepId]?[slotId]?.simdScale = simd_float3(newScale, newScale, newScale)
        }
    }

    private func handleModelPinchEnded(_ factor: CGFloat) {}

    private func handleModelRotBegan() { rotYBase = modelRotY }

    private func handleModelRotChanged(_ rotation: CGFloat) {
        let newRot = rotYBase + Float(rotation)
        modelRotY = newRot
        if case .adjustingModel(let stepId, let slotId) = placementPhase {
            modelNodes[stepId]?[slotId]?.eulerAngles = SCNVector3(0, newRot, 0)
        }
    }

    private func handleModelRotEnded(_ rotation: CGFloat) {}

    // ─────────────────────────────────────────────────────────────────────────
    // MARK: U4 — Copy models to other steps
    // ─────────────────────────────────────────────────────────────────────────

    /// A step can be a copy source once it has a pin and at least one slot
    /// with a known world transform (confirmed this session, or saved offsets).
    private func canCopyModels(from step: GuideStep) -> Bool {
        guard stepPositions[step.id] != nil else { return false }
        return slots(for: step).contains { worldTransform(step: step, slot: $0) != nil }
    }

    /// World transform of a slot: this session's confirmed value, else the
    /// saved offsets re-based on the step's pin. nil = never positioned.
    private func worldTransform(step: GuideStep, slot: GuideStepModel) -> ModelTransformState? {
        if let t = modelTransforms[step.id]?[slot.slotId] { return t }
        guard let pin = stepPositions[step.id], slot.hasPlacement else { return nil }
        return ModelTransformState(
            position:  simd_float3(pin.x + Float(slot.modelOffsetX ?? 0),
                                   pin.y + Float(slot.modelOffsetY ?? 0),
                                   pin.z + Float(slot.modelOffsetZ ?? 0)),
            scale:     Float(slot.modelScale ?? 1.0),
            rotationY: Float(slot.modelRotationY ?? 0.0))
    }

    @State private var copyTargets: Set<String> = []

    private var copyModelsSheet: some View {
        let source = activeStepIndex < steps.count ? steps[activeStepIndex] : nil
        return NavigationStack {
            List {
                if let source {
                    Section {
                        ForEach(steps.filter { $0.id != source.id }) { step in
                            let placed = stepPositions[step.id] != nil
                            Button {
                                if copyTargets.contains(step.id) { copyTargets.remove(step.id) }
                                else { copyTargets.insert(step.id) }
                            } label: {
                                HStack {
                                    Image(systemName: copyTargets.contains(step.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(copyTargets.contains(step.id) ? Color.teal : Color.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Step \(step.sequenceNumber): \(step.displayTitle)")
                                            .foregroundStyle(.primary)
                                        if !placed {
                                            Text("Place this step's pin first")
                                                .font(.caption2).foregroundStyle(.orange)
                                        } else if !slots(for: step).isEmpty {
                                            Text("Replaces its \(slots(for: step).count) model(s)")
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                            .disabled(!placed)
                        }
                    } header: {
                        Text("Copy \(slots(for: source).count) model(s) from Step \(source.sequenceNumber) to…")
                    } footer: {
                        Text("Models land at the same physical spot on every selected step — useful when one part is shared across steps. Saved on the next Save / Done.")
                    }
                }
            }
            .navigationTitle("Copy models")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showCopySheet = false; copyTargets = [] }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Copy") {
                        if let source { applyCopyModels(from: source, to: copyTargets) }
                        showCopySheet = false; copyTargets = []
                    }
                    .disabled(copyTargets.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// Replace each target's slots with the source's (same slotIds, same
    /// world transforms) and mirror the ghost nodes so the author sees them.
    private func applyCopyModels(from source: GuideStep, to targetIds: Set<String>) {
        let srcSlots = slots(for: source)
        for target in steps where targetIds.contains(target.id) {
            guard stepPositions[target.id] != nil else { continue }
            for node in (modelNodes[target.id] ?? [:]).values { node.removeFromParentNode() }
            modelNodes[target.id] = [:]
            modelTransforms[target.id] = [:]
            slotOverrides[target.id] = srcSlots.map { slot in
                // Assignment only — placement comes from the copied world transform.
                GuideStepModel(slotId: slot.slotId, modelId: slot.modelId,
                               modelScale: slot.modelScale, modelOpacity: slot.modelOpacity)
            }
            for slot in srcSlots {
                guard let t = worldTransform(step: source, slot: slot) else { continue }
                modelTransforms[target.id, default: [:]][slot.slotId] = t
                if let srcNode = modelNodes[source.id]?[slot.slotId] {
                    let clone = srcNode.clone()
                    clone.simdPosition = t.position
                    clone.simdScale    = simd_float3(t.scale, t.scale, t.scale)
                    clone.eulerAngles  = SCNVector3(0, t.rotationY, 0)
                    clone.opacity      = 0.55
                    arManager.sceneView.scene.rootNode.addChildNode(clone)
                    modelNodes[target.id, default: [:]][slot.slotId] = clone
                }
            }
        }
        applyStepVisibility()
    }

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
            let posUnchanged = serverPos.map {
                abs($0.x - newPos.x) < 0.0001 &&
                abs($0.y - newPos.y) < 0.0001 &&
                abs($0.z - newPos.z) < 0.0001
            } ?? false
            // U4: model work (adjusted this session, or slots copied in) is
            // saved even when the pin itself didn't move.
            let transforms   = modelTransforms[step.id] ?? [:]
            let modelChanged = !transforms.isEmpty || slotOverrides[step.id] != nil
            if posUnchanged && !modelChanged { continue }

            var req            = UpdateGuideStepRequest()
            req.posX           = Double(newPos.x)
            req.posY           = Double(newPos.y)
            req.posZ           = Double(newPos.z)
            req.isPlaced       = true
            req.positionSource = "tap"

            // Persist every model slot (U4). Slots confirmed this session get
            // their world transform re-expressed as offsets from THIS pin;
            // untouched slots keep whatever the server already had.
            if modelChanged {
                req.models = slots(for: step).map { slot in
                    var out = slot
                    if let t = transforms[slot.slotId] {
                        out.modelOffsetX   = Double(t.position.x - newPos.x)
                        out.modelOffsetY   = Double(t.position.y - newPos.y)
                        out.modelOffsetZ   = Double(t.position.z - newPos.z)
                        out.modelScale     = Double(t.scale)
                        out.modelRotationY = Double(t.rotationY)
                    }
                    return out
                }
            }

            do {
                let fresh = try await client.updateGuideStep(
                    guideId: guide.id, stepId: step.id, req: req)
                updatedSteps[idx] = fresh
            } catch {
                errors.append("Step \(step.sequenceNumber): \(error.localizedDescription)")
            }
        }
        // A / G2: after "Re-place all" or "Clear all pins", steps not re-placed
        // this session are unplaced on the server so no pin can point into a
        // frame that no longer exists (isPlaced=false; worldPosition reads nil).
        if relocState == .replaceAll || clearedAllPins {
            for (idx, step) in steps.enumerated() where stepPositions[step.id] == nil && step.worldPosition != nil {
                var req = UpdateGuideStepRequest()
                req.isPlaced = false
                do { updatedSteps[idx] = try await client.updateGuideStep(guideId: guide.id, stepId: step.id, req: req) }
                catch { errors.append("Step \(step.sequenceNumber): \(error.localizedDescription)") }
            }
        }
        return (updatedSteps, errors)
    }

    @MainActor
    private func savePins() async {
        guard placedCount > 0 else { return }
        coach.show(.placeSaveVsDone)   // F1
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
        // A: never upload a map from a frame that isn't the guide's frame.
        let frameIsMapFrame = relocBundle == nil || relocState == .relocalized || relocState == .replaceAll
        let mapData   = frameIsMapFrame ? await arManager.saveCurrentWorldMap() : nil
        let (updatedSteps, errors) = await patchChangedPositions()
        // B2: the object's pose in the map frame — valid only while the session
        // frame IS the map frame (which includes an object-rebased session).
        let objectPoseInMap: [Float]? = (frameIsMapFrame && objectBundle != nil)
            ? arManager.objectTransform.map { ARCoordinateFrame.floats(from: $0) } : nil
        if let mapData {
            do {
                let pose: [Float]? = firstStepCameraPose.map { m in
                    (0..<4).flatMap { c in (0..<4).map { r in m[c][r] } }
                }
                try await client.uploadGuideWorldMap(
                    guideId: guide.id, mapData: mapData, referencePhotoData: photoData,
                    referenceCameraPose: pose, objectPoseInMap: objectPoseInMap)
                // B1: refresh the shared cache with the server's stamp so the next
                // run on this device is a cache hit instead of a re-download.
                if let meta = try? await client.fetchGuideWorldMapMeta(guideId: guide.id) {
                    WorldMapCache.store(.guide(guide.id), map: mapData, meta: meta)
                }
                if objectPoseInMap != nil { objectCalibrationStale = false }   // B2e: re-scan calibrated
            } catch {
                print("[GuideStepPlacementView] World map upload failed (non-fatal): \(error)")
            }
        } else if let cal = objectPoseInMap, let t = ARCoordinateFrame.transform(from: cal) {
            // No map upload this time but the frame is the map's — refresh calibration.
            if (try? await client.calibrateGuideObject(guideId: guide.id, objectPoseInMap: t)) != nil {
                objectCalibrationStale = false
            }
        }
        isSaving = false
        if errors.isEmpty { onDone(updatedSteps) }
        else { saveError = "Save incomplete — " + errors.joined(separator: "; ") }
    }
}
