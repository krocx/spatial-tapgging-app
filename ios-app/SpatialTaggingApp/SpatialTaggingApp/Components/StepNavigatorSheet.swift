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

    /// The order rule, the same one Next enforces: a step whose completion is
    /// mandatory ("Mark complete required") must be done before any LATER step
    /// can be worked on; optional steps can be passed over. Going back is
    /// always allowed. Returns the index of the first blocking step, if any.
    private func blocker(for target: Int) -> Int? {
        guard target > activeIndex else { return nil }
        for i in 0..<target where i < progresses.count {
            if steps[i].completionRequired && !progresses[i].isCompleted { return i }
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                        let prog = i < progresses.count ? progresses[i] : nil
                        let blockedBy = blocker(for: i)
                        Button {
                            onJump(i)
                            dismiss()
                        } label: {
                            StepNavigatorRow(index: i, step: step, progress: prog, isCurrent: i == activeIndex,
                                             blockedBy: blockedBy.map { steps[$0] })
                        }
                        .buttonStyle(.plain)
                        .disabled(blockedBy != nil)
                        .listRowBackground(i == activeIndex ? Color.blue.opacity(0.14) : Color.clear)
                    }
                } header: {
                    Text("\(doneCount) of \(steps.count) done · tap a step to go there")
                } footer: {
                    Text("A step marked complete-required must be done before any later step; optional steps can be passed over. Going to a step never completes the ones before it.")
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
    /// The earlier mandatory step that must be done before this one can be opened.
    let blockedBy: GuideStep?

    private var state: (symbol: String, color: Color, words: String) {
        if progress?.isCompleted == true { return ("checkmark.circle.fill", .green, "Done") }
        if isCurrent { return ("circle.inset.filled", .blue, "Current") }
        if let b = blockedBy { return ("lock.circle", Color.white.opacity(0.35), "After step \(b.sequenceNumber)") }
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
                    Text(step.displayTitle).font(.subheadline.weight(isCurrent ? .bold : .regular)).foregroundStyle(blockedBy == nil ? .white : .white.opacity(0.5)).lineLimit(2)
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
