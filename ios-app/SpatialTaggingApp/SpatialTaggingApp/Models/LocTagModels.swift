// LocTagModels.swift — Phase 2: Loc-Tag (Gemba audit walk)
//
// Swift equivalents of the canonical types in shared/src/index.ts.
// All raw values match the TypeScript string literals exactly so JSON
// round-trips to the SIB server without any custom coding keys.

import UIKit   // UIImage is used in convenience inits for image base64 encoding

// ============================================================
// MARK: - Severity (shared across tag types)
// ============================================================

/// Issue severity. Mirrors `Severity` in shared/src/index.ts.
enum Severity: String, Codable, CaseIterable, Identifiable {
    var id: String { rawValue }
    case low    = "LOW"
    case medium = "MEDIUM"
    case high   = "HIGH"

    var displayName: String {
        switch self { case .low: return "Low"; case .medium: return "Medium"; case .high: return "High" }
    }
}

// ============================================================
// MARK: - Enumerations
// ============================================================

/// Defect categories available when placing a Loc-Tag during an audit walk.
/// Mirrors `DefectCategory` in shared/src/index.ts.
enum DefectCategory: String, Codable, CaseIterable, Identifiable {
    var id: String { rawValue }

    case sixC             = "6C"
    case cosmetic         = "COSMETIC"
    case cableRouting     = "CABLE_ROUTING"
    case partMissing      = "PART_MISSING"
    case looseComponents  = "LOOSE_COMPONENTS"
    case swappedParts     = "SWAPPED_PARTS"
    case safetyHazard     = "SAFETY_HAZARD"
    case contamination    = "CONTAMINATION"
    case warning          = "WARNING"
    case others           = "OTHERS"

    /// Human-readable label for the form sheet picker.
    var displayName: String {
        switch self {
        case .sixC:            return "6C"
        case .cosmetic:        return "Cosmetic"
        case .cableRouting:    return "Cable Routing"
        case .partMissing:     return "Part Missing"
        case .looseComponents: return "Loose Components"
        case .swappedParts:    return "Swapped Parts"
        case .safetyHazard:    return "Safety Hazard"
        case .contamination:   return "Contamination"
        case .warning:         return "Warning"
        case .others:          return "Others"
        }
    }
}

/// Operator resolution status for a completed Loc-Tag visit.
/// Mirrors `LocTagCompletionStatus` in shared/src/index.ts.
enum LocTagCompletionStatus: String, Codable, CaseIterable, Identifiable {
    var id: String { rawValue }

    case resolved     = "RESOLVED"
    case stillPresent = "STILL_PRESENT"
    case escalated    = "ESCALATED"

    var displayName: String {
        switch self {
        case .resolved:     return "Resolved"
        case .stillPresent: return "Still Present"
        case .escalated:    return "Escalated"
        }
    }
}

/// Discriminates between QR-scanned anchors, surface-tap Loc-Tag anchors and
/// iLOTO control-panel anchors. Mirrors `AnchorType` in shared/src/index.ts.
/// iLOTO anchors use the full QR + worldmap flow (a control panel is a fixed,
/// QR-labelled asset) but open the iLOTO hub instead of the classic one.
enum AnchorType: String, Codable {
    case qr     = "QR"
    case locTag = "LOC_TAG"
    case loto   = "LOTO"
    /// Anchor Lab rig (2026.4.46): an anchoring test bed. Only the Lab door
    /// lists it; every production directory filters it out.
    case lab    = "LAB"
}

// ============================================================
// MARK: - Loc-Tag (Author walk)
// ============================================================

/// A defect or observation placed by tapping a surface during an Author's
/// Gemba audit walk. Stored in SIB and re-displayed in AR for Operators.
/// Mirrors `LocTag` in shared/src/index.ts.
struct LocTag: Codable, Identifiable, Equatable {
    let id:                 String
    let anchorId:           String
    let title:              String
    let description:        String
    let severity:           Severity?
    let defectCategory:     DefectCategory
    let defectCategoryNote: String?
    /// Filename on the SIB evidence store — fetch via GET /loc-tags/image/:filename.
    /// G3: always mirrors `photos.first?.path`.
    let referenceImagePath: String?
    /// ARKit world-space position within the saved ARWorldMap.
    let position:           SIBVector3
    /// Author-defined visit order — drives Operator navigation sequence.
    let order:              Int

    // ── G3 (2026.4.46): reference-list finding — snapshot of what was chosen ──
    var focusAreaCode:      String?
    var focusAreaTitle:     String?
    var questionCode:       String?
    var questionTitle:      String?
    var questionText:       String?
    var findingCategory:    GembaFindingCategory?
    var riskRating:         GembaRiskRating?
    /// 'library' (picked, codes present) or 'custom' (typed — no codes). nil on legacy findings.
    var referenceSource:    String?
    var photos:             [LocTagPhoto]?
    /// G2: the walk session this finding belongs to.
    var walkId:             String?

    let createdAt:          String

    var isCustomReference: Bool { referenceSource == "custom" }
    let updatedAt:          String

    /// Every photo on the finding, oldest first — falls back to the legacy
    /// single reference image for findings logged before G3.
    var allPhotos: [LocTagPhoto] {
        if let photos, !photos.isEmpty { return photos }
        if let referenceImagePath { return [LocTagPhoto(path: referenceImagePath, caption: nil, markupPath: nil, drawingPath: nil, capturedAt: createdAt)] }
        return []
    }
    /// "14 · P5142" style line for pills and rows; "Custom" for typed entries; nil for legacy findings.
    var referenceLine: String? {
        if isCustomReference { return "Custom" }
        guard let questionCode else { return nil }
        return [focusAreaCode, questionCode].compactMap { $0 }.joined(separator: " · ")
    }
}

/// One photo on a finding. Mirrors `LocTagPhoto` in shared/src/index.ts.
struct LocTagPhoto: Codable, Equatable, Identifiable {
    var id: String { path }
    let path:       String
    var caption:    String?
    /// G5: the same photo with the auditor's markup, if any.
    var markupPath: String?
    /// G5: PencilKit strokes for re-editing the markup.
    var drawingPath: String?
    let capturedAt: String
}

/// Upper bound on photos per finding (server enforces the same).
let locTagMaxPhotos = 6

// ============================================================
// MARK: - Audit Reference Library (G1)
// ============================================================

/// Finding category — Corporate Quality vocabulary. Mirrors `GembaFindingCategory`.
enum GembaFindingCategory: String, Codable, CaseIterable, Identifiable {
    var id: String { rawValue }
    case strength = "STRENGTH"
    case ofi      = "OFI"
    case nc       = "NC"

    var displayName: String {
        switch self {
        case .strength: return "Strength"
        case .ofi:      return "OFI"
        case .nc:       return "NC"
        }
    }
    var longName: String {
        switch self {
        case .strength: return "Strength"
        case .ofi:      return "Opportunity for Improvement"
        case .nc:       return "Non-Conformance"
        }
    }
    var symbol: String {
        switch self {
        case .strength: return "hand.thumbsup.fill"
        case .ofi:      return "lightbulb.fill"
        case .nc:       return "exclamationmark.triangle.fill"
        }
    }
}

/// Preliminary risk rating 0–3. Mirrors `GembaRiskRating`.
enum GembaRiskRating: Int, Codable, CaseIterable, Identifiable {
    var id: Int { rawValue }
    case noRisk = 0, minor = 1, medium = 2, high = 3

    var displayName: String {
        switch self {
        case .noRisk: return "0 — No risk"
        case .minor:  return "1 — Minor risk"
        case .medium: return "2 — Medium risk"
        case .high:   return "3 — High risk"
        }
    }
    var shortName: String {
        switch self {
        case .noRisk: return "R0"; case .minor: return "R1"; case .medium: return "R2"; case .high: return "R3"
        }
    }
}

/// A numbered audit focus area. Mirrors `GembaFocusArea` (+ nested questions from GET /gemba/library).
struct GembaFocusArea: Codable, Identifiable, Equatable {
    let id:        String
    let code:      String
    let title:     String
    let order:     Int
    let active:    Bool
    var questions: [GembaQuestion]

    var displayName: String { "\(code) — \(title)" }
}

/// A pre-defined question under a focus area. Mirrors `GembaQuestion`.
struct GembaQuestion: Codable, Identifiable, Equatable {
    let id:          String
    let focusAreaId: String
    let code:        String
    let title:       String
    let text:        String
    let order:       Int
    let active:      Bool
}

/// GET /gemba/library — everything a walk needs, one call. Mirrors `GembaLibrary`.
struct GembaLibrary: Codable, Equatable {
    struct CategoryEntry: Codable, Equatable { let code: GembaFindingCategory; let label: String }
    struct RatingEntry:   Codable, Equatable { let value: GembaRiskRating; let label: String }
    let focusAreas: [GembaFocusArea]
    let categories: [CategoryEntry]
    let ratings:    [RatingEntry]
    /// G2: walk-header pick lists. Optional so a cached pre-G2 copy still decodes.
    var lists:      GembaLists?
    let version:    String

    static let empty = GembaLibrary(focusAreas: [], categories: [], ratings: [], lists: nil, version: "0")

    func question(code: String?) -> (area: GembaFocusArea, question: GembaQuestion)? {
        guard let code else { return nil }
        for a in focusAreas { if let q = a.questions.first(where: { $0.code == code }) { return (a, q) } }
        return nil
    }
}

/// Request body for POST /loc-tags.
struct CreateLocTagRequest: Codable {
    let anchorId:             String
    let title:                String
    let description:          String
    let severity:             Severity?
    let defectCategory:       DefectCategory
    let defectCategoryNote:   String?
    let position:             SIBVector3
    let order:                Int
    /// Base64-encoded JPEG reference photo captured at tag placement (legacy single photo).
    let referenceImageBase64: String?
    // ── G3 ──
    /// The server resolves the code against the Audit Reference Library and snapshots area/question.
    var questionCode:         String?
    /// Free-text alternative to questionCode — logged as a 'custom' reference.
    var customFocusArea:      String?
    var customQuestion:       String?
    var findingCategory:      GembaFindingCategory?
    var riskRating:           GembaRiskRating?
    /// Photos with captions, capture order; the first becomes the reference image.
    var photosBase64:         [LocTagPhotoUpload]?
    var walkId:               String?

    init(
        anchorId:            String,
        title:               String,
        description:         String,
        severity:            Severity?      = nil,
        defectCategory:      DefectCategory,
        defectCategoryNote:  String?        = nil,
        position:            SIBVector3,
        order:               Int,
        referenceImage:      UIImage?       = nil,
        questionCode:        String?        = nil,
        customFocusArea:     String?        = nil,
        customQuestion:      String?        = nil,
        findingCategory:     GembaFindingCategory? = nil,
        riskRating:          GembaRiskRating?      = nil,
        photos:              [(image: UIImage, caption: String?)] = [],
        walkId:              String?        = nil
    ) {
        self.anchorId            = anchorId
        self.title               = title
        self.description         = description
        self.severity            = severity
        self.defectCategory      = defectCategory
        self.defectCategoryNote  = defectCategoryNote
        self.position            = position
        self.order               = order
        self.referenceImageBase64 = referenceImage.flatMap {
            $0.jpegData(compressionQuality: 0.65)?.base64EncodedString()
        }
        self.questionCode        = questionCode
        self.customFocusArea     = customFocusArea
        self.customQuestion      = customQuestion
        self.findingCategory     = findingCategory
        self.riskRating          = riskRating
        let uploads = photos.compactMap { LocTagPhotoUpload(image: $0.image, caption: $0.caption) }
        self.photosBase64        = uploads.isEmpty ? nil : uploads
        self.walkId              = walkId
    }
}

/// One photo in a create / append request. Mirrors `{ base64, caption? }`.
struct LocTagPhotoUpload: Codable {
    let base64:  String
    let caption: String?

    init?(image: UIImage, caption: String?) {
        guard let data = image.jpegData(compressionQuality: 0.65) else { return nil }
        self.base64  = data.base64EncodedString()
        let c = caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.caption = c.isEmpty ? nil : c
    }
}

/// Request body for POST /loc-tags/:id/photos.
struct AppendLocTagPhotosRequest: Codable {
    let photosBase64: [LocTagPhotoUpload]
}

// ============================================================
// MARK: - Loc-Tag Completion (Operator walk)
// ============================================================

/// An Operator's completion record for a single Loc-Tag visit.
/// Multiple completions are allowed — the Operator can revisit a tag.
/// Mirrors `LocTagCompletion` in shared/src/index.ts.
struct LocTagCompletion: Codable, Identifiable {
    let id:                  String
    let locTagId:            String
    let anchorId:            String
    let operatorName:        String
    let status:              LocTagCompletionStatus
    /// Filename on SIB evidence store.
    let completionImagePath: String?
    let note:                String?
    let completedAt:         String
}

/// Request body for POST /loc-tags/:id/completion.
struct SubmitLocTagCompletionRequest: Codable {
    let locTagId:               String
    let anchorId:               String
    let operatorName:           String
    let status:                 LocTagCompletionStatus
    let note:                   String?
    /// Base64-encoded JPEG completion photo.
    let completionImageBase64:  String?

    init(
        locTagId:         String,
        anchorId:         String,
        operatorName:     String,
        status:           LocTagCompletionStatus,
        note:             String?  = nil,
        completionImage:  UIImage? = nil
    ) {
        self.locTagId              = locTagId
        self.anchorId              = anchorId
        self.operatorName          = operatorName
        self.status                = status
        self.note                  = note
        self.completionImageBase64 = completionImage.flatMap {
            $0.jpegData(compressionQuality: 0.65)?.base64EncodedString()
        }
    }
}

/// Summary of a LocTag's latest completion — used in session report uploads.
/// Mirrors `LocTagSummary` in shared/src/index.ts.
struct LocTagSummary: Codable {
    let locTagId:     String
    let title:        String
    let order:        Int
    let latestStatus: LocTagCompletionStatus?
    let completedAt:  String?
}

// ============================================================
// MARK: - Update Loc-Tag (Author edit)
// ============================================================

/// Request body for PATCH /loc-tags/:id.
/// All fields are optional — only send what changed.
struct UpdateLocTagRequest: Codable {
    var title:              String?
    var description:        String?
    var severity:           Severity?
    var defectCategory:     DefectCategory?
    var defectCategoryNote: String?
    // ── G3 ── (nil = leave unchanged; the server treats an explicit null as "clear")
    var questionCode:       String?
    var findingCategory:    GembaFindingCategory?
    var riskRating:         GembaRiskRating?
    /// Caption edits: only `path` + `caption` are read by the server.
    var photos:             [PhotoCaption]?

    struct PhotoCaption: Codable { let path: String; let caption: String? }

    init(
        title:              String?        = nil,
        description:        String?        = nil,
        severity:           Severity?      = nil,
        defectCategory:     DefectCategory? = nil,
        defectCategoryNote: String?        = nil,
        questionCode:       String?        = nil,
        findingCategory:    GembaFindingCategory? = nil,
        riskRating:         GembaRiskRating?      = nil,
        photos:             [PhotoCaption]?       = nil
    ) {
        self.title              = title
        self.description        = description
        self.severity           = severity
        self.defectCategory     = defectCategory
        self.defectCategoryNote = defectCategoryNote
        self.questionCode       = questionCode
        self.findingCategory    = findingCategory
        self.riskRating         = riskRating
        self.photos             = photos
    }
}

// ============================================================
// MARK: - Worldmap upload request
// ============================================================

/// Request body for POST /worldmap/upload.
/// `referencePhotoBase64` is a JPEG snapshot taken at the moment the Author
/// saved their first tag — gives Operators a visual landmark for where to
/// stand when re-localizing.  It is optional and non-fatal if absent.
struct WorldMapUploadRequest: Codable {
    let anchorId:              String
    let worldMapBase64:        String
    let capturedAt:            String
    let referencePhotoBase64:  String?

    init(anchorId: String, mapData: Data, referencePhoto: Data? = nil) {
        self.anchorId             = anchorId
        self.worldMapBase64       = mapData.base64EncodedString()
        self.capturedAt           = ISO8601DateFormatter().string(from: Date())
        self.referencePhotoBase64 = referencePhoto?.base64EncodedString()
    }
}

// ============================================================
// MARK: - Gemba Walk session (G2)
// ============================================================

/// Walk-header pick lists. Mirrors `GembaLists`.
struct GembaLists: Codable, Equatable {
    var organization: [String] = []
    var bu:           [String] = []
    var area:         [String] = []
    var location:     [String] = []
}

enum GembaWalkStatus: String, Codable { case open, submitted }

/// Derived counts of a walk's findings. Mirrors `GembaWalkSummary`.
struct GembaWalkSummary: Codable, Equatable {
    let findings:      Int
    let strength:      Int
    let ofi:           Int
    let nc:            Int
    let uncategorised: Int
    let maxRisk:       GembaRiskRating?
    let photos:        Int
}

/// A walk session — the header collected before the first finding. Mirrors `GembaWalk`.
struct GembaWalk: Codable, Identifiable, Equatable {
    let id:           String
    let anchorId:     String
    var auditorId:    String?
    var auditorName:  String
    var projectId:    String?
    var organization: String?
    var bu:           String?
    var area:         String?
    var location:     String?
    var status:       GembaWalkStatus
    let startedAt:    String
    var endedAt:      String?
    var notes:        String?
    var summary:      GembaWalkSummary?

    /// "KarthikDevTest2 · AGS · Montana" for the top bar.
    var headerLine: String {
        [projectId, organization, location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// POST /gemba/walks. Mirrors `StartGembaWalkRequest`.
struct StartGembaWalkRequest: Codable {
    let anchorId:     String
    let auditorName:  String
    var auditorId:    String?
    var projectId:    String?
    var organization: String?
    var bu:           String?
    var area:         String?
    var location:     String?
}

/// GET /gemba/walks/:id
struct GembaWalkDetail: Codable {
    let walk:     GembaWalk
    let findings: [LocTag]
}
