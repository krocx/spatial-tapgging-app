// KioskStartView.swift — shift start screen for shared (kiosk) iPads.
//
// Identity only (A, 2026.4.46):
//   1. Identify — employee ID; the server resolves name/email/role from the
//      allow-list (POST /uam/login, kiosk path).
//   2. Engineers+ pick the hat they wear this shift (authoring / operating).
// Work context is NOT asked here — the app cannot know which product the
// person will pick. Each product door on the home screen asks for its own
// (Production #, chamber configuration, Test bay #, Project ID), prefilled
// from local memory. "Not you?" switches accounts.

import SwiftUI

struct KioskStartView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var tour:     GuidedTourManager

    /// Called when the shift is ready (signed in + production # set).
    let onDone: () -> Void

    @State private var employeeIdInput = ""
    // C2: authoring context
    @State private var intent: String = "operate"          // "author" | "operate"
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
                         : canAuthor  ? "Are you authoring or operating this shift?"
                         : "You're set — pick what you're doing on the next screen.")
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
                        }
                        // A (2026.4.46): no context here. Production #, chamber
                        // configuration, Test bay # and Project ID are asked by
                        // the product you pick on the home screen.
                        Text("Production #, chamber configuration, test bay or project are asked when you pick what you're working on.")
                            .font(.caption2).foregroundColor(.white.opacity(0.4))
                            .multilineTextAlignment(.center)
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
                        Text(isVerifying ? "Verifying…" : !identified ? "Continue" : authoring ? "Continue as Author" : "Begin Work")
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
            intent = settings.shiftIntent == "author" ? "author" : "operate"
        }
        .task { await connect() }
        .interactiveDismissDisabled()   // the gate is the point — no swipe-away
    }

    private var beginDisabled: Bool {
        if isVerifying { return true }
        if !identified {
            return link != .ready || employeeIdInput.trimmingCharacters(in: .whitespaces).isEmpty
        }
        return false
    }

    private func begin() {
        errorText = nil

        // Already identified — record the hat; context comes at the product door.
        if identified {
            settings.shiftIntent = authoring ? "author" : "operate"
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
                // Technicians have nothing to choose — straight to the home page.
                if r.user.role == "technician" { settings.shiftIntent = "operate"; onDone() }
            } catch let SIBClientError.httpError(_, msg) {
                isVerifying = false
                errorText = msg
            } catch {
                isVerifying = false
                errorText = "Can't reach the server — check the connection and try again."
            }
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
