// LocTagEditSheet.swift — Phase 2 (Task #135)
// Edit sheet for modifying an existing LocTag's metadata.
// Pre-populates all editable fields from the LocTag passed in, sends a
// PATCH /loc-tags/:id to the SIB, and calls onUpdated with the fresh copy.
// Note: position and order are not editable here — those are set at placement.

import SwiftUI

struct LocTagEditSheet: View {

    let locTag:    LocTag
    let onUpdated: (LocTag) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    // ── Form fields (pre-populated in init) ──────────────────────────────────
    @State private var title:          String
    @State private var description:    String
    @State private var severity:       Severity?
    @State private var defectCategory: DefectCategory
    @State private var categoryNote:   String

    // ── Submission ────────────────────────────────────────────────────────────
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    init(locTag: LocTag, onUpdated: @escaping (LocTag) -> Void) {
        self.locTag    = locTag
        self.onUpdated = onUpdated
        _title          = State(initialValue: locTag.title)
        _description    = State(initialValue: locTag.description)
        _severity       = State(initialValue: locTag.severity)
        _defectCategory = State(initialValue: locTag.defectCategory)
        _categoryNote   = State(initialValue: locTag.defectCategoryNote ?? "")
    }

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {

                // ── Issue details ──────────────────────────────────────────────
                Section("Issue Details") {
                    TextField("Title (required)", text: $title)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3, reservesSpace: true)
                }

                // ── Classification ─────────────────────────────────────────────
                Section("Classification") {
                    Picker("Severity", selection: $severity) {
                        Text("Not set").tag(Optional<Severity>.none)
                        ForEach(Severity.allCases) { s in
                            Text(s.displayName).tag(Optional(s))
                        }
                    }

                    Picker("Defect Category", selection: $defectCategory) {
                        ForEach(DefectCategory.allCases) { cat in
                            Text(cat.displayName).tag(cat)
                        }
                    }

                    if defectCategory == .others {
                        TextField("Category note (optional)", text: $categoryNote)
                    }
                }

                // ── Meta ───────────────────────────────────────────────────────
                Section {
                    HStack {
                        Label("Position", systemImage: "mappin")
                        Spacer()
                        Text("Stop #\(locTag.order + 1)")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Position and visit order cannot be changed. Delete and re-place the tag to move it.")
                        .font(.caption)
                }

                // ── Error ──────────────────────────────────────────────────────
                if let err = submitError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Edit Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await submit() } }
                            .disabled(!isValid || isSubmitting)
                    }
                }
            }
        }
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    private func submit() async {
        isSubmitting = true
        submitError  = nil

        let req = UpdateLocTagRequest(
            title:              title.trimmingCharacters(in: .whitespaces),
            description:        description.trimmingCharacters(in: .whitespaces),
            severity:           severity,
            defectCategory:     defectCategory,
            defectCategoryNote: defectCategory == .others && !categoryNote.isEmpty
                                    ? categoryNote : nil
        )

        let client = SIBClient(settings: settings)
        do {
            let updated = try await client.updateLocTag(id: locTag.id, req: req)
            await MainActor.run {
                onUpdated(updated)
                dismiss()
            }
        } catch {
            await MainActor.run {
                isSubmitting = false
                submitError  = friendlyMessage(for: error)
            }
        }
    }
}
