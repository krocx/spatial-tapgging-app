// GuideEditorView.swift — AR OMS Phase 1
//
// Author-only form for creating and editing an AR Guide.
//
// Creating (guide == nil):
//   • Name + description fields.
//   • Save creates the Guide (as draft), then reveals the step editor inline.
//
// Editing (guide != nil):
//   • Pre-populated name, description, and live published toggle.
//   • Steps list loaded from server; drag to reorder, swipe to delete.
//   • "Add Step" button appends a new step.
//   • Each step shows a StepEditorRow with text, TTS toggle, and photo.
//   • Save patches the guide record.
//
// All network operations are async — errors surface as in-view banners.

import SwiftUI
import AVFoundation

struct GuideEditorView: View {

    let anchor:  Anchor
    let guide:   ARGuide?    // nil when creating

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager
    @Environment(\.dismiss) private var dismiss

    // Guide fields
    @State private var name        = ""
    @State private var description = ""
    @State private var published   = false

    // Steps
    @State private var steps:      [GuideStep] = []
    @State private var isLoading   = false
    @State private var isSaving    = false
    @State private var error:      String? = nil

    // Active guide (set after creation so steps can be added to it)
    @State private var activeGuide: ARGuide? = nil

    // Add-step sheet state
    @State private var showAddStep    = false
    @State private var editingStep:   GuideStep? = nil

    var isCreating: Bool { guide == nil && activeGuide == nil }
    var currentGuide: ARGuide? { activeGuide ?? guide }

    var body: some View {
        NavigationStack {
            Form {
                // ── Guide details ─────────────────────────────────────────────
                Section {
                    HStack {
                        Image(systemName: "list.bullet.clipboard")
                            .foregroundStyle(.indigo).frame(width: 22)
                        TextField("Guide name", text: $name)
                            .autocorrectionDisabled()
                    }
                    HStack(alignment: .top) {
                        Image(systemName: "text.alignleft")
                            .foregroundStyle(.secondary).frame(width: 22).padding(.top, 3)
                        TextField("Description (optional)", text: $description, axis: .vertical)
                            .lineLimit(2...4)
                    }
                } header: {
                    Text("Guide Details")
                }

                // ── Published toggle (only once guide exists) ─────────────────
                if currentGuide != nil {
                    Section {
                        Toggle(isOn: $published) {
                            Label(published ? "Live — visible to Operators" : "Draft — Authors only",
                                  systemImage: published ? "checkmark.circle.fill" : "pencil.circle")
                                .foregroundStyle(published ? .green : .orange)
                        }
                        .tint(.green)
                    } footer: {
                        Text("Publish when all steps are complete and the guide is ready for Operators.")
                    }

                    // ── Steps ─────────────────────────────────────────────────
                    Section {
                        if isLoading {
                            HStack { Spacer(); ProgressView("Loading steps…"); Spacer() }
                        } else if steps.isEmpty {
                            Label("No steps yet — tap Add Step below.", systemImage: "info.circle")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            ForEach(steps) { step in
                                StepEditorRow(
                                    step:    step,
                                    onEdit:  { editingStep = step },
                                    onDelete: {
                                        Task { await deleteStep(step) }
                                    }
                                )
                            }
                            .onMove { from, to in moveSteps(from: from, to: to) }
                        }

                        Button {
                            showAddStep = true
                        } label: {
                            Label("Add Step", systemImage: "plus.circle.fill")
                                .foregroundStyle(.indigo)
                        }
                        .disabled(currentGuide == nil)
                    } header: {
                        HStack {
                            Text("Steps")
                            Spacer()
                            Text("\(steps.count) step\(steps.count == 1 ? "" : "s")")
                                .foregroundStyle(.secondary)
                        }
                    } footer: {
                        Text("Drag ≡ to reorder. Steps are shown in sequence to the Operator during the AR session.")
                    }
                }

                // ── Error banner ──────────────────────────────────────────────
                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isCreating ? "New Guide" : "Edit Guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Save") { Task { await save() } }
                            .bold()
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .bottomBar) {
                    EditButton()
                }
            }
            .onAppear {
                if let g = guide {
                    name        = g.name
                    description = g.description
                    published   = g.published
                    Task { await loadSteps(guideId: g.id) }
                }
            }
            // ── Add step sheet ────────────────────────────────────────────────
            .sheet(isPresented: $showAddStep, onDismiss: {
                if let g = currentGuide { Task { await loadSteps(guideId: g.id) } }
            }) {
                if let g = currentGuide {
                    AddStepSheet(guide: g, nextSequence: steps.count + 1)
                        .environmentObject(settings)
                }
            }
            // ── Edit step sheet ───────────────────────────────────────────────
            .sheet(item: $editingStep, onDismiss: {
                if let g = currentGuide { Task { await loadSteps(guideId: g.id) } }
            }) { step in
                if let g = currentGuide {
                    EditStepSheet(guide: g, step: step)
                        .environmentObject(settings)
                }
            }
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private func save() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)
        do {
            if let existing = currentGuide {
                // Update existing guide
                let req = UpdateARGuideRequest(
                    name:        name.trimmingCharacters(in: .whitespaces),
                    description: description.trimmingCharacters(in: .whitespaces),
                    published:   published
                )
                let updated = try await client.updateGuide(id: existing.id, req: req)
                activeGuide = updated
            } else {
                // Create new guide
                let req = CreateARGuideRequest(
                    anchorId:    anchor.id,
                    name:        name.trimmingCharacters(in: .whitespaces),
                    description: description.trimmingCharacters(in: .whitespaces),
                    createdBy:   settings.authorName
                )
                let created = try await client.createGuide(req)
                activeGuide = created
                published   = false   // new guides always start as draft
            }
        } catch {
            self.error = friendlyMessage(for: error)
        }
        isSaving = false
    }

    private func loadSteps(guideId: String) async {
        isLoading = true
        let client = SIBClient(settings: settings)
        do {
            steps = try await client.fetchGuideSteps(guideId: guideId)
        } catch {
            self.error = "Couldn't load steps: \(friendlyMessage(for: error))"
        }
        isLoading = false
    }

    private func deleteStep(_ step: GuideStep) async {
        guard let g = currentGuide else { return }
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteGuideStep(guideId: g.id, stepId: step.id)
            steps.removeAll { $0.id == step.id }
            // Re-sequence locally (server keeps original sequenceNumbers; reorder on next load)
        } catch {
            self.error = "Delete failed: \(friendlyMessage(for: error))"
        }
    }

    private func moveSteps(from source: IndexSet, to destination: Int) {
        steps.move(fromOffsets: source, toOffset: destination)
        // Persist new order: patch each moved step's sequenceNumber
        guard let g = currentGuide else { return }
        let client = SIBClient(settings: settings)
        Task {
            for (idx, step) in steps.enumerated() {
                let newSeq = idx + 1
                if step.sequenceNumber != newSeq {
                    let req = UpdateGuideStepRequest(sequenceNumber: newSeq)
                    _ = try? await client.updateGuideStep(
                        guideId: g.id, stepId: step.id, req: req
                    )
                }
            }
        }
    }
}

// ── Step editor row (inside the guide form) ───────────────────────────────────

struct StepEditorRow: View {
    let step:     GuideStep
    let onEdit:   () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Sequence badge
            ZStack {
                Circle()
                    .fill(Color.indigo.opacity(0.12))
                    .frame(width: 32, height: 32)
                Text("\(step.sequenceNumber)")
                    .font(.caption.bold())
                    .foregroundStyle(.indigo)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(step.text)
                    .font(.subheadline)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if step.mediaPath != nil {
                        Label("Photo", systemImage: "photo")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if step.ttsText != nil || step.completionRequired {
                        Label("Voice", systemImage: "waveform")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if step.completionRequired {
                        Label("Req.", systemImage: "checkmark.circle")
                            .font(.caption2).foregroundStyle(.orange)
                    }
                }
            }

            Spacer()

            Button(action: onEdit) {
                Image(systemName: "pencil.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(.indigo.opacity(0.7))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 2)
    }
}

// ── Add Step sheet ────────────────────────────────────────────────────────────

struct AddStepSheet: View {
    let guide:        ARGuide
    let nextSequence: Int

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var text               = ""
    @State private var ttsOverride        = ""
    @State private var useTTSOverride     = false
    @State private var completionRequired = true
    @State private var selectedImage:     UIImage? = nil
    @State private var showImagePicker    = false
    @State private var imageSourceType:   UIImagePickerController.SourceType = .photoLibrary
    @State private var isSaving           = false
    @State private var error:             String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Step instruction", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Step \(nextSequence) — Instruction *")
                } footer: {
                    Text("This text appears in the floating panel during the AR session.")
                }

                Section {
                    Toggle("Override voice text", isOn: $useTTSOverride)
                    if useTTSOverride {
                        TextField("Text to speak aloud", text: $ttsOverride, axis: .vertical)
                            .lineLimit(2...4)
                    }
                    Toggle("Mark complete required", isOn: $completionRequired)
                } header: {
                    Text("Options")
                } footer: {
                    Text("When 'Mark complete required' is on, the Operator must tap ✓ before advancing to the next step.")
                }

                Section {
                    if let img = selectedImage {
                        Image(uiImage: img)
                            .resizable().scaledToFill()
                            .frame(height: 140).clipped()
                            .cornerRadius(8)
                        Button("Remove Photo", role: .destructive) { selectedImage = nil }
                    } else {
                        Button {
                            imageSourceType = .camera
                            showImagePicker = true
                        } label: {
                            Label("Take Photo", systemImage: "camera")
                        }
                        Button {
                            imageSourceType = .photoLibrary
                            showImagePicker = true
                        } label: {
                            Label("Choose from Library", systemImage: "photo.on.rectangle")
                        }
                    }
                } header: {
                    Text("Reference Photo (optional)")
                }

                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Add Step")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Add") { Task { await addStep() } }
                            .bold()
                            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .sheet(isPresented: $showImagePicker) {
                CameraPickerView(sourceType: imageSourceType) { img in
                    selectedImage = img
                }
            }
        }
    }

    private func addStep() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)
        let req = CreateGuideStepRequest(
            sequenceNumber:     nextSequence,
            text:               text.trimmingCharacters(in: .whitespaces),
            ttsText:            useTTSOverride ? ttsOverride.trimmingCharacters(in: .whitespaces) : nil,
            image:              selectedImage,
            completionRequired: completionRequired
        )
        do {
            _ = try await client.createGuideStep(guideId: guide.id, req: req)
            dismiss()
        } catch {
            self.error = friendlyMessage(for: error)
        }
        isSaving = false
    }
}

// ── Edit Step sheet ───────────────────────────────────────────────────────────

struct EditStepSheet: View {
    let guide: ARGuide
    let step:  GuideStep

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var text               = ""
    @State private var ttsOverride        = ""
    @State private var useTTSOverride     = false
    @State private var completionRequired = true
    @State private var isSaving           = false
    @State private var error:             String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Step instruction", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Step \(step.sequenceNumber) — Instruction")
                }

                Section {
                    Toggle("Override voice text", isOn: $useTTSOverride)
                    if useTTSOverride {
                        TextField("Text to speak aloud", text: $ttsOverride, axis: .vertical)
                            .lineLimit(2...4)
                    }
                    Toggle("Mark complete required", isOn: $completionRequired)
                }

                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit Step \(step.sequenceNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Save") { Task { await saveStep() } }
                            .bold()
                            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                text               = step.text
                useTTSOverride     = step.ttsText != nil
                ttsOverride        = step.ttsText ?? ""
                completionRequired = step.completionRequired
            }
        }
    }

    private func saveStep() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)
        let req = UpdateGuideStepRequest(
            text:               text.trimmingCharacters(in: .whitespaces),
            ttsText:            useTTSOverride ? ttsOverride.trimmingCharacters(in: .whitespaces) : nil,
            completionRequired: completionRequired
        )
        do {
            _ = try await client.updateGuideStep(guideId: guide.id, stepId: step.id, req: req)
            dismiss()
        } catch {
            self.error = friendlyMessage(for: error)
        }
        isSaving = false
    }
}
