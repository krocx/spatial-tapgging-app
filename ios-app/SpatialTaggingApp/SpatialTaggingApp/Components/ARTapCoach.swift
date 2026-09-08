// ARTapCoach.swift — F1b (2026.4.46): the pulsing "tap here" hand, shared.
//
// Grew out of AuthorModeView's AuthorTapHint (Spatial Inspection FTUE).
// Now one component for every surface where the first action is "tap a
// surface": Spatial Inspection tags and AR OMS step pins. Non-blocking —
// the AR camera and surfaces stay fully interactive beneath it. Dismisses on
// the first tap (the caller flips its flag) or after `autoDismissAfter`.
//
// Memory: callers decide. Place Steps shows it at every fresh entry (it is
// the whole point of the screen); Spatial Inspection shows it once per person
// via ARMomentStore, plus always on an empty anchor.

import SwiftUI

struct ARTapCoach: View {
    var title:    String = "Tap any surface to place a tag"
    var subtitle: String = "Point at a flat surface and tap"
    var accent:   Color  = .white
    var autoDismissAfter: TimeInterval = 8
    let onDismiss: () -> Void

    @State private var pulse  = false
    @State private var ripple = false

    var body: some View {
        VStack {
            Spacer()
            Spacer()

            VStack(spacing: 14) {
                ZStack {
                    // Outer ripple ring — expands and fades
                    Circle()
                        .strokeBorder(accent.opacity(ripple ? 0 : 0.45), lineWidth: 1.5)
                        .frame(width: ripple ? 90 : 58, height: ripple ? 90 : 58)
                        .animation(.easeOut(duration: 1.0).repeatForever(autoreverses: false), value: ripple)
                    Circle()
                        .fill(accent.opacity(0.10))
                        .frame(width: 58, height: 58)
                    // Hand — gentle press pulse
                    Image(systemName: "hand.tap.fill")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(accent)
                        .scaleEffect(pulse ? 0.85 : 1.0)
                        .offset(y: pulse ? 3 : 0)
                        .animation(.easeInOut(duration: 0.65).repeatForever(autoreverses: true), value: pulse)
                }
                .frame(width: 90, height: 90)

                VStack(spacing: 4) {
                    Text(title).font(.subheadline.bold()).foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Text(subtitle).font(.caption).foregroundStyle(.white.opacity(0.60))
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
            .padding(.horizontal, 40)
            .onAppear {
                pulse  = true
                ripple = true
                DispatchQueue.main.asyncAfter(deadline: .now() + autoDismissAfter) { onDismiss() }
            }

            Spacer()
        }
        .allowsHitTesting(false)   // tap passes through to the AR layer beneath
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(subtitle)")
    }
}
