// SIBTypes.swift — Phase 2A
// Codable types mirroring shared/src/index.ts. Keep in sync with the TypeScript schema.

import Foundation
import SwiftUI

// ── Enumerations ──────────────────────────────────────────────────────────────

enum CoordinateSystem: String, Codable {
    case plantFrame  = "PLANT_FRAME"
    case assetFrame  = "ASSET_FRAME"
    case localDevice = "LOCAL_DEVICE_FRAME"
}

enum TagType: String, Codable, CaseIterable, Identifiable {
    case inspectionPoint    = "INSPECTION_POINT"
    case defect             = "DEFECT"
    case instruction        = "INSTRUCTION"
    case warning            = "WARNING"
    case measurement        = "MEASUREMENT"
    // Phase 2 — cleanroom
    case presenceCheck      = "PRESENCE_CHECK"
    case languageCheck      = "LANGUAGE_CHECK"
    case routingCheck       = "ROUTING_CHECK"
    case configurationCheck = "CONFIGURATION_CHECK"
    case partCheck          = "PART_CHECK"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .inspectionPoint:    return "Inspection Point"
        case .defect:             return "Defect"
        case .instruction:        return "Instruction"
        case .warning:            return "Warning"
        case .measurement:        return "Measurement"
        case .presenceCheck:      return "Presence Check"
        case .languageCheck:      return "Language Check"
        case .routingCheck:       return "Routing Check"
        case .configurationCheck: return "Configuration Check"
        case .partCheck:          return "Part Check"
        }
    }

    var iconName: String {
        switch self {
        case .inspectionPoint:    return "magnifyingglass"
        case .defect:             return "exclamationmark.triangle"
        case .instruction:        return "list.bullet"
        case .warning:            return "exclamationmark.shield"
        case .measurement:        return "ruler"
        case .presenceCheck:      return "checkmark.square"
        case .languageCheck:      return "character.book.closed"
        case .routingCheck:       return "arrow.triangle.branch"
        case .configurationCheck: return "gearshape"
        case .partCheck:          return "puzzlepiece"
        }
    }

    /// SwiftUI accent colour for each tag type — used for chips, AR markers and badges.
    var color: Color {
        switch self {
        case .inspectionPoint:    return .blue
        case .defect:             return .red
        case .instruction:        return .purple
        case .warning:            return .orange
        case .measurement:        return .cyan
        case .presenceCheck:      return .green
        case .languageCheck:      return .indigo
        case .routingCheck:       return .yellow
        case .configurationCheck: return Color(white: 0.55)
        case .partCheck:          return .mint
        }
    }

    /// True for tag types that use client-side Vision OCR for validation
    /// instead of (or alongside) server-side SSIM comparison.
    var usesOCR: Bool { self == .languageCheck }

    // ── Capture mode ──────────────────────────────────────────────────────────
    // Determines which training capture UX is shown in Author mode and which
    // validation strategy is used in Operator mode.
    //
    // Multi-anchor readiness: capture mode is a property of the tag TYPE, not
    // the anchor.  When multi-anchor is implemented, the anchor transform used
    // to convert stored quaternions/positions to world space will be looked up
    // by tag.anchorId — no changes needed to this routing logic.

    var captureMode: TagCaptureMode {
        switch self {
        case .inspectionPoint:              return .honeycomb
        case .languageCheck, .warning:      return .ocr
        default:                            return .cone
        }
    }
}

/// Determines the training capture UX and validation strategy for a tag.
enum TagCaptureMode {
    /// 7-viewpoint AR honeycomb walk-around — multi-angle feature print coverage.
    case honeycomb
    /// Single cone-guided capture with LiDAR depth + feature print.
    /// Operator aligns to the stored cone direction before inspection.
    case cone
    /// OCR text extraction — no image comparison, text match only.
    case ocr
}

enum ValidationStatus: String, Codable { case pass = "PASS"; case fail = "FAIL"; case pending = "PENDING" }
enum AnchorStatus: String, Codable     { case pass = "PASS"; case fail = "FAIL"; case partial = "PARTIAL"; case pending = "PENDING" }

// ── Spatial primitives ────────────────────────────────────────────────────────

struct SIBVector3: Codable {
    let x, y, z: Double
    static let zero = SIBVector3(x: 0, y: 0, z: 0)
}

struct SIBQuaternion: Codable {
    let x, y, z, w: Double
    static let identity = SIBQuaternion(x: 0, y: 0, z: 0, w: 1)
}

// ── Anchor ────────────────────────────────────────────────────────────────────

struct Anchor: Codable, Identifiable, Hashable {
    let id: String
    let assetId: String
    let coordinateSystem: CoordinateSystem
    let position: SIBVector3
    let rotation: SIBQuaternion
    let metadata: [String: AnyCodable]
    /// Phase 3: base64-encoded AES-256-GCM key stored in SIB at anchor creation.
    /// Used by AnchorHubView to regenerate the full QR on any authorised device.
    let encryptionKey: String?
    /// Physical QR print size in centimetres. Set once at anchor creation and
    /// never changed — every QR generator reads this value so the QR is identical
    /// on every device and in the portal. Nil = legacy anchor, default to 10.0.
    let qrSizeCm: Double?
    let createdAt: String
    let updatedAt: String

    // Hashable — use id only; metadata:[String:AnyCodable] is not natively Hashable.
    static func == (lhs: Anchor, rhs: Anchor) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct CreateAnchorRequest: Codable {
    let id: String?
    let assetId: String
    let coordinateSystem: CoordinateSystem
    let position: SIBVector3
    let rotation: SIBQuaternion
    let metadata: [String: AnyCodable]
    /// Phase 3: base64-encoded AES-256-GCM key generated at anchor creation.
    /// Stored in SIB so any authorised device can retrieve + re-generate the full QR.
    let encryptionKey: String?
    /// Physical QR print size in cm — set once, never changed.
    let qrSizeCm: Double?
}

// ── Tag ───────────────────────────────────────────────────────────────────────

struct Tag: Codable, Identifiable {
    let id: String
    let anchorId: String
    let type: TagType
    let label: String
    let expectedOutcome: String
    let checkDescription: String?
    let order: Int?
    let metadata: [String: AnyCodable]
    /// Server-computed: true when a pass-state exists for this tag.
    /// Optional for backward compatibility with older SIB responses.
    let isTrained: Bool?
    let createdAt: String
    let updatedAt: String
}

struct CreateTagRequest: Codable {
    let anchorId: String
    let type: TagType
    let label: String
    let expectedOutcome: String
    let checkDescription: String?
    let order: Int?
    let metadata: [String: AnyCodable]
}

/// Partial update — only non-nil fields are written by the server.
/// metadata is deep-merged: existing tag metadata keys are preserved.
struct UpdateTagRequest: Codable {
    let label:            String?
    let expectedOutcome:  String?
    let checkDescription: String?
    let order:            Int?
    /// Deep-merged into tag.metadata on the server.
    /// Used to store feature prints, OCR text, and other per-tag payload.
    let metadata:         [String: AnyCodable]?
}

// ── QR payload ────────────────────────────────────────────────────────────────

struct QRAnchorContext: Codable, Equatable {
    let assetId:       String
    let anchorId:      String
    /// Phase 2.5: base64-encoded AES-256-GCM key embedded in the QR by the Author.
    /// Nil for legacy unencrypted anchors. Never sent to the SIB — lives only on scanning devices.
    let encryptionKey: String?
    /// Physical width of the printed QR code in centimetres.
    /// Used by ARKit's PnP solver to compute accurate 6DOF pose from image corners.
    /// Nil = default 10 cm.  Encoding this in the payload means any print size works
    /// without requiring a fixed standard across sites (Option B covers Option A).
    let qrSizeCm:      Double?

    /// Physical width in metres for ARReferenceImage (default 10 cm if not specified).
    var physicalWidth: CGFloat { CGFloat((qrSizeCm ?? 10.0) / 100.0) }

    // ── Canonical payload builder ─────────────────────────────────────────────
    // DO NOT use JSONEncoder to build QR payloads.  Swift's JSONEncoder routes
    // through a Dictionary internally on iOS, which does NOT preserve key
    // insertion order — the key order varies between runs and OS versions,
    // producing a different byte string (and therefore different QR pixels)
    // each time.  This function constructs the JSON string directly so the
    // key order is always: assetId → anchorId → encryptionKey? → qrSizeCm.
    // That matches the portal's JSON.stringify insertion-order output exactly.
    static func buildCanonicalPayload(
        assetId:       String,
        anchorId:      String,
        encryptionKey: String?,
        qrSizeCm:      Double
    ) -> String {
        // Minimal escaping — assetIds are plain ASCII, anchorIds are UUIDs,
        // and encryptionKeys are base64 (A-Za-z0-9+/=).  None of these
        // contain backslashes or double-quotes, but we escape defensively.
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "\\", with: "\\\\")
             .replacingOccurrences(of: "\"",  with: "\\\"")
        }
        var parts = [
            "\"assetId\":\"\(esc(assetId))\"",
            "\"anchorId\":\"\(esc(anchorId))\""
        ]
        if let key = encryptionKey {
            parts.append("\"encryptionKey\":\"\(esc(key))\"")
        }
        // Emit whole numbers without a decimal to match JS JSON.stringify —
        // e.g. 10.0 → "10", not "10.0"
        let sizeStr = qrSizeCm.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(qrSizeCm))
            : String(qrSizeCm)
        parts.append("\"qrSizeCm\":\(sizeStr)")
        return "{\(parts.joined(separator: ","))}"
    }
}

// ── Anchor readiness (G1) ─────────────────────────────────────────────────────
// Returned by GET /anchors/:id/readiness — used to gate Operator mode entry.

struct AnchorReadiness: Codable {
    let isReady:         Bool
    let totalTags:       Int
    let trainedTags:     Int
    let untrainedTagIds: [String]
    let message:         String
}

// ── Pass-state ────────────────────────────────────────────────────────────────

struct CameraPose: Codable {
    let position: SIBVector3
    let rotation: SIBQuaternion
}

struct PassStateImage: Codable {
    let id: String?
    let tagId: String
    let anchorId: String
    let assetId: String
    let imageBase64: String
    let mimeType: String
    let pose: CameraPose
    let capturedAt: String?
}

struct CreatePassStateRequest: Codable {
    let tagId: String
    let anchorId: String
    let assetId: String
    let images: [PassStateImage]
}

struct PassState: Codable {
    let id: String
    let tagId: String
    let anchorId: String
    let assetId: String
    let images: [PassStateImage]
    let createdAt: String
    let updatedAt: String
}

// ── Validation ────────────────────────────────────────────────────────────────

struct ValidationResult: Codable, Identifiable {
    let id: String
    let tagId: String
    let anchorId: String
    let assetId: String
    let sessionId: String
    let status: ValidationStatus
    let confidence: Double
    let evaluatedAt: String
}

struct BatchValidateRequest: Codable {
    let anchorId:      String
    let assetId:       String
    let sessionId:     String
    let imageBase64:   String
    let mimeType:      String
    /// Override the global 0.60 threshold. Nil = use SIB default.
    let threshold:     Double?
    /// When set, only these tag IDs are evaluated (failed-only re-inspection).
    let tagIds:        [String]?
    /// Phase 2.5: base64-encoded AES-256-GCM key from QR scan.
    /// SIB decrypts stored pass-state images in-memory before comparison. Plaintext never re-persisted.
    let encryptionKey: String?
}

struct TagValidationSummary: Codable, Identifiable {
    var tagId:      String
    var tagLabel:   String
    var tagType:    TagType
    var status:     ValidationStatus
    var confidence: Double
    var id: String { tagId }
}

struct AnchorValidationResult: Codable, Identifiable {
    let id:         String
    let anchorId:   String
    let assetId:    String
    let sessionId:  String
    var status:     AnchorStatus          // var — recomputed after OCR patching
    var passCount:  Int                   // var — recomputed after OCR patching
    var failCount:  Int                   // var — recomputed after OCR patching
    let totalCount: Int
    var tagResults: [TagValidationSummary] // var — patched with OCR scores
    let evaluatedAt: String
}

// ── Last Author Session (UserDefaults persistence) ────────────────────────────
// Stores just the anchor ID + asset ID so the home screen can offer a "Continue"
// shortcut without scanning the QR again.  Full tags are re-fetched live from SIB.

struct LastAuthorSession: Codable {
    let anchorId:     String
    let assetId:      String
    let savedAt:      String     // ISO 8601 — shown in the "Continue" card
    let trainedTagIds: [String]  // restored so progress bar is accurate
}

// ── Session ───────────────────────────────────────────────────────────────────

struct CreateSessionRequest: Codable { let userId: String; let assetId: String }

struct SIBSession: Codable, Identifiable {
    let id: String
    let userId: String
    let assetId: String
    let startTime: String
    let endTime: String?
    let createdAt: String
    let updatedAt: String
}

// ── API envelope ──────────────────────────────────────────────────────────────

struct APIResponse<T: Decodable>: Decodable { let data: T; let timestamp: String }
struct APIError: Codable, LocalizedError {
    let error: String; let timestamp: String
    var errorDescription: String? { error }
}

// ── AnyCodable (for metadata fields) ─────────────────────────────────────────

struct AnyCodable: Codable {
    let value: Any
    init(_ value: Any = "") { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Int.self)    { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(Bool.self)   { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        // ── Array support ──────────────────────────────────────────────────────
        // feature_prints is stored as [String] (array of base64 feature prints).
        // Without this branch the decoder falls through to value = "" and the
        // entire feature_prints payload is silently discarded, making
        // applyFeaturePrintValidation in OperatorModeView always skip every tag.
        if let v = try? c.decode([AnyCodable].self) { value = v.map { $0.value }; return }
        value = ""
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Int:    try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as Bool:   try c.encode(v)
        case let v as String: try c.encode(v)
        // ── Array support — mirrors the decode branch above ────────────────────
        // Encodes [Any] as a JSON array by wrapping each element in AnyCodable.
        // Required so feature_prints round-trips correctly through UpdateTagRequest.
        case let v as [Any]:  try c.encode(v.map { AnyCodable($0) })
        default:              try c.encode("")
        }
    }
}
