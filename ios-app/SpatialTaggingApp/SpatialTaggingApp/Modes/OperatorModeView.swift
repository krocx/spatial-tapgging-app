// OperatorModeView.swift — Phase 3
// Operator inspection flow:
//   1. AR camera — tag markers visible (floating label + dot, show/hide toggle)
//   2. Adjust threshold slider (default 0.60, range 0.40–0.90)
//   3. Tap "Inspect Now" → snapshot → POST /perception/validate-all
//   4. Markers update to green (PASS) / red (FAIL) in AR
//   5. "End Inspection" button → ValidationResultsView summary sheet
//   6a. "Re-inspect Failed Tags" → only FAIL/PENDING re-validated (PASS markers stay green)
//   6b. "Re-inspect All Tags"   → full reset + new snapshot
//       "New Scan"              → AnchorDirectoryView → hub → QR gate → new session
//
// Phase 3 entry contract:
//   • appState.activeAnchor, activeTags, anchorNormalisedTransform are pre-set by QRScanGateView.
//   • No QR scanning happens inside Operator mode — session origin is already locked.

import SwiftUI
import ARKit
import SceneKit
import CoreImage
import Vision
import Photos

struct OperatorModeView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @StateObject private var arManager = ARSessionManager()

    // ── Inspection state machine ──────────────────────────────────────────────

    private enum Phase { case idle, validating, reviewing }
    @State private var phase: Phase = .idle

    // ── AR marker state ───────────────────────────────────────────────────────

    @State private var showTagMarkers = true
    @State private var tagMarkerNodes: [String: SCNNode] = [:]

    // ── Cone guides (one per cone-trained tag) ────────────────────────────────
    @State private var coneGuides: [String: ConeARGuide] = [:]

    // ── Proximity / Disney UX ─────────────────────────────────────────────────
    @State private var nearestTagId:   String?  = nil    // tag closest to camera
    @State private var nearestTagDist: Float    = .infinity
    @State private var inConeZone:     Bool     = false  // inside a cone alignment zone
    private let proximityTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    /// Shown instead of the live status card whenever the operator is near a
    /// cone-trained tag (cone guide visible) but hasn't yet aligned into its
    /// zone — replaces the previous "nothing shown" gap with an explicit nudge
    /// so a stale PASS/FAIL is never implied while they're still walking up.
    /// nil when no such tag is nearby (handled by the gizmo instead).
    @State private var approachHintText:     String? = nil
    @State private var approachHintTagLabel: String  = ""

    // ── #88: distance-based marker scaling ────────────────────────────────────
    /// Below this distance the marker is at full (1.0×) scale — normal
    /// walking-up/inspection range. Closer than this, it progressively shrinks.
    private let markerFullScaleDist: Float = 0.45
    /// Closer than this, the marker stops shrinking further (floor scale).
    private let markerMinScaleDist:  Float = 0.15
    private let markerMinScale:      CGFloat = 0.45
    /// Closer than this, show the "too close — move back" hint.
    private let tooCloseDist: Float = 0.18
    /// Set when the operator is right up against the nearest tag — drives a
    /// "move back a bit" hint so the AR marker (now shrunk) doesn't end up
    /// being mistaken for the reason they can't see the part clearly.
    @State private var tooCloseTagLabel: String? = nil

    // ── #89: stuck/idle nudge ──────────────────────────────────────────────────
    // If the operator hasn't made any progress (no zone entered, nothing
    // inspected yet) for a while, offer a gentle, encouraging nudge instead
    // of leaving them wondering whether the app is working at all.
    @State private var lastProgressAt:  Date   = Date()
    @State private var idleNudgeText:   String? = nil
    @State private var idleNudgeShown:  Bool    = false
    private let idleNudgeDelaySecs: Double = 25

    // ── #84: collapsible interactive 3D tag ───────────────────────────────────
    // Tapping a tag's 3D label (small pill + chevron affordance) expands a
    // SwiftUI info card with its full details. Tapping again, tapping a
    // different tag, or tapping empty space collapses/switches it.
    @State private var expandedTagId: String? = nil

    // ── Pass state reference preview ──────────────────────────────────────────
    @State private var passPreviewImage:  UIImage? = nil
    @State private var passPreviewTagId:  String?  = nil
    @State private var passPreviewLabel:  String   = ""
    /// Reference preview is only shown within this distance of a cone tag.
    /// Beyond it, the gizmo (below) guides the operator instead — this single
    /// threshold replaces the old dual 1.5 m / 2.0 m dead-zone that let a
    /// stale, previously-visited tag's image linger on screen.
    private let maxPreviewDistance: Float = 1.6

    // ── "No tag nearby" gizmo ──────────────────────────────────────────────────
    // Compass-style arrow shown when the operator isn't close to any tag,
    // pointing toward whichever tag is nearest in the scene.
    @State private var gizmoTagLabel: String  = ""
    @State private var gizmoBearing:  CGFloat? = nil   // radians, 0 = straight ahead
    @State private var gizmoDistance: Float    = 0

    // ── Auto-captured Pass/Fail reference images ───────────────────────────────
    // One thumbnail per tag, captured the first time that tag's live-validated
    // status commits to PASS or FAIL. Tappable to view fullscreen.
    @State private var capturedPreviewByTag: [String: UIImage]          = [:]
    @State private var capturedStatusByTag:  [String: ValidationStatus] = [:]

    struct SavedConfirmation: Equatable {
        let tagId:  String
        let label:  String
        let status: ValidationStatus
    }
    /// Shows a brief "Pass/Fail image captured & saved" toast; cleared after ~2.5 s.
    @State private var savedConfirmation: SavedConfirmation? = nil

    // ── Phase 4: Per-tag inspection tracking ──────────────────────────────────
    // Drives the 5-state lifecycle:
    //   notVisited → validating → awaitingConfirmation → inspectedPass / inspectedFail
    @State private var tagInspectionStates: [String: TagInspectionState]  = [:]
    @State private var tagInspectionImages: [String: UIImage]             = [:]
    @State private var tagInspectionNotes:  [String: String]              = [:]
    @State private var tagFixedInSession:   [String: Bool]                = [:]
    /// Server-side filename returned after evidence upload (AnchorID_TagID_YYYYMMDD_HHMMSS.jpg).
    @State private var tagImagePaths:       [String: String]              = [:]

    /// FAIL 6-second timer — fires once after 6 s of persistent FAIL to show
    /// the Tag Inspected sheet. Cancelled immediately if PASS fires first.
    @State private var failTimerTask: Task<Void, Never>? = nil

    /// Tag Inspected bottom sheet presentation state.
    @State private var showTagInspectedSheet = false
    @State private var sheetTagId:  String?           = nil
    @State private var sheetImage:  UIImage?           = nil
    @State private var sheetStatus: ValidationStatus?  = nil   // .pass or .fail

    /// Wall-clock session start — used for duration in the inspection report.
    @State private var sessionStartTime: Date = Date()

    // ── Fullscreen image viewer (pinch-zoom) ────────────────────────────────────
    @State private var fullScreenImage: UIImage? = nil
    @State private var fullScreenTitle: String   = ""

    // ── Threshold (Q4) ────────────────────────────────────────────────────────

    @State private var passThreshold: Double = 0.60
    @State private var showThresholdSlider   = false

    // ── Re-inspect filter (Q2) ────────────────────────────────────────────────
    // When set, only these tag IDs are sent to the next validate-all call.

    @State private var reInspectTagIds: [String]? = nil

    // ── Auto-inspect state (T94/T95) ──────────────────────────────────────────
    // Operator walks within cone/proximity FOV → auto-capture per tag.
    // No "Inspect Now" button needed; operator just walks.

    /// Per-tag cooldown: a tag won't be re-auto-inspected for 30 s after its last capture.
    @State private var tagCooldowns:        [String: Date]                 = [:]
    /// Accumulated per-tag results from all auto-inspections in this session.
    @State private var autoInspectedResults: [String: TagValidationSummary] = [:]
    /// True while a single-tag auto-inspection network call is in flight.
    @State private var isAutoInspecting:    Bool                           = false
    private let autoCooldownSecs: Double = 30

    // ── Continuous real-time validation loop ──────────────────────────────────
    // Replaces the old single-shot "capture once on cone-zone entry, then wait
    // out a 30 s cooldown" behaviour. Per the desired UX flow, once the operator
    // is inside a tag's cone FOV the app must keep re-checking continuously so
    // that a state change (e.g. operator fixes a loose cable) is detected and
    // shown as PASS immediately — without requiring the operator to back out of
    // the zone, re-enter it, or press a button again.
    /// The tag currently being continuously validated (nil when not in any cone zone).
    @State private var liveLoopTagId: String? = nil
    /// The actual repeating task; cancelled whenever the operator leaves the zone
    /// or the loop is restarted for a different tag.
    @State private var liveLoopTask: Task<Void, Never>? = nil
    // #71/#73: per-stage status text shown during the "Analysing…" wait, and
    // a cancellable handle for the in-flight validation request/task so a
    // hung request isn't a dead end for the operator.
    @State private var validationStage: String = "Analysing…"
    @State private var validationTask:  Task<Void, Never>? = nil
    /// Granular staging text for the *continuous* in-zone loop's "Checking…"
    /// card (distinct from `validationStage`, which drives the discrete
    /// "Inspect All" progress UI). Cycles through connection/analysis steps
    /// so the operator sees the app is actively working rather than a static
    /// label, especially during the first few seconds before a tag's initial
    /// result commits.
    @State private var liveLoopStage: String = "Getting ready…"
    /// Recent consecutive statuses per tag, used to debounce/hysteresis the
    /// displayed Pass/Fail so a single noisy frame near the threshold doesn't
    /// flicker the AR marker back and forth.
    @State private var statusStreak: [String: (status: ValidationStatus, count: Int)] = [:]
    /// How often the loop re-captures + re-validates while inside the cone zone.
    private let liveLoopIntervalSecs: Double = 0.7
    /// Consecutive identical results required before flipping the displayed status.
    private let hysteresisFrames = 2

    // ── UI state ──────────────────────────────────────────────────────────────

    @State private var validateError: String? = nil
    @State private var showResults   = false
    @State private var showNewScan   = false
    @State private var showHelpSheet  = false   // kept for legacy; use showOnboarding
    @State private var showOnboarding = false
    @State private var flashOpacity: Double = 0

    // ── #69: AR session interruption banner ────────────────────────────────────
    // Shown when arManager.isInterrupted toggles (phone call, Control Center,
    // app switcher, etc.). A capture/validation that completes during an
    // interruption is scoring/training against a frozen frame, so we cancel
    // anything in flight and prompt the operator to re-check alignment once
    // tracking resumes, instead of silently trusting a stale result.
    @State private var interruptionMsg: String? = nil

    // ── Diagnostic / debug state ──────────────────────────────────────────────
    /// Bright sphere placed at the anchor QR world position — always visible when
    /// anchorNormalisedTransform is set.  Lets the operator confirm AR is working
    /// and navigate to the anchor before looking for smaller tag markers.
    @State private var anchorDebugSphere: SCNNode? = nil
    /// On-screen toast shown for 3 s after appear, summarising placement status.
    @State private var debugToastMessage: String? = nil
    @State private var debugToastVisible: Bool    = false

    /// True once the QR anchor has been detected and locked in THIS session's
    /// world frame. Tag markers and cone guides are only placed after this is set.
    /// Phase 3 fix: each ARSessionManager starts with a fresh world coordinate
    /// frame (resetTracking), so we must re-detect the anchor QR here to get the
    /// current-session transform before converting anchor-relative positions.
    @State private var anchorLocated = false

    // ── Session-preserving AR container ──────────────────────────────────────
    // OwnSCNViewContainer intentionally omits dismantleUIView.  ARContainerView's
    // dismantleUIView calls session.pause(), which would pause the SHARED session
    // handed off from QRScanGateView — corrupting the coordinate frame mid-inspection.
    // Lifecycle ownership: QRScanGateView starts the session; OperatorModeView.onDisappear
    // explicitly pauses it via arManager.pauseSession().
    private struct OwnSCNViewContainer: UIViewRepresentable {
        let sceneView: ARSCNView
        func makeUIView(context: Context) -> ARSCNView { sceneView }
        func updateUIView(_ uiView: ARSCNView, context: Context) {}
        // Intentionally no dismantleUIView — session lifecycle owned by AppState.
    }

    /// Fullscreen image viewer preserving iOS's native pinch-to-zoom behaviour.
    /// Backed by UIScrollView (not a SwiftUI gesture reimplementation) so zoom,
    /// double-tap-to-zoom, and momentum all feel exactly like Photos.app.
    /// Single tap (when not zoomed in) calls `onTap` to dismiss.
    private struct ZoomableImageView: UIViewRepresentable {
        let image: UIImage
        let onTap: () -> Void

        func makeUIView(context: Context) -> UIScrollView {
            let scrollView = UIScrollView()
            scrollView.delegate = context.coordinator
            scrollView.minimumZoomScale = 1.0
            scrollView.maximumZoomScale = 5.0
            scrollView.showsHorizontalScrollIndicator = false
            scrollView.showsVerticalScrollIndicator = false
            scrollView.bouncesZoom = true

            let imageView = UIImageView(image: image)
            imageView.contentMode = .scaleAspectFit
            imageView.isUserInteractionEnabled = true
            imageView.translatesAutoresizingMaskIntoConstraints = true
            imageView.frame = scrollView.bounds
            imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

            scrollView.addSubview(imageView)
            context.coordinator.imageView = imageView

            let doubleTap = UITapGestureRecognizer(target: context.coordinator,
                                                    action: #selector(Coordinator.handleDoubleTap(_:)))
            doubleTap.numberOfTapsRequired = 2
            scrollView.addGestureRecognizer(doubleTap)

            let singleTap = UITapGestureRecognizer(target: context.coordinator,
                                                    action: #selector(Coordinator.handleSingleTap(_:)))
            singleTap.numberOfTapsRequired = 1
            singleTap.require(toFail: doubleTap)
            scrollView.addGestureRecognizer(singleTap)

            return scrollView
        }

        func updateUIView(_ scrollView: UIScrollView, context: Context) {
            context.coordinator.imageView?.image = image
        }

        func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

        final class Coordinator: NSObject, UIScrollViewDelegate {
            weak var imageView: UIImageView?
            let onTap: () -> Void
            init(onTap: @escaping () -> Void) { self.onTap = onTap }

            func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

            @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
                guard let scrollView = gesture.view as? UIScrollView else { return }
                if scrollView.zoomScale > scrollView.minimumZoomScale {
                    scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
                } else {
                    let point = gesture.location(in: imageView)
                    let zoomRect = CGRect(x: point.x - 50, y: point.y - 50, width: 100, height: 100)
                    scrollView.zoom(to: zoomRect, animated: true)
                }
            }

            @objc func handleSingleTap(_ gesture: UITapGestureRecognizer) {
                guard let scrollView = gesture.view as? UIScrollView else { return }
                // Only dismiss-on-tap while not zoomed in, so a tap meant to pan
                // a zoomed image doesn't accidentally close the viewer.
                if scrollView.zoomScale <= scrollView.minimumZoomScale {
                    onTap()
                }
            }
        }
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            // Live AR camera — uses OwnSCNViewContainer so the shared session is
            // never paused by a SwiftUI dismantleUIView call during inspection.
            OwnSCNViewContainer(sceneView: arManager.sceneView)
                .ignoresSafeArea()

            // ── #84: tag tap catcher ─────────────────────────────────────────────
            // Invisible layer over the camera feed that hit-tests taps against
            // the 3D tag markers, so tapping a tag's label expands its info
            // card. Sits below all the buttons/cards added later in this ZStack,
            // so it only intercepts taps that land on empty camera space.
            Color.clear
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        handleMarkerTap(at: value.location)
                    }
                )

            // Capture flash
            Color.white.opacity(flashOpacity)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            // #69: AR session interruption banner
            if let msg = interruptionMsg {
                VStack {
                    Spacer().frame(height: 100)
                    HStack(spacing: 10) {
                        Image(systemName: "pause.circle").foregroundStyle(.white)
                        Text(msg).font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                        Spacer()
                        Button { interruptionMsg = nil } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.blue.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: interruptionMsg != nil)
                .zIndex(20)
            }

            VStack(spacing: 0) {
                topBar
                Spacer()
                bottomPanel
            }

            // ── Anchor scanning overlay ───────────────────────────────────────
            // Shown until the anchor QR is re-detected in this session's world frame.
            // Disappears automatically as soon as the QR is locked (usually < 1 s
            // since the user just came from QRScanGateView and the QR is nearby).
            if !anchorLocated {
                VStack {
                    Spacer()
                    HStack(spacing: 10) {
                        Image(systemName: "qrcode.viewfinder")
                            .foregroundStyle(.cyan)
                            .font(.subheadline)
                        Text("Point at the anchor QR to start")
                            .font(.subheadline)
                            .foregroundStyle(.white)
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.75)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .padding(.bottom, 110)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.4), value: anchorLocated)
            }

            // ── Live Pass/Fail status card ──────────────────────────────────────
            // Replaces the old plain "In zone" / "Capturing…" badge. As soon as
            // the operator is in a tag's cone zone, the continuous live loop
            // (startLiveLoop) is already running detection — this card makes
            // that obvious by showing a real-time check/X for the tag currently
            // being inspected, sourced straight from autoInspectedResults.
            if phase != .validating, let label = tooCloseTagLabel {
                // #88: right up against the tag — the shrunk marker alone
                // isn't enough feedback, tell them directly to step back.
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        VStack(spacing: 6) {
                            Image(systemName: "arrow.down.backward.and.arrow.up.forward")
                                .font(.system(size: 26, weight: .semibold))
                                .foregroundStyle(.orange)
                                .symbolEffect(.pulse)
                            Text("A little too close — step back a bit")
                                .font(.caption.bold())
                                .foregroundStyle(.orange)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: 140)
                            Text(label)
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.6))
                                .lineLimit(1)
                        }
                        .padding(14)
                        .background(.black.opacity(0.60), in: RoundedRectangle(cornerRadius: 14))
                        .padding(.trailing, 20)
                    }
                    .padding(.bottom, 130)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: tooCloseTagLabel)
                .allowsHitTesting(false)
            } else if inConeZone && phase != .validating, let activeTagId = liveLoopTagId ?? nearestTagId {
                liveStatusCard(forTagId: activeTagId)
                    .transition(.scale.combined(with: .opacity))
                    .animation(.spring(response: 0.35, dampingFraction: 0.75), value: inConeZone)
            } else if phase != .validating, let hint = approachHintText {
                // Near a cone tag but not yet aligned — guide them in instead
                // of showing nothing or a leftover PASS/FAIL.
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        VStack(spacing: 6) {
                            Image(systemName: "arrow.down.forward.and.arrow.up.backward")
                                .font(.system(size: 26, weight: .semibold))
                                .foregroundStyle(.cyan)
                                .symbolEffect(.pulse)
                            Text(hint)
                                .font(.caption.bold())
                                .foregroundStyle(.cyan)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: 140)
                            Text(approachHintTagLabel)
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.6))
                                .lineLimit(1)
                        }
                        .padding(14)
                        .background(.black.opacity(0.60), in: RoundedRectangle(cornerRadius: 14))
                        .padding(.trailing, 20)
                    }
                    .padding(.bottom, 130)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: approachHintText)
                .allowsHitTesting(false)
            }

            // ── #84: expanded tag info card ───────────────────────────────────────
            if let tagId = expandedTagId,
               let tag = appState.activeTags.first(where: { $0.id == tagId }) {
                expandedTagCard(for: tag)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
                    .animation(.spring(response: 0.3, dampingFraction: 0.8), value: expandedTagId)
                    .zIndex(5)
            }

            // ── #89: stuck/idle nudge banner ──────────────────────────────────────
            if let nudge = idleNudgeText {
                VStack {
                    Spacer().frame(height: 100)
                    HStack(spacing: 10) {
                        Image(systemName: "hand.wave.fill").foregroundStyle(.yellow)
                        Text(nudge)
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        Button { idleNudgeText = nil } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: idleNudgeText)
            }

            // ── "No tag nearby" gizmo ────────────────────────────────────────────
            // Shown instead of a (possibly stale) pass-reference preview whenever
            // the operator isn't within range of any tag — points toward the
            // nearest one so they know which way to walk.
            if phase == .idle, passPreviewImage == nil, let bearing = gizmoBearing {
                VStack {
                    Spacer()
                    VStack(spacing: 6) {
                        Image(systemName: "location.north.fill")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(.cyan)
                            .rotationEffect(.radians(Double(bearing)))
                        Text(gizmoTagLabel)
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                        Text(String(format: "%.1f m", gizmoDistance))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    .padding(14)
                    .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
                    .padding(.bottom, 220)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.3), value: gizmoBearing != nil)
                .allowsHitTesting(false)
            }

            // ── "Saved" confirmation toast ───────────────────────────────────────
            if let saved = savedConfirmation {
                VStack {
                    HStack(spacing: 8) {
                        Image(systemName: saved.status == .pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(saved.status == .pass ? .green : .red)
                        Text("\(saved.status == .pass ? "Pass" : "Fail") image captured for \(saved.label) — saved")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .lineLimit(2)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.black.opacity(0.80), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 24).padding(.top, 130)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: savedConfirmation)
                .allowsHitTesting(false)
            }

            // ── Diagnostic toast (auto-hides after 3 s) ───────────────────────
            // Shows tag placement status immediately after appear so the operator
            // knows whether markers were found and placed — no Xcode needed.
            if debugToastVisible, let msg = debugToastMessage {
                VStack {
                    HStack(spacing: 8) {
                        Image(systemName: "info.circle.fill")
                            .font(.caption).foregroundStyle(.cyan)
                        Text(msg)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.white)
                            .lineLimit(3)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.black.opacity(0.80), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16).padding(.top, 100)
                    Spacer()
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.4), value: debugToastVisible)
                .allowsHitTesting(false)
            }

            // ── Pass state reference preview ───────────────────────────────────
            // Small thumbnail of the training image so the operator knows exactly
            // what pass state looks like before capturing. Tappable → fullscreen
            // (with native pinch-zoom), matching the captured-image thumbnail below.
            if let preview = passPreviewImage, phase == .idle {
                VStack {
                    Spacer()
                    HStack(alignment: .bottom, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("PASS REF")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(.green)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.green.opacity(0.85), in: Capsule())
                            Image(uiImage: preview)
                                .resizable().scaledToFill()
                                .frame(width: 88, height: 88)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.green.opacity(0.8), lineWidth: 1.5))
                            Text(passPreviewLabel)
                                .font(.system(size: 8, weight: .medium))
                                .foregroundStyle(.white.opacity(0.75))
                                .lineLimit(1)
                                .frame(width: 88)
                        }
                        .padding(8)
                        .background(.black.opacity(0.70), in: RoundedRectangle(cornerRadius: 12))
                        .contentShape(Rectangle())
                        .onTapGesture {
                            fullScreenTitle = "Pass reference — \(passPreviewLabel)"
                            fullScreenImage = preview
                        }

                        // ── Captured Pass/Fail reference thumbnail ──────────────────
                        // Shown once the live loop has captured+saved one image for
                        // this tag's currently-committed status. Tap → fullscreen.
                        if let activeId = passPreviewTagId,
                           let captured = capturedPreviewByTag[activeId],
                           let capturedStatus = capturedStatusByTag[activeId] {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(capturedStatus == .pass ? "CAPTURED PASS" : "CAPTURED FAIL")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(capturedStatus == .pass ? .green : .red)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background((capturedStatus == .pass ? Color.green : Color.red).opacity(0.85), in: Capsule())
                                Image(uiImage: captured)
                                    .resizable().scaledToFill()
                                    .frame(width: 88, height: 88)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    .overlay(RoundedRectangle(cornerRadius: 10)
                                        .stroke((capturedStatus == .pass ? Color.green : Color.red).opacity(0.8), lineWidth: 1.5))
                            }
                            .padding(8)
                            .background(.black.opacity(0.70), in: RoundedRectangle(cornerRadius: 12))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                fullScreenTitle = "\(capturedStatus == .pass ? "Pass" : "Fail") capture — \(passPreviewLabel)"
                                fullScreenImage = captured
                            }
                        }

                        Spacer()
                    }
                    .padding(.leading, 16)
                    .padding(.bottom, 130)
                }
                .transition(.move(edge: .leading).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: passPreviewImage != nil)
            }

            // ── Fullscreen image viewer ──────────────────────────────────────────
            // Native pinch-zoom (UIScrollView-backed) + tap-to-dismiss, shared by
            // both the pass-reference thumbnail and the captured-image thumbnail.
            if let image = fullScreenImage {
                ZStack {
                    Color.black.ignoresSafeArea()
                    ZoomableImageView(image: image) {
                        fullScreenImage = nil
                    }
                    .ignoresSafeArea()
                    VStack {
                        HStack {
                            Spacer()
                            Button { fullScreenImage = nil } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.title2)
                                    .foregroundStyle(.white, Color.black.opacity(0.5))
                            }
                            .padding(.trailing, 20).padding(.top, 56)
                        }
                        Spacer()
                        Text(fullScreenTitle)
                            .font(.caption.bold())
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(.bottom, 30)
                    }
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: fullScreenImage != nil)
                .zIndex(10)
            }
        }
        .onAppear {
            lastProgressAt  = Date()   // #89: start the idle clock fresh for this session
            sessionStartTime = Date()  // Phase 4: wall-clock start for duration calculation
            // FTUE auto-show handled by AnchorDirectoryView; ? button here still works.

            if let existingSession = appState.activeARSession {
                // ── Session continuity path ────────────────────────────────────
                // Link to QRScanGateView's already-running session.  The live
                // ARImageAnchor is still tracked — no QR re-scan needed.
                arManager.linkToExistingSession(existingSession)
                arManager.disableQRScanning()

                // ── Immediate placement using already-known anchor transform ───
                // appState.anchorNormalisedTransform is set by QRScanGateView's
                // lockSession() before navigation to Operator mode.
                attemptInitialMarkerPlacement()

                // ── Deferred safety-net retry ─────────────────────────────────
                // linkToExistingSession reassigns sceneView.session on the current
                // run loop tick.  SceneKit may not deliver the first rendering frame
                // from the newly-linked session until the NEXT display-link cycle.
                // If no nodes were placed (e.g. tags loaded async, frame not yet
                // ready), retry after 300 ms to guarantee visibility.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
                    if tagMarkerNodes.isEmpty {
                        print("[OperatorMode] ⚠️ Safety-net retry: no nodes placed yet — retrying placeTagMarkers()")
                        attemptInitialMarkerPlacement()
                    }
                }
            } else {
                // ── Fallback path ──────────────────────────────────────────────
                // No shared session available (legacy / unusual entry).
                // Start a fresh session and wait for QR re-lock via onChange below.
                print("[OperatorMode] ⚠️ No activeARSession — starting fresh session (QR re-scan needed)")
                arManager.startSession()
                // QR scanning stays enabled — onChange(lockedAnchorTransform) handles placement.
            }
        }
        // #69: an interruption (phone call, Control Center, app switcher) freezes
        // the camera feed without tearing down the session. Cancel anything
        // in-flight scoring/training against a now-stale frame, and prompt the
        // operator to re-verify alignment once tracking resumes — instead of
        // silently trusting a result computed during/just after the interruption.
        .onChange(of: arManager.isInterrupted) { interrupted in
            if interrupted {
                validationTask?.cancel()
                stopLiveLoop()
                interruptionMsg = "Session interrupted — paused inspection."
            } else {
                interruptionMsg = "Tracking resumed — tap Inspect All to re-verify alignment."
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                    if interruptionMsg?.hasPrefix("Tracking resumed") == true { interruptionMsg = nil }
                }
            }
        }
        .onDisappear {
            failTimerTask?.cancel()   // Phase 4: ensure FAIL timer doesn't fire after leaving
            failTimerTask = nil
            stopLiveLoop()
            coneGuides.values.forEach { $0.cleanup() }
            coneGuides.removeAll()
            anchorDebugSphere?.removeFromParentNode()
            anchorDebugSphere = nil
            arManager.pauseSession()
            // Clear the shared session — this AR session is finished.
            appState.activeARSession = nil
        }
        // ── Anchor transform change: initial placement OR live refinement ─────
        // Fires from:
        //   • linkToExistingSession() restoring the live ARImageAnchor (~150 ms)
        //   • processImageAnchors() continuous refinement while QR is visible
        //   • Legacy QR re-lock path (onChange scanState below) via lockedAnchorTransform
        .onChange(of: arManager.lockedAnchorTransform) { newTransform in
            guard let t = newTransform else { return }
            appState.anchorNormalisedTransform = t
            if !anchorLocated {
                // First valid transform arriving via QR re-scan (fallback path) —
                // do full placement.
                arManager.disableQRScanning()
                attemptInitialMarkerPlacement()
            } else {
                // Subsequent refinements from live ARImageAnchor tracking —
                // smoothly reposition existing marker nodes and move debug sphere.
                repositionTagMarkerNodes()
                let col = t.columns.3
                anchorDebugSphere?.simdPosition = simd_float3(col.x, col.y, col.z)
            }
        }
        // ── Legacy fallback: QR re-scan path ──────────────────────────────────
        // Handles the case where no activeARSession was available and the operator
        // manually scanned the QR in a fresh session.
        .onChange(of: arManager.scanState) { state in
            guard case .locked(let ctx) = state else { return }
            guard ctx.anchorId == appState.activeAnchor?.id else { return }
            // lockedAnchorTransform is already set by lockAnchor(); the
            // onChange(lockedAnchorTransform) above handles placement.
            // Nothing extra needed here except the anchorId safety check above.
        }
        .onReceive(proximityTicker) { _ in tickProximity() }
        .onChange(of: showTagMarkers) { visible in
            tagMarkerNodes.values.forEach { $0.isHidden = !visible }
        }
        // Summary sheet — slides up after "End Inspection"
        .sheet(isPresented: $showResults) {
            if let result = appState.lastValidationResult,
               let anchor = appState.activeAnchor {
                ValidationResultsView(
                    result:      result,
                    anchor:      anchor,
                    onClose:     { showResults = false },
                    onReInspect: { failedOnly in
                        showResults = false
                        resetForReInspect(failedOnly: failedOnly)
                    },
                    onNewScan: {
                        showResults = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            resetForNewScan()
                            showNewScan = true
                        }
                    },
                    tagInspectionStates: tagInspectionStates,
                    tagInspectionNotes:  tagInspectionNotes
                )
                .environmentObject(settings)
                .environmentObject(appState)
            }
        }
        // New Scan: directory → hub → QR gate → new OperatorModeView session
        .fullScreenCover(isPresented: $showNewScan) {
            AnchorDirectoryView(
                mode: .operator,
                onSessionReady: { anchor, tags in
                    showNewScan = false
                    appState.activeAnchor         = anchor
                    appState.activeTags           = tags
                    appState.activeSession        = nil
                    appState.lastValidationResult = nil
                    // Phase 3 fix: clear stale markers and reset QR detection so the
                    // new anchor is re-scanned in this session's coordinate frame.
                    // onChange(of: arManager.scanState) will call placeTagMarkers()
                    // and buildConeGuides() once the QR is locked.
                    tagMarkerNodes.values.forEach { $0.removeFromParentNode() }
                    tagMarkerNodes.removeAll()
                    coneGuides.values.forEach { $0.cleanup() }
                    coneGuides.removeAll()
                    anchorLocated = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        arManager.resetScan()   // fresh world frame for new anchor
                    }
                },
                onCancel: { showNewScan = false }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        .sheet(isPresented: $showOnboarding) {
            OnboardingSheet(context: .operatorMode)
        }
        // ── Phase 4: Tag Inspected bottom sheet ───────────────────────────────
        .sheet(isPresented: $showTagInspectedSheet) {
            if let tagId = sheetTagId, let status = sheetStatus {
                let tagLabel = appState.activeTags
                    .first(where: { $0.id == tagId })?.label ?? tagId
                TagInspectedSheet(
                    tagLabel:      tagLabel,
                    status:        status,
                    image:         sheetImage,
                    fixedInSession: tagFixedInSession[tagId] ?? false,
                    onReInspect: { handleReInspectFromSheet(tagId: tagId) },
                    onConfirm:   { note in handleConfirmFromSheet(tagId: tagId, status: status, note: note) }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.hidden)
                .presentationBackground(Color(white: 0.10))
            }
        }
        // ── Tour banner (Operator step) ────────────────────────────────────────
        .overlay {
            if tour.isActive && tour.currentStep == .runInspection {
                CoachMarkOverlay(
                    step:       .runInspection,
                    targetRect: nil,
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },   // advances to .done
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: tour.currentStep)
            }
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [.black.opacity(0.65), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 130)
                .allowsHitTesting(false)

            HStack(alignment: .center, spacing: 14) {
                // Exit
                Button {
                    appState.reset()
                    appState.mode = .none
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white, Color.black.opacity(0.4))
                }

                Spacer()

                VStack(spacing: 3) {
                    Text("Operator Mode")
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                    if let anchor = appState.activeAnchor {
                        Text("\(anchor.assetId) · \(String(anchor.id.prefix(10)))…")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.65))
                            .lineLimit(1)
                    }
                    // G6: Session ID visible in top bar once a session is active
                    if let sessionId = appState.activeSession?.id {
                        Text("Session \(String(sessionId.prefix(12)))…")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.white.opacity(0.45))
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Threshold adjust button
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { showThresholdSlider.toggle() }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "dial.medium")
                            .font(.caption.bold())
                        Text(String(format: "%.0f%%", passThreshold * 100))
                            .font(.caption2.monospacedDigit().bold())
                    }
                    .foregroundColor(showThresholdSlider ? .yellow : .white)
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                }

                // Show/hide tag markers toggle
                Button {
                    showTagMarkers.toggle()
                } label: {
                    Image(systemName: showTagMarkers ? "eye.fill" : "eye.slash.fill")
                        .font(.body)
                        .foregroundColor(.white)
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(showTagMarkers ? "Hide tags" : "Show tags")

                // Help
                Button { showOnboarding = true } label: {
                    Image(systemName: "questionmark.circle")
                        .font(.body)
                        .foregroundColor(.white)
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }

                // Tag count badge
                Label("\(appState.activeTags.count)", systemImage: "tag.fill")
                    .font(.caption.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.green.opacity(0.35), in: Capsule())
            }
            .padding(.horizontal, 20)
            .padding(.top, 56)
        }
    }

    // ── Bottom panel — switches on phase ─────────────────────────────────────

    @ViewBuilder
    private var bottomPanel: some View {
        VStack(spacing: 14) {
            switch phase {

            case .idle:
                // Threshold slider (shown when toggled)
                if showThresholdSlider {
                    VStack(spacing: 6) {
                        HStack {
                            Image(systemName: "dial.medium")
                                .foregroundStyle(.yellow)
                                .font(.caption)
                            Text("PASS threshold")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.75))
                            Spacer()
                            Text(String(format: "%.0f%%", passThreshold * 100))
                                .font(.caption.monospacedDigit().bold())
                                .foregroundColor(.yellow)
                        }
                        Slider(value: $passThreshold, in: 0.40...0.90, step: 0.05)
                            .tint(.yellow)
                        HStack {
                            Text("40% (lenient)").font(.caption2).foregroundColor(.white.opacity(0.4))
                            Spacer()
                            Text("90% (strict)").font(.caption2).foregroundColor(.white.opacity(0.4))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // Error (if any)
                if let err = validateError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .onTapGesture { validateError = nil }
                }
                // Previous result mini-banner
                if let prev = appState.lastValidationResult {
                    lastResultBanner(prev)
                }

                // Re-inspect filter banner (when coming from failed-only re-inspect)
                if let ids = reInspectTagIds {
                    HStack(spacing: 8) {
                        Image(systemName: "scope")
                            .foregroundStyle(.orange)
                            .font(.caption)
                        Text("Re-inspecting \(ids.count) failed tag\(ids.count == 1 ? "" : "s") only")
                            .font(.caption.bold())
                            .foregroundColor(.orange)
                        Spacer()
                        Button("Clear") { reInspectTagIds = nil }
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.horizontal, 20)
                }

                // ── Walking mode: auto-inspect progress ───────────────────────
                // Tags are captured automatically when the operator enters their
                // FOV. "Inspect All" is the fallback for non-proximity validation.
                let inspectedCount = autoInspectedResults.count
                let totalCount     = appState.activeTags.count

                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 3) {
                        if inspectedCount == 0 {
                            Label("Walk to each tag to inspect",
                                  systemImage: "figure.walk")
                                .font(.subheadline.bold())
                                .foregroundColor(.white)
                            Text("Auto-captures on zone entry")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.55))
                        } else {
                            Label("\(inspectedCount) / \(totalCount) tags inspected",
                                  systemImage: "checkmark.circle.fill")
                                .font(.subheadline.bold())
                                .foregroundColor(.white)
                            Text("Keep walking to reach remaining tags")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.55))
                        }
                    }
                    Spacer()
                    // Force-all as secondary compact action
                    Button { validationTask = Task { await runValidation() } } label: {
                        Label("Inspect All", systemImage: "viewfinder.circle.fill")
                            .font(.caption.bold())
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                }
                .padding(.horizontal, 20)

                // "End Inspection" once at least one tag is done
                if inspectedCount > 0 {
                    Button {
                        submitSessionReport()   // Phase 4: fire-and-forget report upload
                        showResults = true
                    } label: {
                        Label("End Inspection", systemImage: "checkmark.seal.fill")
                            .font(.title3.bold())
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .padding(.horizontal, 20)
                }

            case .validating:
                HStack(spacing: 10) {
                    ProgressView().tint(.white)
                    Text(validationStage) // #71: per-stage status instead of a fixed string
                        .foregroundColor(.white)
                        .font(.subheadline)
                    Spacer()
                    // #73: lets the operator back out of a hung request instead
                    // of being stuck waiting with no way to recover.
                    Button {
                        validationTask?.cancel()
                    } label: {
                        Text("Cancel")
                            .font(.subheadline.bold())
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .padding(.horizontal, 16)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 20)

            case .reviewing:
                reviewingPanel
            }
        }
        .padding(.vertical, 16)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.75)],
                           startPoint: .top, endPoint: .bottom)
        )
    }

    // ── Reviewing panel ───────────────────────────────────────────────────────

    private var reviewingPanel: some View {
        VStack(spacing: 14) {
            if let result = appState.lastValidationResult {
                // AR legend + counts
                HStack(spacing: 20) {
                    Label("\(result.passCount) passed", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    if result.failCount > 0 {
                        Label("\(result.failCount) failed", systemImage: "xmark.circle.fill")
                            .foregroundStyle(.red)
                    }
                    let pending = result.tagResults.filter { $0.status == .pending }.count
                    if pending > 0 {
                        Label("\(pending) pending", systemImage: "clock")
                            .foregroundStyle(.gray)
                    }
                }
                .font(.subheadline.bold())
                .foregroundColor(.white)

                // End Inspection
                Button {
                    submitSessionReport()   // Phase 4: fire-and-forget report upload
                    showResults = true
                } label: {
                    Label("End Inspection", systemImage: "checkmark.seal.fill")
                        .font(.title3.bold())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
                .buttonStyle(.borderedProminent)
                .tint(result.status == .pass ? .green : .red)
                .padding(.horizontal, 20)
            }
        }
    }

    // ── Last-result mini banner ───────────────────────────────────────────────

    private func lastResultBanner(_ result: AnchorValidationResult) -> some View {
        Button { showResults = true } label: {
            HStack(spacing: 10) {
                Image(systemName: result.status.iconName)
                    .foregroundStyle(result.status.color)
                Text("Last: \(result.passCount)/\(result.totalCount) passed")
                    .font(.caption.bold())
                    .foregroundColor(.white)
                Spacer()
                Text("View →")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(result.status.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(result.status.color.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
    }

    // ── Live Pass/Fail status card ────────────────────────────────────────────

    /// The on-screen indicator for requirement #1/#4: as soon as the operator
    /// is in a tag's cone zone, `startLiveLoop` is already continuously
    /// re-validating it (no button press needed) — this card surfaces that
    /// result live with a check/X, confidence, and tag label, replacing the
    /// old ambiguous "In zone" / "Capturing…" badge.
    @ViewBuilder
    private func liveStatusCard(forTagId tagId: String) -> some View {
        let result = autoInspectedResults[tagId]
        let tagLabel = appState.activeTags.first(where: { $0.id == tagId })?.label ?? ""

        VStack {
            Spacer()
            HStack {
                Spacer()
                VStack(spacing: 6) {
                    if let result, result.status != .pending {
                        Image(systemName: result.status == .pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(result.status == .pass ? .green : .red)
                            .symbolEffect(.pulse)
                        Text(result.status == .pass ? "PASS" : "FAIL")
                            .font(.caption.bold())
                            .foregroundStyle(result.status == .pass ? .green : .red)
                        Text(String(format: "%.0f%%", result.confidence * 100))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.7))
                        // Phase 4: FAIL hint — shown while the 6s timer is counting down
                        if result.status == .fail, failTimerTask != nil {
                            Text("Adjust & hold to correct,\nor wait for inspection note")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(.orange)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: 130)
                        }
                    } else {
                        Image(systemName: "scope")
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundStyle(.yellow)
                            .symbolEffect(.pulse)
                        Text(liveLoopStage)
                            .font(.caption.bold())
                            .foregroundStyle(.yellow)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 140)
                    }
                    Text(tagLabel)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.6))
                        .lineLimit(1)
                }
                .padding(14)
                .background(.black.opacity(0.60), in: RoundedRectangle(cornerRadius: 14))
                .padding(.trailing, 20)
            }
            .padding(.bottom, 130)
        }
    }

    // ── #84: expanded tag info card ───────────────────────────────────────────

    /// Full info for a tapped tag — description, type, and (once inspected)
    /// its current result. Collapses on a second tap of the same marker, a
    /// tap on a different marker, or a tap on empty space.
    @ViewBuilder
    private func expandedTagCard(for tag: Tag) -> some View {
        VStack {
            Spacer()
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: tag.type.iconName)
                        .foregroundStyle(tag.type.color)
                    Text(tag.label)
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                    Spacer()
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { expandedTagId = nil }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
                Text(tag.type.displayName)
                    .font(.caption.bold())
                    .foregroundStyle(tag.type.color)
                if let desc = tag.checkDescription, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.85))
                }
                Divider().background(.white.opacity(0.2))
                Text("Expected: \(tag.expectedOutcome)")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
                if let result = autoInspectedResults[tag.id], result.status != .pending {
                    HStack(spacing: 6) {
                        Image(systemName: result.status == .pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(result.status == .pass ? .green : .red)
                        Text(result.status == .pass ? "Currently passing" : "Currently failing")
                            .font(.caption2.bold())
                            .foregroundStyle(result.status == .pass ? .green : .red)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: 280, alignment: .leading)
            .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)
            .padding(.bottom, 160)
        }
    }

    // ── AR marker placement ───────────────────────────────────────────────────

    /// Called from onAppear (and its 300 ms retry) to lock anchorLocated and
    /// place all markers.  Guards against double-placement with the anchorLocated flag.
    private func attemptInitialMarkerPlacement() {
        guard let anchorT = appState.anchorNormalisedTransform else {
            print("[OperatorMode] ⚠️ attemptInitialMarkerPlacement — anchorNormalisedTransform is nil, cannot place markers")
            showDebugToast("⚠️ anchorTransform=NIL  tags=\(appState.activeTags.count)  — scan QR to locate anchor")
            return
        }
        guard !appState.activeTags.isEmpty else {
            print("[OperatorMode] ⚠️ attemptInitialMarkerPlacement — activeTags is empty")
            showDebugToast("⚠️ activeTags=EMPTY  No tags loaded yet")
            return
        }
        if !anchorLocated { anchorLocated = true }

        // ── Always-visible anchor sphere ──────────────────────────────────────
        // A bright cyan sphere placed at the QR code's world origin.
        // Confirms AR tracking is live and the coordinate frame is correct.
        // Helps the operator navigate to the anchor region.
        placeAnchorDebugSphere(anchorTransform: anchorT)

        placeTagMarkers()
        buildConeGuides()
        coneGuides.values.forEach { $0.setVisible(false, animated: false) }

        let placed  = tagMarkerNodes.count
        let total   = appState.activeTags.count
        print("[OperatorMode] ✓ attemptInitialMarkerPlacement complete — \(placed)/\(total) markers placed")

        if placed == 0 && total > 0,
           let firstSkipped = appState.activeTags.first(where: { tagMarkerNodes[$0.id] == nil }) {
            let keys = firstSkipped.metadata.keys.sorted().joined(separator: ",")
            showDebugToast("⚠️ 0/\(total) placed — '\(firstSkipped.label)' keys: [\(keys)]")
        } else {
            showDebugToast("anchor=SET  tags=\(total)  placed=\(placed)  — look for cyan sphere at QR")
        }
    }

    /// Creates a bright cyan sphere at the anchor's world-space origin.
    /// The sphere has a slow pulse animation so it's easy to spot.
    private func placeAnchorDebugSphere(anchorTransform: simd_float4x4) {
        anchorDebugSphere?.removeFromParentNode()

        let sphere    = SCNSphere(radius: 0.05)          // 10 cm diameter
        let mat       = SCNMaterial()
        mat.diffuse.contents  = UIColor.cyan
        mat.emission.contents = UIColor.cyan.withAlphaComponent(0.7)
        mat.lightingModel     = .constant
        sphere.firstMaterial  = mat

        let node = SCNNode(geometry: sphere)
        // Position at the anchor origin (translation component of the 4×4 matrix)
        let t    = anchorTransform.columns.3
        node.simdPosition = simd_float3(t.x, t.y, t.z)

        // Gentle pulse: scale 1 → 1.4 → 1, 1.5 s period
        let pulse = SCNAction.sequence([
            SCNAction.scale(to: 1.4, duration: 0.75),
            SCNAction.scale(to: 1.0, duration: 0.75)
        ])
        node.runAction(SCNAction.repeatForever(pulse))

        arManager.sceneView.scene.rootNode.addChildNode(node)
        anchorDebugSphere = node
        print("[OperatorMode] ✓ Anchor debug sphere placed at world \(String(format:"(%.2f, %.2f, %.2f)", t.x, t.y, t.z))")
    }

    /// Shows the debug toast for 3 seconds then fades it out.
    private func showDebugToast(_ message: String) {
        debugToastMessage = message
        withAnimation { debugToastVisible = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
            withAnimation { debugToastVisible = false }
        }
    }

    private func placeTagMarkers() {
        tagMarkerNodes.values.forEach { $0.removeFromParentNode() }
        tagMarkerNodes.removeAll()

        print("[OperatorMode] placeTagMarkers — \(appState.activeTags.count) tags, anchorTransform=\(appState.anchorNormalisedTransform != nil ? "set" : "NIL")")

        for tag in appState.activeTags {
            let worldPos: simd_float3

            // Prefer anchor-relative position (session-independent)
            if let rx = metaDouble(tag.metadata["anchor_rel_x"]),
               let ry = metaDouble(tag.metadata["anchor_rel_y"]),
               let rz = metaDouble(tag.metadata["anchor_rel_z"]),
               let wp = appState.toWorldSpace(simd_float3(Float(rx), Float(ry), Float(rz))) {
                worldPos = wp
                print("[OperatorMode]   ✓ tag '\(tag.label)': anchor_rel → world \(String(format: "(%.2f, %.2f, %.2f)", wp.x, wp.y, wp.z))")
            } else if let x = metaDouble(tag.metadata["pos_x"]),
                      let y = metaDouble(tag.metadata["pos_y"]),
                      let z = metaDouble(tag.metadata["pos_z"]) {
                // Fallback: legacy world-space position stored by AddTagSheet before
                // anchor_rel was introduced.  Valid ONLY when session frames match
                // (same ARWorldMap relocalized correctly).
                worldPos = simd_float3(Float(x), Float(y), Float(z))
                print("[OperatorMode]   ⚠️ tag '\(tag.label)': no anchor_rel — using legacy pos_xyz \(String(format: "(%.2f, %.2f, %.2f)", x, y, z))")
            } else {
                let keys = tag.metadata.keys.sorted().joined(separator: ", ")
                print("[OperatorMode]   ✗ tag '\(tag.label)': no position metadata — SKIPPED. Keys: [\(keys)]")
                continue
            }

            let node = makeMarkerNode(for: tag, status: nil)
            node.simdPosition = worldPos
            node.isHidden = !showTagMarkers
            arManager.sceneView.scene.rootNode.addChildNode(node)
            tagMarkerNodes[tag.id] = node
        }
        print("[OperatorMode] placeTagMarkers done — \(tagMarkerNodes.count) nodes in scene")
    }

    /// Smoothly reposition marker nodes when the live ARImageAnchor refines
    /// the anchor pose.  Called from onChange(lockedAnchorTransform) after
    /// initial placement is complete.
    ///
    /// Cone guides are NOT rebuilt here — rebuilding during active inspection
    /// would be disruptive.  The small per-frame anchor refinements (sub-mm)
    /// do not justify cone reconstruction; only the initial placement matters.
    private func repositionTagMarkerNodes() {
        guard let anchorTransform = arManager.lockedAnchorTransform else { return }
        for tag in appState.activeTags {
            guard let node = tagMarkerNodes[tag.id],
                  let rx = metaDouble(tag.metadata["anchor_rel_x"]),
                  let ry = metaDouble(tag.metadata["anchor_rel_y"]),
                  let rz = metaDouble(tag.metadata["anchor_rel_z"])
            else { continue }
            let worldPos = ARCoordinateFrame.toWorldSpace(
                anchorRelativePos: simd_float3(Float(rx), Float(ry), Float(rz)),
                anchorTransform: anchorTransform
            )
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.15
            node.simdPosition = worldPos
            SCNTransaction.commit()
        }
    }

    private func updateMarkersForResult(_ result: AnchorValidationResult) {
        for tagResult in result.tagResults {
            guard let existingNode = tagMarkerNodes[tagResult.tagId] else { continue }
            let worldPos = existingNode.simdWorldPosition
            existingNode.removeFromParentNode()

            guard let tag = appState.activeTags.first(where: { $0.id == tagResult.tagId }) else { continue }

            let newNode = makeMarkerNode(for: tag, status: tagResult.status)
            newNode.simdPosition = worldPos
            newNode.isHidden = !showTagMarkers
            arManager.sceneView.scene.rootNode.addChildNode(newNode)
            tagMarkerNodes[tagResult.tagId] = newNode

            // Pulse red markers to draw attention
            if tagResult.status == .fail {
                newNode.runAction(.repeatForever(.sequence([
                    .scale(to: 1.35, duration: 0.45),
                    .scale(to: 1.00, duration: 0.45),
                ])))
            }
        }
    }

    // ── #84: tag tap → expand/collapse info card ──────────────────────────────

    /// Hit-tests `location` (in `arManager.sceneView`'s coordinate space)
    /// against the live 3D tag markers. Tapping a tag's marker toggles its
    /// expanded info card; tapping a different tag's marker switches to it;
    /// tapping empty space collapses whatever's currently expanded.
    private func handleMarkerTap(at location: CGPoint) {
        let hits = arManager.sceneView.hitTest(location, options: [.searchMode: SCNHitTestSearchMode.all.rawValue])
        for hit in hits {
            var candidate: SCNNode? = hit.node
            while let node = candidate {
                if let tagId = tagMarkerNodes.first(where: { $0.value === node })?.key {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        expandedTagId = (expandedTagId == tagId) ? nil : tagId
                    }
                    return
                }
                candidate = node.parent
            }
        }
        if expandedTagId != nil {
            withAnimation(.easeOut(duration: 0.2)) { expandedTagId = nil }
        }
    }

    // ── #88: distance-based marker scaling ────────────────────────────────────

    /// Linearly interpolates marker scale between `markerMinScale` (at/below
    /// `markerMinScaleDist`) and 1.0 (at/above `markerFullScaleDist`).
    private func markerScale(forDistance dist: Float) -> CGFloat {
        guard dist < markerFullScaleDist else { return 1.0 }
        guard dist > markerMinScaleDist else { return markerMinScale }
        let t = (dist - markerMinScaleDist) / (markerFullScaleDist - markerMinScaleDist)
        return markerMinScale + (1.0 - markerMinScale) * CGFloat(t)
    }

    // ── AR marker factory ─────────────────────────────────────────────────────

    /// Returns the UIColor for a tag type — used to colour uninspected markers so
    /// each type is visually distinct before inspection results arrive.
    private func uiColor(for type: TagType) -> UIColor {
        switch type {
        case .inspectionPoint:    return .systemBlue
        case .defect:             return .systemRed
        case .instruction:        return .systemPurple
        case .warning:            return .systemOrange
        case .measurement:        return .systemCyan
        case .presenceCheck:      return .systemGreen
        case .languageCheck:      return .systemIndigo
        case .routingCheck:       return .systemYellow
        case .configurationCheck: return .systemGray
        case .partCheck:          return .systemMint
        }
    }

    /// Builds a root SCNNode containing a coloured sphere + floating label billboard.
    /// When `status` is nil (not yet inspected), the sphere and accent bar are
    /// coloured by tag type so operators can identify them at a glance in AR.
    private func makeMarkerNode(for tag: Tag, status: ValidationStatus?) -> SCNNode {
        let root  = SCNNode()
        root.name = tag.id   // #88: lets distance-scaling identify the root by name
        let label = tag.label

        // Sphere colour: result-driven when inspected, type-driven when not
        let color: UIColor
        switch status {
        case .pass:    color = .systemGreen
        case .fail:    color = .systemRed
        case .pending: color = .systemGray
        case nil:      color = uiColor(for: tag.type)
        }

        // ── Ring marker — 2.5× larger than original for easy visibility ─────────
        // Torus ring (3.5 cm radius) + inner glow dot (1.5 cm radius).
        // At 2 m the ring subtends ~2° — clearly visible without squinting.
        let ring    = SCNTorus(ringRadius: 0.035, pipeRadius: 0.010)
        let ringMat = SCNMaterial()
        ringMat.diffuse.contents  = color
        ringMat.emission.contents = color.withAlphaComponent(0.65)
        ringMat.lightingModel     = .constant
        ring.firstMaterial        = ringMat
        let ringNode = SCNNode(geometry: ring)
        ringNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)  // face camera (lie flat)
        root.addChildNode(ringNode)

        let dot    = SCNSphere(radius: 0.015)
        let dotMat = SCNMaterial()
        dotMat.diffuse.contents  = color
        dotMat.emission.contents = color.withAlphaComponent(0.9)
        dotMat.lightingModel     = .constant
        dot.firstMaterial        = dotMat
        root.addChildNode(SCNNode(geometry: dot))

        // Floating label — positioned above ring, always faces camera.
        // Accent bar uses the type color when uninspected so labels are visually
        // distinct before results arrive, and switches to the result color after.
        let accentColor = status == nil ? uiColor(for: tag.type) : color
        let labelNode = makeLabelNode(text: label, color: accentColor)
        labelNode.position = SCNVector3(0, 0.065, 0)   // 6.5 cm above centre
        root.addChildNode(labelNode)

        return root
    }

    /// Renders tag name as a UIImage pill → SCNPlane texture with billboard constraint.
    /// #84: slightly smaller than before (was 4.4 cm) — the pill is now a
    /// compact "collapsed" label by design; full details live in the
    /// tap-to-expand SwiftUI card instead of being crammed into the 3D pill.
    private func makeLabelNode(text: String, color: UIColor) -> SCNNode {
        let image  = makeLabelImage(text, accentColor: color)
        let aspect = image.size.width / image.size.height
        let height: CGFloat = 0.036                    // 3.6 cm tall in world space
        let width  = height * aspect

        let plane = SCNPlane(width: width, height: height)
        let pMat  = SCNMaterial()
        pMat.diffuse.contents  = image
        pMat.isDoubleSided     = true
        pMat.lightingModel     = .constant             // unlit — always legible
        plane.materials        = [pMat]

        let node = SCNNode(geometry: plane)
        node.constraints = [SCNBillboardConstraint()]  // always faces camera
        return node
    }

    /// Draws a dark pill with the tag label text, a status-coloured left bar,
    /// and a small chevron on the right (#84) — a visible cue that the label
    /// is tappable, since the interaction itself (tap to expand) isn't
    /// otherwise discoverable on a 3D AR marker.
    private func makeLabelImage(_ text: String, accentColor: UIColor) -> UIImage {
        let displayText = text.count > 16 ? String(text.prefix(15)) + "…" : text
        let font  = UIFont.boldSystemFont(ofSize: 26)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
        let textSize = (displayText as NSString).size(withAttributes: attrs)

        let hPad: CGFloat = 14
        let vPad: CGFloat = 9
        let barW: CGFloat = 5
        let chevronW: CGFloat = 22   // reserved width for the tappable-affordance chevron
        let size = CGSize(
            width:  textSize.width + hPad * 2 + barW + 6 + chevronW,
            height: textSize.height + vPad * 2
        )

        UIGraphicsBeginImageContextWithOptions(size, false, 2.0)
        defer { UIGraphicsEndImageContext() }
        guard let ctx = UIGraphicsGetCurrentContext() else { return UIImage() }

        let rect = CGRect(origin: .zero, size: size)
        let corner = size.height / 2

        // Dark background pill
        ctx.setFillColor(UIColor.black.withAlphaComponent(0.78).cgColor)
        UIBezierPath(roundedRect: rect, cornerRadius: corner).fill()

        // Coloured accent bar on left
        ctx.setFillColor(accentColor.withAlphaComponent(0.9).cgColor)
        UIBezierPath(
            roundedRect: CGRect(x: 0, y: 0, width: barW, height: size.height),
            byRoundingCorners: [.topLeft, .bottomLeft],
            cornerRadii: CGSize(width: corner, height: corner)
        ).fill()

        // Label text
        (displayText as NSString).draw(
            at: CGPoint(x: barW + hPad, y: vPad),
            withAttributes: attrs
        )

        // Tappable-affordance chevron (small downward "v") on the right
        let chevronCenterX = size.width - chevronW / 2 - 2
        let chevronCenterY = size.height / 2
        let chevronHalfW: CGFloat = 6
        let chevronH: CGFloat = 5
        let chevron = UIBezierPath()
        chevron.move(to: CGPoint(x: chevronCenterX - chevronHalfW, y: chevronCenterY - chevronH / 2))
        chevron.addLine(to: CGPoint(x: chevronCenterX, y: chevronCenterY + chevronH / 2))
        chevron.addLine(to: CGPoint(x: chevronCenterX + chevronHalfW, y: chevronCenterY - chevronH / 2))
        chevron.lineWidth = 2.5
        chevron.lineCapStyle = .round
        chevron.lineJoinStyle = .round
        UIColor.white.withAlphaComponent(0.75).setStroke()
        chevron.stroke()

        return UIGraphicsGetImageFromCurrentImageContext() ?? UIImage()
    }

    // ── Raw camera capture (zero AR artifacts) ───────────────────────────────
    //
    // `sceneView.snapshot()` renders the *composited* AR scene — camera feed
    // PLUS every visible SceneKit overlay (cone guide mesh, glow rings, tag
    // marker spheres). Training (ConeCaptureView) deliberately avoids this:
    // it captures `ARFrame.capturedImage` directly and hides the cone guide
    // first, so the stored reference images are "zero AR artifacts" raw
    // camera frames. Validation was comparing those clean references against
    // live snapshots that still had the cone/markers baked into the pixels —
    // which can tank SSIM/feature-print scores regardless of how well the
    // Operator is actually positioned. Mirror the training capture path here
    // so live and reference images are visually comparable.
    private func captureRawCamera(from frame: ARFrame) -> UIImage? {
        let ci       = CIImage(cvPixelBuffer: frame.capturedImage)
        let oriented = ci.oriented(.right)  // sensor is always landscape-right
        let ctx      = CIContext(options: [.useSoftwareRenderer: false])
        guard let cg = ctx.createCGImage(oriented, from: oriented.extent) else { return nil }
        let full = UIImage(cgImage: cg)
        return downsample(full, maxDimension: 800)
    }

    /// Scales `image` so neither dimension exceeds `maxDimension`.
    /// Returns the original image unchanged if it already fits.
    private func downsample(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let w = image.size.width, h = image.size.height
        let longestSide = max(w, h)
        guard longestSide > maxDimension else { return image }
        let scale   = maxDimension / longestSide
        let newSize = CGSize(width:  (w * scale).rounded(),
                             height: (h * scale).rounded())
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    // ── Validation ────────────────────────────────────────────────────────────

    private func runValidation() async {
        phase         = .validating
        validateError = nil
        validationStage = "Capturing frame…"

        guard let captureFrame = arManager.sceneView.session.currentFrame,
              let snapshot     = captureRawCamera(from: captureFrame)
        else { phase = .idle; return }
        guard let jpeg   = snapshot.jpegData(compressionQuality: 0.80),
              let anchor = appState.activeAnchor
        else { phase = .idle; return }

        // Shutter flash + haptic
        flashOpacity = 0.55
        withAnimation(.easeOut(duration: 0.30)) { flashOpacity = 0 }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

        let client = SIBClient(settings: settings)

        let session: SIBSession
        if let existing = appState.activeSession {
            session = existing
        } else {
            do {
                validationStage = "Starting session…"
                session = try await client.createSession(userId: "operator",
                                                          assetId: anchor.assetId)
                appState.activeSession = session
            } catch {
                if Task.isCancelled { phase = .idle; return } // #73: user-cancelled, not an error
                validateError = "Session error: \(friendlyMessage(for: error))"
                phase = .idle
                return
            }
        }

        // Phase 2.5: pass the anchor's AES-256-GCM key so SIB can decrypt stored
        // pass-state images in-memory during SSIM comparison.
        let encKey = appState.anchorEncryptionKey.map { AnchorEncryption.base64(for: $0) }

        let req = BatchValidateRequest(
            anchorId:      anchor.id,
            assetId:       anchor.assetId,
            sessionId:     session.id,
            imageBase64:   jpeg.base64EncodedString(),
            mimeType:      "image/jpeg",
            threshold:     passThreshold,
            tagIds:        reInspectTagIds,
            encryptionKey: encKey
        )

        // Begin debug log session (records per-tag metric breakdowns for export)
        if let anchor = appState.activeAnchor {
            InspectionDebugLog.shared.beginSession(
                sessionId: session.id,
                anchorId:  anchor.id,
                assetId:   anchor.assetId)
        }

        // Reuse the exact frame the snapshot was captured from (rather than
        // re-querying session.currentFrame here) so the alignment angle
        // reflects precisely where the operator was standing when the image
        // was taken, not some slightly-later frame.
        let currentFrame = captureFrame

        do {
            validationStage = "Uploading & comparing…"
            var result = try await client.validateAll(req)
            if Task.isCancelled { phase = .idle; return }

            // ── Cone + depth validation (cone-trained tags) ───────────────────
            // Applies alignment factor and depth similarity score.
            // Must run with the frame captured BEFORE the async SIB round-trip
            // so alignment angle reflects where the operator was standing.
            validationStage = "Checking alignment…"
            result = applyConeAndDepthValidation(to: result,
                                                 snapshot: snapshot,
                                                 frame: currentFrame)

            // ── Feature print validation (primary metric) ─────────────────────
            // For all visual tags — overrides SSIM if FP score is higher.
            validationStage = "Scoring features…"
            result = await applyFeaturePrintValidation(to: result, snapshot: snapshot)

            // ── OCR validation for languageCheck tags ─────────────────────────
            validationStage = "Reading text…"
            result = await applyOCRValidation(to: result, jpeg: jpeg)

            appState.lastValidationResult = result

            // ── Debug log ─────────────────────────────────────────────────────
            InspectionDebugLog.shared.finish(
                overallStatus: result.status.rawValue.uppercased())

            // Update AR markers with PASS/FAIL colours before showing summary
            updateMarkersForResult(result)

            UINotificationFeedbackGenerator()
                .notificationOccurred(result.status == .pass ? .success : .error)
            phase = .reviewing

        } catch is CancellationError {
            phase = .idle // #73: user tapped Cancel — not an error, no toast needed
        } catch {
            if Task.isCancelled { phase = .idle; return } // URLError(.cancelled) from a cancelled Task
            validateError = friendlyMessage(for: error)
            phase = .idle
        }
    }

    // ── Cone guide placement ──────────────────────────────────────────────────

    /// Build a read-only ConeARGuide for each cone-trained tag.
    /// Called on appear and when a new anchor is locked.
    /// Multi-anchor: when multiple anchors are supported, iterate appState.activeTags
    /// grouped by anchorId and use the correct locked transform for each group.
    private func buildConeGuides() {
        guard let anchorTransform = appState.anchorNormalisedTransform else { return }
        coneGuides.values.forEach { $0.cleanup() }
        coneGuides.removeAll()

        for tag in appState.activeTags where tag.type.captureMode == .cone {
            // ── Require cone quaternion ───────────────────────────────────────
            guard
                let qxAny = tag.metadata["cone_qx"], let qyAny = tag.metadata["cone_qy"],
                let qzAny = tag.metadata["cone_qz"], let qwAny = tag.metadata["cone_qw"],
                let qx = metaDouble(qxAny), let qy = metaDouble(qyAny),
                let qz = metaDouble(qzAny), let qw = metaDouble(qwAny)
            else { continue }

            // ── Resolve tag world position: anchor_rel preferred, pos_xyz fallback ─
            // anchor_rel_x/y/z is session-independent (stored relative to gravity-
            // aligned anchor frame) — always use this when available.
            // Legacy pos_x/y/z is the session-frame world position saved by older
            // Author sessions.  Converting via toAnchorRelative here gives the right
            // anchor-frame position IF the world frames match (same session or same
            // ARWorldMap relocated correctly) — which is the case when the user just
            // came through QRScanGateView with a successfully loaded WorldMap.
            let tagWorldPos: simd_float3
            if let rx = metaDouble(tag.metadata["anchor_rel_x"]),
               let ry = metaDouble(tag.metadata["anchor_rel_y"]),
               let rz = metaDouble(tag.metadata["anchor_rel_z"]) {
                tagWorldPos = ARCoordinateFrame.toWorldSpace(
                    anchorRelativePos: simd_float3(Float(rx), Float(ry), Float(rz)),
                    anchorTransform: anchorTransform)
            } else if let px = metaDouble(tag.metadata["pos_x"]),
                      let py = metaDouble(tag.metadata["pos_y"]),
                      let pz = metaDouble(tag.metadata["pos_z"]) {
                // Legacy fallback — use stored world-space position directly.
                // Valid only when session world frames match.
                tagWorldPos = simd_float3(Float(px), Float(py), Float(pz))
                print("[OperatorMode] buildConeGuides '\(tag.label)': using pos_xyz fallback (no anchor_rel)")
            } else {
                print("[OperatorMode] buildConeGuides '\(tag.label)': SKIPPED — no position metadata")
                continue
            }

            let storedQuat = simd_quatf(ix: Float(qx), iy: Float(qy),
                                         iz: Float(qz),  r:  Float(qw))

            let guide = ConeARGuide(
                sceneView: arManager.sceneView,
                tagWorldPosition: tagWorldPos,
                anchorRelativeQuat: storedQuat,
                anchorTransform: anchorTransform)
            coneGuides[tag.id] = guide
        }
    }

    // ── Cone + depth alignment validation ────────────────────────────────────

    /// For each cone-trained tag:
    ///  1. Compute alignment angle between camera and stored cone direction.
    ///  2. Apply alignment factor to the current score:
    ///       adjustedScore = currentScore × alignmentFactor
    ///       alignmentFactor = clamp(1 − angle / 90°, 0, 1)
    ///  3. Add depth comparison score (if depth map stored) weighted at 0.4.
    ///
    /// This rewards being in the correct inspection zone and penalises
    /// off-angle captures, making pass/fail results far more reliable.
    private func applyConeAndDepthValidation(
        to result: AnchorValidationResult,
        snapshot: UIImage,
        frame: ARFrame
    ) -> AnchorValidationResult {

        var patched = result

        for i in patched.tagResults.indices {
            let tr = patched.tagResults[i]
            guard tr.status != .pending else { continue }
            guard let tag = appState.activeTags.first(where: { $0.id == tr.tagId }),
                  tag.type.captureMode == .cone else { continue }

            // When the Author also trained a Fail-state, the SIB has already
            // made a relative nearest-match PASS/FAIL decision (compareDualState)
            // that's more reliable than this client-side absolute-threshold
            // alignment/depth blend — applying that blend here could flip an
            // already-correct dual-state result. Leave those tags untouched.
            if tag.hasFailState == true { continue }

            var score = tr.confidence

            // ── Alignment factor ──────────────────────────────────────────────
            let alignFactor: Double
            if let guide = coneGuides[tr.tagId],
               let currentFrame = arManager.sceneView.session.currentFrame {
                let angleDeg = guide.alignmentAngle(cameraTransform: currentFrame.camera.transform)
                alignFactor  = Double(max(0, 1 - angleDeg / 90))
                print("[ConeValidation] tag=\(tr.tagLabel) angle=\(String(format:"%.1f",angleDeg))° factor=\(String(format:"%.2f",alignFactor))")
            } else {
                alignFactor = 1.0   // no guide available — apply no penalty
            }
            score = score * alignFactor

            // ── Depth comparison ──────────────────────────────────────────────
            if let depthB64 = metaDouble(tag.metadata["cone_depth_width"]).flatMap({ w -> String? in
                guard let h = metaDouble(tag.metadata["cone_depth_height"]),
                      let b = (tag.metadata["cone_depth_map"]?.value as? String),
                      let lidar = tag.metadata["cone_depth_is_lidar"]?.value as? Bool
                else { return nil }
                return b
            }) {
                // Reconstruct stored depth and compare with live depth
                if let liveDepth = DepthCapture.capture(from: frame),
                   let wAny = metaDouble(tag.metadata["cone_depth_width"]),
                   let hAny = metaDouble(tag.metadata["cone_depth_height"]),
                   let lidar = tag.metadata["cone_depth_is_lidar"]?.value as? Bool,
                   let storedDepth = DepthCapture(base64: depthB64,
                                                  width: Int(wAny), height: Int(hAny),
                                                  isLiDAR: lidar) {
                    let depthScore = storedDepth.similarity(to: liveDepth)
                    // Weighted blend: 60% feature-print/SSIM, 40% depth
                    score = 0.60 * score + 0.40 * depthScore
                    print("[ConeValidation] tag=\(tr.tagLabel) depthScore=\(String(format:"%.3f",depthScore)) blended=\(String(format:"%.3f",score)) lidar=\(lidar)")
                }
            }

            if score != tr.confidence {
                patched.tagResults[i].confidence = score
                patched.tagResults[i].status     = score >= passThreshold ? .pass : .fail
            }
        }

        // Recompute aggregates
        let passes  = patched.tagResults.filter { $0.status == .pass    }.count
        let fails   = patched.tagResults.filter { $0.status == .fail    }.count
        let pending = patched.tagResults.filter { $0.status == .pending }.count
        patched.passCount = passes
        patched.failCount = fails
        patched.status = fails == 0 && pending == 0 ? .pass
                       : passes == 0 && pending == 0 ? .fail
                       : pending == patched.totalCount ? .pending
                       : .partial
        return patched
    }

    // ── Feature print validation ──────────────────────────────────────────────

    /// Extracts a VNGenerateImageFeaturePrint embedding from the live snapshot and
    /// compares it against the 7 stored reference prints in each tag's metadata.
    /// Overrides the SIB SSIM score when the feature print score is higher —
    /// giving the Operator credit for being at the right location even when they're
    /// not at an exact training viewpoint position.
    private func applyFeaturePrintValidation(
        to result: AnchorValidationResult,
        snapshot: UIImage
    ) async -> AnchorValidationResult {

        // Extract full-frame live feature print (used by most tag types)
        let livePrint = await TagFeaturePrint.extract(from: snapshot)

        // Live camera frame — used below to normalise the PartCheck crop fraction
        // for the Operator's actual standing distance vs the distance trained at.
        let liveFrame = arManager.sceneView.session.currentFrame

        if livePrint == nil {
            print("[FeaturePrint] Could not extract live full-frame feature print")
        }

        var patched = result

        for i in patched.tagResults.indices {
            let tr = patched.tagResults[i]
            guard tr.status != .pending else { continue }
            guard let tag = appState.activeTags.first(where: { $0.id == tr.tagId }) else { continue }

            // When a Fail-state was trained, the SIB's relative nearest-match
            // decision (compareDualState) is already authoritative for this
            // tag — don't let an absolute-threshold feature-print comparison
            // override it.
            if tag.hasFailState == true { continue }

            // ── Optional inspection-region crop ─────────────────────────────────
            // When the Author marked a ROI for this tag, feature prints should
            // be extracted from just that region — not the whole frame — so
            // the comparison focuses on the specific feature being inspected
            // (matches the server's ROI-aware SSIM/histogram cropping).
            let liveForTag: UIImage = tag.roi.map { cropToROI(snapshot, roi: $0) } ?? snapshot
            let livePrintForTag: TagFeaturePrint? = tag.roi == nil
                ? livePrint
                : await TagFeaturePrint.extract(from: liveForTag)

            // ── PartCheck: center-crop comparison (part presence / absence) ────
            // If the tag was trained with part_check_center_fps (stored during
            // ConeCaptureView training for .partCheck type), run a dedicated
            // comparison on the center-cropped inspection image.
            //
            // Why: a missing PS5 controller leaves only the couch surface in the
            // center of frame.  Full-frame SSIM / feature prints can still score
            // high because the background fills most of the image.  But the center
            // crop at the right inspection distance is filled by the part itself —
            // so its absence changes the crop dramatically.
            if tag.type == .partCheck,
               let ccAny = tag.metadata["part_check_center_fps"],
               let ccArray = ccAny.value as? [Any],
               !ccArray.isEmpty {

                // ── Distance-normalised crop fraction ───────────────────────
                // Training always crops a fixed 50 % × 50 % center region, but
                // that 50 % was only "correct" at the distance the Operator was
                // standing at during training (cone_dist_m). Apparent object
                // size scales ~ 1/distance, so if the live Operator is farther
                // away than training, the part now occupies a SMALLER fraction
                // of the frame — comparing against a fixed 50 % crop pulls in
                // extra background and tanks the score. Scale the crop fraction
                // by (trainingDistance / liveDistance) so the crop always
                // isolates roughly the same real-world region regardless of
                // exactly where the Operator is standing.
                // An explicit Author-marked ROI is a more precise region than the
                // distance-normalised heuristic crop below — prefer it when present.
                let cropSnapshot: UIImage
                var trainingDist: Float = metaFloat(tag.metadata, key: "cone_dist_m") ?? 0.30
                var liveDist: Float = trainingDist
                var adjustedFraction: CGFloat = 0.50
                if let roi = tag.roi {
                    cropSnapshot = cropToROI(snapshot, roi: roi)
                } else {
                    liveDist     = liveDistance(toTag: tag.id, frame: liveFrame) ?? trainingDist
                    let rawFraction  = 0.50 * (trainingDist / max(liveDist, 0.05))
                    adjustedFraction = CGFloat(min(0.85, max(0.15, rawFraction)))
                    cropSnapshot = centerCrop(of: snapshot, fraction: adjustedFraction)
                }
                guard let cropPrint = await TagFeaturePrint.extract(from: cropSnapshot) else {
                    print("[FeaturePrint][PartCheck] tag=\(tr.tagLabel) could not extract crop print — skipping")
                    continue
                }

                let ccRefs: [TagFeaturePrint] = ccArray.compactMap { item in
                    guard let s = item as? String else { return nil }
                    return TagFeaturePrint(base64: s)
                }

                if !ccRefs.isEmpty {
                    // Use per-tag calibrated ceiling if stored during training.
                    let ccMaxDist = metaFloat(tag.metadata, key: "part_check_fp_max_dist")
                    let ccScore   = TagFeaturePrint.bestScore(live: cropPrint, references: ccRefs,
                                                              maxDist: ccMaxDist)
                    print("[FeaturePrint][PartCheck] tag=\(tr.tagLabel) " +
                          "center_crop=\(String(format:"%.3f", ccScore)) " +
                          "ssim=\(String(format:"%.3f", tr.confidence)) " +
                          "cc_max_dist=\(ccMaxDist.map { String(format:"%.3f", $0) } ?? "global") " +
                          "train_dist=\(String(format:"%.2f", trainingDist))m " +
                          "live_dist=\(String(format:"%.2f", liveDist))m " +
                          "crop_frac=\(String(format:"%.2f", Double(adjustedFraction)))")

                    // For PartCheck the center-crop score IS the authoritative metric.
                    // It overrides SSIM in both directions: a high score means
                    // the part is present; a low score means it's absent (FAIL).
                    patched.tagResults[i].confidence = ccScore
                    patched.tagResults[i].status     = ccScore >= passThreshold ? .pass : .fail
                    continue   // skip full-frame comparison for this tag
                }
            }

            // ── Standard full-frame feature print comparison (all other types) ─
            // Uses the ROI-cropped print (computed above) when this tag has a
            // marked inspection region; otherwise the shared full-frame print.
            guard let live = livePrintForTag else { continue }

            guard let fpAny = tag.metadata["feature_prints"],
                  let fpArray = fpAny.value as? [Any],
                  !fpArray.isEmpty
            else { continue }

            let refs: [TagFeaturePrint] = fpArray.compactMap { item in
                guard let s = item as? String else { return nil }
                return TagFeaturePrint(base64: s)
            }
            guard !refs.isEmpty else { continue }

            // Use per-tag calibrated ceiling if stored during training.
            let tagMaxDist = metaFloat(tag.metadata, key: "fp_max_dist")
            let fpScore    = TagFeaturePrint.bestScore(live: live, references: refs,
                                                       maxDist: tagMaxDist)

            print("[FeaturePrint] tag=\(tr.tagLabel) " +
                  "fp=\(String(format:"%.3f", fpScore)) " +
                  "ssim=\(String(format:"%.3f", tr.confidence)) " +
                  "max_dist=\(tagMaxDist.map { String(format:"%.3f", $0) } ?? "global")")

            // Use the better of the two scores — SSIM works well when angle matches,
            // feature print works well when it doesn't
            guard fpScore > tr.confidence else { continue }

            patched.tagResults[i].confidence = fpScore
            patched.tagResults[i].status     = fpScore >= passThreshold ? .pass : .fail
        }

        // Recompute aggregate counts
        let passes  = patched.tagResults.filter { $0.status == .pass    }.count
        let fails   = patched.tagResults.filter { $0.status == .fail    }.count
        let pending = patched.tagResults.filter { $0.status == .pending }.count
        patched.passCount = passes
        patched.failCount = fails
        patched.status = fails == 0 && pending == 0 ? .pass
                       : passes == 0 && pending == 0 ? .fail
                       : pending == patched.totalCount ? .pending
                       : .partial
        return patched
    }

    /// Live straight-line distance (meters) from the current camera position to
    /// a tag's AR marker, used to normalise the PartCheck center-crop fraction.
    /// Mirrors the cam/markerNode distance computation already used in
    /// `tickProximity()`. `coneGuides[tagId].currentDistanceM` is NOT used here
    /// because Operator-mode cone guides are constructed locked (`isLocked = true`)
    /// and never receive `updateForCamera` calls, so that property stays frozen
    /// at its default 0.30 — it would silently defeat this normalisation.
    private func liveDistance(toTag tagId: String, frame: ARFrame?) -> Float? {
        guard let frame = frame, let markerNode = tagMarkerNodes[tagId] else { return nil }
        let cam = simd_float3(frame.camera.transform.columns.3.x,
                               frame.camera.transform.columns.3.y,
                               frame.camera.transform.columns.3.z)
        return simd_length(cam - markerNode.simdWorldPosition)
    }

    // #74: the server pads an Author-drawn ROI by 10% of the ROI's own
    // width/height on every side before cropping (image-comparator.ts,
    // ROI_PADDING_FRAC), so a live frame that's slightly rotated/shifted/
    // closer than the trained reference doesn't clip the part right at the
    // ROI edge. This client-side crop was NOT applying that same padding —
    // a real drift between what feeds client-side feature-print extraction
    // and what feeds the server's SSIM/histogram scoring for the same tag.
    // Keep this constant numerically identical to ROI_PADDING_FRAC in
    // sib/src/perception/image-comparator.ts if either ever changes.
    private let roiPaddingFrac: CGFloat = 0.10

    /// Crops `image` to an Author-marked RegionOfInterest — normalised
    /// (0.0–1.0) fractions of the image's width/height, origin top-left —
    /// padded by `roiPaddingFrac` exactly as the server does. Mirrors the
    /// server's ROI cropping in image-comparator.ts so client-side
    /// feature-print extraction stays consistent with the server's SSIM/
    /// histogram scoring for the same tag.
    private func cropToROI(_ image: UIImage, roi: RegionOfInterest) -> UIImage {
        let size = image.size
        let padW = CGFloat(roi.w) * size.width  * roiPaddingFrac
        let padH = CGFloat(roi.h) * size.height * roiPaddingFrac

        let x1 = max(0, CGFloat(roi.x) * size.width  - padW)
        let y1 = max(0, CGFloat(roi.y) * size.height - padH)
        let x2 = min(size.width,  CGFloat(roi.x + roi.w) * size.width  + padW)
        let y2 = min(size.height, CGFloat(roi.y + roi.h) * size.height + padH)

        let cropX = x1
        let cropY = y1
        let cropW = max(1, x2 - x1)
        let cropH = max(1, y2 - y1)
        let rect  = CGRect(x: cropX * image.scale, y: cropY * image.scale,
                           width: cropW * image.scale, height: cropH * image.scale)
        guard let cgImage = image.cgImage, let cropped = cgImage.cropping(to: rect) else { return image }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }

    /// Returns a center-cropped UIImage at `fraction` × `fraction` of the original
    /// (e.g. fraction 0.50 gives the middle 50 % × 50 % region).
    private func centerCrop(of image: UIImage, fraction: CGFloat) -> UIImage {
        let size   = image.size
        let cropW  = size.width  * fraction
        let cropH  = size.height * fraction
        let cropX  = (size.width  - cropW) / 2
        let cropY  = (size.height - cropH) / 2
        let rect   = CGRect(x: cropX * image.scale, y: cropY * image.scale,
                            width: cropW * image.scale, height: cropH * image.scale)

        guard let cgImage = image.cgImage,
              let cropped  = cgImage.cropping(to: rect)
        else { return image }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }

    // ── OCR validation ────────────────────────────────────────────────────────

    /// Runs on-device Vision OCR on `jpeg` and patches the SIB result for any
    /// languageCheck tag whose expectedOutcome text is a keyword-subset of the
    /// detected text.  Only overrides if OCR confidence > SSIM confidence.
    private func applyOCRValidation(to result: AnchorValidationResult,
                                    jpeg: Data) async -> AnchorValidationResult {
        // Collect languageCheck tags that have stored expected text
        let ocrTags = appState.activeTags.filter {
            $0.type.usesOCR &&
            !($0.expectedOutcome.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        guard !ocrTags.isEmpty else { return result }
        guard let uiImage = UIImage(data: jpeg), let cgImage = uiImage.cgImage else { return result }

        // Run Vision OCR — accurate mode, language correction on
        let detected: String = await withCheckedContinuation { cont in
            let req = VNRecognizeTextRequest { r, _ in
                let obs  = r.results as? [VNRecognizedTextObservation] ?? []
                let text = obs.sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
                              .compactMap { $0.topCandidates(1).first?.string }
                              .joined(separator: " ")
                cont.resume(returning: text)
            }
            req.recognitionLevel       = .accurate
            req.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do    { try handler.perform([req]) }
            catch { cont.resume(returning: "") }
        }

        print("[OCR] Detected text: \"\(detected)\"")

        // Patch tagResults
        var patched = result
        for i in patched.tagResults.indices {
            let tr = patched.tagResults[i]
            guard let tag = ocrTags.first(where: { $0.id == tr.tagId }) else { continue }
            let expected  = tag.expectedOutcome.trimmingCharacters(in: .whitespaces)
            guard !expected.isEmpty else { continue }

            // Dual-state tags already have an authoritative SIB decision —
            // don't let an absolute-threshold OCR score override it.
            if tag.hasFailState == true { continue }

            let ocrScore = textMatchScore(expected: expected, detected: detected)
            print("[OCR] tag=\(tr.tagLabel) expected=\"\(expected)\" ocrScore=\(String(format:"%.2f",ocrScore)) ssim=\(String(format:"%.2f",tr.confidence))")

            guard ocrScore > tr.confidence else { continue }
            patched.tagResults[i].confidence = ocrScore
            patched.tagResults[i].status     = ocrScore >= passThreshold ? .pass : .fail
        }

        // Recompute aggregate totals
        let passes  = patched.tagResults.filter { $0.status == .pass    }.count
        let fails   = patched.tagResults.filter { $0.status == .fail    }.count
        let pending = patched.tagResults.filter { $0.status == .pending }.count
        patched.passCount = passes
        patched.failCount = fails
        patched.status = fails == 0 && pending == 0 ? .pass
                       : passes == 0 && pending == 0 ? .fail
                       : pending == patched.totalCount ? .pending
                       : .partial
        return patched
    }

    /// Keyword presence score: fraction of expected words found in detected text.
    /// Case-insensitive, substring match (handles plurals and partial words).
    private func textMatchScore(expected: String, detected: String) -> Double {
        let words = expected
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { $0.count >= 2 }           // skip 1-char noise words
        guard !words.isEmpty else { return 0 }
        let detectedLower = detected.lowercased()
        let matched = words.filter { detectedLower.contains($0) }.count
        return Double(matched) / Double(words.count)
    }

    // ── Phase 4: Sheet callbacks ──────────────────────────────────────────────

    /// Called when the operator taps "Re-inspect" in the Tag Inspected sheet.
    /// Dismisses the sheet and restarts the live validation loop for that tag.
    private func handleReInspectFromSheet(tagId: String) {
        showTagInspectedSheet = false
        sheetTagId = nil; sheetImage = nil; sheetStatus = nil
        failTimerTask?.cancel()
        failTimerTask = nil
        // Reset to validating so tickProximity re-starts the loop on next tick
        tagInspectionStates[tagId] = .validating
        statusStreak.removeValue(forKey: tagId)   // clear hysteresis for a clean restart
    }

    /// Called when the operator taps "Tag Inspected" — finalises evidence upload.
    private func handleConfirmFromSheet(tagId: String, status: ValidationStatus, note: String?) {
        showTagInspectedSheet = false
        sheetTagId = nil; sheetImage = nil; sheetStatus = nil
        failTimerTask?.cancel()
        failTimerTask = nil

        // Set the final confirmed state
        tagInspectionStates[tagId] = status == .pass ? .inspectedPass : .inspectedFail
        if let note { tagInspectionNotes[tagId] = note }

        // Save evidence image to the device photo library
        if let img = tagInspectionImages[tagId] {
            saveImageToPhotoLibrary(img)
        }

        // Upload evidence image to SIB in the background
        guard let img = tagInspectionImages[tagId],
              let jpeg = img.jpegData(compressionQuality: 0.80),
              let anchor  = appState.activeAnchor,
              let session = appState.activeSession else { return }

        let capturedAt = ISO8601DateFormatter().string(from: Date())
        let req = UploadEvidenceRequest(
            anchorId:    anchor.id,
            imageBase64: jpeg.base64EncodedString(),
            capturedAt:  capturedAt
        )
        let capturedTagId = tagId
        Task {
            do {
                let resp = try await SIBClient(settings: settings)
                    .uploadEvidence(sessionId: session.id, tagId: capturedTagId, request: req)
                tagImagePaths[capturedTagId] = resp.imagePath
                print("[TagInspected] Evidence uploaded: \(resp.imagePath)")
            } catch {
                print("[TagInspected] Evidence upload failed for \(capturedTagId): \(error.localizedDescription)")
            }
        }
    }

    /// Builds and submits the Phase 4 inspection report to SIB (fire-and-forget).
    /// Called when the operator taps "End Inspection".
    private func submitSessionReport() {
        guard let anchor  = appState.activeAnchor,
              let session = appState.activeSession else { return }

        let endTime  = Date()
        let duration = endTime.timeIntervalSince(sessionStartTime)

        // Use the guided tour owner name if available, else fall back to userId
        let ownerName = tour.ownerName != "there" ? tour.ownerName : session.userId

        let tagRecords: [TagInspectionRecord] = appState.activeTags.map { tag in
            let state = tagInspectionStates[tag.id] ?? .notVisited
            let inspStatus: TagInspectionStatus = {
                switch state {
                case .inspectedPass: return .pass
                case .inspectedFail: return .fail
                default:             return .notVisited
                }
            }()
            return TagInspectionRecord(
                tagId:          tag.id,
                tagLabel:       tag.label,
                status:         inspStatus,
                note:           tagInspectionNotes[tag.id],
                imagePath:      tagImagePaths[tag.id],
                fixedInSession: tagFixedInSession[tag.id] ?? false
            )
        }

        let failCount  = tagRecords.filter { $0.status == .fail }.count
        let passCount  = tagRecords.filter { $0.status == .pass }.count
        let overall: TagInspectionStatus = failCount > 0 ? .fail : (passCount > 0 ? .pass : .notVisited)

        let report = SubmitReportRequest(
            ownerName:       ownerName,
            anchorId:        anchor.id,
            anchorName:      anchor.assetId,
            endTime:         ISO8601DateFormatter().string(from: endTime),
            durationSeconds: duration,
            tagRecords:      tagRecords,
            overallStatus:   overall
        )

        Task {
            do {
                _ = try await SIBClient(settings: settings)
                    .submitReport(sessionId: session.id, report: report)
                print("[Session] Inspection report submitted for session \(session.id)")
            } catch {
                print("[Session] Report submission failed: \(error.localizedDescription)")
            }
        }
    }

    // ── State transitions ─────────────────────────────────────────────────────

    /// Return to idle for a fresh snapshot on the same anchor.
    /// failedOnly = true  → keep PASS markers green, only reset FAIL/PENDING to blue
    /// failedOnly = false → reset everything to blue (full re-inspection)
    private func resetForReInspect(failedOnly: Bool) {
        if failedOnly, let result = appState.lastValidationResult {
            // Collect IDs of failed/pending tags for the next validate-all call
            let failIds = result.tagResults
                .filter { $0.status == .fail || $0.status == .pending }
                .map { $0.tagId }
            reInspectTagIds = failIds.isEmpty ? nil : failIds

            // Reset only failed/pending markers → blue; leave PASS markers green
            for tagResult in result.tagResults where tagResult.status != .pass {
                guard let node = tagMarkerNodes[tagResult.tagId] else { continue }
                let worldPos = node.simdWorldPosition
                node.removeFromParentNode()
                guard let tag = appState.activeTags.first(where: { $0.id == tagResult.tagId }) else { continue }
                let newNode = makeMarkerNode(for: tag, status: nil)
                newNode.simdPosition = worldPos
                newNode.isHidden = !showTagMarkers
                arManager.sceneView.scene.rootNode.addChildNode(newNode)
                tagMarkerNodes[tagResult.tagId] = newNode
            }

            // Reset auto-inspect state for failed/pending tags so they can be re-inspected.
            // Keep PASS results — those markers stay green and don't need re-inspection.
            for id in failIds {
                autoInspectedResults.removeValue(forKey: id)
                tagCooldowns.removeValue(forKey: id)     // allow immediate re-capture
            }
            // Phase 4: reset inspection state only for failed tags
            for id in failIds {
                tagInspectionStates.removeValue(forKey: id)
                tagInspectionImages.removeValue(forKey: id)
                tagInspectionNotes.removeValue(forKey: id)
                tagFixedInSession.removeValue(forKey: id)
                tagImagePaths.removeValue(forKey: id)
            }
        } else {
            // Full reset
            reInspectTagIds = nil
            autoInspectedResults.removeAll()
            tagCooldowns.removeAll()
            placeTagMarkers()
            // Phase 4: clear all inspection state
            tagInspectionStates.removeAll()
            tagInspectionImages.removeAll()
            tagInspectionNotes.removeAll()
            tagFixedInSession.removeAll()
            tagImagePaths.removeAll()
        }
        // Phase 4: cancel timer + dismiss sheet on any re-inspect
        failTimerTask?.cancel()
        failTimerTask = nil
        showTagInspectedSheet = false
        sheetTagId = nil; sheetImage = nil; sheetStatus = nil
        sessionStartTime = Date()
        appState.lastValidationResult = nil
        validateError = nil
        phase = .idle
    }

    private func resetForNewScan() {
        stopLiveLoop()
        // Phase 4: cancel FAIL timer + clear all inspection state
        failTimerTask?.cancel()
        failTimerTask = nil
        showTagInspectedSheet  = false
        sheetTagId = nil; sheetImage = nil; sheetStatus = nil
        tagInspectionStates.removeAll()
        tagInspectionImages.removeAll()
        tagInspectionNotes.removeAll()
        tagFixedInSession.removeAll()
        tagImagePaths.removeAll()
        sessionStartTime = Date()
        // end Phase 4 reset
        tagMarkerNodes.values.forEach { $0.removeFromParentNode() }
        tagMarkerNodes.removeAll()
        coneGuides.values.forEach { $0.cleanup() }
        coneGuides.removeAll()
        appState.activeAnchor         = nil
        appState.activeTags           = []
        appState.activeSession        = nil
        appState.lastValidationResult = nil
        validateError                 = nil
        reInspectTagIds               = nil
        autoInspectedResults.removeAll()
        tagCooldowns.removeAll()
        isAutoInspecting              = false
        anchorLocated                 = false
        phase                         = .idle
    }

    // ── Proximity ticker — Disney UX ──────────────────────────────────────────
    //
    // Distance zones per tag:
    //   > 2.0 m  → sphere only, gentle slow pulse        (discovery)
    //   1.0–2.0m → sphere faster pulse + distance label  (approaching)
    //   < 1.0 m  → cone fades in, sphere brightens       (engagement)
    //   < 0.5 m + cone aligned → cone ring glows green, haptic (capture zone)
    //
    // Only one cone is shown at a time (nearest tag) to avoid visual clutter.

    private func tickProximity() {
        guard let frame = arManager.sceneView.session.currentFrame else { return }
        let cam = simd_float3(frame.camera.transform.columns.3.x,
                               frame.camera.transform.columns.3.y,
                               frame.camera.transform.columns.3.z)

        var closestDist: Float    = .infinity
        var closestTagId: String? = nil

        for tag in appState.activeTags {
            guard let markerNode = tagMarkerNodes[tag.id] else { continue }
            let dist = simd_length(cam - markerNode.simdWorldPosition)

            if dist < closestDist {
                closestDist  = dist
                closestTagId = tag.id
            }

            // Pulse speed reflects proximity (faster = closer)
            let pulseSpeed: Double = dist > 2.0 ? 1.2 : (dist > 1.0 ? 0.65 : 0.35)
            if !markerNode.actionKeys.contains("pulse") {
                markerNode.runAction(.repeatForever(.sequence([
                    .fadeOpacity(to: 0.45, duration: pulseSpeed),
                    .fadeOpacity(to: 1.00, duration: pulseSpeed),
                ])), forKey: "pulse")
            }

            // #88: shrink the marker as the operator gets very close. The
            // ring/label are a fixed world-space size, so up close they fill
            // the screen and get in the way of the actual visual inspection.
            // Scale only kicks in below `markerFullScaleDist` — at normal
            // walking/inspection distance the marker is unaffected.
            let scale = markerScale(forDistance: dist)
            if abs(CGFloat(markerNode.scale.x) - CGFloat(scale)) > 0.01 {
                SCNTransaction.begin()
                SCNTransaction.animationDuration = 0.12
                markerNode.scale = SCNVector3(scale, scale, scale)
                SCNTransaction.commit()
            }
        }

        // #88: "too close" hint — once the marker has shrunk to its floor
        // scale, a literal physical step back is what actually helps (rather
        // than continuing to shrink the marker indefinitely).
        if closestDist < tooCloseDist, let nearId = closestTagId {
            tooCloseTagLabel = appState.activeTags.first(where: { $0.id == nearId })?.label ?? "the tag"
        } else {
            tooCloseTagLabel = nil
        }

        // Alignment check for the nearest cone-trained tag — computed BEFORE
        // the cone-visibility decision below, since whether the operator is
        // already aligned now determines whether the cone should still be
        // shown.
        var nowInZone = false
        var approachAngle: Float? = nil
        if let nearId = closestTagId,
           let guide  = coneGuides[nearId],
           closestDist < 1.0 {
            let angle = guide.alignmentAngle(cameraTransform: frame.camera.transform)
            approachAngle = angle
            nowInZone = angle < 25 && closestDist < 0.8
        }

        // ── "Move into the tag" approach hint ───────────────────────────────
        // Nearby cone-trained tag, cone guide visible, but not yet aligned —
        // tell the operator what to do instead of showing nothing (or a stale
        // PASS/FAIL from a previous visit).
        if let nearId = closestTagId, coneGuides[nearId] != nil, closestDist < 1.0, !nowInZone {
            let label = appState.activeTags.first(where: { $0.id == nearId })?.label ?? "the tag"
            approachHintTagLabel = label
            if closestDist >= 0.8 {
                approachHintText = "Move closer to inspect"
            } else if let angle = approachAngle, angle >= 25 {
                approachHintText = "Center the tag in view"
            } else {
                approachHintText = "Move into the tag to inspect"
            }
        } else {
            approachHintText = nil
        }

        // Show the cone for the nearest cone-trained tag while the operator is
        // approaching (within 1m) but NOT once they've actually achieved
        // alignment — at that point the cone mesh has no more guidance value
        // and is just sitting in front of the camera, covering the exact part
        // the operator is there to inspect. It reappears immediately if they
        // drift back out of alignment.
        for (tagId, guide) in coneGuides {
            let shouldShow = tagId == closestTagId && closestDist < 1.0 && !nowInZone
            if shouldShow != guide.isVisible {
                guide.setVisible(shouldShow, animated: true)
            }
        }

        nearestTagDist = closestDist
        let prevNearest = nearestTagId
        nearestTagId   = closestTagId

        if let nearId = closestTagId,
           coneGuides[nearId] != nil,
           closestDist < 1.0 {
            if nowInZone && !inConeZone {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                // #89: reaching a zone is real progress — reset the idle clock
                // and clear any nudge that's currently showing.
                lastProgressAt = Date()
                idleNudgeText  = nil
            }
            inConeZone = nowInZone

            // T94 (continuous): instead of a single capture on zone entry followed
            // by a cooldown, keep re-validating this tag for as long as the
            // operator remains in its cone zone. This is what makes a fix (e.g.
            // reconnecting a cable) show up as PASS immediately, with no button
            // press and no waiting out a cooldown.
            //
            // Phase 4: skip re-starting the loop for tags that are already
            // confirmed (inspectedPass/inspectedFail) or awaiting sheet confirmation.
            if nowInZone {
                let state = tagInspectionStates[nearId] ?? .notVisited
                if state != .inspectedPass && state != .inspectedFail && state != .awaitingConfirmation {
                    if state == .notVisited { tagInspectionStates[nearId] = .validating }
                    startLiveLoop(forTag: nearId)
                }
            } else if liveLoopTagId == nearId {
                stopLiveLoop()
            }
        } else {
            inConeZone = false
            if liveLoopTagId != nil { stopLiveLoop() }
        }

        // T95: auto-capture non-cone tags (honeycomb, OCR) when physically very close
        if let nearId = closestTagId,
           coneGuides[nearId] == nil,          // not a cone tag (those handled above)
           closestDist < 0.5,
           (phase == .idle || phase == .reviewing) {
            autoTriggerIfReady(tagId: nearId)
        }

        // ── Pass reference preview vs. "no tag nearby" gizmo ────────────────────
        // Single distance threshold replaces the old 1.5 m (load) / 2.0 m (clear)
        // dead zone, which let a previously-visited tag's stale image linger on
        // screen for up to half a metre of travel before being cleared. Below
        // the threshold: show (and keep fresh) the reference preview for
        // whichever tag is nearest. At/above it: clear the preview and instead
        // point a compass gizmo at the nearest tag so the operator knows which
        // way to walk.
        if closestDist < maxPreviewDistance, let tagId = closestTagId,
           let tag = appState.activeTags.first(where: { $0.id == tagId }),
           tag.type.captureMode == .cone {
            gizmoBearing = nil
            if tagId != prevNearest {
                Task { await loadPassPreview(for: tag) }
            }
        } else {
            passPreviewImage = nil
            passPreviewTagId = nil
            if let tagId = closestTagId, let markerNode = tagMarkerNodes[tagId],
               let tag = appState.activeTags.first(where: { $0.id == tagId }) {
                gizmoTagLabel = tag.label
                gizmoDistance = closestDist
                gizmoBearing  = bearingToTag(markerNode.simdWorldPosition, cameraFrame: frame)
            } else {
                gizmoBearing = nil
            }
        }

        // ── #89: stuck/idle nudge ────────────────────────────────────────────
        // Only relevant while still hunting for the first tag — once at least
        // one tag has been inspected, the progress counter in bottomPanel
        // already tells the operator the app is working. Shown once per
        // session so it nudges, not nags.
        if !autoInspectedResults.isEmpty {
            idleNudgeText = nil   // real progress made — stop nudging
        } else if phase == .idle, !idleNudgeShown,
                  Date().timeIntervalSince(lastProgressAt) > idleNudgeDelaySecs {
            idleNudgeText = "Still looking for the first tag? Walk toward one of the markers — I'll start checking as soon as you're close."
            idleNudgeShown = true
        }
    }

    /// Yaw (radians) from the camera's forward direction to `targetWorldPos`,
    /// projected onto the camera's local horizontal plane. 0 = straight ahead,
    /// positive = target is to the right, negative = to the left — matches the
    /// rotation convention used to spin the on-screen compass arrow. This is a
    /// pragmatic 2D compass rather than a true 3D AR-anchored gizmo node, since
    /// it only needs camera-space vectors already available every tick.
    private func bearingToTag(_ targetWorldPos: simd_float3, cameraFrame frame: ARFrame) -> CGFloat {
        let camTransform = frame.camera.transform
        let camPos = simd_float3(camTransform.columns.3.x, camTransform.columns.3.y, camTransform.columns.3.z)
        let camForward = -simd_normalize(simd_float3(camTransform.columns.2.x, camTransform.columns.2.y, camTransform.columns.2.z))
        let camRight   =  simd_normalize(simd_float3(camTransform.columns.0.x, camTransform.columns.0.y, camTransform.columns.0.z))

        let toTag = simd_normalize(targetWorldPos - camPos)
        let x = simd_dot(toTag, camRight)
        let z = simd_dot(toTag, camForward)
        return CGFloat(atan2(x, z))
    }

    private func loadPassPreview(for tag: Tag) async {
        guard tag.id != passPreviewTagId else { return }
        passPreviewTagId = tag.id
        passPreviewLabel = tag.label

        do {
            let ps  = try await SIBClient(settings: settings).fetchPassState(tagId: tag.id)
            guard let firstImg = ps.images.first else { return }

            // Decrypt if encryption key available, else use raw
            let imageB64: String
            if let key = appState.anchorEncryptionKey,
               let decrypted = try? AnchorEncryption.decrypt(
                   encryptedBase64: firstImg.imageBase64, using: key) {
                imageB64 = decrypted
            } else {
                imageB64 = firstImg.imageBase64
            }

            guard let data  = Data(base64Encoded: imageB64),
                  let image = UIImage(data: data) else { return }
            passPreviewImage = image
        } catch {
            // Non-fatal — preview is optional
            print("[PassPreview] Could not load for tag \(tag.id): \(error.localizedDescription)")
        }
    }

    // ── Continuous real-time validation loop ──────────────────────────────────

    /// Starts a repeating validation loop for `tagId`, re-capturing and
    /// re-scoring roughly every `liveLoopIntervalSecs` for as long as the loop
    /// keeps running. Idempotent — calling this again for the tag already being
    /// looped is a no-op so it's safe to call on every `tickProximity()` tick.
    private func startLiveLoop(forTag tagId: String) {
        guard liveLoopTagId != tagId else { return }
        stopLiveLoop()
        liveLoopTagId = tagId
        liveLoopStage = "Getting ready…"
        liveLoopTask = Task {
            while !Task.isCancelled {
                if phase != .validating {
                    await runSingleTagValidation(tagId: tagId, isContinuous: true)
                }
                try? await Task.sleep(nanoseconds: UInt64(liveLoopIntervalSecs * 1_000_000_000))
            }
        }
    }

    /// Cancels the in-flight continuous loop, if any. Called when the operator
    /// steps out of the cone zone (or moves to a different tag's zone).
    private func stopLiveLoop() {
        liveLoopTask?.cancel()
        liveLoopTask = nil
        liveLoopTagId = nil
        statusStreak.removeAll()   // fresh hysteresis state on next zone entry
    }

    /// Hysteresis gate: only allow a tag's *displayed* status to flip after
    /// `hysteresisFrames` consecutive identical raw results. This is what keeps
    /// a borderline frame (motion blur, brief glare as the operator moves) from
    /// bouncing the AR marker between PASS and FAIL on every tick.
    /// Returns true once enough consecutive agreement has accumulated.
    private func shouldCommitStatus(tagId: String, rawStatus: ValidationStatus) -> Bool {
        if let existing = statusStreak[tagId], existing.status == rawStatus {
            let newCount = existing.count + 1
            statusStreak[tagId] = (rawStatus, newCount)
            return newCount >= hysteresisFrames
        } else {
            statusStreak[tagId] = (rawStatus, 1)
            return hysteresisFrames <= 1
        }
    }

    // ── Auto-inspect (T94/T95) ────────────────────────────────────────────────

    /// Gate check before auto-triggering a single-tag inspection.
    /// Silently returns if: another inspection is in flight, the tag is on cooldown,
    /// or a full validate-all (phase == .validating) is running.
    private func autoTriggerIfReady(tagId: String) {
        guard !isAutoInspecting, phase != .validating else { return }
        if let lastTime = tagCooldowns[tagId],
           Date().timeIntervalSince(lastTime) < autoCooldownSecs { return }
        tagCooldowns[tagId] = Date()
        Task { await runSingleTagValidation(tagId: tagId) }
    }

    /// Validate a single tag in-place using the existing `validate-all` endpoint
    /// with `tagIds: [tagId]`. Merges the result into `autoInspectedResults` and
    /// rebuilds `appState.lastValidationResult` so the reviewing panel stays live.
    ///
    /// - Parameter isContinuous: true when called from the real-time cone-zone
    ///   loop (`startLiveLoop`). Continuous calls skip the shutter flash/haptic
    ///   (firing every ~0.7s would be distracting) and have their raw status
    ///   passed through the hysteresis gate before being committed, so a single
    ///   borderline frame can't flicker the AR marker.
    private func runSingleTagValidation(tagId: String, isContinuous: Bool = false) async {
        guard !isAutoInspecting else { return }
        isAutoInspecting = true
        defer { isAutoInspecting = false }

        // Only bother updating the staging text while this tag has no
        // committed result yet — once a PASS/FAIL is showing, the card no
        // longer reads "Checking…" so the staging text isn't visible.
        let stillWaitingOnFirstResult = autoInspectedResults[tagId] == nil
        if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Lining up the shot…" }

        guard let captureFrame = arManager.sceneView.session.currentFrame,
              let snapshot     = captureRawCamera(from: captureFrame)
        else { return }
        guard let jpeg   = snapshot.jpegData(compressionQuality: 0.80),
              let anchor = appState.activeAnchor else { return }

        // Brief shutter flash + haptic so operator knows capture happened —
        // only for the discrete (non-continuous) triggers; the continuous loop
        // re-captures multiple times a second and a repeated flash/buzz would
        // just be noise.
        if !isContinuous {
            flashOpacity = 0.35
            withAnimation(.easeOut(duration: 0.25)) { flashOpacity = 0 }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }

        let client = SIBClient(settings: settings)

        // Ensure session exists
        let session: SIBSession
        if let existing = appState.activeSession {
            session = existing
        } else {
            if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Connecting to the server…" }
            guard let s = try? await client.createSession(userId: "operator",
                                                           assetId: anchor.assetId) else {
                if isContinuous, stillWaitingOnFirstResult {
                    liveLoopStage = "Having trouble reaching the server — still trying…"
                }
                return
            }
            appState.activeSession = s
            session = s
        }
        if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Uploading & comparing…" }

        let encKey = appState.anchorEncryptionKey.map { AnchorEncryption.base64(for: $0) }
        let req = BatchValidateRequest(
            anchorId:      anchor.id,
            assetId:       anchor.assetId,
            sessionId:     session.id,
            imageBase64:   jpeg.base64EncodedString(),
            mimeType:      "image/jpeg",
            threshold:     passThreshold,
            tagIds:        [tagId],       // single-tag validation
            encryptionKey: encKey
        )

        // Reuse the exact frame the snapshot was captured from, same reasoning
        // as runValidation() above.
        let currentFrame = captureFrame

        do {
            var result = try await client.validateAll(req)
            if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Checking alignment…" }
            result = applyConeAndDepthValidation(to: result, snapshot: snapshot, frame: currentFrame)
            if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Comparing details…" }
            result = await applyFeaturePrintValidation(to: result, snapshot: snapshot)
            if isContinuous, stillWaitingOnFirstResult { liveLoopStage = "Reading any text…" }
            result = await applyOCRValidation(to: result, jpeg: jpeg)

            // ── Hysteresis (continuous loop only) ───────────────────────────
            // The raw per-frame status can be noisy right at the Pass/Fail
            // boundary (motion blur, brief glare). Require `hysteresisFrames`
            // consecutive identical raw results before letting the *displayed*
            // status change; until then, keep showing the last committed status
            // for this tag so the AR marker doesn't flicker.
            var statusChanged = true
            if isContinuous, let idx = result.tagResults.firstIndex(where: { $0.tagId == tagId }) {
                let rawStatus = result.tagResults[idx].status
                let committed = shouldCommitStatus(tagId: tagId, rawStatus: rawStatus)
                let previouslyCommitted = autoInspectedResults[tagId]?.status
                if !committed, let lastStatus = previouslyCommitted {
                    result.tagResults[idx].status = lastStatus
                }
                statusChanged = result.tagResults[idx].status != previouslyCommitted
            }

            // Persist this tag's result into the running accumulator
            for tr in result.tagResults { autoInspectedResults[tr.tagId] = tr }

            // Update the AR marker to PASS/FAIL immediately
            updateMarkersForResult(result)

            // Haptic feedback on result — for the continuous loop, only fire
            // when the committed status actually changed (e.g. operator just
            // fixed the issue and it flipped to PASS), not on every poll.
            if let tr = result.tagResults.first(where: { $0.tagId == tagId }),
               !isContinuous || statusChanged {
                UINotificationFeedbackGenerator()
                    .notificationOccurred(tr.status == .pass ? .success : .error)
                print("[AutoInspect] tag=\(tr.tagLabel) status=\(tr.status.rawValue) conf=\(String(format:"%.2f",tr.confidence)) continuous=\(isContinuous)")
            }

            // ── Phase 4: Tag Inspected sheet workflow ────────────────────────
            // On PASS: cancel FAIL timer (if any), pause loop, show sheet after 1s.
            // On FAIL: start the 6s countdown timer (once); if PASS arrives first
            //          the timer is cancelled and the PASS path takes over.
            // Either path keeps the most recent frame as evidence for the sheet.
            if isContinuous, statusChanged,
               let tr = result.tagResults.first(where: { $0.tagId == tagId }),
               tr.status == .pass || tr.status == .fail {

                let currentState = tagInspectionStates[tagId] ?? .notVisited
                // Skip if this tag is already confirmed or showing the sheet
                let isAlreadyHandled = (currentState == .inspectedPass ||
                                        currentState == .inspectedFail ||
                                        currentState == .awaitingConfirmation)
                if !isAlreadyHandled {

                // Track the previous committed status for FAIL→PASS fix detection
                let previousCapturedStatus = capturedStatusByTag[tagId]

                // Always keep the most recent evidence frame
                capturedPreviewByTag[tagId] = snapshot
                capturedStatusByTag[tagId]  = tr.status
                tagInspectionImages[tagId]  = snapshot

                if tr.status == .pass {
                    // PASS path ──────────────────────────────────────────────
                    // Cancel any in-flight FAIL timer, pause the loop, show sheet.
                    failTimerTask?.cancel()
                    failTimerTask = nil

                    // Mark as "fixed" if it was FAIL in this session before now
                    if previousCapturedStatus == .fail {
                        tagFixedInSession[tagId] = true
                    }

                    stopLiveLoop()
                    tagInspectionStates[tagId] = .awaitingConfirmation

                    let capturedSnapshot = snapshot
                    let capturedTagId    = tagId
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        guard !showTagInspectedSheet else { return }  // don't interrupt another tag
                        sheetTagId  = capturedTagId
                        sheetImage  = capturedSnapshot
                        sheetStatus = .pass
                        showTagInspectedSheet = true
                    }

                } else if tr.status == .fail, failTimerTask == nil {
                    // FAIL path ──────────────────────────────────────────────
                    // Start the 6s timer only once; loop keeps running so a fix
                    // can cancel it and take the PASS path instead.
                    let capturedTagId = tagId
                    failTimerTask = Task {
                        try? await Task.sleep(nanoseconds: 6_000_000_000)
                        guard !Task.isCancelled else { return }
                        // 6s of persistent FAIL — pause loop and show sheet
                        stopLiveLoop()
                        tagInspectionStates[capturedTagId] = .awaitingConfirmation
                        guard !showTagInspectedSheet else { return }  // don't interrupt another tag
                        sheetTagId  = capturedTagId
                        sheetImage  = tagInspectionImages[capturedTagId]  // latest FAIL frame
                        sheetStatus = .fail
                        showTagInspectedSheet = true
                        failTimerTask = nil
                    }
                }
                // (Subsequent FAIL ticks with timer already running:
                //  tagInspectionImages[tagId] is updated above so the sheet
                //  always shows the most recent FAIL frame when it fires.)
                } // end if !isAlreadyHandled
            }

            // Rebuild the combined session result so the reviewing panel reflects progress
            rebuildCombinedResult()

            // Transition to reviewing so "End Inspection" becomes available
            if phase == .idle { phase = .reviewing }

        } catch {
            if isContinuous, stillWaitingOnFirstResult {
                liveLoopStage = "Having trouble reaching the server — still trying…"
            }
            print("[AutoInspect] Failed for tag \(tagId): \(error.localizedDescription)")
        }
    }

    /// Build a combined `AnchorValidationResult` from all per-tag auto-inspections.
    /// Tags not yet inspected appear as `.pending`. Stored in `appState.lastValidationResult`
    /// so `reviewingPanel` and `ValidationResultsView` both reflect live progress.
    private func rebuildCombinedResult() {
        guard let anchor  = appState.activeAnchor,
              let session = appState.activeSession else { return }

        let tagResults: [TagValidationSummary] = appState.activeTags.map { tag in
            autoInspectedResults[tag.id] ?? TagValidationSummary(
                tagId:      tag.id,
                tagLabel:   tag.label,
                tagType:    tag.type,
                status:     .pending,
                confidence: 0
            )
        }

        let passes  = tagResults.filter { $0.status == .pass    }.count
        let fails   = tagResults.filter { $0.status == .fail    }.count
        let pending = tagResults.filter { $0.status == .pending }.count
        let total   = tagResults.count

        let status: AnchorStatus = fails == 0 && pending == 0 ? .pass
                                 : passes == 0 && pending == 0 ? .fail
                                 : pending == total ? .pending
                                 : .partial

        appState.lastValidationResult = AnchorValidationResult(
            id:          UUID().uuidString,
            anchorId:    anchor.id,
            assetId:     anchor.assetId,
            sessionId:   session.id,
            status:      status,
            passCount:   passes,
            failCount:   fails,
            totalCount:  total,
            tagResults:  tagResults,
            evaluatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    // ── Photo library save (requirement #5) ───────────────────────────────────

    /// Saves `image` to the device's photo library. Requires
    /// `NSPhotoLibraryAddUsageDescription` in Info.plist (add-only access —
    /// the app never reads the existing library). Silently logs failures
    /// rather than surfacing an error UI, since this is a "nice to have"
    /// reference capture and shouldn't block or interrupt live inspection.
    private func saveImageToPhotoLibrary(_ image: UIImage) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                print("[AutoInspect] Photo library access not granted (status=\(status.rawValue)) — skipping save")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }, completionHandler: { success, error in
                if let error { print("[AutoInspect] Photo save failed: \(error.localizedDescription)") }
                else if success { print("[AutoInspect] Reference image saved to photo library") }
            })
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func metaDouble(_ any: AnyCodable?) -> Double? {
        guard let any else { return nil }
        if let d = any.value as? Double { return d }
        if let i = any.value as? Int    { return Double(i) }
        return nil
    }

    // Overload accepting AnyCodable directly (used inside cone validation closures)
    private func metaDouble(_ any: AnyCodable) -> Double? { metaDouble(Optional(any)) }

    /// Read a Float from a metadata dict by key.
    /// Handles Double, Float, and Int storage (AnyCodable decodes JSON numbers
    /// as Double or Int depending on value, so we must try both).
    private func metaFloat(_ meta: [String: AnyCodable], key: String) -> Float? {
        guard let any = meta[key] else { return nil }
        if let d = any.value as? Double { return Float(d) }
        if let f = any.value as? Float  { return f }
        if let i = any.value as? Int    { return Float(i) }
        return nil
    }
}

// ── AnchorStatus display helpers ──────────────────────────────────────────────

extension AnchorStatus {
    var color: Color {
        switch self {
        case .pass:    return .green
        case .fail:    return .red
        case .partial: return .orange
        case .pending: return .gray
        }
    }
    var iconName: String {
        switch self {
        case .pass:    return "checkmark.circle.fill"
        case .fail:    return "xmark.circle.fill"
        case .partial: return "exclamationmark.circle.fill"
        case .pending: return "questionmark.circle.fill"
        }
    }
    var displayText: String {
        switch self {
        case .pass:    return "PASS"
        case .fail:    return "FAIL"
        case .partial: return "PARTIAL"
        case .pending: return "PENDING"
        }
    }
}
