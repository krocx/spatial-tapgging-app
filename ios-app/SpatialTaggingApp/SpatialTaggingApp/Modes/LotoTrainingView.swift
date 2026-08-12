// LotoTrainingView.swift — iLOTO slice 3: the certification quiz.
//
// One question at a time (a checklist mindset, not an exam cram screen), then
// a single submit at the end. Grading is SERVER-side — the questions arrive
// without answers, so the quiz cannot be scraped from the app — and the
// response carries per-question feedback with the correct answer and an
// explanation, because the point is learning, not gatekeeping.
//
// Pass → certification record with an expiry date; the hub gate reads it live.
// Fail → full review of every miss, then retry. Failed attempts are records
// too (the server stores them) — an audit can see how many tries certification
// took, which is itself a signal EHS cares about.

import SwiftUI

struct LotoTrainingView: View {

    /// Called after ANY graded attempt so the hub can refresh its gate.
    let onCertChanged: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case loading
        case failed(String)
        case quiz
        case submitting
        case result(SubmitLotoQuizResult)
    }

    @State private var phase: Phase = .loading
    @State private var questions: [LotoQuizQuestionPublic] = []
    @State private var passRatio: Double = 0.8
    @State private var index = 0
    @State private var answers: [String: Int] = [:]

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView("Loading training…")
            case .failed(let msg):
                VStack(spacing: 14) {
                    Label(msg, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline).foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
            case .quiz:
                quizBody
            case .submitting:
                ProgressView("Grading…")
            case .result(let result):
                resultBody(result)
            }
        }
        .navigationTitle("My LOTO Training")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    // ── Quiz ────────────────────────────────────────────────────────────────

    private var quizBody: some View {
        VStack(spacing: 0) {
            // Progress
            VStack(spacing: 6) {
                ProgressView(value: Double(index + 1), total: Double(max(questions.count, 1)))
                    .tint(.green)
                Text("Question \(index + 1) of \(questions.count)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20).padding(.top, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if index < questions.count {
                        let q = questions[index]
                        Text(q.prompt)
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 18)

                        ForEach(Array(q.choices.enumerated()), id: \.offset) { i, choice in
                            choiceRow(question: q, choiceIndex: i, text: choice)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }

            // Nav bar
            HStack {
                Button {
                    if index > 0 { index -= 1 }
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .disabled(index == 0)

                Spacer()

                if index < questions.count - 1 {
                    Button {
                        index += 1
                    } label: {
                        Label("Next", systemImage: "chevron.right")
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(answers[questions[index].id] == nil)
                } else {
                    Button {
                        Task { await submit() }
                    } label: {
                        Text("Submit \(answers.count) answers").bold()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(answers.count < questions.count)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            .background(.bar)
        }
    }

    private func choiceRow(question: LotoQuizQuestionPublic, choiceIndex: Int, text: String) -> some View {
        let selected = answers[question.id] == choiceIndex
        return Button {
            answers[question.id] = choiceIndex
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? .green : Color(.systemGray3))
                    .padding(.top, 1)
                Text(text)
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(selected ? Color.green.opacity(0.10) : Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(selected ? Color.green.opacity(0.5) : Color(.separator), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // ── Result ──────────────────────────────────────────────────────────────

    private func resultBody(_ result: SubmitLotoQuizResult) -> some View {
        let cert = result.certification
        return List {
            Section {
                VStack(spacing: 10) {
                    Image(systemName: cert.passed ? "checkmark.seal.fill" : "xmark.seal.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(cert.passed ? .green : .red)
                    Text(cert.passed ? "Certified" : "Not yet")
                        .font(.title2.bold())
                    Text("\(cert.score) of \(cert.total) correct · \(Int((passRatio * 100).rounded()))% required")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if cert.passed {
                        Text("Valid until \(expiryText(cert.expiresAt))")
                            .font(.caption)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Color.green.opacity(0.12), in: Capsule())
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .listRowBackground(Color.clear)
            }

            // Review — every question, misses first. The explanations are the
            // training; a silent score would waste the moment of attention.
            let misses = result.results.filter { !$0.correct }
            if !misses.isEmpty {
                Section {
                    ForEach(misses, id: \.questionId) { r in
                        reviewRow(r)
                    }
                } header: {
                    Text("Review (\(misses.count) missed)")
                }
            }

            Section {
                if cert.passed {
                    Button {
                        dismiss()
                    } label: {
                        HStack { Spacer(); Text("Done — Safe Off and LOTO are unlocked").bold(); Spacer() }
                    }
                } else {
                    Button {
                        answers.removeAll()
                        index = 0
                        phase = .quiz
                    } label: {
                        HStack { Spacer(); Text("Try again").bold(); Spacer() }
                    }
                }
            }
        }
    }

    private func reviewRow(_ r: LotoQuizResultItem) -> some View {
        let q = questions.first { $0.id == r.questionId }
        return VStack(alignment: .leading, spacing: 6) {
            Text(q?.prompt ?? r.questionId)
                .font(.subheadline.bold())
            if let q, r.correctIndex < q.choices.count {
                Label(q.choices[r.correctIndex], systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            Text(r.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func expiryText(_ iso: String) -> String {
        guard let d = LotoFormat.date(iso) else { return iso }
        return d.formatted(date: .abbreviated, time: .omitted)
    }

    // ── Data ────────────────────────────────────────────────────────────────

    private func load() async {
        phase = .loading
        do {
            let payload = try await SIBClient(settings: settings).fetchLotoQuiz()
            questions = payload.questions
            passRatio = payload.passRatio
            index = 0
            answers.removeAll()
            phase = questions.isEmpty
                ? .failed("The question bank is empty — ask EHS to seed it on the server.")
                : .quiz
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func submit() async {
        phase = .submitting
        let req = SubmitLotoQuizRequest(
            userId:   settings.authorName,
            userName: settings.authorName,
            answers:  answers
        )
        do {
            let result = try await SIBClient(settings: settings).submitLotoQuiz(req)
            phase = .result(result)
            onCertChanged()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}
