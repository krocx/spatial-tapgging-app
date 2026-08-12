// ModeSelectionView.swift — Phase 3
// Home screen: choose Author or Operator mode, shows SIB connection status.
//
// Phase 3 flow:
//   Author  → AnchorDirectoryView(mode: .author)  → AnchorHubView → QRScanGateView → AuthorModeView
//   Operator → AnchorDirectoryView(mode: .operator) → AnchorHubView → QRScanGateView → OperatorModeView
//   Continue → AnchorHubView (pre-loaded anchor)  → QRScanGateView → AuthorModeView

import SwiftUI

struct ModeSelectionView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    // Collected screen-space frames for tour spotlights
    @State private var tourFrames: [TourStep: CGRect] = [:]

    @State private var showAuthorDirectory  = false
    @State private var showOperatorDirectory = false
    @State private var showSettings         = false
    @State private var showOnboarding       = false
    @State private var isTesting            = false

    // Continue-last-session state
    @State private var lastSession: LastAuthorSession? = nil
    @State private var isResuming  = false
    @State private var resumeError: String? = nil
    /// Set by resumeLastSession — presents AnchorHubView directly (skips directory)
    @State private var hubResumeAnchor: Anchor? = nil

    // Share Anchor QR — home-screen shortcut
    @State private var showQRSheet   = false
    @State private var qrAnchor:     Anchor?  = nil
    @State private var qrKeyB64:     String?  = nil
    @State private var isLoadingQR   = false
    @State private var qrLoadError:  String?  = nil

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(white: 0.07), Color(white: 0.12)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundStyle(LinearGradient(colors: [.blue, .cyan],
                                                           startPoint: .top, endPoint: .bottom))
                        Spacer()
                        Button { showOnboarding = true } label: {
                            Image(systemName: "questionmark.circle")
                                .font(.title2).foregroundColor(.white.opacity(0.6))
                        }
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape.fill")
                                .font(.title2).foregroundColor(.white.opacity(0.6))
                        }
                        .background(
                            GeometryReader { geo in
                                Color.clear.preference(
                                    key: TourFrameKey.self,
                                    value: [.tapSettings: geo.frame(in: .global)]
                                )
                            }
                        )
                    }
                    Text("Spatial Tagging").font(.largeTitle.bold()).foregroundColor(.white)
                    Text("Cleanroom Inspection · v\(AppVersion.current)")
                        .font(.subheadline).foregroundColor(.white.opacity(0.5))
                }
                .padding(.top, 48).padding(.horizontal, 24)

                Spacer()

                // Mode buttons
                VStack(spacing: 16) {
                    ModeButton(title: "Author Mode",
                               subtitle: "Create and train inspection tags",
                               icon: "pencil.circle.fill", accentColor: .blue,
                               isEnabled: settings.isConfigured) { showAuthorDirectory = true }
                    .background(
                        GeometryReader { geo in
                            Color.clear.preference(
                                key: TourFrameKey.self,
                                value: [.tapAuthor: geo.frame(in: .global)]
                            )
                        }
                    )

                    ModeButton(title: "Operator Mode",
                               subtitle: "Run inspections and view results",
                               icon: "eye.circle.fill", accentColor: .green,
                               isEnabled: settings.isConfigured) { showOperatorDirectory = true }
                    .background(
                        GeometryReader { geo in
                            Color.clear.preference(
                                key: TourFrameKey.self,
                                value: [.tapOperator: geo.frame(in: .global)]
                            )
                        }
                    )

                    // ── Continue last Author session ───────────────────────────
                    if let session = lastSession, settings.isConfigured {
                        ContinueSessionCard(
                            session:    session,
                            isLoading:  isResuming,
                            error:      resumeError
                        ) {
                            resumeError = nil
                            Task { await resumeLastSession(session) }
                        } onDiscard: {
                            appState.clearLastAuthorSession()
                            lastSession = nil
                        }

                        // ── Share Anchor QR — shown when Keychain has a key ────
                        // Lets the Author share the app-generated QR (with embedded
                        // encryption key) directly from the home screen, without
                        // needing to re-enter Author mode and scan the old physical QR.
                        if AnchorEncryption.loadExistingKey(anchorId: session.anchorId) != nil {
                            ShareQRCard(
                                session:   session,
                                isLoading: isLoadingQR,
                                error:     qrLoadError
                            ) {
                                qrLoadError = nil
                                Task { await loadQRAnchor(session) }
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)

                if let err = resumeError {
                    Text(err).font(.caption).foregroundColor(.red).padding(.top, 4)
                        .padding(.horizontal, 24)
                        .onTapGesture { resumeError = nil }
                }

                if !settings.isConfigured {
                    Text("Configure SIB server URL in Settings ⚙️")
                        .font(.caption).foregroundColor(.orange).padding(.top, 12)
                }

                Spacer()

                // Connection status strip
                HStack(spacing: 8) {
                    Circle().fill(dotColor).frame(width: 8, height: 8)
                    Text(statusText).font(.caption).foregroundColor(.white.opacity(0.6))
                    Spacer()
                    if settings.isConfigured {
                        Button {
                            guard !isTesting else { return }
                            isTesting = true
                            appState.connectionState = .checking
                            let client = SIBClient(settings: settings)
                            Task {
                                do {
                                    try await client.testConnection()
                                    appState.connectionState = .connected
                                } catch {
                                    appState.connectionState = .failed(error.localizedDescription)
                                }
                                isTesting = false
                            }
                        } label: {
                            if isTesting { ProgressView().scaleEffect(0.7).tint(.white) }
                            else { Text("Test").font(.caption).foregroundColor(.white.opacity(0.5)) }
                        }
                        .disabled(isTesting)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color.white.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 24).padding(.bottom, 40)
            }
        }
        // ── Tour: collect spotlight target frames ──────────────────────────────
        .onPreferenceChange(TourFrameKey.self) { frames in
            tourFrames.merge(frames) { _, new in new }
        }
        // ── Tour: auto-advance when Settings sheet opens ───────────────────────
        .onChange(of: showSettings) { isOpen in
            if isOpen { tour.advancePast(.tapSettings) }
        }
        // ── Tour: auto-advance when Author directory opens ─────────────────────
        .onChange(of: showAuthorDirectory) { isOpen in
            if isOpen { tour.advancePast(.tapAuthor) }
        }
        // ── Tour: auto-advance when Operator directory opens ───────────────────
        .onChange(of: showOperatorDirectory) { isOpen in
            if isOpen { tour.advancePast(.tapOperator) }
        }
        // ── Tour overlay (home-screen steps) ──────────────────────────────────
        .overlay {
            if tour.isActive && tour.currentStep.screen == .home {
                CoachMarkOverlay(
                    step:       tour.currentStep,
                    targetRect: tourFrames[tour.currentStep],
                    ownerName:  tour.ownerName,
                    onNext:     {
                        // For navigation-gating spotlight steps, open the target screen.
                        // The existing onChange handlers call advancePast(), which advances
                        // the step — so we must NOT also call tour.advance() here or the
                        // step would jump twice.
                        switch tour.currentStep {
                        case .tapSettings:  showSettings          = true
                        case .tapAuthor:    showAuthorDirectory   = true
                        case .tapOperator:  showOperatorDirectory = true
                        default:            tour.advance()
                        }
                    },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: tour.currentStep)
            }
        }
        // Author: directory → hub → (QR gate | direct) → AuthorModeView / LocTagAuthorView
        .fullScreenCover(isPresented: $showAuthorDirectory) {
            AnchorDirectoryView(
                mode: .author,
                onSessionReady: { anchor, tags in
                    showAuthorDirectory = false
                    appState.activeAnchor = anchor
                    appState.activeTags   = tags
                    appState.mode = anchor.anchorType == .locTag ? .locTagAuthor : .author
                },
                onCancel: { showAuthorDirectory = false }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        // Operator: directory → hub → (QR gate | direct) → OperatorModeView / LocTagOperatorView
        .fullScreenCover(isPresented: $showOperatorDirectory) {
            AnchorDirectoryView(
                mode: .operator,
                onSessionReady: { anchor, tags in
                    showOperatorDirectory = false
                    appState.activeAnchor = anchor
                    appState.activeTags   = tags
                    appState.mode = anchor.anchorType == .locTag ? .locTagOperator : .operator
                },
                onCancel: { showOperatorDirectory = false }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        // Continue: hub → QR gate → AuthorModeView (skips directory)
        // AnchorHubView doesn't carry its own NavigationStack, so we wrap it here.
        .fullScreenCover(item: $hubResumeAnchor) { anchor in
            NavigationStack {
                Group {
                    if anchor.anchorType == .loto {
                        ILOTOHubView(anchor: anchor, onBack: { hubResumeAnchor = nil })
                    } else {
                        AnchorHubView(
                            anchor: anchor,
                            mode: .author,
                            onSessionReady: { a, tags in
                                hubResumeAnchor = nil
                                appState.activeAnchor = a
                                appState.activeTags   = tags
                                appState.mode = .author
                            },
                            onBack: { hubResumeAnchor = nil }
                        )
                    }
                }
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
            }
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
        }
        .sheet(isPresented: $showOnboarding) {
            OnboardingSheet(context: .home)
        }
        // Share Anchor QR sheet — opened from the home-screen ShareQRCard
        .sheet(isPresented: $showQRSheet, onDismiss: { qrAnchor = nil; qrKeyB64 = nil }) {
            if let anchor = qrAnchor, let key = qrKeyB64 {
                QRGeneratorView(anchor: anchor, encryptionKey: key)
            }
        }
        .onAppear {
            // Load last Author session for "Continue" card
            lastSession = appState.loadLastAuthorSession()

            // Guided tour: auto-start on very first launch (takes priority over FTUE home page)
            if settings.guidedTourEnabled && !settings.guidedTourSeen {
                settings.guidedTourSeen = true
                // Small delay so the view is fully laid out before spotlighting
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    tour.start()
                }
            } else if settings.ftueEnabled && !settings.ftueHomeSeen {
                // Fallback: show swipeable FTUE on first entry when tour is disabled
                settings.ftueHomeSeen = true
                showOnboarding = true
            }

            guard settings.isConfigured, !appState.connectionState.isConnected else { return }
            isTesting = true
            appState.connectionState = .checking
            let client = SIBClient(settings: settings)
            Task {
                do { try await client.testConnection(); appState.connectionState = .connected }
                catch { appState.connectionState = .failed(error.localizedDescription) }
                isTesting = false
            }
        }
    }

    // ── Load anchor for home-screen QR share ─────────────────────────────────

    private func loadQRAnchor(_ session: LastAuthorSession) async {
        isLoadingQR = true
        qrLoadError = nil
        let client = SIBClient(settings: settings)
        do {
            let anchor = try await client.fetchAnchor(id: session.anchorId)
            guard let key = AnchorEncryption.loadExistingKey(anchorId: session.anchorId) else {
                qrLoadError = "Encryption key not found — open Author mode first."
                isLoadingQR = false
                return
            }
            qrAnchor  = anchor
            qrKeyB64  = AnchorEncryption.base64(for: key)
            showQRSheet = true
        } catch {
            qrLoadError = "Could not load anchor: \(error.localizedDescription)"
        }
        isLoadingQR = false
    }

    // ── Resume last Author session ────────────────────────────────────────────
    // Phase 3: navigates to AnchorHubView directly (QR scan still required to
    // lock origin — no session entry bypasses the QR gate).

    private func resumeLastSession(_ saved: LastAuthorSession) async {
        isResuming = true
        let client = SIBClient(settings: settings)
        do {
            let anchor = try await client.fetchAnchor(id: saved.anchorId)
            let tags   = try await client.fetchTags(anchorId: saved.anchorId)
            // Pre-populate state so AnchorHubView renders trained badges correctly
            appState.activeTags    = tags
            appState.trainedTagIds = Set(saved.trainedTagIds)
            // Pre-cache encryption key so hub's QR share works immediately
            if appState.anchorEncryptionKey == nil,
               let kbKey = AnchorEncryption.loadExistingKey(anchorId: anchor.id) {
                appState.anchorEncryptionKey = kbKey
            }
            isResuming = false
            // Navigate to hub — user still must scan QR to lock origin
            hubResumeAnchor = anchor
        } catch {
            resumeError = "Resume failed: \(error.localizedDescription)"
            isResuming  = false
        }
    }

    private var dotColor: Color {
        switch appState.connectionState {
        case .connected: return .green
        case .failed:    return .red
        case .checking:  return .orange
        case .unknown:   return .gray
        }
    }

    private var statusText: String {
        switch appState.connectionState {
        case .connected:        return "SIB Connected · \(settings.normalizedBaseURL)"
        case .failed(let err):  return "Unreachable · \(err)"
        case .checking:         return "Connecting…"
        case .unknown:          return settings.isConfigured ? "Not tested" : "Not configured"
        }
    }
}

// ── Continue session card ─────────────────────────────────────────────────────

private struct ContinueSessionCard: View {
    let session:   LastAuthorSession
    let isLoading: Bool
    let error:     String?
    let onContinue: () -> Void
    let onDiscard:  () -> Void

    private var relativeDate: String {
        guard let date = ISO8601DateFormatter().date(from: session.savedAt) else { return session.savedAt }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "arrow.counterclockwise.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(.blue)

            VStack(alignment: .leading, spacing: 3) {
                Text("Continue Author Session")
                    .font(.subheadline.bold())
                    .foregroundColor(.white)
                Text("\(session.assetId) · \(session.trainedTagIds.count) trained · \(relativeDate)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
            }

            Spacer()

            if isLoading {
                ProgressView().tint(.white).scaleEffect(0.8)
            } else {
                Button { onDiscard() } label: {
                    Image(systemName: "xmark")
                        .font(.caption.bold())
                        .foregroundColor(.white.opacity(0.4))
                        .padding(6)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Color.blue.opacity(0.15))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.blue.opacity(0.35), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .contentShape(Rectangle())
        .onTapGesture { if !isLoading { onContinue() } }
    }
}

// ── Share Anchor QR card ──────────────────────────────────────────────────────
// Shown on the home screen when the device's Keychain holds a key for the last
// Author session anchor — lets the Author distribute the app-generated QR
// (with embedded encryption key) without re-entering Author mode.

private struct ShareQRCard: View {
    let session:   LastAuthorSession
    let isLoading: Bool
    let error:     String?
    let onShare:   () -> Void

    var body: some View {
        Button(action: onShare) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.indigo.opacity(0.18))
                        .frame(width: 44, height: 44)
                    if isLoading {
                        ProgressView().tint(.indigo).scaleEffect(0.75)
                    } else {
                        Image(systemName: "qrcode")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.indigo)
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text("Share Anchor QR")
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                    Text(error ?? "\(session.assetId) · tap to generate team QR")
                        .font(.caption)
                        .foregroundColor(error != nil ? .red : .white.opacity(0.55))
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: "square.and.arrow.up")
                    .font(.caption.bold())
                    .foregroundColor(.indigo.opacity(0.8))
            }
            .padding(16)
            .background(Color.indigo.opacity(0.10))
            .overlay(RoundedRectangle(cornerRadius: 18)
                .stroke(Color.indigo.opacity(0.30), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }
}

// ── Mode button ───────────────────────────────────────────────────────────────

private struct ModeButton: View {
    let title: String
    let subtitle: String
    let icon: String
    let accentColor: Color
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 18) {
                Image(systemName: icon)
                    .font(.system(size: 32))
                    .foregroundStyle(isEnabled ? accentColor : .gray)
                    .frame(width: 44)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                        .foregroundColor(isEnabled ? .white : .gray)
                    Text(subtitle).font(.subheadline).foregroundColor(.white.opacity(0.5))
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(.white.opacity(0.3))
            }
            .padding(20)
            .background(Color.white.opacity(isEnabled ? 0.08 : 0.03))
            .overlay(RoundedRectangle(cornerRadius: 18)
                .stroke(isEnabled ? accentColor.opacity(0.3) : Color.clear, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 18))
        }
        .disabled(!isEnabled)
    }
}
