// ContentView.swift — Phase 2C root router
import SwiftUI

struct ContentView: View {

    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            switch appState.mode {
            case .none:
                ModeSelectionView()
            case .author:
                AuthorModeView()
            case .operator:
                OperatorModeView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: appState.mode == .none)
    }
}
