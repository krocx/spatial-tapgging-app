// AddTagSheet.swift — Phase 3
// Compact dark bottom sheet for creating a new tag after AR tap-to-place.
//
// UX (wireframe Screen 7):
//   • Capture mode chips — Honeycomb / Cone / OCR — drive the default tag type.
//   • Quick suggestion chips filtered to the selected capture mode.
//   • Label text field.
//   • "Train now"       → saves tag then immediately launches the training capture.
//   • "Save & train later" → saves tag then returns to AR for the next placement.
//
// Callbacks (replacing the old onCreated):
//   onSaveAndTrain(Tag)  — parent upgrades marker, appends to state, opens capture.
//   onSaveAndDefer(Tag)  — parent upgrades marker, appends to state, returns to AR.

import SwiftUI
import simd

// ── Suggestions ───────────────────────────────────────────────────────────────

private struct TagSuggestion {
    let label: String
    let type:  TagType
}

private let tagSuggestions: [TagSuggestion] = [
    // Honeycomb
    TagSuggestion(label: "Pressure Gauge",    type: .inspectionPoint),
    // Cone
    TagSuggestion(label: "Safety Label",      type: .presenceCheck),
    TagSuggestion(label: "Hazard Sign",       type: .presenceCheck),
    TagSuggestion(label: "Valve Status",      type: .presenceCheck),
    TagSuggestion(label: "Cable Connection",  type: .presenceCheck),
    TagSuggestion(label: "Filter Check",      type: .presenceCheck),
    TagSuggestion(label: "Seal Integrity",    type: .presenceCheck),
    TagSuggestion(label: "Fastener Check",    type: .presenceCheck),
    TagSuggestion(label: "LED Indicator",     type: .presenceCheck),
    TagSuggestion(label: "Part Presence",     type: .partCheck),
    TagSuggestion(label: "Cable Routing",     type: .routingCheck),
    TagSuggestion(label: "Panel Door",        type: .presenceCheck),
    TagSuggestion(label: "Configuration SW",  type: .configurationCheck),
    // OCR
    TagSuggestion(label: "Warning Label",     type: .languageCheck),
    TagSuggestion(label: "Serial Number",     type: .languageCheck),
]

// ── Sheet ─────────────────────────────────────────────────────────────────────

struct AddTagSheet: View {

    let anchor:         Anchor
    let placement:      SIBVector3?
    let onSaveAndTrain: (Tag) -> Void   // "Train now"
    let onSaveAndDefer: (Tag) -> Void   // "Save & train later"

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    @State private var label             = ""
    @State private var tagType: TagType  = .presenceCheck   // defaults to Cone
    @State private var isSaving          = false
    @State private var saveError: String? = nil
    /// Becomes true once the label field has been focused and then left empty,
    /// so the "Required" hint only surfaces after the user has had a chance to type.
    @State private var labelTouched      = false
    @FocusState private var labelFocused: Bool

    // Current capture mode derived from tagType
    private var captureMode: TagCaptureMode { tagType.captureMode }

    private var filteredSuggestions: [TagSuggestion] {
        tagSuggestions.filter { $0.type.captureMode == captureMode }
    }

    private func defaultType(for mode: TagCaptureMode) -> TagType {
        switch mode {
        case .honeycomb: return .inspectionPoint
        case .cone:      return .presenceCheck
        case .ocr:       return .languageCheck
        }
    }

    // A tag must never be created with zero position data — that produces a
    // tag that can never appear in Author or Operator mode without a manual
    // re-place. Block save entirely until a valid AR placement exists.
    private var canSave: Bool {
        !label.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving && placement != nil
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // Drag handle
            HStack {
                Spacer()
                Capsule()
                    .fill(.white.opacity(0.18))
                    .frame(width: 38, height: 4)
                Spacer()
            }
            .padding(.top, 12).padding(.bottom, 14)

            // Title
            Text("New tag")
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.bottom, 14)

            // ── Capture mode chips ─────────────────────────────────────────────
            HStack(spacing: 8) {
                captureModeChip(mode: .honeycomb, icon: "⬡", label: "Honeycomb")
                captureModeChip(mode: .cone,      icon: "▲", label: "Cone")
                captureModeChip(mode: .ocr,       icon: "T", label: "OCR")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            // ── Quick suggestions ──────────────────────────────────────────────
            if !filteredSuggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(filteredSuggestions, id: \.label) { s in
                            Button {
                                label    = s.label
                                tagType  = s.type
                                labelFocused = false
                            } label: {
                                Text(s.label)
                                    .font(.caption.bold())
                                    .padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(label == s.label
                                                ? Color.blue
                                                : Color.blue.opacity(0.12))
                                    .foregroundStyle(label == s.label ? .white : .blue)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .animation(.easeInOut(duration: 0.12), value: label)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 10)
            }

            // ── Label field (required) ─────────────────────────────────────────
            VStack(alignment: .leading, spacing: 4) {
                // Header with required asterisk
                HStack(spacing: 3) {
                    Text("LABEL")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.38))
                    Text("*")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.orange)
                }
                .padding(.horizontal, 16)

                let isEmptyAndTouched = labelTouched && label.trimmingCharacters(in: .whitespaces).isEmpty
                TextField("e.g. Pressure Gauge", text: $label)
                    .focused($labelFocused)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .tint(.blue)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(.white.opacity(0.07),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(isEmptyAndTouched ? Color.orange.opacity(0.65) : Color.clear,
                                    lineWidth: 1)
                    )
                    .padding(.horizontal, 16)
                    .onChange(of: labelFocused) { focused in
                        // Mark as touched once the user leaves the field
                        if !focused { labelTouched = true }
                    }

                // Inline hint — only shown after the user has left the field blank
                if isEmptyAndTouched {
                    Text("Required — enter a label for this tag")
                        .font(.caption)
                        .foregroundStyle(.orange.opacity(0.85))
                        .padding(.horizontal, 16)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.18), value: labelTouched)
            .padding(.bottom, 16)

            // ── Error ──────────────────────────────────────────────────────────
            if let err = saveError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            // No placement captured — block save so a tag can never be created
            // with zero position metadata (the root cause of tags silently
            // never appearing in Author/Operator mode later).
            if placement == nil {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("No surface detected here — close this sheet and tap the spot again.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            // ── Train now ──────────────────────────────────────────────────────
            Button {
                labelFocused = false
                Task { await save(trainNow: true) }
            } label: {
                Group {
                    if isSaving {
                        ProgressView().tint(.white)
                    } else {
                        Label("Train now", systemImage: "play.fill")
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(canSave ? Color.blue : Color.blue.opacity(0.35))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .disabled(!canSave)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            // ── Save & train later ─────────────────────────────────────────────
            Button {
                labelFocused = false
                Task { await save(trainNow: false) }
            } label: {
                Text("Save & train later")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(.white.opacity(0.06))
                    .foregroundStyle(canSave ? .white : .white.opacity(0.35))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(.white.opacity(0.16), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .disabled(!canSave)
            .padding(.horizontal, 16)
            .padding(.bottom, 6)

            // ── Cancel ─────────────────────────────────────────────────────────
            Button { dismiss() } label: {
                Text("✕  Cancel")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.32))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .padding(.horizontal, 16)

            Spacer(minLength: 0)
        }
        .presentationDetents([.height(450)])
        .presentationDragIndicator(.hidden)
        .presentationBackground(Color(red: 0.067, green: 0.067, blue: 0.11))
        .onAppear { labelFocused = true }
    }

    // ── Capture mode chip ─────────────────────────────────────────────────────

    private func captureModeChip(mode: TagCaptureMode, icon: String, label chipLabel: String) -> some View {
        let isSelected = captureMode == mode
        return Button {
            // Switch mode → reset to default type and clear label
            tagType = defaultType(for: mode)
            label   = ""
        } label: {
            HStack(spacing: 5) {
                Text(icon)
                    .font(.system(size: 11, weight: .bold))
                Text(chipLabel)
                    .font(.system(size: 12, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(
                isSelected
                    ? Color(red: 0.10, green: 0.13, blue: 0.26)
                    : Color.white.opacity(0.06)
            )
            .foregroundStyle(isSelected ? Color.blue : .white.opacity(0.5))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(isSelected ? Color.blue.opacity(0.45) : Color.clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    private func save(trainNow: Bool) async {
        // Defense in depth — canSave already disables both buttons when
        // placement is nil, but never allow a zero-position tag to reach
        // the server even if this is somehow invoked another way.
        guard let pos = placement else {
            saveError = "No surface detected — tap the spot again before saving."
            return
        }

        isSaving  = true
        saveError = nil
        let client = SIBClient(settings: settings)

        // Encode placement position
        var meta: [String: AnyCodable] = [:]
        meta["pos_x"] = AnyCodable(pos.x)
        meta["pos_y"] = AnyCodable(pos.y)
        meta["pos_z"] = AnyCodable(pos.z)
        let worldVec = simd_float3(Float(pos.x), Float(pos.y), Float(pos.z))
        if let rel = appState.toAnchorRelative(worldVec) {
            meta["anchor_rel_x"] = AnyCodable(Double(rel.x))
            meta["anchor_rel_y"] = AnyCodable(Double(rel.y))
            meta["anchor_rel_z"] = AnyCodable(Double(rel.z))
        }

        let trimmedLabel = label.trimmingCharacters(in: .whitespaces)
        let req = CreateTagRequest(
            anchorId:         anchor.id,
            type:             tagType,
            label:            trimmedLabel,
            expectedOutcome:  "\(trimmedLabel) is present and correct",
            checkDescription: nil,
            order:            nil,
            metadata:         meta
        )

        do {
            let tag = try await client.createTag(req)
            await MainActor.run {
                if trainNow {
                    onSaveAndTrain(tag)
                } else {
                    onSaveAndDefer(tag)
                }
                // Parent closes the sheet via showPlacementSheet = false
            }
        } catch {
            await MainActor.run { saveError = error.localizedDescription }
        }
        isSaving = false
    }
}
