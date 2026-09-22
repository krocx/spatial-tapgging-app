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
        let partNames = Set(assembly.parts.keys)
        for (name, node) in assembly.parts {
            var d = 0; var p = node.parent
            while let n = p { if let nm = n.name, partNames.contains(nm) { d += 1 }; p = n.parent }
            depth[name] = d
        }
        depthOf = depth
        depthOrder = parts.keys.sorted { (depth[$0] ?? 0, $0) < (depth[$1] ?? 0, $1) }
        root.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] {
                let id = ObjectIdentifier(m)
                baseColor[id] = (m.diffuse.contents as? UIColor) ?? .lightGray
                baseAlpha[id] = m.transparency
                // Rim-light highlight (own Metal snippet): the part keeps its
                // colour and shading; a glow hugs its silhouette. Intensity 0
                // = invisible, so it is installed once and only animated later.
                m.shaderModifiers = [.fragment: AssemblyNode.rimShader]
                m.setValue(NSValue(scnVector3: SCNVector3(0.2, 0.85, 1.0)), forKey: "rimColor")
                m.setValue(NSNumber(value: 0), forKey: "rimIntensity")
            }
        }
    }

    static let rimShader = """
    #pragma arguments
    float3 rimColor;
    float rimIntensity;
    #pragma body
    float3 n = normalize(_surface.normal);
    float3 v = normalize(_surface.view);
    float rim = pow(1.0 - saturate(dot(n, v)), 2.2);
    _output.color.rgb += rimColor * (rim * rimIntensity + 0.12 * rimIntensity);
    """

    private func setRim(_ node: SCNNode, color: UIColor? = nil, intensity: Float) {
        node.enumerateHierarchy { c, _ in
            for m in c.geometry?.materials ?? [] {
                if let color {
                    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                    color.getRed(&r, green: &g, blue: &b, alpha: &a)
                    m.setValue(NSValue(scnVector3: SCNVector3(Float(r), Float(g), Float(b))), forKey: "rimColor")
                }
                m.setValue(NSNumber(value: intensity), forKey: "rimIntensity")
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

    /// Spotlight the parts a step is about: a cyan emissive glow that pulses,
    /// plus a leader line from `leaderFrom` (the step pin) to their centroid.
    /// Materials are per part (GLBLoader clones them), so the glow never
    /// bleeds into neighbours. A 4 % scale pulse was invisible on small parts.
    func focus(parts names: [String], leaderFrom: simd_float3? = nil) {
        for n in focused {
            parts[n]?.removeAction(forKey: "focus-pulse")
            parts[n]?.scale = SCNVector3(1, 1, 1)
            if let node = parts[n] { restoreEmission(node) }
        }
        focused = Set(names)
        leaderNode?.removeFromParentNode(); leaderNode = nil
        let glow = UIColor(red: 0.20, green: 0.85, blue: 1.0, alpha: 1)
        for n in names {
            guard let node = parts[n] else { continue }
            // Breathing rim: 0.35 → 1.0 → 0.35 over 1.6 s. Colour and shading stay.
            let pulse = SCNAction.customAction(duration: 1.6) { [weak self] nd, t in
                let phase = Float(t / 1.6) * 2 * Float.pi
                self?.setRim(nd, color: glow, intensity: 0.675 + 0.325 * sin(phase - .pi / 2))
            }
            node.runAction(.repeatForever(pulse), forKey: "focus-pulse")
        }
        if let from = leaderFrom, let to = worldCentre(of: names), simd_length(to - from) > 0.03 {
            leaderNode = makeLeader(from: from, to: to, color: glow)
            root.parent?.addChildNode(leaderNode!)
        }
    }

    /// Wrong part tapped / "Show me": the right parts flash three times while
    /// everything else steps back to a ghost for `seconds`, then normal.
    func spotlightFlash(parts names: [String], seconds: TimeInterval = 2.5) {
        let targets = Set(names)
        SCNTransaction.begin(); SCNTransaction.animationDuration = 0.25
        for (name, node) in parts where !targets.contains(name) && !isAncestorOfAny(node, targets) {
            var st = effectiveState(of: name); if st.show == .hidden { continue }
            st.show = .ghost; st.opacity = 0.18; setVisual(node, state: st)
        }
        SCNTransaction.commit()
        for (name, node) in parts where !targets.contains(name) { node.removeAction(forKey: "select-pulse"); if !focused.contains(name) { setRim(node, intensity: 0) } }
        for n in names {
            guard let node = parts[n] else { continue }
            node.removeAction(forKey: "select-pulse")
            let flash = SCNAction.customAction(duration: 1.8) { [weak self] nd, t in
                let k = Float(abs(sin(Float(t / 1.8) * 3 * .pi)))      // three peaks
                self?.setRim(nd, color: .white, intensity: 0.6 + 1.6 * k)
            }
            node.runAction(flash, forKey: "spot-flash")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self else { return }
            SCNTransaction.begin(); SCNTransaction.animationDuration = 0.35
            for (name, node) in self.parts where !targets.contains(name) { self.setVisual(node, state: self.effectiveState(of: name)) }
            SCNTransaction.commit()
        }
    }

    private var leaderNode: SCNNode?

    private func isAncestorOfAny(_ node: SCNNode, _ names: Set<String>) -> Bool {
        for n in names { var p = parts[n]?.parent; while let c = p { if c == node { return true }; p = c.parent } }
        return false
    }

    private func restoreEmission(_ node: SCNNode) {
        node.enumerateHierarchy { c, _ in for m in c.geometry?.materials ?? [] { m.emission.contents = UIColor.black } }
        setRim(node, intensity: 0)
    }

    /// Tap feedback: a white rim that fades over 1.2 s. It never changes the
    /// step focus — the step's parts keep their cyan breathing.
    func selectPulse(part name: String) {
        guard let node = parts[name] else { return }
        node.removeAction(forKey: "select-pulse")
        let isFocused = focused.contains(name)
        let fade = SCNAction.customAction(duration: 1.2) { [weak self] nd, t in
            let k = Float(1 - t / 1.2)
            self?.setRim(nd, color: .white, intensity: 1.4 * k)
        }
        let restore = SCNAction.customAction(duration: 0.001) { [weak self] nd, _ in
            if isFocused { self?.setRim(nd, color: UIColor(red: 0.2, green: 0.85, blue: 1.0, alpha: 1), intensity: 0.6) }
            else { self?.setRim(nd, intensity: 0) }
        }
        node.runAction(.sequence([fade, restore]), forKey: "select-pulse")
    }

    private func makeLeader(from a: simd_float3, to b: simd_float3, color: UIColor) -> SCNNode {
        let d = b - a; let len = simd_length(d)
        let cyl = SCNCylinder(radius: 0.0025, height: CGFloat(len))
        let m = SCNMaterial(); m.diffuse.contents = color; m.emission.contents = color; m.transparency = 0.85; cyl.materials = [m]
        let n = SCNNode(geometry: cyl); n.name = "focus-leader"
        n.simdPosition = (a + b) / 2
        let dir = d / max(0.001, len)
        n.simdLook(at: b, up: abs(dir.y) > 0.9 ? simd_float3(1, 0, 0) : simd_float3(0, 1, 0), localFront: simd_float3(0, 1, 0))
        let dot = SCNNode(geometry: SCNSphere(radius: 0.008)); dot.geometry?.materials = [m]; dot.simdPosition = simd_float3(0, len / 2, 0)
        n.addChildNode(dot)
        n.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.4, duration: 0.55), .fadeOpacity(to: 1, duration: 0.55)])))
        return n
    }

    /// World-space centroid of the named parts.
    /// Largest world-space radius among the named parts (half the bounding
    /// box diagonal, scaled). Lets the pin size itself to the part.
    func extent(of names: [String]) -> Float? {
        var best: Float = 0; var any = false
        for name in names {
            guard let node = parts[name] else { continue }
            let (lo, hi) = node.boundingBox
            let dx = Float(hi.x - lo.x), dy = Float(hi.y - lo.y), dz = Float(hi.z - lo.z)
            let s = node.convertVector(SCNVector3(1, 1, 1), to: nil)
            let r = 0.5 * sqrt(dx * dx + dy * dy + dz * dz) * max(abs(Float(s.x)), abs(Float(s.y)), abs(Float(s.z))) / sqrt(3)
            best = max(best, r); any = true
        }
        return any ? best : nil
    }

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

    // MARK: - View hint ("look from here")

    /// Where the source procedure viewed this step from, as a small camera
    /// marker in the assembly frame (VRML Viewpoint: `position`, `orientation`
    /// axis-angle rotating the default −Z look direction; `center` wins when
    /// present). Kept a constant on-screen size regardless of the root scale.
    private var viewHintNode: SCNNode?
    private var viewTarget: simd_float3?          // model frame

    func setViewHint(_ view: GuideStepView?) {
        viewHintNode?.removeFromParentNode(); viewHintNode = nil; viewTarget = nil
        guard let v = view, let p = v.position, p.count == 3 else { return }
        let pos = simd_float3(Float(p[0]), Float(p[1]), Float(p[2]))
        var dir = simd_float3(0, 0, -1)
        if let o = v.orientation, o.count == 4, simd_length(simd_float3(Float(o[0]), Float(o[1]), Float(o[2]))) > 0.001 {
            let q = simd_quatf(angle: Float(o[3]), axis: simd_normalize(simd_float3(Float(o[0]), Float(o[1]), Float(o[2]))))
            dir = q.act(dir)
        }
        var target = pos + dir * max(0.3, simd_length(pos))
        if let c = v.center, c.count == 3 { target = simd_float3(Float(c[0]), Float(c[1]), Float(c[2])); dir = simd_normalize(target - pos) }
        viewTarget = target

        let hint = SCNNode(); hint.name = "view-hint"
        hint.simdPosition = pos
        // Camera body + lens cone pointing along −Z of the hint node.
        let body = SCNNode(geometry: SCNBox(width: 0.06, height: 0.04, length: 0.03, chamferRadius: 0.006))
        let lens = SCNNode(geometry: SCNCone(topRadius: 0.012, bottomRadius: 0.024, height: 0.03))
        lens.eulerAngles.x = -.pi / 2; lens.position.z = -0.03
        for n in [body, lens] {
            let m = SCNMaterial(); m.diffuse.contents = UIColor.systemBlue; m.emission.contents = UIColor.systemBlue.withAlphaComponent(0.6)
            m.transparency = 0.85; n.geometry?.materials = [m]
        }
        hint.addChildNode(body); hint.addChildNode(lens)
        root.addChildNode(hint)                                   // world-space look needs the parent
        hint.simdLook(at: root.simdConvertPosition(target, to: nil), up: simd_float3(0, 1, 0), localFront: simd_float3(0, 0, -1))
        let rs = max(0.05, root.simdScale.x)
        hint.simdScale = simd_float3(repeating: 1 / rs)
        hint.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.45, duration: 0.8), .fadeOpacity(to: 1, duration: 0.8)])))
        viewHintNode = hint
    }

    /// How far the camera is from the hinted viewpoint: metres to the viewpoint
    /// and degrees between the camera's forward and the hinted look direction.
    /// nil when the step has no view.
    func viewAlignment(cameraTransform t: simd_float4x4) -> (distance: Float, angle: Float, viewpointWorld: simd_float3)? {
        guard let hint = viewHintNode, let target = viewTarget else { return nil }
        let vpW = simd_float3(hint.simdWorldPosition)
        let tgW = root.simdConvertPosition(target, to: nil)
        let cam = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let camFwd = -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        let want = simd_normalize(tgW - vpW)
        let cosA = max(-1, min(1, simd_dot(camFwd, want)))
        return (simd_length(cam - vpW), acos(cosA) * 180 / .pi, vpW)
    }

    func setViewHintHidden(_ hidden: Bool) { viewHintNode?.isHidden = hidden }

    /// Remove scene-level helpers (leader line) — call before removing `root`.
    func removeHelpers() { leaderNode?.removeFromParentNode(); leaderNode = nil }

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
        let bare = name.hasPrefix("cmp:") ? String(name.dropFirst(4)) : name
        let display = (ex["displayName"] as? String) ?? bare.replacingOccurrences(of: "_", with: " ")
        return (display, ex["partNumber"] as? String, ex["description"] as? String)
    }

    // MARK: - Internals

    private func resetAll() {
        root.enumerateHierarchy { n, _ in
            if n.parent?.name == "view-hint" { return }          // the camera marker keeps its own look
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
