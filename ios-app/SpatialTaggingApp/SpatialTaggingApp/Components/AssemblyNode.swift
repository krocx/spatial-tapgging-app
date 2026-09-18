//
//  AssemblyNode.swift
//  SpatialTaggingApp
//
//  AR OJT slice 2 — the assembly in the scene: a registry of named parts and
//  the operations the guide runtime needs on them.
//
//    apply(state:)                  jump to a cumulative PartState map (no animation)
//    play(deltas:duration:)         animate a step's deltas from the current pose
//                                   (insert: from→to fading in; remove: to→from…)
//    focus(parts:)                  pulse the parts a step is about
//    partName(hit:)                 which part a tap landed on
//
//  Ghost/solid/hidden are expressed with node opacity + material transparency
//  so a part keeps its own colour; a highlight multiplies the diffuse colour.
//  Everything is SceneKit + simd; no third-party code.
//

import Foundation
import QuartzCore
import SceneKit
import simd
import UIKit

final class AssemblyNode {

    let root: SCNNode
    private(set) var parts: [String: SCNNode]
    private let rest: [String: simd_float4x4]
    private var baseColors: [String: [UIColor]] = [:]     // per part, per material, the model's own colour
    private var focused: Set<String> = []
    let extras: [String: [String: Any]]
    let bounds: (min: simd_float3, max: simd_float3)?

    init(assembly: GLBAssembly) {
        root = assembly.root
        parts = assembly.parts
        rest = assembly.restTransforms
        extras = assembly.extras
        bounds = assembly.bounds
        for (name, node) in parts {
            var colors: [UIColor] = []
            node.enumerateHierarchy { n, _ in
                for m in n.geometry?.materials ?? [] { colors.append((m.diffuse.contents as? UIColor) ?? .lightGray) }
            }
            baseColors[name] = colors
        }
    }

    // MARK: - State

    /// Jump every part to `state` (missing parts → rest pose, solid).
    func apply(state: [String: PartState]) {
        SCNTransaction.begin(); SCNTransaction.animationDuration = 0
        for (name, node) in parts {
            let p = state[name] ?? PartState()
            setVisual(node, name: name, state: p)
            setPose(node, name: name, position: p.position, rotation: p.rotation)
        }
        SCNTransaction.commit()
    }

    /// Animate a step's deltas. Called after `apply(state: after index-1)`.
    /// Returns the total duration so callers can schedule a replay loop.
    @discardableResult
    func play(deltas: [GuideStepNode], speed: Double = 1.0) -> TimeInterval {
        var total: TimeInterval = 0
        for d in deltas {
            guard let node = parts[d.node] else { continue }
            let dur = max(0.4, (d.durationSec ?? 1.0)) / max(0.1, speed)
            total = max(total, dur)
            let from = d.from.flatMap(vec3), to = d.to.flatMap(vec3)
            let rFrom = d.rotationFrom.flatMap(vec4), rTo = d.rotationTo.flatMap(vec4)
            var target = PartState()
            if let show = d.show, let s = PartShow(rawValue: show) { target.show = s; target.opacity = s == .ghost ? Float(d.opacity ?? 0.35) : (s == .hidden ? 0 : 1) }
            else if d.animate == "insert" { target.show = .solid; target.opacity = 1 }
            else { target.show = currentShow(node); target.opacity = Float(node.opacity) }
            if let c = d.color, c.count == 3 { target.color = simd_float3(Float(c[0]), Float(c[1]), Float(c[2])) }

            // Start of the motion (if any): put the part at `from` instantly,
            // visible enough to be seen arriving.
            if from != nil || rFrom != nil {
                SCNTransaction.begin(); SCNTransaction.animationDuration = 0
                setPose(node, name: d.node, position: from, rotation: rFrom)
                if d.animate == "insert" { node.isHidden = false; node.opacity = 0.15 }
                SCNTransaction.commit()
            }
            SCNTransaction.begin()
            SCNTransaction.animationDuration = dur
            SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            setVisual(node, name: d.node, state: target)
            if to != nil || rTo != nil { setPose(node, name: d.node, position: to, rotation: rTo) }
            SCNTransaction.commit()
        }
        return total
    }

    // MARK: - Focus

    /// Pulse the given parts (and stop pulsing the previous ones).
    func focus(parts names: [String]) {
        for n in focused { parts[n]?.removeAction(forKey: "focus-pulse") ; parts[n]?.scale = SCNVector3(1, 1, 1) }
        focused = Set(names)
        for n in names {
            guard let node = parts[n] else { continue }
            let up = SCNAction.scale(to: 1.04, duration: 0.6), down = SCNAction.scale(to: 1.0, duration: 0.6)
            up.timingMode = .easeInEaseOut; down.timingMode = .easeInEaseOut
            node.runAction(.repeatForever(.sequence([up, down])), forKey: "focus-pulse")
        }
    }

    /// World-space centroid of the named parts (root-relative bounds → world).
    func worldCentre(of names: [String]) -> simd_float3? {
        var acc = simd_float3(0, 0, 0); var n: Float = 0
        for name in names {
            guard let node = parts[name] else { continue }
            let (lo, hi) = node.boundingBox
            let c = SCNVector3((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
            let w = node.convertPosition(c, to: nil)
            acc += simd_float3(w); n += 1
        }
        return n > 0 ? acc / n : nil
    }

    // MARK: - Hit test

    /// The part a hit landed on (walks up to the `cmp:` ancestor).
    func partName(hit node: SCNNode) -> String? {
        var cur: SCNNode? = node
        while let n = cur {
            if let name = n.name, name.hasPrefix("cmp:") { return name }
            cur = n.parent
        }
        return nil
    }

    /// Display info for a part from the GLB extras (part number, description).
    func partInfo(_ name: String) -> (title: String, partNumber: String?, description: String?) {
        let ex = extras[name] ?? [:]
        let display = (ex["displayName"] as? String) ?? String(name.dropFirst(4)).replacingOccurrences(of: "_", with: " ")
        return (display, ex["partNumber"] as? String, ex["description"] as? String)
    }

    // MARK: - Internals

    private func currentShow(_ node: SCNNode) -> PartShow {
        if node.isHidden { return .hidden }
        return node.opacity < 0.95 ? .ghost : .solid
    }

    private func setVisual(_ node: SCNNode, name: String, state p: PartState) {
        switch p.show {
        case .hidden: node.opacity = 0; node.isHidden = true
        case .ghost:  node.isHidden = false; node.opacity = CGFloat(max(0.05, p.opacity))
        case .solid:  node.isHidden = false; node.opacity = 1
        }
        // colour override / restore
        let base = baseColors[name] ?? []
        var k = 0
        node.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] {
                if let c = p.color {
                    m.diffuse.contents = UIColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1)
                    m.emission.contents = UIColor(red: CGFloat(c.x) * 0.35, green: CGFloat(c.y) * 0.35, blue: CGFloat(c.z) * 0.35, alpha: 1)
                } else if k < base.count {
                    m.diffuse.contents = base[k]; m.emission.contents = UIColor.black
                }
                k += 1
            }
        }
    }

    private func setPose(_ node: SCNNode, name: String, position: simd_float3?, rotation: simd_float4?) {
        guard let r = rest[name] else { return }
        // Cortona/glTF deltas are in the part's PARENT frame; keep the rest
        // matrix's scale/centre and replace translation / rotation only.
        var m = r
        if let rot = rotation {
            let axis = simd_float3(rot.x, rot.y, rot.z)
            let q = simd_length(axis) > 1e-6 ? simd_quatf(angle: rot.w, axis: simd_normalize(axis)) : simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
            let scale = simd_float3(simd_length(r.columns.0.xyz), simd_length(r.columns.1.xyz), simd_length(r.columns.2.xyz))
            var rm = simd_float4x4(q)
            rm.columns.0 *= scale.x; rm.columns.1 *= scale.y; rm.columns.2 *= scale.z
            rm.columns.3 = r.columns.3
            m = rm
        }
        if let p = position { m.columns.3 = simd_float4(p, 1) }
        node.simdTransform = m
    }

    private func vec3(_ a: [Double]) -> simd_float3? { a.count == 3 ? simd_float3(Float(a[0]), Float(a[1]), Float(a[2])) : nil }
    private func vec4(_ a: [Double]) -> simd_float4? { a.count == 4 ? simd_float4(Float(a[0]), Float(a[1]), Float(a[2]), Float(a[3])) : nil }
}

private extension simd_float4 {
    var xyz: simd_float3 { simd_float3(x, y, z) }
}
