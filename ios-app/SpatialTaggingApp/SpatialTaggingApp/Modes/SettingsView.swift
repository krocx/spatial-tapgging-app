// SettingsView.swift — Phase 2.5 + server quick-select + guided tour overlay
// Configure SIB URL, API key, asset ID, test connectivity, and export debug logs.

import SwiftUI

// ── Server presets ────────────────────────────────────────────────────────────

enum ServerPreset: CaseIterable, Identifiable {
    case internalServer
    case render

    var id: Self { self }

    var displayName: String {
        switch self {
        case .internalServer: return "Internal Server"
        case .render:         return "Render"
        }
    }

    var icon: String {
        switch self {
        case .internalServer: return "building.2"
        case .render:         return "cloud.fill"
        }
    }

    var accentColor: Color {
        switch self {
        case .internalServer: return .blue
        case .render:         return .purple
        }
    }

    var url: String {
        switch self {
        case .internalServer: return "https://dca-qa-330.amat.com:447"
        case .render:         return "https://sib-server-hiul.onrender.com"
        }
    }

    /// API key to inject (empty = no key required)
    var apiKey: String {
        switch self {
        case .internalServer: return ""
        case .render:         return "sk-sib-a8f3d2e1b4c7f9a0d3e6b2c5f8a1d4e7"
        }
    }

    /// Short note shown below the preset buttons
    var footnote: String {
        switch self {
        case .internalServer:
            return "Requires Minuteman VPN / internal network access. No API key needed."
        case .render:
            return "Cloud-hosted SIB instance on Render. API key pre-filled."
        }
    }
}

// ── View ──────────────────────────────────────────────────────────────────────

struct SettingsView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager
    @Environment(\.dismiss) private var dismiss

    @State private var draftURL        = ""
    @State private var draftApiKey     = ""
    @State private var draftAuthorName = ""

    // UAM access verification (RBAC ahead of SSO)
    @State private var isVerifyingAccess = false
    @State private var accessStatus: String? = nil

    /// POST /uam/login with email + employee ID; caches token + role for
    /// offline gating. The server re-reads the live role on every request.
    private func verifyAccess() async {
        isVerifyingAccess = true
        accessStatus = nil
        do {
            let result = try await SIBClient(settings: settings).uamLogin(
                email:      settings.workEmail.trimmingCharacters(in: .whitespaces),
                employeeId: settings.employeeId.trimmingCharacters(in: .whitespaces))
            settings.uamToken = result.token
            settings.uamRole  = result.user.role
            settings.uamUserName = result.user.name
            settings.uamProducts = (result.user.products ?? []).joined(separator: ",")
            accessStatus = "✓ Verified — signed in as \(result.user.name) (\(result.user.role.capitalized))"
        } catch {
            settings.uamToken = ""
            settings.uamRole  = ""
            accessStatus = friendlyMessage(for: error)
        }
        isVerifyingAccess = false
    }
    @State private var showApiKey   = false
    @State private var isTesting    = false
    @State private var testResult:  Result<Void, Error>? = nil
    @State private var activePreset: ServerPreset? = nil

    // Debug log export
    @State private var showShareSheet = false
    @State private var exportURLs:    [URL] = []

    // Tour frame capture
    @State private var tourFrames: [TourStep: CGRect] = [:]

    var body: some View {
        NavigationStack {
            Form {

                // ── Server quick-select ────────────────────────────────────────
                Section {
                    // Quick-select chips
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Quick Select")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack(spacing: 10) {
                            ForEach(ServerPreset.allCases) { preset in
                                Button {
                                    applyPreset(preset)
                                } label: {
                                    Label(preset.displayName, systemImage: preset.icon)
                                        .font(.subheadline.weight(.medium))
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 8)
                                        .background(
                                            activePreset == preset
                                            ? preset.accentColor
                                            : preset.accentColor.opacity(0.12)
                                        )
                                        .foregroundColor(
                                            activePreset == preset ? .white : preset.accentColor
                                        )
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                            Spacer()
                        }
                        .background(
                            GeometryReader { geo in
                                Color.clear.preference(
                                    key: TourFrameKey.self,
                                    value: [.selectServer: geo.frame(in: .global)]
                                )
                            }
                        )

                        if let preset = activePreset {
                            Text(preset.footnote)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)

                    // Manual URL entry
                    HStack {
                        Image(systemName: "server.rack").foregroundColor(.secondary).frame(width: 22)
                        TextField("https://sib.yourcompany.com", text: $draftURL)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .onChange(of: draftURL) { newVal in
                                // Deselect preset if user manually edits the URL
                                if let p = activePreset, newVal != p.url {
                                    activePreset = nil
                                }
                            }
                    }
                } header: {
                    Text("SIB Server URL")
                } footer: {
                    Text("Local dev: http://192.168.1.x:3001 (same WiFi). Production: your Render HTTPS URL.")
                }

                // ── API Key ────────────────────────────────────────────────────
                Section {
                    HStack {
                        Image(systemName: "key.fill").foregroundColor(.secondary).frame(width: 22)
                        Group {
                            if showApiKey {
                                TextField("Leave empty for local dev", text: $draftApiKey)
                            } else {
                                SecureField("Leave empty for local dev", text: $draftApiKey)
                            }
                        }
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        Button {
                            showApiKey.toggle()
                        } label: {
                            Image(systemName: showApiKey ? "eye.slash" : "eye")
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("API Key (X-API-Key)")
                } footer: {
                    Text("Set in Render → Environment → SIB_API_KEY. Leave blank when running locally without a key.")
                }

                // ── Identity ──────────────────────────────────────────────────
                Section {
                    // Contextual nudge shown only during the guided tour saveSettings step
                    if tour.isActive && tour.currentStep == .saveSettings {
                        HStack(spacing: 8) {
                            Image(systemName: "person.badge.key.fill")
                                .foregroundStyle(.orange)
                            Text("Verify your Author Name before saving")
                                .font(.caption.bold())
                                .foregroundStyle(.orange)
                        }
                        .listRowBackground(Color.orange.opacity(0.08))
                    }

                    HStack {
                        Image(systemName: "person.fill").foregroundColor(.secondary).frame(width: 22)
                        TextField("Your name", text: $draftAuthorName)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.words)
                    }

                    // ── UAM access (RBAC ahead of SSO) ────────────────────────
                    HStack {
                        Image(systemName: "envelope.fill").foregroundColor(.secondary).frame(width: 22)
                        TextField("Work email", text: Binding(
                            get: { settings.workEmail }, set: { settings.workEmail = $0 }))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                    }
                    HStack {
                        Image(systemName: "number").foregroundColor(.secondary).frame(width: 22)
                        TextField("Employee ID", text: Binding(
                            get: { settings.employeeId }, set: { settings.employeeId = $0 }))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                    HStack {
                        Button {
                            Task { await verifyAccess() }
                        } label: {
                            if isVerifyingAccess {
                                ProgressView().scaleEffect(0.8)
                            } else {
                                Label(settings.uamSignedIn ? "Re-verify Access" : "Verify Access",
                                      systemImage: "person.badge.shield.checkmark")
                            }
                        }
                        .disabled(settings.workEmail.trimmingCharacters(in: .whitespaces).isEmpty ||
                                  settings.employeeId.trimmingCharacters(in: .whitespaces).isEmpty ||
                                  isVerifyingAccess)
                        Spacer()
                        if settings.uamSignedIn {
                            Text(settings.uamRole.capitalized)
                                .font(.caption.bold())
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(settings.isTechnician ? Color.green.opacity(0.2) : Color.blue.opacity(0.2))
                                .clipShape(Capsule())
                        }
                    }
                    if let msg = accessStatus {
                        Text(msg)
                            .font(.caption)
                            .foregroundStyle(msg.hasPrefix("✓") ? Color.green : Color.red)
                    }
                    Toggle(isOn: Binding(
                        get: { settings.showSharedAnchors },
                        set: { settings.showSharedAnchors = $0 }
                    )) {
                        Label("Show Shared Anchors", systemImage: "person.2.fill")
                    }
                } header: {
                    Text("Identity")
                } footer: {
                    Text("Auto-detected from your device name — update it here if needed. This name tags every anchor you create and determines what appears under \"My Anchors\" in the directory.")
                }

                // ── Test Connection ────────────────────────────────────────────
                Section {
                    Button {
                        guard !isTesting else { return }
                        isTesting = true; testResult = nil
                        let temp = AppSettings()
                        temp.sibBaseURL = draftURL
                        temp.apiKey     = draftApiKey
                        let client = SIBClient(settings: temp)
                        Task {
                            do {
                                try await client.testConnection()
                                testResult = .success(())
                                // Tour: auto-advance when connection succeeds
                                tour.advancePast(.testConnection)
                            } catch {
                                testResult = .failure(error)
                            }
                            isTesting = false
                        }
                    } label: {
                        HStack {
                            if isTesting {
                                ProgressView().scaleEffect(0.8); Text("Testing…")
                            } else {
                                Image(systemName: "network"); Text("Test Connection")
                            }
                            Spacer()
                            if let r = testResult {
                                switch r {
                                case .success:
                                    Label("Connected", systemImage: "checkmark.circle.fill")
                                        .foregroundColor(.green).font(.subheadline)
                                case .failure(let e):
                                    Label(e.localizedDescription, systemImage: "xmark.circle.fill")
                                        .foregroundColor(.red).font(.caption).lineLimit(1)
                                }
                            }
                        }
                    }
                    .disabled(isTesting || draftURL.trimmingCharacters(in: .whitespaces).isEmpty)
                    .background(
                        GeometryReader { geo in
                            Color.clear.preference(
                                key: TourFrameKey.self,
                                value: [.testConnection: geo.frame(in: .global)]
                            )
                        }
                    )
                }

                // ── Debug log export ───────────────────────────────────────────
                Section("Debug") {
                    let logs = InspectionDebugLog.shared.allLogURLs()
                    if logs.isEmpty {
                        Label("No inspection logs yet", systemImage: "doc.text")
                            .foregroundStyle(.secondary)
                    } else {
                        Button {
                            exportURLs    = logs
                            showShareSheet = true
                        } label: {
                            Label("Export \(logs.count) Inspection Log\(logs.count == 1 ? "" : "s")",
                                  systemImage: "square.and.arrow.up")
                        }
                        Text("Logs contain per-tag SSIM / feature print / depth / alignment scores. Share with your developer to tune thresholds.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                // ── Introduction (FTUE) ────────────────────────────────────────
                Section {
                    Toggle(isOn: Binding(
                        get: { settings.ftueEnabled },
                        set: { settings.ftueEnabled = $0 }
                    )) {
                        Label("Show mode walkthrough on first entry", systemImage: "hand.wave.fill")
                    }
                    Toggle(isOn: Binding(
                        get: { settings.guidedTourEnabled },
                        set: { settings.guidedTourEnabled = $0 }
                    )) {
                        Label("Show guided tour on first launch", systemImage: "map.fill")
                    }
                    if settings.ftueHomeSeen || settings.ftueAuthorSeen || settings.ftueOperatorSeen {
                        Button(role: .destructive) {
                            settings.resetFTUE()
                        } label: {
                            Label("Reset mode walkthroughs", systemImage: "arrow.counterclockwise")
                        }
                    }
                    if settings.guidedTourSeen {
                        Button(role: .destructive) {
                            settings.resetGuidedTour()
                        } label: {
                            Label("Reset guided tour", systemImage: "arrow.counterclockwise")
                        }
                    }
                } header: {
                    Text("Introduction")
                } footer: {
                    Text("The guided tour walks you through the full app flow step by step. Mode walkthroughs appear when first entering Author or Operator mode. Tap ? in any mode to replay at any time.")
                }

                // ── App Info ───────────────────────────────────────────────────
                Section("App Info") {
                    LabeledContent("Version", value: AppVersion.current)
                    LabeledContent("Stack",   value: "Swift + ARKit + CryptoKit + SIB v0.3")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        settings.sibBaseURL = draftURL.trimmingCharacters(in: .whitespaces)
                        settings.apiKey     = draftApiKey.trimmingCharacters(in: .whitespaces)
                        let newName = draftAuthorName.trimmingCharacters(in: .whitespaces)
                        if !newName.isEmpty {
                            let oldName = settings.authorName
                            // If the name changed, archive the old one so anchors created
                            // under it still appear under "My Anchors" in the directory.
                            if newName != oldName && !oldName.isEmpty &&
                               !settings.previousAuthorNames.contains(oldName) {
                                settings.previousAuthorNames.append(oldName)
                            }
                            settings.authorName = newName
                        }
                        // Mark confirmed — dismisses the home-screen name nudge.
                        settings.authorNameConfirmed = true
                        // Tour: advance past saveSettings before dismissing
                        tour.advancePast(.saveSettings)
                        dismiss()
                    }
                    .bold()
                    .background(
                        GeometryReader { geo in
                            Color.clear.preference(
                                key: TourFrameKey.self,
                                value: [.saveSettings: geo.frame(in: .global)]
                            )
                        }
                    )
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                draftURL        = settings.sibBaseURL
                draftApiKey     = settings.apiKey
                draftAuthorName = settings.authorName
                // Reflect active preset based on current URL
                activePreset = ServerPreset.allCases.first { $0.url == draftURL }
            }
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(items: exportURLs)
            }
            // Collect tour target frames
            .onPreferenceChange(TourFrameKey.self) { frames in
                tourFrames.merge(frames) { _, new in new }
            }
        }
        .overlay {
            if tour.isActive && tour.currentStep.screen == .settings {
                CoachMarkOverlay(
                    step:       tour.currentStep,
                    targetRect: tourFrames[tour.currentStep],
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.opacity)
            }
        }
    }

    // ── Preset selection ──────────────────────────────────────────────────────

    private func applyPreset(_ preset: ServerPreset) {
        withAnimation(.easeInOut(duration: 0.2)) {
            activePreset = preset
            draftURL     = preset.url
            draftApiKey  = preset.apiKey
        }
        // Tour: auto-advance past selectServer when any preset is tapped
        tour.advancePast(.selectServer)
    }
}

// ShareSheet is defined in QRGeneratorView.swift — used here via that shared definition.
