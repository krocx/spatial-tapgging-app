// DemoSceneGestures.swift
//
// Pinch and twist on the AR view while a guide is shown as a demo copy
// (ARGuideSessionView, demo placement). Installed only for a demo and
// removed with the view, so the real Operator session never sees them.
// Deltas are reported per gesture change; the view owns the state.

import UIKit

final class DemoSceneGestures: NSObject, UIGestureRecognizerDelegate {

    var onScale:  ((Float) -> Void)? = nil    // multiplicative factor since the last change
    var onRotate: ((Float) -> Void)? = nil    // radians since the last change (screen clockwise = positive)

    private weak var view: UIView?
    private let pinch  = UIPinchGestureRecognizer()
    private let rotate = UIRotationGestureRecognizer()
    private var lastScale: CGFloat = 1
    private var lastRotation: CGFloat = 0

    init(view: UIView) {
        self.view = view
        super.init()
        pinch.addTarget(self, action: #selector(handlePinch(_:)))
        rotate.addTarget(self, action: #selector(handleRotate(_:)))
        pinch.delegate = self; rotate.delegate = self
        view.addGestureRecognizer(pinch)
        view.addGestureRecognizer(rotate)
    }

    func remove() {
        view?.removeGestureRecognizer(pinch)
        view?.removeGestureRecognizer(rotate)
    }

    /// Pinch and twist at the same time.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began: lastScale = 1
        case .changed:
            let factor = g.scale / max(lastScale, 0.0001)
            lastScale = g.scale
            onScale?(Float(factor))
        default: break
        }
    }

    @objc private func handleRotate(_ g: UIRotationGestureRecognizer) {
        switch g.state {
        case .began: lastRotation = 0
        case .changed:
            let delta = g.rotation - lastRotation
            lastRotation = g.rotation
            onRotate?(Float(delta))
        default: break
        }
    }
}
