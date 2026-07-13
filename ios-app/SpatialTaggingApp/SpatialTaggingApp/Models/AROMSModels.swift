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
    let title:              String?   // Short display title; nil → fallback to "Step N"
    let text:               String    // Description shown in the expanded panel body
    let ttsText:            String?
    let mediaType:          GuideStepMediaType?
    let mediaPath:          String?
    let completionRequired: Bool
    // Phase 2: spatial placement
    let posX:               Double?
    let posY:               Double?
    let posZ:               Double?
    let isPlaced:           Bool        // non-optional; custom init defaults to false
    let positionSource:     String?     // "tap" | "cad" — forward compat for CAD import
    let createdAt:          String
    let updatedAt:          String

    /// Effective voice text: ttsText if set, else falls back to the instruction text.
    var effectiveTTSText: String { ttsText ?? text }

    /// Display title for pill headers and card headers.
    /// Uses the explicit title if provided, otherwise "Step N" as a safe fallback.
    var displayTitle: String { title?.isEmpty == false ? title! : "Step \(sequenceNumber)" }

    /// ARKit world-space position, or nil if the step has not been placed in AR yet.
    var worldPosition: simd_float3? {
        guard let x = posX, let y = posY, let z = posZ, isPlaced else { return nil }
        return simd_float3(Float(x), Float(y), Float(z))
    }

    // Custom decoder — provides safe defaults for Phase 2 fields (`isPlaced`, `posX/Y/Z`,
    // `positionSource`) that older server builds might not include in the response.
    // Without this, a missing `isPlaced` key causes a decodingError and the step
    // creation / fetch call surfaces "Got an unexpected response from the server."
    init(from decoder: Decoder) throws {
        let c              = try decoder.container(keyedBy: CodingKeys.self)
        id                 = try c.decode(String.self,              forKey: .id)
        guideId            = try c.decode(String.self,              forKey: .guideId)
        anchorId           = try c.decode(String.self,              forKey: .anchorId)
        sequenceNumber     = try c.decode(Int.self,                 forKey: .sequenceNumber)
        title              = try c.decodeIfPresent(String.self,             forKey: .title)
        text               = try c.decode(String.self,              forKey: .text)
        ttsText            = try c.decodeIfPresent(String.self,             forKey: .ttsText)
        mediaType          = try c.decodeIfPresent(GuideStepMediaType.self, forKey: .mediaType)
        mediaPath          = try c.decodeIfPresent(String.self,             forKey: .mediaPath)
        completionRequired = try c.decode(Bool.self,                forKey: .completionRequired)
        // Phase 2 placement fields — default to unplaced when absent (pre-Phase-2 server builds)
        posX               = try c.decodeIfPresent(Double.self,             forKey: .posX)
        posY               = try c.decodeIfPresent(Double.self,             forKey: .posY)
        posZ               = try c.decodeIfPresent(Double.self,             forKey: .posZ)
        isPlaced           = (try? c.decode(Bool.self,              forKey: .isPlaced)) ?? false
        positionSource     = try c.decodeIfPresent(String.self,             forKey: .positionSource)
        createdAt          = try c.decode(String.self,              forKey: .createdAt)
        updatedAt          = try c.decode(String.self,              forKey: .updatedAt)
    }
}

/// Request body for POST /guides/:id/steps.
struct CreateGuideStepRequest: Codable {
    let sequenceNumber:     Int
    let title:              String?    // optional short header; server falls back to "Step N" when absent
    let text:               String
    let ttsText:            String?
    let mediaType:          GuideStepMediaType?
    let mediaBase64:        String?
    let completionRequired: Bool

    /// Convenience init — accepts a UIImage directly and encodes it.
    init(
        sequenceNumber:     Int,
        title:              String?     = nil,
        text:               String,
        ttsText:            String?     = nil,
        image:              UIImage?    = nil,
        completionRequired: Bool        = true
    ) {
        self.sequenceNumber     = sequenceNumber
        self.title              = title?.isEmpty == true ? nil : title
        self.text               = text
        self.ttsText            = ttsText?.isEmpty == true ? nil : ttsText
        self.mediaType          = image != nil ? .image : nil
        self.mediaBase64        = image.flatMap { $0.jpegData(compressionQuality: 0.65)?.base64EncodedString() }
        self.completionRequired = completionRequired
    }
}

/// Request body for PATCH /guides/:id/steps/:stepId.
/// All fields are Optional — Swift synthesizes a no-arg init() automatically.
/// Use UpdateGuideStepRequest() then set only the fields that changed.
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
    var title:              String?    // send "" to clear (revert to "Step N" fallback)
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

// Swift synthesizes init() automatically for this struct because every stored
// property is Optional (implicit nil default). Callers use UpdateGuideStepRequest()
// then set only the fields that changed.

// ============================================================
// MARK: - GuideSession (sign-off record)
// ============================================================

/// Completion record for a single step within a session.
/// Mirrors `GuideStepCompletion` in shared/src/index.ts.
///
/// `evidencePhotoBase64` — Optional JPEG evidence photo captured by the Operator
/// at this step.  Sent in the sign-off request; the server saves it to disk and
/// returns `evidencePhotoPath` in its place.  Both are Optional so existing
/// sessions without evidence decode cleanly.
struct GuideStepCompletion: Codable, Equatable {
    let stepId:               String
    let completedAt:          String   // ISO 8601
    let durationSeconds:      Double   // elapsed from step entry to checkmark tap
    var evidencePhotoBase64:  String?  // request only — stripped by server on receipt
    var evidencePhotoPath:    String?  // response only — set by server after save
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
    var isCompleted:     Bool      = false
    var enteredAt:       Date?     = nil    // set when the Operator first lands on this step
    var completedAt:     Date?     = nil    // set when the checkmark is tapped
    /// Optional evidence photo captured by the Operator at this step.
    /// Encoded as base64 JPEG and included in the sign-off submission.
    var evidencePhoto:   UIImage?  = nil

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
        let b64 = evidencePhoto
            .flatMap { $0.jpegData(compressionQuality: 0.72) }
            .map     { $0.base64EncodedString() }
        return GuideStepCompletion(
            stepId:              step.id,
            completedAt:         ISO8601DateFormatter().string(from: completed),
            durationSeconds:     durationSeconds,
            evidencePhotoBase64: b64,
            evidencePhotoPath:   nil   // server fills this in the response
        )
    }
}
