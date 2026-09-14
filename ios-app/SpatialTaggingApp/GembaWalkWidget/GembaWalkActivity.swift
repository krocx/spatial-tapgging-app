// GembaWalkActivity.swift — G6 (2026.4.46): the Live Activity contract for a
// Gemba walk. The app and the widget extension are separate modules that
// each compile their own copy of this file (both targets use synchronized
// folders, so a shared membership is not available). KEEP THE TWO COPIES
// IDENTICAL: SpatialTaggingApp/Shared/ and GembaWalkWidget/.
//
// Static attributes are fixed for the life of the activity; the content
// state is what the app updates as the operator walks: the next finding, the
// distance to it, progress, and a phase the widget renders differently.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

struct GembaWalkActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Title of the finding being walked to ("P5142 — Concept Understanding").
        var nextTitle: String
        /// Category code for the accent (STRENGTH / OFI / NC) or nil.
        var category: String?
        /// Straight-line distance in metres; nil while unknown.
        var distanceM: Double?
        var done: Int
        var total: Int
        /// navigate · arrived · paused (tracking lost — raise the phone) · done
        var phase: String
    }

    /// The space being walked ("Chamber bay 3") and the walk header line.
    var spaceName: String
    var headerLine: String
}
#endif
