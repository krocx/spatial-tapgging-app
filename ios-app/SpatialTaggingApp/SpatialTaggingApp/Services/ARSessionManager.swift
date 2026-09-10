// ARSessionManager.swift — Phase 3 (ARReferenceImage anchor + ARWorldMap persistence)
//
// ── Why ARReferenceImage instead of plane raycasts ────────────────────────────
// Previous approach: Vision decodes QR → screen point → ARKit plane raycast.
// Problem: the raycast hit point varies with camera angle, distance, and ARKit's
// plane-estimation accuracy → tag positions appear at different locations when
// scanned from different viewpoints.
//
// New approach (Task #51):
//  1. Vision detects QR → extracts corners and payload (including qrSizeCm)
//  2. Crop the QR image from ARFrame.capturedImage
//  3. Create ARReferenceImage with the cropped image + known physical width
//  4. Update ARWorldTrackingConfiguration.detectionImages (NO session reset)
//  5. ARKit fires ARImageAnchor.session(_:didAdd:) using PnP from the 4 corners
//     + camera intrinsics + physical size → accurate 6DOF pose ±2-5 mm
//  6. Apply gravity normalisation to ARImageAnchor.transform
//
// ── Why ARWorldMap persistence (Task #83) ────────────────────────────────────
// Problem: gravity normalisation (Task #36) fixes rotation but NOT translation.
// ARKit's monocular PnP solver estimates the QR centre position with ±5–15 mm
// error that varies with scan distance and angle → tags appear at slightly
// different world positions every fresh session from a different viewpoint.
//
// Fix: after QR lock, serialise the ARWorldMap and upload it to SIB.  On the
// NEXT session for the same anchor, download the saved map and pass it as
// config.initialWorldMap.  ARKit relocalizes the device into the original
// feature-point cloud so all subsequent sessions share the same world frame.
// Tags placed in session 1 appear at the correct world position in session 2
// regardless of where the operator is standing when they scan the QR.
//
// Relocalization flow:
//   startSessionWithWorldMap() → ARKit enters .limited(.relocalizing) tracking
//   User walks toward the anchor area → ARKit matches feature points → .normal
//   QR scan proceeds as normal and fires ARImageAnchor with the original transform.
//
// Timeout: if relocalizing for > 15 s (lights off, environment changed, etc.),
//   the session falls back to startSession() with a fresh world frame.
//
// Multi-anchor readiness: each ARImageAnchor.referenceImage.name == anchorId.
// When multi-anchor is implemented, we hold multiple pending contexts and match
// each ARImageAnchor by name → correct anchorId.

import ARKit
import SceneKit
import simd
import CoreImage
import UIKit

@MainActor
final class ARSessionManager: NSObject, ObservableObject {

    // ── Published ─────────────────────────────────────────────────────────────
    @Published var scanState: ScanState = .scanning
    @Published var lockedAnchorTransform: simd_float4x4? = nil
    @Published var trackingState: ARCamera.TrackingState = .notAvailable
    /// Current QR corner overlay positions (Vision normalised, y-up, bottom-left origin).
    /// AnchorScanView converts these to screen coordinates for the corner dots.
    @Published var detectedQRCorners: [CGPoint] = []
    /// True while ARKit is relocalizing into a previously saved ARWorldMap.
    /// QRScanGateView shows a "Relocalizing…" hint while this is true.
    @Published var isRelocalizing: Bool = false
    /// B1: how the last world-map relocalization ended. `.succeeded` means the
    /// session frame IS the saved map's frame; `.timedOut` means we fell back
    /// to a fresh frame (map data is meaningless in this session).
    enum RelocalizationOutcome { case succeeded, timedOut }
    @Published var relocalizationOutcome: RelocalizationOutcome? = nil
    /// B1: true when the origin was adopted from the SEALED map (not the live
    /// QR). While set, live ARImageAnchor refinement is ignored — otherwise a
    /// moved/re-stuck QR would drag every tag back to wherever it is now.
    @Published private(set) var mapIsOrigin: Bool = false
    /// B2: the detected reference object's pose in the current session frame
    /// (nil until ARKit finds it; refreshed as tracking refines). Views derive
    /// the QR / map frame from it through the stored calibration.
    @Published private(set) var objectTransform: simd_float4x4? = nil
    /// B2: reference objects every session configuration should detect.
    /// Set before startSession()/startSessionWithWorldMap(); survives re-runs.
    nonisolated(unsafe) private var detectionObjects: Set<ARReferenceObject> = []
    /// True between ARSessionDelegate's sessionWasInterrupted/sessionInterruptionEnded
    /// callbacks — e.g. a phone call, Control Center, or multitasking switch.
    /// #69: previously nothing observed these callbacks, so a capture or
    /// validation in flight during an interruption had no way to know its
    /// result might be against a stale/frozen frame. Author/Operator views
    /// watch this to cancel in-flight work and prompt the user to verify
    /// alignment once tracking resumes.
    @Published var isInterrupted: Bool = false

    // ── Internal ──────────────────────────────────────────────────────────────
    private(set) var sceneView = ARSCNView()
    private let qrScanner = QRScannerService()
    private var qrIndicatorNode: SCNNode?

    /// Context waiting for its ARImageAnchor to fire.
    /// nonisolated(unsafe): set on MainActor before reference image registration;
    /// read from ARKit delegate thread after ARImageAnchor fires — safe ordering.
    nonisolated(unsafe) private var pendingContext: QRAnchorContext? = nil
    /// The live ARImageAnchor returned by ARKit's PnP solver.
    /// Set from @MainActor in lockAnchor(); read from ARKit delegate thread
    /// in processImageAnchors() for continuous refinement — safe write-before-read ordering.
    nonisolated(unsafe) private var _lockedImageAnchor: ARImageAnchor? = nil
    /// Stability counter — needs unsafe because incremented from ARKit thread.
    nonisolated(unsafe) private var imageAnchorStableFrames = 0
    /// Collect per-frame pose observations during stabilisation and average them
    /// to reduce single-frame PnP noise before locking.
    nonisolated(unsafe) private var poseAccumulator: [simd_float4x4] = []
    /// Number of ARImageAnchor update callbacks to accumulate before locking.
    /// At ~20 ARKit anchor-update events/s this is ~1 second of smoothing.
    private let stableFramesRequired = 20

    // Throttle trackingState publishes — only fire when category changes
    nonisolated(unsafe) private var _lastTrackingCategory: Int8 = -1

    // ── Init ──────────────────────────────────────────────────────────────────
    override init() {
        super.init()
        sceneView.delegate         = self
        sceneView.session.delegate = self
        sceneView.autoenablesDefaultLighting = true
        // Black background prevents the white ARSCNView flash that appears
        // before ARKit acquires the camera feed (especially on first present).
        sceneView.backgroundColor = .black
        #if DEBUG
        sceneView.debugOptions = [.showFeaturePoints]
        #endif

        qrScanner.onDetected = { [weak self] context, visionBBox, corners in
            self?.handleQRDetected(context: context, visionBBox: visionBBox, corners: corners)
        }
        qrScanner.onLost = { [weak self] in
            if case .detected = self?.scanState { self?.scanState = .scanning }
            self?.detectedQRCorners = []
        }
    }

    // ── B2: reference object detection ────────────────────────────────────────

    /// Load the `.arobject` archive (from ReferenceObjectCache) for detection.
    /// Pass nil to stop detecting. Takes effect on the next session run.
    func setReferenceObject(_ archive: Data?, name: String) {
        objectTransform = nil
        guard let archive else { detectionObjects = []; return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ref-\(name).arobject")
        do {
            try archive.write(to: url, options: .atomic)
            let obj = try ARReferenceObject(archiveURL: url)
            obj.name = name
            detectionObjects = [obj]
            print("[ARSessionManager] Reference object loaded for detection (\(obj.rawFeaturePoints.points.count) pts)")
        } catch {
            detectionObjects = []
            print("[ARSessionManager] Reference object load failed: \(error.localizedDescription)")
        }
    }

    /// B2: re-base the session's world frame onto a stored data frame using
    /// the detected object. `objectPoseInFrame` is the object's pose in that
    /// frame (guide map, sealed QR frame…). After this call the session's
    /// world coordinates ARE that frame, so map-frame positions render as-is —
    /// no per-node transforms anywhere. Returns false if the object isn't
    /// detected yet.
    @discardableResult
    func rebaseWorld(objectPoseInFrame: simd_float4x4) -> Bool {
        guard let objT = objectTransform else { return false }
        // new world origin (in current world coords) = objT × inverse(objectPoseInFrame)
        let f = objT * simd_inverse(objectPoseInFrame)
        sceneView.session.setWorldOrigin(relativeTransform: f)
        objectTransform = objectPoseInFrame          // by construction, until ARKit refines
        relocalizationOutcome = .succeeded           // the data frame is reachable
        isRelocalizing = false
        // B2e: from here on the object IS the frame — watch it for movement.
        objectCalibratedPose  = objectPoseInFrame
        lastRebaseF           = f
        objectCandidate       = nil
        objectRedetectFailures = 0
        objectAwaitingRedetect = false
        objectTrackState      = .tracking
        startObjectWatchdog()
        print("[ARSessionManager] ✓ World re-based onto the data frame via reference object")
        return true
    }

    // ── B2e: movable equipment — re-detection watchdog ────────────────────────
    // ARKit never moves an ARObjectAnchor once it has been added; the only way
    // to notice that the chamber moved (gas line rolled aside, parts fitted) is
    // to remove the anchor and let ARKit detect the object again. The watchdog
    // does that every `redetectInterval` while the chamber's expected position
    // is on screen, compares the fresh pose with the calibrated one, and
    // re-bases the world only when two consecutive detections agree it moved
    // (false matches on symmetric shapes don't jump the pins). A manual
    // re-align — the user asked — accepts the first detection. Pins never move
    // silently: every automatic re-base bumps `objectRealignCount` so the view
    // toasts it with Undo.

    enum ObjectTrackState: Equatable {
        case idle        // no reference object in this session
        case searching   // not seen yet (or manual re-align in flight)
        case tracking    // seen; frame is the object's
        case outOfView   // expected position off screen — last known frame kept
        case stale       // in view but not recognised 3 cycles — shape changed?
    }
    @Published private(set) var objectTrackState: ObjectTrackState = .idle
    /// Bumped on every AUTOMATIC re-alignment; views toast + offer Undo.
    @Published private(set) var objectRealignCount = 0
    /// True while a manual re-align is in flight (views show the finder).
    @Published private(set) var objectRealignManual = false

    nonisolated(unsafe) private var objectAnchor: ARObjectAnchor? = nil
    private var objectCalibratedPose:  simd_float4x4? = nil
    private var objectWatchdog:        Task<Void, Never>? = nil
    private var objectCandidate:       simd_float4x4? = nil
    private var objectRedetectFailures = 0
    private var objectAwaitingRedetect = false
    private var lastRebaseF:           simd_float4x4? = nil
    private var autoRealignSuspended   = false
    private let redetectInterval: UInt64 = 8_000_000_000
    private let moveTolMetres:  Float = 0.02
    private let moveTolDegrees: Float = 2

    /// Manual "Re-align to chamber": drop the anchor and accept the next detection.
    func realignToObject() {
        guard objectCalibratedPose != nil else { return }
        autoRealignSuspended = false
        objectCandidate      = nil
        objectRealignManual  = true
        objectTrackState     = .searching
        removeObjectAnchor()
    }

    /// The session was handed to another manager (QR gate → mode view): that
    /// manager runs the watchdog now; this one must stop touching anchors.
    func stopObjectWatchdog() {
        objectWatchdog?.cancel(); objectWatchdog = nil
    }

    func cancelRealign() {
        objectRealignManual = false
        if objectTrackState == .searching { objectTrackState = .outOfView }
    }

    /// Undo the last automatic re-alignment (toast action). Auto re-align stays
    /// suspended until the user asks for a manual one — otherwise the watchdog
    /// would redo it eight seconds later.
    func undoLastRealign() {
        guard let f = lastRebaseF else { return }
        sceneView.session.setWorldOrigin(relativeTransform: simd_inverse(f))
        lastRebaseF          = nil
        autoRealignSuspended = true
        objectCandidate      = nil
        objectTrackState     = .tracking
        print("[ARSessionManager] ↩︎ Re-alignment undone — auto re-align suspended")
    }

    private func handleObjectPose(_ t: simd_float4x4, added: Bool) {
        guard let cal = objectCalibratedPose else {
            objectTransform = t             // not re-based yet — views take it from here
            if objectTrackState == .searching || objectTrackState == .idle { objectTrackState = .tracking }
            return
        }
        guard added else { return }         // refinements of a known anchor: ignore
        objectAwaitingRedetect = false
        objectRedetectFailures = 0
        let d = ARCoordinateFrame.poseDelta(t, cal)
        let moved = d.metres > moveTolMetres || d.degrees > moveTolDegrees
        if !moved {
            objectCandidate     = nil
            objectRealignManual = false
            objectTrackState    = .tracking
            return
        }
        if objectRealignManual {
            applyRealign(from: t, cal: cal)
            objectRealignManual = false
            return
        }
        if autoRealignSuspended { objectTrackState = .tracking; return }
        if let c = objectCandidate {
            let dc = ARCoordinateFrame.poseDelta(t, c)
            if dc.metres <= moveTolMetres && dc.degrees <= moveTolDegrees {
                objectCandidate = nil
                applyRealign(from: t, cal: cal)
                objectRealignCount += 1
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                print(String(format: "[ARSessionManager] ⟳ Chamber moved Δ %.0f cm · %.0f° — re-aligned", d.metres * 100, d.degrees))
                return
            }
        }
        objectCandidate = t
        removeObjectAnchor()                // second opinion, straight away
    }

    private func applyRealign(from t: simd_float4x4, cal: simd_float4x4) {
        let f = t * simd_inverse(cal)
        sceneView.session.setWorldOrigin(relativeTransform: f)
        lastRebaseF      = f
        objectTransform  = cal
        objectTrackState = .tracking
    }

    private func removeObjectAnchor() {
        guard let a = objectAnchor else { return }
        sceneView.session.remove(anchor: a)
        objectAnchor           = nil
        objectAwaitingRedetect = true
    }

    /// Is the calibrated object position inside the viewport (with a margin
    /// for its extent)? Off-screen we neither re-detect nor complain.
    private func expectedObjectOnScreen(_ cal: simd_float4x4) -> Bool {
        let p = cal.columns.3
        let proj = sceneView.projectPoint(SCNVector3(p.x, p.y, p.z))
        guard proj.z > 0, proj.z < 1 else { return false }
        let b = sceneView.bounds
        let mx = Float(b.width) * 0.2, my = Float(b.height) * 0.2
        return proj.x >= -mx && proj.x <= Float(b.width) + mx
            && proj.y >= -my && proj.y <= Float(b.height) + my
    }

    private func startObjectWatchdog() {
        objectWatchdog?.cancel()
        objectWatchdog = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: self?.redetectInterval ?? 8_000_000_000)
                guard let self, !Task.isCancelled, let cal = self.objectCalibratedPose else { return }
                let inView = self.expectedObjectOnScreen(cal)
                if self.objectAwaitingRedetect {
                    // Last cycle's detection never came back.
                    if inView {
                        self.objectRedetectFailures += 1
                        if self.objectRedetectFailures >= 3, !self.objectRealignManual { self.objectTrackState = .stale }
                    } else if self.objectTrackState == .tracking {
                        self.objectTrackState = .outOfView
                    }
                    continue
                }
                guard inView else {
                    if self.objectTrackState == .tracking { self.objectTrackState = .outOfView }
                    continue
                }
                self.removeObjectAnchor()
            }
        }
    }

    private func resetObjectTracking() {
        objectWatchdog?.cancel()
        objectWatchdog         = nil
        objectAnchor           = nil
        objectCalibratedPose   = nil
        objectCandidate        = nil
        objectRedetectFailures = 0
        objectAwaitingRedetect = false
        lastRebaseF            = nil
        autoRealignSuspended   = false
        objectRealignManual    = false
        objectTransform        = nil
        objectTrackState       = detectionObjects.isEmpty ? .idle : .searching
    }

    // ── Session control ───────────────────────────────────────────────────────

    func startSession() {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        config.detectionObjects = detectionObjects
        resetObjectTracking()
        sceneView.session.run(config, options: [.removeExistingAnchors, .resetTracking])
        imageAnchorStableFrames = 0
        pendingContext          = nil
        _lockedImageAnchor      = nil
        poseAccumulator         = []
        detectedQRCorners       = []
        lockedAnchorTransform   = nil
        isRelocalizing          = false
        relocalizationOutcome   = nil
        mapIsOrigin             = false
    }

    /// Start the AR session using a previously saved ARWorldMap so ARKit can
    /// relocalize the device into the original session's coordinate frame.
    ///
    /// When this succeeds, ARKit will restore all feature points from the
    /// saved map, and the QR scan will fire an ARImageAnchor at the same
    /// world transform as the original session — giving tag positions that are
    /// independent of where the operator is standing when they scan.
    ///
    /// If the NSKeyedUnarchiver cannot decode the data, falls back to startSession().
    /// A 15-second timeout also falls back to startSession() if ARKit cannot find
    /// enough matching feature points (changed lighting, moved equipment, etc.).
    func startSessionWithWorldMap(_ data: Data) {
        guard let worldMap = try? NSKeyedUnarchiver.unarchivedObject(
            ofClass: ARWorldMap.self, from: data) else {
            print("[ARSessionManager] Failed to decode ARWorldMap — starting fresh session")
            startSession()
            return
        }

        let config = ARWorldTrackingConfiguration()
        config.planeDetection   = [.horizontal, .vertical]
        config.initialWorldMap  = worldMap
        config.detectionObjects = detectionObjects
        resetObjectTracking()
        // ⚠️ Do NOT pass .resetTracking — that discards the initialWorldMap.
        // .removeExistingAnchors clears stale geometry; ARKit will re-add the
        // image anchors from the saved map as it relocalizes.
        sceneView.session.run(config, options: [.removeExistingAnchors])
        imageAnchorStableFrames = 0
        pendingContext          = nil
        _lockedImageAnchor      = nil
        poseAccumulator         = []
        detectedQRCorners       = []
        lockedAnchorTransform   = nil
        isRelocalizing          = true
        relocalizationOutcome   = nil
        mapIsOrigin             = false
        print("[ARSessionManager] Session started with saved ARWorldMap — relocalizing…")

        // Relocalization timeout: fall back to fresh session if ARKit hasn't
        // found enough matching feature points within 15 seconds.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard let self, self.isRelocalizing else { return }
            print("[ARSessionManager] Relocalization timeout (15 s) — falling back to fresh session")
            self.isRelocalizing = false
            self.startSession()
            self.relocalizationOutcome = .timedOut
        }
    }

    /// Serialise the current ARWorldMap and return it as Data.
    /// Call this after a successful QR lock, then upload via SIBClient.uploadWorldMap().
    /// Returns nil if the session cannot produce a world map (e.g. tracking limited).
    func saveCurrentWorldMap() async -> Data? {
        return await withCheckedContinuation { continuation in
            sceneView.session.getCurrentWorldMap { worldMap, error in
                guard let worldMap else {
                    print("[ARSessionManager] getCurrentWorldMap failed: \(error?.localizedDescription ?? "unknown")")
                    continuation.resume(returning: nil)
                    return
                }
                let data = try? NSKeyedArchiver.archivedData(
                    withRootObject: worldMap, requiringSecureCoding: true)
                if let data {
                    print("[ARSessionManager] ARWorldMap serialized (\(data.count / 1024) KB)")
                }
                continuation.resume(returning: data)
            }
        }
    }

    /// Link this ARSessionManager's sceneView to an already-running ARSession that
    /// was created by QRScanGateView and preserved in AppState.activeARSession.
    ///
    /// - Why: avoids resetTracking, keeping the world frame and all ARAnchors
    ///   (including the locked ARImageAnchor) alive and continuously updated.
    /// - After linking, processImageAnchors will resume publishing lockedAnchorTransform
    ///   updates as ARKit refines the QR pose each frame.
    /// - Parameter mapOrigin: B1 — pass `appState.sealedMapOrigin`. When set,
    ///   the sealed pose becomes `lockedAnchorTransform` and the live QR is NOT
    ///   restored as the origin (no per-frame refinement either).
    /// - Parameter objectCalibration: B2e — the gate re-based the world onto the
    ///   chamber's shape (`objectCalibration` = its pose in that frame). This
    ///   manager takes over the movement watchdog so tags follow the chamber
    ///   in Author / Operator mode too.
    func linkToExistingSession(_ session: ARSession, mapOrigin: simd_float4x4? = nil,
                               objectCalibration: simd_float4x4? = nil) {
        imageAnchorStableFrames = 0
        pendingContext          = nil
        poseAccumulator         = []

        sceneView.session = session
        // Become the new delegate so didUpdate/didAdd anchor callbacks flow here.
        session.delegate  = self

        if let objectCalibration {
            objectCalibratedPose = objectCalibration
            objectTransform      = objectCalibration
            objectAnchor         = session.currentFrame?.anchors.compactMap { $0 as? ARObjectAnchor }.first
            objectTrackState     = .tracking
            startObjectWatchdog()
        }

        if let mapOrigin {
            adoptMapOrigin(mapOrigin)
            return
        }

        // The session is already running — find the ARImageAnchor ARKit locked
        // during QRScanGateView and restore our local reference to it.
        // A short delay ensures the session delivers its first frame to us.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.restoreLockedImageAnchorFromSession()
        }
    }

    /// B1: make the SEALED map pose the origin for this session. The live
    /// ARImageAnchor stays in the session (drift checks may read it) but no
    /// longer drives `lockedAnchorTransform`.
    func adoptMapOrigin(_ pose: simd_float4x4) {
        mapIsOrigin           = true
        _lockedImageAnchor    = nil
        lockedAnchorTransform = pose
        print("[ARSessionManager] ✓ Origin adopted from sealed world map")
    }

    /// Searches the current session frame for an ARImageAnchor and restores
    /// lockedAnchorTransform from its live (gravity-normalised) pose.
    private func restoreLockedImageAnchorFromSession() {
        guard let anchors = sceneView.session.currentFrame?.anchors else {
            print("[ARSessionManager] restoreAnchor: no current frame — will wait for didUpdate")
            return
        }
        for anchor in anchors {
            guard let imageAnchor = anchor as? ARImageAnchor else { continue }
            _lockedImageAnchor    = imageAnchor
            let normalised        = ARCoordinateFrame.normalised(from: imageAnchor.transform)
            lockedAnchorTransform = normalised
            print("[ARSessionManager] ✓ Restored live ARImageAnchor from linked session (isTracked=\(imageAnchor.isTracked))")
            return
        }
        // No image anchor found yet — either not yet added or session just linked.
        // processImageAnchors will pick it up when didUpdate fires.
        print("[ARSessionManager] restoreAnchor: no ARImageAnchor in session yet")
    }

    func pauseSession() {
        objectWatchdog?.cancel(); objectWatchdog = nil
        sceneView.session.pause()
    }

    func resetScan() {
        scanState             = .scanning
        lockedAnchorTransform = nil
        mapIsOrigin           = false
        pendingContext        = nil
        _lockedImageAnchor    = nil
        poseAccumulator       = []
        detectedQRCorners     = []
        qrIndicatorNode?.removeFromParentNode()
        qrIndicatorNode = nil
        // #63: every successful detection — right anchor or wrong — runs through
        // lockAnchor(), which pauses qrScanner so it stops burning CPU once
        // locked. A wrong-QR result resets scanState back to .scanning here,
        // but without resuming the scanner too, isPaused stays true forever
        // and no future QR (including the correct one) is ever detected again
        // — the session looks alive but is permanently deaf to new codes.
        qrScanner.resume()
        startSession()
    }

    func disableQRScanning() { qrScanner.pause() }
    func enableQRScanning()  { qrScanner.resume() }

    // ── QR handler ────────────────────────────────────────────────────────────

    private func handleQRDetected(context: QRAnchorContext,
                                   visionBBox: CGRect,
                                   corners: [CGPoint]) {
        guard case .scanning = scanState else { return }
        guard case .normal = trackingState else {
            print("[ARSessionManager] QR detected but tracking not .normal — ignoring")
            return
        }

        scanState           = .detected(context)
        pendingContext      = context
        detectedQRCorners   = corners
        imageAnchorStableFrames = 0

        // ── Create ARReferenceImage from live camera frame ─────────────────────
        // This lets ARKit use its PnP solver to compute accurate 6DOF pose from
        // the QR's known physical dimensions, rather than a plane raycast.
        guard let frame = sceneView.session.currentFrame else {
            fallbackRaycast(context: context, visionBBox: visionBBox)
            return
        }

        if let refImage = makeReferenceImage(
            from: frame, corners: corners, physicalWidth: context.physicalWidth) {
            // Update the running session to detect this specific QR image.
            // .run() without .resetTracking preserves all existing anchors and
            // the current world map — we just add image detection capability.
            let config = ARWorldTrackingConfiguration()
            config.planeDetection   = [.horizontal, .vertical]
            config.detectionImages  = [refImage]
            config.maximumNumberOfTrackedImages = 1
            config.detectionObjects = detectionObjects
            sceneView.session.run(config, options: [])
            print("[ARSessionManager] ARReferenceImage registered (\(String(format:"%.0f", context.physicalWidth * 100)) cm) — waiting for ARImageAnchor")
        } else {
            print("[ARSessionManager] Could not create ARReferenceImage — falling back to raycast")
            fallbackRaycast(context: context, visionBBox: visionBBox)
        }
    }

    // ── ARReferenceImage construction ─────────────────────────────────────────

    /// Crops the QR region from the current ARFrame and creates an ARReferenceImage.
    /// The physical width drives ARKit's PnP solver — must match the printed size.
    private func makeReferenceImage(from frame: ARFrame,
                                    corners: [CGPoint],
                                    physicalWidth: CGFloat) -> ARReferenceImage? {
        guard corners.count == 4 else { return nil }

        let pixelBuffer = frame.capturedImage
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let imgW = CVPixelBufferGetWidth(pixelBuffer)
        let imgH = CVPixelBufferGetHeight(pixelBuffer)

        // Vision gives corners in bottom-left-origin, y-up normalised coords.
        // The capturedImage is always landscape; Vision corrects for orientation.
        // Map to pixel coords in the raw landscape image:
        //   px = corner.x * imgW   (x-axis: left → right, same)
        //   py = (1 - corner.y) * imgH  (y-axis: flip from VN bottom-up to image top-down)
        let pixels = corners.map { CGPoint(x: $0.x * CGFloat(imgW),
                                            y: (1 - $0.y) * CGFloat(imgH)) }
        let xs = pixels.map { $0.x }
        let ys = pixels.map { $0.y }
        let minX = max(0, xs.min()! - 8)
        let maxX = min(CGFloat(imgW), xs.max()! + 8)
        let minY = max(0, ys.min()! - 8)
        let maxY = min(CGFloat(imgH), ys.max()! + 8)
        let cropRect = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
        guard cropRect.width > 10, cropRect.height > 10 else { return nil }

        let ci         = CIImage(cvPixelBuffer: pixelBuffer)
        let cropped    = ci.cropped(to: cropRect)
        let ctx        = CIContext(options: [.useSoftwareRenderer: false])
        guard let cg   = ctx.createCGImage(cropped, from: cropped.extent) else { return nil }

        let refImage   = ARReferenceImage(cg, orientation: .up, physicalWidth: physicalWidth)
        refImage.name  = pendingContext?.anchorId  // used to match in didAdd
        return refImage
    }

    // ── Fallback: plane raycast (legacy, used when crop fails) ────────────────

    private func fallbackRaycast(context: QRAnchorContext, visionBBox: CGRect) {
        let size     = sceneView.bounds.size
        let screenPt = CGPoint(x: visionBBox.midX * size.width,
                               y: (1 - visionBBox.midY) * size.height)

        let transform: simd_float4x4
        if let query = sceneView.raycastQuery(from: screenPt, allowing: .estimatedPlane, alignment: .any),
           let hit   = sceneView.session.raycast(query).first {
            transform = hit.worldTransform
        } else if let frame = sceneView.session.currentFrame {
            var t = matrix_identity_float4x4
            t.columns.3 = frame.camera.transform * simd_float4(0, 0, -0.5, 1)
            transform = t
        } else { return }

        lockAnchor(at: transform, imageAnchor: nil, context: context)
    }

    // ── Locking ───────────────────────────────────────────────────────────────

    private func lockAnchor(at transform: simd_float4x4,
                             imageAnchor: ARImageAnchor?,
                             context: QRAnchorContext) {
        let normalised        = ARCoordinateFrame.normalised(from: transform)
        _lockedImageAnchor    = imageAnchor         // keep for continuous live refinement
        lockedAnchorTransform = normalised
        scanState             = .locked(context)
        pendingContext        = nil
        poseAccumulator       = []
        detectedQRCorners     = []
        qrScanner.pause()
        addIndicator(at: normalised)
        print("[ARSessionManager] Anchor locked ✓  anchorId=\(context.anchorId)  samples=\(stableFramesRequired)")
    }

    // ── Visual indicator ──────────────────────────────────────────────────────

    private func addIndicator(at transform: simd_float4x4) {
        qrIndicatorNode?.removeFromParentNode()
        let geo = SCNPlane(width: 0.08, height: 0.08)
        let mat = SCNMaterial()
        mat.diffuse.contents = UIColor.systemGreen.withAlphaComponent(0.5)
        mat.isDoubleSided = true
        geo.materials = [mat]
        let node = SCNNode(geometry: geo)
        node.simdWorldTransform = transform
        node.eulerAngles.x = -.pi / 2
        sceneView.scene.rootNode.addChildNode(node)
        node.runAction(.repeatForever(.sequence([
            .fadeOpacity(to: 0.1, duration: 0.8),
            .fadeOpacity(to: 0.6, duration: 0.8),
        ])))
        qrIndicatorNode = node
    }
}

// ── ARSCNViewDelegate ─────────────────────────────────────────────────────────

extension ARSessionManager: ARSCNViewDelegate {
    nonisolated func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        guard let frame = (renderer as? ARSCNView)?.session.currentFrame else { return }
        qrScanner.processFrame(frame)
    }
}

// ── ARSessionDelegate ─────────────────────────────────────────────────────────

extension ARSessionManager: ARSessionDelegate {

    // ── ARImageAnchor: the accurate pose we've been waiting for ───────────────
    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        processImageAnchors(anchors, added: true)
    }

    // Updated poses as ARKit refines its estimate — also count toward stability
    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        processImageAnchors(anchors, added: false)
    }

    private nonisolated func processImageAnchors(_ anchors: [ARAnchor], added: Bool) {

        // ── B2: reference object — publish its pose; B2e: a fresh detection
        // (didAdd) after calibration is a movement check.
        for anchor in anchors {
            guard let obj = anchor as? ARObjectAnchor else { continue }
            let t = obj.transform
            objectAnchor = obj
            Task { @MainActor [weak self] in self?.handleObjectPose(t, added: added) }
            break
        }

        // ── Case A: waiting for initial QR lock ───────────────────────────────
        if let ctx = pendingContext {
            for anchor in anchors {
                guard let imageAnchor = anchor as? ARImageAnchor,
                      imageAnchor.referenceImage.name == ctx.anchorId
                else { continue }

                imageAnchorStableFrames += 1
                // Accumulate pose observations for averaging.
                // ARKit already smooths its internal estimate per-frame, but
                // collecting ~1 s of samples and averaging the translation
                // removes the remaining jitter before we commit to a position.
                poseAccumulator.append(imageAnchor.transform)

                guard imageAnchorStableFrames >= stableFramesRequired else { continue }

                // Average translation across all accumulated frames.
                // Rotation uses the final frame's ARKit-smoothed value (SLERP
                // averaging of many quaternions adds negligible benefit here).
                let avgTransform = averagedTranslation(
                    poseAccumulator, rotationFrom: imageAnchor.transform)
                let ia = imageAnchor   // capture before Task
                Task { @MainActor [weak self] in
                    self?.lockAnchor(at: avgTransform, imageAnchor: ia, context: ctx)
                }
                break
            }
            return
        }

        // ── Case B: anchor already locked — continuous live refinement ────────
        // When the QR is visible, ARKit keeps updating the ARImageAnchor's
        // transform.  We republish the gravity-normalised pose so that
        // AuthorModeView / OperatorModeView can reposition tag nodes to match.
        // B1: never when the sealed map is the origin (adoptMapOrigin nils
        // _lockedImageAnchor, so this guard also covers that case).
        guard let lockedAnchor = _lockedImageAnchor else { return }
        for anchor in anchors {
            guard anchor === lockedAnchor,
                  let imageAnchor = anchor as? ARImageAnchor,
                  imageAnchor.isTracked
            else { continue }

            let normalised = ARCoordinateFrame.normalised(from: imageAnchor.transform)
            Task { @MainActor [weak self] in
                self?.lockedAnchorTransform = normalised
            }
            break
        }
    }

    // ── Pose averaging helper ─────────────────────────────────────────────────

    /// Average the translation columns of `samples`; keep `rotation`'s orientation.
    /// Using the median rather than mean makes it robust to occasional outlier frames.
    private nonisolated func averagedTranslation(_ samples: [simd_float4x4],
                                                  rotationFrom rotation: simd_float4x4) -> simd_float4x4 {
        guard !samples.isEmpty else { return rotation }
        let xs = samples.map { $0.columns.3.x }.sorted()
        let ys = samples.map { $0.columns.3.y }.sorted()
        let zs = samples.map { $0.columns.3.z }.sorted()
        let mid = samples.count / 2
        var result = rotation
        result.columns.3 = simd_float4(xs[mid], ys[mid], zs[mid], 1)
        return result
    }

    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let newState = frame.camera.trackingState
        let cat: Int8
        switch newState {
        case .notAvailable: cat = -1
        case .limited:      cat =  0
        case .normal:       cat =  1
        @unknown default:   cat = -1
        }
        guard cat != _lastTrackingCategory else { return }
        _lastTrackingCategory = cat
        Task { @MainActor [weak self] in
            self?.trackingState = newState
            // When ARKit reaches .normal after a world-map session, relocalization
            // has succeeded — clear the flag so QRScanGateView shows "scan QR" again.
            if cat == 1, self?.isRelocalizing == true {
                self?.isRelocalizing = false
                self?.relocalizationOutcome = .succeeded
                print("[ARSessionManager] ✓ Relocalization complete — tracking normal")
            }
        }
    }

    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        print("[ARSessionManager] failed: \(error.localizedDescription)")
    }

    // #69: fires on phone calls, Control Center, app-switcher gestures, etc.
    // The camera feed freezes/stops updating for the duration — any capture
    // or validation that completes "successfully" during this window is
    // scoring/training against a stale frame, not what's actually in view.
    nonisolated func sessionWasInterrupted(_ session: ARSession) {
        print("[ARSessionManager] session interrupted")
        Task { @MainActor [weak self] in
            self?.isInterrupted = true
        }
    }

    // ARKit resumes tracking automatically where possible; we only need to
    // clear the flag so views can prompt the user to re-verify alignment
    // before trusting the next capture/validation result.
    nonisolated func sessionInterruptionEnded(_ session: ARSession) {
        print("[ARSessionManager] session interruption ended")
        Task { @MainActor [weak self] in
            self?.isInterrupted = false
        }
    }
}
