// ARGuideSessionView.swift — AR OMS Phase 1
//
// Full-screen AR session for an Operator running a published Guide.
//
// Layout
// ──────
// • Live camera feed (ARContainerView, no 3D scene content in Phase 1)
// • Floating content panel pinned to the bottom:
//     – Step counter badge  (e.g. "Step 2 / 5")
//     – Step text
//     – Reference photo (loaded on-demand, shown below text if present)
//     – TTS play button (synthesises effectiveTTSText on demand via AVSpeechSynthesizer)
//     – Checkmark (for completionRequired steps — must tap before Next)
//     – Prev / Next navigation buttons
// • Top bar: step counter + Exit
// • After last step (all required ones marked) → "Sign Off" CTA
//     → SessionSignOffView sheet — Operator types their name and submits
//     → Atomic POST /guide-sessions on submission
//
// State machine:  .session → .signingOff → .submitted

import SwiftUI
import ARKit
import AVFoundation

// ── Main view ─────────────────────────────────────────────────────────────────

struct ARGuideSessionView: View {

    let anchor: Anchor
    let guide:  ARGuide
    let steps:  [GuideStep]   // sorted by sequenceNumber, pre-fetched by GuideListView

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    // AR camera feed
    @StateObject private var arManager = ARSessionManager()

    // In-session step state
    @State private var progresses: [GuideStepProgress] = []
    @State private var currentIdx: Int = 0

    // TTS
    @State private var synthesizer  = AVSpeechSynthesizer()
    @State private var isSpeaking   = false

    // Reference photo cache (key: step.id)
    @State private var stepImages: [String: UIImage] = [:]

    // Sign-off
    @State private var showSignOff  = false
    @State private var sessionStart = Date()

    private enum Phase { case session, submitted }
    @State private var phase: Phase = .session

    // ── Computed ──────────────────────────────────────────────────────────────

    var sortedSteps: [GuideStep] { steps.sorted { $0.sequenceNumber < $1.sequenceNumber } }

    var currentStep: GuideStep? {
        guard currentIdx < sortedSteps.count else { return nil }
        return sortedSteps[currentIdx]
    }

    var currentProgress: GuideStepProgress? {
        guard currentIdx < progresses.count else { return nil }
        return progresses[currentIdx]
    }

    /// All completionRequired steps have been checked off.
    var allRequiredDone: Bool {
        guard progresses.count == sortedSteps.count else { return false }
        return zip(sortedSteps, progresses).allSatisfy { step, prog in
            !step.completionRequired || prog.isCompleted
        }
    }

    /// Can the Operator advance to next step?
    var canAdvance: Bool {
        guard let step = currentStep, currentIdx < progresses.count else { return false }
        if step.completionRequired { return progresses[currentIdx].isCompleted }
        return true
    }

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // Camera background
            ARContainerView(arManager: arManager, onTap: { _ in })
                .ignoresSafeArea()
                .onAppear {
                    arManager.startSession()
                    arManager.disableQRScanning()
                    sessionStart = Date()
                }
                .onDisappear {
                    stopSpeaking()
                    arManager.pauseSession()
                }

            // Content panel (bottom)
            if phase == .session {
                VStack {
                    Spacer()
                    if let step = currentStep {
                        GuideContentPanel(
                            step:          step,
                            progress:      currentIdx < progresses.count ? progresses[currentIdx] : nil,
                            stepNumber:    currentIdx + 1,
                            totalSteps:    sortedSteps.count,
                            referenceImage: stepImages[step.id],
                            isSpeaking:    isSpeaking,
                            canGoBack:     currentIdx > 0,
                            canGoNext:     currentIdx < sortedSteps.count - 1 && canAdvance,
                            allRequiredDone: allRequiredDone,
                            onPrev:        { goTo(index: currentIdx - 1) },
                            onNext:        { goTo(index: currentIdx + 1) },
                            onComplete:    { markComplete() },
                            onSpeak:       { toggleSpeech(for: step) },
                            onSignOff:     { showSignOff = true }
                        )
                    }
                }
            }

            // Submitted overlay
            if phase == .submitted {
                submittedOverlay
            }

            // Top bar (always visible during session)
            if phase == .session {
                topBar
            }
        }
        .onAppear {
            progresses = sortedSteps.map { GuideStepProgress(step: $0) }
            if !progresses.isEmpty { progresses[0].enter() }
            if let first = sortedSteps.first { Task { await loadImage(for: first) } }
        }
        // Sign-off sheet
        .sheet(isPresented: $showSignOff) {
            SessionSignOffView(
                guide:     guide,
                anchor:    anchor,
                progresses: progresses,
                startedAt: sessionStart
            ) {
                showSignOff = false
                phase       = .submitted
                stopSpeaking()
                arManager.pauseSession()
            }
            .environmentObject(settings)
        }
    }

    // ── Top bar ───────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Button {
                stopSpeaking()
                arManager.pauseSession()
                dismiss()
            } label: {
                Label("Exit", systemImage: "xmark")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }

            Spacer()

            Text(guide.name)
                .font(.headline).foregroundStyle(.white)
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: 200)

            Spacer()

            // Step counter
            Text("\(currentIdx + 1) / \(sortedSteps.count)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Submitted overlay ─────────────────────────────────────────────────────

    private var submittedOverlay: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 60)).foregroundStyle(.green)
                Text("Guide Complete")
                    .font(.title2.bold()).foregroundStyle(.white)
                Text("\(sortedSteps.count) step\(sortedSteps.count == 1 ? "" : "s") signed off")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent).tint(.green)
            }
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private func goTo(index: Int) {
        guard index >= 0, index < sortedSteps.count else { return }
        stopSpeaking()
        currentIdx = index
        if progresses[index].enteredAt == nil {
            progresses[index].enter()
        }
        let step = sortedSteps[index]
        if stepImages[step.id] == nil { Task { await loadImage(for: step) } }
    }

    private func markComplete() {
        guard currentIdx < progresses.count else { return }
        progresses[currentIdx].complete()
    }

    // ── TTS ───────────────────────────────────────────────────────────────────

    private func toggleSpeech(for step: GuideStep) {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
            isSpeaking = false
        } else {
            let utt = AVSpeechUtterance(string: step.effectiveTTSText)
            utt.rate  = AVSpeechUtteranceDefaultSpeechRate
            utt.voice = AVSpeechSynthesisVoice(language: Locale.current.language.languageCode?.identifier ?? "en")
            synthesizer.speak(utt)
            isSpeaking = true
            // Watch for synthesis completion
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 300_000_000) // 0.3s debounce
                while synthesizer.isSpeaking {
                    try? await Task.sleep(nanoseconds: 200_000_000)
                }
                isSpeaking = false
            }
        }
    }

    private func stopSpeaking() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        isSpeaking = false
    }

    // ── Reference photo ───────────────────────────────────────────────────────

    private func loadImage(for step: GuideStep) async {
        guard let filename = step.mediaPath, stepImages[step.id] == nil else { return }
        let client = SIBClient(settings: settings)
        if let data = try? await client.fetchGuideStepImage(filename: filename),
           let img  = UIImage(data: data) {
            stepImages[step.id] = img
        }
    }
}

// ── Guide Content Panel ───────────────────────────────────────────────────────
//
// The floating UI card that sits at the bottom of the AR view.

struct GuideContentPanel: View {

    let step:            GuideStep
    let progress:        GuideStepProgress?
    let stepNumber:      Int
    let totalSteps:      Int
    let referenceImage:  UIImage?
    let isSpeaking:      Bool
    let canGoBack:       Bool
    let canGoNext:       Bool
    let allRequiredDone: Bool

    let onPrev:      () -> Void
    let onNext:      () -> Void
    let onComplete:  () -> Void
    let onSpeak:     () -> Void
    let onSignOff:   () -> Void

    var isCompleted: Bool { progress?.isCompleted ?? false }
    var isLastStep:  Bool { stepNumber == totalSteps }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ── Step header ───────────────────────────────────────────────────
            HStack(spacing: 10) {
                // Step number badge
                ZStack {
                    Circle()
                        .fill(isCompleted ? Color.green.opacity(0.2) : Color.indigo.opacity(0.15))
                        .frame(width: 34, height: 34)
                    if isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.green)
                    } else {
                        Text("\(stepNumber)")
                            .font(.subheadline.bold())
                            .foregroundStyle(.indigo)
                    }
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text("Step \(stepNumber) of \(totalSteps)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    if step.completionRequired {
                        Label("Completion required", systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                // TTS speak button
                Button(action: onSpeak) {
                    Image(systemName: isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.1")
                        .font(.system(size: 20))
                        .foregroundStyle(isSpeaking ? .indigo : .secondary)
                        .symbolEffect(.pulse, isActive: isSpeaking)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 4)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 16)

            // ── Step text ─────────────────────────────────────────────────────
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(step.text)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                    // Reference photo (if loaded)
                    if let img = referenceImage {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .padding(.horizontal, 16)
                    } else if step.mediaPath != nil {
                        // Placeholder while image loads
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.secondary.opacity(0.1))
                            .frame(height: 80)
                            .overlay(ProgressView())
                            .padding(.horizontal, 16)
                    }

                    Spacer(minLength: 12)
                }
            }
            .frame(maxHeight: referenceImage != nil ? 260 : 120)

            Divider().padding(.horizontal, 16)

            // ── Action row ────────────────────────────────────────────────────
            VStack(spacing: 10) {

                // Checkmark / Sign Off button
                if isLastStep && allRequiredDone {
                    Button(action: onSignOff) {
                        Label("Sign Off & Submit", systemImage: "signature")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.green)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if step.completionRequired && !isCompleted {
                    Button(action: onComplete) {
                        Label("Mark Complete", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.indigo)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    }
                    .padding(.horizontal, 16)
                } else if isCompleted {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Completed")
                            .font(.subheadline.bold())
                            .foregroundStyle(.green)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }

                // Prev / Next navigation
                HStack(spacing: 12) {
                    Button(action: onPrev) {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                            Text("Prev")
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoBack ? .primary : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoBack)

                    Button(action: onNext) {
                        HStack(spacing: 6) {
                            Text(isLastStep ? "Done" : "Next")
                            Image(systemName: isLastStep ? "checkmark" : "chevron.right")
                        }
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(canGoNext ? Color.indigo.opacity(0.9) : Color.secondary.opacity(0.12))
                        .foregroundStyle(canGoNext ? .white : .secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(!canGoNext || isLastStep)
                }
                .padding(.horizontal, 16)
            }
            .padding(.top, 12)
            .padding(.bottom, 34)  // safe area clearance
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        .animation(.easeInOut(duration: 0.2), value: isCompleted)
        .animation(.easeInOut(duration: 0.2), value: allRequiredDone)
    }
}

// ── Session Sign-Off Sheet ────────────────────────────────────────────────────
//
// Collects the Operator's name and submits the completed session atomically.

struct SessionSignOffView: View {

    let guide:      ARGuide
    let anchor:     Anchor
    let progresses: [GuideStepProgress]
    let startedAt:  Date
    let onDone:     () -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var operatorName = ""
    @State private var isSubmitting = false
    @State private var error:       String? = nil

    private var completedAt: Date { Date() }

    private var durationSeconds: Double {
        completedAt.timeIntervalSince(startedAt)
    }

    private var stepCompletions: [GuideStepCompletion] {
        progresses.compactMap { $0.toCompletion() }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .center, spacing: 12) {
                        Image(systemName: "signature")
                            .font(.system(size: 44))
                            .foregroundStyle(.indigo)
                        Text("Sign Off")
                            .font(.title2.bold())
                        Text("\(guide.name) — \(anchor.assetId)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    HStack {
                        Image(systemName: "person.fill")
                            .foregroundStyle(.indigo).frame(width: 22)
                        TextField("Your name", text: $operatorName)
                            .autocorrectionDisabled()
                    }
                } header: {
                    Text("Operator Sign-Off")
                } footer: {
                    Text("Your name is recorded with this session and cannot be changed after submission.")
                }

                Section {
                    LabeledContent("Steps completed",
                                   value: "\(stepCompletions.count) / \(progresses.count)")
                    LabeledContent("Duration",
                                   value: formatDuration(durationSeconds))
                } header: {
                    Text("Session Summary")
                }

                if let err = error {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Sign Off")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView().scaleEffect(0.8)
                    } else {
                        Button("Submit") { Task { await submit() } }
                            .bold()
                            .disabled(operatorName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        error        = nil
        let iso      = ISO8601DateFormatter()
        let req      = CreateARGuideSessionRequest(
            guideId:         guide.id,
            anchorId:        anchor.id,
            guideName:       guide.name,
            anchorName:      anchor.assetId,
            signedOffBy:     operatorName.trimmingCharacters(in: .whitespaces),
            startedAt:       iso.string(from: startedAt),
            completedAt:     iso.string(from: completedAt),
            durationSeconds: durationSeconds,
            stepCompletions: stepCompletions
        )
        let client = SIBClient(settings: settings)
        do {
            _ = try await client.submitGuideSession(req)
            onDone()
        } catch {
            self.error = "Submission failed: \(friendlyMessage(for: error))"
        }
        isSubmitting = false
    }

    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let m     = total / 60
        let s     = total % 60
        return m > 0 ? "\(m) min \(s) sec" : "\(s) sec"
    }
}
