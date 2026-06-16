// HoneycombHUD.swift — Phase 2B
// Draws a 7-cell honeycomb overlay showing viewpoint capture progress.
//
// Cell layout (pointy-top hexagons, indices):
//
//     [6]  [1]
//   [5]  [0]  [2]
//     [4]  [3]
//
// Index 0 = straight-on (center), 1..6 = ring at 90°, 30°, -30°, -90°, -150°, 150°

import SwiftUI

struct HoneycombHUD: View {

    /// Number of viewpoints already captured (slots 0..<capturedCount are done).
    let capturedCount: Int
    /// The slot the user should capture next (0-6).
    let currentIndex: Int

    // Geometry
    private let hexR:    CGFloat = 28          // hex circumradius
    private var d:       CGFloat { hexR * sqrt(3) }  // center-to-center ≈ 48.5 pt
    private let cx:      CGFloat = 100
    private let cy:      CGFloat = 100

    // Ring angles in math convention (CCW from +x); y is negated for screen coords
    private let ringAngles: [Double] = [90, 30, -30, -90, -150, 150]

    var body: some View {
        ZStack {
            // ── Hex backgrounds (Canvas) ──────────────────────────────────────
            Canvas { ctx, _ in
                for (i, center) in cellCenters.enumerated() {
                    drawHexBackground(in: ctx, center: center, index: i)
                }
            }
            // ── Icons (SwiftUI Image — supports colour / animation) ────────────
            ForEach(0..<7, id: \.self) { i in
                Image(systemName: symbol(for: i))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(iconColor(for: i))
                    .position(cellCenters[i])
                    .animation(.easeInOut(duration: 0.25), value: capturedCount)
            }
        }
        .frame(width: 200, height: 200)
    }

    // ── Cell geometry ─────────────────────────────────────────────────────────

    private var cellCenters: [CGPoint] {
        var pts = [CGPoint(x: cx, y: cy)]  // [0] centre
        for angleDeg in ringAngles {
            let a = angleDeg * .pi / 180
            pts.append(CGPoint(
                x: cx + d * CGFloat(cos(a)),
                y: cy - d * CGFloat(sin(a))   // y-down screen coords
            ))
        }
        return pts
    }

    private func hexPath(center: CGPoint) -> Path {
        Path { path in
            for j in 0..<6 {
                // Pointy-top hex: first corner at top (90°), then every 60° CW
                let angleDeg = 90.0 - 60.0 * Double(j)
                let a = angleDeg * .pi / 180.0
                let x = center.x + hexR * CGFloat(cos(a))
                let y = center.y - hexR * CGFloat(sin(a))
                if j == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else       { path.addLine(to: CGPoint(x: x, y: y)) }
            }
            path.closeSubpath()
        }
    }

    // ── Drawing helpers ───────────────────────────────────────────────────────

    private func drawHexBackground(in ctx: GraphicsContext, center: CGPoint, index: Int) {
        let path = hexPath(center: center)
        let captured = index < capturedCount
        let active   = isActive(index)

        // Fill
        if captured {
            ctx.fill(path, with: .color(.green.opacity(0.28)))
        } else if active {
            ctx.fill(path, with: .color(.blue.opacity(0.22)))
        } else {
            ctx.fill(path, with: .color(.white.opacity(0.07)))
        }

        // Stroke
        let strokeColor: Color = captured ? .green : (active ? .blue : .white.opacity(0.32))
        ctx.stroke(path, with: .color(strokeColor), lineWidth: active ? 2.5 : 1.5)
    }

    /// A cell is "active" (about to be captured) when it's the currentIndex
    /// AND hasn't been captured yet.
    private func isActive(_ index: Int) -> Bool {
        index == currentIndex && capturedCount == currentIndex
    }

    private func symbol(for index: Int) -> String {
        if index < capturedCount { return "checkmark" }
        if isActive(index)       { return "camera.fill" }
        return "circle.dotted"
    }

    private func iconColor(for index: Int) -> Color {
        if index < capturedCount { return .green }
        if isActive(index)       { return .white }
        return .white.opacity(0.25)
    }
}

#Preview {
    ZStack {
        Color.black
        VStack(spacing: 24) {
            HoneycombHUD(capturedCount: 0, currentIndex: 0)
            HoneycombHUD(capturedCount: 3, currentIndex: 3)
            HoneycombHUD(capturedCount: 7, currentIndex: 6)
        }
    }
}
