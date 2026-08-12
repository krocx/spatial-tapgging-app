// LotoModels.swift — iLOTO data models. Mirrors the iLOTO section of
// shared/src/index.ts (see docs/ILOTO.md).
//
// Design invariants that shape these types:
//   • Events are append-only on the server; STATUS IS DERIVED, never edited.
//     The client renders what /loto/status returns — it never computes its own
//     lock state from cached events.
//   • The server is the referee: checklists, one-lock-one-person and override
//     conditions are validated server-side. The client shows friendly flows;
//     a 4xx here means the flow tried to skip something.

import Foundation

// ============================================================
// MARK: - Points
// ============================================================

/// 'safeoff' = out-of-service YELLOW lock on a circuit breaker;
/// 'loto'    = personal danger RED lock on a switch.
enum LotoPointKind: String, Codable {
    case safeoff
    case loto

    var displayName: String {
        switch self {
        case .safeoff: return "Safe Off"
        case .loto:    return "LOTO"
        }
    }
}

/// An authored isolation point on a control panel (placed in AR).
/// Mirrors `LotoPoint` in shared/src/index.ts.
struct LotoPoint: Codable, Identifiable, Equatable {
    let id:         String
    let anchorId:   String
    let kind:       LotoPointKind
    let label:      String
    let circuitId:  String?
    let position:   SIBVector3
    let modelId:    String?
    let modelScale: Double?
    let createdBy:  String
    let createdAt:  String
    let updatedAt:  String
}

struct CreateLotoPointRequest: Codable {
    let anchorId:   String
    let kind:       LotoPointKind
    let label:      String
    let circuitId:  String?
    let position:   SIBVector3
    let modelId:    String?
    let modelScale: Double?
    let createdBy:  String
}

// ============================================================
// MARK: - Events (append-only audit log)
// ============================================================

enum LotoEventType: String, Codable {
    case apply
    case remove
    case overrideRemove = "override-remove"
}

/// OSHA exception procedure record — all three confirmations must be true.
struct LotoOverride: Codable, Equatable {
    let supervisorName:         String
    let reason:                 String
    let verifiedAbsent:         Bool
    let contactAttempted:       Bool
    let willInformBeforeReturn: Bool
}

/// One immutable audit record. Mirrors `LotoEvent` in shared/src/index.ts.
struct LotoEvent: Codable, Identifiable, Equatable {
    let id:         String
    let anchorId:   String
    let pointId:    String
    let type:       LotoEventType
    let userId:     String
    let userName:   String
    let lockSerial: String?
    let checklist:  [String: Bool]
    let photoPath:  String?
    let override:   LotoOverride?
    let note:       String?
    let createdAt:  String
}

struct CreateLotoEventRequest: Codable {
    let anchorId:    String
    let pointId:     String
    let type:        LotoEventType
    let userId:      String
    let userName:    String
    let lockSerial:  String?
    let checklist:   [String: Bool]
    let photoBase64: String?
    let override:    LotoOverride?
    let note:        String?
}

/// Response from POST /loto/events — the recorded event plus the point's
/// freshly derived status (so the UI updates without a second round-trip).
struct LotoEventResponse: Codable {
    let event:  LotoEvent
    let status: LotoPointStatus
}

// ============================================================
// MARK: - Derived status (server-computed, read-only)
// ============================================================

struct LotoPointStatus: Codable, Equatable {
    let point:        LotoPoint
    let state:        String          // "clear" | "locked"
    let lockedBy:     String?
    let lockedByName: String?
    let lockedAt:     String?
    let lockSerial:   String?
    let lastEventId:  String?

    var isLocked: Bool { state == "locked" }
}

/// Panel-level summary — drives the hub status banner.
struct LotoAnchorStatus: Codable, Equatable {
    let anchorId:      String
    let points:        [LotoPointStatus]
    let lotoActive:    Int
    let safeOffActive: Int
    let lastEventAt:   String?
}

/// One of MY active locks, across all anchors (My LOTO).
struct MyLotoEntry: Codable, Equatable {
    let anchorId:   String
    let anchorName: String
    let status:     LotoPointStatus
}

// ============================================================
// MARK: - Training / certification
// ============================================================

/// A quiz question as the CLIENT sees it — the server withholds the answer;
/// grading happens on submit.
struct LotoQuizQuestionPublic: Codable, Identifiable, Equatable {
    let id:      String
    let prompt:  String
    let choices: [String]
}

struct LotoQuizPayload: Codable {
    let questions: [LotoQuizQuestionPublic]
    let passRatio: Double
}

struct SubmitLotoQuizRequest: Codable {
    let userId:   String
    let userName: String
    let answers:  [String: Int]
}

struct LotoQuizResultItem: Codable, Equatable {
    let questionId:   String
    let correct:      Bool
    let correctIndex: Int
    let explanation:  String
}

/// Certification record. Gate rule: `passed && expiresAt > now`.
struct LotoCertification: Codable, Identifiable, Equatable {
    let id:        String
    let userId:    String
    let userName:  String
    let score:     Int
    let total:     Int
    let passed:    Bool
    let issuedAt:  String
    let expiresAt: String

    var isValid: Bool {
        guard passed, let expiry = ISO8601DateFormatter().date(from: expiresAt) else {
            // expiresAt from the server carries fractional seconds; try both forms.
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if passed, let e = f.date(from: expiresAt) { return e > Date() }
            return false
        }
        return expiry > Date()
    }
}

struct SubmitLotoQuizResult: Codable {
    let certification: LotoCertification
    let results:       [LotoQuizResultItem]
}
