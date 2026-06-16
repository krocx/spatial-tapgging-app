// TagFeaturePrint.swift
//
// Wraps Apple Vision's VNGenerateImageFeaturePrintRequest to produce viewpoint-
// invariant semantic embeddings for inspection images.
//
// ── Why this matters ──────────────────────────────────────────────────────────
// SSIM and histogram comparison are pixel-level metrics — they require the
// camera to be in nearly the same position as the training viewpoint.  In
// practice, Operators stand wherever is convenient and rarely match one of
// the 7 training positions exactly, causing confidence scores of 35–50 % on
// unchanged components.
//
// VNGenerateImageFeaturePrintRequest produces a compact embedding that captures
// WHAT the image depicts (shape, colour distribution, texture) rather than
// WHERE each pixel is.  The same component photographed from different angles
// produces embeddings with a small L2 distance; completely different components
// produce a large distance.  Apple uses this for "visually similar photos"
// search — exactly our use case.
//
// ── Architecture ─────────────────────────────────────────────────────────────
// Training  (HoneycombCaptureView): extract 7 feature prints → store as an
//   array of base64 strings in tag.metadata["feature_prints"].  No SIB
//   comparison logic changes needed.
//
// Validation (OperatorModeView): extract live-frame print → compare against
//   stored prints (best-of-7) → compute score → use max(ssim, fp_score) so
//   either metric passing the threshold is sufficient.
//
// ── Distance normalisation ────────────────────────────────────────────────────
// score = clamp(1 − distance / maxDist, 0, 1)
//
// kMaxDist = 2.0 — global fallback used when no per-tag calibration is stored.
// Cross-session comparisons (Author trains Monday, Operator inspects Tuesday)
// produce larger distances than same-session comparisons because of lighting
// variance, exact pose differences, and device orientation.  kMaxDist = 1.4
// was too tight: a same-component cross-session dist of 0.8 would yield a
// score of 0.43 (FAIL at 0.60 threshold).  With kMaxDist = 2.0:
//   dist 0.0 → score 1.00  (identical frame)
//   dist 0.4 → score 0.80  (same component, same session — clearly PASS)
//   dist 0.8 → score 0.60  (same component, cross-session — barely PASS)
//   dist 1.2 → score 0.40  (different component — FAIL)
//   dist ≥ 2.0 → score 0.00 (completely different content)
//
// Per-tag calibration (fp_max_dist in tag metadata): after training,
// calibratedMaxDist(for:) computes the max pairwise distance among training
// prints × 2.5 safety factor.  This self-tunes to how visually variable the
// component is across viewpoints, producing tighter thresholds for uniform
// components and looser thresholds for variable ones.
//
// The pass threshold can be adjusted via the existing slider in Operator mode.

import Vision
import UIKit

struct TagFeaturePrint {

    /// Raw float vector extracted from VNFeaturePrintObservation.
    /// Typically 512 Float32 values (2 048 bytes → ~2 730 base64 chars).
    let floats: [Float]

    // ── Distance normalisation constant ───────────────────────────────────────

    /// Global fallback distance at which score reaches 0.
    /// Per-tag calibrated values (fp_max_dist in metadata) override this.
    private static let kMaxDist: Float = 2.0

    // ── Extraction ────────────────────────────────────────────────────────────

    /// Compute a feature print for an image.
    /// Returns nil if Vision fails (unsupported hardware, bad image format, etc.).
    /// Runs Vision on a background thread; returns on the caller's async context.
    static func extract(from image: UIImage) async -> TagFeaturePrint? {
        guard let cgImage = image.cgImage else { return nil }

        return await withCheckedContinuation { cont in
            let request = VNGenerateImageFeaturePrintRequest { req, error in
                guard error == nil,
                      let obs = req.results?.first as? VNFeaturePrintObservation,
                      obs.elementType == .float,
                      obs.elementCount > 0
                else {
                    cont.resume(returning: nil)
                    return
                }

                let floats: [Float] = obs.data.withUnsafeBytes { rawPtr in
                    let typed = rawPtr.bindMemory(to: Float.self)
                    return Array(typed.prefix(obs.elementCount))
                }
                cont.resume(returning: TagFeaturePrint(floats: floats))
            }

            // Use the image's natural orientation so Vision aligns with what
            // the human sees (ARKit snapshots are portrait, orientation = up).
            let orientation: CGImagePropertyOrientation
            switch image.imageOrientation {
            case .up:            orientation = .up
            case .down:          orientation = .down
            case .left:          orientation = .left
            case .right:         orientation = .right
            case .upMirrored:    orientation = .upMirrored
            case .downMirrored:  orientation = .downMirrored
            case .leftMirrored:  orientation = .leftMirrored
            case .rightMirrored: orientation = .rightMirrored
            @unknown default:    orientation = .up
            }

            let handler = VNImageRequestHandler(cgImage: cgImage,
                                                orientation: orientation,
                                                options: [:])
            DispatchQueue.global(qos: .userInitiated).async {
                do    { try handler.perform([request]) }
                catch { cont.resume(returning: nil) }
            }
        }
    }

    // ── Comparison ────────────────────────────────────────────────────────────

    /// L2 (Euclidean) distance between this and another print.
    /// Matches the metric used by VNFeaturePrintObservation.computeDistance.
    func l2Distance(to other: TagFeaturePrint) -> Float {
        guard floats.count == other.floats.count else { return .infinity }
        var sum: Float = 0
        for i in 0..<floats.count {
            let d = floats[i] - other.floats[i]
            sum += d * d
        }
        return sqrt(sum)
    }

    /// Similarity score 0 → 1 of `live` against a bank of reference prints.
    ///
    /// Takes the minimum L2 distance across all references (best-of-N match),
    /// then normalises: score = clamp(1 − minDist / maxDist, 0, 1).
    ///
    /// - Parameter maxDist: Per-tag calibrated ceiling (from `calibratedMaxDist`
    ///   stored in metadata as `fp_max_dist`).  Pass nil to use the global
    ///   `kMaxDist` fallback.
    ///
    /// The Operator need not be at any specific training viewpoint — as long as
    /// they're looking at the same component the closest reference will match.
    static func bestScore(live: TagFeaturePrint,
                          references: [TagFeaturePrint],
                          maxDist: Float? = nil) -> Double {
        guard !references.isEmpty else { return 0 }
        let md      = maxDist ?? kMaxDist
        let minDist = references.map { live.l2Distance(to: $0) }.min() ?? md
        return Double(max(0, min(1, 1 - minDist / md)))
    }

    /// Compute a per-tag calibrated distance ceiling from a set of training prints.
    ///
    /// Finds the maximum pairwise L2 distance in the training set (intra-class
    /// spread), then scales by 2.5× to account for cross-session variance
    /// (different lighting, exact pose, device orientation at inspection time).
    /// Floored at 0.8 so very uniform components don't get a threshold so tight
    /// that any cross-session variance causes a false FAIL.
    ///
    /// Store the result in `tag.metadata["fp_max_dist"]` during training, then
    /// pass it to `bestScore(live:references:maxDist:)` during inspection.
    static func calibratedMaxDist(for prints: [TagFeaturePrint]) -> Float {
        guard prints.count >= 2 else { return kMaxDist }
        var maxPairwiseDist: Float = 0
        for i in 0..<prints.count {
            for j in (i + 1)..<prints.count {
                let d = prints[i].l2Distance(to: prints[j])
                if d > maxPairwiseDist { maxPairwiseDist = d }
            }
        }
        // 2.5× accounts for the cross-session variance that is not captured in
        // intra-training distances (which were all captured in a single Author
        // session with similar lighting and pose).
        return max(maxPairwiseDist * 2.5, 0.8)
    }

    // ── Serialisation ─────────────────────────────────────────────────────────

    /// Encode float vector as a base64 string for storage in tag metadata.
    /// 512 floats → 2 048 raw bytes → ~2 730 base64 characters.
    var base64: String {
        floats.withUnsafeBytes { rawPtr in
            Data(rawPtr).base64EncodedString()
        }
    }

    /// Reconstruct from a previously serialised base64 string.
    /// Returns nil if the data is malformed or empty.
    init?(base64 string: String) {
        guard let data = Data(base64Encoded: string) else { return nil }
        let count = data.count / MemoryLayout<Float>.size
        guard count > 0 else { return nil }
        floats = data.withUnsafeBytes { rawPtr in
            Array(rawPtr.bindMemory(to: Float.self).prefix(count))
        }
    }

    // ── Private init ──────────────────────────────────────────────────────────

    private init(floats: [Float]) { self.floats = floats }
}
