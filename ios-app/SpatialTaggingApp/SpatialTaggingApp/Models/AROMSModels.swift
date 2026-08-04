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

/// Original file format of an uploaded 3D model.
/// Mirrors `ModelFormat` in shared/src/index.ts.
enum ModelFormat: String, Codable {
    case glb  = "glb"
    case gltf = "gltf"
    case usdz = "usdz"
    case obj  = "obj"
    case fbx  = "fbx"
    case step = "step"
    case iges = "iges"
}

/// Processing / availability status of a 3D model in the asset library.
/// Mirrors `ModelStatus` in shared/src/index.ts.
enum ModelStatus: String, Codable {
    case uploading  = "uploading"
    case processing = "processing"
    case ready      = "ready"
    case failed     = "failed"
}

// ============================================================
// MARK: - Model3D
// ============================================================

/// A 3D model in an anchor's asset library.
/// Models uploaded in non-GLB formats are converted to GLB by the server
/// via Blender headless before being available for AR ghost overlay use.
/// Mirrors `Model3D` in shared/src/index.ts.
struct Model3D: Codable, Identifiable, Equatable {
    let id:               String
    let anchorId:         String?   // optional — global library models may omit this
    let anchorIds:        [String]? // anchor kit membership (v2 global library)
    let name:             String
    let originalFormat:   ModelFormat
    let originalFilename: String
    let fileSizeBytes:    Int
    let status:           ModelStatus
    let conversionError:  String?
    let hasGLB:           Bool
    let hasUSDZ:          Bool
    /// USDZ conversion state set by the portal browser after GLB→USDZ conversion.
    /// 'pending' = not yet converted; 'ready' = USDZ available; 'failed' = conversion error.
    /// Nil on legacy records — infer from hasUSDZ.
    let usdzStatus:       String?
    /// Organizational category. 'general' = visible to ALL anchors without kit assignment.
    let category:         String?
    /// Author-saved default scale — pre-fills the model scale slider in EditStepSheet.
    let defaultScale:     Double?
    let uploadedBy:       String?
    let createdAt:        String
    let updatedAt:        String

    /// True when the model has finished processing and is ready for AR use.
    var isReady: Bool { status == .ready }

    /// Short display label for the source format.
    var formatLabel: String {
        switch originalFormat {
        case .glb, .gltf: return "GLB"
        case .usdz:        return "USDZ"
        case .step, .iges: return "CAD"
        case .obj:         return "OBJ"
        case .fbx:         return "FBX"
        }
    }
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
    // Phase 3D: 3D model assignment
    let modelId:            String?     // ID of Model3D in this anchor's library; nil = no ghost
    let modelScale:         Double?     // world-space uniform scale factor (default 1.0)
    let modelOpacity:       Double?     // ghost overlay opacity 0–1 (default 0.45)
    let modelOffsetX:       Double?     // X offset from step worldPosition in metres (default 0)
    let modelOffsetY:       Double?     // Y offset from step worldPosition in metres (default 0)
    let modelOffsetZ:       Double?     // Z offset from step worldPosition in metres (default 0)
    let modelRotationY:     Double?     // Y-axis rotation in radians (default 0); set by AR placement UI
    // Conditional task graph (Step 2 of AI-readiness) — all optional, nil = linear/default behaviour
    let nextOnSuccess:      String?     // step ID to navigate to on completion; nil → sequenceNumber+1
    let nextOnFailure:      String?     // step ID to navigate to on failure/retry; nil → stay on step
    let precondition:       String?     // step ID that must be completed before this step is reachable
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
        // Phase 3D: model assignment — default nil (key absent) when not yet assigned
        modelId            = try c.decodeIfPresent(String.self,             forKey: .modelId)
        modelScale         = try c.decodeIfPresent(Double.self,             forKey: .modelScale)
        modelOpacity       = try c.decodeIfPresent(Double.self,             forKey: .modelOpacity)
        modelOffsetX       = try c.decodeIfPresent(Double.self,             forKey: .modelOffsetX)
        modelOffsetY       = try c.decodeIfPresent(Double.self,             forKey: .modelOffsetY)
        modelOffsetZ       = try c.decodeIfPresent(Double.self,             forKey: .modelOffsetZ)
        modelRotationY     = try c.decodeIfPresent(Double.self,             forKey: .modelRotationY)
        // Conditional task graph — absent on guides created before Step 2
        nextOnSuccess      = try c.decodeIfPresent(String.self,             forKey: .nextOnSuccess)
        nextOnFailure      = try c.decodeIfPresent(String.self,             forKey: .nextOnFailure)
        precondition       = try c.decodeIfPresent(String.self,             forKey: .precondition)
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
    // Phase 3D: 3D model assignment
    // Note: Swift's encodeIfPresent omits nil keys entirely (does NOT send JSON null).
    // Setting modelId = nil therefore means "don't change"; assigning a real ID sets/replaces.
    // Clearing the model (sending JSON null) is not yet supported via this struct —
    // it would require a custom encoder or an explicit null-sentinel wrapper type.
    var modelId:            String?
    var modelScale:         Double?
    var modelOpacity:       Double?
    var modelOffsetX:       Double?
    var modelOffsetY:       Double?
    var modelOffsetZ:       Double?
    var modelRotationY:     Double?
    // Conditional task graph — nil omits the key (keeps existing); set to "" to clear
    var nextOnSuccess:      String?
    var nextOnFailure:      String?
    var precondition:       String?
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
    var enteredAt:            String?  // ISO 8601 — when step first shown; nil on legacy records
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
    /// Live session id opened at session start — optional for backward compat.
    /// When present the server closes the SSE stream and broadcasts session:submitted.
    let liveSessionId:   String?
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
        let iso = ISO8601DateFormatter()
        let b64 = evidencePhoto
            .flatMap { $0.jpegData(compressionQuality: 0.72) }
            .map     { $0.base64EncodedString() }
        return GuideStepCompletion(
            stepId:              step.id,
            enteredAt:           enteredAt.map { iso.string(from: $0) },
            completedAt:         iso.string(from: completed),
            durationSeconds:     durationSeconds,
            evidencePhotoBase64: b64,
            evidencePhotoPath:   nil   // server fills this in the response
        )
    }
}

// ============================================================
// MARK: - Live Guide Session (real-time telemetry — Step 1 AI readiness)
// ============================================================

/// Step-event types pushed by the Operator device during an active guide walk.
/// Mirrors `GuideSessionEventType` in shared/src/index.ts.
enum GuideSessionEventType: String, Codable {
    case sessionStarted  = "session:started"
    case stepEntered     = "step:entered"
    case stepCompleted   = "step:completed"
    case stepRetried     = "step:retried"
    case perceptionResult = "perception:result"
    case sessionSubmitted = "session:submitted"
}

/// Request body for POST /guide-sessions/live/:id/events.
/// Fire-and-forget: iOS wraps calls in Task{} and ignores errors.
/// Mirrors `PushGuideSessionEventRequest` in shared/src/index.ts.
struct PushGuideSessionEventRequest: Encodable {
    let type:            GuideSessionEventType
    let stepId:          String?
    let stepIndex:       Int?
    let durationSeconds: Double?
}

// MARK: - AI Hint (Step 3: AI Dynamic Instructions adapter)

/// Action the AI adapter recommends alongside a hint.
enum AIHintAction: String, Decodable {
    case navigate = "navigate"
    case none     = "none"
}

/// An AI-generated guidance intervention delivered via GET /guide-sessions/live/:id/hints.
/// Mirrors `AIHint` in shared/src/index.ts.
struct AIHint: Decodable, Identifiable {
    let id:            String
    let liveSessionId: String
    let stepId:        String?
    let text:          String       // guidance shown to the Operator
    let action:        AIHintAction?
    let targetStepId:  String?      // navigate target when action == .navigate
    let ts:            String       // ISO 8601
}
