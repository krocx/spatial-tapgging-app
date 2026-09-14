// GembaWalkSheets.swift — G2/G8 (2026.4.46): the two sheets that bracket a
// Gemba walk.
//
//   GembaWalkStartSheet   — the header the PowerApps tool collected before
//                           the first finding: auditor (kiosk identity, fixed),
//                           Project ID, Organization, BU, Area, Location. Pick
//                           lists come from the Audit Library; "Other…" allows
//                           a typed value. Last values remembered per device.
//                           Lists every open walk on the space — yours to
//                           continue, a colleague's to join (G7). Begin always
//                           creates a walk (every header field is optional) so
//                           no finding is ever logged without a session; the
//                           only exit without one is the offline fallback.
//   GembaWalkSummarySheet — what the PowerApps "Session Summary" showed, plus
//                           counts by category, max risk and the findings list.
//
// Both are plain SwiftUI forms — nothing here touches AR.

import SwiftUI

// ── Start ─────────────────────────────────────────────────────────────────────

struct GembaWalkStartSheet: View {
    let anchor:   Anchor
    /// Findings already on this space with no walk (logged offline or before
    /// this build). Shown so the auditor knows they'll be offered for adoption.
    var orphanCount: Int = 0
    let onStart:  (GembaWalk) -> Void
    /// Offline fallback only (shown after a failed Begin): findings save
    /// without a walk and are offered for adoption on the next session.
    let onOffline: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @ObservedObject private var store = GembaLibraryStore.shared

    @AppStorage("gemba_last_project")  private var lastProject  = ""
    @AppStorage("gemba_last_org")      private var lastOrg      = ""
    @AppStorage("gemba_last_bu")       private var lastBU       = ""
    @AppStorage("gemba_last_area")     private var lastArea     = ""
    @AppStorage("gemba_last_location") private var lastLocation = ""

    @State private var projectId    = ""
    @State private var organization = ""
    @State private var bu           = ""
    @State private var area         = ""
    @State private var location     = ""
    @State private var openWalks: [GembaWalk] = []
    @State private var isSubmitting = false
    @State private var error: String? = nil

    private var auditorName: String {
        let n = settings.uamUserName.isEmpty ? settings.authorName : settings.uamUserName
        return n.isEmpty ? "Auditor" : n
    }
    private var lists: GembaLists { store.library.lists ?? GembaLists() }

    var body: some View {
        NavigationStack {
            Form {
                if !openWalks.isEmpty {
                    Section {
                        ForEach(openWalks) { w in
                            let mine = isMine(w)
                            Button {
                                onStart(w)
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: mine ? "arrow.uturn.forward.circle.fill" : "person.2.circle.fill")
                                        .font(.title3).foregroundStyle(mine ? .orange : .secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(w.headerLine.isEmpty ? "Walk without header" : w.headerLine)
                                            .font(.body.weight(.semibold)).foregroundStyle(.primary)
                                        let n = w.summary?.findings ?? 0
                                        Text("\(mine ? "Your walk" : "Started by \(w.auditorName)") · \(String(w.startedAt.prefix(16)).replacingOccurrences(of: "T", with: " ")) · \(n) finding\(n == 1 ? "" : "s")")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(mine ? "Continue" : "Join").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                                }
                            }
                        }
                    } header: {
                        Text("Open walks on this space")
                    } footer: {
                        Text("Joining a colleague's walk adds your findings to their session (multi-auditor).")
                    }
                }
                if orphanCount > 0 {
                    Section {
                        Label("\(orphanCount) finding\(orphanCount == 1 ? "" : "s") on this space \(orphanCount == 1 ? "has" : "have") no walk header. You'll be offered to include \(orphanCount == 1 ? "it" : "them") once the walk begins.",
                              systemImage: "tray.and.arrow.down")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section {
                    LabeledContent("Auditor") {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(auditorName)
                            if !settings.employeeId.isEmpty { Text(settings.employeeId).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    TextField("Project ID", text: $projectId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text(openWalks.isEmpty ? "New walk" : "…or start a new walk")
                } footer: {
                    Text("Space: \(anchor.assetId). All header fields are optional — the walk is still recorded as a session. Walks are never tied to a chamber QR — tag anywhere.")
                }

                Section("Where") {
                    ListPickerRow(title: "Organization", options: lists.organization, value: $organization)
                    ListPickerRow(title: "BU",           options: lists.bu,           value: $bu)
                    ListPickerRow(title: "Area",         options: lists.area,         value: $area)
                    ListPickerRow(title: "Location",     options: lists.location,     value: $location)
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.caption)
                        Button("Continue offline — attach findings to a walk later") { onOffline() }
                            .font(.caption)
                    } footer: {
                        Text("Findings still save to the space. Next time a walk begins here they are offered for inclusion.")
                    }
                }
            }
            .navigationTitle("Start Gemba Walk")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else { Button("Begin") { Task { await begin() } }.fontWeight(.semibold) }
                }
            }
            .task {
                projectId = lastProject; organization = lastOrg; bu = lastBU; area = lastArea; location = lastLocation
                await store.refresh(settings: settings)
                // Every open walk on the space — own first, then colleagues'.
                if let walks = try? await SIBClient(settings: settings).fetchGembaWalks(anchorId: anchor.id, status: .open) {
                    openWalks = walks.sorted { (isMine($0) ? 0 : 1, $1.startedAt) < (isMine($1) ? 0 : 1, $0.startedAt) }
                }
            }
        }
        .interactiveDismissDisabled()
    }

    private func isMine(_ w: GembaWalk) -> Bool {
        let me = settings.employeeId
        if !me.isEmpty, let id = w.auditorId { return id == me }
        return w.auditorName == auditorName
    }

    private func begin() async {
        isSubmitting = true; error = nil
        let trim = { (s: String) -> String? in let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }
        let req = StartGembaWalkRequest(
            anchorId: anchor.id, auditorName: auditorName,
            auditorId: trim(settings.employeeId), projectId: trim(projectId),
            organization: trim(organization), bu: trim(bu), area: trim(area), location: trim(location))
        do {
            let walk = try await SIBClient(settings: settings).startGembaWalk(req)
            lastProject = projectId; lastOrg = organization; lastBU = bu; lastArea = area; lastLocation = location
            AppLog.info("gemba", "walk started", ["walk": walk.id, "project": walk.projectId ?? "-"])
            await MainActor.run { onStart(walk) }
        } catch {
            await MainActor.run { isSubmitting = false; self.error = friendlyMessage(for: error) }
        }
    }
}

/// A picker fed by a pick list, with an "Other…" escape that reveals a text
/// field. Values not in the list (from a previous walk) are shown as-is.
struct ListPickerRow: View {
    let title: String
    let options: [String]
    @Binding var value: String
    @State private var custom = false

    private var inList: Bool { options.contains(value) }

    var body: some View {
        if options.isEmpty || custom || (!value.isEmpty && !inList) {
            HStack {
                TextField(title, text: $value)
                if !options.isEmpty {
                    Button { custom = false; value = "" } label: { Image(systemName: "list.bullet") }
                        .buttonStyle(.borderless).foregroundStyle(.secondary)
                }
            }
        } else {
            Picker(title, selection: Binding(
                get: { value },
                set: { v in if v == "__other" { custom = true; value = "" } else { value = v } }
            )) {
                Text("—").tag("")
                ForEach(options, id: \.self) { Text($0).tag($0) }
                Text("Other…").tag("__other")
            }
        }
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

struct GembaWalkSummarySheet: View {
    let walk:     GembaWalk
    let findings: [LocTag]
    let onDone:   () -> Void

    private var s: GembaWalkSummary? { walk.summary }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(walk.headerLine.isEmpty ? "Walk submitted" : walk.headerLine).font(.headline)
                        Text([walk.auditorName, walk.auditorId].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                        if let bu = walk.bu, !bu.isEmpty { Text(bu).font(.caption).foregroundStyle(.secondary) }
                        Text("Submitted \(Date().formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                if let s {
                    Section("Findings") {
                        HStack(spacing: 10) {
                            stat("\(s.findings)", "total", .primary)
                            stat("\(s.strength)", "Strength", .green)
                            stat("\(s.ofi)", "OFI", .orange)
                            stat("\(s.nc)", "NC", .red)
                            if let r = s.maxRisk { stat(r.shortName, "max risk", .secondary) }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        if s.photos > 0 { Text("\(s.photos) photo\(s.photos == 1 ? "" : "s") uploaded").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if !findings.isEmpty {
                    Section("Log") {
                        ForEach(findings.sorted { $0.order < $1.order }) { f in
                            HStack(alignment: .top, spacing: 10) {
                                Text("#\(f.order + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 30, alignment: .trailing)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.questionTitle ?? f.title).font(.subheadline.weight(.semibold))
                                    if let line = f.referenceLine { Text(line).font(.caption.monospaced()).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if let c = f.findingCategory {
                                    Text(c.displayName).font(.caption.weight(.bold))
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .background(Color(FindingPanel.color(for: f)).opacity(0.18), in: Capsule())
                                        .foregroundStyle(Color(FindingPanel.color(for: f)))
                                }
                                if let r = f.riskRating { Text(r.shortName).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                Section {
                    Text("Thank you — the walk is on SIB. Reviewers see it under Portal › GembaWalks › Walk Sessions.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Session Summary")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { onDone() }.fontWeight(.semibold) } }
        }
        .interactiveDismissDisabled()
    }

    private func stat(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title2.weight(.bold)).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
