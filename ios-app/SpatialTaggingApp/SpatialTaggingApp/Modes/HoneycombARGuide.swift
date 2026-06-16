// HoneycombARGuide.swift — Phase 3 (3D world-space navigation arrow)
// Places 7 target sphere nodes in the AR world around the inspection point.
// The user physically moves to each sphere; HoneycombCaptureView fires
// auto-capture once the camera stays within proximityThreshold for holdDuration.
//
// Phase 3 addition: a 3D arrow floats 0.25 m from the inspection point,
// pointing toward the current target slot.  Updated via updateArrow(currentSlot:).
// This replaces the 2D screen-space compass with real-world direction guidance.
//
// Node layout (viewed from above, inspection point = •):
//
//        [6]  [1]
//      [5]  •  [2]
//        [4]  [3]
//
// Slot 0 = straight-on (behind the initial camera), 1-6 = surrounding ring.

import ARKit
import SceneKit
import simd

final class HoneycombARGuide {

    // ── Public ────────────────────────────────────────────────────────────────

    /// World positions where the user's camera should be for each slot (0-6).
    private(set) var targetPositions: [simd_float3] = []

    // ── Private ───────────────────────────────────────────────────────────────

    private weak var sceneView: ARSCNView?
    private var allNodes:    [SCNNode] = []
    private var targetNodes: [SCNNode] = []   // parallel to targetPositions

    // 3D navigation arrow
    private var arrowNode:   SCNNode?   // root — repositioned each update
    private var inspectionPoint: simd_float3 = .zero

    // ── Init ──────────────────────────────────────────────────────────────────

    /// Call once ARKit has a usable camera transform (not .notAvailable).
    ///
    /// - Parameters:
    ///   - initialCameraTransform: The camera's 4×4 world transform at the moment
    ///     the user taps Start — used to derive the hemisphere orientation axes.
    ///   - inspectionPoint: Explicit world-space position of the tag being trained,
    ///     recovered from the anchor-relative metadata via the re-detected QR transform.
    ///     When nil, falls back to 0.5 m ahead of the camera (original behaviour).
    init(sceneView: ARSCNView,
         initialCameraTransform t: simd_float4x4,
         inspectionPoint: simd_float3? = nil) {
        self.sceneView = sceneView
        buildGuide(from: t, inspectionPoint: inspectionPoint)
    }

    // ── State updates ─────────────────────────────────────────────────────────

    func update(currentSlot: Int, capturedCount: Int) {
        for (i, node) in targetNodes.enumerated() {
            let captured = i < capturedCount
            let active   = (i == currentSlot) && (capturedCount == currentSlot)
            styleTarget(node, captured: captured, active: active)
        }
        updateArrow(currentSlot: currentSlot, capturedCount: capturedCount)
    }

    /// Update the 3D navigation arrow to point toward the current target slot.
    /// The arrow floats 0.22 m from the inspection point in the target direction,
    /// oriented using the shortest-arc quaternion from +Y to that direction.
    func updateArrow(currentSlot: Int, capturedCount: Int) {
        guard capturedCount < 7,
              currentSlot < targetPositions.count,
              let arrow = arrowNode else { return }

        let target = targetPositions[currentSlot]
        let diff   = target - inspectionPoint
        let len    = simd_length(diff)
        guard len > 0.001 else { return }
        let dir = simd_normalize(diff)

        // Position arrow 0.22 m from inspection point toward the target
        arrow.simdWorldPosition = inspectionPoint + dir * 0.22

        // Orient arrow: default geometry is along +Y, rotate to target direction
        let yAxis  = simd_float3(0, 1, 0)
        let cross  = simd_cross(yAxis, dir)
        let crossLen = simd_length(cross)
        if crossLen > 0.001 {
            let angle = acos(max(-1, min(1, simd_dot(yAxis, dir))))
            arrow.simdLocalRotate(by: simd_quatf(angle: angle, axis: simd_normalize(cross)))
            // Reset then apply to avoid cumulative drift
            arrow.simdOrientation = simd_quatf(angle: angle, axis: simd_normalize(cross))
        } else if simd_dot(yAxis, dir) < 0 {
            // Exactly antiparallel — flip 180° around X
            arrow.simdOrientation = simd_quatf(angle: .pi, axis: simd_float3(1,0,0))
        } else {
            arrow.simdOrientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) // identity
        }

        arrow.isHidden = false

        // Pulse the arrow when not yet in position
        arrow.removeAllActions()
        arrow.runAction(.repeatForever(.sequence([
            .fadeOpacity(to: 0.35, duration: 0.6),
            .fadeOpacity(to: 1.00, duration: 0.6),
        ])))
    }

    func cleanup() {
        allNodes.forEach { $0.removeFromParentNode() }
        arrowNode?.removeFromParentNode()
        arrowNode = nil
        allNodes.removeAll()
        targetNodes.removeAll()
        targetPositions.removeAll()
    }

    /// Temporarily hide / show all guide nodes so that a snapshot taken between
    /// hide() and show() captures only the clean camera feed — no AR sphere
    /// artifacts in the training image.  Call hide before snapshot, show after.
    func setNodesHidden(_ hidden: Bool) {
        allNodes.forEach { $0.isHidden = hidden }
        arrowNode?.isHidden = hidden
    }

    /// Hide the navigation arrow when the camera is already in position —
    /// the proximity ring replaces it as the capture indicator.
    func setArrowVisible(_ visible: Bool) {
        arrowNode?.isHidden = !visible
    }

    // ── Construction ──────────────────────────────────────────────────────────

    private func buildGuide(from t: simd_float4x4, inspectionPoint: simd_float3? = nil) {
        // Camera basis vectors in world space
        let camPos  = simd_float3(t.columns.3.x,  t.columns.3.y,  t.columns.3.z)
        let forward = simd_float3(-t.columns.2.x, -t.columns.2.y, -t.columns.2.z) // ARKit: -Z forward
        let right   = simd_float3( t.columns.0.x,  t.columns.0.y,  t.columns.0.z)
        let up      = simd_float3( t.columns.1.x,  t.columns.1.y,  t.columns.1.z)

        // Inspection point — anchored to tag world position when available,
        // otherwise 0.5 m ahead of the camera (fallback for new or unpositioned tags).
        let inspPt: simd_float3
        let back:   simd_float3     // direction from inspPt toward camera

        if let explicit = inspectionPoint {
            inspPt = explicit
            // Re-derive "back" as the vector FROM the tag TOWARD the camera so that
            // slot 0 (straight-on) always starts where the user is standing.
            let toCamera = camPos - explicit
            back = simd_length(toCamera) > 0.05
                ? simd_normalize(toCamera)
                : -forward          // degenerate fallback if camera is on top of tag
        } else {
            inspPt = camPos + forward * 0.5
            back   = -forward
        }

        // Target camera positions on a hemisphere facing the initial camera.
        // User must bring their device to each position, ~40 cm from the inspection point.
        let r: Float = 0.40
        let offsets: [simd_float3] = [
            back * r,                                          // 0: straight-on
            back * 0.28 + up    * 0.28,                       // 1: above
            back * 0.28 + right * 0.28 + up    * 0.14,       // 2: upper-right
            back * 0.28 + right * 0.28 - up    * 0.14,       // 3: lower-right
            back * 0.28            - up    * 0.28,            // 4: below
            back * 0.28 - right * 0.28 - up    * 0.14,       // 5: lower-left
            back * 0.28 - right * 0.28 + up    * 0.14,       // 6: upper-left
        ]
        targetPositions = offsets.map { inspPt + $0 }
        self.inspectionPoint = inspPt

        guard let scene = sceneView?.scene else { return }

        // Inspection point centre dot
        let centre = makeSphere(radius: 0.013, color: UIColor.white.withAlphaComponent(0.7))
        centre.simdWorldPosition = inspPt
        scene.rootNode.addChildNode(centre)
        allNodes.append(centre)

        // Spoke lines + target nodes
        for (i, pos) in targetPositions.enumerated() {
            if let spoke = makeLine(from: inspPt, to: pos) {
                scene.rootNode.addChildNode(spoke)
                allNodes.append(spoke)
            }
            let tNode = makeTargetNode(index: i)
            tNode.simdWorldPosition = pos
            scene.rootNode.addChildNode(tNode)
            targetNodes.append(tNode)
            allNodes.append(tNode)
        }

        // 3D navigation arrow — starts hidden, shown on first update()
        let arrow = makeArrowNode()
        arrow.isHidden = true
        scene.rootNode.addChildNode(arrow)
        arrowNode = arrow

        update(currentSlot: 0, capturedCount: 0)
    }

    // ── Node factories ────────────────────────────────────────────────────────

    private func makeSphere(radius: CGFloat, color: UIColor) -> SCNNode {
        let geo = SCNSphere(radius: radius)
        geo.firstMaterial?.diffuse.contents  = color
        geo.firstMaterial?.emission.contents = color
        geo.firstMaterial?.lightingModel     = .constant
        return SCNNode(geometry: geo)
    }

    private func makeTargetNode(index: Int) -> SCNNode {
        let root = SCNNode()

        // Sphere (styled later in styleTarget)
        let sphere = SCNSphere(radius: 0.024)
        sphere.firstMaterial?.lightingModel = .constant
        let sphereNode = SCNNode(geometry: sphere)
        sphereNode.name = "sphere"
        root.addChildNode(sphereNode)

        // Billboard number label
        let text        = SCNText(string: "\(index + 1)", extrusionDepth: 0.001)
        text.font       = UIFont.boldSystemFont(ofSize: 0.08)
        text.firstMaterial?.diffuse.contents  = UIColor.white
        text.firstMaterial?.lightingModel     = .constant
        let (bMin, bMax) = text.boundingBox
        let labelNode   = SCNNode(geometry: text)
        labelNode.pivot = SCNMatrix4MakeTranslation((bMax.x + bMin.x) / 2,
                                                     (bMax.y + bMin.y) / 2, 0)
        labelNode.scale       = SCNVector3(0.12, 0.12, 0.12)
        labelNode.position    = SCNVector3(0, 0.05, 0)
        labelNode.constraints = [SCNBillboardConstraint()]
        root.addChildNode(labelNode)

        return root
    }

    private func makeLine(from a: simd_float3, to b: simd_float3) -> SCNNode? {
        let diff = b - a
        let len  = simd_length(diff)
        guard len > 0.001 else { return nil }

        let cyl = SCNCylinder(radius: 0.002, height: CGFloat(len))
        cyl.firstMaterial?.diffuse.contents  = UIColor.white.withAlphaComponent(0.12)
        cyl.firstMaterial?.lightingModel     = .constant

        let node = SCNNode(geometry: cyl)
        node.simdWorldPosition = a + diff * 0.5

        // Align cylinder (default Y-axis) to the diff direction
        let yAxis = simd_float3(0, 1, 0)
        let dir   = simd_normalize(diff)
        let cross = simd_cross(yAxis, dir)
        if simd_length(cross) > 0.001 {
            let angle = acos(max(-1, min(1, simd_dot(yAxis, dir))))
            node.simdLocalRotate(by: simd_quatf(angle: angle,
                                                 axis: simd_normalize(cross)))
        }
        return node
    }

    // ── 3D arrow factory ──────────────────────────────────────────────────────
    // Arrow = shaft (SCNCylinder, along Y-axis) + head (SCNCone, tip up).
    // The root node is repositioned + reoriented in updateArrow().
    // All geometry is aligned along +Y so a single simdOrientation rotation
    // points the arrow in any world-space direction.

    private func makeArrowNode() -> SCNNode {
        let root  = SCNNode()
        let mat   = SCNMaterial()
        mat.diffuse.contents  = UIColor.systemCyan.withAlphaComponent(0.92)
        mat.emission.contents = UIColor.systemCyan.withAlphaComponent(0.45)
        mat.lightingModel     = .constant

        // Shaft
        let shaft         = SCNCylinder(radius: 0.006, height: 0.085)
        shaft.firstMaterial = mat
        let shaftNode       = SCNNode(geometry: shaft)
        shaftNode.position  = SCNVector3(0, 0.0425, 0)   // centre of shaft above origin
        root.addChildNode(shaftNode)

        // Head (cone tip pointing up = +Y)
        let cone         = SCNCone(topRadius: 0.0, bottomRadius: 0.018, height: 0.040)
        cone.firstMaterial = mat
        let coneNode       = SCNNode(geometry: cone)
        coneNode.position  = SCNVector3(0, 0.085 + 0.020, 0)  // sits at top of shaft
        root.addChildNode(coneNode)

        // Scale the whole arrow uniformly for readability at ~0.4 m distance
        root.scale = SCNVector3(1.5, 1.5, 1.5)
        return root
    }

    // ── Styling ───────────────────────────────────────────────────────────────

    private func styleTarget(_ node: SCNNode, captured: Bool, active: Bool) {
        guard let sphereNode = node.childNode(withName: "sphere", recursively: false),
              let sphere     = sphereNode.geometry as? SCNSphere else { return }

        let color:    UIColor
        let emission: UIColor
        let radius:   CGFloat

        if captured {
            color    = .systemGreen
            emission = UIColor.systemGreen.withAlphaComponent(0.25)
            radius   = 0.019
        } else if active {
            color    = .systemCyan
            emission = UIColor.systemCyan.withAlphaComponent(0.50)
            radius   = 0.028
        } else {
            color    = UIColor.systemGray.withAlphaComponent(0.40)
            emission = .clear
            radius   = 0.019
        }

        sphere.radius = radius
        sphere.firstMaterial?.diffuse.contents  = color
        sphere.firstMaterial?.emission.contents = emission

        node.removeAllActions()
        if active {
            node.runAction(.repeatForever(.sequence([
                .fadeOpacity(to: 0.45, duration: 0.7),
                .fadeOpacity(to: 1.00, duration: 0.7),
            ])))
        }
    }
}
