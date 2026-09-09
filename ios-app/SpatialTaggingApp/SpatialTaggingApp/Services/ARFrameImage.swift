// ARFrameImage.swift — C (2026.4.46): orient raw camera frames to the SCREEN.
//
// ARFrame.capturedImage is always the sensor's landscape-right buffer. Every
// capture site used to rotate it with a hard-coded `.oriented(.right)`, i.e.
// "the screen is portrait". On an iPad Pro held landscape that produced
// reference photos rotated 90° from the live view: the validation ghost never
// lined up and the comparator scored rotated frames against each other.
//
// One rule now: rotate by the CURRENT interface orientation, so author and
// operator captures are both "what the screen showed" — comparable as long
// as both work in the same orientation (the floor workflow).

import ARKit
import CoreImage
import UIKit

enum ARFrameImage {

    /// The rotation that turns the sensor buffer into what the user sees.
    /// Safe from any thread: the interface orientation is read on the main
    /// thread (capture sites run from tickers and delegate callbacks too).
    static var screenOrientation: CGImagePropertyOrientation {
        let read: () -> CGImagePropertyOrientation = {
            MainActor.assumeIsolated {
                let io = UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .first(where: { $0.activationState == .foregroundActive })?
                    .interfaceOrientation ?? .portrait
                switch io {
                case .landscapeRight:      return .up      // home button right — sensor native
                case .landscapeLeft:       return .down
                case .portraitUpsideDown:  return .left
                default:                   return .right   // portrait
                }
            }
        }
        return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    }

    /// Raw sensor frame rotated to the screen, longest edge capped at `maxPx`.
    /// Zero AR artifacts (no pins, panels or ghosts) — the same for every site.
    static func screenOriented(_ frame: ARFrame, maxPx: CGFloat = 800) -> UIImage? {
        let ci  = CIImage(cvPixelBuffer: frame.capturedImage).oriented(screenOrientation)
        let ctx = CIContext(options: [.useSoftwareRenderer: false])
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return nil }
        let full = UIImage(cgImage: cg)
        let longest = max(full.size.width, full.size.height)
        guard longest > maxPx else { return full }
        let scale = maxPx / longest
        let size  = CGSize(width: (full.size.width * scale).rounded(), height: (full.size.height * scale).rounded())
        return UIGraphicsImageRenderer(size: size).image { _ in full.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
