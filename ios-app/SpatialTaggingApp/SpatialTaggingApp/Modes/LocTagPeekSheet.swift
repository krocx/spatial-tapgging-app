// LocTagPeekSheet.swift — Phase 2 (Task #137)
// Read-only bottom sheet shown when the Author (or Operator) taps an existing
// Loc-Tag pin in AR.  Displays the tag's details and offers Edit.
//
// Used by: LocTagAuthorView (resume mode), LocTagOperatorView (future task #138)

import SwiftUI

struct LocTagPeekSheet: View {

    let locTag:    LocTag
    let onUpdated: ((LocTag) -> Void)?   // nil in read-only (Operator) contexts

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    @State private var showEdit = false

    init(locTag: LocTag, onUpdated: ((LocTag) -> Void)? = nil) {
        self.locTag    = locTag
        self.onUpdated = onUpdated
    }

    var body: some View {
        NavigationStack {
            List {
                // ── Stop badge + title ─────────────────────────────────────────
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        // Order badge
                        ZStack {
                            Circle()
                                .fill(Color.orange)
                                .frame(width: 42, height: 42)
                            Text("\(locTag.order + 1)")
                                .font(.headline.bold())
                                .foregroundStyle(.white)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text(locTag.title)
                                .font(.headline)
                            Text("Stop #\(locTag.order + 1)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }

                // ── Category + severity ────────────────────────────────────────
                Section("Classification") {
                    LabeledContent("Category") {
                        Text(locTag.defectCategory.displayName)
                            .foregroundStyle(.secondary)
                    }

                    if let sev = locTag.severity {
                        LabeledContent("Severity") {
                            Text(sev.displayName)
                                .foregroundStyle(severityColor(sev))
                        }
                    }

                    if let note = locTag.defectCategoryNote, !note.isEmpty {
                        LabeledContent("Note") {
                            Text(note).foregroundStyle(.secondary)
                        }
                    }
                }

                // ── Description ───────────────────────────────────────────────
                if !locTag.description.isEmpty {
                    Section("Description") {
                        Text(locTag.description)
                            .font(.body)
                            .foregroundStyle(.primary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Issue Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                if onUpdated != nil {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit") { showEdit = true }
                    }
                }
            }
            // ── Edit sheet ──────────────────────────────────────────────────
            .sheet(isPresented: $showEdit) {
                if let onUpdated {
                    LocTagEditSheet(locTag: locTag) { updated in
                        onUpdated(updated)
                        dismiss()
                    }
                    .environmentObject(settings)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func severityColor(_ s: Severity) -> Color {
        switch s {
        case .low:    return .green
        case .medium: return .orange
        case .high:   return .red
        }
    }
}
