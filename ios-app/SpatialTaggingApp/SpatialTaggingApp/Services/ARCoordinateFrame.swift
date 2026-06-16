// ARCoordinateFrame.swift — Phase 2.5
//
// Provides a gravity-aligned, scan-angle-independent coordinate frame for any
// surface detected via QR scan.
//
// ── The problem ───────────────────────────────────────────────────────────────
// ARKit's raw plane-hit transform has a stable Z (surface normal) but an
// unstable X/Y that rotates with the device's scan angle.  If Author scans a
// wall QR tilted 30° clockwise and Operator scans it straight-on, the X and Y
// columns differ — so any world position derived in one session won't match
// the same physical point in the other session.
//
// ── The fix ───────────────────────────────────────────────────────────────────
// ARKit always aligns its Y axis with gravity (accelerometer + gyroscope).
// World up is therefore always (0, 1, 0).  We re-derive X and Y from that
// constant, keeping only Z (the surface normal) from the raw hit transform.
//
//   Wall QR  → Z = outward normal, Y = worldUp projected onto wall plane, X = Y×Z
//   Floor QR → Z = upward normal,  Y = raw QR Y projected to horizontal,  X = Y×Z
//
// Result: any device scanning the same physical QR gets an identical 4×4 frame.
//
// ── Coordinate convention ─────────────────────────────────────────────────────
// Anchor-relative positions are expressed as offsets in the normalised frame:
//   +X = right along surface, +Y = up along surface (or up from floor),
//   +Z = outward from surface.
// Converting between anchor-relative and world-space just requires the current
// session's normalised anchor transform.

import ARKit
import simd

enum ARCoordinateFrame {

    // ── Normalisation ─────────────────────────────────────────────────────────

    /// Return a gravity-aligned transform from a raw ARKit plane-hit or anchor
    /// transform.  Position is preserved; X/Y/Z axes are re-derived so the frame
    /// is identical regardless of the device's scan angle.
    ///
    /// - Parameter raw: The `worldTransform` from an `ARRaycastResult` or
    ///   `ARAnchor`, or `ARImageAnchor.transform`.
    static func normalised(from raw: simd_float4x4) -> simd_float4x4 {

        let position = simd_float3(raw.columns.3.x,
                                   raw.columns.3.y,
                                   raw.columns.3.z)

        // Surface normal — Z column of the raw transform (may point either way
        // depending on plane orientation; normalise to unit length).
        let rawZ    = simd_normalize(simd_float3(raw.columns.2.x,
                                                  raw.columns.2.y,
                                                  raw.columns.2.z))

        // ARKit world up — constant across all sessions because ARKit fuses
        // accelerometer + gyroscope to align Y with gravity.
        let worldUp = simd_float3(0, 1, 0)

        // ── Horizontal surface (floor / table / ceiling) ──────────────────────
        // Threshold: dot product > 0.85 ≈ surface tilted < ~32° from horizontal.
        if abs(simd_dot(rawZ, worldUp)) > 0.85 {

            // Z = surface normal (already ≈ world up for floor, ≈ world down
            //   for ceiling — keep as-is so +Z always means "away from surface").
            let newZ = rawZ

            // Y: project the raw QR's Y column onto the horizontal plane to get
            // a stable "forward on surface" direction that follows the physical
            // QR sticker orientation, not the scan angle.
            let rawY  = simd_normalize(simd_float3(raw.columns.1.x,
                                                    raw.columns.1.y,
                                                    raw.columns.1.z))
            let yProj = rawY - simd_dot(rawY, newZ) * newZ
            let newY  = simd_length(yProj) > 0.01
                ? simd_normalize(yProj)
                : simd_float3(1, 0, 0)          // degenerate fallback

            let newX  = simd_normalize(simd_cross(newY, newZ))

            return makeTransform(x: newX, y: newY, z: newZ, position: position)
        }

        // ── Vertical surface (wall) ───────────────────────────────────────────
        // Z = outward normal from wall.
        // Y = world up projected onto the wall plane → "up on the wall" regardless
        //   of how the device was tilted when the QR was scanned.
        let newZ       = rawZ
        let upOnWall   = worldUp - simd_dot(worldUp, newZ) * newZ
        let newY       = simd_length(upOnWall) > 0.01
            ? simd_normalize(upOnWall)
            : simd_float3(0, 1, 0)              // degenerate fallback

        let newX       = simd_normalize(simd_cross(newY, newZ))

        return makeTransform(x: newX, y: newY, z: newZ, position: position)
    }

    // ── Coordinate conversion ─────────────────────────────────────────────────

    /// Convert a world-space position into the anchor's local coordinate frame.
    /// Use this when *saving* a tag so its position is session-independent.
    ///
    ///     anchorRelative = inverse(anchorTransform) × worldPos
    static func toAnchorRelative(worldPos: simd_float3,
                                  anchorTransform: simd_float4x4) -> simd_float3 {
        let inv    = simd_inverse(anchorTransform)
        let result = inv * simd_float4(worldPos.x, worldPos.y, worldPos.z, 1)
        return simd_float3(result.x, result.y, result.z)
    }

    /// Recover a world-space position from an anchor-relative offset.
    /// Use this when *restoring* a tag marker into the current AR session,
    /// given the current session's normalised anchor transform.
    ///
    ///     worldPos = anchorTransform × anchorRelative
    static func toWorldSpace(anchorRelativePos: simd_float3,
                              anchorTransform: simd_float4x4) -> simd_float3 {
        let result = anchorTransform * simd_float4(anchorRelativePos.x,
                                                    anchorRelativePos.y,
                                                    anchorRelativePos.z, 1)
        return simd_float3(result.x, result.y, result.z)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static func makeTransform(x: simd_float3,
                                       y: simd_float3,
                                       z: simd_float3,
                                       position: simd_float3) -> simd_float4x4 {
        simd_float4x4(columns: (
            simd_float4(x.x, x.y, x.z, 0),
            simd_float4(y.x, y.y, y.z, 0),
            simd_float4(z.x, z.y, z.z, 0),
            simd_float4(position.x, position.y, position.z, 1)
        ))
    }
}
