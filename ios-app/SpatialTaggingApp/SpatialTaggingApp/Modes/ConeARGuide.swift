// ConeARGuide.swift — v3
//
// A live-tracking inspection cone that follows the Author's camera position
// in real time.  The tag is at the apex; the ring (mouth) floats in front of
// the Author at their current distance from the tag.
//
// ── Interaction model ─────────────────────────────────────────────────────────
//  Walk closer / farther  → ring moves with you (distance clamped 0.05–0.50 m)
//  Tilt / rotate device   → ring follows naturally (camera = ring origin)
//  Pinch gesture          → change aperture angle (ring radius, 10°–45°)
//  "Lock Angle" button    → freezes current direction & distance for capture
//
// ── Visual ────────────────────────────────────────────────────────────────────
//  • Small pulsing dot at the tag (apex)
//  • Solid semitransparent SCNCone surface — no shaky edge lines
//  • SCNTorus ring at the inspection distance (the "mouth")
//  • Colours: cyan → green (aligned) → gold (locked)
//
// ── v3 changes from v2 ────────────────────────────────────────────────────────
//  • Replace 4 edge SCNCylinder nodes with one solid SCNCone (isDoubleSided,
//    ~35% alpha).  Edge lines were visually noisy due to hand tremor; the solid
//    cone surface is stable and much cleaner at arm's length.
//  • Fix torus visibility bug: v2 scaled the torus NODE uniformly to set ring
//    radius, which also scaled pipeRadius from 4mm → 0.26mm (invisible).
//    v3 sets torusGeo.ringRadius directly each frame — pipeRadius stays 3.5mm.
//  • Fix orientNode degenerate case: the cross-product with world-Y was zero when
//    coneWorldDirection ≈ (0,1,0) (vertical cone), causing a silent guard-return
//    and leaving both ring and cone unoriented.  v3 handles all degenerate cases.
//
// ── SCNCone geometry conventions ─────────────────────────────────────────────
//  SCNCone local axes:  topRadius at +Y (top), bottomRadius at -Y (bottom).
//  We set topRadius = ringRadius (wide base, toward ring) and bottomRadius = 0
//  (apex, toward tag).  The cone node is centered at the midpoint between tag
//  and ring, oriented +Y toward ring (+coneWorldDirection).
//  Result: cone apex sits exactly at tagWorldPosition, base at ringCentre.
//
// ── Multi-anchor readiness ────────────────────────────────────────────────────
//  All spatial data stored in anchor-relative space.  Converting world ↔ anchor:
//  anchorTransform × storedQuat.

import ARKit
import SceneKit
import simd

final class ConeARGuide {

    // ── Public constants ──────────────────────────────────────────────────────

    static let kMinDist:      Float = 0.05   // 5 cm  — very close inspection
    static let kMaxDist:      Float = 0.50   // 50 cm — far inspection limit
    static let kDefaultApert: Float = 25     // degrees — default cone width
    static let kMinApert:     Float = 10     // degrees
    static let kMaxApert:     Float = 45     // degrees

    // ── Public state (read-only) ──────────────────────────────────────────────

    let tagWorldPosition: simd_float3
    private(set) var coneWorldDirection: simd_float3 = simd_float3(0, 0, 1)
    private(set) var currentDistanceM:   Float       = 0.30
    private(set) var apertureDeg:        Float       = kDefaultApert
    private(set) var isLocked:           Bool        = false
    private(set) var isOutOfRange:       Bool        = false

    // ── Private nodes ─────────────────────────────────────────────────────────

    private weak var sceneView: ARSCNView?
    private var rootNode:   SCNNode   // placed at tagWorldPosition (contains centreNode)
    private var centreNode: SCNNode   // pulsing apex dot
    private var ringNode:   SCNNode   // SCNTorus ring at the mouth
    private var coneNode:   SCNNode   // SCNCone fill surface (semitransparent)

    // Geometry instances — properties updated directly each frame (no node scaling)
    private let torusGeo: SCNTorus
    private let coneGeo:  SCNCone

    // ── Init — live tracking (Author / ConeCaptureView) ───────────────────────

    init(sceneView: ARSCNView, tagWorldPosition: simd_float3) {
        self.sceneView        = sceneView
        self.tagWorldPosition = tagWorldPosition

        (torusGeo, coneGeo) = ConeARGuide.makeGeometry()
        rootNode   = SCNNode()
        centreNode = SCNNode()
        ringNode   = SCNNode(geometry: torusGeo)
        coneNode   = SCNNode(geometry: coneGeo)

        rootNode.simdWorldPosition = tagWorldPosition
        build()
        sceneView.scene.rootNode.addChildNode(rootNode)
        setConeColor(.systemCyan)
    }

    /// Reconstructed from stored metadata — used in Operator mode (read-only, locked).
    /// Converts the anchor-relative quaternion to world space and locks immediately.
    init(sceneView: ARSCNView,
         tagWorldPosition: simd_float3,
         anchorRelativeQuat: simd_quatf,
         anchorTransform: simd_float4x4) {
        self.sceneView        = sceneView
        self.tagWorldPosition = tagWorldPosition

        (torusGeo, coneGeo) = ConeARGuide.makeGeometry()
        rootNode   = SCNNode()
        centreNode = SCNNode()
        ringNode   = SCNNode(geometry: torusGeo)
        coneNode   = SCNNode(geometry: coneGeo)

        // Reconstruct world-space cone direction from anchor-relative quaternion
        let worldQuat = anchorTransform.rotation * anchorRelativeQuat
        let localZ    = simd_float3(0, 0, 1)
        coneWorldDirection = simd_normalize(worldQuat.act(localZ))

        rootNode.simdWorldPosition = tagWorldPosition
        build()
        isLocked = true   // Operator guide is always locked
        sceneView.scene.rootNode.addChildNode(rootNode)
        setConeColor(.systemYellow)
    }

    // ── Factory — shared geometry setup ──────────────────────────────────────

    private static func makeGeometry() -> (SCNTorus, SCNCone) {
        // ── Torus ring ────────────────────────────────────────────────────────
        // ringRadius is updated directly each frame; pipeRadius stays fixed.
        // Diameter of pipeRadius=3.5mm is clearly visible at 5–50 cm range.
        //
        // IMPORTANT: SCNTorus() with no params may return a geometry with
        // firstMaterial == nil, so we must explicitly create and assign a
        // material — do NOT rely on "?.lightingModel = .constant" (no-op if nil).
        let torus = SCNTorus()
        torus.ringRadius       = 0.05   // placeholder — set each frame in updateGeometry
        torus.pipeRadius       = 0.0035 // 3.5mm pipe — fixed, never scaled
        torus.ringSegmentCount = 36
        torus.pipeSegmentCount = 8
        let torusMat = SCNMaterial()
        torusMat.lightingModel = .constant
        torus.firstMaterial    = torusMat   // explicit assign — not optional-chain

        // ── Cone fill ─────────────────────────────────────────────────────────
        // topRadius (at +Y) = ringRadius (wide base toward ring)
        // bottomRadius (at -Y) = 0 (apex at tag end)
        // Both updated each frame; height = currentDistanceM.
        let cone = SCNCone()
        cone.topRadius          = 0.05  // placeholder
        cone.bottomRadius       = 0
        cone.height             = 0.30  // placeholder
        cone.radialSegmentCount = 36
        cone.heightSegmentCount = 1

        let coneMat = SCNMaterial()
        coneMat.lightingModel = .constant
        coneMat.isDoubleSided = true    // visible from inside when operator enters cone
        cone.firstMaterial    = coneMat

        return (torus, cone)
    }

    // ── Live update — called from ticker (20 fps) ─────────────────────────────

    /// Updates the ring position and direction to match the current camera position.
    /// After locking, this only updates alignment colour — it no longer moves the cone.
    func updateForCamera(cameraTransform t: simd_float4x4) {
        let camPos  = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let rawVec  = camPos - tagWorldPosition
        let rawDist = simd_length(rawVec)

        if !isLocked {
            if rawDist > 0.001 { coneWorldDirection = simd_normalize(rawVec) }
            currentDistanceM = max(Self.kMinDist, min(Self.kMaxDist, rawDist))
            isOutOfRange     = rawDist < Self.kMinDist * 0.9 || rawDist > Self.kMaxDist * 1.1
            updateGeometry()
        } else {
            // Locked — only update alignment colour
            let aligned = alignmentAngle(cameraTransform: t) < 25
            setConeColor(aligned ? .systemGreen : .systemCyan)
        }
    }

    // ── Aperture control — called from pinch gesture ──────────────────────────

    func setAperture(_ degrees: Float) {
        apertureDeg = max(Self.kMinApert, min(Self.kMaxApert, degrees))
        updateGeometry()
    }

    // ── Lock ──────────────────────────────────────────────────────────────────

    func lock() {
        isLocked = true
        setConeColor(.systemYellow)
        centreNode.removeAllActions()   // stop pulsing
        centreNode.opacity = 1
    }

    // ── Alignment ─────────────────────────────────────────────────────────────

    /// Degrees between camera aim direction and stored cone axis.
    func alignmentAngle(cameraTransform: simd_float4x4) -> Float {
        let camFwd = simd_float3(-cameraTransform.columns.2.x,
                                  -cameraTransform.columns.2.y,
                                  -cameraTransform.columns.2.z)
        let ideal  = simd_normalize(-coneWorldDirection)   // camera should look TOWARD tag
        return acos(max(-1, min(1, simd_dot(simd_normalize(camFwd), ideal)))) * 180 / .pi
    }

    func alignmentScore(cameraTransform: simd_float4x4) -> Double {
        Double(max(0, 1 - alignmentAngle(cameraTransform: cameraTransform) / 90))
    }

    // ── Serialisation ─────────────────────────────────────────────────────────

    func anchorRelativeQuaternion(anchorTransform: simd_float4x4) -> simd_quatf {
        let inv      = simd_inverse(anchorTransform)
        let localVec = inv * simd_float4(coneWorldDirection, 0)
        let localDir = simd_normalize(simd_float3(localVec.x, localVec.y, localVec.z))
        let zAxis    = simd_float3(0, 0, 1)
        let cross    = simd_cross(zAxis, localDir)
        let dot      = simd_dot(zAxis, localDir)
        guard simd_length(cross) > 0.001 else {
            return dot > 0
                ? simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
                : simd_quatf(ix: 0, iy: 1, iz: 0, r: 0)
        }
        return simd_normalize(simd_quatf(ix: cross.x, iy: cross.y, iz: cross.z, r: 1 + dot))
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    func setNodesHidden(_ hidden: Bool) {
        rootNode.enumerateHierarchy { n, _ in n.isHidden = hidden }
        ringNode.isHidden = hidden
        coneNode.isHidden = hidden
    }

    /// Fade-in or fade-out all cone nodes with optional animation.
    func setVisible(_ visible: Bool, animated: Bool = true) {
        let duration: TimeInterval = animated ? 0.45 : 0
        let targetOpacity: CGFloat = visible ? 1.0 : 0.0
        let action = SCNAction.fadeOpacity(to: targetOpacity, duration: duration)
        [rootNode, ringNode, coneNode].forEach { $0.runAction(action) }
        if visible {
            rootNode.enumerateHierarchy { n, _ in n.runAction(action) }
        }
    }

    var isVisible: Bool { rootNode.opacity > 0.05 }

    func cleanup() {
        rootNode.removeFromParentNode()
        ringNode.removeFromParentNode()
        coneNode.removeFromParentNode()
    }

    // ── Private — geometry ────────────────────────────────────────────────────

    private func build() {
        // ── Apex dot — pulsing sphere at tag position ─────────────────────────
        let dotGeo = SCNSphere(radius: 0.010)
        dotGeo.firstMaterial?.lightingModel = .constant
        centreNode = SCNNode(geometry: dotGeo)
        rootNode.addChildNode(centreNode)
        centreNode.runAction(.repeatForever(.sequence([
            .fadeOpacity(to: 0.3, duration: 0.6),
            .fadeOpacity(to: 1.0, duration: 0.6),
        ])))

        // Ring and cone are world-space nodes (not children of rootNode) so their
        // simdWorldPosition assignments position them in global AR space.
        sceneView?.scene.rootNode.addChildNode(ringNode)
        sceneView?.scene.rootNode.addChildNode(coneNode)

        updateGeometry()
    }

    private func updateGeometry() {
        let dist       = currentDistanceM
        let ringRadius = dist * tan(apertureDeg / 2 * .pi / 180)
        let ringCentre = tagWorldPosition + coneWorldDirection * dist
        let coneMidpt  = tagWorldPosition + coneWorldDirection * (dist / 2)

        // ── Torus ring ────────────────────────────────────────────────────────
        // Update ringRadius DIRECTLY on the geometry — do NOT scale the node.
        // Scaling would also shrink pipeRadius (3.5mm → ~0.26mm at typical distances),
        // making the ring completely invisible.
        torusGeo.ringRadius        = CGFloat(ringRadius)
        ringNode.simdWorldPosition = ringCentre
        orientNode(ringNode, toAlignYWith: coneWorldDirection)

        // ── Cone fill ─────────────────────────────────────────────────────────
        // topRadius (at local +Y) = ringRadius so base sits at ringCentre.
        // bottomRadius = 0 so apex sits at tagWorldPosition.
        // Centered at the midpoint, +Y oriented along coneWorldDirection.
        coneGeo.topRadius           = CGFloat(ringRadius)
        coneGeo.bottomRadius        = 0
        coneGeo.height              = CGFloat(dist)
        coneNode.simdWorldPosition  = coneMidpt
        orientNode(coneNode, toAlignYWith: coneWorldDirection)
    }

    /// Rotate `node` so its local +Y axis aligns with `targetY`.
    ///
    /// Handles the two degenerate cases that the previous cross-product approach
    /// failed silently on:
    ///   targetY ≈ +world-Y  → identity (already aligned, dot > 0.9999)
    ///   targetY ≈ -world-Y  → 180° flip around X (anti-aligned, dot < -0.9999)
    private func orientNode(_ node: SCNNode, toAlignYWith targetY: simd_float3) {
        let y   = simd_normalize(targetY)
        let dot = simd_dot(simd_float3(0, 1, 0), y)

        if dot > 0.9999 {
            // Already aligned with world +Y — identity quaternion
            node.simdOrientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
            return
        }
        if dot < -0.9999 {
            // Anti-aligned with world -Y — 180° rotation around X axis
            node.simdOrientation = simd_quatf(angle: .pi, axis: simd_float3(1, 0, 0))
            return
        }
        // General case: axis = cross(worldY, targetY), angle = acos(dot)
        let axis  = simd_normalize(simd_cross(simd_float3(0, 1, 0), y))
        let angle = acos(dot)
        node.simdOrientation = simd_quatf(angle: angle, axis: axis)
    }

    private func setConeColor(_ color: UIColor) {
        // ── Ring — full brightness, strong emission glow ──────────────────────
        ringNode.geometry?.firstMaterial?.diffuse.contents  = color
        ringNode.geometry?.firstMaterial?.emission.contents = color.withAlphaComponent(0.7)

        // ── Cone fill — clearly visible semitransparent surface ───────────────
        // 65% opaque so the cone is easy to see in a bright AR scene.
        // Emission at 30% gives the surface a self-lit glow, matching the ring's
        // visibility in varied lighting — same technique as the edge lines in v2
        // but now as a solid surface (no shaking, double-sided so inside renders).
        coneNode.geometry?.firstMaterial?.diffuse.contents  = color.withAlphaComponent(0.65)
        coneNode.geometry?.firstMaterial?.emission.contents = color.withAlphaComponent(0.30)

        // ── Apex dot ──────────────────────────────────────────────────────────
        centreNode.geometry?.firstMaterial?.diffuse.contents  = color
        centreNode.geometry?.firstMaterial?.emission.contents = color.withAlphaComponent(0.8)
    }
}

// ── simd_float4x4 rotation helper ────────────────────────────────────────────

private extension simd_float4x4 {
    var rotation: simd_quatf {
        simd_quatf(simd_float3x3(columns: (
            simd_float3(columns.0.x, columns.0.y, columns.0.z),
            simd_float3(columns.1.x, columns.1.y, columns.1.z),
            simd_float3(columns.2.x, columns.2.y, columns.2.z)
        )))
    }
}
