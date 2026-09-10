// PresenceLayer.swift — P1 (2026.4.46): colleagues in the AR view.
//
// Not a humanoid. A "lens" — a small card at the colleague's head with their
// initials, name and site — plus a translucent view cone showing where they
// are looking, and a soft gaze dot where that view meets the chamber. The cone
// IS the information ("she's looking at the gas inlet"); the card says who.
//
//   PresenceLayer        SceneKit nodes, smoothed (0.4 s) between updates
//   PresenceRosterChip   "2 here · Priya (Singapore)" in the top bar
//   PresenceEdgeArrows   edge arrow + name when a colleague is off screen
//   PresenceToast        "Priya joined from Singapore"
//
// Design philosophy: guided, discoverable, a little delightful — and never in
// the way: everything is small, semi-transparent and world-locked.

import SwiftUI
import SceneKit
import ARKit

// ── SceneKit layer ───────────────────────────────────────────────────────────

@MainActor
final class PresenceLayer {
    private let sceneView: ARSCNView
    private let root = SCNNode()
    private var nodes: [String: SCNNode] = [:]
    private var labelCache: [String: UIImage] = [:]
    /// Shared frame → this session's world frame. Identity when the session
    /// frame IS the shared frame (guide map); the QR pose for Spatial Inspection.
    var worldFromShared: simd_float4x4 = matrix_identity_float4x4

    init(sceneView: ARSCNView) {
        self.sceneView = sceneView
        root.name = "presence"
        sceneView.scene.rootNode.addChildNode(root)
    }

    func removeAll() {
        root.removeFromParentNode()
        nodes.removeAll()
    }

    /// Reconcile the scene with the latest roster. Poses are in the shared
    /// frame == this session's world frame (the caller guarantees that).
    func update(_ others: [PresenceEntry]) {
        let ids = Set(others.map(\.userId))
        for (id, n) in nodes where !ids.contains(id) {
            n.removeFromParentNode(); nodes[id] = nil
            root.childNode(withName: "gaze-\(id)", recursively: false)?.removeFromParentNode()
        }
        for e in others {
            guard let shared = e.transform else { continue }
            let t = worldFromShared * shared
            let n = nodes[e.userId] ?? makeNode(for: e)
            nodes[e.userId] = n
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.4
            n.simdWorldTransform = t
            SCNTransaction.commit()
            updateGaze(node: n, pose: t)
        }
    }

    /// A colleague's edit: small "Name · just now" label that floats up and fades.
    func announceEdit(at position: simd_float3, name: String, color: UIColor) {
        let img = renderLabel(text: "\(name) · just now", color: color, width: 220, height: 44)
        let plane = SCNPlane(width: 0.16, height: 0.032)
        plane.cornerRadius = 0.008
        plane.firstMaterial?.diffuse.contents = img
        plane.firstMaterial?.lightingModel = .constant
        plane.firstMaterial?.isDoubleSided = true
        let n = SCNNode(geometry: plane)
        n.simdPosition = position + simd_float3(0, 0.10, 0)
        n.constraints = [SCNBillboardConstraint()]
        n.opacity = 0
        root.addChildNode(n)
        n.runAction(.sequence([
            .group([.fadeIn(duration: 0.25), .moveBy(x: 0, y: 0.06, z: 0, duration: 2.6)]),
            .fadeOut(duration: 0.5), .removeFromParentNode(),
        ]))
    }

    /// C1 "Look here": a pulsing ring + beam at a point with the coach's name,
    /// world-locked, gone after `seconds`. Replaces any previous pointer.
    func showPointer(at sharedPosition: simd_float3, from name: String, color: UIColor, seconds: TimeInterval = 20) {
        root.childNode(withName: "coach-pointer", recursively: false)?.removeFromParentNode()
        let p4 = worldFromShared * simd_float4(sharedPosition, 1)
        let p  = simd_float3(p4.x, p4.y, p4.z)
        let n = SCNNode(); n.name = "coach-pointer"; n.simdPosition = p

        let ring = SCNNode(geometry: SCNTorus(ringRadius: 0.06, pipeRadius: 0.006))
        ring.geometry?.firstMaterial?.diffuse.contents = color
        ring.geometry?.firstMaterial?.emission.contents = color
        ring.geometry?.firstMaterial?.lightingModel = .constant
        ring.runAction(.repeatForever(.sequence([
            .group([.scale(to: 1.8, duration: 0.9), .fadeOpacity(to: 0.15, duration: 0.9)]),
            .group([.scale(to: 1.0, duration: 0.0), .fadeOpacity(to: 1.0, duration: 0.0)]),
        ])))
        n.addChildNode(ring)

        let beam = SCNNode(geometry: SCNCylinder(radius: 0.004, height: 0.35))
        beam.geometry?.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.7)
        beam.geometry?.firstMaterial?.lightingModel = .constant
        beam.position = SCNVector3(0, 0.175, 0)
        n.addChildNode(beam)

        let label = SCNNode(geometry: {
            let pl = SCNPlane(width: 0.18, height: 0.036); pl.cornerRadius = 0.009
            pl.firstMaterial?.diffuse.contents = renderLabel(text: "\(name): look here", color: color, width: 240, height: 48)
            pl.firstMaterial?.lightingModel = .constant; pl.firstMaterial?.isDoubleSided = true
            return pl
        }())
        label.position = SCNVector3(0, 0.40, 0)
        label.constraints = [SCNBillboardConstraint()]
        n.addChildNode(label)

        root.addChildNode(n)
        n.runAction(.sequence([.wait(duration: seconds), .fadeOut(duration: 0.6), .removeFromParentNode()]))
    }

    func hidePointer() {
        root.childNode(withName: "coach-pointer", recursively: false)?.removeFromParentNode()
    }

    /// Pulse a pin the colleague just placed/moved.
    static func pulse(_ node: SCNNode, color: UIColor) {
        let glow = SCNNode(geometry: SCNSphere(radius: 0.05))
        glow.geometry?.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.35)
        glow.geometry?.firstMaterial?.lightingModel = .constant
        node.addChildNode(glow)
        glow.runAction(.sequence([.group([.scale(to: 2.4, duration: 1.2), .fadeOut(duration: 1.2)]), .removeFromParentNode()]))
    }

    // ── Private ───────────────────────────────────────────────────────────

    private func makeNode(for e: PresenceEntry) -> SCNNode {
        let color = PresencePalette.color(role: e.role, userId: e.userId)
        let n = SCNNode(); n.name = "presence-\(e.userId)"

        // Lens card (billboarded) slightly above the head position.
        let card = SCNPlane(width: 0.22, height: 0.075)
        card.cornerRadius = 0.014
        card.firstMaterial?.diffuse.contents = lensImage(for: e, color: color)
        card.firstMaterial?.lightingModel = .constant
        card.firstMaterial?.isDoubleSided = true
        let cardNode = SCNNode(geometry: card)
        cardNode.name = "card"
        cardNode.position = SCNVector3(0, 0.12, 0)
        cardNode.constraints = [SCNBillboardConstraint()]
        n.addChildNode(cardNode)

        // Head: small tinted sphere so the card has an anchor point.
        let head = SCNNode(geometry: SCNSphere(radius: 0.035))
        head.geometry?.firstMaterial?.diffuse.contents = color
        head.geometry?.firstMaterial?.emission.contents = color.withAlphaComponent(0.5)
        n.addChildNode(head)

        // View cone: apex at the head, opening along -Z (camera forward).
        let cone = SCNCone(topRadius: 0.0, bottomRadius: 0.22, height: 0.6)
        cone.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.16)
        cone.firstMaterial?.emission.contents = color.withAlphaComponent(0.10)
        cone.firstMaterial?.lightingModel = .constant
        cone.firstMaterial?.isDoubleSided = true
        cone.firstMaterial?.writesToDepthBuffer = false
        let coneNode = SCNNode(geometry: cone)
        coneNode.name = "cone"
        // SCNCone's axis is +Y with the apex at +h/2. Rotate so the apex sits
        // at the origin and the base points down -Z.
        coneNode.position = SCNVector3(0, 0, -0.3)
        coneNode.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
        n.addChildNode(coneNode)

        // Gaze dot (world-positioned by updateGaze; child of root, not n).
        let dot = SCNNode(geometry: SCNSphere(radius: 0.018))
        dot.geometry?.firstMaterial?.diffuse.contents = color
        dot.geometry?.firstMaterial?.emission.contents = color
        dot.geometry?.firstMaterial?.lightingModel = .constant
        dot.name = "gaze-\(e.userId)"
        dot.opacity = 0.85
        dot.runAction(.repeatForever(.sequence([.scale(to: 1.5, duration: 0.7), .scale(to: 1.0, duration: 0.7)])))
        root.addChildNode(dot)

        root.addChildNode(n)
        return n
    }

    private func updateGaze(node: SCNNode, pose: simd_float4x4) {
        guard let dot = root.childNode(withName: "gaze-\(node.name?.dropFirst("presence-".count) ?? "")", recursively: false) else { return }
        let origin  = simd_float3(pose.columns.3.x, pose.columns.3.y, pose.columns.3.z)
        let forward = -simd_normalize(simd_float3(pose.columns.2.x, pose.columns.2.y, pose.columns.2.z))
        var hit = origin + forward * 1.2
        let q = ARRaycastQuery(origin: origin, direction: forward, allowing: .estimatedPlane, alignment: .any)
        if let r = sceneView.session.raycast(q).first {
            hit = simd_float3(r.worldTransform.columns.3.x, r.worldTransform.columns.3.y, r.worldTransform.columns.3.z)
        }
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.4
        dot.simdPosition = hit
        SCNTransaction.commit()
    }

    private func lensImage(for e: PresenceEntry, color: UIColor) -> UIImage {
        let key = "\(e.userId)|\(e.name)|\(e.site ?? "")"
        if let img = labelCache[key] { return img }
        let size = CGSize(width: 440, height: 150)
        let img = UIGraphicsImageRenderer(size: size).image { ctx in
            let bg = UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 28)
            UIColor.black.withAlphaComponent(0.72).setFill(); bg.fill()
            // initials disc
            let disc = CGRect(x: 18, y: 19, width: 112, height: 112)
            color.setFill(); UIBezierPath(ovalIn: disc).fill()
            let para = NSMutableParagraphStyle(); para.alignment = .center
            let initials = NSAttributedString(string: e.initials, attributes: [
                .font: UIFont.systemFont(ofSize: 48, weight: .bold), .foregroundColor: UIColor.white, .paragraphStyle: para])
            initials.draw(in: CGRect(x: 18, y: 19 + 26, width: 112, height: 60))
            // name + site
            let name = NSAttributedString(string: e.name, attributes: [
                .font: UIFont.systemFont(ofSize: 40, weight: .semibold), .foregroundColor: UIColor.white])
            name.draw(in: CGRect(x: 148, y: 28, width: 280, height: 50))
            let sub = e.site.map { "\($0)" } ?? (e.role ?? "")
            let site = NSAttributedString(string: sub, attributes: [
                .font: UIFont.systemFont(ofSize: 30, weight: .regular), .foregroundColor: UIColor.white.withAlphaComponent(0.75)])
            site.draw(in: CGRect(x: 148, y: 80, width: 280, height: 40))
            _ = ctx
        }
        labelCache[key] = img
        return img
    }

    private func renderLabel(text: String, color: UIColor, width: CGFloat, height: CGFloat) -> UIImage {
        let size = CGSize(width: width * 2, height: height * 2)
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2).addClip()
            color.withAlphaComponent(0.9).setFill(); UIRectFill(CGRect(origin: .zero, size: size))
            let para = NSMutableParagraphStyle(); para.alignment = .center
            NSAttributedString(string: text, attributes: [
                .font: UIFont.systemFont(ofSize: 30, weight: .semibold), .foregroundColor: UIColor.white, .paragraphStyle: para])
                .draw(in: CGRect(x: 0, y: (size.height - 36) / 2, width: size.width, height: 40))
        }
    }
}

// ── SwiftUI pieces ───────────────────────────────────────────────────────────

/// "2 here · Priya (Singapore)" — tap for the list.
struct PresenceRosterChip: View {
    let others: [PresenceEntry]
    let connected: Bool
    /// C2: shown as a "Coach" button on entries that carry a live session id.
    var onCoach: ((PresenceEntry) -> Void)? = nil
    @State private var expanded = false

    var body: some View {
        if others.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .trailing, spacing: 6) {
                Button { withAnimation(.spring(response: 0.3)) { expanded.toggle() } } label: {
                    HStack(spacing: 6) {
                        HStack(spacing: -6) {
                            ForEach(others.prefix(3)) { o in
                                Text(o.initials).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                                    .frame(width: 20, height: 20)
                                    .background(Color(PresencePalette.color(role: o.role, userId: o.userId)), in: Circle())
                                    .overlay(Circle().stroke(.black.opacity(0.5), lineWidth: 1))
                            }
                        }
                        Text(others.count == 1
                             ? "\(others[0].name)\(others[0].site.map { " (\($0))" } ?? "") is here"
                             : "\(others.count + 1) here")
                            .font(.caption.bold()).foregroundStyle(.white).lineLimit(1)
                        Circle().fill(connected ? Color.green : Color.orange).frame(width: 6, height: 6)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.black.opacity(0.45), in: Capsule())
                }
                .buttonStyle(.plain)
                if expanded {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(others) { o in
                            HStack(spacing: 8) {
                                Circle().fill(Color(PresencePalette.color(role: o.role, userId: o.userId))).frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(o.name).font(.caption.bold()).foregroundStyle(.white)
                                    Text([o.site, o.role, o.surface == "guide" ? "running the guide" : (o.focusId.map { _ in "editing a step" })]
                                            .compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption2).foregroundStyle(.white.opacity(0.65))
                                }
                                if let onCoach, o.sessionId != nil {
                                    Spacer(minLength: 8)
                                    Button { onCoach(o); expanded = false } label: {
                                        Label("Coach", systemImage: "person.wave.2.fill")
                                            .font(.caption2.bold()).foregroundStyle(.white)
                                            .padding(.horizontal, 8).padding(.vertical, 4)
                                            .background(Color.cyan.opacity(0.85), in: Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }
}

/// Edge arrows for colleagues outside the viewport, sampled at 10 Hz.
struct PresenceEdgeArrows: View {
    let others: [PresenceEntry]
    let sceneView: ARSCNView
    private let ticker = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    private struct Mark: Identifiable { let id: String; let name: String; let color: UIColor; let point: CGPoint; let angle: Double }
    @State private var marks: [Mark] = []

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(marks) { m in
                    VStack(spacing: 2) {
                        Image(systemName: "arrowtriangle.up.fill")
                            .font(.system(size: 14)).rotationEffect(.radians(m.angle))
                        Text(m.name).font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(Color(m.color))
                    .padding(6).background(Color.black.opacity(0.45), in: Capsule())
                    .position(m.point)
                }
            }
            .onReceive(ticker) { _ in marks = compute(in: geo.size) }
        }
        .allowsHitTesting(false)
    }

    private func compute(in size: CGSize) -> [Mark] {
        guard size.width > 0 else { return [] }
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        let inset: CGFloat = 44
        var out: [Mark] = []
        for o in others {
            guard let t = o.transform else { continue }
            let p = sceneView.projectPoint(SCNVector3(t.columns.3.x, t.columns.3.y, t.columns.3.z))
            var sp = CGPoint(x: CGFloat(p.x), y: CGFloat(p.y))
            let behind = p.z > 1
            if behind { sp = CGPoint(x: 2 * centre.x - sp.x, y: 2 * centre.y - sp.y) }
            let onScreen = !behind && sp.x >= 0 && sp.x <= size.width && sp.y >= 60 && sp.y <= size.height - 160
            if onScreen { continue }
            let dx = sp.x - centre.x, dy = sp.y - centre.y
            let angle = atan2(dy, dx)
            // Clamp to the inset rectangle along the direction from the centre.
            let hw = centre.x - inset, hh = centre.y - inset - 60
            let s = min(hw / max(abs(dx), 0.001), hh / max(abs(dy), 0.001))
            let pt = CGPoint(x: centre.x + dx * s, y: centre.y + dy * s)
            out.append(Mark(id: o.userId, name: o.name, color: PresencePalette.color(role: o.role, userId: o.userId),
                            point: pt, angle: Double(angle) + .pi / 2))
        }
        return out
    }
}

struct PresenceToast: View {
    let text: String
    let color: UIColor
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "person.2.fill").font(.caption.bold())
            Text(text).font(.caption.bold())
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Color(color).opacity(0.94), in: Capsule())
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// C2: the author's coaching panel — a message, quick phrases, and
/// "Point here" (the next tap in AR sends a look-here marker).
struct CoachPanel: View {
    let target: PresenceEntry
    let stepTitle: String?
    @Binding var pointerMode: Bool
    let onSend: (String) -> Void
    let onClose: () -> Void
    @State private var text = ""
    @FocusState private var focused: Bool
    private let quick = ["Wait for me", "Check the torque", "Photo before you proceed", "Good — carry on"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "person.wave.2.fill").foregroundStyle(.cyan)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Coaching \(target.name)").font(.subheadline.bold()).foregroundStyle(.white)
                    if let t = stepTitle { Text("On: \(t)").font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1) }
                }
                Spacer()
                Button(action: onClose) { Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.white.opacity(0.6)) }
                    .buttonStyle(.plain)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Button { pointerMode.toggle() } label: {
                        Label(pointerMode ? "Tap the spot…" : "Point here", systemImage: "scope")
                            .font(.caption.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(pointerMode ? Color.orange : Color.cyan.opacity(0.85), in: Capsule())
                    }
                    ForEach(quick, id: \.self) { q in
                        Button { onSend(q) } label: {
                            Text(q).font(.caption.bold()).foregroundStyle(.white)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(Color.white.opacity(0.14), in: Capsule())
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                TextField("Message…", text: $text)
                    .focused($focused)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
                    .submitLabel(.send)
                    .onSubmit { send() }
                Button(action: send) {
                    Image(systemName: "paperplane.fill").font(.subheadline.bold()).foregroundStyle(.white)
                        .padding(10).background(text.trimmingCharacters(in: .whitespaces).isEmpty ? Color.gray.opacity(0.5) : Color.cyan, in: Circle())
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if pointerMode {
                Text("Tap a spot on the chamber — \(target.name) sees a pulsing marker there with your name.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        onSend(t); text = ""
    }
}
