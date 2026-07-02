// SettingsView.swift — Phase 2.5
// Configure SIB URL, API key, asset ID, test connectivity, and export debug logs.

import SwiftUI

struct SettingsView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    @State private var draftURL     = ""
    @State private var draftAssetId = ""
    @State private var draftApiKey  = ""
    @State private var showApiKey   = false
    @State private var isTesting    = false
    @State private var testResult:  Result<Void, Error>? = nil

    // Debug log export
    @State private var showShareSheet = false
    @State private var exportURLs:    [URL] = []

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Image(systemName: "server.rack").foregroundColor(.secondary).frame(width: 22)
                        TextField("https://sib.yourcompany.com", text: $draftURL)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                    }
                } header: {
                    Text("SIB Server URL")
                } footer: {
                    Text("Local dev: http://192.168.1.x:3001 (same WiFi). Production: your Render HTTPS URL.")
                }

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

                Section {
                    Button {
                        guard !isTesting else { return }
                        isTesting = true; testResult = nil
                        let temp = AppSettings()
                        temp.sibBaseURL = draftURL
                        temp.apiKey     = draftApiKey
                        let client = SIBClient(settings: temp)
                        Task {
                            do { try await client.testConnection(); testResult = .success(()) }
                            catch { testResult = .failure(error) }
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
                }

                // ── Debug log export ──────────────────────────────────────────
                // Each inspection session writes a structured .log file to the
                // app's Documents/InspectionLogs/ folder containing per-tag metric
                // breakdowns (ssim, featurePrint, depth, alignment angle, OCR, final).
                // Share via AirDrop or Files to analyse algorithm performance.
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

                // ── Introduction (FTUE) ───────────────────────────────────
                Section {
                    Toggle(isOn: Binding(
                        get: { settings.ftueEnabled },
                        set: { settings.ftueEnabled = $0 }
                    )) {
                        Label("Show introduction on first entry", systemImage: "hand.wave.fill")
                    }
                    if settings.ftueHomeSeen || settings.ftueAuthorSeen || settings.ftueOperatorSeen {
                        Button(role: .destructive) {
                            settings.resetFTUE()
                        } label: {
                            Label("Reset introduction", systemImage: "arrow.counterclockwise")
                        }
                    }
                } header: {
                    Text("Introduction")
                } footer: {
                    Text("When enabled, a walkthrough appears the first time you enter each mode. Tap ? in any mode to replay it any time.")
                }

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
                        dismiss()
                    }.bold()
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                draftURL     = settings.sibBaseURL
                draftAssetId = settings.defaultAssetId
                draftApiKey  = settings.apiKey
            }
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(items: exportURLs)
            }
        }
    }
}

// ShareSheet is defined in QRGeneratorView.swift — used here via that shared definition.
