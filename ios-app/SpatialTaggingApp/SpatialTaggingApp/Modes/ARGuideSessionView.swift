// ARGuideSessionView.swift — AR OMS Phase 3
//
// Full-screen AR session for an Operator running a published Guide.
//
// State machine:
//   .loading      — download ARWorldMap + reference photo (steps pre-fetched by caller)
//   .relocalizing — ghost photo overlay + "I'm Here" + ARKit worldmap matching
//   .navigating(index:) — 3D pins + world-anchored floating panels + distance telemetry
//   .submitted    — done overlay after sign-off
//
// Phase 3 additions:
//   • 3D world-anchored floating panel per step (SCNPlane + SCNBillboardConstraint)
//     – Minimized pill:  step title · audio · distance · expand chevron
//     – Maximized card:  description · reference image · audio · evidence camera ·
//                        mark-complete (auto-advance) · sign-off on final step
//   • Evidence photo capture per step (optional, one photo, included in sign-off)
//   • Bug fix: reference photo captured at Step-1 placement (done in GuideStepPlacementView)

import SwiftUI
import ARKit
import SceneKit
import simd
import AVFoundation

// ── Main view ─────────────────────────────────────────────────────────────────

struct ARGuideSessionView: View {

    let anchor: Anchor
    let guide:  ARGuide
    let steps:  [GuideStep]   // sorted by sequenceNumber, pre-fetched by GuideListView

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    // ── AR session ────────────────────────────────────────────────────────────
    @StateObject private var arManager = ARSessionManager()

    // ── State machine ─────────────────────────────────────────────────────────
    private enum Phase: Equatable {
        case loading
        case relocalizing
        case navigating(index: Int)
        case submitted
    }

    @State private var phase:     Phase  = .loading
    @State private var loadError: String? = nil

    // ── In-session step state ─────────────────────────────────────────────────
    @State private var progresses:   [GuideStepProgress] = []
    @State private var sessionStart  = Date()

    // ── 3D scene ──────────────────────────────────────────────────────────────
    @State private var pinNodes:  [String: SCNNode] = [:]
    @State private var arrowNode: SCNNode? = nil

    // ── 3D floating panels (Phase 3) ──────────────────────────────────────────
    /// Container node per step — added to scene ROOT (not pin child) so it
    /// doesn't inherit the pin's pulsing opacity animation.
    @State private var panelContainers: [String: SCNNode] = [:]
    /// true = minimized pill shown, false = maximized card shown (default).
    @State private var panelMinimized:  [String: Bool]    = [:]

    // ── Navigation telemetry (10 Hz) ──────────────────────────────────────────
    @State private var distanceM:        Float?   = nil
    @State private var targetScreenPos:  CGPoint? = nil
    @State private var targetIsOnScreen: Bool     = false
    /// True when Operator is within arrivedM of the step — shows full content panel.
    @State private var showContentPanel: Bool     = false

    // ── Re-localization photo ──────────────────────────────────────────────────
    @State private var referencePhoto:          UIImage? = nil
    @State private var userConfirmedRelocalize: Bool     = false
    @State private var showRelocalizingTimeout: Bool     = false
    @State private var ghostOpacity:            Double   = 0.38

    // ── Step reference photo cache ────────────────────────────────────────────
    @State private var stepImages: [String: UIImage] = [:]

    // ── TTS ───────────────────────────────────────────────────────────────────
    @State private var synthesizer = AVSpeechSynthesizer()
    @State private var isSpeaking  = false

    // ── Sign-off ──────────────────────────────────────────────────────────────
    @State private var showSignOff = false

    // ── FTUE / Help ───────────────────────────────────────────────────────────
    @State private var showOnboarding = false

    // ── Panel visibility toggle ───────────────────────────────────────────────
    /// When false (default), only the current step's panel is shown.
    /// When true, all steps' panels are visible simultaneously.
    @State private var showAllPanels: Bool = false

    // ── Live session (AI readiness Step 1) ───────────────────────────────────
    /// Set once `openLiveGuideSession` succeeds; nil if the request fails or is skipped.
    @State private var liveSessionId: String? = nil

    // ── AI hints (Step 3: AI Dynamic Instructions) ────────────────────────────
    /// The hint currently shown to the Operator; nil = assist hidden.
    /// FIX: the old banner lived INSIDE GuideContentPanel, which is hidden by
    /// default (showContentPanel starts false) — hints were fetched and logged
    /// but rendered inside a panel that wasn't on screen. Assist is now its
    /// own overlay layer, visible in every panel state.
    @State private var activeHint: AIHint? = nil
    /// Whether the assist card is expanded (true) or collapsed to the ✨ chip.
    /// Stall-triggered hints auto-expand — the operator is stuck; retry hints
    /// stay collapsed so they never pile onto someone mid-recovery.
    @State private var assistExpanded = false
    /// Every hint received this session — the assist tray makes dismissed
    /// hints recoverable instead of gone.
    @State private var hintHistory: [AIHint] = []
    @State private var showAssistTray = false
    /// Guardrail: after a dismissal, no new hint for the same step for 30 s.
    @State private var lastHintDismissedAt: Date? = nil
    @State private var lastDismissedStepId: String? = nil
    /// Timer that polls /live/:id/hints every 5 s while a live session is open.
    @State private var hintPollTimer: Timer? = nil

    // ── Stall detection (idle helper trigger) ────────────────────────────────
    /// Timer that checks every 10 s whether the Operator has dwelled on the
    /// current step past `stallThresholdSeconds` without completing it.
    @State private var stallCheckTimer: Timer? = nil
    /// When the Operator landed on the current step, for stall purposes only.
    /// Deliberately separate from `GuideStepProgress.enteredAt`: that field is
    /// write-once so sign-off can report true time-on-step, whereas this resets
    /// on every visit so re-entering a step gives a fresh 90 s grace period.
    @State private var stallClockStart: Date? = nil
    /// Step IDs that have already emitted a stall event during their current
    /// visit. Cleared for a step when the Operator navigates back to it.
    @State private var stallFiredSteps: Set<String> = []

    // ── Evidence capture (Phase 3) ────────────────────────────────────────────
    @State private var showEvidencePicker      = false
    @State private var evidencePickerStepIndex: Int? = nil

    // ── 3D ghost model overlay (Phase 3D) ────────────────────────────────────
    /// Metadata for all models in this anchor's library — fetched once on load.
    @State private var anchorModels:   [Model3D]    = []
    /// Local disk cache: modelId → temp .glb file URL (populated in background on load).
    @State private var glbCache:       [String: URL] = [:]
    /// Currently visible ghost SCNNode (at most one; removed when step changes).
    @State private var ghostModelNode:  SCNNode?      = nil
    /// Step waiting for its model to finish downloading before the ghost can be shown.
    /// Set by attachGhostOverlay when glbCache doesn't have the model yet; cleared
    /// once the ghost is successfully built and added to the scene.
    @State private var pendingGhostStep: GuideStep?  = nil

    // ── Ticker ────────────────────────────────────────────────────────────────
    private let navTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── Thresholds ────────────────────────────────────────────────────────────
    private let arrivedM:     Float = 0.5
    private let approachingM: Float = 1.0
    /// Seconds on a single step without completing it before we ask the server
    /// for a hint. Generous on purpose: hands-on AR work involves no taps, so a
    /// short threshold would interrupt Operators who are simply busy.
    private let stallThresholdSeconds: TimeInterval = 90
    /// How often the stall condition is evaluated. Wall-clock comparison against
    /// `stallClockStart`, so a coarse interval stays accurate across backgrounding.
    private let stallCheckInterval:    TimeInterval = 10

    // ── Computed ──────────────────────────────────────────────────────────────

    var sortedSteps: [GuideStep] {
        steps.sorted { $0.sequenceNumber < $1.sequenceNumber }
    }

    var allRequiredDone: Bool {
        guard progresses.count == sortedSteps.count else { return false }
        return zip(sortedSteps, progresses).allSatisfy { step, prog in
            !step.completionRequired || prog.isCompleted
        }
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // AR camera — always present so the feed stays live
            ARContainerView(arManager: arManager, onTap: handleARTap)
                .ignoresSafeArea()
                .onAppear {
                    appState.activeARSession?.pause()
                    appState.activeARSession = nil
                    arManager.startSession()
                    arManager.disableQRScanning()
                }
                .onDisappear {
                    stopSpeaking()
                    removeArrow()
                    stopHintPolling()
                    stopStallDetection()
                    // Remove scene-root panel containers (they are NOT pin children,
                    // so they must be cleaned up manually on view teardown)
                    for (_, container) in panelContainers {
                        container.removeFromParentNode()
                    }
                    panelContainers.removeAll()
                    // Remove 3D ghost model overlay
                    removeGhostOverlay()
                    arManager.pauseSession()
                }
                .onChange(of: arManager.isRelocalizing) { stillRelocalizing in
                    guard !stillRelocalizing, phase == .relocalizing else { return }
                    transitionToNavigating()
                }

            // Ghost reference-photo overlay (re-localization phase only)
            if case .relocalizing = phase, let img = referencePhoto {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .opacity(ghostOpacity)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
                    .animation(.easeOut(duration: 0.6), value: phase)
            }

            // Phase-specific UI
            Group {
                switch phase {
                case .loading:
                    loadingOverlay
                case .relocalizing:
                    relocalizingOverlay
                case .navigating(let index):
                    navigationUI(index: index)
                case .submitted:
                    submittedOverlay
                }
            }

            // Top bar — always visible
            topBar
        }
        .onReceive(navTicker) { _ in
            if case .navigating(let index) = phase {
                updateNavTelemetry(index: index)
            }
        }
        .onAppear {
            progresses   = sortedSteps.map { GuideStepProgress(step: $0) }
            sessionStart = Date()
            if !progresses.isEmpty { progresses[0].enter() }
            if let first = sortedSteps.first { Task { await loadStepImage(for: first) } }
            // FTUE: auto-show guide session onboarding on first run
            if settings.ftueEnabled && !settings.ftueGuideOperatorSeen {
                settings.ftueGuideOperatorSeen = true
                showOnboarding = true
            }
        }
        .task { await loadData() }
        .sheet(isPresented: $showAssistTray) {
            NavigationStack {
                List {
                    ForEach(hintHistory.reversed()) { h in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(assistReason(h))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(h.text).font(.subheadline)
                        }
                        .padding(.vertical, 2)
                    }
                }
                .navigationTitle("Hints this session")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { showAssistTray = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showSignOff) {
            SessionSignOffView(
                guide:         guide,
                anchor:        anchor,
                progresses:    progresses,
                startedAt:     sessionStart,
                liveSessionId: liveSessionId
            ) {
                showSignOff = false
                phase       = .submitted
                stopSpeaking()
                arManager.pauseSession()
            }
            .environmentObject(settings)
        }
        // Evidence camera picker (Phase 3)
        .sheet(isPresented: $showEvidencePicker) {
            if let idx = evidencePickerStepIndex {
                CameraPickerView(sourceType: .camera) { img in
                    progresses[idx].evidencePhoto = img
                    let stepId = sortedSteps[idx].id
                    refreshPanelTextures(stepId: stepId)
                    showEvidencePicker = false
                }
            }
        }
        // FTUE / Help sheet
        .sheet(isPresented: $showOnboarding) {
            OnboardingSheet(context: .guideOperator)
                .environmentObject(settings)
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                stopSpeaking()
                removeArrow()
                arManager.pauseSession()
                dismiss()
            } label: {
                Label("Exit", systemImage: "xmark")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }

            Spacer()

            Text(guide.name)
                .font(.headline).foregroundStyle(.white)
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: 200)

            Spacer()

            HStack(spacing: 10) {
                if case .navigating(let index) = phase {
                    Text("\(index + 1) / \(sortedSteps.count)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.7))

                    // Panel visibility toggle: eye = show all, eye.slash = current only
                    Button {
                        showAllPanels.toggle()
                        updatePanelVisibility()
                    } label: {
                        Image(systemName: showAllPanels ? "eye.fill" : "eye.slash")
                            .font(.system(size: 16))
                            .foregroundStyle(showAllPanels
                                             ? Color.white
                                             : Color.white.opacity(0.45))
                    }
                    .buttonStyle(.plain)
                }

                // Help button — always visible; re-shows the guide session onboarding
                Button { showOnboarding = true } label: {
                    Image(systemName: "questionmark.circle")
                        .font(.system(size: 16))
                        .foregroundStyle(.white.opacity(0.65))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Loading overlay ───────────────────────────────────────────────────────

    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.7).ignoresSafeArea()
            if let err = loadError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 44)).foregroundStyle(.orange)
                    Text("Could not start guide").font(.headline).foregroundStyle(.white)
                    Text(err).font(.caption).foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center).padding(.horizontal, 32)
                    Button("Exit") { dismiss() }
                        .buttonStyle(.bordered).tint(.white)
                }
            } else {
                VStack(spacing: 16) {
                    ProgressView().scaleEffect(1.4).tint(.white)
                    Text("Loading guide…").font(.headline).foregroundStyle(.white)
                    Text("Downloading world map and reference photo")
                        .font(.caption).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    // ── Re-localizing overlay ─────────────────────────────────────────────────

    private var relocalizingOverlay: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 16) {
                VStack(spacing: 4) {
                    Text("Go to the Starting Point")
                        .font(.title3.bold()).foregroundStyle(.white)
                    Text(referencePhoto != nil
                         ? "Align the live view with the ghost image, then tap \"I'm Here\"."
                         : "Stand where the guide was set up, then tap \"I'm Here\".")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.8).tint(.indigo)
                    Text("ARKit is matching the space…")
                        .font(.caption).foregroundStyle(.white.opacity(0.55))
                }

                if showRelocalizingTimeout {
                    Text("Still searching. Try walking closer to where the Author placed the first step.")
                        .font(.caption)
                        .foregroundStyle(.orange.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .transition(.opacity)
                }

                if referencePhoto != nil {
                    HStack(spacing: 10) {
                        Image(systemName: "photo.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                        Slider(value: $ghostOpacity, in: 0.15...0.65)
                            .tint(.indigo)
                        Image(systemName: "eye.fill")
                            .font(.caption).foregroundStyle(.white.opacity(0.4))
                    }
                }

                Button {
                    userConfirmedRelocalize = true
                    transitionToNavigating()
                } label: {
                    Label("I'm Here", systemImage: "mappin.and.ellipse")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.indigo)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 13))
                }
            }
            .padding(20)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal, 16)
            .padding(.bottom, 48)
        }
        .animation(.easeInOut(duration: 0.3), value: showRelocalizingTimeout)
    }

    // ── Navigation UI ─────────────────────────────────────────────────────────

    @ViewBuilder
    private func navigationUI(index: Int) -> some View {
        if index < sortedSteps.count {
            let step     = sortedSteps[index]
            let progress = index < progresses.count ? progresses[index] : nil

            ZStack {
                // Screen-edge chevron (when placed pin is off-screen)
                if !targetIsOnScreen, let rawPos = targetScreenPos, step.worldPosition != nil {
                    GeometryReader { geo in
                        let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
                        let dx     = rawPos.x - center.x
                        let dy     = rawPos.y - center.y
                        let angle  = Angle(radians: atan2(Double(dy), Double(dx)))
                        let edge   = clampToEdge(rawPos, size: geo.size, padding: 52)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(.indigo)
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                            .rotationEffect(angle)
                            .position(edge)
                    }
                    .ignoresSafeArea()
                }

                // Bottom 2D panel: full content when arrived, mini nav card en-route
                VStack {
                    Spacer()
                    // ── Assist layer — its own overlay, independent of panel state ──
                    if let hint = activeHint {
                        if assistExpanded {
                            assistCard(hint: hint, step: step)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        } else {
                            assistChip(hint: hint)
                                .transition(.opacity)
                        }
                    }
                    if showContentPanel || step.worldPosition == nil {
                        GuideContentPanel(
                            step:            step,
                            progress:        progress,
                            stepNumber:      index + 1,
                            totalSteps:      sortedSteps.count,
                            referenceImage:  stepImages[step.id],
                            evidenceImage:   index < progresses.count ? progresses[index].evidencePhoto : nil,
                            isSpeaking:      isSpeaking,
                            canGoBack:       index > 0,
                            canGoNext:       index < sortedSteps.count - 1 && canAdvanceFrom(index: index),
                            canSkip:         !step.completionRequired && !(progress?.isCompleted ?? false),
                            allRequiredDone: allRequiredDone,
                            distanceM:       distanceM,
                            onPrev:          { navigateTo(index: index - 1) },
                            onNext:          { navigateTo(index: index + 1) },
                            onSkip:          { navigateTo(index: index + 1) },
                            onComplete:      { markComplete(at: index); autoAdvance(from: index) },
                            onSpeak:         { toggleSpeech(for: step) },
                            onSignOff:       { showSignOff = true },
                            onEvidence:      { openEvidencePicker(for: index) },
                            onMinimize:      { showContentPanel = false }
                        )
                    } else {
                        miniNavCard(step: step, index: index)
                    }
                }
            }
        }
    }

    private func clampToEdge(_ point: CGPoint, size: CGSize, padding: CGFloat) -> CGPoint {
        let cx = size.width  / 2
        let cy = size.height / 2
        let dx = point.x - cx
        let dy = point.y - cy
        guard abs(dx) > 0.001 || abs(dy) > 0.001 else { return CGPoint(x: cx, y: padding) }
        let sx = (cx - padding) / max(abs(dx), 0.001)
        let sy = (cy - padding) / max(abs(dy), 0.001)
        let s  = min(sx, sy)
        return CGPoint(x: cx + dx * s, y: cy + dy * s)
    }

    /// Compact card shown by default. Tap anywhere to expand to the full content panel.
    private func miniNavCard(step: GuideStep, index: Int) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Color.indigo.opacity(0.2)).frame(width: 40, height: 40)
                    Text("\(step.sequenceNumber)")
                        .font(.headline.bold()).foregroundStyle(.indigo)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Step \(step.sequenceNumber) of \(sortedSteps.count)")
                        .font(.caption.bold()).foregroundStyle(.white.opacity(0.55))
                    Text(step.displayTitle)
                        .font(.subheadline.bold()).foregroundStyle(.white)
                        .lineLimit(1)
                    if step.title != nil {
                        Text(step.text)
                            .font(.caption).foregroundStyle(.white.opacity(0.65))
                            .lineLimit(1)
                    }
                }
                Spacer()
                VStack(spacing: 4) {
                    distancePill
                    Image(systemName: "chevron.up")
                        .font(.caption2.bold())
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.horizontal, 16)

            if !step.completionRequired {
                Button { navigateTo(index: index + 1) } label: {
                    Text("Skip")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.38))
                }
                .padding(.bottom, 2)
            }
        }
        .padding(.top, 14)
        .padding(.bottom, 34)
        .background(.ultraThinMaterial)
        .contentShape(Rectangle())
        .onTapGesture { showContentPanel = true }
    }

    @ViewBuilder
    private var distancePill: some View {
        if let d = distanceM {
            let arrived     = d <= arrivedM
            let approaching = d <= approachingM
            let color: Color = arrived ? .green : (approaching ? .orange : .white)
            VStack(alignment: .trailing, spacing: 1) {
                Text(String(format: "%.1f m", d))
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(color)
                if arrived {
                    Text("arrived").font(.system(size: 9, weight: .medium)).foregroundStyle(.green)
                } else if approaching {
                    Text("close").font(.system(size: 9, weight: .medium)).foregroundStyle(.orange)
                }
            }
        }
    }

    // ── Submitted overlay ─────────────────────────────────────────────────────

    private var submittedOverlay: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 60)).foregroundStyle(.green)
                Text("Guide Complete")
                    .font(.title2.bold()).foregroundStyle(.white)
                Text("\(sortedSteps.count) step\(sortedSteps.count == 1 ? "" : "s") signed off")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent).tint(.green)
            }
        }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private func loadData() async {
        let client = SIBClient(settings: settings)
        do {
            async let mapFetch   = client.fetchGuideWorldMap(guideId: guide.id)
            async let photoFetch = client.fetchGuideWorldMapPhoto(guideId: guide.id)
            let (mapData, photoData) = try await (mapFetch, photoFetch)

            if let pd = photoData { referencePhoto = UIImage(data: pd) }

            // Open live session for real-time telemetry (fire-and-forget — AR session
            // continues normally if this fails).
            let opName = settings.authorName.isEmpty ? "Operator" : settings.authorName
            if let lsId = try? await client.openLiveGuideSession(
                guideId:      guide.id,
                anchorId:     anchor.id,
                guideName:    guide.name,
                anchorName:   anchor.assetId,
                operatorName: opName
            ) {
                liveSessionId = lsId
                // Push step:entered for step 0 (already entered in onAppear before loadData ran)
                if let first = sortedSteps.first {
                    Task {
                        await client.pushGuideSessionEvent(
                            liveSessionId: lsId,
                            event: PushGuideSessionEventRequest(
                                type: .stepEntered, stepId: first.id, stepIndex: 0, durationSeconds: nil
                            )
                        )
                    }
                }
                // Start AI hint poll — every 5 s, drain server hint queue and show
                // the first pending hint as a banner in GuideContentPanel.
                startHintPolling(liveSessionId: lsId)
                // Start the dwell watchdog. Step 0's clock starts now rather than
                // in navigateTo, since the Operator is already standing on it.
                stallClockStart = Date()
                startStallDetection(liveSessionId: lsId)
            }

            // Kick off background GLB prefetch for all steps that have a 3D model
            // (non-blocking — ghost overlays attach as downloads complete)
            Task { await prefetchModels() }

            if let data = mapData {
                arManager.startSessionWithWorldMap(data)
                arManager.disableQRScanning()
                phase = .relocalizing
                showRelocalizingTimeout = false
                Task {
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    guard case .relocalizing = phase else { return }
                    showRelocalizingTimeout = true
                }
            } else {
                transitionToNavigating()
            }
        } catch {
            loadError = friendlyMessage(for: error)
        }
    }

    // ── Transition to navigating ──────────────────────────────────────────────

    private func transitionToNavigating() {
        placePins()
        placeArrow()
        if sortedSteps.isEmpty {
            phase = .submitted
        } else {
            phase = .navigating(index: 0)
            highlightPin(index: 0)
            if sortedSteps[0].worldPosition == nil { showContentPanel = true }
            // loadStepImage (called from onAppear) may have finished before placePins()
            // created the panel containers, making its refreshPanelTextures() a no-op.
            // Flush any images already in the cache into the newly-created panels now.
            for step in sortedSteps where stepImages[step.id] != nil {
                refreshPanelTextures(stepId: step.id)
            }
            // Apply initial panel visibility: show only step 0, hide the rest.
            updatePanelVisibility(currentIndex: 0)
            // Attach 3D ghost model overlay for the first step (if available)
            attachGhostOverlay(for: sortedSteps[0])
        }
    }

    // ── Place 3D pins + floating panels ──────────────────────────────────────

    private func placePins() {
        for (i, step) in sortedSteps.enumerated() {
            guard pinNodes[step.id] == nil,
                  let pos = step.worldPosition else { continue }
            let node = makeGuidePin(number: step.sequenceNumber, isActive: i == 0)
            node.simdPosition = pos
            arManager.sceneView.scene.rootNode.addChildNode(node)
            pinNodes[step.id] = node
            // Attach the 3D floating panel above this pin
            attachFloatingPanel(to: node, for: step, index: i)
        }
    }

    // ── Floating panel construction (Phase 3) ─────────────────────────────────

    /// Attaches a world-anchored floating panel directly to the scene root — NOT as a
    /// child of the pin node.  Keeping it at root-level prevents it from inheriting the
    /// pin's pulsing opacity animation (which was the primary blink cause).
    /// The panel floats 0.55 m above the pin and is connected by a dotted dash line.
    /// Materials are fully opaque so freeAxes = .all works without alpha-sort flicker.
    private func attachFloatingPanel(to pinNode: SCNNode, for step: GuideStep, index: Int) {
        let container = SCNNode()
        container.name = "panel_container_\(step.id)"

        // Position: 0.55 m above the pin in world space (panel bottom at ~0.34 m)
        let pp = pinNode.simdPosition
        container.simdPosition = simd_float3(pp.x, pp.y + 0.55, pp.z)

        // Full billboard — panel always directly faces the camera on every axis,
        // which maximises readability. Opaque materials avoid alpha-sort flicker.
        let billboard = SCNBillboardConstraint()
        billboard.freeAxes = .all
        container.constraints = [billboard]

        // Default: minimized pill visible
        panelMinimized[step.id] = true

        // ── Opaque material helper ────────────────────────────────────────────
        func opaqueMat(image: UIImage) -> SCNMaterial {
            let m = SCNMaterial()
            m.diffuse.contents = image
            m.lightingModel    = .constant
            m.isDoubleSided    = true
            // blendMode stays at default (.none = opaque) — no alpha blending,
            // no per-frame depth-sort, no flicker.
            return m
        }

        // ── Minimized pill (0.30 × 0.055 m → texture 512 × 94 pt) ───────────
        let pillPlane = SCNPlane(width: 0.30, height: 0.055)
        pillPlane.firstMaterial = opaqueMat(image: renderPillTexture(step: step, index: index))
        let pillNode = SCNNode(geometry: pillPlane)
        pillNode.name     = "pill_\(step.id)"
        pillNode.isHidden = false
        container.addChildNode(pillNode)

        // ── Maximized card (0.30 × 0.40 m → texture 512 × 683 pt) ───────────
        let cardPlane = SCNPlane(width: 0.30, height: 0.40)
        cardPlane.firstMaterial = opaqueMat(image: renderCardTexture(step: step, index: index, referenceImage: nil))
        let cardNode = SCNNode(geometry: cardPlane)
        cardNode.name     = "card_\(step.id)"
        cardNode.isHidden = true
        container.addChildNode(cardNode)

        // ── Invisible hit-test buttons (card local: x ∈ [−0.15,0.15], y ∈ [−0.20,0.20])
        // Positions are derived from the drawn texture coordinates using:
        //   x_local = (x_tex / 512) * 0.30 − 0.15
        //   y_local = 0.20 − (y_tex / 580) * 0.40
        //
        // Minimize "–" drawn at approx tex (494, 38):
        cardNode.addChildNode(makeHitButton(w: 0.06, h: 0.05, x:  0.12,  y:  0.183, name: "btn_min_\(step.id)"))
        // Audio 🔊 drawn at tex (14, 486), label at (6,526,w52) → zone centre ≈ (32, 513):
        //   x_local = (32/512)*0.30−0.15 = −0.131  y_local = 0.20−(513/580)*0.40 = −0.154
        cardNode.addChildNode(makeHitButton(w: 0.07, h: 0.07, x: -0.131, y: -0.154, name: "btn_audio_\(step.id)"))
        // Camera 📷 moved to tex (160, 486), label at (152,526,w52) → zone centre ≈ (178, 513):
        //   x_local = (178/512)*0.30−0.15 = −0.046  y_local = −0.154
        //   8.5 cm gap between audio and camera centres → safe for gloved hands
        cardNode.addChildNode(makeHitButton(w: 0.07, h: 0.07, x: -0.046, y: -0.154, name: "btn_camera_\(step.id)"))
        // Primary button drawn at tex CGRect(354,492,144,48) → centre (426, 516):
        //   x_local = (426/512)*0.30−0.15 = 0.100   y_local = 0.20−(516/580)*0.40 = −0.156
        cardNode.addChildNode(makeHitButton(w: 0.09, h: 0.055, x:  0.100, y: -0.156, name: "btn_complete_\(step.id)"))
        pillNode.addChildNode(makeHitButton(w: 0.30, h: 0.055, x: 0, y: 0, name: "btn_expand_\(step.id)"))

        // ── Dotted connector: vertical dashes from pin top to panel bottom ────
        // Pin-local y=0.06 (above torus) → y=0.34 (panel bottom in pin-local space)
        // Panel bottom in world = pp.y+0.55−0.20 = pp.y+0.35 → local y≈0.35
        let dotCount = 7
        for i in 0..<dotCount {
            let t = Float(i) / Float(dotCount - 1)
            let y = 0.06 + t * 0.28          // 0.06 m to 0.34 m above pin
            let dash = SCNCylinder(radius: 0.004, height: 0.018)
            let dMat = SCNMaterial()
            dMat.diffuse.contents = UIColor.white.withAlphaComponent(0.45)
            dMat.lightingModel    = .constant
            dash.firstMaterial    = dMat
            let dNode = SCNNode(geometry: dash)
            dNode.position = SCNVector3(0, y, 0)
            pinNode.addChildNode(dNode)
        }

        // ── Add panel to SCENE ROOT (not pin child) — avoids pulse inheritance ─
        arManager.sceneView.scene.rootNode.addChildNode(container)
        panelContainers[step.id] = container
    }

    /// Creates a nearly-invisible (but hit-testable) flat button node.
    private func makeHitButton(w: CGFloat, h: CGFloat, x: Float, y: Float, name: String) -> SCNNode {
        let plane = SCNPlane(width: w, height: h)
        let mat   = SCNMaterial()
        mat.diffuse.contents  = UIColor.white.withAlphaComponent(0.01)
        mat.lightingModel     = .constant
        mat.isDoubleSided     = true
        plane.firstMaterial   = mat
        let node = SCNNode(geometry: plane)
        node.name     = name
        node.position = SCNVector3(x, y, 0.001)
        return node
    }

    // ── Panel hit-test tap handler ────────────────────────────────────────────

    private func handleARTap(at point: CGPoint) {
        // Only process taps during navigation
        guard case .navigating(let currentIndex) = phase else { return }

        // Use .all so every node at the tap point is returned — alpha-blended
        // planes don't write depth reliably, making .closest pick the wrong node.
        let hits = arManager.sceneView.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue,
        ])

        // Walk up hit node hierarchy to find a named button or pill/card
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let n = candidate {
                guard let name = n.name else { candidate = n.parent; continue }

                if name.hasPrefix("btn_min_") {
                    let stepId = String(name.dropFirst("btn_min_".count))
                    togglePanel(stepId: stepId, minimize: true)
                    return
                }
                if name.hasPrefix("btn_expand_") || name.hasPrefix("pill_") {
                    let stepId = name.hasPrefix("pill_")
                        ? String(name.dropFirst("pill_".count))
                        : String(name.dropFirst("btn_expand_".count))
                    togglePanel(stepId: stepId, minimize: false)
                    return
                }
                if name.hasPrefix("btn_audio_") {
                    let stepId = String(name.dropFirst("btn_audio_".count))
                    if let step = sortedSteps.first(where: { $0.id == stepId }) {
                        toggleSpeech(for: step)
                    }
                    return
                }
                if name.hasPrefix("btn_camera_") {
                    let stepId = String(name.dropFirst("btn_camera_".count))
                    if let idx = sortedSteps.firstIndex(where: { $0.id == stepId }) {
                        openEvidencePicker(for: idx)
                    }
                    return
                }
                if name.hasPrefix("btn_complete_") {
                    let stepId = String(name.dropFirst("btn_complete_".count))
                    if let idx = sortedSteps.firstIndex(where: { $0.id == stepId }) {
                        // If this is the last step and all required are done → sign-off
                        if idx == sortedSteps.count - 1 && allRequiredDone {
                            showSignOff = true
                        } else {
                            markComplete(at: idx)
                            autoAdvance(from: idx)
                        }
                        refreshPanelTextures(stepId: stepId)
                    }
                    return
                }
                candidate = n.parent
            }
        }
    }

    /// Toggle a panel between minimized pill and maximized card.
    /// No animation — instant switch to avoid flicker against AR background.
    private func togglePanel(stepId: String, minimize: Bool) {
        panelMinimized[stepId] = minimize
        guard let container = panelContainers[stepId] else { return }
        let pillNode = container.childNode(withName: "pill_\(stepId)", recursively: true)
        let cardNode = container.childNode(withName: "card_\(stepId)", recursively: true)
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0
        pillNode?.isHidden = !minimize
        cardNode?.isHidden = minimize
        SCNTransaction.commit()
    }

    /// Re-renders and applies the current card/pill textures for a step.
    /// Called after: step completion, evidence capture, or step image load.
    private func refreshPanelTextures(stepId: String) {
        guard let container = panelContainers[stepId],
              let step      = sortedSteps.first(where: { $0.id == stepId }),
              let index     = sortedSteps.firstIndex(where: { $0.id == stepId }) else { return }

        let isMinimized  = panelMinimized[stepId] ?? false
        let refImage     = stepImages[stepId]
        let progIdx      = index < progresses.count ? index : nil
        let evidenceImg  = progIdx.map { progresses[$0].evidencePhoto } ?? nil

        // Re-render pill texture
        let pillNode = container.childNode(withName: "pill_\(stepId)", recursively: true)
        if let pillGeo = pillNode?.geometry as? SCNPlane {
            pillGeo.firstMaterial?.diffuse.contents = renderPillTexture(step: step, index: index)
        }
        _ = isMinimized  // suppress unused warning (visibility already set in togglePanel)

        // Re-render card texture
        let cardNode = container.childNode(withName: "card_\(stepId)", recursively: true)
        if let cardGeo = cardNode?.geometry as? SCNPlane {
            cardGeo.firstMaterial?.diffuse.contents = renderCardTexture(
                step: step, index: index, referenceImage: refImage, evidenceImage: evidenceImg)
        }
    }

    // ── Panel texture rendering ───────────────────────────────────────────────
    // Both textures are rendered via UIKit drawing (UIGraphicsImageRenderer) and
    // applied as SCNMaterial.diffuse.contents.  All drawing is in pixel space;
    // the SCNPlane's physical size controls real-world scale.

    /// Minimized pill (512 × 94 pt — matches SCNPlane ratio 0.30 m × 0.055 m).
    /// Fully opaque background; audio icon + distance shown in right zone.
    private func renderPillTexture(step: GuideStep, index: Int) -> UIImage {
        let W: CGFloat = 512
        let H: CGFloat = 94
        let size = CGSize(width: W, height: H)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)

            // Opaque dark background — no alpha, avoids alpha-sort flicker with freeAxes=.all
            UIColor(white: 0.11, alpha: 1.0).setFill()
            UIBezierPath(roundedRect: r, cornerRadius: 18).fill()

            // ── Step badge ────────────────────────────────────────────────────
            let badgeR = CGRect(x: 12, y: 17, width: 60, height: 60)
            UIColor.systemIndigo.setFill()
            UIBezierPath(ovalIn: badgeR).fill()
            let numStr = "\(step.sequenceNumber)" as NSString
            let numAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.boldSystemFont(ofSize: 26),
                .foregroundColor: UIColor.white,
            ]
            let numSz = numStr.size(withAttributes: numAttrs)
            numStr.draw(at: CGPoint(x: badgeR.midX - numSz.width/2,
                                    y: badgeR.midY - numSz.height/2),
                        withAttributes: numAttrs)

            // ── Audio icon (pushed right so title has a centered zone) ────────
            // Audio at x=420, chevron at x=470 — leaves x=76..412 for the title.
            let audioColor: UIColor = isSpeaking ? .systemIndigo : UIColor.white.withAlphaComponent(0.80)
            let audioAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 28),
                .foregroundColor: audioColor,
            ]
            ("🔊" as NSString).draw(at: CGPoint(x: 420, y: H / 2 - 17), withAttributes: audioAttrs)

            // ── Title (center-aligned between badge and audio icon) ───────────
            // Zone: badge right ≈ 76, audio left ≈ 420 → available = 336pt, center ≈ 244
            // (distance label removed from pill; it is shown in the miniNavCard)
            let titlePara = NSMutableParagraphStyle()
            titlePara.alignment     = .center
            titlePara.lineBreakMode = .byTruncatingTail
            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: UIColor.white,
                .paragraphStyle:  titlePara,
            ]
            let titleR = CGRect(x: 76, y: 8, width: 336, height: H - 16)
            (step.displayTitle as NSString).draw(with: titleR,
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: titleAttrs,
                context: nil)

            // ── Expand chevron (far right) ────────────────────────────────────
            let chevAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 26, weight: .medium),
                .foregroundColor: UIColor.white.withAlphaComponent(0.50),
            ]
            ("›" as NSString).draw(at: CGPoint(x: 470, y: H / 2 - 18), withAttributes: chevAttrs)
        }
    }

    /// Maximized card (512 × 580 pt → 0.30 m × 0.40 m in world space)
    private func renderCardTexture(
        step:           GuideStep,
        index:          Int,
        referenceImage: UIImage?,
        evidenceImage:  UIImage? = nil
    ) -> UIImage {
        let W: CGFloat = 512
        let H: CGFloat = 580
        let size = CGSize(width: W, height: H)
        let progress = index < progresses.count ? progresses[index] : nil
        let isCompleted  = progress?.isCompleted ?? false
        let isLastStep   = index == sortedSteps.count - 1
        let hasEvidence  = evidenceImage != nil || (progress?.evidencePhoto) != nil

        return UIGraphicsImageRenderer(size: size).image { ctx in
            let r = CGRect(origin: .zero, size: size)

            // ── Background — fully opaque (avoids alpha-sort ordering artefacts) ──
            UIColor(white: 0.09, alpha: 1.0).setFill()
            UIBezierPath(roundedRect: r, cornerRadius: 24).fill()

            // ── Header row (0–76 pt) ──────────────────────────────────────────
            // Badge: 44×44 circle, vertically centred in 76-pt header zone (y=16)
            let badgeR = CGRect(x: 14, y: 16, width: 44, height: 44)
            (isCompleted ? UIColor.systemGreen : UIColor.systemIndigo).setFill()
            UIBezierPath(ovalIn: badgeR).fill()
            if isCompleted {
                let ckAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 22),
                    .foregroundColor: UIColor.white,
                ]
                let ckSz = ("✓" as NSString).size(withAttributes: ckAttrs)
                ("✓" as NSString).draw(at: CGPoint(x: badgeR.midX - ckSz.width/2,
                                                    y: badgeR.midY - ckSz.height/2),
                                        withAttributes: ckAttrs)
            } else {
                let numStr   = "\(step.sequenceNumber)" as NSString
                let numAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 20),
                    .foregroundColor: UIColor.white,
                ]
                let numSz = numStr.size(withAttributes: numAttrs)
                numStr.draw(at: CGPoint(x: badgeR.midX - numSz.width/2,
                                        y: badgeR.midY - numSz.height/2),
                            withAttributes: numAttrs)
            }

            // Right-of-badge zone: display title only.
            // The step number is already shown in the badge, so the "Step N of M"
            // caption is omitted here — it previously caused a cluttered "3 Step 3"
            // appearance when displayTitle defaulted to "Step N".
            let headerMid: CGFloat = 38    // visual centre of 76pt header zone
            let titleFont  = UIFont.systemFont(ofSize: 16, weight: .semibold)
            let titleH: CGFloat = titleFont.lineHeight    // ≈ 20pt
            let titleY     = headerMid - titleH / 2       // vertically centered
            let titleLinePara = NSMutableParagraphStyle()
            titleLinePara.lineBreakMode = .byTruncatingTail
            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font:            titleFont,
                .foregroundColor: UIColor.white,
                .paragraphStyle:  titleLinePara,
            ]
            // x=70 → clear of badge (right edge ≈58); width=W-120 leaves 50pt for the "–" button
            let titleR = CGRect(x: 70, y: titleY, width: W - 120, height: titleH + 4)
            (step.displayTitle as NSString).draw(with: titleR,
                options: .truncatesLastVisibleLine,
                attributes: titleAttrs,
                context: nil)

            // Minimize chevron (top-right, vertically centred in header)
            let minAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 16, weight: .medium),
                .foregroundColor: UIColor.white.withAlphaComponent(0.45),
            ]
            let minStr  = "–" as NSString
            let minSz   = minStr.size(withAttributes: minAttrs)
            minStr.draw(at: CGPoint(x: W - 14 - minSz.width, y: headerMid - minSz.height/2),
                        withAttributes: minAttrs)

            // ── Divider ───────────────────────────────────────────────────────
            UIColor.white.withAlphaComponent(0.12).setStroke()
            let divPath = UIBezierPath()
            divPath.move(to: CGPoint(x: 14, y: 76))
            divPath.addLine(to: CGPoint(x: W - 14, y: 76))
            divPath.lineWidth = 1
            divPath.stroke()

            // ── Description body (step.text) — centered, below header ─────────
            let descPara = NSMutableParagraphStyle()
            descPara.alignment = .center
            let descAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 13),
                .foregroundColor: UIColor.white.withAlphaComponent(0.88),
                .paragraphStyle:  descPara,
            ]
            let descR = CGRect(x: 14, y: 86, width: W - 28, height: 134)
            (step.text as NSString).draw(with: descR,
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: descAttrs,
                context: nil)

            // ── Reference image ───────────────────────────────────────────────
            var nextY: CGFloat = 232
            if let img = referenceImage {
                let imgH: CGFloat = 170
                let imgR = CGRect(x: 14, y: nextY, width: W - 28, height: imgH)
                UIColor.white.withAlphaComponent(0.06).setFill()
                UIBezierPath(roundedRect: imgR, cornerRadius: 8).fill()
                // Clip and draw image — aspect-fit (no stretching)
                ctx.cgContext.saveGState()
                UIBezierPath(roundedRect: imgR, cornerRadius: 8).addClip()
                let imgAspect = img.size.width / img.size.height
                let boxAspect = imgR.width / imgR.height
                let fittedRect: CGRect
                if imgAspect > boxAspect {
                    // Image is wider than box — fit width, letterbox top/bottom
                    let fH = imgR.width / imgAspect
                    fittedRect = CGRect(x: imgR.minX,
                                        y: imgR.minY + (imgR.height - fH) / 2,
                                        width: imgR.width, height: fH)
                } else {
                    // Image is taller than box — fit height, pillarbox left/right
                    let fW = imgR.height * imgAspect
                    fittedRect = CGRect(x: imgR.minX + (imgR.width - fW) / 2,
                                        y: imgR.minY, width: fW, height: imgR.height)
                }
                img.draw(in: fittedRect)
                ctx.cgContext.restoreGState()
                nextY = imgR.maxY + 12
            }

            // ── Divider before action bar ─────────────────────────────────────
            let div2Path = UIBezierPath()
            div2Path.move(to: CGPoint(x: 14, y: H - 108))
            div2Path.addLine(to: CGPoint(x: W - 14, y: H - 108))
            div2Path.lineWidth = 1
            UIColor.white.withAlphaComponent(0.12).setStroke()
            div2Path.stroke()

            // ── Action bar (bottom 108 pt) ────────────────────────────────────
            // Icons are 34 pt; labels beneath at 9 pt; total icon+label ≈ 52 pt.
            let barY: CGFloat = H - 100

            // Audio button — icon + label
            let audioColor: UIColor = isSpeaking ? .systemIndigo : UIColor.white.withAlphaComponent(0.75)
            let speakerAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 34),
                .foregroundColor: audioColor,
            ]
            ("🔊" as NSString).draw(at: CGPoint(x: 14, y: barY + 6), withAttributes: speakerAttrs)
            let audioLabelPara = NSMutableParagraphStyle(); audioLabelPara.alignment = .center
            let audioLabelAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 9, weight: .medium),
                .foregroundColor: audioColor,
                .paragraphStyle:  audioLabelPara,
            ]
            (isSpeaking ? "SPEAKING" : "AUDIO" as NSString)
                .draw(in: CGRect(x: 6, y: barY + 46, width: 52, height: 14),
                      withAttributes: audioLabelAttrs)

            // Evidence camera button — icon + label
            // Moved to x=160 (was 70) to create clear physical separation from the
            // audio button. The gap between icon centres is now ~8.5 cm in world
            // space, preventing accidental mis-taps by gloved technicians.
            let camColor: UIColor = hasEvidence ? .systemGreen : UIColor.white.withAlphaComponent(0.75)
            let camAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 34),
                .foregroundColor: camColor,
            ]
            ("📷" as NSString).draw(at: CGPoint(x: 160, y: barY + 6), withAttributes: camAttrs)
            let camLabelPara = NSMutableParagraphStyle(); camLabelPara.alignment = .center
            let camLabelAttrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.systemFont(ofSize: 9, weight: .medium),
                .foregroundColor: camColor,
                .paragraphStyle:  camLabelPara,
            ]
            (hasEvidence ? "CAPTURED" : "PHOTO" as NSString)
                .draw(in: CGRect(x: 152, y: barY + 46, width: 52, height: 14),
                      withAttributes: camLabelAttrs)

            // Distance label (between icons and primary button — moved right of camera)
            if let d = distanceM {
                let dColor: UIColor = d <= arrivedM ? .systemGreen : (d <= approachingM ? .systemOrange : .white)
                let dAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold),
                    .foregroundColor: dColor,
                ]
                (String(format: "%.1f m", d) as NSString).draw(at: CGPoint(x: 220, y: barY + 22), withAttributes: dAttrs)
            }

            // Primary action button (right side) — pill shape, properly centred text
            // Width 148pt to avoid the "stretched" look on a 512pt canvas.
            let btnX: CGFloat = W - 158
            let btnR  = CGRect(x: btnX, y: barY + 12, width: 144, height: 48)
            let btnCorner: CGFloat = 24   // full pill radius

            func drawCenteredLabel(_ text: String, attrs: [NSAttributedString.Key: Any], in rect: CGRect) {
                let str = text as NSString
                let sz  = str.size(withAttributes: attrs)
                str.draw(at: CGPoint(x: rect.midX - sz.width/2, y: rect.midY - sz.height/2),
                         withAttributes: attrs)
            }

            if isLastStep && allRequiredDone {
                UIColor.systemGreen.setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: btnCorner).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.white,
                ]
                drawCenteredLabel("✎  Sign Off", attrs: btnAttrs, in: btnR)
            } else if isCompleted {
                UIColor.systemGreen.withAlphaComponent(0.2).setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: btnCorner).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.systemGreen,
                ]
                drawCenteredLabel("✓  Completed", attrs: btnAttrs, in: btnR)
            } else if step.completionRequired {
                UIColor.systemIndigo.setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: btnCorner).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.boldSystemFont(ofSize: 14),
                    .foregroundColor: UIColor.white,
                ]
                drawCenteredLabel("✓  Mark Complete", attrs: btnAttrs, in: btnR)
            } else {
                UIColor.white.withAlphaComponent(0.12).setFill()
                UIBezierPath(roundedRect: btnR, cornerRadius: btnCorner).fill()
                let btnAttrs: [NSAttributedString.Key: Any] = [
                    .font:            UIFont.systemFont(ofSize: 14),
                    .foregroundColor: UIColor.white.withAlphaComponent(0.6),
                ]
                drawCenteredLabel("→  Next Step", attrs: btnAttrs, in: btnR)
            }
        }
    }

    // ── Pin highlight ─────────────────────────────────────────────────────────

    private func highlightPin(index: Int) {
        guard index < sortedSteps.count else { return }
        let activeId = sortedSteps[index].id
        for (id, node) in pinNodes {
            node.removeAllActions()
            if id == activeId {
                node.opacity = 1.0
                node.runAction(.repeatForever(.sequence([
                    .fadeOpacity(to: 0.35, duration: 0.5),
                    .fadeOpacity(to: 1.00, duration: 0.5),
                ])))
            } else {
                node.runAction(.fadeOpacity(to: 0.3, duration: 0.2))
            }
        }
    }

    // ── makeGuidePin (indigo sphere + torus + badge) ──────────────────────────

    private func makeGuidePin(number: Int, isActive: Bool) -> SCNNode {
        let root  = SCNNode()
        let color = UIColor.systemIndigo

        let sphere = SCNSphere(radius: 0.015)
        let sMat   = SCNMaterial()
        sMat.diffuse.contents  = color
        sMat.emission.contents = color.withAlphaComponent(0.6)
        sMat.lightingModel     = .constant
        sphere.firstMaterial   = sMat
        root.addChildNode(SCNNode(geometry: sphere))

        let torus        = SCNTorus()
        torus.ringRadius = 0.023
        torus.pipeRadius = 0.005
        let tMat         = SCNMaterial()
        tMat.diffuse.contents  = color
        tMat.emission.contents = color.withAlphaComponent(0.4)
        tMat.lightingModel     = .constant
        torus.firstMaterial    = tMat
        let ring               = SCNNode(geometry: torus)
        ring.eulerAngles       = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ring)

        let badge = makeNumberBadge(number: number)
        badge.position = SCNVector3(0, 0.055, 0)
        root.addChildNode(badge)

        return root
    }

    private func makeNumberBadge(number: Int) -> SCNNode {
        let size: CGFloat = 128
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let img = renderer.image { _ in
            let r = CGRect(origin: .zero, size: CGSize(width: size, height: size))
            UIColor.systemIndigo.withAlphaComponent(0.9).setFill()
            UIBezierPath(ovalIn: r).fill()
            UIColor.white.withAlphaComponent(0.3).setStroke()
            let border = UIBezierPath(ovalIn: r.insetBy(dx: 3, dy: 3))
            border.lineWidth = 4
            border.stroke()
            let attrs: [NSAttributedString.Key: Any] = [
                .font:            UIFont.boldSystemFont(ofSize: 64),
                .foregroundColor: UIColor.white,
            ]
            let str  = "\(number)" as NSString
            let sz   = str.size(withAttributes: attrs)
            str.draw(at: CGPoint(x: (size - sz.width) / 2, y: (size - sz.height) / 2),
                     withAttributes: attrs)
        }
        let plane = SCNPlane(width: 0.04, height: 0.04)
        plane.firstMaterial?.diffuse.contents    = img
        plane.firstMaterial?.lightingModel       = .constant
        plane.firstMaterial?.isDoubleSided       = true
        plane.firstMaterial?.blendMode           = .alpha
        let node = SCNNode(geometry: plane)
        node.constraints = [SCNBillboardConstraint()]
        return node
    }

    // ── 3D navigation arrow ───────────────────────────────────────────────────

    private func placeArrow() {
        guard arrowNode == nil else { return }
        let node = makeArrowNode()
        node.isHidden = true
        arManager.sceneView.scene.rootNode.addChildNode(node)
        arrowNode = node
    }

    private func removeArrow() {
        arrowNode?.removeFromParentNode()
        arrowNode = nil
    }

    private func makeArrowNode() -> SCNNode {
        let root = SCNNode()

        let coreMat = SCNMaterial()
        coreMat.diffuse.contents  = UIColor.systemIndigo
        coreMat.emission.contents = UIColor.systemIndigo.withAlphaComponent(0.85)
        coreMat.lightingModel     = .constant
        coreMat.transparency      = 0.70
        coreMat.isDoubleSided     = true

        let glowMat = SCNMaterial()
        glowMat.diffuse.contents  = UIColor.clear
        glowMat.emission.contents = UIColor(red: 0.35, green: 0.27, blue: 0.81, alpha: 1.0)
        glowMat.lightingModel     = .constant
        glowMat.transparency      = 0.18
        glowMat.isDoubleSided     = true

        let shaft = SCNCylinder(radius: 0.010, height: 0.12)
        shaft.firstMaterial = coreMat
        let shaftNode = SCNNode(geometry: shaft)
        shaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        shaftNode.position    = SCNVector3(0, 0, 0.04)
        root.addChildNode(shaftNode)

        let glowShaft = SCNCylinder(radius: 0.022, height: 0.12)
        glowShaft.firstMaterial = glowMat
        let glowShaftNode = SCNNode(geometry: glowShaft)
        glowShaftNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowShaftNode.position    = SCNVector3(0, 0, 0.04)
        root.addChildNode(glowShaftNode)

        let head = SCNCone(topRadius: 0, bottomRadius: 0.025, height: 0.06)
        head.firstMaterial = coreMat
        let headNode = SCNNode(geometry: head)
        headNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        headNode.position    = SCNVector3(0, 0, 0.13)
        root.addChildNode(headNode)

        let glowHead = SCNCone(topRadius: 0, bottomRadius: 0.042, height: 0.08)
        glowHead.firstMaterial = glowMat
        let glowHeadNode = SCNNode(geometry: glowHead)
        glowHeadNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        glowHeadNode.position    = SCNVector3(0, 0, 0.125)
        root.addChildNode(glowHeadNode)

        return root
    }

    // ── Navigation telemetry (10 Hz) ──────────────────────────────────────────

    private func updateNavTelemetry(index: Int) {
        guard index < sortedSteps.count,
              let frame = arManager.sceneView.session.currentFrame else { return }

        let step = sortedSteps[index]
        guard let targetW = step.worldPosition else {
            if !showContentPanel { showContentPanel = true }
            return
        }

        let camCol = frame.camera.transform.columns.3
        let camPos = simd_float3(camCol.x, camCol.y, camCol.z)
        let dist   = simd_length(targetW - camPos)
        distanceM  = dist

        // Do not auto-expand the 2D panel on arrival — user taps the mini card to open it

        let sv        = arManager.sceneView
        let projected = sv.projectPoint(SCNVector3(targetW.x, targetW.y, targetW.z))
        let pt        = CGPoint(x: CGFloat(projected.x), y: CGFloat(projected.y))
        targetScreenPos  = pt
        targetIsOnScreen = UIScreen.main.bounds.contains(pt) && projected.z < 1.0

        updateArrowNode(targetW: targetW, frame: frame)
    }

    private func updateArrowNode(targetW: simd_float3, frame: ARFrame) {
        guard let arrow = arrowNode else { return }

        let cam    = frame.camera.transform
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        let fwdX   = -cam.columns.2.x
        let fwdZ   = -cam.columns.2.z
        let fwdLen = sqrt(fwdX * fwdX + fwdZ * fwdZ)
        guard fwdLen > 0.001 else { return }

        let arrowPos = simd_float3(
            camPos.x + (fwdX / fwdLen) * 0.7,
            camPos.y - 0.25,
            camPos.z + (fwdZ / fwdLen) * 0.7
        )
        let dx   = targetW.x - arrowPos.x
        let dz   = targetW.z - arrowPos.z
        let dist = sqrt(dx * dx + dz * dz)

        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.08
        arrow.simdPosition = arrowPos
        if dist > 0.05 {
            arrow.simdEulerAngles = simd_float3(0, atan2(dx, dz), 0)
        }
        arrow.isHidden = (distanceM ?? Float.infinity) <= arrivedM
        SCNTransaction.commit()
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    private func canAdvanceFrom(index: Int) -> Bool {
        guard index < sortedSteps.count, index < progresses.count else { return false }
        let step = sortedSteps[index]
        if step.completionRequired { return progresses[index].isCompleted }
        return true
    }

    private func navigateTo(index: Int) {
        guard index >= 0, index < sortedSteps.count else { return }

        // Precondition gate: if this step requires another step to be completed first
        // and it isn't yet, redirect to that prerequisite instead.
        let candidate = sortedSteps[index]
        if let prereqId = candidate.precondition,
           let prereqIdx = sortedSteps.firstIndex(where: { $0.id == prereqId }),
           prereqIdx < progresses.count,
           !progresses[prereqIdx].isCompleted,
           prereqIdx != index {
            navigateTo(index: prereqIdx)
            return
        }

        stopSpeaking()
        distanceM        = nil
        targetScreenPos  = nil
        showContentPanel = false
        phase = .navigating(index: index)
        if progresses[index].enteredAt == nil { progresses[index].enter() }
        // Restart the stall clock for this visit and re-arm the step so a
        // revisit can produce a fresh hint.
        stallClockStart = Date()
        stallFiredSteps.remove(sortedSteps[index].id)
        highlightPin(index: index)
        if sortedSteps[index].worldPosition == nil { showContentPanel = true }
        let step = sortedSteps[index]
        if stepImages[step.id] == nil { Task { await loadStepImage(for: step) } }
        updatePanelVisibility(currentIndex: index)
        // Swap ghost overlay for this step
        attachGhostOverlay(for: step)
        // Push step:entered live event (fire-and-forget)
        if let lsId = liveSessionId {
            Task {
                await SIBClient(settings: settings).pushGuideSessionEvent(
                    liveSessionId: lsId,
                    event: PushGuideSessionEventRequest(
                        type: .stepEntered, stepId: step.id, stepIndex: index, durationSeconds: nil
                    )
                )
            }
        }
    }

    /// Shows only the current step's panel (default) or all panels (when showAllPanels = true).
    /// Panels for non-current steps are hidden to reduce visual clutter in the AR scene.
    private func updatePanelVisibility(currentIndex: Int? = nil) {
        guard case .navigating(let activeIndex) = phase else { return }
        let idx = currentIndex ?? activeIndex
        for (i, step) in sortedSteps.enumerated() {
            guard let container = panelContainers[step.id] else { continue }
            let shouldShow = showAllPanels || i == idx
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.2
            container.isHidden = !shouldShow
            SCNTransaction.commit()
        }
    }

    // ── Assist UI (contextual AI help) ────────────────────────────────────────
    // Chip-first, never blocking: a small ✨ capsule the operator can glance at
    // and ignore. One hint at a time; the card is one tap away (or auto-opens
    // on a stall). Everything lives ABOVE the content panel so it is visible
    // whether the panel is open, minimized, or the step is unplaced.

    private func assistDismiss(hint: AIHint) {
        lastHintDismissedAt = Date()
        lastDismissedStepId = hint.stepId
        withAnimation(.easeOut(duration: 0.2)) {
            activeHint = nil
            assistExpanded = false
        }
    }

    private func assistReason(_ hint: AIHint) -> String {
        switch hint.trigger {
        case "stall": return "This step's been open a while"
        case "retry": return "That step took a few tries"
        default:      return "A tip for this step"
        }
    }

    @ViewBuilder
    private func assistChip(hint: AIHint) -> some View {
        Button {
            withAnimation(.spring(duration: 0.25)) { assistExpanded = true }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                Text(assistReason(hint))
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(Color.yellow.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private func assistCard(hint: AIHint, step: GuideStep) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(.yellow)
                    .font(.system(size: 15, weight: .semibold))
                Text(assistReason(hint))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if hintHistory.count > 1 {
                    Button { showAssistTray = true } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                Button { assistDismiss(hint: hint) } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 19))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            Text(hint.text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if hint.action == .navigate, let targetId = hint.targetStepId {
                    Button {
                        if let idx = sortedSteps.firstIndex(where: { $0.id == targetId }) {
                            navigateTo(index: idx)
                        }
                        assistDismiss(hint: hint)
                    } label: {
                        Label("Recovery step", systemImage: "arrow.uturn.right")
                            .font(.footnote.bold())
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.orange, in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
                if step.ttsText?.isEmpty == false {
                    Button { toggleSpeech(for: step) } label: {
                        Label("Replay voice", systemImage: "speaker.wave.2")
                            .font(.footnote.bold())
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.indigo.opacity(0.85), in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Button("Got it") { assistDismiss(hint: hint) }
                    .font(.footnote.bold())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.yellow.opacity(0.45), lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .onTapGesture { } // swallow taps so the card never falls through to AR
    }

    private func markComplete(at index: Int) {
        guard index < progresses.count else { return }
        progresses[index].complete()
        // Dismiss any active hint that was about or pointing to this step —
        // it is now moot since the step has just been completed.
        if let hint = activeHint, index < sortedSteps.count {
            let completedId = sortedSteps[index].id
            if hint.targetStepId == completedId || hint.stepId == completedId {
                activeHint = nil
                assistExpanded = false
            }
        }
        // Push step:completed live event (fire-and-forget)
        if let lsId = liveSessionId, index < sortedSteps.count {
            let stepId   = sortedSteps[index].id
            let duration = progresses[index].durationSeconds
            Task {
                await SIBClient(settings: settings).pushGuideSessionEvent(
                    liveSessionId: lsId,
                    event: PushGuideSessionEventRequest(
                        type: .stepCompleted, stepId: stepId, stepIndex: index, durationSeconds: duration
                    )
                )
            }
        }
    }

    // ── AI hint polling (Step 3) ──────────────────────────────────────────────

    /// Returns true if the hint is no longer actionable because the step it
    /// references (either as context or as a navigation target) has already
    /// been completed by the Operator.
    private func isHintStale(_ hint: AIHint) -> Bool {
        // Navigate-action hint whose target step is already done
        if let targetId = hint.targetStepId,
           let idx = sortedSteps.firstIndex(where: { $0.id == targetId }),
           idx < progresses.count,
           progresses[idx].isCompleted {
            return true
        }
        // Context hint about a step that is already done
        if let stepId = hint.stepId,
           let idx = sortedSteps.firstIndex(where: { $0.id == stepId }),
           idx < progresses.count,
           progresses[idx].isCompleted {
            return true
        }
        return false
    }

    /// Start a repeating 5-second timer that drains the server's hint queue and
    /// shows the first pending hint as a banner in GuideContentPanel.
    /// Safe to call multiple times — invalidates any existing timer first.
    private func startHintPolling(liveSessionId: String) {
        hintPollTimer?.invalidate()
        hintPollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                let client = SIBClient(settings: settings)
                let hints = await client.fetchGuideHints(liveSessionId: liveSessionId)
                if let first = hints.first, activeHint == nil, !isHintStale(first) {
                    // Cooldown: a hint for the step the user JUST dismissed a
                    // hint on, within 30 s, is nagging — drop it.
                    if let at = lastHintDismissedAt, let dismissedStep = lastDismissedStepId,
                       first.stepId == dismissedStep, Date().timeIntervalSince(at) < 30 {
                        return
                    }
                    activeHint = first
                    hintHistory.append(first)
                    // Stall = stuck, open the card. Retry (or legacy nil) = quiet chip.
                    assistExpanded = (first.trigger == "stall")
                    UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                }
            }
        }
    }

    private func stopHintPolling() {
        hintPollTimer?.invalidate()
        hintPollTimer = nil
    }

    // ── Stall detection ───────────────────────────────────────────────────────

    /// Start the repeating stall check. One timer serves the whole session —
    /// it re-reads `phase` on each tick rather than being restarted per step.
    /// Safe to call multiple times.
    private func startStallDetection(liveSessionId: String) {
        stallCheckTimer?.invalidate()
        stallCheckTimer = Timer.scheduledTimer(withTimeInterval: stallCheckInterval, repeats: true) { _ in
            Task { @MainActor in
                evaluateStall(liveSessionId: liveSessionId)
            }
        }
    }

    private func stopStallDetection() {
        stallCheckTimer?.invalidate()
        stallCheckTimer = nil
    }

    /// Emit `step:stalled` once if the Operator has been on the current step
    /// past the threshold with no completion and nothing else competing for
    /// their attention.
    @MainActor
    private func evaluateStall(liveSessionId: String) {
        // Only meaningful while actively navigating a step.
        guard case .navigating(let idx) = phase,
              idx < sortedSteps.count,
              idx < progresses.count else { return }

        // Nothing to nudge about if the step is already done.
        guard !progresses[idx].isCompleted else { return }

        // Don't stack help on help, or interrupt a modal the Operator opened.
        guard activeHint == nil,
              !showSignOff,
              !showOnboarding,
              !showEvidencePicker else { return }

        // Dwell threshold not yet reached.
        guard let start = stallClockStart,
              Date().timeIntervalSince(start) >= stallThresholdSeconds else { return }

        // Once per visit — re-armed by navigateTo when the Operator returns.
        let stepId = sortedSteps[idx].id
        guard !stallFiredSteps.contains(stepId) else { return }
        stallFiredSteps.insert(stepId)

        Task {
            await SIBClient(settings: settings).pushGuideSessionEvent(
                liveSessionId: liveSessionId,
                event: PushGuideSessionEventRequest(
                    type: .stepStalled, stepId: stepId, stepIndex: idx, durationSeconds: nil
                )
            )
        }
    }

    /// After marking complete, auto-advance to the next step if one exists.
    /// Follows nextOnSuccess branch if the step has one; otherwise sequential.
    private func autoAdvance(from index: Int) {
        let step = sortedSteps[index]
        if let targetId = step.nextOnSuccess,
           let targetIdx = sortedSteps.firstIndex(where: { $0.id == targetId }) {
            navigateTo(index: targetIdx)
        } else {
            let next = index + 1
            if next < sortedSteps.count {
                navigateTo(index: next)
            }
        }
        // If last/terminal step, panel texture shows the sign-off button on next refresh
    }

    // ── Evidence capture ──────────────────────────────────────────────────────

    private func openEvidencePicker(for index: Int) {
        evidencePickerStepIndex = index
        showEvidencePicker      = true
    }

    // ── TTS ───────────────────────────────────────────────────────────────────

    private func toggleSpeech(for step: GuideStep) {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
            isSpeaking = false
        } else {
            let utt   = AVSpeechUtterance(string: step.effectiveTTSText)
            utt.rate  = AVSpeechUtteranceDefaultSpeechRate
            utt.voice = AVSpeechSynthesisVoice(
                language: Locale.current.language.languageCode?.identifier ?? "en")
            synthesizer.speak(utt)
            isSpeaking = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 300_000_000)
                while synthesizer.isSpeaking {
                    try? await Task.sleep(nanoseconds: 200_000_000)
                }
                isSpeaking = false
            }
        }
    }

    private func stopSpeaking() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        isSpeaking = false
    }

    // ── Step reference photo ──────────────────────────────────────────────────

    private func loadStepImage(for step: GuideStep) async {
        guard let filename = step.mediaPath, stepImages[step.id] == nil else { return }
        let client = SIBClient(settings: settings)
        if let data = try? await client.fetchGuideStepImage(filename: filename),
           let img  = UIImage(data: data) {
            stepImages[step.id] = img
            // Refresh floating panel with the newly loaded image
            refreshPanelTextures(stepId: step.id)
        }
    }

    // ── 3D Ghost Model Overlay ────────────────────────────────────────────────

    /// Fetch the anchor's model library, then background-download GLBs for every
    /// step that has a modelId.  Runs once on session load; results are cached in
    /// `anchorModels` and `glbCache`.  Ghost overlays are attached immediately if
    /// the Operator is already on the step that just finished downloading.
    private func prefetchModels() async {
        let stepModelIds = Set(sortedSteps.compactMap(\.modelId))
        guard !stepModelIds.isEmpty else { return }

        let client = SIBClient(settings: settings)
        guard let models = try? await client.fetchModels(anchorId: anchor.id) else { return }
        anchorModels = models

        // Download USDZ (preferred) or GLB for each step that references a ready model.
        // SCNScene(url:) loads USDZ natively on all iOS versions; GLB requires ModelIO
        // which was removed from the SceneKit bridge in iOS 26.
        let targets = models.filter { stepModelIds.contains($0.id) && $0.hasUSDZ && $0.isReady }
        await withTaskGroup(of: Void.self) { group in
            for model in targets {
                group.addTask { await self.downloadAndCacheModel(model: model) }
            }
        }
    }

    /// Download one model file (USDZ preferred, GLB fallback) and write it to a temp cache.
    /// If the active step is waiting for this model, attach the ghost overlay immediately.
    private func downloadAndCacheModel(model: Model3D) async {
        guard glbCache[model.id] == nil else { return }
        let client = SIBClient(settings: settings)

        // iOS only supports USDZ via SCNScene(url:).
        // The ModelIO→SceneKit GLB bridge was removed in iOS 26.
        // The portal browser converts GLB→USDZ automatically after upload.
        guard model.hasUSDZ else { return }   // skip models still pending browser conversion
        let data = try? await client.downloadModelUSDZ(id: model.id)
        guard let data else { return }

        let cacheDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ar-oms-models", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let fileURL = cacheDir.appendingPathComponent("\(model.id).usdz")
        guard (try? data.write(to: fileURL)) != nil else { return }

        glbCache[model.id] = fileURL

        // Attach ghost for the current navigating step if it uses this model
        if case .navigating(let idx) = phase, idx < sortedSteps.count,
           sortedSteps[idx].modelId == model.id {
            attachGhostOverlay(for: sortedSteps[idx])
        }
        // Also retry any step that was waiting for this exact model to be cached.
        // This covers the race where all models finish downloading *before*
        // transitionToNavigating fires (relocalizing path), so the navigating check
        // above doesn't trigger, but pendingGhostStep was set by the attachGhostOverlay
        // call inside transitionToNavigating.
        else if let pending = pendingGhostStep, pending.modelId == model.id {
            attachGhostOverlay(for: pending)
        }
    }

    /// Display a semi-transparent ghost SCNNode for the given step.
    /// GLB is loaded off the main actor via Task.detached so MDLAsset init
    /// (which can be slow for large files) does not block the AR render loop.
    ///
    /// If the model isn't in glbCache yet (still downloading), the step is stored in
    /// `pendingGhostStep`; downloadAndCacheModel will call this again once the file
    /// arrives, guaranteeing the ghost always appears even when prefetch races
    /// against transitionToNavigating.
    private func attachGhostOverlay(for step: GuideStep) {
        removeGhostOverlay()

        // Step must have a model and a placed world position to show a ghost
        guard let modelId = step.modelId,
              let pos     = step.worldPosition else {
            pendingGhostStep = nil
            return
        }

        // Model not cached yet — register the step as pending so downloadAndCacheModel
        // can retry once the download finishes.
        guard let glbURL = glbCache[modelId] else {
            pendingGhostStep = step
            return
        }

        pendingGhostStep = nil

        // Capture value-type data before hopping off-actor
        let stepId    = step.id
        let scale     = Float(step.modelScale     ?? 1.0)
        let opacity   = CGFloat(step.modelOpacity ?? 0.45)
        let rotationY = Float(step.modelRotationY ?? 0.0)
        let finalPos  = simd_float3(
            pos.x + Float(step.modelOffsetX ?? 0),
            pos.y + Float(step.modelOffsetY ?? 0),
            pos.z + Float(step.modelOffsetZ ?? 0)
        )
        let sceneView = arManager.sceneView

        Task {
            // Load model on a background thread via SCNScene(url:).
            // SCNScene(url:options:) loads USDZ natively on iOS 12+.
            // (GLB requires the ModelIO–SceneKit bridge removed in iOS 26 — always prefer USDZ.)
            let builtNode: SCNNode? = await Task.detached(priority: .utility) { () -> SCNNode? in
                guard let scene = try? SCNScene(url: glbURL, options: [
                    SCNSceneSource.LoadingOption.checkConsistency: false,
                    SCNSceneSource.LoadingOption.flattenScene:     false,
                ]) else { return nil }

                let children = scene.rootNode.childNodes
                guard !children.isEmpty else { return nil }

                let wrapper       = SCNNode()
                wrapper.name      = "ghost_model_\(stepId)"
                children.forEach { wrapper.addChildNode($0.clone()) }
                wrapper.simdScale    = simd_float3(scale, scale, scale)
                wrapper.simdPosition = finalPos
                wrapper.eulerAngles  = SCNVector3(0, rotationY, 0)
                wrapper.opacity      = opacity
                return wrapper
            }.value

            guard let node = builtNode else { return }
            sceneView.scene.rootNode.addChildNode(node)
            ghostModelNode = node
        }
    }

    /// Remove the current ghost model node from the scene.
    private func removeGhostOverlay() {
        ghostModelNode?.removeFromParentNode()
        ghostModelNode = nil
    }
}

// ── Guide Content Panel ───────────────────────────────────────────────────────
//
// The 2D bottom-screen card shown when the Operator arrives at a step (≤ 0.5 m)
// or the step has no AR position.
// Phase 3 additions: evidenceImage, onEvidence callback.

struct GuideContentPanel: View {

    let step:            GuideStep
    let progress:        GuideStepProgress?
    let stepNumber:      Int
    let totalSteps:      Int
    let referenceImage:  UIImage?
    let evidenceImage:   UIImage?   // Phase 3: captured evidence photo (or nil)
    let isSpeaking:      Bool
    let canGoBack:       Bool
    let canGoNext:       Bool
    let canSkip:         Bool
    let allRequiredDone: Bool
    let distanceM:       Float?

    let onPrev:          () -> Void
    let onNext:          () -> Void
    let onSkip:          () -> Void
    let onComplete:      () -> Void
    let onSpeak:         () -> Void
    let onSignOff:       () -> Void
    let onEvidence:      () -> Void              // Phase 3
    let onMinimize:      () -> Void              // collapse back to mini nav card

    var isCompleted: Bool { progress?.isCompleted ?? false }
    var isLastStep:  Bool { stepNumber == totalSteps }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {


            // ── Step header ───────────────────────────────────────────────────
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(isCompleted ? Color.green.opacity(0.2) : Color.indigo.opacity(0.15))
                        .frame(width: 34, height: 34)
                    if isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.green)
                    } else {
                        Text("\(stepNumber)")
                            .font(.subheadline.bold())
                            .foregroundStyle(.indigo)
                    }
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text("Step \(stepNumber) of \(totalSteps)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Text(step.displayTitle)
                        .font(.subheadline.bold())
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if step.completionRequired {
                        Label("Completion required", systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                // Distance pill
                if let d = distanceM {
                    let color: Color = d <= 0.5 ? .green : (d <= 1.0 ? .orange : .secondary)
                    Text(String(format: "%.1f m", d))
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(color)
                }

                // TTS speak button
                Button(action: onSpeak) {
                    Image(systemName: isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.1")
                        .font(.system(size: 20))
                        .foregroundStyle(isSpeaking ? .indigo : .secondary)
                        .symbolEffect(.pulse, isActive: isSpeaking)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 4)

                // Minimize — collapse back to mini nav card
                Button(action: onMinimize) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 16)

            // ── Step description + reference + evidence ────────────────────────
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(step.text)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                    if let img = referenceImage {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .padding(.horizontal, 16)
                    } else if step.mediaPath != nil {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.1))
                            .frame(height: 60)
                            .overlay(ProgressView())
                            .padding(.horizontal, 16)
                    }

                    // Reference link — authored in the Procedure Designer
                    // (video, PDF, SOP page). Opens in Safari; the platform
                    // stores no copy of the target.
                    if let raw = step.linkUrl, let url = URL(string: raw),
                       url.scheme == "https" || url.scheme == "http" {
                        Link(destination: url) {
                            Label("Reference", systemImage: "paperclip")
                                .font(.subheadline.bold())
                                .foregroundStyle(.indigo)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(Color.indigo.opacity(0.12))
                                .clipShape(Capsule())
                        }
                        .padding(.horizontal, 16)
                    }

                    // Evidence row (Phase 3)
                    HStack(spacing: 10) {
                        if let ev = evidenceImage {
                            Image(uiImage: ev)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 60, height: 60)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(Color.green.opacity(0.5), lineWidth: 1.5)
                                )
                        }
                        Button(action: onEvidence) {
                            Label(evidenceImage == nil ? "Add Evidence Photo" : "Retake",
                                  systemImage: "camera.fill")
                                .font(.caption.bold())
                                .foregroundStyle(evidenceImage == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.green))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)

                    Spacer(minLength: 8)
                }
            }
            .frame(maxHeight: referenceImage != nil ? 240 : 140)

            Divider().padding(.horizontal, 16)

            // ── Action row ────────────────────────────────────────────────────
            VStack(spacing: 10) {

                if isLastStep && allRequiredDone {
                    Button(action: onSignOff) {
                        Label("Sign Off & Submit", systemImage: "signature")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.green)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if step.completionRequired && !isCompleted {
                    Button(action: onComplete) {
                        Label("Mark Complete", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.indigo)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if isCompleted {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("Completed").font(.subheadline.bold()).foregroundStyle(.green)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }

                if canSkip {
                    Button(action: onSkip) {
                        Text("Skip this step →")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(spacing: 12) {
                    Button(action: onPrev) {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                            Text("Prev")
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoBack ? .primary : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoBack)

                    Button(action: onNext) {
                        HStack(spacing: 6) {
                            Text(isLastStep ? "Done" : "Next")
                            Image(systemName: isLastStep ? "checkmark" : "chevron.right")
                        }
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(canGoNext ? Color.indigo.opacity(0.9) : Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoNext ? .white : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoNext || isLastStep)
                }
                .padding(.horizontal, 16)
            }
            .padding(.top, 12)
            .padding(.bottom, 34)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        .animation(.easeInOut(duration: 0.2), value: isCompleted)
        .animation(.easeInOut(duration: 0.2), value: allRequiredDone)
    }
}

// ── Session Sign-Off Sheet ────────────────────────────────────────────────────

struct SessionSignOffView: View {

    let guide:         ARGuide
    let anchor:        Anchor
    let progresses:    [GuideStepProgress]
    let startedAt:     Date
    let liveSessionId: String?   // links sign-off to SSE stream; optional for backward compat
    let onDone:        () -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var operatorName = ""
    @State private var isSubmitting = false
    @State private var error:       String? = nil

    private var completedAt: Date { Date() }

    private var durationSeconds: Double {
        completedAt.timeIntervalSince(startedAt)
    }

    private var stepCompletions: [GuideStepCompletion] {
        progresses.compactMap { $0.toCompletion() }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .center, spacing: 12) {
                        Image(systemName: "signature")
                            .font(.system(size: 44))
                            .foregroundStyle(.indigo)
                        Text("Sign Off")
                            .font(.title2.bold())
                        Text("\(guide.name) — \(anchor.assetId)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    HStack {
                        Image(systemName: "person.fill")
                            .foregroundStyle(.indigo).frame(width: 22)
                        TextField("Your name", text: $operatorName)
                            .autocorrectionDisabled()
                    }
                } header: {
                    Text("Operator Sign-Off")
                } footer: {
                    Text("Your name is recorded with this session and cannot be changed after submission.")
                }

                Section {
                    LabeledContent("Steps completed",
                                   value: "\(stepCompletions.count) / \(progresses.count)")
                    LabeledContent("Evidence photos",
                                   value: "\(progresses.filter { $0.evidencePhoto != nil }.count) captured")
                    LabeledContent("Duration",
                                   value: formatDuration(durationSeconds))
                } header: {
                    Text("Session Summary")
                }

                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Sign Off")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Submit") { Task { await submit() } }
                            .bold()
                            .disabled(operatorName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        error        = nil
        let iso      = ISO8601DateFormatter()
        let req      = CreateARGuideSessionRequest(
            guideId:         guide.id,
            anchorId:        anchor.id,
            guideName:       guide.name,
            anchorName:      anchor.assetId,
            signedOffBy:     operatorName.trimmingCharacters(in: .whitespaces),
            startedAt:       iso.string(from: startedAt),
            completedAt:     iso.string(from: completedAt),
            durationSeconds: durationSeconds,
            stepCompletions: stepCompletions,
            liveSessionId:   liveSessionId
        )
        let client = SIBClient(settings: settings)
        do {
            _ = try await client.submitGuideSession(req)
            onDone()
        } catch {
            self.error = "Submission failed: \(friendlyMessage(for: error))"
        }
        isSubmitting = false
    }

    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let m     = total / 60
        let s     = total % 60
        return m > 0 ? "\(m) min \(s) sec" : "\(s) sec"
    }
}
