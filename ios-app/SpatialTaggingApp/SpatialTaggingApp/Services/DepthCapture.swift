// DepthCapture.swift
//
// Captures and compares depth maps from ARKit for cone-based inspection.
//
// ── Data sources ──────────────────────────────────────────────────────────────
// LiDAR  (iPhone 12 Pro+, iPad Pro): ARFrame.sceneDepth   — dense, ±1–5 mm
// Non-LiDAR (all A12+ devices):      ARFrame.estimatedDepthData — ML-estimated,
//                                    ±10–30 mm, lower resolution
//
// The isLiDAR flag is stored alongside the depth map so the comparison engine
// can apply the correct tolerance and weighting.
//
// ── Storage format ────────────────────────────────────────────────────────────
// Depth values are clamped to [kMinDepth, kMaxDepth] metres and normalised to
// [0, 1] as Float32.  The resulting array is stored as raw bytes → base64 in
// tag.metadata["cone_depth_map"].  Width, height and isLiDAR are stored as
// separate metadata keys so the map can be reconstructed exactly.
//
// ── Comparison ────────────────────────────────────────────────────────────────
// score = 1 − mean(|a_i − b_i|) / kTolerance
// Tolerance differs by source:
//   LiDAR → 0.05 (5 % of the normalised range ≈ fine surface changes)
//   Estimated → 0.15 (15 % — coarser, accounts for ML estimation noise)
//
// ── Multi-anchor readiness ────────────────────────────────────────────────────
// Depth maps are captured from the cone's inspection angle and stored
// alongside the cone quaternion in anchor-relative metadata.  No changes
// needed when multi-anchor is implemented — the cone quaternion determines
// the comparison angle, not the world origin.

import ARKit
import simd

struct DepthCapture {

    let normalised: [Float]   // depth values normalised to [0, 1]
    let width:      Int
    let height:     Int
    let isLiDAR:    Bool

    // ── Constants ─────────────────────────────────────────────────────────────

    private static let kMinDepth: Float  = 0.10    // 10 cm — below this is noise
    private static let kMaxDepth: Float  = 5.00    // 5 m   — beyond this is background
    private static let kLiDARTol: Double = 0.05    // tolerance for LiDAR comparison
    private static let kEstTol:   Double = 0.15    // tolerance for estimated depth

    // ── Capture ───────────────────────────────────────────────────────────────

    /// Capture a depth map from the current ARKit frame.
    /// Prefers sceneDepth (LiDAR) and falls back to estimatedDepthData.
    /// Returns nil if neither is available (A11 or older devices).
    static func capture(from frame: ARFrame) -> DepthCapture? {
        if let sd = frame.sceneDepth {
            return from(pixelBuffer: sd.depthMap, isLiDAR: true)
        }
        if let ed = frame.estimatedDepthData {
            return from(pixelBuffer: ed, isLiDAR: false)
        }
        return nil
    }

    /// True if the current device and session can supply LiDAR depth.
    static func isLiDARAvailable(frame: ARFrame) -> Bool {
        frame.sceneDepth != nil
    }

    // ── Comparison ────────────────────────────────────────────────────────────

    /// Similarity score 0 → 1.  Values near 1 mean the depth maps are almost
    /// identical (same component, same geometry, same distance from camera).
    func similarity(to other: DepthCapture) -> Double {
        guard normalised.count == other.normalised.count,
              normalised.count > 0 else { return 0 }

        let tolerance = isLiDAR ? Self.kLiDARTol : Self.kEstTol

        var sum: Double = 0
        for i in 0..<normalised.count {
            sum += abs(Double(normalised[i]) - Double(other.normalised[i]))
        }
        let mad = sum / Double(normalised.count)   // mean absolute difference
        return max(0, min(1, 1 - mad / tolerance))
    }

    // ── Serialisation ─────────────────────────────────────────────────────────

    var base64: String {
        normalised.withUnsafeBytes { Data($0) }.base64EncodedString()
    }

    init?(base64 string: String, width: Int, height: Int, isLiDAR: Bool) {
        guard let data = Data(base64Encoded: string) else { return nil }
        let count = data.count / MemoryLayout<Float>.size
        guard count == width * height else { return nil }
        self.normalised = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        self.width      = width
        self.height     = height
        self.isLiDAR    = isLiDAR
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private init(normalised: [Float], width: Int, height: Int, isLiDAR: Bool) {
        self.normalised = normalised
        self.width      = width
        self.height     = height
        self.isLiDAR    = isLiDAR
    }

    private static func from(pixelBuffer: CVPixelBuffer, isLiDAR: Bool) -> DepthCapture? {
        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)
        guard w > 0, h > 0 else { return nil }

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        let stride  = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let fmt     = CVPixelBufferGetPixelFormatType(pixelBuffer)
        let isFloat = (fmt == kCVPixelFormatType_DepthFloat32 ||
                       fmt == kCVPixelFormatType_DisparityFloat32)

        var result = [Float](repeating: 0, count: w * h)
        let range  = kMaxDepth - kMinDepth

        for row in 0..<h {
            let rowPtr = base.advanced(by: row * stride)
            for col in 0..<w {
                let raw: Float
                if isFloat {
                    raw = rowPtr.advanced(by: col * 4)
                              .bindMemory(to: Float.self, capacity: 1).pointee
                } else {
                    // Disparity (1/depth) from estimatedDepthData on some iOS versions
                    let disp = rowPtr.advanced(by: col * 4)
                                    .bindMemory(to: Float.self, capacity: 1).pointee
                    raw = disp > 0 ? 1.0 / disp : kMaxDepth
                }
                let clamped   = max(kMinDepth, min(kMaxDepth, raw))
                result[row * w + col] = (clamped - kMinDepth) / range
            }
        }

        return DepthCapture(normalised: result, width: w, height: h, isLiDAR: isLiDAR)
    }
}
