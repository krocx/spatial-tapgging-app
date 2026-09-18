//
//  AssemblyNode.swift
//  SpatialTaggingApp
//
//  AR OJT slice 2 — the assembly in the scene: a registry of named parts and
//  the operations the guide runtime needs on them.
//
//    apply(state:)                  jump to a cumulative PartState map (no animation)
//    play(deltas:speed:)            animate a step's deltas from the current pose
//    focus(parts:)                  pulse the parts a step is about
//    partName(hit:)                 which (visible) part a tap landed on
//
//  Visibility is expressed on MATERIALS (transparency), never on node opacity:
//  node opacity multiplies down the hierarchy, so a ghosted group would dim a
//  child the step just made solid. Instead every explicit part state is
//  applied to its subtree, parents before children, so a child's own state
//  overrides its group's — the same semantics the source viewer has (a
//  transparency command on "FULL BIKE" then a solid command on "STEM").
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
    /// Part names sorted parents-first (ancestor count), so a child's explicit
    /// state is applied after — and therefore overrides — its group's.
    private let depthOrder: [String]
    private let depthOf: [String: Int]
    /// The model's own colour / alpha per material (restored on reset).
    private var baseColor: [ObjectIdentifier: UIColor] = [:]
    private var baseAlpha: [ObjectIdentifier: CGFloat] = [:]
    private var current: [String: PartState] = [:]
    private var focused: Set<String> = []
    let extras: [String: [String: Any]]
    let bounds: (min: simd_float3, max: simd_float3)?

    init(assembly: GLBAssembly) {
        root = assembly.root
        parts = assembly.parts
        rest = assembly.restTransforms
        extras = assembly.extras
        bounds = assembly.bounds
        var depth: [String: Int] = [:]
        for (name, node) in parts {
            var d = 0; var p = node.parent
            while let n = p { if let nm = n.name, nm.hasPrefix("cmp:") { d += 1 }; p = n.parent }
            depth[name] = d
        }
        depthOf = depth
        depthOrder = parts.keys.sorted { (depth[$0] ?? 0, $0) < (depth[$1] ?? 0, $1) }
        root.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] {
                let id = ObjectIdentifier(m)
                baseColor[id] = (m.diffuse.contents as? UIColor) ?? .lightGray
                baseAlpha[id] = m.transparency
            }
        }
    }

    // MARK: - State

    /// Jump to `state`: everything back to rest/solid first, then every
    /// explicit part state applied parents-first.
    func apply(state: [String: PartState]) {
        cancelPlayback()                        // pending deltas of the previous step must not land on this state
        root.enumerateHierarchy { n, _ in n.removeAction(forKey: "flash") }   // resetAll clears emission
        SCNTransaction.begin(); SCNTransaction.animationDuration = 0
        resetAll()
        for name in depthOrder {
            guard let p = state[name], let node = parts[name] else { continue }
            setVisual(node, state: p)
            setPose(node, name: name, position: p.position, rotation: p.rotation)
        }
        current = state
        SCNTransaction.commit()
    }

    /// Play a step's deltas as a TIMELINE — each at its own offset, exactly as
    /// the source viewer sequences them (fade in → flash → move → stays).
    /// Call after `apply(state: after index-1)`. Returns the total length so
    /// callers can schedule a replay loop; a later call cancels pending deltas.
    @discardableResult
    func play(deltas: [GuideStepNode], speed: Double = 1.0) -> TimeInterval {
        playGeneration &+= 1
        let gen = playGeneration
        let k = 1.0 / max(0.1, speed)
        var total: TimeInterval = 0
        // Chronological; parents before children within the same instant.
        let ordered = deltas.enumerated().sorted {
            let a = $0.element.delaySec ?? 0, b = $1.element.delaySec ?? 0
            if a != b { return a < b }
            let da = depthOf[$0.element.node] ?? 0, db = depthOf[$1.element.node] ?? 0
            return da != db ? da < db : $0.offset < $1.offset
        }.map(\.element)
        for d in ordered {
            guard parts[d.node] != nil else { continue }
            let delay = (d.delaySec ?? 0) * k
            let hasMotion = d.to != nil || d.rotationTo != nil
            // Real seconds from the source; floor so a motion never reads as a
            // flash and a visibility change still animates rather than pops.
            let raw = (d.durationSec ?? 1.0) * k
            let dur = hasMotion ? max(0.8, raw) : (d.effect != nil ? max(0.6, raw) : max(0.25, raw))
            total = max(total, delay + dur)
            if delay < 0.02 {
                fire(d, duration: dur)
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let self, self.playGeneration == gen else { return }
                    self.fire(d, duration: dur)
                }
            }
        }
        return total
    }

    /// Stop pending deltas (step change / teardown).
    func cancelPlayback() { playGeneration &+= 1 }

    private var playGeneration: UInt64 = 0

    /// Apply one delta now, animated over `dur`.
    private func fire(_ d: GuideStepNode, duration dur: TimeInterval) {
        guard let node = parts[d.node] else { return }
        let from = d.from.flatMap(vec3), to = d.to.flatMap(vec3)
        let rFrom = d.rotationFrom.flatMap(vec4), rTo = d.rotationTo.flatMap(vec4)
        let hasMotion = to != nil || rTo != nil
        let prior = effectiveState(of: d.node)

        if d.effect == "flash" {
            flash(node, duration: dur)
            if !hasMotion && d.show == nil && d.color == nil { return }
        }

        var target = prior
        if let show = d.show, let s = PartShow(rawValue: show) {
            target.show = s
            target.opacity = s == .ghost ? Float(d.opacity ?? 0.35) : (s == .hidden ? 0 : 1)
        } else if d.animate == "insert" || (hasMotion && prior.show == .hidden) {
            target.show = .solid; target.opacity = 1        // a part that moves must be seen moving
        }
        if let c = d.color, c.count == 3 { target.color = simd_float3(Float(c[0]), Float(c[1]), Float(c[2])) }
        if let p = to { target.position = p }
        if let r = rTo { target.rotation = r }

        if hasMotion {
            SCNTransaction.begin(); SCNTransaction.animationDuration = 0
            setPose(node, name: d.node, position: from ?? prior.position, rotation: rFrom ?? prior.rotation)
            if prior.show == .hidden { var start = target; start.show = .ghost; start.opacity = 0.15; setVisual(node, state: start) }
            SCNTransaction.commit()
        }
        // Moved AND hidden in one delta: travel first, hide at the end.
        let hideAfter = hasMotion && target.show == .hidden
        var during = target
        if hideAfter { during.show = prior.show == .hidden ? .solid : prior.show; during.opacity = prior.show == .ghost ? prior.opacity : 1 }

        let name = d.node
        SCNTransaction.begin()
        SCNTransaction.animationDuration = dur
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        if hideAfter {
            SCNTransaction.completionBlock = { [weak self] in
                guard let self, self.current[name] == target else { return }
                SCNTransaction.begin(); SCNTransaction.animationDuration = 0.4
                self.setVisual(node, state: target)
                SCNTransaction.commit()
            }
        }
        setVisual(node, state: during)
        if hasMotion { setPose(node, name: d.node, position: to, rotation: rTo) }
        SCNTransaction.commit()
        current[d.node] = target
    }

    /// Cortona "flash": pulse the part's emission a few times, leave no state.
    private func flash(_ node: SCNNode, duration: TimeInterval) {
        node.removeAction(forKey: "flash")
        let pulses = max(2, Int(duration / 0.5))
        let on  = SCNAction.customAction(duration: 0.001) { n, _ in
            n.enumerateHierarchy { c, _ in for m in c.geometry?.materials ?? [] { m.emission.contents = UIColor(red: 0.9, green: 0.75, blue: 0.1, alpha: 1) } }
        }
        let off = SCNAction.customAction(duration: 0.001) { n, _ in
            n.enumerateHierarchy { c, _ in for m in c.geometry?.materials ?? [] { m.emission.contents = UIColor.black } }
        }
        let half = duration / Double(pulses) / 2
        node.runAction(.sequence([.repeat(.sequence([on, .wait(duration: half), off, .wait(duration: half)]), count: pulses), off]), forKey: "flash")
    }

    /// State a part is currently shown with — its own, else inherited from
    /// the nearest group above it that has one, else rest/solid.
    func effectiveState(of name: String) -> PartState {
        if let s = current[name] { return s }
        var p = parts[name]?.parent
        while let n = p {
            if let nm = n.name, nm.hasPrefix("cmp:"), let s = current[nm] {
                var inherited = PartState(); inherited.show = s.show; inherited.opacity = s.opacity; inherited.color = s.color
                return inherited
            }
            p = n.parent
        }
        return PartState()
    }

    // MARK: - Focus

    /// Pulse the given parts (and stop pulsing the previous ones).
    func focus(parts names: [String]) {
        for n in focused { parts[n]?.removeAction(forKey: "focus-pulse"); parts[n]?.scale = SCNVector3(1, 1, 1) }
        focused = Set(names)
        for n in names {
            guard let node = parts[n] else { continue }
            let up = SCNAction.scale(to: 1.04, duration: 0.6), down = SCNAction.scale(to: 1.0, duration: 0.6)
            up.timingMode = .easeInEaseOut; down.timingMode = .easeInEaseOut
            node.runAction(.repeatForever(.sequence([up, down])), forKey: "focus-pulse")
        }
    }

    /// World-space centroid of the named parts.
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

    /// The part a hit landed on (nearest `cmp:` ancestor), ignoring hidden ones —
    /// transparent geometry is still hit-testable.
    func partName(hit node: SCNNode) -> String? {
        var cur: SCNNode? = node
        while let n = cur {
            if let name = n.name, name.hasPrefix("cmp:") {
                return effectiveState(of: name).show == .hidden ? nil : name
            }
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

    private func resetAll() {
        root.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] {
                let id = ObjectIdentifier(m)
                m.diffuse.contents = baseColor[id] ?? UIColor.lightGray
                m.emission.contents = UIColor.black
                m.transparency = baseAlpha[id] ?? 1
            }
        }
        for (name, node) in parts { if let r = rest[name] { node.simdTransform = r } }
        current = [:]
    }

    /// Apply visibility + colour to the part's whole subtree (materials only).
    private func setVisual(_ node: SCNNode, state p: PartState) {
        let alphaFactor: CGFloat
        switch p.show {
        case .hidden: alphaFactor = 0
        case .ghost:  alphaFactor = CGFloat(max(0.05, min(1, p.opacity)))
        case .solid:  alphaFactor = 1
        }
        node.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] {
                let id = ObjectIdentifier(m)
                m.transparency = (baseAlpha[id] ?? 1) * alphaFactor
                if let c = p.color {
                    m.diffuse.contents  = UIColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1)
                    m.emission.contents = UIColor(red: CGFloat(c.x) * 0.35, green: CGFloat(c.y) * 0.35, blue: CGFloat(c.z) * 0.35, alpha: 1)
                } else {
                    m.diffuse.contents  = baseColor[id] ?? UIColor.lightGray
                    m.emission.contents = UIColor.black
                }
            }
        }
    }

    private func setPose(_ node: SCNNode, name: String, position: simd_float3?, rotation: simd_float4?) {
        guard let r = rest[name] else { return }
        // Cortona/glTF deltas are in the part's PARENT frame; keep the rest
        // matrix's scale and replace translation / rotation only.
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
