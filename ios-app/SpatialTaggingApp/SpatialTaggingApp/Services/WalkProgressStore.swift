// WalkProgressStore.swift — R3 (2026.4.46): a Gemba walk survives an app kill.
//
// Per space (anchor), on this device: which findings the operator completed,
// the index they were walking to, and the walk id (author side). Written on
// every change, read on entry; older than 12 h is treated as stale so a
// yesterday's half-walk doesn't silently resume today.

import Foundation

struct WalkProgress: Codable, Equatable {
    var anchorId: String
    var walkId: String?
    var completedTagIds: [String] = []
    var currentIndex: Int = 0
    var savedAt: Date = Date()
}

enum WalkProgressStore {
    private static let prefix = "gemba_walk_progress_"
    static let staleAfter: TimeInterval = 12 * 3600

    static func load(anchorId: String) -> WalkProgress? {
        guard let data = UserDefaults.standard.data(forKey: prefix + anchorId),
              let p = try? JSONDecoder().decode(WalkProgress.self, from: data) else { return nil }
        if Date().timeIntervalSince(p.savedAt) > staleAfter { clear(anchorId: anchorId); return nil }
        return p
    }

    static func save(_ p: WalkProgress) {
        var q = p; q.savedAt = Date()
        if let data = try? JSONEncoder().encode(q) { UserDefaults.standard.set(data, forKey: prefix + p.anchorId) }
    }

    static func clear(anchorId: String) {
        UserDefaults.standard.removeObject(forKey: prefix + anchorId)
    }
}
