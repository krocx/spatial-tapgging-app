// EditTagSheet.swift — Phase 2E
// Presented from AuthorModeView's tag list.
// Lets an author:
//   • Edit the tag label, check description, and expected outcome.
//   • Re-train the pass-state for just this tag (launches HoneycombCaptureView).
//
// Callbacks:
//   onSaved(updatedTag) — tag was patched on SIB; caller should update activeTags
//   onRetrain()        — caller should dismiss sheet and open HoneycombCaptureView

import SwiftUI

struct EditTagSheet: View {

    let tag: Tag
    let onSaved:  (Tag) -> Void
    let onRetrain: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @State private var label:            String
    @State private var checkDescription: String
    @State private var expectedOutcome:  String

    @State private var isSaving   = false
    @State private var saveError: String? = nil

    init(tag: Tag, onSaved: @escaping (Tag) -> Void, onRetrain: @escaping () -> Void) {
        self.tag       = tag
        self.onSaved   = onSaved
        self.onRetrain = onRetrain
        _label            = State(initialValue: tag.label)
        _checkDescription = State(initialValue: tag.checkDescription ?? "")
        _expectedOutcome  = State(initialValue: tag.expectedOutcome)
    }

    private var hasChanges: Bool {
        label            != tag.label            ||
        checkDescription != (tag.checkDescription ?? "") ||
        expectedOutcome  != tag.expectedOutcome
    }

    var body: some View {
        NavigationStack {
            Form {
                // ── Tag identity (read-only) ───────────────────────────────────
                Section {
                    LabeledContent("Type",  value: tag.type.displayName)
                    LabeledContent("ID",    value: String(tag.id.prefix(14)) + "…")
                } header: {
                    Text("Tag Info")
                }

                // ── Editable fields ───────────────────────────────────────────
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Label").font(.caption).foregroundStyle(.secondary)
                        TextField("e.g. ACD Connector", text: $label)
                            .autocorrectionDisabled()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Check Description").font(.caption).foregroundStyle(.secondary)
                        TextField("e.g. Verify amber connector is seated", text: $checkDescription)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Expected Outcome").font(.caption).foregroundStyle(.secondary)
                        TextField("e.g. Connector present and locked", text: $expectedOutcome)
                    }
                } header: {
                    Text("Edit Details")
                } footer: {
                    Text("Changes are saved to SIB immediately.")
                        .font(.caption2)
                }

                // ── Re-train section ──────────────────────────────────────────
                Section {
                    Button {
                        onRetrain()
                    } label: {
                        Label(
                            appState.trainedTagIds.contains(tag.id)
                                ? "Re-capture Pass Images"
                                : "Capture Pass Images",
                            systemImage: "camera.viewfinder"
                        )
                        .foregroundStyle(.blue)
                    }
                } header: {
                    Text("Training")
                } footer: {
                    Text(
                        appState.trainedTagIds.contains(tag.id)
                            ? "This tag has been trained. Re-capturing will replace the current pass state."
                            : "No pass state yet. Capture reference images to enable inspection."
                    )
                    .font(.caption2)
                }

                // ── Error ─────────────────────────────────────────────────────
                if let err = saveError {
                    Section {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .onTapGesture { saveError = nil }
                    }
                }
            }
            .navigationTitle("Edit Tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onSaved(tag) }   // dismiss with no changes
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Save") { Task { await save() } }
                            .bold()
                            .disabled(!hasChanges)
                    }
                }
            }
        }
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    private func save() async {
        isSaving  = true
        saveError = nil

        let req = UpdateTagRequest(
            label:            label.trimmingCharacters(in: .whitespaces).isEmpty ? nil : label.trimmingCharacters(in: .whitespaces),
            expectedOutcome:  expectedOutcome.trimmingCharacters(in: .whitespaces).isEmpty ? nil : expectedOutcome.trimmingCharacters(in: .whitespaces),
            checkDescription: checkDescription.trimmingCharacters(in: .whitespaces).isEmpty ? nil : checkDescription.trimmingCharacters(in: .whitespaces),
            order:            nil,
            metadata:         nil
        )

        let client = SIBClient(settings: settings)
        do {
            let updated = try await client.updateTag(id: tag.id, req: req)
            isSaving = false
            onSaved(updated)
        } catch {
            saveError = error.localizedDescription
            isSaving  = false
        }
    }
}
