// ModelNodeStyle.swift — one place that makes a loaded USDZ render reliably
// in the AR scene at ANY node opacity, including 1.0.
//
// Why this exists (2026.4.46): authors reported a step model that showed at
// 50 % opacity but vanished at 100 %. Below 1.0 SceneKit forces the node
// through its transparent pass with a uniform alpha; at exactly 1.0 it trusts
// the material as exported — and USDZ produced from GLB (browser
// USDZExporter, Blender) can carry material state that renders nothing in
// that path: `opacity` 0 from an alpha-blend export, a metallic PBR surface
// with no environment to reflect (pure black on a dark tool), or single-sided
// faces with flipped winding. `prepare(_:)` normalises those once at load so
// what the author sees at the slider IS what the operator gets.
//
// Applied at the three load sites: Place Steps (author), Place-in-AR (editor)
// and the operator ghost overlay.

import SceneKit
import ARKit
import UIKit

enum ModelNodeStyle {

    /// Normalise every material under `node`. Idempotent and cheap.
    /// Returns a short diagnostic line (also printed once per node name).
    @discardableResult
    static func prepare(_ node: SCNNode, label: String = "") -> String {
        var materials = 0, fixedAlpha = 0, metallic = 0, pbr = 0
        node.enumerateHierarchy { child, _ in
            guard let geo = child.geometry else { return }
            for mat in geo.materials {
                materials += 1
                // Invisible-by-export: opacity/transparency 0 or a fully
                // transparent constant colour. Restore full coverage; the
                // node's own opacity is the only fade we want.
                if mat.transparency < 0.05 { mat.transparency = 1.0; fixedAlpha += 1 }
                if let c = mat.transparent.contents as? UIColor, c.cgColor.alpha < 0.05 {
                    mat.transparent.contents = nil; fixedAlpha += 1
                }
                mat.transparencyMode = .aOne
                mat.blendMode        = .alpha
                mat.writesToDepthBuffer = true
                mat.readsFromDepthBuffer = true
                // Flipped winding from CAD/GLB exports shows an empty shell
                // from the outside; double-siding is the safe default for a
                // ghost overlay and costs nothing at these triangle counts.
                mat.isDoubleSided = true
                if mat.lightingModel == .physicallyBased {
                    pbr += 1
                    // Fully metallic + no environment map = black. Pull the
                    // metalness down so the surface takes diffuse light; the
                    // environment texturing turned on in ARSessionManager
                    // handles the rest on device.
                    if let m = mat.metalness.contents as? NSNumber, m.doubleValue > 0.85 {
                        mat.metalness.contents = 0.35; metallic += 1
                    }
                }
            }
        }
        let line = "[ModelNodeStyle] \(label) materials=\(materials) pbr=\(pbr) fixedAlpha=\(fixedAlpha) metallicClamped=\(metallic)"
        AppLog.info("model", line)
        return line
    }
}
