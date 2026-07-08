// LocTagAuthorView.swift — Phase 2 (Task E)
// AR session for the Gemba audit walk Author flow:
//   • Tap any surface to place a Loc-Tag (ARKit hit-test)
//   • Fill LocTagFormSheet (title, description, defect category, reference photo)
//   • Preview placed tags as 3D pins
//   • Save ARWorldMap when walk is complete → upload to SIB /worldmap/upload
//
// TODO: implement in Task E.

import SwiftUI

struct LocTagAuthorView: View {

    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var settings:  AppSettings

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "figure.walk.circle")
                    .font(.system(size: 64))
                    .foregroundStyle(.yellow)
                Text("Gemba Walk — Author")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Text("Implementation coming in Task E")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.6))
                Button("Exit") { appState.mode = .none; appState.reset() }
                    .buttonStyle(.bordered)
                    .tint(.white)
            }
        }
    }
}
