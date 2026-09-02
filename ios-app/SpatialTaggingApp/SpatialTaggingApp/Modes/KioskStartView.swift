// KioskStartView.swift — shift start screen for shared (kiosk) iPads.
//
// Shown at launch whenever the server's allow-list is active and either no
// one is signed in or no Production # has been set for the shift. Technicians
// enter ONLY their employee ID — the server resolves name/email/role from the
// allow-list (POST /uam/login, kiosk path) — plus the Production # (chamber /
// system) they will work on. Both travel with every AR OMS session and land
// in the usage log.
//
// A signed-in user who only needs to set/change the Production # sees a
// greeting instead of the ID field ("Not you?" switches accounts).

import SwiftUI

struct KioskStartView: View {
    @EnvironmentObject private var settings: AppSettings

    /// Called when the shift is ready (signed in + production # set).
    let onDone: () -> Void

    @State private var employeeIdInput = ""
    @State private var productionInput = ""
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

    private var identified: Bool { settings.uamSignedIn && !switchingUser }

    /// E1: the work-context label follows the user's product. A returning
    /// GembaWalk-only user is asked for an audit/project name; everyone else
    /// (and fresh sign-ins, whose products are unknown yet) sees Production #.
    private var contextLabel: String {
        identified && settings.uamProducts == "gemba"
            ? "Audit / project name"
            : "Production # (chamber / system)"
    }

    /// Identified users only set a (local) Production # — no server needed.
    private var needsServer: Bool { !identified }

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
                    Text(identified ? "Set the system you're working on today."
                                    : "Enter your employee ID to begin.")
                        .font(.subheadline).foregroundColor(.white.opacity(0.6))
                }

                VStack(spacing: 14) {
                    if !identified {
                        kioskField("Employee ID", text: $employeeIdInput,
                                   icon: "person.text.rectangle", contentType: .username)
                    }
                    kioskField(contextLabel, text: $productionInput,
                               icon: "number.square", contentType: nil)
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
                        Text(isVerifying ? "Verifying…" : "Begin Work")
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
        .onAppear { productionInput = settings.productionNumber }
        .task { await connect() }
        .interactiveDismissDisabled()   // the gate is the point — no swipe-away
    }

    private var beginDisabled: Bool {
        isVerifying
            || (needsServer && link != .ready)
            || productionInput.trimmingCharacters(in: .whitespaces).isEmpty
            || (!identified && employeeIdInput.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    private func begin() {
        errorText = nil
        let production = productionInput.trimmingCharacters(in: .whitespaces)

        // Already identified — just (re)set the Production # for the shift.
        if identified {
            settings.productionNumber = production
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
                settings.productionNumber = production
                isVerifying = false
                onDone()
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
