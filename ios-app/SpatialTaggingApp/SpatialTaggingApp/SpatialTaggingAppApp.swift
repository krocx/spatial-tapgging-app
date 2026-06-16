// SpatialTaggingApp — Phase 2A entry point
import SwiftUI

@main
struct SpatialTaggingAppApp: App {

    @StateObject private var appSettings = AppSettings()
    @StateObject private var appState    = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appSettings)
                .environmentObject(appState)
        }
    }
}
