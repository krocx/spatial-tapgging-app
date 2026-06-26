// ValidationResultsView.swift — Phase 2E
// Summary sheet shown after "End Inspection":
//   • Overall anchor status (PASS / FAIL / PARTIAL)
//   • Pass/fail/pending counts + progress bar
//   • Per-tag rows: label · type · PASS/FAIL badge · confidence %
//
// Callbacks:
//   onClose                 — dismiss sheet, return to AR reviewing view (see markers)
//   onReInspect(failedOnly) — dismiss + reset markers for a new snapshot
//                             true  = only re-validate FAIL/PENDING tags (keep PASS green)
//                             false = re-validate all tags from scratch
//   onNewScan               — dismiss + start AnchorScanView for a different anchor

import SwiftUI

struct ValidationResultsView: View {

    let result:      AnchorValidationResult
    let anchor:      Anchor
    let onClose:     () -> Void
    let onReInspect: (_ failedOnly: Bool) -> Void
    let onNewScan:   () -> Void

    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                // #67: missing-encryption-key warning from the server — explains
                // a uniform ~0% confidence across every tag.
                if let warning = result.warning {
                    Section {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "key.slash")
                                .foregroundStyle(.orange)
                            Text(warning)
                                .font(.caption)
                                .foregroundStyle(.primary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                overallSection
                tagResultsSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Inspection Results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Left — go back to AR view (markers still coloured)
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { onClose() }
                }
                // Right — scan a different anchor
                ToolbarItem(placement: .primaryAction) {
                    Button("New Scan") { onNewScan() }
                        .bold()
                }
            }

            // Re-inspect buttons at bottom
            reInspectButtons
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
        }
    }

    // ── Overall status section ────────────────────────────────────────────────

    private var overallSection: some View {
        Section {
            VStack(spacing: 16) {
                HStack(spacing: 20) {
                    Image(systemName: result.status.iconName)
                        .font(.system(size: 52))
                        .foregroundStyle(result.status.color)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(result.status.displayText)
                            .font(.title.bold())
                            .foregroundStyle(result.status.color)
                        Text("\(result.passCount) of \(result.totalCount) checks passed")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if result.failCount > 0 {
                            Text("\(result.failCount) check\(result.failCount == 1 ? "" : "s") need attention")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    Spacer()
                }

                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.red.opacity(0.2))
                            .frame(height: 8)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(result.status.color)
                            .frame(
                                width: result.totalCount > 0
                                    ? geo.size.width * CGFloat(result.passCount) / CGFloat(result.totalCount)
                                    : 0,
                                height: 8
                            )
                            .animation(.easeOut(duration: 0.6), value: result.passCount)
                    }
                }
                .frame(height: 8)

                // Anchor + asset info
                HStack {
                    LabeledContent("Anchor", value: String(result.anchorId.prefix(14)) + "…")
                    Spacer()
                    LabeledContent("Asset", value: result.assetId)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
        }
    }

    // ── Per-tag results section ───────────────────────────────────────────────

    private var tagResultsSection: some View {
        Section {
            // Failed tags first so they're easy to spot
            let sorted = result.tagResults.sorted { a, b in
                statusOrder(a.status) < statusOrder(b.status)
            }
            ForEach(sorted) { tagResult in
                TagResultRow(tagResult: tagResult)
            }
        } header: {
            HStack {
                Text("Checks")
                Spacer()
                HStack(spacing: 12) {
                    if result.passCount > 0 {
                        Label("\(result.passCount)", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                    if result.failCount > 0 {
                        Label("\(result.failCount)", systemImage: "xmark.circle.fill")
                            .foregroundStyle(.red)
                    }
                    let pending = result.tagResults.filter { $0.status == .pending }.count
                    if pending > 0 {
                        Label("\(pending)", systemImage: "clock")
                            .foregroundStyle(.gray)
                    }
                }
                .font(.caption.bold())
            }
        }
    }

    // ── Re-inspect buttons ────────────────────────────────────────────────────
    // "Re-inspect Failed" is only shown when there are actually failed tags.

    @ViewBuilder
    private var reInspectButtons: some View {
        VStack(spacing: 10) {
            // Re-inspect failed tags only
            if result.failCount > 0 {
                Button {
                    onReInspect(true)
                } label: {
                    Label(
                        "Re-inspect \(result.failCount) Failed Tag\(result.failCount == 1 ? "" : "s")",
                        systemImage: "arrow.counterclockwise.circle.fill"
                    )
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }

            // Re-inspect all tags
            Button {
                onReInspect(false)
            } label: {
                Label("Re-inspect All Tags", systemImage: "arrow.clockwise.circle.fill")
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.bordered)
            .tint(.blue)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func statusOrder(_ s: ValidationStatus) -> Int {
        switch s { case .fail: return 0; case .pending: return 1; case .pass: return 2 }
    }
}

// ── Tag result row ────────────────────────────────────────────────────────────

private struct TagResultRow: View {

    let tagResult: TagValidationSummary

    // #72: PENDING has exactly one cause today (no Pass reference trained
    // yet for this tag) — tapping the row surfaces that explicitly instead
    // of leaving the operator with an unexplained "Not trained" dead end.
    @State private var showingRecoveryInfo = false

    private var isPending: Bool { tagResult.status == .pending }
    private var isPass:    Bool { tagResult.status == .pass    }
    // #66: a decrypt failure is a pipeline error, not a real visual mismatch —
    // tapping the row explains that distinctly instead of leaving it looking
    // like an ordinary (and confusing) ~0% confidence FAIL.
    private var isDecryptFailure: Bool { tagResult.errorReason == "DECRYPT_FAILED" }
    private var isTappableForInfo: Bool { isPending || isDecryptFailure }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: tagResult.tagType.iconName)
                .font(.title3)
                .foregroundStyle(rowColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 5) {
                Text(tagResult.tagLabel)
                    .font(.subheadline.bold())
                    .lineLimit(1)

                // Coloured type chip — mirrors AuthorTagRow visual style
                HStack(spacing: 4) {
                    Image(systemName: tagResult.tagType.iconName)
                        .font(.system(size: 9, weight: .semibold))
                    Text(tagResult.tagType.displayName)
                        .font(.system(size: 10, weight: .semibold))
                    if tagResult.tagType.usesOCR {
                        Text("· OCR")
                            .font(.system(size: 9, weight: .bold))
                    }
                }
                .foregroundStyle(tagResult.tagType.color)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(tagResult.tagType.color.opacity(0.10), in: Capsule())
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                statusBadge
                if !isPending {
                    Text("\(Int(tagResult.confidence * 100))%")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 2)
        .listRowBackground((isPending || isDecryptFailure) ? Color.clear : rowColor.opacity(0.05))
        .contentShape(Rectangle())
        .onTapGesture { if isTappableForInfo { showingRecoveryInfo = true } }
        .alert(isDecryptFailure ? "Couldn't Verify This Tag" : "Tag Not Trained", isPresented: $showingRecoveryInfo) {
            Button("OK", role: .cancel) {}
        } message: {
            if isDecryptFailure {
                Text("\"\(tagResult.tagLabel)\"'s stored reference images couldn't be decrypted, so this isn't a real mismatch — it's a key problem. Make sure you scanned the app-generated QR (Author → QR icon) and that the part wasn't trained under a different key, then re-run this inspection.")
            } else {
                Text("\"\(tagResult.tagLabel)\" has no Pass reference recorded yet, so it can't be validated. Switch to Author Mode and tap Train on this tag, then re-run this inspection.")
            }
        }
    }

    private var rowColor: Color {
        if isDecryptFailure { return .orange }
        switch tagResult.status {
        case .pass:    return .green
        case .fail:    return .red
        case .pending: return .gray
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        // #66: check decrypt failure first — it overrides the FAIL badge with
        // a distinct one so it doesn't read as an ordinary visual mismatch.
        if isDecryptFailure {
            Label("Couldn't verify — tap for details", systemImage: "lock.trianglebadge.exclamationmark")
                .font(.caption)
                .foregroundStyle(.orange)
        } else {
            switch tagResult.status {
            case .pass:
                Label("PASS", systemImage: "checkmark.circle.fill")
                    .font(.caption.bold())
                    .foregroundStyle(.green)
            case .fail:
                Label("FAIL", systemImage: "xmark.circle.fill")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
            case .pending:
                Label("Not trained — tap for details", systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// ── ValidationStatus helpers ──────────────────────────────────────────────────

extension ValidationStatus {
    var color: Color {
        switch self {
        case .pass:    return .green
        case .fail:    return .red
        case .pending: return .gray
        }
    }
}
