// ARFocusRing.swift
//
// iOS Measure App-style 3D focus ring for AuthorModeView tag placement.
// Replaces the 2D CrosshairView with a surface-aligned AR indicator.
//
// The ring is a flat SCNTorus that tracks detected AR surfaces in real time:
//
//   Tracking  — cyan ring sits flush on the surface, aligned to the surface
//               normal. Position is exponentially smoothed to reduce jitter.
//
//   Searching — white semi-transparent ring floats 0.25 m in front of the
//               camera, facing the user, while ARKit scans for a plane.
//               Pulses and spins to signal active scanning.
//
// `lastHitTransform` caches the most recent valid raycast result so the FAB
// button can place a tag at the ring's already-computed position without
// re-raycasting.
//
// Integration (AuthorModeView):
//   onAppear  → focusRing = ARFocusRing(sceneView: arManager.sceneView)
//   updateCrosshair() → focusRing?.update(sceneView: arManager.sceneView)
//   FAB tap   → use focusRing?.lastHitTransform, fallback to fresh raycast
//   onDisappear → focusRing?.cleanup(); focusRing = nil

import ARKit
import SceneKit
import simd

final class ARFocusRing {

    // ── Public state ──────────────────────────────────────────────────────────
    private(set) var isTracking:        Bool            = false
    private(set) var lastHitTransform:  simd_float4x4? = nil

    // ── Geometry ──────────────────────────────────────────────────────────────
    // rootNode → ringNode (SCNTorus) + dotNode (SCNSphere centre dot)
    private let rootNode: SCNNode
    private let ringNode: SCNNode
    private let dotNode:  SCNNode

    // Keep geometry references so we can update ringRadius directly
    // (never via node scaling — that would shrink pipeRadius to invisible)
    private let ringGeo:  SCNTorus
    private let dotGeo:   SCNSphere

    // Materials updated in-place for colour state transitions
    private let ringMat:  SCNMaterial
    private let dotMat:   SCNMaterial

    // Exponential position smoothing (reduces plane-estimate jitter)
    private var smoothedPos: simd_float3? = nil
    private let smoothK:     Float = 0.50   // 0 = sticky  1 = instant

    // Distance from camera when searching (no surface found)
    private let searchingDist: Float = 0.25  // metres

    // ── Init ──────────────────────────────────────────────────────────────────

    init(sceneView: ARSCNView) {
        // ── Ring ────────────────────────────────────────────────────────────
        // Lies in the XZ plane; Y axis = ring axis (used for surface alignment).
        // IMPORTANT: ringRadius is set directly on the geometry — never via
        // node scaling, which would also scale pipeRadius to invisible.
        ringGeo                  = SCNTorus()
        ringGeo.ringRadius       = 0.038   // ≈ 7.6 cm diameter on surface
        ringGeo.pipeRadius       = 0.0030  // 3 mm tube — fixed
        ringGeo.ringSegmentCount = 48
        ringGeo.pipeSegmentCount = 12
        ringMat                  = SCNMaterial()
        ringMat.lightingModel    = .constant
        ringGeo.firstMaterial    = ringMat  // explicit assign — not optional chain

        // ── Centre dot ────────────────────────────────────────────────────
        dotGeo                = SCNSphere(radius: 0.007)
        dotGeo.segmentCount   = 10
        dotMat                = SCNMaterial()
        dotMat.lightingModel  = .constant
        dotGeo.firstMaterial  = dotMat

        // ── Node tree ────────────────────────────────────────────────────
        rootNode = SCNNode()
        ringNode = SCNNode(geometry: ringGeo)
        dotNode  = SCNNode(geometry: dotGeo)
        rootNode.addChildNode(ringNode)
        rootNode.addChildNode(dotNode)
        sceneView.scene.rootNode.addChildNode(rootNode)

        applySearchingVisuals(animated: false)
    }

    // ── Update — call from AuthorModeView.updateCrosshair() every 0.1 s ──────

    func update(sceneView: ARSCNView) {
        guard sceneView.bounds.width > 0, sceneView.bounds.height > 0 else { return }
        let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)

        if let query = sceneView.raycastQuery(from: center,
                                               allowing: .estimatedPlane,
                                               alignment: .any),
           let result = sceneView.session.raycast(query).first {

            // ── Surface found ──────────────────────────────────────────────
            lastHitTransform = result.worldTransform

            let hitPos    = simd_float3(result.worldTransform.columns.3.x,
                                         result.worldTransform.columns.3.y,
                                         result.worldTransform.columns.3.z)
            let hitNormal = simd_normalize(simd_float3(result.worldTransform.columns.1.x,
                                                        result.worldTransform.columns.1.y,
                                                        result.worldTransform.columns.1.z))

            // Smooth position to reduce plane-estimate noise
            if let prev = smoothedPos {
                smoothedPos = prev + (hitPos - prev) * smoothK
            } else {
                smoothedPos = hitPos
            }
            // 2 mm above surface to avoid z-fighting with the detected plane
            rootNode.simdWorldPosition = smoothedPos! + hitNormal * 0.002
            orientNode(rootNode, toAlignYWith: hitNormal)

            if !isTracking { transitionToTracking() }

        } else {
            // ── No surface — float in front of camera ─────────────────────
            lastHitTransform = nil
            smoothedPos      = nil

            if let frame = sceneView.session.currentFrame {
                let cam    = frame.camera.transform
                let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
                let camFwd = simd_float3(-cam.columns.2.x, -cam.columns.2.y, -cam.columns.2.z)
                rootNode.simdWorldPosition = camPos + camFwd * searchingDist
                orientNode(rootNode, toAlignYWith: camFwd)  // face the camera
            }

            if isTracking { transitionToSearching() }
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    func cleanup() {
        rootNode.removeAllActions()
        ringNode.removeAllActions()
        rootNode.removeFromParentNode()
    }

    // ── State transitions ─────────────────────────────────────────────────────

    private func transitionToTracking() {
        isTracking = true
        rootNode.removeAllActions()
        ringNode.removeAllActions()
        applyTrackingVisuals(animated: true)
    }

    private func transitionToSearching() {
        isTracking = false
        rootNode.removeAllActions()
        ringNode.removeAllActions()
        applySearchingVisuals(animated: true)
    }

    private func applyTrackingVisuals(animated: Bool) {
        let dur: TimeInterval = animated ? 0.22 : 0
        SCNTransaction.begin()
        SCNTransaction.animationDuration = dur
        ringMat.diffuse.contents  = UIColor.cyan
        ringMat.emission.contents = UIColor.cyan.withAlphaComponent(0.55)
        dotMat.diffuse.contents   = UIColor.cyan
        dotMat.emission.contents  = UIColor.cyan.withAlphaComponent(0.70)
        rootNode.opacity = 1.0
        rootNode.scale   = SCNVector3(1, 1, 1)
        SCNTransaction.commit()
        // No ongoing animation when tracking — ring just follows the surface
    }

    private func applySearchingVisuals(animated: Bool) {
        let dur: TimeInterval = animated ? 0.20 : 0
        SCNTransaction.begin()
        SCNTransaction.animationDuration = dur
        ringMat.diffuse.contents  = UIColor.white.withAlphaComponent(0.60)
        ringMat.emission.contents = UIColor.white.withAlphaComponent(0.25)
        dotMat.diffuse.contents   = UIColor.white.withAlphaComponent(0.70)
        dotMat.emission.contents  = UIColor.white.withAlphaComponent(0.30)
        SCNTransaction.commit()

        // Spin the ring around its face axis (Y in local space → visible rotation)
        ringNode.runAction(.repeatForever(
            .rotateBy(x: 0, y: .pi * 2, z: 0, duration: 2.5)
        ))

        // Pulse opacity + scale on the root for a "scanning" feel
        rootNode.runAction(.repeatForever(.sequence([
            .group([.fadeOpacity(to: 0.30, duration: 0.80),
                    .scale(to: 0.85,        duration: 0.80)]),
            .group([.fadeOpacity(to: 0.85, duration: 0.80),
                    .scale(to: 1.00,        duration: 0.80)]),
        ])))
    }

    // ── Orientation helper — same quaternion logic as ConeARGuide.orientNode ──
    //
    // Rotates `node` so its local +Y axis aligns with `targetY`.
    // For a SCNTorus, +Y is the ring axis → ring lies flat in the XZ plane.
    // Aligning +Y with the surface normal makes the ring sit flush on the surface.

    private func orientNode(_ node: SCNNode, toAlignYWith targetY: simd_float3) {
        let y   = simd_normalize(targetY)
        let dot = simd_dot(simd_float3(0, 1, 0), y)

        if dot > 0.9999 {
            node.simdOrientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
            return
        }
        if dot < -0.9999 {
            node.simdOrientation = simd_quatf(angle: .pi, axis: simd_float3(1, 0, 0))
            return
        }
        let rotAxis = simd_normalize(simd_cross(simd_float3(0, 1, 0), y))
        let angle   = acos(dot)
        node.simdOrientation = simd_quatf(angle: angle, axis: rotAxis)
    }
}
