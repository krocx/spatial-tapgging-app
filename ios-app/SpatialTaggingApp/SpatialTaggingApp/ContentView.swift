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
                AuthorModeView(groupId: appState.activeGroupId)
            case .operator:
                OperatorModeView()
            // Phase 2: Gemba audit walk modes (views implemented in Tasks E/F)
            case .locTagAuthor:
                LocTagAuthorView()
            case .locTagOperator:
                LocTagOperatorView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: appState.mode == .none)
    }
}
