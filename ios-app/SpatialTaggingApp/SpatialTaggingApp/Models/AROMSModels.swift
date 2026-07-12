// AROMSModels.swift — AR OMS Phase 2: Guided work instruction types with spatial placement
//
// Swift equivalents of the AR OMS types in shared/src/index.ts.
// All raw values match the TypeScript string literals exactly so JSON
// round-trips to the SIB server without any custom coding keys.

import UIKit    // UIImage convenience inits for base64 image encoding
import simd     // simd_float3 for AR world-space positions

// ============================================================
// MARK: - Enumerations
// ============================================================

/// Media type for a step's attached asset.
/// Mirrors `GuideStepMediaType` in shared/src/index.ts.
/// 'video' and 'glb' are reserved for Phase 2 — only 'image' is used in MVP.
enum GuideStepMediaType: String, Codable {
    case image = "image"
    case video = "video"
    case glb   = "glb"
}

// ============================================================
// MARK: - Guide
// ============================================================

/// A named, ordered collection of steps attached to one QR Anchor.
/// `published: false` → draft, visible to Authors only.
/// `published: true`  → live, visible to Operators.
/// Mirrors `Guide` in shared/src/index.ts.
struct ARGuide: Codable, Identifiable, Equatable {
    let id:          String
    let anchorId:    String
    let name:        String
    let description: String
    let published:   Bool
    let createdBy:   String
    let createdAt:   String
    let updatedAt:   String
}

/// Request body for POST /guides.
struct CreateARGuideRequest: Codable {
    let anchorId:    String
    let name:        String
    let description: String
    let createdBy:   String
}

/// Request body for PATCH /guides/:id.
/// All fields are optional — only send what changed.
struct UpdateARGuideRequest: Codable {
    var name:        String?
    var description: String?
    var published:   Bool?
}

// ============================================================
// MARK: - GuideStep
// ============================================================

/// One instruction step within an ARGuide.
/// `sequenceNumber` is 1-based and determines display order in the floating panel.
/// `ttsText` overrides the voice synthesis text — defaults to `text` when nil.
/// `mediaPath` is the filename on the SIB guide-step-images store.
/// Phase 2: posX/posY/posZ are ARKit world-space coordinates (relative to the saved ARWorldMap).
/// Mirrors `GuideStep` in shared/src/index.ts.
struct GuideStep: Codable, Identifiable, Equatable {
    let id:                 String
    let guideId:            String
    let anchorId:           String
    let sequenceNumber:     Int
    let text:               String
    let ttsText:            String?
    let mediaType:          GuideStepMediaType?
    let mediaPath:          String?
    let completionRequired: Bool
    // Phase 2: spatial placement
    let posX:               Double?
    let posY:               Double?
    let posZ:               Double?
    let isPlaced:           Bool
    let positionSource:     String?   // "tap" | "cad" — forward compat for CAD import
    let createdAt:          String
    let updatedAt:          String

    /// Effective voice text: ttsText if set, else falls back to the instruction text.
    var effectiveTTSText: String { ttsText ?? text }

    /// ARKit world-space position, or nil if the step has not been placed in AR yet.
    var worldPosition: simd_float3? {
        guard let x = posX, let y = posY, let z = posZ, isPlaced else { return nil }
        return simd_float3(Float(x), Float(y), Float(z))
    }
}

/// Request body for POST /guides/:id/steps.
struct CreateGuideStepRequest: Codable {
    let sequenceNumber:     Int
    let text:               String
    let ttsText:            String?
    let mediaType:          GuideStepMediaType?
    let mediaBase64:        String?
    let completionRequired: Bool

    /// Convenience init — accepts a UIImage directly and encodes it.
    init(
        sequenceNumber:     Int,
        text:               String,
        ttsText:            String?     = nil,
        image:              UIImage?    = nil,
        completionRequired: Bool        = true
    ) {
        self.sequenceNumber     = sequenceNumber
        self.text               = text
        self.ttsText            = ttsText?.isEmpty == true ? nil : ttsText
        self.mediaType          = image != nil ? .image : nil
        self.mediaBase64        = image.flatMap { $0.jpegData(compressionQuality: 0.65)?.base64EncodedString() }
        self.completionRequired = completionRequired
    }
}

/// Request body for PATCH /guides/:id/steps/:stepId.
/// All fields are optional — use the no-arg convenience init from the extension,
/// then set only the fields that changed.
///
/// Media update rules (server-side):
///   ""      (empty string sentinel) → server clears existing photo
///   base64  (non-empty string)      → server saves/replaces photo
///   nil     (key absent in JSON)    → server keeps existing (Swift encodeIfPresent omits nil)
///
/// NOTE: Swift's synthesized Encodable uses encodeIfPresent for Optional properties,
/// which omits nil keys from JSON entirely — NOT as JSON null.  Do NOT set mediaBase64
/// to nil to clear; use "" (empty string sentinel) instead.
struct UpdateGuideStepRequest: Codable {
    var sequenceNumber:     Int?
    var text:               String?
    var ttsText:            String?
    var completionRequired: Bool?
    // Note: send mediaBase64 = nil (JSON null) to clear an existing image.
    var mediaBase64:        String?
    // Phase 2: spatial placement
    var posX:               Double?
    var posY:               Double?
    var posZ:               Double?
    var isPlaced:           Bool?
    var positionSource:     String?
}

extension UpdateGuideStepRequest {
    /// No-arg convenience init — every field nil; caller sets only what changed.
    /// Defined in extension so the synthesized memberwise init is still available.
    init() {
        self.init(sequenceNumber: nil, text: nil, ttsText: nil,
                  completionRequired: nil, mediaBase64: nil,
                  posX: nil, posY: nil, posZ: nil,
                  isPlaced: nil, positionSource: nil)
    }
}

// ============================================================
// MARK: - GuideSession (sign-off record)
// ============================================================

/// Completion record for a single step within a session.
/// Mirrors `GuideStepCompletion` in shared/src/index.ts.
struct GuideStepCompletion: Codable, Equatable {
    let stepId:          String
    let completedAt:     String   // ISO 8601
    let durationSeconds: Double   // elapsed from step entry to checkmark tap
}

/// Full session record submitted atomically at sign-off.
/// Created in one POST — there is no "open / close" lifecycle.
/// Mirrors `GuideSession` in shared/src/index.ts.
struct ARGuideSession: Codable, Identifiable {
    let id:              String
    let guideId:         String
    let anchorId:        String
    let guideName:       String
    let anchorName:      String
    let signedOffBy:     String
    let startedAt:       String
    let completedAt:     String
    let durationSeconds: Double
    let stepCompletions: [GuideStepCompletion]
    let createdAt:       String
    let updatedAt:       String
}

/// Request body for POST /guide-sessions.
struct CreateARGuideSessionRequest: Codable {
    let guideId:         String
    let anchorId:        String
    let guideName:       String
    let anchorName:      String
    let signedOffBy:     String
    let startedAt:       String
    let completedAt:     String
    let durationSeconds: Double
    let stepCompletions: [GuideStepCompletion]
}

// ============================================================
// MARK: - In-session step state (transient, not persisted)
// ============================================================

/// Tracks per-step completion state during an active ARGuideSession.
/// Discarded once the session is submitted; only the final `GuideStepCompletion`
/// records are sent to SIB.
struct GuideStepProgress {
    let step:            GuideStep
    var isCompleted:     Bool   = false
    var enteredAt:       Date?  = nil    // set when the Operator first lands on this step
    var completedAt:     Date?  = nil    // set when the checkmark is tapped

    var durationSeconds: Double {
        guard let entered = enteredAt, let completed = completedAt else { return 0 }
        return completed.timeIntervalSince(entered)
    }

    mutating func enter() {
        if enteredAt == nil { enteredAt = Date() }
    }

    mutating func complete() {
        isCompleted  = true
        completedAt  = Date()
    }

    func toCompletion() -> GuideStepCompletion? {
        guard let completed = completedAt else { return nil }
        return GuideStepCompletion(
            stepId:          step.id,
            completedAt:     ISO8601DateFormatter().string(from: completed),
            durationSeconds: durationSeconds
        )
    }
}
