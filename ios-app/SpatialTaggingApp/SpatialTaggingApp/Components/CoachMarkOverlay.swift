// CoachMarkOverlay.swift
// Renders the guided-tour coach mark for a single TourStep.
//
// Three display modes chosen automatically:
//   Welcome / Done   — full-screen dim + centred card (personalised greeting)
//   Spotlight        — full-screen dim + Canvas cutout + floating coach bubble
//   Banner           — bottom card with no dim (safe to use over AR views)
//
// Usage (in each participating view):
//   .overlay {
//       if tour.isActive && tour.currentStep.screen == .home {
//           CoachMarkOverlay(
//               step:        tour.currentStep,
//               targetRect:  tourFrames[tour.currentStep],
//               ownerName:   tour.ownerName,
//               onNext:      { tour.advance() },
//               onSkip:      { tour.skip() }
//           )
//           .ignoresSafeArea()
//       }
//   }

import SwiftUI

struct CoachMarkOverlay: View {

    let step:       TourStep
    /// Screen-space CGRect of the element to spotlight; nil → banner / card mode.
    let targetRect: CGRect?
    let ownerName:  String
    let onNext:     () -> Void
    let onSkip:     () -> Void

    var body: some View {
        switch step {
        case .welcome, .done:
            fullScreenCard
        default:
            if step.usesSpotlight, let rect = targetRect {
                spotlightView(rect)
            } else {
                bannerCard
            }
        }
    }

    // ── Full-screen welcome / done card ────────────────────────────────────────

    private var fullScreenCard: some View {
        ZStack {
            Color.black.opacity(0.96)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                // Accent icon circle
                ZStack {
                    Circle()
                        .fill(Color.cyan.opacity(0.12))
                        .frame(width: 104, height: 104)
                    Circle()
                        .strokeBorder(Color.cyan.opacity(0.28), lineWidth: 1.5)
                        .frame(width: 104, height: 104)
                    Image(systemName: step.sfIcon)
                        .font(.system(size: 46, weight: .semibold))
                        .foregroundStyle(.cyan)
                }

                if step == .welcome {
                    Text("Hello, \(ownerName)! 👋")
                        .font(.largeTitle.bold())
                        .foregroundColor(.white)
                    Text("Welcome to Spatial Tagging App")
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.cyan)
                    Text("As this is your first time using the app,\nI'll guide you through the basics step by step.")
                        .font(.body)
                        .foregroundColor(.white.opacity(0.58))
                        .multilineTextAlignment(.center)
                        .lineSpacing(5)
                } else {
                    Text(step.headline)
                        .font(.largeTitle.bold())
                        .foregroundColor(.white)
                    Text(step.body)
                        .font(.body)
                        .foregroundColor(.white.opacity(0.58))
                        .multilineTextAlignment(.center)
                        .lineSpacing(5)
                }

                Spacer()

                VStack(spacing: 14) {
                    Button(action: onNext) {
                        Text(step == .welcome ? "Let's Begin →" : "Start Using the App")
                            .font(.headline)
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color.cyan)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    if step == .welcome {
                        Button("Skip tour") { onSkip() }
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.32))
                    }
                }
                .padding(.bottom, 12)
            }
            .padding(.horizontal, 40)
        }
    }

    // ── Spotlight view ─────────────────────────────────────────────────────────
    //
    // `rect` arrives in GLOBAL (screen) coordinates from the preference-key capture.
    // The GeometryReader + ignoresSafeArea combination may shift its local origin
    // relative to screen (0,0) by the sheet top-inset / safe-area amount.
    // We compensate by reading geo.frame(in: .global).origin and subtracting it
    // from `rect` so that `hole` is always in the GeometryReader's local space,
    // which is the same space used by Canvas drawing and .position() modifiers.

    private func spotlightView(_ rect: CGRect) -> some View {
        let pad:     CGFloat = 10
        let radius:  CGFloat = 14
        let bubbleW: CGFloat = 310
        let bubbleH: CGFloat = 160   // estimated; actual height varies

        return GeometryReader { geo in
            // Convert targetRect from screen coordinates to GeometryReader-local
            // coordinates. geo.frame(in: .global).origin is the screen position
            // of the GeometryReader's (0,0), accounting for ignoresSafeArea expansion.
            let origin   = geo.frame(in: .global).origin
            let localRect = CGRect(x: rect.minX - origin.x,
                                   y: rect.minY - origin.y,
                                   width: rect.width,
                                   height: rect.height)
            let hole = localRect.insetBy(dx: -pad, dy: -pad)

            ZStack {
                // ── Dim layer with spotlight hole ──────────────────────────────
                Canvas { ctx, size in
                    // Flood fill with dim colour
                    ctx.fill(
                        Path(CGRect(x: 0, y: 0, width: size.width, height: size.height)),
                        with: .color(Color.black.opacity(0.72))
                    )
                    // Cut out the spotlight hole
                    var clear = ctx
                    clear.blendMode = .clear
                    clear.fill(Path(roundedRect: hole, cornerRadius: radius), with: .color(.black))
                }
                .compositingGroup()
                .ignoresSafeArea()

                // ── Pulsing border ─────────────────────────────────────────────
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(Color.cyan.opacity(0.85), lineWidth: 2)
                    .frame(width: hole.width, height: hole.height)
                    .position(x: hole.midX, y: hole.midY)
                    .shadow(color: .cyan.opacity(0.55), radius: 8)

                // ── Position coach bubble above or below spotlight ─────────────
                let spacing: CGFloat = 20
                let fitsBelow = hole.maxY + spacing + bubbleH < geo.size.height - 90
                let bubbleMidY = fitsBelow
                    ? hole.maxY + spacing + bubbleH / 2
                    : hole.minY - spacing - bubbleH / 2

                // Connector line
                Path { p in
                    let fromY = fitsBelow ? hole.maxY + 4 : hole.minY - 4
                    let toY   = fitsBelow ? hole.maxY + spacing : hole.minY - spacing
                    p.move(to:    CGPoint(x: hole.midX, y: fromY))
                    p.addLine(to: CGPoint(x: geo.size.width / 2, y: toY))
                }
                .stroke(Color.cyan.opacity(0.35), lineWidth: 1.5)

                // Coach bubble
                coachBubble
                    .frame(width: bubbleW)
                    .position(x: geo.size.width / 2, y: bubbleMidY)

                // Skip link — always at bottom
                Button("Skip tour") { onSkip() }
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.38))
                    .position(x: geo.size.width / 2, y: geo.size.height - 52)
            }
        }
        .ignoresSafeArea()
    }

    // Coach bubble shared by spotlight mode
    private var coachBubble: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: step.sfIcon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.cyan)
                Text(step.headline)
                    .font(.headline)
                    .foregroundColor(.white)
                Spacer()
            }

            Text(step.body)
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.65))
                .multilineTextAlignment(.leading)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Spacer()
                Button(action: onNext) {
                    Text(step.nextLabel)
                        .font(.subheadline.bold())
                        .foregroundColor(.black)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .background(Color.cyan)
                        .clipShape(Capsule())
                }
            }
            .padding(.top, 2)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(Color(white: 0.09))
                .overlay(RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
                .shadow(color: .black.opacity(0.50), radius: 18)
        )
    }

    // ── Banner card (AR views — no dim) ───────────────────────────────────────

    private var bannerCard: some View {
        VStack {
            Spacer()

            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.cyan.opacity(0.18))
                        .frame(width: 50, height: 50)
                    Image(systemName: step.sfIcon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.cyan)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(step.headline)
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                    Text(step.body)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.65))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                VStack(spacing: 8) {
                    Button(action: onNext) {
                        Text(step.nextLabel)
                            .font(.caption.bold())
                            .foregroundColor(.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Color.cyan)
                            .clipShape(Capsule())
                    }
                    Button("Skip") { onSkip() }
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.35))
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 22)
                    .fill(Color(white: 0.07).opacity(0.96))
                    .overlay(RoundedRectangle(cornerRadius: 22)
                        .strokeBorder(Color.cyan.opacity(0.18), lineWidth: 1))
                    .shadow(color: .black.opacity(0.50), radius: 14)
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 50)
        }
        .ignoresSafeArea(edges: .bottom)
    }
}
