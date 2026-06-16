// ARContainerView.swift — Phase 2B
// UIViewRepresentable bridge: puts the ARSCNView into the SwiftUI hierarchy.
// Supports an optional onTap closure for tap-to-place gestures.

import SwiftUI
import ARKit

struct ARContainerView: UIViewRepresentable {

    @ObservedObject var arManager: ARSessionManager
    var onTap: ((CGPoint) -> Void)? = nil

    // ── Coordinator ───────────────────────────────────────────────────────────

    final class Coordinator: NSObject {
        var onTap: ((CGPoint) -> Void)?

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view else { return }
            onTap?(gesture.location(in: view))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ARSCNView {
        let view = arManager.sceneView
        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        // Refresh closure on every SwiftUI re-render so captured state stays current
        context.coordinator.onTap = onTap
    }

    static func dismantleUIView(_ uiView: ARSCNView, coordinator: Coordinator) {
        uiView.session.pause()
    }
}
