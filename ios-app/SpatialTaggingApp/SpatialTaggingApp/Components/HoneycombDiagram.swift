// HoneycombDiagram.swift — G11
// A 2D spatial map of the 7 honeycomb capture positions.
//
// Used in two contexts:
//  • Ready screen  (size ≈ 240, showLabels: true)  — static briefing diagram
//  • Top bar       (size ≈ 62,  showLabels: false)  — live progress mini-map
//
// Layout (matches HoneycombARGuide world positions):
//
//       1 (Above)
//   6         2
//     (0) Front
//   5         3
//       4 (Below)
//
// Slot 0 is the center "straight-on" position.
// Slots 1–6 form a hexagonal ring.

import SwiftUI

struct HoneycombDiagram: View {

    let capturedCount: Int   // how many slots are done (green)
    let currentSlot:   Int   // which slot is active (cyan); pass -1 to grey all
    let size:          CGFloat
    let showLabels:    Bool

    // ── Normalised (x, y) positions in [-1, +1] space ─────────────────────────
    // Matches the angular offsets in HoneycombARGuide (viewed as a front-face diagram).
    // Y axis: +1 = up, -1 = down   (flipped from screen coords so "above" appears at top)
    private static let positions: [(x: CGFloat, y: CGFloat)] = [
        ( 0.000,  0.000),   // 0: Straight On  — center
        ( 0.000, -1.000),   // 1: From Above   — top
        ( 0.866, -0.500),   // 2: Upper Right
        ( 0.866,  0.500),   // 3: Lower Right
        ( 0.000,  1.000),   // 4: From Below   — bottom
        (-0.866,  0.500),   // 5: Lower Left
        (-0.866, -0.500),   // 6: Upper Left
    ]

    private static let shortLabels: [String] = [
        "Front", "Above", "Up-R", "Lo-R", "Below", "Lo-L", "Up-L",
    ]

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack {
            Canvas { ctx, canvasSize in
                let cx     = canvasSize.width  / 2
                let cy     = canvasSize.height / 2
                let ringR  = min(canvasSize.width, canvasSize.height) * 0.36

                // ── Spoke lines (center → each outer node) ────────────────────
                for (i, pos) in Self.positions.enumerated() {
                    guard i > 0 else { continue }
                    let dst = CGPoint(x: cx + pos.x * ringR, y: cy + pos.y * ringR)
                    var path = Path()
                    path.move(to: CGPoint(x: cx, y: cy))
                    path.addLine(to: dst)
                    ctx.stroke(path, with: .color(.white.opacity(0.18)), lineWidth: 1)
                }

                // ── Outer ring connector (1-2-3-4-5-6-1) ─────────────────────
                var ring = Path()
                for (i, pos) in Self.positions.dropFirst().enumerated() {
                    let pt = CGPoint(x: cx + pos.x * ringR, y: cy + pos.y * ringR)
                    if i == 0 { ring.move(to: pt) } else { ring.addLine(to: pt) }
                }
                ring.closeSubpath()
                ctx.stroke(ring, with: .color(.white.opacity(0.10)), lineWidth: 1)

                // ── Slot dots ─────────────────────────────────────────────────
                let baseDot: CGFloat = size > 100 ? 13 : 7.5
                for (i, pos) in Self.positions.enumerated() {
                    let pt   = CGPoint(x: cx + pos.x * ringR, y: cy + pos.y * ringR)
                    let isActive    = (i == currentSlot)
                    let isCaptured  = (i < capturedCount)
                    let dotR: CGFloat = isActive ? baseDot * 1.30 : baseDot

                    // Glow ring for active slot
                    if isActive {
                        let glowR = dotR + 4
                        let glowRect = CGRect(x: pt.x - glowR, y: pt.y - glowR,
                                              width: glowR * 2, height: glowR * 2)
                        ctx.fill(Path(ellipseIn: glowRect),
                                 with: .color(Color.cyan.opacity(0.25)))
                    }

                    // Main dot
                    let rect = CGRect(x: pt.x - dotR, y: pt.y - dotR,
                                      width: dotR * 2, height: dotR * 2)
                    ctx.fill(Path(ellipseIn: rect), with: .color(dotColor(i)))

                    // Slot number
                    let numPt = CGPoint(x: pt.x, y: pt.y + 0.5)
                    ctx.draw(
                        Text("\(i + 1)")
                            .font(.system(size: size > 100 ? 10 : 6.5, weight: .bold))
                            .foregroundColor(isCaptured || isActive ? .white : .white.opacity(0.55)),
                        at: numPt
                    )
                }
            }

            // ── Labels overlay (large / ready-screen variant only) ─────────────
            if showLabels {
                GeometryReader { geo in
                    let cx    = geo.size.width  / 2
                    let cy    = geo.size.height / 2
                    let ringR = min(geo.size.width, geo.size.height) * 0.36

                    ForEach(0..<7, id: \.self) { i in
                        let pos    = Self.positions[i]
                        let dotPt  = CGPoint(x: cx + pos.x * ringR, y: cy + pos.y * ringR)
                        let offset = labelOffset(index: i)

                        Text(Self.shortLabels[i])
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(dotColor(i).opacity(0.90))
                            .fixedSize()
                            .position(x: dotPt.x + offset.x, y: dotPt.y + offset.y)
                    }
                }
            }
        }
        .frame(width: size, height: size)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func dotColor(_ slot: Int) -> Color {
        if slot < capturedCount  { return .green }
        if slot == currentSlot   { return .cyan  }
        return .white.opacity(0.28)
    }

    /// Offset direction for a slot label — outward from center, with special
    /// cases to keep labels from overlapping dots or each other.
    private func labelOffset(index: Int) -> CGPoint {
        let pos = Self.positions[index]
        let mag = sqrt(pos.x * pos.x + pos.y * pos.y)
        guard mag > 0.001 else {
            return CGPoint(x: 22, y: 0) // center slot — push label right
        }
        let dist: CGFloat = 24
        return CGPoint(x: pos.x / mag * dist, y: pos.y / mag * dist)
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

#Preview("Large — ready screen (3 captured)") {
    ZStack {
        Color.black.ignoresSafeArea()
        HoneycombDiagram(capturedCount: 3, currentSlot: 3, size: 260, showLabels: true)
    }
}

#Preview("Small — top bar (1 captured)") {
    ZStack {
        Color.black.ignoresSafeArea()
        HoneycombDiagram(capturedCount: 1, currentSlot: 1, size: 62, showLabels: false)
    }
}
