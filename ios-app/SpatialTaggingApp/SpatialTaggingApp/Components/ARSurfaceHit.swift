// ARSurfaceHit.swift
//
// One rule for "where is the surface under this screen point", shared by
// every product that places or reads a point in AR: Anchor Lab, tag
// placement, guide step placement, iLOTO points, AR OMS.
//
// The nearest surface to the camera wins. Preferring detected plane
// geometry first (the old order) put a tap on a table onto the floor plane
// below it whenever the table itself had no plane yet - the tag appeared
// under the finger, one surface too far. The estimated-plane query reads
// the depth mesh on LiDAR devices, so it finds the table before ARKit has
// classified it; the focus ring uses the same query, so what the ring sits
// on is where the tap lands.

import ARKit
import simd

extension ARSCNView {

    /// Nearest surface hit under `point`, across detected plane geometry and
    /// estimated planes. `nil` when nothing is there.
    func nearestSurfaceHit(at point: CGPoint) -> ARRaycastResult? {
        let camPos: simd_float3? = session.currentFrame.map {
            simd_float3($0.camera.transform.columns.3.x, $0.camera.transform.columns.3.y, $0.camera.transform.columns.3.z)
        }
        var best: (hit: ARRaycastResult, dist: Float)? = nil
        for target in [ARRaycastQuery.Target.estimatedPlane, .existingPlaneGeometry] {
            guard let q = raycastQuery(from: point, allowing: target, alignment: .any) else { continue }
            for h in session.raycast(q) {
                let c = h.worldTransform.columns.3
                let d = camPos.map { simd_distance($0, simd_float3(c.x, c.y, c.z)) } ?? 0
                if best == nil || d < best!.dist { best = (h, d) }
            }
        }
        return best?.hit
    }

    /// Nearest surface point under `point`.
    func nearestSurfacePoint(at point: CGPoint) -> simd_float3? {
        guard let h = nearestSurfaceHit(at: point) else { return nil }
        let c = h.worldTransform.columns.3
        return simd_float3(c.x, c.y, c.z)
    }
}
