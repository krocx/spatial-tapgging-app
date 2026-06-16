// QRScannerService.swift — Phase 2A
// Detects QR codes in ARKit camera frames using Vision framework.
// Requires STABILIZATION_FRAMES consecutive frames with the same payload
// before firing onDetected — eliminates single-frame false positives.

import Vision
import ARKit

/// corners: 4 points in Vision normalised coordinates (0-1, bottom-left origin, y-up).
/// Convert to screen: x' = x * viewW,  y' = (1 - y) * viewH
typealias QRDetectionCallback = @MainActor (QRAnchorContext, CGRect, [CGPoint]) -> Void
typealias QRLostCallback      = @MainActor () -> Void

final class QRScannerService {

    private let stabilizationFrames = 6
    private var consecutiveCount = 0
    private var lastPayload: String?
    private var isProcessing = false
    private let queue = DispatchQueue(label: "com.spatial.qr-scanner", qos: .userInitiated)

    var onDetected: QRDetectionCallback?
    var onLost:     QRLostCallback?

    // Call from ARSessionDelegate / ARSCNViewDelegate on every frame.
    func processFrame(_ frame: ARFrame) {
        guard !isProcessing, !isPaused else { return }
        isProcessing = true
        let pixelBuffer = frame.capturedImage
        let orientation = exifOrientation()
        queue.async { [weak self] in self?.detect(in: pixelBuffer, orientation: orientation) }
    }

    func pause()  { isPaused = true;  consecutiveCount = 0; lastPayload = nil }
    func resume() { isPaused = false; consecutiveCount = 0; lastPayload = nil }

    private var isPaused = false

    // ── Detection ─────────────────────────────────────────────────────────────

    private func detect(in buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) {
        defer { isProcessing = false }

        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: orientation, options: [:])

        do { try handler.perform([request]) } catch { handleNoDetection(); return }

        guard
            let qr = (request.results as? [VNBarcodeObservation])?.first(where: { $0.symbology == .qr }),
            let payload = qr.payloadStringValue
        else { handleNoDetection(); return }

        if payload == lastPayload { consecutiveCount += 1 }
        else { consecutiveCount = 1; lastPayload = payload }

        guard consecutiveCount >= stabilizationFrames,
              let context = decodePayload(payload)
        else { return }

        let bbox = qr.boundingBox
        // Derive the 4 corners from the axis-aligned bounding box.
        // Vision coordinates: bottom-left origin, y-up, normalised [0,1].
        // Order: bottom-left, bottom-right, top-right, top-left (clockwise).
        let corners: [CGPoint] = [
            CGPoint(x: bbox.minX, y: bbox.minY),
            CGPoint(x: bbox.maxX, y: bbox.minY),
            CGPoint(x: bbox.maxX, y: bbox.maxY),
            CGPoint(x: bbox.minX, y: bbox.maxY),
        ]
        Task { @MainActor [weak self] in self?.onDetected?(context, bbox, corners) }
    }

    private func handleNoDetection() {
        guard consecutiveCount > 0 else { return }
        consecutiveCount = 0; lastPayload = nil
        Task { @MainActor [weak self] in self?.onLost?() }
    }

    private func decodePayload(_ raw: String) -> QRAnchorContext? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(QRAnchorContext.self, from: data)
    }

    // ARKit capturedImage is always landscape-right regardless of device orientation.
    // Map to CGImagePropertyOrientation so Vision processes the image upright.
    private func exifOrientation() -> CGImagePropertyOrientation {
        switch UIDevice.current.orientation {
        case .portraitUpsideDown: return .left
        case .landscapeLeft:      return .down
        case .landscapeRight:     return .up
        default:                  return .right   // portrait — most common in cleanroom
        }
    }
}
