// CrosshairView.swift — Phase 3
//
// Apple Measure App-style crosshair reticle.
// Positioned at screen centre; animates between two states:
//
//   "Searching" (locked = false):
//     — Small white dot + faint outer ring.  Indicates ARKit is scanning.
//
//   "Locked" (locked = true):
//     — Larger cyan dot + crisp outer ring + four corner brackets.
//       Indicates a surface has been raycasted at the centre and tapping
//       will place a tag at that point.
//
// Usage:
//   CrosshairView(locked: crosshairLocked)
//       .allowsHitTesting(false)   ← keep below interactive views

import SwiftUI

struct CrosshairView: View {

    let locked: Bool

    // Pulsing animation for the "searching" ring
    @State private var pulsing = false

    var body: some View {
        ZStack {
            // ── Outer ring ────────────────────────────────────────────────────
            Circle()
                .stroke(
                    locked ? Color.cyan : Color.white.opacity(0.55),
                    lineWidth: locked ? 1.8 : 1.2
                )
                .frame(width: locked ? 44 : 38, height: locked ? 44 : 38)
                .scaleEffect(pulsing && !locked ? 1.12 : 1.0)
                .opacity(pulsing && !locked ? 0.55 : 1.0)

            // ── Corner brackets (locked only) ─────────────────────────────────
            if locked {
                cornerBrackets
            }

            // ── Centre dot ────────────────────────────────────────────────────
            Circle()
                .fill(locked ? Color.cyan : Color.white.opacity(0.85))
                .frame(width: locked ? 7 : 5, height: locked ? 7 : 5)
                .shadow(color: locked ? .cyan.opacity(0.7) : .clear, radius: 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.22), value: locked)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }

    // ── Four L-shaped corner brackets ────────────────────────────────────────
    // Drawn as two short lines at each corner of a 44×44 pt square.

    private var cornerBrackets: some View {
        let size:  CGFloat = 44
        let arm:   CGFloat = 10     // bracket arm length
        let thick: CGFloat = 2.0

        return ZStack {
            // Top-left
            bracket(x: -size/2, y: -size/2, flipX: false, flipY: false, arm: arm, thick: thick)
            // Top-right
            bracket(x:  size/2, y: -size/2, flipX: true,  flipY: false, arm: arm, thick: thick)
            // Bottom-left
            bracket(x: -size/2, y:  size/2, flipX: false, flipY: true,  arm: arm, thick: thick)
            // Bottom-right
            bracket(x:  size/2, y:  size/2, flipX: true,  flipY: true,  arm: arm, thick: thick)
        }
        .foregroundStyle(Color.cyan)
    }

    private func bracket(x: CGFloat, y: CGFloat,
                         flipX: Bool, flipY: Bool,
                         arm: CGFloat, thick: CGFloat) -> some View {
        let hSign: CGFloat = flipX ? -1 : 1
        let vSign: CGFloat = flipY ? -1 : 1
        return ZStack {
            // Horizontal arm
            Rectangle()
                .frame(width: arm, height: thick)
                .offset(x: x + hSign * arm / 2, y: y)
            // Vertical arm
            Rectangle()
                .frame(width: thick, height: arm)
                .offset(x: x, y: y + vSign * arm / 2)
        }
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        VStack(spacing: 40) {
            CrosshairView(locked: false)
                .frame(width: 100, height: 100)
            CrosshairView(locked: true)
                .frame(width: 100, height: 100)
        }
    }
}
