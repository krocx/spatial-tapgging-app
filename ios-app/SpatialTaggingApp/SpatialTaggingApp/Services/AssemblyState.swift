//
//  AssemblyState.swift
//  SpatialTaggingApp
//
//  AR OJT slice 2 — cumulative per-part state of an assembly across a guide.
//
//  Pure model, no SceneKit: `initialNodes` (state before step 1) followed by
//  each step's `nodes[]` deltas, applied in order; last state wins. Stepping
//  backwards is just "state after index-1", so replay is trivially safe.
//  Mirrors gpAssemblyStateAt() in the portal's Guide Preview so what the
//  author previews on the web is what the operator sees in AR.
//

import Foundation
import simd

enum PartShow: String { case hidden, ghost, solid }

struct PartState: Equatable {
    var show:     PartShow = .solid
    var opacity:  Float = 1
    var color:    simd_float3? = nil            // highlight override (r,g,b 0–1)
    var position: simd_float3? = nil            // nil = rest pose (from the model)
    var rotation: simd_float4? = nil            // axis-angle [x,y,z,rad]; nil = rest
}

struct AssemblyStateEngine {
    let initial: [GuideStepNode]
    let stepDeltas: [[GuideStepNode]]           // per step, in guide order

    init(initial: [GuideStepNode]?, steps: [GuideStep]) {
        self.initial = initial ?? []
        self.stepDeltas = steps.map { $0.nodes ?? [] }
    }

    /// Every part name that any delta mentions (for registry warm-up / logging).
    var touchedParts: Set<String> {
        var s = Set<String>()
        for n in initial { s.insert(n.node) }
        for d in stepDeltas { for n in d { s.insert(n.node) } }
        return s
    }

    /// State BEFORE any step (the imported publication's set-up).
    func initialState() -> [String: PartState] {
        var st: [String: PartState] = [:]
        apply(initial, to: &st, asInitial: true)
        return st
    }

    /// State after step `index` has fully played (index < 0 → initial state).
    func state(after index: Int) -> [String: PartState] {
        var st = initialState()
        guard index >= 0, !stepDeltas.isEmpty else { return st }
        for i in 0 ... min(index, stepDeltas.count - 1) { apply(stepDeltas[i], to: &st, asInitial: false) }
        return st
    }

    /// The deltas a step animates (its own nodes[]), for the transition into it.
    func deltas(at index: Int) -> [GuideStepNode] {
        guard index >= 0, index < stepDeltas.count else { return [] }
        return stepDeltas[index]
    }

    /// Names of the parts a step is "about" — the ones it moves, else
    /// highlights, else reveals — for focus pulsing and the look-here arrow.
    func focusParts(at index: Int) -> [String] {
        let d = deltas(at: index)
        let moving = d.filter { $0.animate != nil }.map(\.node)
        if !moving.isEmpty { return moving }
        let lit = d.filter { $0.color != nil }.map(\.node)
        if !lit.isEmpty { return lit }
        return d.filter { $0.show == "solid" }.map(\.node)
    }

    // MARK: - Rules

    /// Apply a list of deltas. For set-up (initial) entries the END of any
    /// motion is the state; for step entries the same holds once the step has
    /// played. `insert` implies solid, `remove` keeps whatever `show` says.
    private func apply(_ deltas: [GuideStepNode], to st: inout [String: PartState], asInitial: Bool) {
        for n in deltas {
            var p = st[n.node] ?? PartState()
            if let show = n.show, let s = PartShow(rawValue: show) {
                p.show = s
                p.opacity = s == .ghost ? Float(n.opacity ?? 0.35) : (s == .hidden ? 0 : 1)
            } else if n.animate == "insert" {
                p.show = .solid; p.opacity = 1
            }
            if let c = n.color, c.count == 3 { p.color = simd_float3(Float(c[0]), Float(c[1]), Float(c[2])) }
            if let to = n.to, to.count == 3 { p.position = simd_float3(Float(to[0]), Float(to[1]), Float(to[2])) }
            if let r = n.rotationTo, r.count == 4 { p.rotation = simd_float4(Float(r[0]), Float(r[1]), Float(r[2]), Float(r[3])) }
            st[n.node] = p
        }
    }
}
