// ResumeCheckpointOverlay.swift — R2 (2026.4.46): the "welcome back" gate a
// Gemba walk shows after the app was in the background (or any ARKit
// interruption). Nothing is trusted until the auditor has confirmed the
// world once.
//
//   .relocalizing  — blurred AR, the last known finding's own photo as the
//                    landmark: "Stand where you saw #4 and point the phone at
//                    it." ARKit relocalizes into the previous map meanwhile.
//   .confirm       — tracking is back: one question over the pin —
//                    "Is #4 where the pin shows?"  Yes / No, re-align.
//   timeout        — ~15 s without relocalizing → caller runs the full
//                    world-map re-localization (reference photo + I'm Here).
//
// Copy is deliberately calm and one-question-at-a-time (design philosophy:
// guided, never "tracking lost"). Orange = Gemba identity.

import SwiftUI

enum ResumeCheckpointState: Equatable {
    case relocalizing(since: Date)
    case confirm
}

struct ResumeCheckpointOverlay: View {
    let state: ResumeCheckpointState
    /// Stop number (1-based) + title of the landmark finding.
    let stopNumber: Int?
    let title: String
    /// The landmark photo (the finding's own photo, or the walk's reference photo).
    let photo: UIImage?
    let timeoutSeconds: TimeInterval
    let onConfirm: () -> Void
    let onRealign: () -> Void
    let onTimeout: () -> Void

    @State private var elapsed: TimeInterval = 0
    private let tick = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    private var stopLabel: String { stopNumber.map { "#\($0)" } ?? "the last finding" }

    var body: some View {
        ZStack {
            // Only the relocalizing state hides the AR view — during confirm the
            // auditor must SEE the pin to judge it.
            if case .relocalizing = state {
                Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            }
            VStack {
                Spacer()
                VStack(spacing: 14) {
                    switch state {
                    case .relocalizing:
                        Text("Welcome back")
                            .font(.title3.bold()).foregroundStyle(.white)
                        Text("Stand where you saw \(stopLabel) and point the phone at it — we're finding your place.")
                            .font(.subheadline).foregroundStyle(.white.opacity(0.8))
                            .multilineTextAlignment(.center)
                        if let photo {
                            Image(uiImage: photo)
                                .resizable().scaledToFill()
                                .frame(width: 220, height: 160)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.orange, lineWidth: 2))
                        }
                        Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.9)).lineLimit(2)
                        HStack(spacing: 8) {
                            ProgressView().tint(.orange)
                            Text(elapsed < 6 ? "Looking…" : "Slowly pan across what you saw before")
                                .font(.caption).foregroundStyle(.white.opacity(0.65))
                        }
                        Button("Re-align from the start") { onRealign() }
                            .font(.caption).foregroundStyle(.orange)
                            .padding(.top, 2)
                    case .confirm:
                        Text("Is \(stopLabel) where the pin shows?")
                            .font(.headline).foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                        Text(title).font(.footnote).foregroundStyle(.white.opacity(0.75)).lineLimit(2)
                        HStack(spacing: 12) {
                            Button {
                                onRealign()
                            } label: {
                                Label("No, re-align", systemImage: "arrow.triangle.2.circlepath")
                                    .font(.subheadline.weight(.semibold))
                                    .padding(.vertical, 11).padding(.horizontal, 16)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                            Button {
                                onConfirm()
                            } label: {
                                Label("Yes, continue", systemImage: "checkmark")
                                    .font(.subheadline.weight(.bold))
                                    .padding(.vertical, 11).padding(.horizontal, 18)
                                    .background(.orange, in: Capsule())
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 360)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.orange.opacity(0.45), lineWidth: 1))
                .padding(.bottom, 120)
            }
        }
        .transition(.opacity)
        .onReceive(tick) { _ in
            guard case .relocalizing(let since) = state else { return }
            elapsed = Date().timeIntervalSince(since)
            if elapsed >= timeoutSeconds { onTimeout() }
        }
    }
}
