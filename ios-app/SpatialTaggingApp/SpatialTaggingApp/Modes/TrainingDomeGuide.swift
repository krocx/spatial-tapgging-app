// TrainingDomeGuide.swift — v3 (flat face, close-packed, no-gap)
//
// Previous design: 3D hemisphere — nodes spread over a dome at different elevations
// (37.5 % and 75 % of apertureDeg).  This forced the Author to walk AROUND the
// object.  Training images from widely different angles give low SSIM similarity
// to inspection images, so scores were always 10–17 % regardless of zone count.
//
// New design (v3): all 19 nodes sit on the FLAT FACE of the cone — the disc
// perpendicular to the cone axis at distance `distanceM`.  The Author holds the
// phone at the right distance and slowly SLIDES it laterally across the face.
// This mirrors how Vuforia asks you to scan a target: slow, overlapping lateral
// movements from a consistent distance.
//
// Layout (same 19-node count, completely different geometry):
//   Node 0        — centre of face (on cone axis at distanceM)
//   Nodes 1–6     — inner ring: r = faceRadius / 3 from face centre, 60 ° steps
//   Nodes 7–18    — outer ring: r = faceRadius × 2/3 from face centre, 30 ° steps
//
// Sphere sizing — adjacent spheres just touch, no gap:
//   faceRadius   = distanceM × tan(apertureDeg × π/180)
//   sphereRadius = faceRadius / 6
//   (verified: centre↔ring1 = r1, ring1 chord = r1, ring1↔ring2 = r1, ring2 chord ≈ r1)
//
// Visual states:
//   Uncaptured — white sphere, 50 % opacity
//   Current    — yellow sphere, grows 1.0× → 1.5× with holdProgress
//   Captured   — green sphere + outer halo, full opacity
//
// Performance: updateState() caches the last (capturedCells, currentCell, holdBucket)
// triple and skips SceneKit material updates when nothing has changed.

import ARKit
import SceneKit
import simd

final class TrainingDomeGuide {

    // ── Constants ──────────────────────────────────────────────────────────────
    static let nodeCount: Int = 19

    // Connector wire thickness — kept thin regardless of sphere size
    private static let connRadius: CGFloat = 0.0008

    // ── Node references ────────────────────────────────────────────────────────
    private var groupNodes:  [SCNNode] = []
    private var sphereNodes: [SCNNode] = []
    private var haloNodes:   [SCNNode] = []
    private var connectors:  [SCNNode] = []

    // ── State cache — avoids 20-Hz SceneKit material rebuilds ─────────────────
    private var lastCapturedCells: Set<Int> = []
    private var lastCurrentCell:   Int?     = nil
    private var lastHoldBucket:    Int      = -1

    // ── Init ───────────────────────────────────────────────────────────────────

    init(sceneView:   ARSCNView,
         tagPos:      simd_float3,
         axis:        simd_float3,
         right:       simd_float3,
         up:          simd_float3,
         apertureDeg: Float,
         distanceM:   Float) {

        // Dynamic sphere sizing: faceRadius/6 so adjacent spheres just touch.
        // For a 30° aperture at 0.30 m: faceRadius = 0.173 m → sphere = 0.029 m.
        let faceRadius   = distanceM * tan(apertureDeg * Float.pi / 180)
        let sphereRadius = CGFloat(faceRadius / 6)
        let haloRadius   = sphereRadius * 1.65

        let positions = Self.nodePositions(tagPos:      tagPos,
                                           axis:        axis,
                                           right:       right,
                                           up:          up,
                                           apertureDeg: apertureDeg,
                                           distanceM:   distanceM)
        for pos in positions {
            let (group, sphere, halo) = Self.makeNodeGroup(sphereRadius: sphereRadius,
                                                            haloRadius:   haloRadius)
            group.simdWorldPosition = pos
            sceneView.scene.rootNode.addChildNode(group)
            groupNodes.append(group)
            sphereNodes.append(sphere)
            haloNodes.append(halo)

            // Thin wire from tag centre to each capture node
            let conn = Self.makeConnector(from: tagPos, to: pos)
            sceneView.scene.rootNode.addChildNode(conn)
            connectors.append(conn)
        }
    }

    // ── Update — called at each sweep tick ────────────────────────────────────

    func updateState(capturedCells: Set<Int>, currentCell: Int?, holdProgress: Double) {
        let holdBucket = Int(holdProgress * 20)
        guard capturedCells != lastCapturedCells
           || currentCell   != lastCurrentCell
           || holdBucket    != lastHoldBucket else { return }

        lastCapturedCells = capturedCells
        lastCurrentCell   = currentCell
        lastHoldBucket    = holdBucket

        for i in 0..<min(Self.nodeCount, groupNodes.count) {
            let group    = groupNodes[i]
            let sphere   = sphereNodes[i]
            let halo     = haloNodes[i]
            let captured = capturedCells.contains(i)
            let current  = (currentCell == i) && !captured

            if captured {
                setColor(sphere.geometry,
                         diffuse:  .systemGreen,
                         emission: UIColor.systemGreen.withAlphaComponent(0.60))
                setColor(halo.geometry,
                         diffuse: UIColor.systemGreen.withAlphaComponent(0.18))
                group.simdScale = simd_float3(repeating: 1.0)
                sphere.opacity  = 1.0
                halo.opacity    = 1.0
                sphere.removeAllActions()

            } else if current {
                setColor(sphere.geometry,
                         diffuse:  .systemYellow,
                         emission: UIColor.systemYellow.withAlphaComponent(0.75))
                setColor(halo.geometry,
                         diffuse: UIColor.systemYellow.withAlphaComponent(
                             CGFloat(holdProgress) * 0.30))
                let s           = Float(1.0 + holdProgress * 0.50)
                group.simdScale = simd_float3(repeating: s)
                sphere.opacity  = 1.0
                halo.opacity    = CGFloat(holdProgress * 0.80)
                sphere.removeAllActions()

            } else {
                setColor(sphere.geometry,
                         diffuse: UIColor.white.withAlphaComponent(0.55))
                setColor(halo.geometry, diffuse: .clear)
                group.simdScale = simd_float3(repeating: 0.88)
                sphere.opacity  = 0.50
                halo.opacity    = 0.0
            }
        }
    }

    // ── Cleanup ────────────────────────────────────────────────────────────────

    func cleanup() {
        groupNodes.forEach  { $0.removeFromParentNode() }
        connectors.forEach  { $0.removeFromParentNode() }
        groupNodes.removeAll()
        sphereNodes.removeAll()
        haloNodes.removeAll()
        connectors.removeAll()
    }

    // ── Node positions — flat face disc ───────────────────────────────────────
    //
    // All 19 nodes lie on the plane perpendicular to `axis` at depth `distanceM`.
    //
    //   faceCenter  = tagPos + axis × distanceM
    //   inner ring  = faceCenter + r1 × (cos(az)·right + sin(az)·up)
    //   outer ring  = faceCenter + r2 × (cos(az)·right + sin(az)·up)
    //
    // r1 = faceRadius/3   (inner ring, 1/3 of face radius from centre)
    // r2 = faceRadius×2/3 (outer ring, 2/3 of face radius from centre)
    //
    // This keeps ALL training viewpoints in the "looking straight at the object"
    // direction with only small lateral offsets — so any inspection image taken
    // from within the cone has high SSIM similarity to at least one training image.

    static func nodePositions(tagPos:      simd_float3,
                               axis:        simd_float3,
                               right:       simd_float3,
                               up:          simd_float3,
                               apertureDeg: Float,
                               distanceM:   Float) -> [simd_float3] {
        var positions: [simd_float3] = []
        positions.reserveCapacity(nodeCount)

        let faceRadius = distanceM * tan(apertureDeg * .pi / 180)
        let r1 = faceRadius / 3          // inner ring radius on face
        let r2 = faceRadius * (2.0 / 3)  // outer ring radius on face

        let faceCenter = tagPos + axis * distanceM

        // Node 0 — face centre (directly along cone axis)
        positions.append(faceCenter)

        // Nodes 1–6 — inner ring, 6 × 60 ° azimuth steps
        for i in 0..<6 {
            let azRad = Float(i) * (.pi / 3)
            positions.append(faceCenter + r1 * (cos(azRad) * right + sin(azRad) * up))
        }

        // Nodes 7–18 — outer ring, 12 × 30 ° azimuth steps
        for i in 0..<12 {
            let azRad = Float(i) * (.pi / 6)
            positions.append(faceCenter + r2 * (cos(azRad) * right + sin(azRad) * up))
        }

        return positions
    }

    // ── Static geometry helpers ────────────────────────────────────────────────

    private static func makeNodeGroup(sphereRadius: CGFloat,
                                      haloRadius:   CGFloat) -> (root: SCNNode, sphere: SCNNode, halo: SCNNode) {
        let root = SCNNode()

        let sphereGeo           = SCNSphere(radius: sphereRadius)
        sphereGeo.segmentCount  = 10
        let sphereMat           = SCNMaterial()
        sphereMat.lightingModel = .constant
        sphereMat.diffuse.contents  = UIColor.white.withAlphaComponent(0.55)
        sphereMat.emission.contents = UIColor.white.withAlphaComponent(0.10)
        sphereGeo.firstMaterial     = sphereMat
        let sphere = SCNNode(geometry: sphereGeo)
        root.addChildNode(sphere)

        let haloGeo           = SCNSphere(radius: haloRadius)
        haloGeo.segmentCount  = 8
        let haloMat           = SCNMaterial()
        haloMat.lightingModel = .constant
        haloMat.diffuse.contents = UIColor.clear
        haloGeo.firstMaterial    = haloMat
        let halo = SCNNode(geometry: haloGeo)
        halo.opacity = 0
        root.addChildNode(halo)

        return (root, sphere, halo)
    }

    private static func makeConnector(from start: simd_float3,
                                      to   end:   simd_float3) -> SCNNode {
        let dir = end - start
        let len = simd_length(dir)
        let mid = (start + end) * 0.5

        let cyl = SCNCylinder(radius: connRadius, height: CGFloat(len))
        let mat = SCNMaterial()
        mat.lightingModel    = .constant
        mat.diffuse.contents = UIColor.white.withAlphaComponent(0.12)
        cyl.firstMaterial    = mat

        let node = SCNNode(geometry: cyl)
        node.simdWorldPosition = mid
        orientNode(node, toAlignYWith: simd_normalize(dir))
        return node
    }

    // ── Material helper ────────────────────────────────────────────────────────

    private func setColor(_ geo: SCNGeometry?,
                          diffuse:  UIColor,
                          emission: UIColor? = nil) {
        guard let mat = geo?.firstMaterial else { return }
        mat.diffuse.contents = diffuse
        if let em = emission { mat.emission.contents = em }
    }

    // ── Orientation helper ─────────────────────────────────────────────────────

    private static func orientNode(_ node: SCNNode, toAlignYWith targetY: simd_float3) {
        let y   = simd_normalize(targetY)
        let dot = simd_dot(simd_float3(0, 1, 0), y)
        if dot > 0.9999 {
            node.simdOrientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1); return
        }
        if dot < -0.9999 {
            node.simdOrientation = simd_quatf(angle: .pi, axis: simd_float3(1, 0, 0)); return
        }
        let rotAxis = simd_normalize(simd_cross(simd_float3(0, 1, 0), y))
        node.simdOrientation = simd_quatf(angle: acos(dot), axis: rotAxis)
    }
}
