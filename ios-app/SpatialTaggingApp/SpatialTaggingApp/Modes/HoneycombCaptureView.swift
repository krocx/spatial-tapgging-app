// HoneycombCaptureView.swift — Phase 2.5 (Training UX overhaul)
//
// Changes from Phase 2B:
//  G8:  Pre-training ready screen — live camera + static honeycomb diagram + Start button.
//  G9:  Compass arrow + text direction hint ("Look upper-left") pointing to the next sphere.
//  G10: Guide construction gated behind Start button tap, not the first ARKit frame.
//       This is the orientation bug fix: when the user taps Start they are pointing the
//       camera at the tag, so forward/right/up are correctly oriented for guide placement.
//  G11: 2D HoneycombDiagram mini-map in top bar replaces the 7-dot strip.
//  G13: Per-viewpoint retake window — 2.5 s thumbnail after each auto-capture with Retake.
//
// Architecture note (scalability):
//  CapturedViewpoint is a value type that currently carries only an RGB JPEG + pose.
//  When the platform moves to depth/3D capture, add optional fields here and in
//  PassStateImage (e.g. depthMapBase64?: string on the SIB schema) — the UX and
//  the 7-viewpoint walk-to-bubble paradigm remain unchanged.

import SwiftUI
import ARKit
import simd

// ── Training phase state machine ──────────────────────────────────────────────

private enum TrainingPhase: Equatable {
    case ready       // Pre-start briefing — AR running, guide NOT built yet
    case capturing   // User is actively walking to spheres
    case complete    // All 7 captured — awaiting Train Tag tap
}

// ── Main view ─────────────────────────────────────────────────────────────────

struct HoneycombCaptureView: View {

    let tag:             Tag
    let anchor:          Anchor
    let parentArManager: ARSessionManager   // shared from AuthorModeView — same world frame
    let onTrained:       (String) -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss)  private var dismiss

    // ── Own sceneView — links to parentArManager's session in onAppear ─────────
    @StateObject private var svHolder = SceneViewHolder()

    // ── SceneView holder ──────────────────────────────────────────────────────
    private final class SceneViewHolder: ObservableObject {
        let sceneView: ARSCNView = {
            let v = ARSCNView()
            v.autoenablesDefaultLighting = true
#if DEBUG
            v.debugOptions = [.showFeaturePoints]
#endif
            return v
        }()
    }

    // ── Wrapper: no dismantleUIView — session owned by parentArManager ─────────
    private struct OwnSCNViewContainer: UIViewRepresentable {
        let sceneView: ARSCNView
        func makeUIView(context: Context) -> ARSCNView { sceneView }
        func updateUIView(_ uiView: ARSCNView, context: Context) {}
    }

    // ── Phase ─────────────────────────────────────────────────────────────────
    @State private var phase: TrainingPhase = .ready

    // ── Capture state ─────────────────────────────────────────────────────────
    @State private var capturedViewpoints: [CapturedViewpoint] = []
    @State private var currentSlot  = 0
    @State private var isTraining   = false
    @State private var trainError: String? = nil
    @State private var showSuccess  = false
    @State private var flashOpacity: Double = 0

    // ── 3D guide — NOT built until user taps Start (G10 fix) ─────────────────
    @State private var guide:     HoneycombARGuide? = nil
    @State private var guideReady = false

    // ── Proximity / hold-to-capture ───────────────────────────────────────────
    @State private var inPosition  = false
    @State private var holdProgress: Double = 0.0

    // ── Step 2: QR re-detection state ─────────────────────────────────────────
    // The QR scanner stays active during the training session.  When the user
    // points the phone at the QR before tapping Start, the guide will be placed
    // at the tag's exact world position (anchor-relative → world via new session
    // anchor transform) rather than 0.5 m ahead of the camera.
    @State private var anchorRedetected: Bool = false

    // ── G9: Compass + direction hint ──────────────────────────────────────────
    @State private var compassAngle:   Double = 0      // degrees, 0 = up, CW positive
    @State private var directionHint:  String = ""     // "Look upper-left" etc.
    @State private var sphereOnScreen: Bool   = false  // whether the sphere is in frame

    // ── G13: Retake window ────────────────────────────────────────────────────
    @State private var retakeImage: UIImage? = nil
    @State private var showRetake   = false
    @State private var retakeTask:  Task<Void, Never>? = nil

    // ── Constants ─────────────────────────────────────────────────────────────
    private let proximityThreshold: Float  = 0.28   // metres
    private let holdDuration:       Double = 0.80   // seconds

    private let ticker = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    static let slotNames = [
        "Straight On", "From Above",  "Upper Right",
        "Lower Right",  "From Below", "Lower Left",  "Upper Left",
    ]

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            // AR camera — own sceneView linked to parentArManager's session
            OwnSCNViewContainer(sceneView: svHolder.sceneView).ignoresSafeArea()

            // White capture flash
            Color.white.opacity(flashOpacity)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            // Phase-driven content
            switch phase {
            case .ready:
                readyScreen
            case .capturing, .complete:
                capturingOverlay
            }

            if showSuccess { successOverlay }
        }
        .onAppear {
            // ── Link to AuthorModeView's running session ────────────────────────
            // parentArManager.lockedAnchorTransform = appState.anchorNormalisedTransform
            // was set in AuthorModeView.onAppear.  Sharing the session preserves the
            // world frame so anchorRelativeInspectionPoint() returns the correct
            // physical tag location without requiring QR re-scan.
            svHolder.sceneView.session = parentArManager.sceneView.session
            anchorRedetected = true   // anchor transform is already known
        }
        .onDisappear {
            guide?.cleanup()
            retakeTask?.cancel()
            // DO NOT pause — session belongs to parentArManager.
        }
        .onReceive(ticker) { _ in tick() }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARK: — Ready screen (G8)
    // ══════════════════════════════════════════════════════════════════════════

    private var readyScreen: some View {
        ZStack(alignment: .bottom) {
            // Dark scrim over live camera
            LinearGradient(
                colors: [.black.opacity(0.50), .black.opacity(0.82)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {

                // ── Header ────────────────────────────────────────────────────
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.white, .black.opacity(0.4))
                    }
                    Spacer()
                    VStack(spacing: 3) {
                        Text(tag.label)
                            .font(.subheadline.bold())
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Label(tag.type.displayName, systemImage: tag.type.iconName)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.65))
                    }
                    Spacer()
                    Color.clear.frame(width: 36) // balance the X button
                }
                .padding(.horizontal, 20)
                .padding(.top, 56)
                .padding(.bottom, 8)

                Spacer()

                // ── Title ─────────────────────────────────────────────────────
                Text("7-Point AR Training")
                    .font(.title2.bold())
                    .foregroundColor(.white)

                Text("Walk to each glowing sphere to capture a viewpoint.\nThe app captures automatically when you hold steady.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.68))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 6)

                Spacer()

                // ── Static honeycomb diagram (G11 large variant) ──────────────
                VStack(spacing: 10) {
                    HoneycombDiagram(
                        capturedCount: 0,
                        currentSlot: 0,
                        size: 240,
                        showLabels: true
                    )

                    Text("7 capture positions — walk to each numbered sphere")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.50))
                }

                Spacer()

                // ── QR lock status + aim instruction ─────────────────────────
                VStack(spacing: 8) {
                    // Step 1: scan QR (shows green lock once detected)
                    HStack(spacing: 10) {
                        Image(systemName: anchorRedetected
                              ? "checkmark.seal.fill" : "qrcode.viewfinder")
                            .font(.title3)
                            .foregroundStyle(anchorRedetected ? .green : .cyan)
                        Text(anchorRedetected
                             ? "QR locked — tag position anchored ✓"
                             : "**Step 1:** Point camera at the **QR code** to lock position")
                            .font(.subheadline)
                            .foregroundStyle(.white)
                        Spacer()
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))

                    // Step 2: aim at tag
                    HStack(spacing: 10) {
                        Image(systemName: "scope")
                            .font(.title3)
                            .foregroundStyle(.cyan)
                        Text("**Step 2:** Point camera **at the tag**, then tap Start")
                            .font(.subheadline)
                            .foregroundStyle(.white)
                        Spacer()
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
                .animation(.easeInOut(duration: 0.25), value: anchorRedetected)

                // ── Start button ──────────────────────────────────────────────
                Button { beginTraining() } label: {
                    Label("Start Training", systemImage: "play.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .controlSize(.large)
                .padding(.horizontal, 24)
                .padding(.bottom, 52)
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARK: — Capturing overlay (G9 compass, G11 mini-map, G13 retake)
    // ══════════════════════════════════════════════════════════════════════════

    private var capturingOverlay: some View {
        VStack(spacing: 0) {
            topBar

            Spacer()

            // G9: Compass + hint — only shown when not already in position
            if phase == .capturing && !inPosition && capturedViewpoints.count < 7 {
                compassView
                    .padding(.bottom, 16)
                    .transition(.opacity)
            }

            centerContent
            Spacer()
            bottomBar
        }
        .animation(.easeInOut(duration: 0.25), value: inPosition)
    }

    // ── Direction hint — text only when sphere is off-screen ─────────────────
    // The 3D world-space arrow (HoneycombARGuide) handles visible direction.
    // This text overlay only shows when the sphere is behind the camera or
    // far outside the viewport, as an extra verbal cue.

    private var compassView: some View {
        HStack(spacing: 8) {
            // Small arrow icon for screen-edge cases
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(.cyan)
                .rotationEffect(.degrees(compassAngle))
                .animation(.interpolatingSpring(stiffness: 60, damping: 10),
                           value: compassAngle)

            if !directionHint.isEmpty {
                Text(directionHint)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .transition(.opacity.combined(with: .scale))
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(.black.opacity(0.55), in: Capsule())
        .animation(.easeInOut(duration: 0.2), value: directionHint)
    }

    // ── Center content ────────────────────────────────────────────────────────

    @ViewBuilder
    private var centerContent: some View {
        if capturedViewpoints.count < 7 {
            VStack(spacing: 18) {
                // Current slot name
                Text(Self.slotNames[currentSlot])
                    .font(.title2.bold())
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.6), radius: 4)
                    .contentTransition(.numericText())
                    .animation(.easeInOut(duration: 0.2), value: currentSlot)

                Text(guideReady
                     ? "Walk to glowing sphere \(currentSlot + 1)"
                     : "Initialising AR scene…")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                    .shadow(color: .black.opacity(0.5), radius: 3)

                // Hold-to-capture proximity ring
                proximityRing
                    .frame(width: 108, height: 108)

                if inPosition {
                    Text("Hold steady…")
                        .font(.caption.bold())
                        .foregroundStyle(.green)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: inPosition)
            .padding(.horizontal, 24)

        } else {
            // All captured
            VStack(spacing: 14) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.green)
                    .symbolEffect(.bounce, value: capturedViewpoints.count == 7)
                Text("All viewpoints captured")
                    .font(.title3.bold())
                    .foregroundColor(.white)
                Text("Review your shots above, then tap Train Tag.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
            }
        }

        // G13: Retake banner — shown briefly after each capture
        if showRetake, let img = retakeImage {
            retakeBanner(image: img)
                .padding(.top, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // ── G13: Retake banner ────────────────────────────────────────────────────

    private func retakeBanner(image: UIImage) -> some View {
        HStack(spacing: 12) {
            // Thumbnail
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 9))
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .stroke(Color.cyan.opacity(0.7), lineWidth: 1.5)
                )

            VStack(alignment: .leading, spacing: 3) {
                Text("Viewpoint \(capturedViewpoints.count) captured")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                Text("Tap Retake if the shot looks wrong")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.60))
            }

            Spacer()

            Button { performRetake() } label: {
                Text("Retake")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Color.orange, in: Capsule())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 20)
    }

    // ── Proximity ring ────────────────────────────────────────────────────────

    private var proximityRing: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.18), lineWidth: 7)

            Circle()
                .trim(from: 0, to: holdProgress)
                .stroke(
                    inPosition ? Color.green : Color.cyan,
                    style: StrokeStyle(lineWidth: 7, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.05), value: holdProgress)

            Image(systemName: inPosition ? "checkmark" : "camera.viewfinder")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(inPosition ? Color.green : Color.white)
                .animation(.easeInOut(duration: 0.15), value: inPosition)
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        ZStack(alignment: .top) {
            LinearGradient(
                colors: [.black.opacity(0.70), .clear],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: 150)
            .allowsHitTesting(false)

            HStack(alignment: .center, spacing: 12) {
                // Dismiss
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white, .black.opacity(0.4))
                }

                Spacer()

                // Tag info
                VStack(spacing: 3) {
                    Text(tag.label)
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                        .lineLimit(1)
                    Label(tag.type.displayName, systemImage: tag.type.iconName)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                }
                .frame(maxWidth: 150)

                Spacer()

                // G11: Mini honeycomb progress map (replaces 7-dot strip)
                HoneycombDiagram(
                    capturedCount: capturedViewpoints.count,
                    currentSlot: currentSlot,
                    size: 62,
                    showLabels: false
                )
                .animation(.easeInOut(duration: 0.15), value: capturedViewpoints.count)
            }
            .padding(.horizontal, 20)
            .padding(.top, 56)
        }
    }

    // ── Bottom bar ────────────────────────────────────────────────────────────

    private var bottomBar: some View {
        VStack(spacing: 14) {
            if let err = trainError {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
            }

            if isTraining {
                HStack(spacing: 10) {
                    ProgressView().tint(.white)
                    Text("Uploading to SIB…")
                        .foregroundColor(.white)
                        .font(.subheadline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 24)

            } else if capturedViewpoints.count == 7 {
                Button { Task { await submitTraining() } } label: {
                    Label("Train Tag", systemImage: "arrow.up.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.large)
                .padding(.horizontal, 24)
            }
        }
        .padding(.bottom, 48)
    }

    // ── Success overlay ───────────────────────────────────────────────────────

    private var successOverlay: some View {
        ZStack {
            Color.black.opacity(0.82).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.green)
                    .symbolEffect(.bounce, value: showSuccess)
                Text("Tag Trained!")
                    .font(.title.bold())
                    .foregroundColor(.white)
                Text("\"\(tag.label)\" is ready with 7 viewpoints.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Done") { onTrained(tag.id); dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .controlSize(.large)
            }
        }
        .transition(.opacity)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARK: — Ticker (20 fps)
    // ══════════════════════════════════════════════════════════════════════════

    private func tick() {
        guard let frame = svHolder.sceneView.session.currentFrame else { return }

        // Only run capture logic during active capture phases
        guard phase == .capturing || phase == .complete else { return }
        guard capturedViewpoints.count < 7 else { return }

        // ── G10 + Step 2: Build guide on the FIRST tick AFTER Start was tapped ─
        // G10: camera is pointing at the tag → correct hemisphere orientation.
        // Step 2: if the QR was re-detected in this session, place the inspection
        // point at the tag's known world position (anchor-relative → world).
        // Falls back to camera-derived position when no anchor data is available.
        if !guideReady {
            if case .notAvailable = frame.camera.trackingState { return }
            guideReady = true
            let inspPt = anchorRelativeInspectionPoint()
            let g = HoneycombARGuide(
                sceneView: svHolder.sceneView,
                initialCameraTransform: frame.camera.transform,
                inspectionPoint: inspPt
            )
            if inspPt != nil {
                print("[HoneycombCapture] Guide anchored to tag world position ✓")
            } else {
                print("[HoneycombCapture] Guide placed camera-relative (no anchor data)")
            }
            guide = g
            return
        }

        guard let g = guide else { return }

        // ── G9: Update compass direction ──────────────────────────────────────
        updateCompass(frame: frame, guide: g)

        // ── Proximity check ───────────────────────────────────────────────────
        let camPos = simd_float3(frame.camera.transform.columns.3.x,
                                  frame.camera.transform.columns.3.y,
                                  frame.camera.transform.columns.3.z)
        let dist   = simd_length(camPos - g.targetPositions[currentSlot])
        let nowIn  = dist < proximityThreshold
        if nowIn != inPosition {
            inPosition = nowIn
            // Hide 3D arrow when in-position — proximity ring takes over as indicator
            g.setArrowVisible(!nowIn)
        }

        // ── Hold-to-capture timer ─────────────────────────────────────────────
        if inPosition {
            holdProgress = min(1.0, holdProgress + 0.05 / holdDuration)
            if holdProgress >= 1.0 {
                holdProgress = 0.0
                captureFrame(cameraTransform: frame.camera.transform)
            }
        } else {
            holdProgress = max(0.0, holdProgress - 0.05 / 0.40)
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARK: — G9: Compass computation
    // ══════════════════════════════════════════════════════════════════════════

    private func updateCompass(frame: ARFrame, guide: HoneycombARGuide) {
        guard currentSlot < guide.targetPositions.count else { return }
        let target = guide.targetPositions[currentSlot]

        // Transform target world position into camera space
        let camInv    = simd_inverse(frame.camera.transform)
        let targetCam = camInv * simd_float4(target.x, target.y, target.z, 1.0)

        // In ARKit camera space: +X = screen right, +Y = screen up, -Z = forward
        let tx = Double(targetCam.x)
        let ty = Double(targetCam.y)
        let tz = Double(targetCam.z)
        let inFront = tz < 0

        if !inFront {
            // Target is behind camera — tell user to turn around
            directionHint = "Turn around"
            compassAngle  = 180   // arrow points down = "behind you"
            sphereOnScreen = false
            return
        }

        // Compass angle: atan2(tx, ty)
        //   tx > 0, ty = 0 → 90°  (right)
        //   tx = 0, ty > 0 → 0°   (up)
        //   tx < 0, ty = 0 → -90° (left, shown as 270°)
        //   tx = 0, ty < 0 → 180° (down)
        compassAngle = atan2(tx, ty) * 180.0 / .pi

        // Text direction hint — only show when off-center enough to be useful
        let threshold = 0.32
        var parts: [String] = []
        if      ty >  threshold { parts.append("up")    }
        else if ty < -threshold { parts.append("down")  }
        if      tx >  threshold { parts.append("right") }
        else if tx < -threshold { parts.append("left")  }
        directionHint = parts.isEmpty ? "Straight ahead" : "Look \(parts.joined(separator: "-"))"

        // Is the sphere currently in the camera viewport?
        let viewportSize = svHolder.sceneView.bounds.size
        let projected    = frame.camera.projectPoint(
            target, orientation: .portrait, viewportSize: viewportSize
        )
        sphereOnScreen = svHolder.sceneView.bounds.contains(projected)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MARK: — Actions
    // ══════════════════════════════════════════════════════════════════════════

    /// Called when the user taps Start on the ready screen.
    /// Transitions to capturing — the guide will be built on the VERY NEXT tick,
    /// using whatever camera transform the user is holding right now (G10 fix).
    private func beginTraining() {
        // QR scanning is already disabled (parentArManager.disableQRScanning() was
        // called in AuthorModeView.onAppear) — no action needed here.
        withAnimation(.easeInOut(duration: 0.35)) {
            phase = .capturing
        }
    }

    private func captureFrame(cameraTransform m: simd_float4x4) {
        guard capturedViewpoints.count == currentSlot, currentSlot < 7 else { return }
        guard let frame = svHolder.sceneView.session.currentFrame else { return }

        // Use ARFrame.capturedImage (raw camera CVPixelBuffer) — guaranteed zero
        // AR overlay contamination.  snapshot() requires a SceneKit render pass
        // with all guide nodes hidden; ARFrame.capturedImage skips rendering
        // entirely and returns the pure sensor output.
        let snapshot: UIImage
        if let rawImage = Self.rawCameraImage(from: frame) {
            snapshot = rawImage
        } else {
            // Fallback: hide nodes then snapshot (slower but works)
            guide?.setNodesHidden(true)
            snapshot = svHolder.sceneView.snapshot()
            guide?.setNodesHidden(false)
        }

        guard let jpeg = snapshot.jpegData(compressionQuality: 0.85) else { return }

        let pose = CameraPose(
            position: SIBVector3(x: Double(m.columns.3.x),
                                  y: Double(m.columns.3.y),
                                  z: Double(m.columns.3.z)),
            rotation: quaternion(from: m)
        )
        capturedViewpoints.append(
            CapturedViewpoint(base64: jpeg.base64EncodedString(), pose: pose, snapshot: snapshot)
        )

        // ── G13: Start retake window ──────────────────────────────────────────
        scheduleRetakeWindow(image: snapshot)

        // Advance to next slot
        let next = currentSlot + 1
        if next <= 6 { currentSlot = next }
        guide?.update(currentSlot: min(next, 6), capturedCount: capturedViewpoints.count)

        if capturedViewpoints.count == 7 {
            phase = .complete
        }

        // Haptic + flash feedback
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        flashOpacity = 0.65
        withAnimation(.easeOut(duration: 0.30)) { flashOpacity = 0 }
    }

    // ── G13: Retake ───────────────────────────────────────────────────────────

    private func scheduleRetakeWindow(image: UIImage) {
        retakeTask?.cancel()
        retakeImage = image
        withAnimation(.spring(response: 0.30, dampingFraction: 0.80)) {
            showRetake = true
        }
        retakeTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.easeOut(duration: 0.25)) { showRetake = false }
            }
        }
    }

    private func performRetake() {
        retakeTask?.cancel()
        withAnimation(.easeOut(duration: 0.20)) { showRetake = false }
        guard !capturedViewpoints.isEmpty else { return }
        capturedViewpoints.removeLast()
        currentSlot = max(0, currentSlot - 1)
        if phase == .complete { phase = .capturing }
        guide?.update(currentSlot: currentSlot, capturedCount: capturedViewpoints.count)
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }

    // ── Training submit ───────────────────────────────────────────────────────

    private func submitTraining() async {
        isTraining = true
        trainError = nil
        let now = ISO8601DateFormatter().string(from: Date())

        let encKey = appState.anchorEncryptionKey
            ?? AnchorEncryption.getOrCreateKey(for: anchor.id)
        if appState.anchorEncryptionKey == nil {
            appState.anchorEncryptionKey = encKey
        }

        let images = capturedViewpoints.map { vp -> PassStateImage in
            let payload: String
            if let encrypted = try? AnchorEncryption.encrypt(imageBase64: vp.base64, using: encKey) {
                payload = encrypted
            } else {
                print("[HoneycombCapture] Encryption failed for viewpoint — using plaintext fallback")
                payload = vp.base64
            }
            return PassStateImage(
                id: nil, tagId: tag.id, anchorId: anchor.id,
                assetId: anchor.assetId, imageBase64: payload,
                mimeType: "image/jpeg", pose: vp.pose, capturedAt: now
            )
        }

        do {
            let client = SIBClient(settings: settings)

            try await client.trainPassState(
                CreatePassStateRequest(
                    tagId: tag.id, anchorId: anchor.id,
                    assetId: anchor.assetId, images: images
                )
            )

            // ── Extract and store feature prints ──────────────────────────────
            // VNGenerateImageFeaturePrintRequest produces a viewpoint-invariant
            // semantic embedding for each training image.  Storing all 7 allows
            // the Operator device to find the closest match regardless of which
            // angle they happen to be standing at — no position accuracy required.
            //
            // Prints are stored as base64 strings in tag.metadata["feature_prints"]
            // via PATCH /tags/:id.  They are available to the Operator immediately
            // through fetchTags (no extra network call at validation time).
            // Keep TagFeaturePrint objects (not just base64 strings) so we can
            // compute the per-tag calibrated distance ceiling from intra-class spread.
            var tagFPs: [TagFeaturePrint] = []
            for vp in capturedViewpoints {
                if let fp = await TagFeaturePrint.extract(from: vp.snapshot) {
                    tagFPs.append(fp)
                }
            }
            if !tagFPs.isEmpty {
                // Seed from existing tag metadata so position fields
                // (anchor_rel_x/y/z, pos_x/y/z) are never lost on PATCH.
                var meta: [String: AnyCodable] = tag.metadata
                meta["feature_prints"] = AnyCodable(tagFPs.map { $0.base64 })

                // Per-tag calibrated distance ceiling: max pairwise distance
                // among training prints × 2.5 safety factor for cross-session
                // variance.  Self-tunes to how visually variable this component is.
                let calibMaxDist = TagFeaturePrint.calibratedMaxDist(for: tagFPs)
                meta["fp_max_dist"] = AnyCodable(Double(calibMaxDist))

                _ = try? await client.updateTag(
                    id: tag.id,
                    req: UpdateTagRequest(
                        label: nil, expectedOutcome: nil,
                        checkDescription: nil, order: nil,
                        metadata: meta
                    )
                )
                print("[HoneycombCapture] Stored \(tagFPs.count) feature prints for tag \(tag.id), fp_max_dist=\(String(format: "%.3f", calibMaxDist))")
            }

            withAnimation(.easeIn(duration: 0.3)) { showSuccess = true }
        } catch {
            trainError = error.localizedDescription
        }
        isTraining = false
    }

    // ── Step 2: Anchor-relative inspection point ──────────────────────────────

    /// Returns the tag's world-space position by converting its stored anchor-relative
    /// coordinates using this session's freshly re-detected, normalised anchor transform.
    ///
    /// Returns nil when:
    /// - The QR was not re-detected in this training session, OR
    /// - The tag has no anchor_rel metadata (created before Step 3 was shipped).
    /// In both cases the guide falls back to 0.5 m ahead of the camera.
    private func anchorRelativeInspectionPoint() -> simd_float3? {
        // Need the anchor transform from this session's QR re-detection
        guard let anchorTransform = parentArManager.lockedAnchorTransform else { return nil }

        // Need anchor-relative coords stored on the tag during placement (Step 3)
        guard let rxAny = tag.metadata["anchor_rel_x"],
              let ryAny = tag.metadata["anchor_rel_y"],
              let rzAny = tag.metadata["anchor_rel_z"],
              let rx = (rxAny.value as? Double) ?? (rxAny.value as? Int).map(Double.init),
              let ry = (ryAny.value as? Double) ?? (ryAny.value as? Int).map(Double.init),
              let rz = (rzAny.value as? Double) ?? (rzAny.value as? Int).map(Double.init)
        else { return nil }

        let anchorRel = simd_float3(Float(rx), Float(ry), Float(rz))
        return ARCoordinateFrame.toWorldSpace(
            anchorRelativePos: anchorRel,
            anchorTransform:   anchorTransform
        )
    }

    // ── Raw camera capture (shared utility) ──────────────────────────────────

    /// Convert ARFrame.capturedImage (YCbCr CVPixelBuffer, landscape sensor)
    /// to a portrait UIImage — no AR overlay contamination whatsoever.
    static func rawCameraImage(from frame: ARFrame) -> UIImage? {
        let ci  = CIImage(cvPixelBuffer: frame.capturedImage)
        let oriented = ci.oriented(.right)   // landscape-right → portrait
        let ctx = CIContext(options: [.useSoftwareRenderer: false])
        guard let cg = ctx.createCGImage(oriented, from: oriented.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    // ── Quaternion helper ─────────────────────────────────────────────────────

    private func quaternion(from m: simd_float4x4) -> SIBQuaternion {
        let rot = simd_float3x3(columns: (
            simd_float3(m.columns.0.x, m.columns.0.y, m.columns.0.z),
            simd_float3(m.columns.1.x, m.columns.1.y, m.columns.1.z),
            simd_float3(m.columns.2.x, m.columns.2.y, m.columns.2.z)
        ))
        let q = simd_quaternion(rot)
        return SIBQuaternion(
            x: Double(q.vector.x), y: Double(q.vector.y),
            z: Double(q.vector.z), w: Double(q.vector.w)
        )
    }
}

// ── Internal model ────────────────────────────────────────────────────────────
// CapturedViewpoint: deliberately minimal today.
// When the platform adds depth/3D scan support, extend this struct with
// optional depthMapBase64, confidenceMapBase64, etc. — the UX stays identical.

private struct CapturedViewpoint {
    let base64:   String    // AES-encrypted JPEG (plaintext before submitTraining encrypts it)
    let pose:     CameraPose
    let snapshot: UIImage   // retained for feature print extraction in submitTraining
}
