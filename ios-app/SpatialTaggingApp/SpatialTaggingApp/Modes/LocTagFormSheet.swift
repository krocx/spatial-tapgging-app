// LocTagFormSheet.swift — Phase 2 (Task E)
// Form sheet presented by LocTagAuthorView after a surface tap.
// Collects issue details, submits to SIB POST /loc-tags, and calls onSaved with the result.

import SwiftUI
import PhotosUI

struct LocTagFormSheet: View {

    let anchor:    Anchor
    let position:  SIBVector3
    let nextOrder: Int
    let onSaved:   (LocTag) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    // ── Form fields ───────────────────────────────────────────────────────────
    @State private var title          = ""
    @State private var description    = ""
    @State private var severity:        Severity?      = nil
    @State private var defectCategory: DefectCategory = .others
    @State private var categoryNote   = ""

    // ── Photo ─────────────────────────────────────────────────────────────────
    @State private var selectedItem:   PhotosPickerItem? = nil
    @State private var referenceImage: UIImage?          = nil
    @State private var showCamera                        = false

    // ── Submission ────────────────────────────────────────────────────────────
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    /// Becomes true once the title field has been focused then left empty,
    /// so the inline error only appears after the user has had a chance to type.
    @State private var titleTouched  = false
    @FocusState private var titleFocused: Bool

    private var isValid: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {

                // ── Issue details ──────────────────────────────────────────────
                Section {
                    // Title row — red asterisk visible while empty
                    HStack(spacing: 6) {
                        TextField("Enter issue title", text: $title)
                            .focused($titleFocused)
                            .onChange(of: titleFocused) { focused in
                                if !focused { titleTouched = true }
                            }
                        if title.trimmingCharacters(in: .whitespaces).isEmpty {
                            Text("*")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(.red)
                        }
                    }

                    // Inline error — surfaces after first interaction
                    if titleTouched && title.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text("Required — enter an issue title")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(3, reservesSpace: true)
                } header: {
                    HStack {
                        Text("Issue Details")
                        Spacer()
                        HStack(spacing: 3) {
                            Text("*").bold().foregroundStyle(.red)
                            Text("Required")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
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

                    // Note field only for "Others"
                    if defectCategory == .others {
                        TextField("Category note (optional)", text: $categoryNote)
                    }
                }

                // ── Reference photo ────────────────────────────────────────────
                Section("Reference Photo") {
                    // Thumbnail + remove when a photo is attached
                    if let image = referenceImage {
                        HStack {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Spacer()
                            Button(role: .destructive) {
                                referenceImage = nil
                                selectedItem   = nil
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }

                    // Take photo — primary action while walking the space
                    Button {
                        showCamera = true
                    } label: {
                        Label(
                            referenceImage == nil ? "Take Photo" : "Retake Photo",
                            systemImage: "camera"
                        )
                    }

                    // Choose from library — secondary / fallback
                    PhotosPicker(selection: $selectedItem, matching: .images) {
                        Label(
                            referenceImage == nil ? "Choose from Library" : "Replace from Library",
                            systemImage: "photo.on.rectangle"
                        )
                    }
                    .onChange(of: selectedItem) { item in
                        Task {
                            if let data = try? await item?.loadTransferable(type: Data.self),
                               let img  = UIImage(data: data) {
                                referenceImage = img
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
            .navigationTitle("Tag Issue")
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
            // Camera sheet — fullScreenCover so it can use the full screen
            .fullScreenCover(isPresented: $showCamera) {
                CameraPickerView { image in
                    referenceImage = image
                    selectedItem   = nil   // clear any library selection
                }
                .ignoresSafeArea()
            }
        }
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    private func submit() async {
        isSubmitting = true
        submitError  = nil

        let req = CreateLocTagRequest(
            anchorId:           anchor.id,
            title:              title.trimmingCharacters(in: .whitespaces),
            description:        description.trimmingCharacters(in: .whitespaces),
            severity:           severity,
            defectCategory:     defectCategory,
            defectCategoryNote: categoryNote.isEmpty ? nil : categoryNote,
            position:           position,
            order:              nextOrder,
            referenceImage:     referenceImage
        )

        let client = SIBClient(settings: settings)
        do {
            let locTag = try await client.createLocTag(req)
            await MainActor.run { onSaved(locTag) }
        } catch {
            await MainActor.run {
                isSubmitting = false
                submitError  = friendlyMessage(for: error)
            }
        }
    }
}

// CameraPickerView is defined in Components/CameraPickerView.swift
