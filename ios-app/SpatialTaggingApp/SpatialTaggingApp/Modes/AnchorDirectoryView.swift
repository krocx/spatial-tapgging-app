// AnchorDirectoryView.swift — Phase 3 (Team Sharing)
//
// Entry point for both Author and Operator modes.
// Authors and Operators pick an anchor from the live SIB list (or Authors create a new one).
//
// Phase 3 UX flow:
//   ModeSelectionView → AnchorDirectoryView → AnchorHubView → QRScanGateView → AR
//
// Key links:
//   "Open Portal" → Render web URL + /portal (full browser interface)
//   Row tap       → navigates to AnchorHubView within this NavigationStack

import SwiftUI

struct AnchorDirectoryView: View {

    let mode: AppMode                           // .author or .operator
    let onSessionReady: (Anchor, [Tag]) -> Void // called when QR scan gate completes
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    // ── List state ────────────────────────────────────────────────────────────
    @State private var anchors:     [Anchor] = []
    @State private var tagCounts:   [String: Int] = [:]   // anchorId → count
    @State private var isLoading    = false
    @State private var loadError:   String? = nil
    @State private var searchText   = ""

    // ── Delete confirmation ───────────────────────────────────────────────────
    @State private var anchorToDelete: Anchor? = nil
    @State private var isDeletingAnchor = false
    @State private var deleteError: String? = nil

    // ── Phase 3: NavigationStack destination (anchor hub) ────────────────────
    @State private var hubAnchor: Anchor? = nil
    /// U3: anchor awaiting a name for "Duplicate"
    @State private var anchorToDuplicate: Anchor? = nil
    @State private var duplicateName:     String  = ""
    @State private var isDuplicating      = false

    // ── Sheets ────────────────────────────────────────────────────────────────
    @State private var showCreateSheet = false
    @State private var showHelpSheet   = false
    @State private var showOnboarding  = false

    // ── Computed ──────────────────────────────────────────────────────────────
    private var filtered: [Anchor] {
        if searchText.isEmpty { return anchors }
        let q = searchText.lowercased()
        return anchors.filter {
            $0.id.lowercased().contains(q) ||
            $0.assetId.lowercased().contains(q)
        }
    }

    /// Author-mode: anchors created on this device (tracked by ID, not by name).
    /// ID-based tracking is reliable regardless of author-name renames or
    /// differences between creation time and display time.
    private var myAnchors: [Anchor] {
        filtered.filter { settings.myAnchorIds.contains($0.id) }
    }

    /// Author-mode: anchors not created on this device — shared team anchors,
    /// legacy anchors, and anchors authored on another device.
    private var sharedAnchors: [Anchor] {
        filtered.filter { !settings.myAnchorIds.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && anchors.isEmpty {
                    loadingView
                } else if let err = loadError {
                    errorView(err)
                } else if anchors.isEmpty {
                    emptyView
                } else {
                    anchorList
                }
            }
            .navigationTitle("Anchor Directory")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { showOnboarding = true } label: {
                        Image(systemName: "questionmark.circle")
                    }
                    // Author only: create new anchor
                    if mode == .author {
                        Button { showCreateSheet = true } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search by anchor or asset ID")
            // ── AnchorHubView destination ──────────────────────────────────────
            // iLOTO anchors branch to their own hub (docs/ILOTO.md §3); the
            // classic hub serves QR + Gemba anchors unchanged.
            .navigationDestination(item: $hubAnchor) { anchor in
                Group {
                    if anchor.anchorType == .loto {
                        ILOTOHubView(anchor: anchor, onBack: { hubAnchor = nil })
                    } else {
                        AnchorHubView(
                            anchor: anchor,
                            mode: mode,
                            onSessionReady: { anchor, tags in
                                onSessionReady(anchor, tags)
                            },
                            onBack: { hubAnchor = nil }
                        )
                    }
                }
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
            }
        }
        .onAppear {
            Task { await loadAnchors() }
            // FTUE auto-trigger moved to AnchorHubView where anchor type is known.
            // The ? button here still shows the QR-mode walkthrough as a manual reference.
        }
        // Tour: auto-advance when + Create sheet opens or a row is tapped
        .onChange(of: showCreateSheet) { if $0 { tour.advancePast(.createAnchor) } }
        .onChange(of: hubAnchor)       { if $0 != nil { tour.advancePast(.createAnchor) } }
        // Tour: banner overlay for createAnchor step
        .overlay {
            if tour.isActive && tour.currentStep == .createAnchor {
                CoachMarkOverlay(
                    step:       .createAnchor,
                    targetRect: nil,
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8),
                   value: tour.currentStep == .createAnchor)
        .refreshable { await loadAnchors() }

        // ── Delete confirmation alert ──────────────────────────────────────────
        .alert(
            "Delete Anchor?",
            isPresented: Binding(
                get: { anchorToDelete != nil },
                set: { if !$0 { anchorToDelete = nil } }
            ),
            presenting: anchorToDelete
        ) { anchor in
            Button("Cancel", role: .cancel) { anchorToDelete = nil }
            Button("Delete", role: .destructive) {
                Task { await deleteAnchor(anchor) }
            }
        } message: { anchor in
            Text("\"\(anchor.assetId)\" and all its tags and training data will be permanently deleted. This cannot be undone.")
        }

        // ── Delete error toast ────────────────────────────────────────────────
        .overlay(alignment: .top) {
            if let err = deleteError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.white)
                    Text(err).font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                    Spacer()
                    Button { deleteError = nil } label: {
                        Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color.red.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16).padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: deleteError != nil)
            }
        }

        // Create anchor sheet (Author only)
        // After creation, insert the anchor at the top of the list, then navigate
        // directly to its AnchorHubView — the user can start a walk or AR session
        // without having to tap the row again.
        .alert("Duplicate Anchor", isPresented: Binding(
            get: { anchorToDuplicate != nil },
            set: { if !$0 { anchorToDuplicate = nil } }
        )) {
            TextField("New asset name", text: $duplicateName)
            Button("Cancel", role: .cancel) { anchorToDuplicate = nil }
            Button("Duplicate") {
                if let src = anchorToDuplicate { Task { await duplicateAnchor(src) } }
            }
            .disabled(isDuplicating)
        } message: {
            Text("Creates a new anchor (new QR code and key) with the same guides and 3D model kit. Steps arrive unplaced and untrained — scan the new tool's world map, place the pins, then publish.")
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateAnchorSheet { newAnchor in
                // Claim this anchor on the local device — this is what drives
                // the My Anchors / Shared split, independently of server state.
                settings.myAnchorIds.insert(newAnchor.id)
                anchors.insert(newAnchor, at: 0)
                tagCounts[newAnchor.id] = 0
                showCreateSheet = false
                // Brief delay so the sheet finishes dismissing before NavigationStack
                // pushes AnchorHubView — avoids a blank-screen flash on iOS 17+.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    selectAnchor(newAnchor)
                }
            }
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }

        // Help sheet (legacy reference) — kept for future use
        .sheet(isPresented: $showHelpSheet) {
            HelpSheet(steps: HelpContent.anchorDirectory)
        }
        // FTUE / Help — context-aware walkthrough
        .sheet(isPresented: $showOnboarding) {
            OnboardingSheet(context: mode == .author ? .author : .operatorMode)
        }
    }

    // ── Anchor list ───────────────────────────────────────────────────────────

    private var anchorList: some View {
        List {
            // Web portal link card
            portalCard
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))

            if mode == .author {
                // ── My Anchors ──────────────────────────────────────────────────
                Section {
                    if myAnchors.isEmpty {
                        Text("No anchors yet — tap + to create one")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                    } else {
                        ForEach(myAnchors) { anchor in
                            anchorRow(anchor, showCreator: false)
                        }
                    }
                } header: {
                    HStack {
                        Text("My Anchors")
                        Spacer()
                        Text("\(myAnchors.count)").foregroundStyle(.secondary)
                    }
                }

                // ── Shared ──────────────────────────────────────────────────────
                if settings.showSharedAnchors && !sharedAnchors.isEmpty {
                    Section {
                        ForEach(sharedAnchors) { anchor in
                            anchorRow(anchor, showCreator: true)
                        }
                    } header: {
                        HStack {
                            Text("Shared")
                            Spacer()
                            Text("\(sharedAnchors.count)").foregroundStyle(.secondary)
                        }
                    }
                }

            } else {
                // ── Operator mode: flat list, all anchors visible ────────────────
                Section {
                    ForEach(filtered) { anchor in
                        anchorRow(anchor, showCreator: false)
                    }
                } header: {
                    HStack {
                        Text("Anchors")
                        Spacer()
                        Text("\(filtered.count)").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .animation(.default, value: anchors.count)
    }

    /// Shared row builder used by both the My Anchors and Shared sections.
    @ViewBuilder
    private func anchorRow(_ anchor: Anchor, showCreator: Bool) -> some View {
        AnchorDirectoryRow(
            anchor:      anchor,
            tagCount:    tagCounts[anchor.id] ?? 0,
            isLoading:   false,
            showCreator: showCreator
        ) {
            selectAnchor(anchor)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if mode == .author {
                Button(role: .destructive) {
                    anchorToDelete = anchor
                } label: {
                    Label("Delete", systemImage: "trash")
                }
                // U3: template copy — same guides/model kit on a new QR
                Button {
                    duplicateName   = "\(anchor.assetId) copy"
                    anchorToDuplicate = anchor
                } label: {
                    Label("Duplicate", systemImage: "plus.square.on.square")
                }
                .tint(.teal)
            }
        }
    }

    // ── Portal card ───────────────────────────────────────────────────────────

    private var portalCard: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(Color.blue.opacity(0.14)).frame(width: 40, height: 40)
                Image(systemName: "globe")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.blue)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Anchor Directory Portal")
                    .font(.subheadline.bold())
                if let url = portalURL {
                    Text(url).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "arrow.up.right").foregroundStyle(.secondary).font(.caption)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.blue.opacity(0.25), lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 8)
        .contentShape(Rectangle())
        .onTapGesture { openPortal() }
    }

    private var portalURL: String? {
        guard !settings.sibBaseURL.isEmpty else { return nil }
        return settings.normalizedBaseURL + "/portal"
    }

    private func openPortal() {
        guard let urlStr = portalURL, let url = URL(string: urlStr) else { return }
        UIApplication.shared.open(url)
    }

    // ── Empty state ───────────────────────────────────────────────────────────

    private var emptyView: some View {
        ContentUnavailableView {
            Label("No Anchors Yet", systemImage: "qrcode")
        } description: {
            Text("Create your first anchor using the + button, or visit the portal on your Render server.")
        } actions: {
            Button("Create Anchor") { showCreateSheet = true }
                .buttonStyle(.borderedProminent)
        }
    }

    // ── Loading / Error ───────────────────────────────────────────────────────

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading anchors…").font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Connection Failed", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Retry") { Task { await loadAnchors() } }
                .buttonStyle(.borderedProminent)
        }
    }

    // ── Network ───────────────────────────────────────────────────────────────

    private func loadAnchors() async {
        isLoading = true
        loadError = nil
        let client = SIBClient(settings: settings)
        do {
            let fetched = try await client.fetchAnchors()
            // Sort newest first
            anchors = fetched.sorted { $0.createdAt > $1.createdAt }
            // Fetch tag counts in parallel.
            // LOC_TAG anchors store issues in /loc-tags; QR anchors use /tags.
            await withTaskGroup(of: (String, Int).self) { group in
                for anchor in anchors {
                    group.addTask {
                        if anchor.anchorType == .locTag {
                            let count = (try? await client.fetchLocTags(anchorId: anchor.id).count) ?? 0
                            return (anchor.id, count)
                        } else {
                            let count = (try? await client.fetchTags(anchorId: anchor.id).count) ?? 0
                            return (anchor.id, count)
                        }
                    }
                }
                for await (id, count) in group {
                    tagCounts[id] = count
                }
            }
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    /// U3: server-side template copy; the new anchor opens in its hub so the
    /// author can print the QR and scan the world map straight away.
    private func duplicateAnchor(_ source: Anchor) async {
        isDuplicating = true
        let client = SIBClient(settings: settings)
        do {
            let trimmed  = duplicateName.trimmingCharacters(in: .whitespaces)
            let newAnchor = try await client.duplicateAnchor(id: source.id, assetId: trimmed.isEmpty ? nil : trimmed)
            settings.myAnchorIds.insert(newAnchor.id)
            anchors.insert(newAnchor, at: 0)
            tagCounts[newAnchor.id] = 0
            anchorToDuplicate = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { hubAnchor = newAnchor }
        } catch {
            deleteError = "Duplicate failed: \(friendlyMessage(for: error))"
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { deleteError = nil }
        }
        isDuplicating = false
    }

    private func deleteAnchor(_ anchor: Anchor) async {
        isDeletingAnchor = true
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteAnchor(id: anchor.id)
            anchors.removeAll { $0.id == anchor.id }
            tagCounts.removeValue(forKey: anchor.id)
            // Also clear Keychain entry for this anchor
            AnchorEncryption.deleteKey(anchorId: anchor.id)
        } catch {
            deleteError = "Delete failed: \(error.localizedDescription)"
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { deleteError = nil }
        }
        isDeletingAnchor = false
        anchorToDelete = nil
    }

    private func selectAnchor(_ anchor: Anchor) {
        // Phase 3: navigate to AnchorHubView — hub owns tag loading and QR scan gate.
        // Pre-cache the encryption key if available (Keychain → SIB payload).
        if let kbKey = AnchorEncryption.loadExistingKey(anchorId: anchor.id) {
            appState.anchorEncryptionKey = kbKey
        } else if let keyB64 = anchor.encryptionKey,
                  let symKey = AnchorEncryption.key(fromBase64: keyB64) {
            appState.anchorEncryptionKey = symKey
        }
        hubAnchor = anchor
    }
}

// ── Anchor directory row ──────────────────────────────────────────────────────

private struct AnchorDirectoryRow: View {
    let anchor:      Anchor
    let tagCount:    Int
    let isLoading:   Bool
    /// When true, renders the createdBy name as a small caption (used in the Shared section).
    let showCreator: Bool
    let onSelect:    () -> Void

    private var shortId: String {
        anchor.id.count > 20
            ? String(anchor.id.prefix(10)) + "…" + String(anchor.id.suffix(6))
            : anchor.id
    }

    private var relativeDate: String {
        guard let date = ISO8601DateFormatter().date(from: anchor.createdAt) else { return "" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: date, relativeTo: Date())
    }

    /// Per-type accent: blue = QR, orange = Gemba, red = iLOTO (danger domain).
    private var accent: Color {
        switch anchor.anchorType {
        case .locTag: return .orange
        case .loto:   return .red
        default:      return .blue
        }
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 14) {
                // Tag count badge — orange for Gemba Walk anchors, blue for QR anchors (incl. legacy nil)
                ZStack {
                    Circle()
                        .fill(accent.opacity(0.12))
                        .frame(width: 40, height: 40)
                    if isLoading {
                        ProgressView().scaleEffect(0.7)
                    } else {
                        Text("\(tagCount)")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(accent)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(anchor.assetId)
                        .font(.subheadline.bold())
                        .lineLimit(1)
                    Text(shortId)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if showCreator, let creator = anchor.createdBy {
                        Text("by \(creator)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text(tagCount == 1 ? "1 tag" : "\(tagCount) tags")
                        .font(.caption.bold())
                        .foregroundStyle(accent)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(accent.opacity(0.10))
                        .clipShape(Capsule())

                    Text(relativeDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// ── Create anchor sheet ───────────────────────────────────────────────────────
// Phase 3: 2-step wizard.
//   Step 1: Asset name + optional anchor ID.
//   Step 2: Print / share the permanent QR (encryption key embedded from day one).
//
// The encryption key is generated client-side before the SIB request and stored
// both in iOS Keychain and in SIB.  The physical QR never changes after printing.

struct CreateAnchorSheet: View {

    let onCreated: (Anchor) -> Void

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager
    @Environment(\.dismiss) private var dismiss

    @State private var assetId    = ""
    @State private var anchorId   = ""
    @State private var isCreating = false
    @State private var createError: String? = nil
    /// Phase 2: anchor type — QR (default) or Loc-Tag (Gemba walk, no QR required)
    @State private var selectedAnchorType: AnchorType = .qr

    // Step 2: shown after QR anchor is created (not used for Loc-Tag)
    @State private var createdAnchor: Anchor? = nil
    @State private var createdKeyB64: String? = nil

    var body: some View {
        NavigationStack {
            if let anchor = createdAnchor, let keyB64 = createdKeyB64 {
                step2View(anchor: anchor, keyB64: keyB64)
            } else {
                step1View
            }
        }
        // Tour: show anchorQR banner on step 2 (QR first displayed after anchor creation)
        .overlay {
            if tour.isActive && tour.currentStep.screen == .createAnchorSheet,
               createdAnchor != nil {
                CoachMarkOverlay(
                    step:       tour.currentStep,
                    targetRect: nil,
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: tour.currentStep)
            }
        }
    }

    // ── Step 1: Name + type picker ────────────────────────────────────────────

    private var step1View: some View {
        Form {
            // QR-flow types (QR + iLOTO) show step progress; Gemba walk is single-step.
            if selectedAnchorType != .locTag {
                Section { stepProgress(currentStep: 1) }
                    .listRowBackground(Color.clear)
            }

            // ── Anchor type picker ──────────────────────────────────────────────
            Section {
                anchorTypePicker
            } header: {
                Text("Anchor Type")
            } footer: {
                switch selectedAnchorType {
                case .qr:
                    Text("A QR code is printed and mounted at the inspection point. AR sessions begin by scanning it.")
                case .locTag:
                    Text("Tap any surface in AR to place issue tags. No QR code needed — the space itself is the anchor.")
                case .loto:
                    Text("One anchor per control panel. A QR code is printed and mounted on the panel; Safe Off and LOTO points are placed against its world map.")
                }
            }

            // ── Name ────────────────────────────────────────────────────────────
            Section {
                TextField(
                    selectedAnchorType == .qr ? "e.g. Pump-Station-A"
                        : selectedAnchorType == .loto ? "e.g. Control-Panel-CP07"
                        : "e.g. Assembly-Line-3-Bay-7",
                    text: $assetId
                )
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            } header: {
                Text("Location Name (required)")
            } footer: {
                Text("Identifies the physical location this anchor covers.")
            }

            // ── Anchor ID (QR-flow types — advanced option) ─────────────────────
            if selectedAnchorType != .locTag {
                Section {
                    TextField("Leave blank to auto-generate", text: $anchorId)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.body.monospaced())
                } header: {
                    Text("Anchor ID (optional)")
                } footer: {
                    Text("Custom ID to match a physical QR you've already printed.")
                }

                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "lock.fill").foregroundStyle(.blue).font(.subheadline)
                        Text("An AES-256 encryption key is generated and embedded in the QR in the next step.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if let err = createError {
                Section {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("New Anchor")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                if isCreating { ProgressView() }
                else {
                    let label = selectedAnchorType != .locTag ? "Continue" : "Create"
                    Button(label) { Task { await createAnchor() } }
                        .disabled(assetId.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    // Three-card anchor type picker
    private var anchorTypePicker: some View {
        // E1: only entitled products can AUTHOR their anchor type. QR is the
        // platform base (inspection + AR OMS). Unscoped users see all three.
        HStack(spacing: 8) {
            anchorTypeCard(
                type:    .qr,
                icon:    "qrcode.viewfinder",
                label:   "QR Anchor",
                caption: "Print & scan"
            )
            if settings.hasProduct("gemba") {
                anchorTypeCard(
                    type:    .locTag,
                    icon:    "figure.walk.circle",
                    label:   "Gemba Walk",
                    caption: "Tap any surface"
                )
            }
            if settings.hasProduct("iloto") {
                anchorTypeCard(
                    type:    .loto,
                    icon:    "lock.shield",
                    label:   "iLOTO",
                    caption: "Control panel"
                )
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
    }

    private func anchorTypeCard(type: AnchorType, icon: String, label: String, caption: String) -> some View {
        let selected = selectedAnchorType == type
        return Button { selectedAnchorType = type } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(selected ? .white : .primary)
                Text(label)
                    .font(.subheadline.bold())
                    .foregroundStyle(selected ? .white : .primary)
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(selected ? .white.opacity(0.75) : .secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                selected
                    ? (type == .qr ? Color.blue : type == .loto ? Color.red : Color.orange)
                    : Color(.secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selected ? Color.clear : Color(.separator), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // ── Step 2: Print & place QR ──────────────────────────────────────────────

    private func step2View(anchor: Anchor, keyB64: String) -> some View {
        VStack(spacing: 0) {
            // Progress + instructions header
            VStack(spacing: 12) {
                stepProgress(currentStep: 2)
                    .padding(.horizontal, 32).padding(.top, 8)

                VStack(alignment: .leading, spacing: 8) {
                    instructionRow(n: 1, text: "Print or save the QR below")
                    instructionRow(n: 2, text: "Mount it at the physical inspection point")
                    instructionRow(n: 3, text: "Scan it when you tap \"Enter AR Session\" from the Anchor Hub")
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 8)

            // Reuse QRGeneratorView for the actual QR image + size picker + share
            QRGeneratorView(anchor: anchor, encryptionKey: keyB64, showDoneButton: false)
        }
        .navigationTitle("Print & Place QR")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Go to Anchor Hub") {
                    tour.advancePast(.anchorQR)
                    dismiss()
                    onCreated(anchor)
                }
            }
        }
    }

    // ── Create anchor (network) ───────────────────────────────────────────────

    private func createAnchor() async {
        isCreating  = true
        createError = nil
        let client  = SIBClient(settings: settings)

        let resolvedId = anchorId.trimmingCharacters(in: .whitespaces).isEmpty
            ? UUID().uuidString.lowercased()
            : anchorId.trimmingCharacters(in: .whitespaces)

        do {
            let anchor: Anchor

            if selectedAnchorType == .locTag {
                // ── Gemba Walk (Loc-Tag) ─────────────────────────────────────
                // No QR, no encryption key. ARWorldMap is the spatial reference.
                let req = CreateAnchorRequest(
                    id:         resolvedId,
                    assetId:    assetId.trimmingCharacters(in: .whitespaces),
                    anchorType: .locTag,
                    createdBy:  settings.authorName
                )
                anchor = try await client.createAnchor(req)
                isCreating = false
                // Skip step 2 — go directly to hub
                dismiss()
                onCreated(anchor)

            } else {
                // ── QR-flow anchor (QR + iLOTO) ──────────────────────────────
                // Generate the anchor ID client-side so the encryption key can be
                // derived before the SIB call. Physical QR embeds this key from day one.
                // iLOTO anchors ride this exact flow — a control panel is a fixed,
                // QR-labelled asset — differing only in the stamped anchorType,
                // which routes them to the iLOTO hub.
                let encKey = AnchorEncryption.getOrCreateKey(for: resolvedId)
                let keyB64 = AnchorEncryption.base64(for: encKey)
                appState.anchorEncryptionKey = encKey

                let req = CreateAnchorRequest(
                    id:            resolvedId,
                    assetId:       assetId.trimmingCharacters(in: .whitespaces),
                    encryptionKey: keyB64,
                    qrSizeCm:      10.0,     // canonical size — stored in SIB, never changes
                    anchorType:    selectedAnchorType == .loto ? .loto : nil,
                    createdBy:     settings.authorName
                )
                anchor = try await client.createAnchor(req)
                isCreating    = false
                createdAnchor = anchor
                createdKeyB64 = keyB64
                // Proceed to step 2 (print QR)
            }
        } catch {
            createError = error.localizedDescription
            isCreating  = false
        }
    }

    // ── Step progress UI ──────────────────────────────────────────────────────

    private func stepProgress(currentStep: Int) -> some View {
        HStack(spacing: 0) {
            stepDot(n: 1, done: currentStep > 1, active: currentStep == 1)
            stepLine(filled: currentStep > 1)
            stepDot(n: 2, done: currentStep > 2, active: currentStep == 2)
        }
    }

    private func stepDot(n: Int, done: Bool, active: Bool) -> some View {
        ZStack {
            Circle()
                .fill(done ? Color.green : (active ? Color.blue : Color(.systemGray5)))
                .frame(width: 26, height: 26)
            if done {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
            } else {
                Text("\(n)").font(.system(size: 13, weight: .bold))
                    .foregroundStyle(active ? .white : Color(.systemGray))
            }
        }
    }

    private func stepLine(filled: Bool) -> some View {
        Rectangle()
            .fill(filled ? Color.green : Color(.systemGray4))
            .frame(maxWidth: .infinity).frame(height: 2)
    }

    private func instructionRow(n: Int, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle().fill(Color.blue).frame(width: 20, height: 20)
                Text("\(n)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
            }
            .padding(.top, 2)
            Text(text).font(.subheadline).foregroundStyle(.primary)
            Spacer()
        }
    }
}

// ── Help content ──────────────────────────────────────────────────────────────

extension HelpContent {
    static let anchorDirectory: [HelpStep] = [
        HelpStep(icon: "list.bullet", title: "Browse Anchors",
                 detail: "All registered anchors on your SIB server appear here. Tap any anchor to open its hub."),
        HelpStep(icon: "plus.circle", title: "Create a New Anchor",
                 detail: "Authors tap + to create an anchor. Give it an asset ID matching the physical equipment. A unique QR code with an embedded encryption key is generated immediately."),
        HelpStep(icon: "qrcode.viewfinder", title: "QR Scan at Session Start",
                 detail: "Tapping 'Enter AR Session' from the Anchor Hub always requires a QR scan first. This locks the 3D origin for the session — both Author and Operator modes use the same gate."),
        HelpStep(icon: "globe", title: "Web Portal",
                 detail: "Tap 'Anchor Directory Portal' to open the browser-based view on your Render server."),
    ]
}
