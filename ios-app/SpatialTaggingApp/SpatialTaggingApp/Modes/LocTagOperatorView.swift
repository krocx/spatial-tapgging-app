// LocTagOperatorView.swift — Phase 2 (Task F)
// AR session for the Gemba audit walk Operator flow:
//   • Download ARWorldMap from SIB → load into ARSession
//   • Wait for re-localization (.limited(.relocalizing) → .normal)
//   • Navigate Operator to each Loc-Tag in author-defined order:
//       - 3D billboard arrow pointing at next tag
//       - Screen-edge chevrons for off-screen tags
//       - Approaching threshold: 1.0 m  /  Arrived threshold: 0.5 m
//   • Present LocTagOperatorSheet on arrival → photo + Resolved / Still Present / Escalated
//
// TODO: implement in Task F.

import SwiftUI

struct LocTagOperatorView: View {

    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var settings:  AppSettings

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "figure.walk.motion")
                    .font(.system(size: 64))
                    .foregroundStyle(.cyan)
                Text("Gemba Walk — Operator")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Text("Implementation coming in Task F")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.6))
                Button("Exit") { appState.mode = .none; appState.reset() }
                    .buttonStyle(.bordered)
                    .tint(.white)
            }
        }
    }
}
