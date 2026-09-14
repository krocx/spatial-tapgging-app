// GembaLiveActivity.swift — G6 (2026.4.46): drive the Gemba walk Live
// Activity (Dynamic Island + Lock Screen) from the operator navigation.
//
// Why: the operator walks with the phone at their side and only raises it
// at a finding. The Dynamic Island keeps "next: #3 · 4.2 m · 1/5" visible
// without the app on screen, and a haptic says "you're there". Honest limit:
// ARKit cannot track with the camera pointed at a pocket — while tracking is
// lost the activity shows the LAST known distance and "raise your phone";
// raising it re-localises (world map) and updates resume. This is
// "phone down between findings", not continuous tracking.
//
// Requires: NSSupportsLiveActivities = YES in Info.plist and the
// GembaWalkWidget extension target (see XCODE-SETUP.md). Without the
// extension the calls are harmless no-ops (ActivityKit reports disabled).

import Foundation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

@MainActor
final class GembaLiveActivity {

    static let shared = GembaLiveActivity()
    private init() {}

    #if canImport(ActivityKit)
    private var activity: Activity<GembaWalkActivityAttributes>? = nil
    #endif
    private var lastState: (title: String, dist: Int, done: Int, phase: String)? = nil
    private var lastPush = Date.distantPast
    private let arrivalHaptic = UINotificationFeedbackGenerator()
    private var arrivedFor: String? = nil

    var isRunning: Bool {
        #if canImport(ActivityKit)
        return activity != nil
        #else
        return false
        #endif
    }

    /// Start (or restart) the activity for a walk.
    func start(spaceName: String, headerLine: String, total: Int) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            AppLog.info("gemba", "live activity disabled by user/system"); return
        }
        end()
        let attrs = GembaWalkActivityAttributes(spaceName: spaceName, headerLine: headerLine)
        let state = GembaWalkActivityAttributes.ContentState(nextTitle: "Relocalising…", category: nil, distanceM: nil,
                                                             done: 0, total: total, phase: "paused")
        do {
            activity = try Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil), pushType: nil)
            AppLog.info("gemba", "live activity started", ["total": total])
        } catch {
            AppLog.warn("gemba", "live activity start failed: \(error.localizedDescription)")
        }
        #endif
    }

    /// Throttled update — at most ~2/s and only when something visible changed.
    /// `distanceM` nil = tracking lost (phase paused, last distance kept by the widget).
    func update(nextTitle: String, category: String?, distanceM: Float?, done: Int, total: Int, trackingOK: Bool, arrivedM: Float) {
        #if canImport(ActivityKit)
        guard let activity else { return }
        let phase: String = !trackingOK ? "paused" : (distanceM.map { $0 <= arrivedM } ?? false ? "arrived" : "navigate")
        let distBucket = distanceM.map { Int(($0 * 10).rounded()) } ?? -1      // 0.1 m buckets
        let key = (nextTitle, distBucket, done, phase)
        if let l = lastState, l == key { return }
        if Date().timeIntervalSince(lastPush) < 0.5 && phase == lastState?.phase { return }
        lastState = key; lastPush = Date()
        let state = GembaWalkActivityAttributes.ContentState(
            nextTitle: nextTitle, category: category, distanceM: distanceM.map { Double($0) },
            done: done, total: total, phase: phase)
        Task { await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(120))) }
        #endif
        // Arrival haptic — once per finding, regardless of the widget.
        if trackingOK, let d = distanceM, d <= arrivedM, arrivedFor != nextTitle {
            arrivedFor = nextTitle
            arrivalHaptic.notificationOccurred(.success)
        }
        if let d = distanceM, d > arrivedM + 1.0, arrivedFor == nextTitle { arrivedFor = nil }
    }

    func finish(done: Int, total: Int) {
        #if canImport(ActivityKit)
        guard let activity else { return }
        let state = GembaWalkActivityAttributes.ContentState(nextTitle: "Walk complete", category: nil, distanceM: nil,
                                                             done: done, total: total, phase: "done")
        Task { await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(300))) }
        self.activity = nil
        #endif
        lastState = nil
    }

    func end() {
        #if canImport(ActivityKit)
        if let a = activity { Task { await a.end(nil, dismissalPolicy: .immediate) } }
        activity = nil
        #endif
        lastState = nil; arrivedFor = nil
    }
}
