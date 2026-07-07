// InspectionSession.swift — Phase 4: Session Reporting + Operator Evidence Capture
//
// Data models for structured operator inspection sessions.
// These are uploaded to SIB at the end of each session, keyed by the existing
// SIBSession.id that is created when the operator opens the AR session.
//
// Design:
//   • One `TagInspectionRecord` per tag — written when the Operator taps "Tag Inspected"
//   • Evidence images are uploaded per-tag as they are confirmed, returning an imagePath
//   • Full `SubmitReportRequest` is POSTed to PATCH /sessions/:id/report on End Session

import Foundation

// ── Per-tag inspection outcome ────────────────────────────────────────────────

/// The inspection outcome for a single tag within a session.
/// Mirrors `TagInspectionStatus` in shared/src/index.ts.
enum TagInspectionStatus: String, Codable {
    case notVisited     = "NOT_VISITED"
    case pass           = "PASS"
    case fail           = "FAIL"
}

/// Tracks the live AR workflow state for a tag during an active inspection session.
/// Drives the 5-state badge in InspectAllTags / ValidationResultsView.
/// NOT persisted — lives only in OperatorModeView memory during the session.
enum TagInspectionState: Equatable {
    case notVisited           // Never entered cone zone
    case validating           // In cone zone, live loop running
    case awaitingConfirmation // Sheet showing, loop paused
    case inspectedPass        // Operator tapped "Tag Inspected" — confirmed PASS
    case inspectedFail        // Operator tapped "Tag Inspected" — confirmed FAIL
}

// ── Persisted per-tag record ──────────────────────────────────────────────────

/// One inspection record per tag — written when the Operator taps "Tag Inspected".
/// Uploaded inside `SubmitReportRequest` at End Session.
struct TagInspectionRecord: Codable, Identifiable {
    var id: String { tagId }
    var tagId:          String
    var tagLabel:       String
    var status:         TagInspectionStatus
    /// Optional note entered by the Operator (always optional, per spec).
    var note:           String?
    /// Filename on the SIB evidence store (AnchorID_TagID_YYYYMMDD_HHMMSS.jpg).
    /// Nil when the upload failed or was not attempted (e.g. network unavailable).
    var imagePath:      String?
    /// True when this tag showed FAIL during the session but was corrected and
    /// confirmed PASS before the operator moved on. Recorded for management analytics.
    var fixedInSession: Bool
}

// ── Session report request body ───────────────────────────────────────────────

/// Sent as the request body for PATCH /sessions/:id/report.
struct SubmitReportRequest: Codable {
    let ownerName:       String
    let anchorId:        String
    let anchorName:      String          // assetId — human-readable label
    let endTime:         String          // ISO 8601
    let durationSeconds: Double
    let tagRecords:      [TagInspectionRecord]
    let overallStatus:   TagInspectionStatus
}

// ── Evidence upload ───────────────────────────────────────────────────────────

/// Sent as the request body for POST /sessions/:id/evidence/:tagId.
struct UploadEvidenceRequest: Codable {
    let anchorId:    String
    let imageBase64: String
    let mimeType:    String
    let capturedAt:  String              // ISO 8601

    init(anchorId: String, imageBase64: String, capturedAt: String) {
        self.anchorId    = anchorId
        self.imageBase64 = imageBase64
        self.mimeType    = "image/jpeg"
        self.capturedAt  = capturedAt
    }
}

/// Response from POST /sessions/:id/evidence/:tagId.
struct EvidenceUploadResponse: Codable {
    /// Filename on the SIB server: `AnchorID_TagID_YYYYMMDD_HHMMSS.jpg`.
    let imagePath: String
}
