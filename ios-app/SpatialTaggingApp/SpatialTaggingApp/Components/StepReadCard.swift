// StepReadCard.swift — H2 (2026.4.46): read a step in full without leaving AR.
//
// Place Steps showed one truncated line of the active step; showing a tech
// the instruction meant going back to the portal. This half-height sheet
// keeps the camera live behind it and shows the whole step — title, text,
// voice-over, image, flags, models, branches — with ‹ › to flip through the
// guide. Read-only by design: editing stays in the Guide editor.

import SwiftUI

struct StepReadCard: View {
    let steps: [GuideStep]
    @Binding var index: Int
    var models: [Model3D] = []
    var trainedStepIds: Set<String> = []
    var placedStepIds: Set<String> = []

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage? = nil
    @State private var loadingImage = false

    private var step: GuideStep? { index >= 0 && index < steps.count ? steps[index] : nil }
    private func title(of id: String?) -> String? {
        guard let id, let s = steps.first(where: { $0.id == id }) else { return nil }
        return "\(s.sequenceNumber) · \(s.displayTitle)"
    }

    var body: some View {
        NavigationStack {
            Group {
                if let step {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            // Chips: state at a glance
                            HStack(spacing: 6) {
                                chip(placedStepIds.contains(step.id) ? "Placed" : "Unplaced",
                                     placedStepIds.contains(step.id) ? .green : .orange, "mappin")
                                if !step.completionRequired { chip("Optional", .gray, "circle.dashed") }
                                if step.evidenceRequired == true { chip("Evidence", .cyan, "camera") }
                                if step.needsValidation {
                                    chip(step.validationTrained || trainedStepIds.contains(step.id) ? "Validated · trained" : "Validated · untrained",
                                         step.validationTrained || trainedStepIds.contains(step.id) ? .green : .orange, "checkmark.seal")
                                }
                            }

                            Text(step.text)
                                .font(.body)
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)

                            if let tts = step.ttsText?.trim(), !tts.isEmpty {
                                section("Voice-over", "waveform") { Text(tts).font(.callout).foregroundStyle(.secondary) }
                            }
                            if step.mediaPath != nil {
                                section("Photo", "photo") {
                                    if let image {
                                        Image(uiImage: image).resizable().scaledToFit()
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                    } else if loadingImage {
                                        ProgressView().frame(maxWidth: .infinity)
                                    } else {
                                        Text("Photo unavailable").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            let slots = step.effectiveModels
                            if !slots.isEmpty {
                                section("3D models", "cube") {
                                    ForEach(Array(slots.enumerated()), id: \.element.slotId) { i, m in
                                        HStack(spacing: 8) {
                                            Text("⬢\(i + 1)").font(.caption.bold()).foregroundStyle(.indigo)
                                            Text(models.first { $0.id == m.modelId }?.name ?? m.modelId)
                                                .font(.callout)
                                            Spacer()
                                            if m.hasPlacement { Text("positioned").font(.caption2).foregroundStyle(.green) }
                                        }
                                    }
                                }
                            }
                            if step.nextOnSuccess != nil || step.nextOnFailure != nil || step.precondition != nil {
                                section("Branches", "arrow.triangle.branch") {
                                    if let t = title(of: step.nextOnSuccess) { row("On complete →", t) }
                                    if let t = title(of: step.nextOnFailure) { row("On failure →", t) }
                                    if let t = title(of: step.precondition)  { row("Requires", t) }
                                }
                            }
                            if let link = step.linkUrl, let url = URL(string: link) {
                                Link(destination: url) { Label("Reference", systemImage: "link") }.font(.callout)
                            }
                        }
                        .padding(20)
                    }
                    .navigationTitle("\(step.sequenceNumber) · \(step.displayTitle)")
                    .navigationBarTitleDisplayMode(.inline)
                } else {
                    Text("No step").foregroundStyle(.secondary)
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .cancellationAction) {
                    Button { index = max(0, index - 1) } label: { Image(systemName: "chevron.left") }
                        .disabled(index <= 0)
                    Button { index = min(steps.count - 1, index + 1) } label: { Image(systemName: "chevron.right") }
                        .disabled(index >= steps.count - 1)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task(id: step?.id) { await loadImage() }
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .presentationDragIndicator(.visible)
    }

    private func loadImage() async {
        image = nil
        guard let step, let file = step.mediaPath else { return }
        loadingImage = true
        defer { loadingImage = false }
        if let data = try? await SIBClient(settings: settings).fetchGuideStepImage(filename: file) {
            image = UIImage(data: data)
        }
    }

    @ViewBuilder
    private func section<C: View>(_ title: String, _ icon: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon).font(.caption.bold()).foregroundStyle(.secondary)
            content()
        }
    }
    private func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k).font(.caption).foregroundStyle(.secondary); Text(v).font(.callout) }
    }
    private func chip(_ t: String, _ c: Color, _ icon: String) -> some View {
        Label(t, systemImage: icon).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(c.opacity(0.15), in: Capsule()).foregroundStyle(c)
    }
}

private extension String { func trim() -> String { trimmingCharacters(in: .whitespacesAndNewlines) } }
