// InspectionDebugLog.swift
//
// Collects per-tag metric breakdowns during each inspection session and writes
// them to a structured text file in the app's Documents folder.
//
// Export:  Settings → Export Debug Log  → iOS share sheet → AirDrop to Mac.
//
// Format (human-readable + machine-parseable):
//   === SESSION abc123  2025-06-04T10:30:00Z ===
//   anchor: anchor-id-here  asset: CHAMBER-01
//   ---
//   TAG  Valve Status  [presenceCheck / cone]
//     ssim        0.412
//     featurePrint 0.734  ← used
//     depthScore  0.821
//     alignAngle  8.3°   factor=0.908
//     ocr         n/a
//     final       0.714  PASS
//   ---
//   TAG  Warning Label  [languageCheck / ocr]
//     ssim        0.381
//     featurePrint 0.502
//     ocr         0.875  ← used
//     final       0.875  PASS
//   ---
//   RESULT  PARTIAL  pass=1  fail=1  pending=0

import Foundation

// ── Per-tag metric record ─────────────────────────────────────────────────────

struct TagDebugEntry {
    let tagId:       String
    let tagLabel:    String
    let tagType:     String
    let captureMode: String
    var ssim:        Double = 0
    var featurePrint: Double = 0
    var depthScore:  Double?  = nil
    var alignAngleDeg: Double? = nil
    var alignFactor: Double?  = nil
    var ocrScore:    Double?  = nil
    var finalScore:  Double = 0
    var status:      String = "PENDING"
    var usedMetric:  String = "ssim"   // which metric drove the final score
}

// ── Session log ───────────────────────────────────────────────────────────────

final class InspectionDebugLog {

    private(set) var sessionId: String = ""
    private(set) var anchorId:  String = ""
    private(set) var assetId:   String = ""
    private(set) var startedAt: String = ""
    private(set) var entries:   [TagDebugEntry] = []
    private(set) var overallStatus: String = ""

    static let shared = InspectionDebugLog()
    private init() {}

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    func beginSession(sessionId: String, anchorId: String, assetId: String) {
        self.sessionId    = sessionId
        self.anchorId     = anchorId
        self.assetId      = assetId
        self.startedAt    = ISO8601DateFormatter().string(from: Date())
        self.entries      = []
        self.overallStatus = ""
    }

    func record(_ entry: TagDebugEntry) {
        if let idx = entries.firstIndex(where: { $0.tagId == entry.tagId }) {
            entries[idx] = entry
        } else {
            entries.append(entry)
        }
    }

    func finish(overallStatus: String) {
        self.overallStatus = overallStatus
        persist()
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private func persist() {
        let text = formatted()
        let filename = "inspection-\(String(sessionId.prefix(8)))-\(startedAt.prefix(10)).log"
        let url = logFileURL(filename: filename)
        try? text.write(to: url, atomically: true, encoding: .utf8)
        print("[DebugLog] Written to \(url.lastPathComponent)")
    }

    func exportURL() -> URL? {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: logsDirectory(),
            includingPropertiesForKeys: [.creationDateKey],
            options: .skipsHiddenFiles
        )) ?? []
        // Return most recent log
        return files.sorted {
            (try? $0.resourceValues(forKeys: [.creationDateKey])
                    .creationDate) ?? .distantPast
            > (try? $1.resourceValues(forKeys: [.creationDateKey])
                    .creationDate) ?? .distantPast
        }.first
    }

    func allLogURLs() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(
            at: logsDirectory(),
            includingPropertiesForKeys: [.creationDateKey],
            options: .skipsHiddenFiles
        ))?.sorted {
            (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            > (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
        } ?? []
    }

    // ── Formatting ────────────────────────────────────────────────────────────

    func formatted() -> String {
        var lines: [String] = []
        lines.append("=== SESSION \(sessionId)  \(startedAt) ===")
        lines.append("anchor: \(anchorId)  asset: \(assetId)")
        lines.append("")

        for e in entries {
            lines.append("TAG  \(e.tagLabel)  [\(e.tagType) / \(e.captureMode)]")
            lines.append(metric("ssim",         e.ssim,        used: e.usedMetric == "ssim"))
            lines.append(metric("featurePrint",  e.featurePrint, used: e.usedMetric == "fp"))
            if let d = e.depthScore {
                lines.append(metric("depth",    d,              used: e.usedMetric == "depth"))
            }
            if let a = e.alignAngleDeg, let f = e.alignFactor {
                lines.append("  alignAngle  \(String(format:"%.1f",a))°   factor=\(String(format:"%.3f",f))")
            }
            if let o = e.ocrScore {
                lines.append(metric("ocr",      o,              used: e.usedMetric == "ocr"))
            } else {
                lines.append("  ocr         n/a")
            }
            lines.append("  final       \(String(format:"%.3f",e.finalScore))  \(e.status)")
            lines.append("---")
        }

        let passCount    = entries.filter { $0.status == "PASS"    }.count
        let failCount    = entries.filter { $0.status == "FAIL"    }.count
        let pendingCount = entries.filter { $0.status == "PENDING" }.count
        lines.append("RESULT  \(overallStatus)  pass=\(passCount)  fail=\(failCount)  pending=\(pendingCount)")
        return lines.joined(separator: "\n")
    }

    private func metric(_ name: String, _ score: Double, used: Bool) -> String {
        let pad   = String(repeating: " ", count: max(0, 12 - name.count))
        let arrow = used ? "  ← used" : ""
        return "  \(name)\(pad)\(String(format: "%.3f", score))\(arrow)"
    }

    // ── File helpers ──────────────────────────────────────────────────────────

    private func logsDirectory() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory,
                                             in: .userDomainMask).first!
        let dir  = docs.appendingPathComponent("InspectionLogs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir,
                                                  withIntermediateDirectories: true)
        return dir
    }

    private func logFileURL(filename: String) -> URL {
        logsDirectory().appendingPathComponent(filename)
    }
}
