// GuideEditorView.swift — AR OMS Phase 2
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

// Used by AddStepSheet and EditStepSheet to avoid a race between setting
// `imageSourceType` and `showImagePicker = true` in the same Button action.
// By using sheet(item:) with an enum that carries the source type, SwiftUI
// reads the source type from the presented item itself — no race condition.
private enum ImagePickerSource: Identifiable {
    case camera, library
    var id: Self { self }
    var uiSourceType: UIImagePickerController.SourceType {
        switch self {
        case .camera:  return .camera
        case .library: return .photoLibrary
        }
    }
}

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

    // Add / edit step sheet state
    @State private var showAddStep    = false
    @State private var editingStep:   GuideStep? = nil

    // Phase 2: AR placement flow
    @State private var showScanGate      = false
    @State private var showPlacementView = false

    // 3D models for the anchor — passed into GuideStepPlacementView
    @State private var anchorModels: [Model3D] = []

    // Prevents onAppear from resetting editable fields (name / description /
    // published) on subsequent firings — e.g. when a fullScreenCover closes and
    // SwiftUI re-fires onAppear on the underlying Form.
    @State private var stateLoaded = false

    var isCreating: Bool { guide == nil && activeGuide == nil }
    var currentGuide: ARGuide? { activeGuide ?? guide }

    // Placement summary
    private var placedCount: Int { steps.filter(\.isPlaced).count }
    private var allStepsPlaced: Bool { !steps.isEmpty && steps.allSatisfy(\.isPlaced) }

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
                        .disabled(!allStepsPlaced)
                    } footer: {
                        if steps.isEmpty {
                            Text("Add steps before publishing.")
                        } else if !allStepsPlaced {
                            Text("⚠️ All \(steps.count) step\(steps.count == 1 ? "" : "s") must be placed in AR before publishing. Use \"Place Steps in AR\" below.")
                                .foregroundStyle(.orange)
                        } else {
                            Text("Publish when the guide is ready for Operators.")
                        }
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

                    // ── AR step placement (Phase 2) ────────────────────────────
                    if !steps.isEmpty && !isLoading {
                        Section {
                            Button {
                                showScanGate = true
                            } label: {
                                HStack(spacing: 12) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color.indigo.opacity(0.1))
                                            .frame(width: 36, height: 36)
                                        Image(systemName: "arkit")
                                            .font(.system(size: 16, weight: .semibold))
                                            .foregroundStyle(.indigo)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Place Steps in AR")
                                            .font(.subheadline.bold())
                                            .foregroundStyle(.indigo)
                                        Text("\(placedCount) / \(steps.count) position\(steps.count == 1 ? "" : "s") saved")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                        } footer: {
                            Text("Scan the anchor's QR code to enter AR, then tap surfaces to pin each step's location. Operators navigate to these pins in sequence.")
                        }
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
                // Creation mode: Save creates the draft guide and reveals the step
                // editor inline.  Edit mode: Save button removed (it gave no feedback);
                // Done saves and closes instead (standard iOS modal pattern).
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().scaleEffect(0.8)
                    } else if isCreating {
                        Button("Save") { Task { await save() } }
                            .bold()
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    // Edit mode: no top-right button — Done (left) handles save + dismiss
                }
                ToolbarItem(placement: .cancellationAction) {
                    if isCreating {
                        // Cancel discards the unsaved new guide
                        Button("Cancel") { dismiss() }
                    } else {
                        // Done saves guide metadata then closes
                        Button("Done") { Task { await save(); dismiss() } }
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    EditButton()
                }
            }
            .onAppear {
                if let g = guide {
                    // Only initialise editable fields on the very first appearance.
                    // onAppear fires again whenever a child fullScreenCover closes,
                    // and resetting `published` at that point would silently revert
                    // any toggle change the Author made before entering AR placement.
                    if !stateLoaded {
                        name        = g.name
                        description = g.description
                        published   = g.published
                        stateLoaded = true
                    }
                    // Always reload steps — refreshes isPlaced counts after placement.
                    Task { await loadSteps(guideId: g.id) }
                    // Load anchor model library for integrated step+model placement.
                    if anchorModels.isEmpty {
                        Task {
                            if let m = try? await SIBClient(settings: settings)
                                .fetchModels(anchorId: anchor.id) {
                                anchorModels = m
                            }
                        }
                    }
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
            // ── Phase 2: QR scan gate before AR placement ─────────────────────
            .fullScreenCover(isPresented: $showScanGate) {
                if currentGuide != nil {
                    QRScanGateView(
                        mode: .author,
                        onSessionReady: {
                            showScanGate     = false
                            showPlacementView = true
                        },
                        onCancel: {
                            showScanGate = false
                        }
                    )
                    .environmentObject(settings)
                    .environmentObject(appState)
                    .environmentObject(tour)
                }
            }
            // ── Phase 2: AR step placement view ───────────────────────────────
            // onDismiss reloads steps from the server so the editor always reflects
            // the freshly-saved isPlaced flags — belt-and-suspenders alongside the
            // onAppear reload that SwiftUI fires when a fullScreenCover closes.
            .fullScreenCover(isPresented: $showPlacementView, onDismiss: {
                if let g = currentGuide { Task { await loadSteps(guideId: g.id) } }
            }) {
                if let g = currentGuide {
                    GuideStepPlacementView(guide: g, steps: steps, models: anchorModels) { updatedSteps in
                        steps            = updatedSteps
                        showPlacementView = false
                    }
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
                Text(step.displayTitle)
                    .font(.subheadline.bold())
                    .lineLimit(1)
                Text(step.text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    // AR placement status
                    if step.isPlaced {
                        Label("AR", systemImage: "arkit")
                            .font(.caption2).foregroundStyle(.indigo)
                    } else {
                        Label("Not placed", systemImage: "arkit")
                            .font(.caption2).foregroundStyle(.orange)
                    }
                    if step.mediaPath != nil {
                        Label("Photo", systemImage: "photo")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if step.ttsText != nil {
                        Label("Voice", systemImage: "waveform")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if step.completionRequired {
                        Label("Req.", systemImage: "checkmark.circle")
                            .font(.caption2).foregroundStyle(.orange)
                    }
                    if step.modelId != nil {
                        Label("3D", systemImage: "cube")
                            .font(.caption2).foregroundStyle(.teal)
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

    @State private var stepTitle          = ""
    @State private var text               = ""
    @State private var ttsOverride        = ""
    @State private var useTTSOverride     = false
    @State private var completionRequired = true
    @State private var selectedImage:     UIImage? = nil
    @State private var imagePickerSource: ImagePickerSource? = nil
    @State private var isSaving           = false
    @State private var error:             String? = nil

    // 3D model picker state (Phase 3D — same as EditStepSheet)
    @State private var anchorModels:    [Model3D] = []
    @State private var isLoadingModels  = false
    @State private var selectedModelId: String?   = nil
    @State private var modelScale:      Double    = 1.0
    @State private var modelOpacity:    Double    = 0.45
    @State private var previewModel:    Model3D?  = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Check oil level", text: $stepTitle)
                        .autocorrectionDisabled()
                } header: {
                    Text("Step \(nextSequence) — Title (optional)")
                } footer: {
                    Text("Short label shown on the 3D floating panel header and pilot tab. Defaults to \"Step \(nextSequence)\" when left blank.")
                }

                Section {
                    TextField("Describe what the Operator needs to do…", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Step \(nextSequence) — Description *")
                } footer: {
                    Text("Shown in full when the floating panel is expanded.")
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
                            imagePickerSource = .camera
                        } label: {
                            Label("Take Photo", systemImage: "camera")
                        }
                        Button {
                            imagePickerSource = .library
                        } label: {
                            Label("Choose from Library", systemImage: "photo.on.rectangle")
                        }
                    }
                } header: {
                    Text("Reference Photo (optional)")
                }

                // ── 3D Ghost Model ────────────────────────────────────────────
                Section {
                    if isLoadingModels {
                        HStack {
                            ProgressView().scaleEffect(0.8)
                            Text("Loading models…")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else if anchorModels.filter(\.isReady).isEmpty {
                        Text("No ready models found.\nUpload models in the portal → 3D Models tab (mark as General or assign to this anchor).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Model", selection: $selectedModelId) {
                            Text("None").tag(Optional<String>.none)
                            let generalModels  = anchorModels.filter { $0.isReady && $0.category == "general" }
                            let specificModels = anchorModels.filter { $0.isReady && $0.category != "general" }
                            if !generalModels.isEmpty {
                                Section("General") {
                                    ForEach(generalModels) { model in
                                        Text("\(model.name) (\(model.formatLabel))")
                                            .tag(Optional(model.id))
                                    }
                                }
                            }
                            if !specificModels.isEmpty {
                                Section("Anchor-specific") {
                                    ForEach(specificModels) { model in
                                        Text("\(model.name) (\(model.formatLabel))")
                                            .tag(Optional(model.id))
                                    }
                                }
                            }
                        }
                        .onChange(of: selectedModelId) { newId in
                            // Pre-fill scale from model's saved default scale (set in portal preview)
                            if let id = newId,
                               let m  = anchorModels.first(where: { $0.id == id }),
                               let ds = m.defaultScale {
                                modelScale = ds
                            }
                        }
                        if selectedModelId != nil {
                            let _previewTarget = anchorModels.first { $0.id == selectedModelId }
                            Button {
                                previewModel = _previewTarget
                            } label: {
                                Label("Preview Model", systemImage: "rotate.3d")
                                    .font(.subheadline)
                            }
                            .disabled(_previewTarget?.hasUSDZ != true)
                            if _previewTarget?.hasUSDZ != true {
                                Text("USDZ pending — convert in portal first")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Scale: \(String(format: "%.1f", modelScale))×")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                }
                                Slider(value: $modelScale, in: 0.1...5.0, step: 0.1)
                                    .tint(.indigo)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Opacity: \(Int(modelOpacity * 100))%")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                }
                                Slider(value: $modelOpacity, in: 0.1...1.0, step: 0.05)
                                    .tint(.indigo)
                            }
                        }
                    }
                } header: {
                    Text("3D Ghost Overlay (optional)")
                } footer: {
                    Text("A semi-transparent model displayed at this step's AR position to guide the Operator.")
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
            .sheet(item: $imagePickerSource) { source in
                CameraPickerView(sourceType: source.uiSourceType) { img in
                    selectedImage = img
                }
            }
            .sheet(item: $previewModel) { model in
                ModelPreviewView(model: model)
                    .environmentObject(settings)
            }
            .onAppear {
                Task { await fetchAnchorModels() }
            }
        }
    }

    private func fetchAnchorModels() async {
        isLoadingModels = true
        let client = SIBClient(settings: settings)
        if let models = try? await client.fetchModels(anchorId: guide.anchorId) {
            anchorModels = models
        }
        isLoadingModels = false
    }

    private func addStep() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)
        let req = CreateGuideStepRequest(
            sequenceNumber:     nextSequence,
            title:              stepTitle.trimmingCharacters(in: .whitespaces).isEmpty ? nil : stepTitle.trimmingCharacters(in: .whitespaces),
            text:               text.trimmingCharacters(in: .whitespaces),
            ttsText:            useTTSOverride ? ttsOverride.trimmingCharacters(in: .whitespaces) : nil,
            image:              selectedImage,
            completionRequired: completionRequired
        )
        do {
            let newStep = try await client.createGuideStep(guideId: guide.id, req: req)
            // Patch-after-create: if a model was selected, immediately PATCH the new step
            if let modelId = selectedModelId {
                var patch = UpdateGuideStepRequest()
                patch.modelId      = modelId
                patch.modelScale   = modelScale
                patch.modelOpacity = modelOpacity
                _ = try? await client.updateGuideStep(guideId: guide.id, stepId: newStep.id, req: patch)
            }
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

    @State private var stepTitle          = ""
    @State private var text               = ""
    @State private var ttsOverride        = ""
    @State private var useTTSOverride     = false
    @State private var completionRequired = true
    @State private var isSaving           = false
    @State private var error:             String? = nil

    // Photo editing state
    @State private var fetchedPhoto:    UIImage? = nil  // existing photo from server
    @State private var selectedImage:   UIImage? = nil  // new photo chosen by user
    @State private var shouldClearPhoto = false          // true → send null to server
    @State private var imagePickerSource: ImagePickerSource? = nil

    // 3D model picker state (Phase 3D)
    @State private var anchorModels:    [Model3D] = []
    @State private var isLoadingModels  = false
    @State private var selectedModelId: String?   = nil   // nil = "None"
    @State private var modelScale:      Double    = 1.0
    @State private var modelOpacity:    Double    = 0.45
    @State private var previewModel:    Model3D?  = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Check oil level", text: $stepTitle)
                        .autocorrectionDisabled()
                } header: {
                    Text("Step \(step.sequenceNumber) — Title (optional)")
                } footer: {
                    Text("Short label on the 3D panel header. Defaults to \"Step \(step.sequenceNumber)\" when blank.")
                }

                Section {
                    TextField("Describe what the Operator needs to do…", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Step \(step.sequenceNumber) — Description")
                }

                Section {
                    Toggle("Override voice text", isOn: $useTTSOverride)
                    if useTTSOverride {
                        TextField("Text to speak aloud", text: $ttsOverride, axis: .vertical)
                            .lineLimit(2...4)
                    }
                    Toggle("Mark complete required", isOn: $completionRequired)
                }

                // ── Photo editing ─────────────────────────────────────────────
                Section {
                    if let newImg = selectedImage {
                        // User just picked a replacement photo
                        Image(uiImage: newImg)
                            .resizable().scaledToFill()
                            .frame(height: 140).clipped()
                            .cornerRadius(8)
                        Button("Remove New Photo", role: .destructive) {
                            selectedImage   = nil
                            shouldClearPhoto = false
                        }
                    } else if shouldClearPhoto {
                        Label("Photo will be removed on save", systemImage: "trash")
                            .font(.caption).foregroundStyle(.orange)
                        Button("Keep Existing Photo") { shouldClearPhoto = false }
                            .foregroundStyle(.indigo)
                    } else if let existing = fetchedPhoto {
                        // Show existing photo with Replace / Remove options
                        Image(uiImage: existing)
                            .resizable().scaledToFill()
                            .frame(height: 120).clipped()
                            .cornerRadius(8)
                        HStack {
                            Button {
                                imagePickerSource = .camera
                            } label: {
                                Label("Replace (Camera)", systemImage: "camera")
                            }
                            Spacer()
                            Button {
                                imagePickerSource = .library
                            } label: {
                                Label("Replace (Library)", systemImage: "photo.on.rectangle")
                            }
                        }
                        Button("Remove Photo", role: .destructive) {
                            shouldClearPhoto = true
                        }
                    } else {
                        // No existing photo
                        Button {
                            imagePickerSource = .camera
                        } label: {
                            Label("Take Photo", systemImage: "camera")
                        }
                        Button {
                            imagePickerSource = .library
                        } label: {
                            Label("Choose from Library", systemImage: "photo.on.rectangle")
                        }
                    }
                } header: {
                    Text("Reference Photo")
                } footer: {
                    Text("Shown in the floating panel during the Operator's AR session.")
                }

                // ── 3D Ghost Model ────────────────────────────────────────────
                Section {
                    if isLoadingModels {
                        HStack {
                            ProgressView().scaleEffect(0.8)
                            Text("Loading models…")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else if anchorModels.filter(\.isReady).isEmpty {
                        Text("No ready models found.\nUpload models in the portal → 3D Models tab (mark as General or assign to this anchor).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Model", selection: $selectedModelId) {
                            Text("None").tag(Optional<String>.none)
                            let generalModels  = anchorModels.filter { $0.isReady && $0.category == "general" }
                            let specificModels = anchorModels.filter { $0.isReady && $0.category != "general" }
                            if !generalModels.isEmpty {
                                Section("General") {
                                    ForEach(generalModels) { model in
                                        Text("\(model.name) (\(model.formatLabel))")
                                            .tag(Optional(model.id))
                                    }
                                }
                            }
                            if !specificModels.isEmpty {
                                Section("Anchor-specific") {
                                    ForEach(specificModels) { model in
                                        Text("\(model.name) (\(model.formatLabel))")
                                            .tag(Optional(model.id))
                                    }
                                }
                            }
                        }
                        .onChange(of: selectedModelId) { newId in
                            // Pre-fill scale from model's saved default scale (set in portal preview)
                            if let id = newId,
                               let m  = anchorModels.first(where: { $0.id == id }),
                               let ds = m.defaultScale {
                                modelScale = ds
                            }
                        }
                        if selectedModelId != nil {
                            let _previewTarget = anchorModels.first { $0.id == selectedModelId }
                            Button {
                                previewModel = _previewTarget
                            } label: {
                                Label("Preview Model", systemImage: "rotate.3d")
                                    .font(.subheadline)
                            }
                            .disabled(_previewTarget?.hasUSDZ != true)
                            if _previewTarget?.hasUSDZ != true {
                                Text("USDZ pending — convert in portal first")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Scale: \(String(format: "%.1f", modelScale))×")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                }
                                Slider(value: $modelScale, in: 0.1...5.0, step: 0.1)
                                    .tint(.indigo)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Opacity: \(Int(modelOpacity * 100))%")
                                        .font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                }
                                Slider(value: $modelOpacity, in: 0.1...1.0, step: 0.05)
                                    .tint(.indigo)
                            }
                        }
                    }
                } header: {
                    Text("3D Ghost Overlay (optional)")
                } footer: {
                    Text("Model position is set when you place the step pin in AR — tap \"Place Steps in AR\" in the guide editor and position the model after each pin drop.")
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
            .sheet(item: $imagePickerSource) { source in
                CameraPickerView(sourceType: source.uiSourceType) { img in
                    selectedImage    = img
                    shouldClearPhoto = false
                }
            }
            .sheet(item: $previewModel) { model in
                ModelPreviewView(model: model)
                    .environmentObject(settings)
            }
            .onAppear {
                stepTitle          = step.title ?? ""
                text               = step.text
                useTTSOverride     = step.ttsText != nil
                ttsOverride        = step.ttsText ?? ""
                completionRequired = step.completionRequired
                // 3D model: pre-populate from step
                selectedModelId    = step.modelId
                modelScale         = step.modelScale     ?? 1.0
                modelOpacity       = step.modelOpacity   ?? 0.45
                // Fetch existing photo and anchor model library in parallel
                Task {
                    await withTaskGroup(of: Void.self) { group in
                        if step.mediaPath != nil { group.addTask { await fetchExistingPhoto() } }
                        group.addTask { await fetchAnchorModels() }
                    }
                }
            }
        }
    }

    private func fetchExistingPhoto() async {
        guard let filename = step.mediaPath else { return }
        let client = SIBClient(settings: settings)
        if let data = try? await client.fetchGuideStepImage(filename: filename) {
            fetchedPhoto = UIImage(data: data)
        }
    }

    private func fetchAnchorModels() async {
        isLoadingModels = true
        let client = SIBClient(settings: settings)
        if let models = try? await client.fetchModels(anchorId: guide.anchorId) {
            anchorModels = models
        }
        isLoadingModels = false
    }

    private func saveStep() async {
        isSaving = true
        error    = nil
        let client = SIBClient(settings: settings)

        // Use no-arg convenience init — preserves synthesized memberwise init
        // (partial memberwise calls won't compile; no-arg + property assignment is the pattern)
        var req = UpdateGuideStepRequest()
        let trimmedTitle       = stepTitle.trimmingCharacters(in: .whitespaces)
        req.title              = trimmedTitle.isEmpty ? "" : trimmedTitle   // "" clears, non-empty sets
        req.text               = text.trimmingCharacters(in: .whitespaces)
        req.ttsText            = useTTSOverride ? ttsOverride.trimmingCharacters(in: .whitespaces) : nil
        req.completionRequired = completionRequired

        // Media update logic:
        //   ""      (empty string sentinel) → server interprets as "clear existing photo"
        //   base64  (non-empty string)      → server saves new photo
        //   nil key absent from JSON        → server keeps existing (encodeIfPresent omits nil)
        if shouldClearPhoto {
            req.mediaBase64 = ""    // sentinel: empty string → clear on server
        } else if let img = selectedImage {
            req.mediaBase64 = img.jpegData(compressionQuality: 0.65)?.base64EncodedString()
        }
        // else: req.mediaBase64 stays nil → key omitted from JSON → server keeps existing

        // 3D model assignment (only send fields when a model is selected)
        req.modelId      = selectedModelId            // nil → key absent → server keeps existing
        if selectedModelId != nil {
            req.modelScale   = modelScale
            req.modelOpacity = modelOpacity
        }

        do {
            _ = try await client.updateGuideStep(guideId: guide.id, stepId: step.id, req: req)
            dismiss()
        } catch {
            self.error = friendlyMessage(for: error)
        }
        isSaving = false
    }
}
