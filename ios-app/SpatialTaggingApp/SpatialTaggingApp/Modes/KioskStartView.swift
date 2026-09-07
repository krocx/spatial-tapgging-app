// KioskStartView.swift — shift start screen for shared (kiosk) iPads.
//
// Two steps (C2, 2026.4.45):
//   1. Identify — employee ID only; the server resolves name/email/role from
//      the allow-list (POST /uam/login, kiosk path).
//   2. Context — depends on who you are:
//        • Technician → Production / Slot # (free text now; MES later). The
//          chamber configuration is NOT chosen here — the chamber's QR
//          resolves it on scan, so there is nothing to get wrong.
//        • Engineer+  → "I'm authoring" (pick the Chamber Configuration to
//          author against) or "I'm operating" (Production #, like a
//          technician). GembaWalk-only users see an audit/project name.
// The chosen context travels with every AR OMS session and lands in the
// usage log. "Not you?" switches accounts.

import SwiftUI

struct KioskStartView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var tour:     GuidedTourManager

    /// Called when the shift is ready (signed in + production # set).
    let onDone: () -> Void

    @State private var employeeIdInput = ""
    @State private var productionInput = ""
    // C2: authoring context
    @State private var intent: String = "operate"          // "author" | "operate"
    @State private var configs: [ChamberConfig] = []
    @State private var configsLoading = false
    @State private var selectedConfigId: String = ""
    @State private var showNewConfig = false
    @State private var newConfigCode = ""
    @State private var newConfigName = ""
    @State private var isVerifying     = false
    @State private var errorText: String? = nil

    /// Server link state — the gate owns the connection. The screen shows
    /// INSTANTLY at launch; fields unlock when the server answers. Render
    /// cold-starts can take ~30 s, so the probe retries before giving up.
    private enum Link { case connecting, ready, offline }
    @State private var link: Link = .connecting
    /// Local override so "Not you?" can switch users without touching the
    /// stored session until the new sign-in succeeds.
    @State private var switchingUser = false
    /// Settings from the gate: change server / test connection BEFORE signing
    /// in (kiosk iPads often need repointing without an identified user).
    @State private var showSettings = false

    private var identified: Bool { settings.uamSignedIn && !switchingUser }

    /// E1: the work-context label follows the user's product. A returning
    /// GembaWalk-only user is asked for an audit/project name; everyone else
    /// (and fresh sign-ins, whose products are unknown yet) sees Production #.
    private var contextLabel: String {
        identified && settings.uamProducts == "gemba"
            ? "Audit / project name"
            : "Production # (chamber / system)"
    }

    /// Identified users only set a (local) Production # — no server needed
    /// (the config list is fetched opportunistically; a stale list still works).
    private var needsServer: Bool { !identified }

    /// C2: authoring is offered to engineers and above only.
    private var canAuthor: Bool { identified && !settings.isTechnician }
    private var authoring: Bool { canAuthor && intent == "author" }

    private func connect() async {
        guard needsServer else { link = .ready; return }
        link = .connecting
        for attempt in 1...4 {
            do {
                let active = try await SIBClient(settings: settings).uamActive()
                if active {
                    link = .ready
                } else {
                    // UAM dormant on this server — the gate does not apply.
                    link = .ready
                    onDone()
                }
                return
            } catch {
                print("KIOSK connect attempt \(attempt) failed — \(error.localizedDescription)")
                if attempt < 4 { try? await Task.sleep(nanoseconds: 4_000_000_000) }
            }
        }
        link = .offline
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(white: 0.07), Color(white: 0.12)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()

                Image(systemName: "person.badge.shield.checkmark.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(LinearGradient(colors: [.blue, .cyan],
                                                    startPoint: .top, endPoint: .bottom))

                VStack(spacing: 6) {
                    Text(identified ? "Welcome back\(settings.uamUserName.isEmpty ? "" : ", \(settings.uamUserName)")"
                                    : "Start your shift")
                        .font(.largeTitle.bold()).foregroundColor(.white)
                    Text(!identified ? "Enter your employee ID to begin."
                         : authoring  ? "Choose the chamber configuration you're authoring for."
                         : "Set the production / slot you're working on today.")
                        .font(.subheadline).foregroundColor(.white.opacity(0.6))
                }

                VStack(spacing: 14) {
                    if !identified {
                        kioskField("Employee ID", text: $employeeIdInput,
                                   icon: "person.text.rectangle", contentType: .username)
                    } else {
                        // C2: engineers+ pick the hat they wear this shift.
                        if canAuthor {
                            Picker("", selection: $intent) {
                                Label("I'm authoring", systemImage: "pencil.and.outline").tag("author")
                                Label("I'm operating", systemImage: "play.circle").tag("operate")
                            }
                            .pickerStyle(.segmented)
                            .onChange(of: intent) { v in if v == "author" { Task { await loadConfigs() } } }
                        }
                        if authoring {
                            configPicker
                        } else {
                            kioskField(contextLabel, text: $productionInput,
                                       icon: "number.square", contentType: nil)
                            if settings.uamProducts != "gemba" {
                                Text("The chamber configuration comes from the QR you scan — no need to pick it.")
                                    .font(.caption2).foregroundColor(.white.opacity(0.4))
                                    .multilineTextAlignment(.center)
                            }
                        }
                    }
                }
                .frame(maxWidth: 420)

                // ── Server link status — only shown while it matters ──
                if needsServer && link != .ready {
                    HStack(spacing: 8) {
                        if link == .connecting {
                            ProgressView().tint(.white).scaleEffect(0.8)
                            Text("Connecting to server… this can take a moment after idle.")
                        } else {
                            Image(systemName: "wifi.exclamationmark").foregroundColor(.orange)
                            Text("Can't reach the server.")
                            Button("Retry") { Task { await connect() } }
                                .fontWeight(.semibold).foregroundColor(.cyan)
                        }
                    }
                    .font(.footnote).foregroundColor(.white.opacity(0.6))
                    .frame(maxWidth: 420)
                }

                if let errorText {
                    Text(errorText)
                        .font(.footnote).foregroundColor(.orange)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                }

                Button(action: begin) {
                    HStack {
                        if isVerifying { ProgressView().tint(.white) }
                        Text(isVerifying ? "Verifying…" : !identified ? "Continue" : authoring ? "Start Authoring" : "Begin Work")
                            .font(.headline)
                    }
                    .frame(maxWidth: 420)
                    .padding(.vertical, 14)
                    .background(beginDisabled ? Color.gray.opacity(0.4) : Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(14)
                }
                .disabled(beginDisabled)

                if identified {
                    Button("Not you? Switch user") {
                        switchingUser = true
                        employeeIdInput = ""
                        errorText = nil
                        Task { await connect() }
                    }
                    .font(.subheadline).foregroundColor(.cyan)
                }

                Spacer()

                Text("Access is limited to the approved technician list.\nAsk your supervisor if your ID is not recognised.")
                    .font(.caption2).foregroundColor(.white.opacity(0.35))
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
        }
        .overlay(alignment: .topTrailing) {
            Button { showSettings = true } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(12)
                    .background(Color.white.opacity(0.08), in: Circle())
            }
            .padding(.top, 18).padding(.trailing, 18)
            .accessibilityLabel("Server settings")
        }
        .sheet(isPresented: $showSettings, onDismiss: {
            // The server URL may have changed — re-probe from scratch so the
            // link status (and the UAM-dormant auto-skip) reflect the new host.
            Task { await connect() }
        }) {
            SettingsView()
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
        }
        .onAppear {
            productionInput  = settings.productionNumber
            intent           = settings.shiftIntent == "author" ? "author" : "operate"
            selectedConfigId = settings.chamberConfigId
            if identified && !settings.isTechnician { Task { await loadConfigs() } }
        }
        .task { await connect() }
        .interactiveDismissDisabled()   // the gate is the point — no swipe-away
    }

    private var beginDisabled: Bool {
        if isVerifying { return true }
        if !identified {
            return link != .ready || employeeIdInput.trimmingCharacters(in: .whitespaces).isEmpty
        }
        if authoring { return selectedConfigId.isEmpty }
        return productionInput.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func begin() {
        errorText = nil
        let production = productionInput.trimmingCharacters(in: .whitespaces)

        // Already identified — record this shift's context.
        if identified {
            if authoring {
                guard let cfg = configs.first(where: { $0.id == selectedConfigId }) else { return }
                settings.shiftIntent        = "author"
                settings.chamberConfigId    = cfg.id
                settings.chamberConfigLabel = cfg.label
            } else {
                settings.shiftIntent      = "operate"
                settings.productionNumber = production
            }
            onDone()
            return
        }

        let empId = employeeIdInput.trimmingCharacters(in: .whitespaces)
        isVerifying = true
        Task {
            do {
                let r = try await SIBClient(settings: settings).uamLoginKiosk(employeeId: empId)
                settings.uamToken    = r.token
                settings.uamRole     = r.user.role
                settings.uamUserName = r.user.name
                settings.uamProducts = (r.user.products ?? []).joined(separator: ",")
                settings.workEmail   = r.user.email
                settings.employeeId  = empId
                isVerifying   = false
                switchingUser = false
                // Step 2: context. Technicians go straight to Production #;
                // engineers+ choose authoring/operating (default: last choice).
                intent = (r.user.role == "technician") ? "operate"
                       : (settings.shiftIntent == "author" ? "author" : "operate")
                if r.user.role != "technician" { Task { await loadConfigs() } }
            } catch let SIBClientError.httpError(_, msg) {
                isVerifying = false
                errorText = msg
            } catch {
                isVerifying = false
                errorText = "Can't reach the server — check the connection and try again."
            }
        }
    }

    // ── C2: chamber configuration picker ─────────────────────────────────────

    @ViewBuilder
    private var configPicker: some View {
        VStack(spacing: 10) {
            if configsLoading && configs.isEmpty {
                HStack { ProgressView().tint(.white); Text("Loading configurations…") }
                    .font(.footnote).foregroundColor(.white.opacity(0.6))
            } else if configs.isEmpty && !showNewConfig {
                Text("No chamber configurations yet.")
                    .font(.footnote).foregroundColor(.white.opacity(0.6))
            } else {
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 6) {
                        ForEach(configs) { c in
                            Button { selectedConfigId = c.id } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: selectedConfigId == c.id ? "checkmark.circle.fill" : "circle")
                                        .foregroundColor(selectedConfigId == c.id ? .cyan : .white.opacity(0.4))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(c.code).font(.subheadline.bold()).foregroundColor(.white)
                                        Text(c.name).font(.caption).foregroundColor(.white.opacity(0.65))
                                    }
                                    Spacer()
                                    if let n = c.chamberCount {
                                        Text("\(n) chamber\(n == 1 ? "" : "s")")
                                            .font(.caption2).foregroundColor(.white.opacity(0.4))
                                    }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(selectedConfigId == c.id ? Color.cyan.opacity(0.15) : Color.white.opacity(0.06))
                                .cornerRadius(10)
                            }
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
            if showNewConfig {
                HStack(spacing: 8) {
                    kioskField("Code (e.g. PXP-A)", text: $newConfigCode, icon: "tag", contentType: nil)
                        .frame(maxWidth: 150)
                    kioskField("Name", text: $newConfigName, icon: "textformat", contentType: nil)
                }
                HStack {
                    Button("Cancel") { showNewConfig = false }
                        .font(.footnote).foregroundColor(.white.opacity(0.6))
                    Spacer()
                    Button("Add configuration") { Task { await createConfig() } }
                        .font(.footnote.bold()).foregroundColor(.cyan)
                        .disabled(newConfigCode.trimmingCharacters(in: .whitespaces).isEmpty
                                  || newConfigName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                Button { showNewConfig = true } label: {
                    Label("New configuration", systemImage: "plus.circle")
                        .font(.footnote).foregroundColor(.cyan)
                }
            }
        }
    }

    private func loadConfigs() async {
        configsLoading = true
        defer { configsLoading = false }
        if let list = try? await SIBClient(settings: settings).fetchChamberConfigs() {
            configs = list
            if selectedConfigId.isEmpty, configs.count == 1 { selectedConfigId = configs[0].id }
        }
    }

    private func createConfig() async {
        errorText = nil
        do {
            let c = try await SIBClient(settings: settings).createChamberConfig(
                code: newConfigCode.trimmingCharacters(in: .whitespaces),
                name: newConfigName.trimmingCharacters(in: .whitespaces))
            configs.append(c)
            configs.sort { $0.code.localizedCaseInsensitiveCompare($1.code) == .orderedAscending }
            selectedConfigId = c.id
            newConfigCode = ""; newConfigName = ""; showNewConfig = false
        } catch {
            errorText = friendlyMessage(for: error)
        }
    }

    @ViewBuilder
    private func kioskField(_ label: String, text: Binding<String>,
                            icon: String, contentType: UITextContentType?) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundColor(.white.opacity(0.5))
            TextField("", text: text, prompt: Text(label).foregroundColor(.white.opacity(0.35)))
                .foregroundColor(.white)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.characters)
                .textContentType(contentType)
        }
        .padding(14)
        .background(Color.white.opacity(0.08))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.15)))
    }
}
