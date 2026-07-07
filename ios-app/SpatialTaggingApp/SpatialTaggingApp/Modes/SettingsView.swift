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

    @State private var draftURL     = ""
    @State private var draftAssetId = ""
    @State private var draftApiKey  = ""
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

                // ── Default Asset ID ───────────────────────────────────────────
                Section {
                    HStack {
                        Image(systemName: "tag").foregroundColor(.secondary).frame(width: 22)
                        TextField("e.g. eq-001", text: $draftAssetId)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                } header: {
                    Text("Default Asset ID")
                } footer: {
                    Text("Used when creating new anchors. Can be overridden by the QR payload.")
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
                        settings.sibBaseURL     = draftURL.trimmingCharacters(in: .whitespaces)
                        settings.defaultAssetId = draftAssetId.trimmingCharacters(in: .whitespaces)
                        settings.apiKey         = draftApiKey.trimmingCharacters(in: .whitespaces)
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
                draftURL     = settings.sibBaseURL
                draftAssetId = settings.defaultAssetId
                draftApiKey  = settings.apiKey
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
        // Tour overlay on NavigationStack root — canvas origin (0,0) aligns with
        // global coordinate space so spotlight holes land on the correct elements.
        // (If placed on the Form instead, the canvas starts 44pt below the nav bar,
        //  shifting every spotlight one row too low.)
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
