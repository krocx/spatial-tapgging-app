// StepAnimationRow.swift - the author's per-step switch for objects that carry
// their own animation (a Dynamics 365 Guides arrow or hand - glTF clips baked
// in the model; AROMS-370).
//
// Shown wherever the author edits a step in AR (Place Steps, the guide
// session in Author mode) whenever the step has such objects: one capsule
// per object, lit while it plays on this step, tap to switch. The choice is
// saved at once (PATCH /guides/:id/steps/:stepId/node-clip) and every player
// follows it - the app, the XR kit, the Designer Studio.
//
// An "animated object" is a step node that carries a `clip` field, on or
// off: the importer sets it for every animated placement, and the Studio
// (which reads the model) adds any it finds. No model parsing on the device.

import SwiftUI

struct StepAnimationRow: View {
    let guideId: String
    /// The step as currently known (its `nodes` carry the flags).
    let step: GuideStep
    /// Called with the saved step after a switch, so the caller can replace its copy.
    let onSaved: (GuideStep) -> Void
    @EnvironmentObject private var settings: AppSettings
    @State private var busy: String? = nil
    @State private var error: String? = nil

    /// Objects on this step that carry their own animation.
    static func animatedNodes(_ step: GuideStep) -> [GuideStepNode] {
        (step.nodes ?? []).filter { $0.clip != nil && $0.show != "hidden" }
    }

    var body: some View {
        let items = Self.animatedNodes(step)
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "play.circle").font(.caption2).foregroundStyle(.white.opacity(0.6))
                    Text("Animation").font(.caption2).foregroundStyle(.white.opacity(0.6))
                    if let e = error { Text(e).font(.caption2).foregroundStyle(.orange).lineLimit(1) }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(items, id: \.node) { n in
                            let on = n.clip?.play ?? false
                            Button {
                                toggle(n, to: !on)
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: on ? "play.fill" : "pause").font(.caption2)
                                    Text(n.label ?? n.partName).font(.caption).lineLimit(1)
                                    if busy == n.node { ProgressView().controlSize(.mini) }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(on ? Color.green.opacity(0.28) : Color.white.opacity(0.12))
                                .overlay(Capsule().stroke(on ? Color.green : Color.white.opacity(0.25), lineWidth: 1))
                                .foregroundStyle(on ? Color.green : Color.white)
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(busy != nil)
                            .accessibilityLabel("\(n.label ?? n.partName) animation \(on ? "playing - tap to stop" : "at rest - tap to play")")
                        }
                    }
                }
            }
        }
    }

    private func toggle(_ n: GuideStepNode, to play: Bool) {
        busy = n.node; error = nil
        Task { @MainActor in
            defer { busy = nil }
            do {
                let saved = try await SIBClient(settings: settings).setStepNodeClip(guideId: guideId, stepId: step.id, node: n.node, play: play)
                onSaved(saved)
            } catch {
                self.error = "Not saved - \(error.localizedDescription)"
            }
        }
    }
}
