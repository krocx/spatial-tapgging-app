// PlacementTools.swift - one tool at a time for 3D placement (2026.4.46).
//
// Every place a model is positioned in AR (Place Model, per-step slot
// adjustment, Place Assembly) shares this: the author picks ONE tool, and only
// that tool's gesture is live. No more accidental scale-while-rotating.
//
//   Move   1-finger drag slides on the ground plane (XZ)
//   Lift   1-finger drag up/down (Y)
//   Turn   1-finger drag left/right spins around Y (yaw)
//   Tilt   1-finger drag up/down tips around X (pitch); left/right rolls (Z)
//   Scale  pinch only
//
// Turn / Tilt snap softly to 15° (within 3° of a multiple) and show a live
// readout. Quick actions: Flip 180° · Turn 90° · Reset · Copy from previous.

import SwiftUI
import ARKit
import SceneKit
import simd

// ── Tool ──────────────────────────────────────────────────────────────────────

enum PlacementTool: String, CaseIterable, Identifiable {
    case move, lift, turn, tilt, scale
    var id: String { rawValue }

    var label: String {
        switch self {
        case .move:  return "Move"
        case .lift:  return "Lift"
        case .turn:  return "Turn"
        case .tilt:  return "Tilt"
        case .scale: return "Scale"
        }
    }
    var icon: String {
        switch self {
        case .move:  return "arrow.up.and.down.and.arrow.left.and.right"
        case .lift:  return "arrow.up.and.down"
        case .turn:  return "rotate.right"
        case .tilt:  return "rotate.3d"
        case .scale: return "arrow.up.left.and.arrow.down.right"
        }
    }
    /// One line under the toolbar telling the author what the active gesture does.
    var hint: String {
        switch self {
        case .move:  return "Drag to slide the model on the surface"
        case .lift:  return "Drag up or down to raise or lower it"
        case .turn:  return "Drag left or right to spin it · snaps to 15°"
        case .tilt:  return "Drag up/down to tip it, left/right to roll it · snaps to 15°"
        case .scale: return "Pinch to resize"
        }
    }
    var usesPinch: Bool { self == .scale }
}

// ── Maths shared by the three placement screens ──────────────────────────────

enum PlacementMath {
    /// Screen points → radians for Turn / Tilt: 2 pt per degree, so a full
    /// screen-width drag is roughly a half turn.
    static func dragToRadians(_ points: CGFloat) -> Float { Float(points) * 0.5 * .pi / 180 }

    /// Soft snap: within 3° of a multiple of 15° lands exactly on it.
    static func snap(_ radians: Float) -> Float {
        let deg  = radians * 180 / .pi
        let near = (deg / 15).rounded() * 15
        return abs(deg - near) <= 3 ? near * .pi / 180 : radians
    }

    /// Normalise to (-180°, 180°] for readouts.
    static func degrees(_ radians: Float) -> Int {
        var d = Int((radians * 180 / .pi).rounded()) % 360
        if d > 180 { d -= 360 }
        if d <= -180 { d += 360 }
        return d
    }
}

// ── Gesture container: only the active tool's recogniser is enabled ──────────

struct PlacementGestureContainer: UIViewRepresentable {

    @ObservedObject var arManager: ARSessionManager
    var tool: PlacementTool
    /// False disables every placement gesture (e.g. while aiming or loading).
    var active: Bool = true

    // Tap - only used by screens that also drop pins.
    var onTap:          ((CGPoint) -> Void)?

    // 1-finger drag: location + translation since began.
    var onPanBegan:     ((CGPoint) -> Void)?
    var onPanChanged:   ((CGPoint, CGPoint) -> Void)?
    var onPanEnded:     (() -> Void)?

    // Pinch (Scale tool only).
    var onPinchBegan:   (() -> Void)?
    var onPinchChanged: ((CGFloat) -> Void)?
    var onPinchEnded:   ((CGFloat) -> Void)?

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PlacementGestureContainer
        var pan:   UIPanGestureRecognizer?
        var pinch: UIPinchGestureRecognizer?
        init(_ parent: PlacementGestureContainer) { self.parent = parent }

        @objc func handleTap(_ r: UITapGestureRecognizer) {
            guard r.state == .ended, let v = r.view else { return }
            parent.onTap?(r.location(in: v))
        }
        @objc func handlePan(_ r: UIPanGestureRecognizer) {
            guard let v = r.view else { return }
            let pt = r.location(in: v)
            switch r.state {
            case .began:             parent.onPanBegan?(pt)
            case .changed:           parent.onPanChanged?(pt, r.translation(in: v))
            case .ended, .cancelled: parent.onPanEnded?()
            default: break
            }
        }
        @objc func handlePinch(_ r: UIPinchGestureRecognizer) {
            switch r.state {
            case .began:             r.scale = 1; parent.onPinchBegan?()
            case .changed:           parent.onPinchChanged?(r.scale)
            case .ended, .cancelled: parent.onPinchEnded?(r.scale)
            default: break
            }
        }
        func sync() {
            pan?.isEnabled   = parent.active && !parent.tool.usesPinch
            pinch?.isEnabled = parent.active &&  parent.tool.usesPinch
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = arManager.sceneView
        let c    = context.coordinator

        let tap = UITapGestureRecognizer(target: c, action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = c
        view.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: c, action: #selector(Coordinator.handlePan(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.delegate = c
        view.addGestureRecognizer(pan)
        c.pan = pan

        let pinch = UIPinchGestureRecognizer(target: c, action: #selector(Coordinator.handlePinch(_:)))
        pinch.delegate = c
        view.addGestureRecognizer(pinch)
        c.pinch = pinch

        c.sync()
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync()
    }

    // Sessions are paused by the owning view's onDisappear - not here.
    static func dismantleUIView(_ uiView: ARSCNView, coordinator: Coordinator) {}
}

// ── Pin drop feedback ─────────────────────────────────────────────────────────

/// The "tap to tag" signature, shared by every surface that drops a pin:
/// pop, an expanding ring on the surface, a success haptic. One look and one
/// feel across AR OMS, iLOTO, Gemba and the Lab.
enum ARPinFX {
    static func drop(on node: SCNNode?, accent: UIColor = .systemGreen) {
        guard let node else { return }
        node.removeAction(forKey: "drop")
        let pop = SCNAction.sequence([
            .scale(to: 0.6, duration: 0.0),
            .scale(to: 1.18, duration: 0.14),
            .scale(to: 1.0, duration: 0.12),
        ])
        node.runAction(pop, forKey: "drop")
        let torus = SCNTorus(ringRadius: 0.03, pipeRadius: 0.003)
        let m = SCNMaterial(); m.diffuse.contents = accent; m.lightingModel = .constant
        m.emission.contents = accent; torus.firstMaterial = m
        let ring = SCNNode(geometry: torus)
        ring.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        ring.opacity = 0.9
        node.addChildNode(ring)
        ring.runAction(.sequence([
            .group([.scale(to: 3.2, duration: 0.55), .fadeOut(duration: 0.55)]),
            .removeFromParentNode(),
        ]))
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

/// The tool picker + live readout + quick actions. Same bar everywhere a
/// model is placed; screens hide tools that don't apply (`tools`) and pass
/// nil for quick actions they can't offer.
struct PlacementToolbar: View {
    @Binding var tool: PlacementTool
    var tools: [PlacementTool] = PlacementTool.allCases
    /// e.g. "1.00×  ·  turn 90°  ·  tilt 0°"
    var readout: String
    var onFlip:         (() -> Void)?
    var onTurn90:       (() -> Void)?
    var onReset:        (() -> Void)?
    var onCopyPrevious: (() -> Void)?

    @AppStorage("placementToolsExplained") private var explained = false

    var body: some View {
        VStack(spacing: 8) {
            // Tool picker - one segment is lit; only its gesture is live.
            HStack(spacing: 6) {
                ForEach(tools) { t in
                    Button {
                        tool = t
                        explained = true
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: t.icon).font(.system(size: 17, weight: .semibold))
                            Text(t.label).font(.system(size: 11, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(tool == t ? Color.blue : Color.white.opacity(0.10))
                        .foregroundStyle(tool == t ? Color.white : Color.white.opacity(0.75))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .accessibilityLabel(t.label)
                    .accessibilityAddTraits(tool == t ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)

            // Hint for the active tool - or the one-time coach line.
            Text(explained ? tool.hint : "One tool at a time - pick it, then drag or pinch.")
                .font(.caption).foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center).lineLimit(2)
                .padding(.horizontal, 16)

            // Live readout
            Text(readout)
                .font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.85))

            // Quick actions
            if onFlip != nil || onTurn90 != nil || onReset != nil || onCopyPrevious != nil {
                HStack(spacing: 8) {
                    if let f = onFlip     { quick("Flip 180°", "arrow.up.arrow.down", f) }
                    if let t = onTurn90   { quick("Turn 90°", "rotate.right", t) }
                    if let r = onReset    { quick("Reset", "arrow.counterclockwise", r) }
                    if let c = onCopyPrevious { quick("Copy previous", "doc.on.doc", c) }
                }
                .padding(.horizontal, 12)
            }
        }
    }

    private func quick(_ label: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).padding(.vertical, 8)
                .background(Color.white.opacity(0.12)).foregroundStyle(.white)
                .clipShape(Capsule())
        }
    }
}
