// QAModeBadge.swift — small "QA" pill shown top-right on every screen while
// QA Mode is on, so verbose logging is never left running by accident.
// Tap it to open the explanation; QA Mode itself is toggled in Settings.

import SwiftUI

struct QAModeBadge: View {
    @State private var on = AppLog.qaMode
    @State private var showInfo = false
    private let tick = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            if on {
                Button { showInfo = true } label: {
                    Label("QA", systemImage: "ladybug.fill")
                        .font(.caption2.bold())
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.orange.opacity(0.9), in: Capsule())
                        .foregroundStyle(.black)
                }
                .padding(.top, 52).padding(.trailing, 10)
                .alert("QA Mode is on", isPresented: $showInfo) {
                    Button("Turn off") { AppLog.qaMode = false; on = false }
                    Button("Keep on", role: .cancel) {}
                } message: {
                    Text("Verbose logs are being sent to SIB for device \(AppLog.deviceId). It switches off by itself after 24 h.")
                }
            }
        }
        .onReceive(tick) { _ in on = AppLog.qaMode }
        .allowsHitTesting(on)
    }
}
