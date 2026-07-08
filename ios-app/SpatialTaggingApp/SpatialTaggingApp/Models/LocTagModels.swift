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

/// Discriminates between QR-scanned anchors and surface-tap Loc-Tag anchors.
/// Mirrors `AnchorType` in shared/src/index.ts.
enum AnchorType: String, Codable {
    case qr     = "QR"
    case locTag = "LOC_TAG"
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
    let referenceImagePath: String?
    /// ARKit world-space position within the saved ARWorldMap.
    let position:           SIBVector3
    /// Author-defined visit order — drives Operator navigation sequence.
    let order:              Int
    let createdAt:          String
    let updatedAt:          String
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
    /// Base64-encoded JPEG reference photo captured at tag placement.
    let referenceImageBase64: String?

    init(
        anchorId:            String,
        title:               String,
        description:         String,
        severity:            Severity?      = nil,
        defectCategory:      DefectCategory,
        defectCategoryNote:  String?        = nil,
        position:            SIBVector3,
        order:               Int,
        referenceImage:      UIImage?       = nil
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
    }
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
// MARK: - Worldmap upload request
// ============================================================

/// Request body for POST /worldmap/upload.
struct WorldMapUploadRequest: Codable {
    let anchorId:       String
    let worldMapBase64: String
    let capturedAt:     String

    init(anchorId: String, mapData: Data) {
        self.anchorId       = anchorId
        self.worldMapBase64 = mapData.base64EncodedString()
        self.capturedAt     = ISO8601DateFormatter().string(from: Date())
    }
}
