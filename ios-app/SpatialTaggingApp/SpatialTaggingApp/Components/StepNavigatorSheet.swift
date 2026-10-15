// StepNavigatorSheet.swift - jump to any step of a guide (AROMS-330).
//
// A pull-up list of every step with its state - done, current, started,
// not yet; a validation or evidence still owed - for AR OMS and AR OJT
// sessions alike. Tapping a row is NAVIGATION ONLY: nothing is completed or
// skipped by jumping; the completion rule stays with the step itself
// (precondition redirects still apply, the session view enforces them).
//
// Proprietary & Confidential · Applied Materials.

import SwiftUI

struct StepNavigatorSheet: View {
    let steps:       [GuideStep]
    let progresses:  [GuideStepProgress]
    let activeIndex: Int
    let onJump:      (Int) -> Void

    @Environment(\.dismiss) private var dismiss

    private var doneCount: Int { progresses.filter { $0.isCompleted }.count }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                        let prog = i < progresses.count ? progresses[i] : nil
                        Button {
                            onJump(i)
                            dismiss()
                        } label: {
                            StepNavigatorRow(index: i, step: step, progress: prog, isCurrent: i == activeIndex)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(i == activeIndex ? Color.blue.opacity(0.14) : Color.clear)
                    }
                } header: {
                    Text("\(doneCount) of \(steps.count) done · tap a step to go there")
                } footer: {
                    Text("Going to a step does not complete the ones before it. A step that needs another first takes you there.")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.black.opacity(0.92))
            .navigationTitle("Steps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}

private struct StepNavigatorRow: View {
    let index:     Int
    let step:      GuideStep
    let progress:  GuideStepProgress?
    let isCurrent: Bool

    private var state: (symbol: String, color: Color, words: String) {
        if progress?.isCompleted == true { return ("checkmark.circle.fill", .green, "Done") }
        if isCurrent { return ("circle.inset.filled", .blue, "Current") }
        if progress?.enteredAt != nil { return ("circle.dotted", .orange, "Started") }
        return ("circle", Color.white.opacity(0.35), "Not yet")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(state.color.opacity(0.18)).frame(width: 30, height: 30)
                Image(systemName: state.symbol).font(.system(size: 14, weight: .bold)).foregroundStyle(state.color)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("\(step.sequenceNumber)").font(.caption.monospacedDigit().bold()).foregroundStyle(.white.opacity(0.55))
                    Text(step.displayTitle).font(.subheadline.weight(isCurrent ? .bold : .regular)).foregroundStyle(.white).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Text(state.words).font(.caption2).foregroundStyle(state.color)
                    if step.needsValidation {
                        Label(step.validationTrained ? "Check: system" : "Check: manual", systemImage: step.validationTrained ? "checkmark.seal" : "hand.raised")
                            .font(.caption2).foregroundStyle(.white.opacity(0.6))
                    }
                    if step.needsEvidence {
                        Label(progress?.evidencePhoto != nil ? "Evidence taken" : "Evidence needed", systemImage: "camera")
                            .font(.caption2).foregroundStyle(progress?.evidencePhoto != nil ? .green : .white.opacity(0.6))
                    }
                    if !step.completionRequired {
                        Text("optional").font(.caption2).foregroundStyle(.white.opacity(0.45))
                    }
                }
            }
            Spacer(minLength: 0)
            if isCurrent { Image(systemName: "location.fill").font(.caption).foregroundStyle(.blue) }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityLabel("Step \(step.sequenceNumber), \(step.displayTitle), \(state.words)")
    }
}
