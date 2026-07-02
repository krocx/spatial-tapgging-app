// ConeCaptureView.swift — v7 (19-zone flat face, close-packed training)
//
// ── What changed from v6 ───────────────────────────────────────────────────────
//  TrainingDomeGuide moved from 3D hemisphere to flat face disc (v3).
//  computeCurrentCell() now uses face-plane Voronoi geometry rather than fixed
//  elevation-angle fractions, so zone boundaries match the actual node positions.
//  lockedDistanceM captured explicitly at startSweep() — used for all cell math.
//  UX text updated: "slide across" instead of "walk around".
//
// ── UX flow ───────────────────────────────────────────────────────────────────
//  .ready        Brief setup — guide spawned, transitions to .positioning
//  .positioning  Ring appears, follows camera. Walk into position.
//                  Pinch to resize aperture · "Start Training" to begin
//  .sweeping     3D dome appears: 19 sphere nodes (white→yellow→green) in AR
//                  Auto-capture on 0.35 s stable aim at a node (flash + haptic)
//                  "Done Training" enabled after ≥14 nodes captured
//  .uploading    All captured frames uploaded as multi-image CreatePassStateRequest
//  .done         Success overlay — shows capture count + LiDAR status
//
// ── Session architecture ──────────────────────────────────────────────────────
//  Unchanged from v4: shares AuthorModeView's ARSession so cone apex lands at
//  the physical tag location without any QR re-scan.
//
// ── Training image quality ────────────────────────────────────────────────────
//  ARFrame.capturedImage (raw YCbCr CVPixelBuffer) — zero AR overlay
//  contamination. Multiple VNGenerateImageFeaturePrint embeddings stored in tag
//  metadata so OperatorModeView can score against the best matching angle.

import SwiftUI
import ARKit
import SceneKit
import CoreImage
import simd

// ── Main view ─────────────────────────────────────────────────────────────────

struct ConeCaptureView: View {

    let tag:             Tag
    let anchor:          Anchor
    let parentArManager: ARSessionManager
    let onTrained:       (String) -> Void
    /// Which reference this capture session trains. Defaults to `.pass` so
    /// every existing call site (which never mentions `state`) is unaffected.
    /// Pass `.fail` to recursively reuse this entire view to capture what the
    /// WRONG condition looks like (cable unplugged, valve closed, switch off)
    /// — see the "Train Fail State" button in `successOverlay`.
    var state: PassStateKind = .pass
    /// #65: when training the Fail-state, the parent Pass-state capture
    /// passes its already-locked sphere distance here so both references
    /// share identical dome geometry. Left `nil` for the Pass-state's own
    /// capture (and any other call site), which falls back to measuring the
    /// Author's live stance distance at `startSweep()` as before.
    var forcedDistanceM: Float? = nil

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    // ── Own sceneView — shares parentArManager's session ──────────────────────
    @StateObject private var svHolder = SceneViewHolder()

    // ── Phase ─────────────────────────────────────────────────────────────────
    private enum Phase { case ready, positioning, sweeping, uploading, done }
    @State private var phase: Phase = .ready

    // ── Guide ─────────────────────────────────────────────────────────────────
    @State private var guide:         ConeARGuide?       = nil
    @State private var domeGuide:     TrainingDomeGuide? = nil
    @State private var anchorReady:   Bool = false
    @State private var tagWorldPos:   simd_float3? = nil   // tag position in world space

    // ── Aperture pinch ────────────────────────────────────────────────────────
    @State private var currentApertureDeg: Float = ConeARGuide.kDefaultApert
    @State private var pinchStartAperture: Float = ConeARGuide.kDefaultApert

    // ── Positioning-phase UI ──────────────────────────────────────────────────
    @State private var distanceM:  Float = 0.3
    @State private var outOfRange: Bool  = false

    // Inspection distance locked at startSweep() — used by computeCurrentCell()
    // to compute face-plane Voronoi boundaries that match the flat-face node layout.
    @State private var lockedDistanceM: Float = 0.3

    // Sphere geometry is angle-based (computeCurrentCell only cares about the
    // gaze direction, not literal distance), so we're free to render the face
    // disc closer to the tag than the Author's literal starting position.
    // `axis` points from the tag TOWARD the camera, so without this offset
    // faceCenter = tagPos + axis * currentDistanceM lands exactly on the
    // camera — the Author starts out standing right inside the sphere
    // cluster instead of seeing it out in front of them. Pulling the disc
    // kForwardOffsetM closer to the tag (smaller distance along axis) moves
    // it into the Author's forward view instead.
    private static let kForwardOffsetM: Float = 0.12

    // Sphere placement uses a narrower "sweet spot" aperture than the full
    // acceptance cone (currentApertureDeg / cone_aperture_deg) so all 19
    // training spheres sit comfortably inside the cone's boundary instead of
    // spreading out to its edge. The acceptance cone itself — used for the
    // Operator standing-zone check — is untouched.
    private static let kSweetSpotFactor: Float = 0.70

    // Aperture actually used for sphere geometry + cell detection during the
    // sweep (= currentApertureDeg × kSweetSpotFactor, locked at startSweep()).
    @State private var lockedApertureDeg: Float = ConeARGuide.kDefaultApert

    // ── Sweep state ───────────────────────────────────────────────────────────
    // Cone-space orthonormal basis set when "Start Training" is tapped.
    @State private var coneAxisWorld:  simd_float3? = nil
    @State private var coneRightWorld: simd_float3? = nil
    @State private var coneUpWorld:    simd_float3? = nil

    @State private var capturedCells:     Set<Int> = []
    @State private var currentHexCell:    Int?     = nil
    @State private var cellHoldStart:     Date?    = nil
    @State private var sweepHoldProgress: Double   = 0.0
    @State private var outOfConeZone:     Bool     = false
    private let sweepHoldDuration: Double          = 0.35
    private let minCaptures:       Int             = 14

    // Captured frames accumulate during sweep, uploaded on "Done"
    private struct CapturedFrame {
        let image:     UIImage?
        let depth:     DepthCapture?
        let cellIndex: Int
    }
    @State private var capturedFrames: [CapturedFrame] = []
    @State private var capturedDepth:  DepthCapture?   = nil   // last depth for success overlay

    // ── Upload / error ────────────────────────────────────────────────────────
    @State private var uploadError:   String? = nil
    @State private var flashOpacity:  Double  = 0

    // ── Optional post-training steps (Pass-state captures only) ──────────────
    // Author may optionally train a Fail-state reference (what the WRONG
    // condition looks like) and/or mark a region-of-interest crop so
    // validation focuses on just the inspected feature instead of the whole
    // frame. Both are fully optional — skipping either leaves the tag exactly
    // as it behaved before this feature existed.
    @State private var showFailCapture: Bool = false
    @State private var showRoiPicker:   Bool = false
    @State private var roiSaveError:    String? = nil
    @State private var roiSaving:       Bool = false

    // ── Contextual in-AR hints (session-only, never persisted) ────────────────
    @State private var showPositioningHint = true   // shown during .positioning phase
    @State private var showSweepHint       = true   // shown when .sweeping phase starts

    private let ticker = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

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

    private struct OwnSCNViewContainer: UIViewRepresentable {
        let sceneView: ARSCNView
        func makeUIView(context: Context) -> ARSCNView { sceneView }
        func updateUIView(_ uiView: ARSCNView, context: Context) {}
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            OwnSCNViewContainer(sceneView: svHolder.sceneView).ignoresSafeArea()
            Color.white.opacity(flashOpacity).ignoresSafeArea().allowsHitTesting(false)

            // Pinch gesture for aperture (positioning only)
            if phase == .positioning {
                Color.clear.contentShape(Rectangle())
                    .gesture(
                        MagnificationGesture()
                            .onChanged { scale in
                                let newAp = pinchStartAperture * Float(1 / scale)
                                currentApertureDeg = max(ConeARGuide.kMinApert,
                                                         min(ConeARGuide.kMaxApert, newAp))
                                guide?.setAperture(currentApertureDeg)
                            }
                            .onEnded { _ in pinchStartAperture = currentApertureDeg }
                    )
                    .ignoresSafeArea()
            }

            VStack(spacing: 0) {
                topBar
                Spacer()
                centerContent
                Spacer()
                bottomBar
            }

            if phase == .done { successOverlay }

            // ── Contextual in-AR hints ────────────────────────────────────────
            if phase == .positioning && showPositioningHint {
                ConePositioningHint {
                    withAnimation(.easeOut(duration: 0.3)) { showPositioningHint = false }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
                .animation(.easeInOut(duration: 0.35), value: showPositioningHint)
            }
            if phase == .sweeping && showSweepHint {
                ConeSweepHint {
                    withAnimation(.easeOut(duration: 0.3)) { showSweepHint = false }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
                .animation(.easeInOut(duration: 0.35), value: showSweepHint)
            }
        }
        .onChange(of: phase) { newPhase in
            // Auto-dismiss hints when their phase activates
            if newPhase == .sweeping && showSweepHint {
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                    withAnimation(.easeOut(duration: 0.4)) { showSweepHint = false }
                }
            }
        }
        .onAppear {
            svHolder.sceneView.session = parentArManager.sceneView.session
            anchorReady = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                spawnGuide()
                if phase == .ready { phase = .positioning }
            }
        }
        .onDisappear {
            guide?.cleanup()
            domeGuide?.cleanup()
            domeGuide = nil
        }
        .onReceive(ticker) { _ in tick() }
    }

    // ── Ticker ────────────────────────────────────────────────────────────────

    private func tick() {
        guard let frame = svHolder.sceneView.session.currentFrame else { return }

        if guide == nil && anchorReady { spawnGuide() }
        guard let g = guide else { return }

        switch phase {
        case .positioning:
            g.updateForCamera(cameraTransform: frame.camera.transform)
            distanceM  = g.currentDistanceM
            outOfRange = g.isOutOfRange

        case .sweeping:
            // Guide is locked — no camera update. Run sweep logic.
            updateSweepTick(frame: frame)

        default:
            break
        }
    }

    // ── Sweep tick (runs at 20 Hz) ────────────────────────────────────────────

    private func updateSweepTick(frame: ARFrame) {
        // Update 3D dome state at every exit point (early return or normal end)
        defer {
            domeGuide?.updateState(
                capturedCells: capturedCells,
                currentCell:   currentHexCell,
                holdProgress:  sweepHoldProgress
            )
        }

        let cell = computeCurrentCell(cameraTransform: frame.camera.transform)
        currentHexCell = cell
        outOfConeZone  = cell == nil

        // If in an already-captured cell or outside cone — reset hold timer
        guard let idx = cell, !capturedCells.contains(idx) else {
            cellHoldStart     = nil
            sweepHoldProgress = 0
            return
        }

        let now = Date()
        if let start = cellHoldStart {
            sweepHoldProgress = min(1, now.timeIntervalSince(start) / sweepHoldDuration)
            if sweepHoldProgress >= 1 {
                triggerSweepCapture(frame: frame, cellIndex: idx)
                cellHoldStart     = nil
                sweepHoldProgress = 0
            }
        } else {
            cellHoldStart     = now
            sweepHoldProgress = 0
        }
    }

    // ── Zone computation — flat face Voronoi (v7) ──────────────────────────────
    //
    // Matches the TrainingDomeGuide v3 flat-face layout exactly.
    // Nodes are on the face disc at depth `lockedDistanceM`:
    //   Node 0:     face centre (r = 0)
    //   Nodes 1–6:  inner ring, r1 = faceRadius / 3, 60 ° apart
    //   Nodes 7–18: outer ring, r2 = faceRadius × 2/3, 30 ° apart
    //
    // Zone assignment uses Voronoi boundaries on the face plane:
    //   Centre zone (0): camera ray hits face within r1 / 2 of centre
    //   Inner ring  (1–6): between r1/2 and (r1+r2)/2 from centre, 60 ° sectors
    //   Outer ring  (7–18): beyond (r1+r2)/2, 30 ° sectors
    //   nil: camera ray hits beyond faceRadius × 1.05 (5 % margin)
    //
    // Elevation angle is used as a proxy for face radius: the camera ray
    // at elevation θ crosses the face plane at radius ≈ d × tan(θ).

    private func computeCurrentCell(cameraTransform: simd_float4x4) -> Int? {
        guard let axis  = coneAxisWorld,
              let right = coneRightWorld,
              let up    = coneUpWorld,
              let tagPos = tagWorldPos else { return nil }

        let col3   = cameraTransform.columns.3
        let camPos = simd_float3(col3.x, col3.y, col3.z)

        let tagToCam = camPos - tagPos
        let dist = simd_length(tagToCam)
        guard dist > 0.05 else { return 0 }
        let dir = tagToCam / dist

        // Elevation angle from cone axis (= angle between camera and axis)
        let axDot = simd_dot(dir, axis)
        let elRad = acos(max(-1, min(1, axDot)))

        // Face-plane geometry at the locked inspection distance.
        // Uses lockedApertureDeg (the narrower "sweet spot" aperture), not
        // currentApertureDeg, so zone boundaries match where the spheres
        // were actually drawn by TrainingDomeGuide.
        let d          = lockedDistanceM
        let faceRadius = d * tan(lockedApertureDeg * .pi / 180)
        let r1         = faceRadius / 3          // inner ring radius on face
        let r2         = faceRadius * (2.0 / 3)  // outer ring radius on face

        // Camera ray's radial distance on the face plane
        let faceR = d * tan(elRad)

        // 5 % margin: nil if camera is clearly outside the face disc
        if faceR > faceRadius * 1.05 { return nil }

        // Voronoi boundary between centre and inner ring: halfway at r1/2
        if faceR < r1 / 2 { return 0 }

        // Azimuth from cone-right axis
        let perpComp = dir - axDot * axis
        let perpLen  = simd_length(perpComp)
        guard perpLen > 0.001 else { return 0 }
        let perpNorm = perpComp / perpLen

        let azCos = simd_dot(perpNorm, right)
        let azSin = simd_dot(perpNorm, up)
        var azDeg = atan2(azSin, azCos) * 180 / Float.pi
        if azDeg < 0 { azDeg += 360 }

        // Voronoi boundary between inner and outer ring: halfway at (r1+r2)/2
        if faceR < (r1 + r2) / 2 {
            // Zones 1–6 — inner ring, 6 sectors of 60 °
            // +30 ° offset so node 1 (az=0°) is centred in its sector
            let sectorIdx = Int(((azDeg + 30).truncatingRemainder(dividingBy: 360)) / 60) % 6
            return 1 + sectorIdx
        } else {
            // Zones 7–18 — outer ring, 12 sectors of 30 °
            // +15 ° offset so node 7 (az=0°) is centred in its sector
            let sectorIdx = Int(((azDeg + 15).truncatingRemainder(dividingBy: 360)) / 30) % 12
            return 7 + sectorIdx
        }
    }

    // ── Sweep capture ─────────────────────────────────────────────────────────

    private func triggerSweepCapture(frame: ARFrame, cellIndex: Int) {
        guard capturedFrames.count < TrainingDomeGuide.nodeCount else { return }

        flashOpacity = 0.5
        withAnimation(.easeOut(duration: 0.18)) { flashOpacity = 0 }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

        let rawImage = captureRawCamera(from: frame)
        let depth    = DepthCapture.capture(from: frame)
        capturedDepth = depth

        capturedCells.insert(cellIndex)
        capturedFrames.append(CapturedFrame(image: rawImage, depth: depth, cellIndex: cellIndex))
    }

    // ── Start sweep ───────────────────────────────────────────────────────────

    private func startSweep() {
        guard let frame = svHolder.sceneView.session.currentFrame,
              let tagPos = tagWorldPos else { return }

        let col3   = frame.camera.transform.columns.3
        let camPos = simd_float3(col3.x, col3.y, col3.z)

        let tagToCam = camPos - tagPos
        let dist = simd_length(tagToCam)
        guard dist > 0.05 else { return }

        // Cone axis = direction from tag to camera at first position
        let axis = tagToCam / dist
        coneAxisWorld = axis

        // Stable orthonormal right/up basis in the cone's cross-section plane
        let worldRef = abs(simd_dot(axis, simd_float3(0, 1, 0))) < 0.99
            ? simd_float3(0, 1, 0)
            : simd_float3(1, 0, 0)
        let right = simd_normalize(simd_cross(axis, worldRef))
        let upDir = simd_normalize(simd_cross(right, axis))
        coneRightWorld = right
        coneUpWorld    = upDir

        // Lock the guide ring so the Author has a fixed visual cone reference,
        // then fade it out — the sphere nodes alone guide the Author during sweep.
        // The cone reappears in the success overlay so the Author can see what
        // region their training covered.
        guide?.lock()
        guide?.setVisible(false, animated: true)

        // Capture the inspection distance now so computeCurrentCell() uses the
        // same geometry as the flat-face node positions in TrainingDomeGuide.
        //
        // `axis` points from the TAG toward the camera (see below), so
        // faceCenter = tagPos + axis * d lands exactly ON the camera when
        // d == dist, and BEYOND the camera (behind the Author, away from
        // the tag) when d > dist. To actually pull the disc in front of
        // the Author — between them and the tag, inside their view — d
        // must be SMALLER than the raw distance, not larger. Floor it at
        // kMinDist so the disc never collapses onto the tag itself.
        let d: Float
        if let forced = forcedDistanceM {
            // #65: reuse the Pass-state's locked distance verbatim so the
            // Fail-state dome is identical in size/position rather than
            // being re-measured from wherever the Author happens to be
            // standing for this second capture session.
            d = forced
        } else {
            let rawDist = guide?.currentDistanceM ?? 0.3
            d = max(ConeARGuide.kMinDist, rawDist - Self.kForwardOffsetM)
        }
        lockedDistanceM = d

        // Sweet-spot aperture for sphere placement — narrower than the full
        // acceptance cone so all 19 nodes sit inside the boundary rather than
        // spreading out to its edge. currentApertureDeg (and the
        // cone_aperture_deg stored for Operator mode) is untouched.
        let placementApertureDeg = currentApertureDeg * Self.kSweetSpotFactor
        lockedApertureDeg = placementApertureDeg

        // Spawn flat-face disc — 19 sphere nodes packed on the face plane so
        // adjacent spheres just touch.  Author holds at distance and slides.
        domeGuide?.cleanup()
        domeGuide = TrainingDomeGuide(
            sceneView:   svHolder.sceneView,
            tagPos:      tagPos,
            axis:        axis,
            right:       right,
            up:          upDir,
            apertureDeg: placementApertureDeg,
            distanceM:   d
        )

        // Reset sweep accumulator
        capturedCells     = []
        capturedFrames    = []
        currentHexCell    = nil
        cellHoldStart     = nil
        sweepHoldProgress = 0
        outOfConeZone     = false
        uploadError       = nil

        phase = .sweeping
    }

    // ── Finish & upload ───────────────────────────────────────────────────────

    private func finishSweep() {
        guard capturedFrames.count >= minCaptures else { return }
        phase = .uploading
        Task { await uploadAllFrames() }
    }

    private func uploadAllFrames() async {
        let client = SIBClient(settings: settings)
        let encKey = appState.anchorEncryptionKey
                     ?? AnchorEncryption.getOrCreateKey(for: anchor.id)
        if appState.anchorEncryptionKey == nil { appState.anchorEncryptionKey = encKey }

        let now = ISO8601DateFormatter().string(from: Date())

        // Build one PassStateImage per captured frame
        var psImages: [PassStateImage] = []
        var featurePrints: [TagFeaturePrint] = []
        // PartCheck only: center-crop feature prints — sensitive to part presence/absence.
        // Stored separately from feature_prints so the full-frame metric is preserved
        // for other tag types.  See OperatorModeView.applyFeaturePrintValidation.
        var centerCropPrints: [TagFeaturePrint] = []

        for frame in capturedFrames {
            guard let img = frame.image,
                  let jpeg = img.jpegData(compressionQuality: 0.65) else { continue }
            let payload = (try? AnchorEncryption.encrypt(
                imageBase64: jpeg.base64EncodedString(), using: encKey))
                ?? jpeg.base64EncodedString()
            psImages.append(PassStateImage(
                id: nil, tagId: tag.id, anchorId: anchor.id,
                assetId: anchor.assetId, imageBase64: payload,
                mimeType: "image/jpeg",
                pose: CameraPose(position: .zero, rotation: .identity),
                capturedAt: now))

            // Extract full-frame feature print
            if let fp = await TagFeaturePrint.extract(from: img) {
                featurePrints.append(fp)
            }

            // PartCheck: also extract center-50%-crop feature print.
            // At the correct inspection distance the physical part fills the
            // centre of the frame; the crop isolates it from background.
            if tag.type == .partCheck {
                let cropped = centerCrop(of: img, fraction: 0.50)
                if let ccFP = await TagFeaturePrint.extract(from: cropped) {
                    centerCropPrints.append(ccFP)
                }
            }
        }

        guard !psImages.isEmpty else {
            uploadError = "No frames captured — please try again."
            phase = .sweeping; return
        }

        // Upload all images in a single multi-image request
        do {
            try await client.trainPassState(
                CreatePassStateRequest(tagId: tag.id, anchorId: anchor.id,
                                       assetId: anchor.assetId, state: state, images: psImages))
        } catch {
            uploadError = "Upload failed: \(friendlyMessage(for: error))" // #75: actionable copy
            phase = .sweeping; return
        }

        // Fail-state training is a second, independent reference for the SAME
        // tag — geometry (cone quaternion/aperture/distance), depth, and the
        // primary feature-print keys were already written when the Pass-state
        // was trained, so skip all of that here and only stash the Fail-state's
        // own feature prints under parallel `fail_*` keys for the Operator's
        // client-side validation to optionally consult.
        if state == .fail {
            var meta: [String: AnyCodable] = tag.metadata
            if !featurePrints.isEmpty {
                meta["fail_feature_prints"] = AnyCodable(featurePrints.map { $0.base64 })
                let calibMaxDist = TagFeaturePrint.calibratedMaxDist(for: featurePrints)
                meta["fail_fp_max_dist"] = AnyCodable(Double(calibMaxDist))
            }
            if tag.type == .partCheck && !centerCropPrints.isEmpty {
                meta["fail_part_check_center_fps"] = AnyCodable(centerCropPrints.map { $0.base64 })
                let ccMaxDist = TagFeaturePrint.calibratedMaxDist(for: centerCropPrints)
                meta["fail_part_check_fp_max_dist"] = AnyCodable(Double(ccMaxDist))
            }
            if !meta.isEmpty {
                _ = try? await client.updateTag(
                    id: tag.id,
                    req: UpdateTagRequest(label: nil, expectedOutcome: nil,
                                          checkDescription: nil, order: nil, metadata: meta))
            }

            // Fail-state capture reuses the same dome/cone guide as the Pass
            // capture — bring the cone back for the success overlay and stop;
            // none of the Pass-only geometry/depth metadata below applies.
            guide?.setVisible(true, animated: false)
            withAnimation { phase = .done }
            return
        }

        // Store cone quaternion + all feature prints in tag metadata.
        // Seed from the full existing tag metadata so that position fields
        // (anchor_rel_x/y/z, pos_x/y/z) set by AddTagSheet are never lost,
        // regardless of whether the server deep-merges or replaces on PATCH.
        var meta: [String: AnyCodable] = tag.metadata
        if let g = guide, let at = parentArManager.lockedAnchorTransform {
            let q = g.anchorRelativeQuaternion(anchorTransform: at)
            meta["cone_qx"]           = AnyCodable(Double(q.vector.x))
            meta["cone_qy"]           = AnyCodable(Double(q.vector.y))
            meta["cone_qz"]           = AnyCodable(Double(q.vector.z))
            meta["cone_qw"]           = AnyCodable(Double(q.vector.w))
            meta["cone_aperture_deg"] = AnyCodable(Double(currentApertureDeg))
            meta["cone_dist_m"]       = AnyCodable(Double(guide?.currentDistanceM ?? 0.3))
        }
        if let d = capturedDepth {
            meta["cone_depth_map"]      = AnyCodable(d.base64)
            meta["cone_depth_width"]    = AnyCodable(d.width)
            meta["cone_depth_height"]   = AnyCodable(d.height)
            meta["cone_depth_is_lidar"] = AnyCodable(d.isLiDAR)
        }
        // Store all feature prints as a JSON array — OperatorModeView
        // applyFeaturePrintValidation already iterates this array and picks
        // the best matching print. More prints = better multi-angle coverage.
        if !featurePrints.isEmpty {
            meta["feature_prints"] = AnyCodable(featurePrints.map { $0.base64 })

            // Per-tag calibrated distance ceiling: max pairwise distance among
            // training prints × 2.5 safety factor for cross-session variance.
            // Stored as fp_max_dist so Operator scoring self-calibrates to how
            // visually variable this component is across training viewpoints.
            let calibMaxDist = TagFeaturePrint.calibratedMaxDist(for: featurePrints)
            meta["fp_max_dist"] = AnyCodable(Double(calibMaxDist))
            print("[ConeCaptureView] '\(tag.label)': \(featurePrints.count) FPs, fp_max_dist=\(String(format: "%.3f", calibMaxDist))")
        }

        // PartCheck: store center-crop feature prints under a separate key.
        // At the correct inspection distance the physical part fills the central
        // 50 % of the frame; the crop isolates the part from background clutter.
        // OperatorModeView.applyFeaturePrintValidation reads part_check_center_fps
        // and uses the center-crop comparison as the authoritative pass/fail signal,
        // bypassing the full-frame SSIM which can score high even when the part
        // is missing (because the background looks similar to the training images).
        if tag.type == .partCheck && !centerCropPrints.isEmpty {
            meta["part_check_center_fps"] = AnyCodable(centerCropPrints.map { $0.base64 })
            // Calibrated ceiling for the center-crop metric (same logic as full-frame).
            let ccMaxDist = TagFeaturePrint.calibratedMaxDist(for: centerCropPrints)
            meta["part_check_fp_max_dist"] = AnyCodable(Double(ccMaxDist))
            print("[ConeCaptureView] PartCheck '\(tag.label)': \(centerCropPrints.count) center-crop FPs, cc_fp_max_dist=\(String(format: "%.3f", ccMaxDist))")
        }

        _ = try? await client.updateTag(
            id: tag.id,
            req: UpdateTagRequest(label: nil, expectedOutcome: nil,
                                  checkDescription: nil, order: nil, metadata: meta))

        // Bring cone back so the success overlay shows the trained region
        guide?.setVisible(true, animated: false)
        withAnimation { phase = .done }
    }

    // ── Raw camera capture (zero AR artifacts) ────────────────────────────────
    //
    // Down-samples to 800 px on the longest dimension before returning.
    // Full-sensor frames (~12 MP on modern iPhones) are far larger than needed
    // for feature-print training and cause "Payload Too Large" on upload.
    // 800 px gives plenty of detail for VNGenerateImageFeaturePrint.

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
    /// Returns a center crop of `image` at `fraction` × `fraction` of its size.
    /// Used for PartCheck training to isolate the part from background edges.
    private func centerCrop(of image: UIImage, fraction: CGFloat) -> UIImage {
        let size  = image.size
        let cropW = size.width  * fraction
        let cropH = size.height * fraction
        let cropX = (size.width  - cropW) / 2
        let cropY = (size.height - cropH) / 2
        let rect  = CGRect(x: cropX * image.scale, y: cropY * image.scale,
                           width: cropW * image.scale, height: cropH * image.scale)
        guard let cg = image.cgImage, let cropped = cg.cropping(to: rect) else { return image }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }

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

    // ── Guide spawn ───────────────────────────────────────────────────────────

    private func spawnGuide() {
        guard guide == nil,
              let frame = svHolder.sceneView.session.currentFrame,
              let anchorTransform = parentArManager.lockedAnchorTransform
        else { return }

        let computedTagPos: simd_float3
        if let rx = metaD(tag.metadata["anchor_rel_x"]),
           let ry = metaD(tag.metadata["anchor_rel_y"]),
           let rz = metaD(tag.metadata["anchor_rel_z"]) {
            computedTagPos = ARCoordinateFrame.toWorldSpace(
                anchorRelativePos: simd_float3(Float(rx), Float(ry), Float(rz)),
                anchorTransform: anchorTransform)
        } else {
            let fwd = simd_float3(-frame.camera.transform.columns.2.x,
                                   -frame.camera.transform.columns.2.y,
                                   -frame.camera.transform.columns.2.z)
            let cam = simd_float3(frame.camera.transform.columns.3.x,
                                   frame.camera.transform.columns.3.y,
                                   frame.camera.transform.columns.3.z)
            computedTagPos = cam + fwd * 0.3
        }

        tagWorldPos = computedTagPos
        guide = ConeARGuide(sceneView: svHolder.sceneView, tagWorldPosition: computedTagPos)
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [.black.opacity(0.72), .clear],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 140).allowsHitTesting(false)
            HStack(alignment: .center, spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2).foregroundStyle(.white, Color.black.opacity(0.4))
                }
                Spacer()
                VStack(spacing: 3) {
                    Text(tag.label).font(.subheadline.bold()).foregroundColor(.white).lineLimit(1)
                    HStack(spacing: 4) {
                        Image(systemName: tag.type.iconName).font(.system(size: 9))
                        Text(tag.type.displayName).font(.system(size: 10, weight: .semibold))
                        Text("· Cone").font(.system(size: 9, weight: .bold))
                        if phase == .sweeping {
                            Text("· \(capturedCells.count)/19 zones")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.yellow)
                        }
                    }
                    .foregroundStyle(tag.type.color)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.ultraThinMaterial, in: Capsule())
                }
                Spacer()
                Image(systemName: "lock.fill")
                    .font(.body).foregroundStyle(.green)
                    .padding(6).background(.ultraThinMaterial, in: Circle())
            }
            .padding(.horizontal, 20).padding(.top, 56)
        }
    }

    // ── Center content ────────────────────────────────────────────────────────

    @ViewBuilder
    private var centerContent: some View {
        switch phase {
        case .ready:
            VStack(spacing: 14) {
                ProgressView().tint(.white).scaleEffect(1.2)
                Text("Preparing cone guide…")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.75))
            }

        case .positioning:
            positioningHUD

        case .sweeping:
            sweepingHUD

        case .uploading:
            VStack(spacing: 10) {
                ProgressView().tint(.white).scaleEffect(1.3)
                Text("Training tag (\(capturedFrames.count) images)…")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.75))
            }

        case .done:
            EmptyView()
        }
    }

    // ── Positioning HUD ───────────────────────────────────────────────────────

    private var positioningHUD: some View {
        VStack(spacing: 12) {
            if outOfRange {
                Label(distanceM < ConeARGuide.kMinDist ? "Too close — step back"
                                                       : "Too far — step closer",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.bold()).foregroundStyle(.orange)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(.black.opacity(0.55), in: Capsule())
            }

            HStack(spacing: 20) {
                VStack(spacing: 3) {
                    Text("\(String(format:"%.0f", distanceM * 100)) cm")
                        .font(.system(size: 22, weight: .bold).monospacedDigit())
                        .foregroundStyle(outOfRange ? .orange : .white)
                    Text("distance").font(.caption2).foregroundStyle(.white.opacity(0.6))
                }
                Divider().frame(height: 32).background(.white.opacity(0.3))
                VStack(spacing: 3) {
                    Text("\(Int(currentApertureDeg))°")
                        .font(.system(size: 22, weight: .bold).monospacedDigit())
                        .foregroundStyle(.cyan)
                    Text("aperture").font(.caption2).foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))

            Text("Step into the inspection zone · Pinch to resize ring · Then slide across")
                .font(.caption).foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .animation(.easeInOut(duration: 0.2), value: outOfRange)
    }

    // ── Sweep HUD (minimal — 3D dome nodes drawn in AR scene via TrainingDomeGuide) ──

    private var sweepingHUD: some View {
        VStack(spacing: 12) {
            // Circular zone progress ring
            ZStack {
                Circle().stroke(.white.opacity(0.18), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: CGFloat(capturedCells.count) / 19.0)
                    .stroke(Color.green, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(response: 0.3), value: capturedCells.count)
                VStack(spacing: 1) {
                    Text("\(capturedCells.count)")
                        .font(.system(size: 26, weight: .bold).monospacedDigit())
                        .foregroundStyle(.white)
                    Text("/ 19").font(.caption2).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(width: 80, height: 80)
            .shadow(color: .black.opacity(0.4), radius: 8)

            Text(capturedCells.isEmpty
                 ? "Hold distance · slowly slide across each sphere"
                 : capturedCells.count < minCaptures
                 ? "Keep sliding — \(minCaptures - capturedCells.count) more zones needed"
                 : capturedCells.count < TrainingDomeGuide.nodeCount
                 ? "Tap Done or cover all 19 zones"
                 : "All 19 zones captured!")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)

            // Hold-to-capture progress bar
            if sweepHoldProgress > 0 && sweepHoldProgress < 1 {
                ProgressView(value: sweepHoldProgress)
                    .tint(.yellow)
                    .frame(width: 110)
                    .animation(.linear(duration: 0.05), value: sweepHoldProgress)
            }
        }
        .padding(.horizontal, 32)
    }

    // ── Bottom bar ────────────────────────────────────────────────────────────

    @ViewBuilder
    private var bottomBar: some View {
        VStack(spacing: 12) {
            if let err = uploadError {
                Text(err).font(.caption).foregroundStyle(.red)
                    .multilineTextAlignment(.center).padding(.horizontal, 28)
            }

            switch phase {
            case .ready:
                EmptyView()

            case .positioning:
                Button { startSweep() } label: {
                    Label("Start Training", systemImage: "camera.fill")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 18)
                }
                .buttonStyle(.borderedProminent)
                .tint(outOfRange ? .gray : tag.type.color)
                .controlSize(.large)
                .disabled(outOfRange)
                .padding(.horizontal, 24)

            case .sweeping:
                VStack(spacing: 8) {
                    Button { finishSweep() } label: {
                        Label("Done Training", systemImage: "checkmark.seal.fill")
                            .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 18)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(capturedCells.count >= minCaptures ? tag.type.color : .gray)
                    .controlSize(.large)
                    .disabled(capturedCells.count < minCaptures)
                    .padding(.horizontal, 24)

                    if capturedCells.count < minCaptures {
                        Text("Cover \(minCaptures - capturedCells.count) more zone\(minCaptures - capturedCells.count == 1 ? "" : "s") to enable Done")
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.45))
                    }
                }

            case .uploading, .done:
                EmptyView()
            }
        }
        .padding(.bottom, 48)
    }

    // ── Success overlay ───────────────────────────────────────────────────────

    @ViewBuilder
    private var successOverlay: some View {
        ZStack {
            Color.black.opacity(0.82).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 80)).foregroundStyle(tag.type.color)
                Text(state == .fail ? "Fail Reference Trained!" : "Tag Trained!")
                    .font(.title.bold()).foregroundColor(.white)
                Text("\"\(tag.label)\" — \(capturedFrames.count) angle\(capturedFrames.count == 1 ? "" : "s") captured across the cone.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center).padding(.horizontal, 32)
                Group {
                    if capturedDepth?.isLiDAR == true {
                        Label("LiDAR depth stored ✓", systemImage: "lidar.laser.burst")
                            .foregroundStyle(.green)
                    } else if capturedDepth != nil {
                        Label("Estimated depth (no LiDAR)", systemImage: "camera.metering.center.weighted")
                            .foregroundStyle(.orange)
                    } else {
                        Label("No depth — RGB + FP only", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
                .font(.caption.bold())

                // Optional follow-up steps — only offered after training the
                // PRIMARY Pass-state. Both are entirely skippable; skipping
                // leaves the tag validating exactly as it did before this
                // feature existed (full-frame, Pass-only).
                if state == .pass {
                    VStack(spacing: 10) {
                        Button {
                            showRoiPicker = true
                        } label: {
                            Label("Mark Inspection Region (Optional)", systemImage: "viewfinder")
                                .font(.subheadline.bold())
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                        }
                        .buttonStyle(.bordered)
                        .tint(.white)

                        Button {
                            showFailCapture = true
                        } label: {
                            Label("Train Fail State (Optional)", systemImage: "xmark.seal")
                                .font(.subheadline.bold())
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                        }
                        .buttonStyle(.bordered)
                        .tint(.orange)

                        if roiSaving {
                            ProgressView().tint(.white)
                        }
                        if let roiErr = roiSaveError {
                            Text(roiErr).font(.caption2).foregroundStyle(.red)
                        }
                    }
                    .padding(.horizontal, 28)
                }

                Button("Done") { onTrained(tag.id); dismiss() }
                    .buttonStyle(.borderedProminent).tint(tag.type.color).controlSize(.large)
            }
        }
        .transition(.opacity)
        .fullScreenCover(isPresented: $showFailCapture) {
            // #65: pass this Pass-state capture's already-locked sphere
            // distance through so the Fail-state dome matches it exactly.
            ConeCaptureView(tag: tag, anchor: anchor, parentArManager: parentArManager,
                            onTrained: { _ in showFailCapture = false }, state: .fail,
                            forcedDistanceM: lockedDistanceM)
                .environmentObject(settings).environmentObject(appState)
        }
        .fullScreenCover(isPresented: $showRoiPicker) {
            if let refImage = capturedFrames.first(where: { $0.image != nil })?.image {
                ROIPickerView(referenceImage: refImage, tagLabel: tag.label, accentColor: tag.type.color) { roi in
                    guard let roi else { return }
                    Task { await saveRoi(roi) }
                }
            }
        }
    }

    // ── Save ROI ──────────────────────────────────────────────────────────────

    private func saveRoi(_ roi: RegionOfInterest) async {
        roiSaving = true
        roiSaveError = nil
        let client = SIBClient(settings: settings)
        do {
            _ = try await client.updateTag(
                id: tag.id,
                req: UpdateTagRequest(label: nil, expectedOutcome: nil,
                                      checkDescription: nil, order: nil,
                                      roi: roi, metadata: nil))
        } catch {
            roiSaveError = "Couldn't save region: \(error.localizedDescription)"
        }
        roiSaving = false
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func metaD(_ any: AnyCodable?) -> Double? {
        guard let any else { return nil }
        if let d = any.value as? Double { return d }
        if let i = any.value as? Int    { return Double(i) }
        return nil
    }
}

// ── ConePositioningHint ───────────────────────────────────────────────────────
// Shown during the .positioning phase to teach pinch-to-resize and distance control.
// Auto-dismisses after 6 seconds; also has a tap-to-dismiss × button.

private struct ConePositioningHint: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack {
            HStack(spacing: 10) {
                // Gesture icons
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.and.down")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.8))
                    Text("Move closer/farther to resize")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.85))
                }
                Text("·")
                    .foregroundStyle(.white.opacity(0.4))
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.8))
                    Text("Pinch to adjust cone size")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.85))
                }
                Spacer(minLength: 0)
                Button { onDismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.bold())
                        .foregroundStyle(.white.opacity(0.5))
                        .padding(4)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.black.opacity(0.55), in: Capsule())
            .padding(.horizontal, 16)
            .padding(.top, 8)

            Spacer()
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { onDismiss() }
        }
    }
}

// ── ConeSweepHint ─────────────────────────────────────────────────────────────
// Shown when the sweep phase begins to explain the auto-capture mechanic.
// Auto-dismisses after 5 seconds.

private struct ConeSweepHint: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.caption.bold())
                    .foregroundStyle(.yellow)
                Text("Move slowly to aim at each zone — hold steady to capture")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.9))
                Spacer(minLength: 0)
                Button { onDismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.bold())
                        .foregroundStyle(.white.opacity(0.5))
                        .padding(4)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.black.opacity(0.55), in: Capsule())
            .padding(.horizontal, 16)
            .padding(.top, 8)

            Spacer()
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { onDismiss() }
        }
    }
}
