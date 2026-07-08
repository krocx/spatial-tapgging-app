// LocTagOperatorSheet.swift — Phase 2 (Task G)
// Per-tag completion sheet for the Gemba audit walk Operator.
// Shown when the Operator arrives at a tag (auto) or taps "Complete Tag" (manual).
// Submits a LocTagCompletion via POST /loc-tags/:id/completion.

import SwiftUI
import PhotosUI

struct LocTagOperatorSheet: View {

    let tag:         LocTag
    let anchor:      Anchor
    let onCompleted: (LocTagCompletion) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    // ── Completion fields ─────────────────────────────────────────────────────
    @State private var status:           LocTagCompletionStatus = .resolved
    @State private var note             = ""

    // ── Photo ─────────────────────────────────────────────────────────────────
    @State private var selectedItem:    PhotosPickerItem? = nil
    @State private var completionImage: UIImage?          = nil
    @State private var showCamera                         = false

    // ── Submission ────────────────────────────────────────────────────────────
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    var body: some View {
        NavigationStack {
            Form {

                // ── Defect details (read-only) ─────────────────────────────────
                Section("Defect Details") {
                    LabeledContent("Title", value: tag.title)
                    if !tag.description.isEmpty {
                        LabeledContent("Description", value: tag.description)
                    }
                    LabeledContent("Category", value: tag.defectCategory.displayName)
                    if let sev = tag.severity {
                        LabeledContent("Severity", value: sev.displayName)
                    }
                }

                // ── Resolution ─────────────────────────────────────────────────
                Section("Resolution") {
                    // Segmented picker — fast to tap while standing at a tag
                    Picker("Status", selection: $status) {
                        ForEach(LocTagCompletionStatus.allCases) { s in
                            Text(s.displayName).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)

                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(3, reservesSpace: true)
                }

                // ── Photo evidence ─────────────────────────────────────────────
                Section("Photo Evidence") {
                    if let image = completionImage {
                        HStack {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Spacer()
                            Button(role: .destructive) {
                                completionImage = nil
                                selectedItem    = nil
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }

                    Button { showCamera = true } label: {
                        Label(
                            completionImage == nil ? "Take Photo" : "Retake Photo",
                            systemImage: "camera"
                        )
                    }

                    PhotosPicker(selection: $selectedItem, matching: .images) {
                        Label(
                            completionImage == nil ? "Choose from Library" : "Replace from Library",
                            systemImage: "photo.on.rectangle"
                        )
                    }
                    .onChange(of: selectedItem) { item in
                        Task {
                            if let data = try? await item?.loadTransferable(type: Data.self),
                               let img  = UIImage(data: data) {
                                completionImage = img
                            }
                        }
                    }
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
            .navigationTitle("Tag \(tag.order) of \(tag.order)")   // caller sets correct count
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
                        Button("Submit") { Task { await submit() } }
                    }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPickerView { image in
                    completionImage = image
                    selectedItem    = nil
                }
                .ignoresSafeArea()
            }
        }
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    private func submit() async {
        isSubmitting = true
        submitError  = nil

        let req = SubmitLocTagCompletionRequest(
            locTagId:        tag.id,
            anchorId:        anchor.id,
            operatorName:    "Operator",
            status:          status,
            note:            note.isEmpty ? nil : note,
            completionImage: completionImage
        )

        let client = SIBClient(settings: settings)
        do {
            let completion = try await client.submitLocTagCompletion(locTagId: tag.id, req: req)
            await MainActor.run { onCompleted(completion) }
        } catch {
            await MainActor.run {
                isSubmitting = false
                submitError  = friendlyMessage(for: error)
            }
        }
    }
}
