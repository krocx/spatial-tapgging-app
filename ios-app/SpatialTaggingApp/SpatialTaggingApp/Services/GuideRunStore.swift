//
//  GuideRunStore.swift — operator-run resilience (pilot hardening)
//
//  Two small disk-backed stores that stop a technician's work evaporating:
//
//  1. GuideRunSnapshot — in-progress step state, saved after every completion /
//     failure / evidence capture. A phone call, battery death or accidental
//     Exit mid-procedure no longer means redoing everything: on next launch
//     the session view offers "Resume where you left off?". Cleared on
//     successful (or queued) sign-off, and ignored after 12 h (a new shift
//     should start clean).
//
//  2. PendingSessionQueue — sign-offs that could not reach the server are
//     serialized whole (evidence photos included, base64 in the request) and
//     drained on the next visit to the guide list. An audit record becomes a
//     delay, never a loss.
//

import Foundation
import UIKit

// MARK: - In-progress run snapshot

struct GuideRunSnapshot: Codable {
    struct StepState: Codable {
        let stepId:      String
        var enteredAt:   Date?
        var completedAt: Date?
        var hasEvidence: Bool
    }
    let guideId:   String
    let startedAt: Date
    var savedAt:   Date
    var steps:     [StepState]
    /// Production # the run belongs to (K3). Optional so pre-K3 snapshots
    /// decode; nil = legacy, treated as matching.
    var productionNumber: String?

    var completedCount: Int { steps.filter { $0.completedAt != nil }.count }
}

enum GuideRunStore {

    /// Snapshots older than this are stale — a fresh shift starts clean.
    static let maxAge: TimeInterval = 12 * 3600

    private static var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("guide-progress", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func snapshotURL(_ guideId: String) -> URL {
        dir.appendingPathComponent("\(guideId).json")
    }
    private static func evidenceURL(_ guideId: String, _ stepId: String) -> URL {
        dir.appendingPathComponent("\(guideId)-\(stepId).jpg")
    }

    static func save(guideId: String, startedAt: Date, progresses: [GuideStepProgress],
                     productionNumber: String? = nil) {
        let snap = GuideRunSnapshot(
            guideId: guideId,
            startedAt: startedAt,
            savedAt: Date(),
            steps: progresses.map {
                .init(stepId: $0.step.id,
                      enteredAt: $0.enteredAt,
                      completedAt: $0.completedAt,
                      hasEvidence: $0.evidencePhoto != nil)
            },
            productionNumber: productionNumber
        )
        if let data = try? JSONEncoder().encode(snap) {
            try? data.write(to: snapshotURL(guideId), options: .atomic)
        }
        for p in progresses {
            guard let img = p.evidencePhoto,
                  let jpg = img.jpegData(compressionQuality: 0.72) else { continue }
            try? jpg.write(to: evidenceURL(guideId, p.step.id), options: .atomic)
        }
    }

    /// A resumable snapshot: fresh enough AND has at least one completion.
    static func resumable(guideId: String) -> GuideRunSnapshot? {
        guard let data = try? Data(contentsOf: snapshotURL(guideId)),
              let snap = try? JSONDecoder().decode(GuideRunSnapshot.self, from: data),
              Date().timeIntervalSince(snap.savedAt) < maxAge,
              snap.completedCount > 0
        else { return nil }
        return snap
    }

    /// Apply a snapshot onto freshly built progresses (matched by stepId).
    static func apply(_ snap: GuideRunSnapshot, to progresses: inout [GuideStepProgress]) {
        let byId = Dictionary(uniqueKeysWithValues: snap.steps.map { ($0.stepId, $0) })
        for i in progresses.indices {
            guard let s = byId[progresses[i].step.id] else { continue }
            progresses[i].enteredAt   = s.enteredAt
            progresses[i].completedAt = s.completedAt
            progresses[i].isCompleted = s.completedAt != nil
            if s.hasEvidence,
               let data = try? Data(contentsOf: evidenceURL(snap.guideId, s.stepId)),
               let img = UIImage(data: data) {
                progresses[i].evidencePhoto = img
            }
        }
    }

    static func clear(guideId: String) {
        let fm = FileManager.default
        try? fm.removeItem(at: snapshotURL(guideId))
        if let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            for f in files where f.lastPathComponent.hasPrefix("\(guideId)-") {
                try? fm.removeItem(at: f)
            }
        }
    }
}

// MARK: - Offline sign-off queue

enum PendingSessionQueue {

    private static var dir: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("pending-guide-sessions", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static var count: Int {
        (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
            .filter { $0.pathExtension == "json" }.count ?? 0
    }

    static func enqueue(_ req: CreateARGuideSessionRequest) -> Bool {
        guard let data = try? JSONEncoder().encode(req) else { return false }
        let url = dir.appendingPathComponent("\(UUID().uuidString).json")
        return (try? data.write(to: url, options: .atomic)) != nil
    }

    /// Try to submit every queued sign-off; deletes each on success.
    /// Returns the number synced. Safe to call often — no-op when empty.
    static func drain(client: SIBClient) async -> Int {
        guard let files = try? FileManager.default
            .contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter({ $0.pathExtension == "json" })
        else { return 0 }
        var synced = 0
        for file in files {
            guard let data = try? Data(contentsOf: file),
                  let req = try? JSONDecoder().decode(CreateARGuideSessionRequest.self, from: data)
            else { try? FileManager.default.removeItem(at: file); continue }   // corrupt → drop
            do {
                _ = try await client.submitGuideSession(req)
                try? FileManager.default.removeItem(at: file)
                synced += 1
            } catch {
                break   // server still unreachable — keep the rest for later
            }
        }
        return synced
    }
}
