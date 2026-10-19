// PresenceScorer.swift - one frame against a step's trained presence (AROMS-351).
//
// The rule the operator runs (ARGuideSessionView.runConeValidation, and tag
// inspection in OperatorModeView): on-device Vision feature-print match
// against every reference on the hidden validation tag (tolerant of
// viewpoint) and the server's multi-reference SSIM (precise when the angle
// matches); the score is the better of the two; PASS at ≥ 0.60. The author's
// "Try it" uses this so what the author sees is what the operator gets.
// Nothing here records anything - /validate is a pure compare.
//
// Proprietary & Confidential · Applied Materials.

import UIKit

enum PresenceScorer {

    static let passThreshold: Double = 0.60

    struct Verdict {
        let score: Double
        let featurePrint: Double
        let ssim: Double
        /// The server could not be asked (offline / untrained) - the score is the on-device half alone.
        let serverUnavailable: Bool
        var pass: Bool { score >= passThreshold }
        /// Why, in the author's words.
        var words: String {
            if serverUnavailable && featurePrint == 0 { return "No reference reachable - the operator would be asked to confirm by hand." }
            if serverUnavailable { return "Server compare unavailable - on-device match only." }
            if pass { return "" }
            return score < 0.3 ? "Nothing like the reference from here - stand where the operator will." : "Close, but under the mark - try from the trained viewpoint, or retrain from this one."
        }
    }

    /// Score `image` against the step's trained presence. `tag` is the hidden
    /// validation tag (feature prints and ROI in its metadata), nil when unknown.
    static func score(image: UIImage, tag: Tag?, guideId: String, stepId: String, settings: AppSettings) async -> Verdict {
        var fp: Double = 0
        if let tag, let fpAny = tag.metadata["feature_prints"], let arr = fpAny.value as? [Any] {
            let refs = arr.compactMap { ($0 as? String).flatMap { TagFeaturePrint(base64: $0) } }
            let live = tag.roi.map { cropToROI(image, roi: $0) } ?? image
            if !refs.isEmpty, let print = await TagFeaturePrint.extract(from: live) {
                fp = TagFeaturePrint.bestScore(live: print, references: refs, maxDist: metaFloat(tag.metadata, "fp_max_dist"))
            }
        }
        var ssim: Double = 0
        var unavailable = false
        if let jpeg = image.jpegData(compressionQuality: 0.7) {
            do {
                ssim = try await SIBClient(settings: settings).validateStep(guideId: guideId, stepId: stepId, jpegBase64: jpeg.base64EncodedString()).score
            } catch {
                unavailable = true
                AppLog.warn("validation", "server compare unavailable: \(error.localizedDescription)")
            }
        }
        let best = max(fp, ssim)
        AppLog.info("validation", "trial fp=\(String(format: "%.3f", fp)) ssim=\(String(format: "%.3f", ssim)) → \(String(format: "%.3f", best))")
        return Verdict(score: best, featurePrint: fp, ssim: ssim, serverUnavailable: unavailable)
    }

    static func metaFloat(_ meta: [String: AnyCodable], _ key: String) -> Float? {
        guard let any = meta[key] else { return nil }
        if let d = any.value as? Double { return Float(d) }
        if let f = any.value as? Float  { return f }
        if let i = any.value as? Int    { return Float(i) }
        return nil
    }

    /// Author-marked inspection region, padded 10 % as OperatorModeView and
    /// the server do (task #74 - one crop convention platform-wide).
    static func cropToROI(_ image: UIImage, roi: RegionOfInterest) -> UIImage {
        let pad: CGFloat = 0.10
        let size = image.size
        let padW = CGFloat(roi.w) * size.width  * pad
        let padH = CGFloat(roi.h) * size.height * pad
        let x1 = max(0, CGFloat(roi.x) * size.width  - padW)
        let y1 = max(0, CGFloat(roi.y) * size.height - padH)
        let x2 = min(size.width,  CGFloat(roi.x + roi.w) * size.width  + padW)
        let y2 = min(size.height, CGFloat(roi.y + roi.h) * size.height + padH)
        let rect = CGRect(x: x1 * image.scale, y: y1 * image.scale,
                          width: max(1, x2 - x1) * image.scale, height: max(1, y2 - y1) * image.scale)
        guard let cg = image.cgImage, let cropped = cg.cropping(to: rect) else { return image }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }
}
