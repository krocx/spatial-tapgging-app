// PresenceService.swift — P1 (2026.4.46): who else is in front of this chamber.
//
// Multi-user co-authoring without ARKit collaborative sessions: every device
// already localises into the chamber's SHARED FRAME (sealed map / object), so
// a camera pose from another iPad — even one in front of a different physical
// unit of the same chamber type, on another continent — is directly
// comparable. SIB just relays.
//
//   • Poster   — my pose (in the shared frame) + what I'm working on, 2×/s,
//                POST /anchors/:id/presence. The reply carries everyone else.
//   • Listener — the anchor's SSE feed (GET /anchors/:id/subscribe):
//                presence / presence:joined / presence:left / guide-steps.
//
// `poseProvider` returns nil until the session frame IS the shared frame
// (relocalized / object-rebased) — we never publish a pose in a private frame.

import Foundation
import simd
import UIKit

// ── Wire types (mirror shared/src/index.ts) ──────────────────────────────────

struct PresenceUpdate: Encodable {
    var userId:  String
    var name:    String
    var role:    String?
    var surface: String          // placeSteps | author | operator | guide
    var guideId: String?
    var pose:    [Float]         // 16, column-major, shared frame
    var focusId: String?
    var site:    String?
}

struct PresenceEntry: Decodable, Identifiable, Equatable {
    var userId:    String
    var name:      String
    var role:      String?
    var surface:   String
    var guideId:   String?
    var pose:      [Float]
    var focusId:   String?
    var site:      String?
    var anchorId:  String
    var updatedAt: String

    var id: String { userId }
    var transform: simd_float4x4? { ARCoordinateFrame.transform(from: pose) }
    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.map { String($0.prefix(1)).uppercased() }.joined()
        return s.isEmpty ? "?" : s
    }
    var updatedDate: Date { ISO8601DateFormatter.presence.date(from: updatedAt) ?? Date() }
}

private struct PresenceLeft: Decodable { let userId: String }

extension ISO8601DateFormatter {
    static let presence: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}

/// Deterministic colour per person (role first, then a stable hash of the id).
enum PresencePalette {
    static func color(role: String?, userId: String) -> UIColor {
        switch role {
        case "engineer":   return .systemIndigo
        case "technician": return .systemTeal
        case "admin", "owner": return .systemOrange
        default:
            let hues: [CGFloat] = [0.78, 0.55, 0.08, 0.35, 0.92, 0.62]
            let h = hues[abs(userId.hashValue) % hues.count]
            return UIColor(hue: h, saturation: 0.55, brightness: 0.95, alpha: 1)
        }
    }
}

/// Tiny reference box so a SwiftUI view can hand the poster a LIVE focus
/// (struct state captured in a closure would be a stale copy).
final class PresenceFocusBox { var stepId: String? = nil }

// ── Service ──────────────────────────────────────────────────────────────────

@MainActor
final class PresenceService: ObservableObject {
    enum Event: Equatable {
        case joined(PresenceEntry)
        case left(userId: String, name: String)
        case stepsChanged
    }

    @Published private(set) var others: [PresenceEntry] = []
    /// One-shot notifications for toasts; the view clears it after showing.
    @Published var event: Event? = nil
    /// Bumped on every `guide-steps` event (a colleague saved pins).
    @Published private(set) var stepsVersion = 0
    @Published private(set) var isConnected = false

    let anchorId: String
    let surface:  String
    let guideId:  String?
    let me:       (userId: String, name: String, role: String?, site: String)

    /// Camera pose in the SHARED frame, or nil while the frame is private.
    var poseProvider:  () -> simd_float4x4? = { nil }
    var focusProvider: () -> String?        = { nil }

    private let client: SIBClient
    private var poster:   Task<Void, Never>? = nil
    private var listener: Task<Void, Never>? = nil
    private let staleAfter: TimeInterval = 30

    init(client: SIBClient, settings: AppSettings, anchorId: String, surface: String, guideId: String?) {
        self.client   = client
        self.anchorId = anchorId
        self.surface  = surface
        self.guideId  = guideId
        let uid  = settings.employeeId.trimmingCharacters(in: .whitespaces)
        let name = !settings.uamUserName.isEmpty ? settings.uamUserName
                 : !settings.authorName.isEmpty  ? settings.authorName : "Author"
        self.me = (
            userId: uid.isEmpty ? "device-\(UIDevice.current.identifierForVendor?.uuidString.prefix(8) ?? "local")" : uid,
            name:   name,
            role:   settings.uamRole.isEmpty ? nil : settings.uamRole,
            site:   PresenceService.siteLabel()
        )
    }

    /// "Singapore", "Los Angeles", "Berlin" — from the time zone; enough for
    /// the lens and it needs no setup.
    static func siteLabel() -> String {
        let id = TimeZone.current.identifier
        let city = id.split(separator: "/").last.map(String.init) ?? id
        return city.replacingOccurrences(of: "_", with: " ")
    }

    func start() {
        stop()
        poster = Task { [weak self] in
            while !Task.isCancelled {
                await self?.postOnce()
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
        listener = Task { [weak self] in await self?.listen() }
    }

    func stop() {
        poster?.cancel();   poster = nil
        listener?.cancel(); listener = nil
        isConnected = false
        let aid = anchorId, uid = me.userId, c = client
        Task.detached { await c.leavePresence(anchorId: aid, userId: uid) }
    }

    private func postOnce() async {
        guard let pose = poseProvider() else { return }
        let u = PresenceUpdate(userId: me.userId, name: me.name, role: me.role, surface: surface,
                               guideId: guideId, pose: ARCoordinateFrame.floats(from: pose),
                               focusId: focusProvider(), site: me.site)
        if let list = try? await client.postPresence(anchorId: anchorId, update: u) {
            merge(list, replace: true)
        }
    }

    private func merge(_ entries: [PresenceEntry], replace: Bool) {
        var map: [String: PresenceEntry] = [:]
        if !replace { for o in others { map[o.userId] = o } }
        for e in entries where e.userId != me.userId { map[e.userId] = e }
        let now = Date()
        others = map.values
            .filter { now.timeIntervalSince($0.updatedDate) < staleAfter }
            .sorted { $0.name < $1.name }
    }

    private func listen() async {
        while !Task.isCancelled {
            do {
                let req = try client.anchorStreamRequest(anchorId: anchorId)
                let (bytes, response) = try await URLSession.shared.bytes(for: req)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                isConnected = true
                var eventName = ""
                for try await line in bytes.lines {
                    if Task.isCancelled { return }
                    if line.hasPrefix("event: ") { eventName = String(line.dropFirst(7)); continue }
                    if line.isEmpty { eventName = ""; continue }
                    guard line.hasPrefix("data: "), let data = String(line.dropFirst(6)).data(using: .utf8) else { continue }
                    switch eventName {
                    case "presence", "presence:joined":
                        if let e = try? JSONDecoder().decode(PresenceEntry.self, from: data), e.userId != me.userId {
                            let isNew = !others.contains { $0.userId == e.userId }
                            merge([e], replace: false)
                            if isNew { event = .joined(e) }
                        }
                    case "presence:left":
                        if let l = try? JSONDecoder().decode(PresenceLeft.self, from: data), l.userId != me.userId {
                            let name = others.first { $0.userId == l.userId }?.name ?? "A colleague"
                            others.removeAll { $0.userId == l.userId }
                            event = .left(userId: l.userId, name: name)
                        }
                    case "guide-steps":
                        stepsVersion += 1
                        event = .stepsChanged
                    default: break
                    }
                }
            } catch { /* reconnect below */ }
            isConnected = false
            if Task.isCancelled { return }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
        }
    }
}
