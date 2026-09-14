// LocTagFormSheet.swift — Phase 2 (Task E) · G4 (2026.4.46)
// Form sheet presented by LocTagAuthorView after a surface tap.
//
// G4: the finding is logged the way Corporate Quality's Gemba Audit tool did
// it — pick a Focus Area, pick one of its pre-defined Questions, choose a
// Finding Category (Strength / OFI / NC) and an optional risk rating, then
// attach up to six photos, each with a caption. Nothing is typed that could
// be picked. When the Audit Reference Library is empty or unreachable the
// sheet falls back to the legacy free-text finding (title + defect category)
// so a walk never blocks on the server.
//
// Submits to SIB POST /loc-tags and calls onSaved with the result.

import SwiftUI
import PhotosUI
import PencilKit

struct LocTagFormSheet: View {

    let anchor:    Anchor
    let position:  SIBVector3
    let nextOrder: Int
    /// G2: the walk session this finding belongs to (nil = no header).
    var walkId:    String? = nil
    let onSaved:   (LocTag) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = GembaLibraryStore.shared

    /// The auditor usually works one focus area at a time — remember it.
    @AppStorage("gemba_last_focus_area") private var lastFocusAreaCode = ""

    // ── Reference-list finding ────────────────────────────────────────────────
    @State private var focusArea: GembaFocusArea?  = nil
    @State private var question:  GembaQuestion?   = nil
    @State private var category:  GembaFindingCategory? = nil
    @State private var risk:      GembaRiskRating? = nil
    @State private var useLegacy = false            // library empty → free text

    // ── Legacy / shared fields ────────────────────────────────────────────────
    @State private var title          = ""
    @State private var description    = ""
    @State private var severity:        Severity?      = nil
    @State private var defectCategory: DefectCategory = .others
    @State private var categoryNote   = ""
    @State private var titleTouched  = false
    @FocusState private var titleFocused: Bool

    // ── Photos ────────────────────────────────────────────────────────────────
    struct DraftPhoto: Identifiable {
        let id = UUID()
        var image: UIImage
        var caption: String = ""
        /// G5: flattened markup copy + the strokes (for re-editing).
        var markup: UIImage? = nil
        var drawing: PKDrawing? = nil
    }
    @State private var photos: [DraftPhoto] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var markingUp: DraftPhoto? = nil

    // ── Submission ────────────────────────────────────────────────────────────
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    private var referenceMode: Bool { !useLegacy && !store.isEmpty }

    private var isValid: Bool {
        if referenceMode { return question != nil && category != nil }
        return !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if referenceMode { referenceSections } else { legacySections }
                photoSection
                if let err = submitError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red).font(.caption)
                    }
                }
                if !store.isEmpty {
                    Section {
                        Toggle("Free-text finding (no reference question)", isOn: $useLegacy)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle(referenceMode ? "Log Finding" : "Tag Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else {
                        Button("Save") { Task { await submit() } }
                            .disabled(!isValid || isSubmitting)
                            .fontWeight(.semibold)
                    }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPickerView { image in addPhoto(image) }
                    .ignoresSafeArea()
            }
            .task {
                await store.refresh(settings: settings)
                // Pre-select the focus area from the last finding on this device.
                if focusArea == nil, !lastFocusAreaCode.isEmpty,
                   let fa = store.library.focusAreas.first(where: { $0.code == lastFocusAreaCode }) {
                    focusArea = fa
                }
            }
            .onChange(of: pickerItems) { items in
                guard !items.isEmpty else { return }
                Task {
                    for item in items {
                        if photos.count >= locTagMaxPhotos { break }
                        if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                            addPhoto(img)
                        }
                    }
                    pickerItems = []
                }
            }
        }
    }

    // ── Reference-list sections ───────────────────────────────────────────────

    @ViewBuilder
    private var referenceSections: some View {
        Section {
            NavigationLink {
                FocusAreaPicker(areas: store.library.focusAreas, selected: focusArea) { fa in
                    if fa.id != focusArea?.id { question = nil }
                    focusArea = fa
                    lastFocusAreaCode = fa.code
                }
            } label: {
                LabeledContent("Focus Area") {
                    Text(focusArea.map { $0.displayName } ?? "Select…")
                        .foregroundStyle(focusArea == nil ? .secondary : .primary)
                        .lineLimit(1)
                }
            }

            NavigationLink {
                if let fa = focusArea {
                    QuestionPicker(area: fa, selected: question) { q in question = q }
                }
            } label: {
                LabeledContent("Question") {
                    Text(question.map { "\($0.code) — \($0.title)" } ?? (focusArea == nil ? "Pick a focus area first" : "Select…"))
                        .foregroundStyle(question == nil ? .secondary : .primary)
                        .lineLimit(1)
                }
            }
            .disabled(focusArea == nil || focusArea?.questions.isEmpty == true)

            if let q = question {
                Text(q.text)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 2)
            } else if let fa = focusArea, fa.questions.isEmpty {
                Text("This focus area has no questions yet — ask Corporate Quality to add them in the portal, or switch to a free-text finding below.")
                    .font(.caption).foregroundStyle(.orange)
            }
        } header: {
            HStack {
                Text("Audit Reference")
                Spacer()
                if store.isLoading { ProgressView().controlSize(.mini) }
                else if store.lastError != nil { Text("offline · cached").font(.caption2).foregroundStyle(.secondary) }
            }
        }

        Section("Finding") {
            Picker("Category", selection: $category) {
                Text("—").tag(Optional<GembaFindingCategory>.none)
                ForEach(GembaFindingCategory.allCases) { c in
                    Text(c.displayName).tag(Optional(c))
                }
            }
            .pickerStyle(.segmented)
            if let c = category {
                Text(c.longName).font(.caption).foregroundStyle(.secondary)
            }

            Picker("Preliminary risk", selection: $risk) {
                Text("Not rated").tag(Optional<GembaRiskRating>.none)
                ForEach(GembaRiskRating.allCases) { r in Text(r.displayName).tag(Optional(r)) }
            }

            TextField("Notes (optional)", text: $description, axis: .vertical)
                .lineLimit(2...4)
        }
    }

    // ── Legacy sections (library unavailable) ─────────────────────────────────

    @ViewBuilder
    private var legacySections: some View {
        Section {
            HStack(spacing: 6) {
                TextField("Enter issue title", text: $title)
                    .focused($titleFocused)
                    .onChange(of: titleFocused) { focused in if !focused { titleTouched = true } }
                if title.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("*").font(.system(size: 17, weight: .bold)).foregroundStyle(.red)
                }
            }
            if titleTouched && title.trimmingCharacters(in: .whitespaces).isEmpty {
                Text("Required — enter an issue title").font(.caption).foregroundStyle(.red)
            }
            TextField("Description (optional)", text: $description, axis: .vertical)
                .lineLimit(3, reservesSpace: true)
        } header: {
            HStack {
                Text("Issue Details")
                Spacer()
                HStack(spacing: 3) { Text("*").bold().foregroundStyle(.red); Text("Required") }
                    .font(.caption).foregroundStyle(.secondary)
            }
        } footer: {
            if store.isEmpty {
                Text("No Audit Reference Library on this server yet — findings are free text. Corporate Quality can import the lists under Portal › GembaWalks › Audit Library.")
            }
        }

        Section("Classification") {
            Picker("Severity", selection: $severity) {
                Text("Not set").tag(Optional<Severity>.none)
                ForEach(Severity.allCases) { s in Text(s.displayName).tag(Optional(s)) }
            }
            Picker("Defect Category", selection: $defectCategory) {
                ForEach(DefectCategory.allCases) { cat in Text(cat.displayName).tag(cat) }
            }
            if defectCategory == .others {
                TextField("Category note (optional)", text: $categoryNote)
            }
        }
    }

    // ── Photos ────────────────────────────────────────────────────────────────

    private var photoSection: some View {
        Section {
            ForEach($photos) { $p in
                HStack(alignment: .top, spacing: 10) {
                    Button { markingUp = p } label: {
                        Image(uiImage: p.markup ?? p.image)
                            .resizable().scaledToFill()
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: p.markup == nil ? "pencil.tip.crop.circle" : "pencil.tip.crop.circle.fill")
                                    .font(.caption).foregroundStyle(.white)
                                    .padding(3).background(.orange, in: Circle()).offset(x: 4, y: 4)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(p.markup == nil ? "Mark up photo" : "Edit markup")
                    TextField("Area identifier · issue description", text: $p.caption, axis: .vertical)
                        .lineLimit(1...3)
                        .font(.subheadline)
                    Button(role: .destructive) {
                        photos.removeAll { $0.id == p.id }
                    } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                }
            }
            .onMove { photos.move(fromOffsets: $0, toOffset: $1) }

            if photos.count < locTagMaxPhotos {
                Button { showCamera = true } label: {
                    Label(photos.isEmpty ? "Take Photo" : "Take Another", systemImage: "camera")
                }
                PhotosPicker(selection: $pickerItems, maxSelectionCount: locTagMaxPhotos - photos.count, matching: .images) {
                    Label("Choose from Library", systemImage: "photo.on.rectangle")
                }
            }
        } header: {
            HStack {
                Text("Photos")
                Spacer()
                Text("\(photos.count)/\(locTagMaxPhotos)").font(.caption).foregroundStyle(.secondary)
            }
        } footer: {
            if photos.isEmpty { Text("Optional, but a photo with a short caption is what the reviewer sees first.") }
            else { Text("Tap a thumbnail to circle or mark the issue on the photo.") }
        }
        .fullScreenCover(item: $markingUp) { draft in
            PhotoMarkupView(image: draft.image, existing: draft.drawing) { flattened, drawing in
                if let i = photos.firstIndex(where: { $0.id == draft.id }) {
                    photos[i].markup  = drawing.strokes.isEmpty ? nil : flattened
                    photos[i].drawing = drawing.strokes.isEmpty ? nil : drawing
                }
            }
        }
    }

    private func addPhoto(_ image: UIImage) {
        guard photos.count < locTagMaxPhotos else { return }
        photos.append(DraftPhoto(image: image))
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    private func submit() async {
        isSubmitting = true
        submitError  = nil

        let req: CreateLocTagRequest
        if referenceMode, let q = question {
            req = CreateLocTagRequest(
                anchorId:        anchor.id,
                title:           "\(q.code) — \(q.title)",
                description:     description.trimmingCharacters(in: .whitespacesAndNewlines),
                severity:        nil,
                defectCategory:  .others,
                position:        position,
                order:           nextOrder,
                questionCode:    q.code,
                findingCategory: category,
                riskRating:      risk,
                photos:          photos.map { (image: $0.image, caption: Optional($0.caption)) },
                walkId:          walkId
            )
        } else {
            req = CreateLocTagRequest(
                anchorId:           anchor.id,
                title:              title.trimmingCharacters(in: .whitespaces),
                description:        description.trimmingCharacters(in: .whitespacesAndNewlines),
                severity:           severity,
                defectCategory:     defectCategory,
                defectCategoryNote: categoryNote.isEmpty ? nil : categoryNote,
                position:           position,
                order:              nextOrder,
                photos:             photos.map { (image: $0.image, caption: Optional($0.caption)) },
                walkId:             walkId
            )
        }

        AppLog.info("gemba", "finding save", ["question": req.questionCode ?? "-", "category": req.findingCategory?.rawValue ?? "-",
                                              "photos": photos.count, "order": nextOrder])
        let client = SIBClient(settings: settings)
        do {
            var locTag = try await client.createLocTag(req)
            // G5: markups ride after the finding exists — one PUT per marked photo,
            // matched by upload order. A failed markup never loses the finding.
            let stored = locTag.photos ?? []
            for (i, draft) in photos.enumerated() where draft.markup != nil && i < stored.count {
                if let b64 = draft.markup?.jpegData(compressionQuality: 0.7)?.base64EncodedString() {
                    do { locTag = try await client.uploadLocTagMarkup(id: locTag.id, filename: stored[i].path, jpegBase64: b64) }
                    catch { AppLog.warn("gemba", "markup upload failed: \(friendlyMessage(for: error))") }
                }
            }
            let saved = locTag
            await MainActor.run { onSaved(saved) }
        } catch {
            await MainActor.run {
                isSubmitting = false
                submitError  = friendlyMessage(for: error)
            }
        }
    }
}

// ── Pickers ───────────────────────────────────────────────────────────────────

/// Numbered focus areas, searchable by code or title.
struct FocusAreaPicker: View {
    let areas: [GembaFocusArea]
    let selected: GembaFocusArea?
    let onPick: (GembaFocusArea) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [GembaFocusArea] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return areas }
        return areas.filter { $0.code.lowercased().contains(q) || $0.title.lowercased().contains(q)
            || $0.questions.contains { $0.code.lowercased().contains(q) || $0.title.lowercased().contains(q) } }
    }

    var body: some View {
        List(filtered) { fa in
            Button {
                onPick(fa); dismiss()
            } label: {
                HStack(spacing: 12) {
                    Text(fa.code)
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                        .frame(minWidth: 34, alignment: .trailing)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(fa.title).foregroundStyle(.primary)
                        Text("\(fa.questions.count) question\(fa.questions.count == 1 ? "" : "s")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if fa.id == selected?.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                }
            }
        }
        .searchable(text: $query, prompt: "Code or name")
        .navigationTitle("Focus Area")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Questions under one focus area — code, title and the prompt itself.
struct QuestionPicker: View {
    let area: GembaFocusArea
    let selected: GembaQuestion?
    let onPick: (GembaQuestion) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [GembaQuestion] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return area.questions }
        return area.questions.filter { $0.code.lowercased().contains(q) || $0.title.lowercased().contains(q) || $0.text.lowercased().contains(q) }
    }

    var body: some View {
        List(filtered) { q in
            Button {
                onPick(q); dismiss()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(q.title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                        Spacer()
                        Text(q.code).font(.caption.monospaced()).foregroundStyle(.secondary)
                        if q.id == selected?.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                    Text(q.text).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                }
                .padding(.vertical, 2)
            }
        }
        .searchable(text: $query, prompt: "Search questions")
        .navigationTitle("\(area.code) — \(area.title)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// CameraPickerView is defined in Components/CameraPickerView.swift
