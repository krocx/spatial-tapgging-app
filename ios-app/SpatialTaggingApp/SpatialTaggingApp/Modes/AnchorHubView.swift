// AnchorHubView.swift — Phase 3
// Anchor management screen shown between the Anchor Directory and an AR session.
//
// Role:
//   • Shows the QR code for this anchor (with Share option) — no "origin locked" status.
//   • Lists tags with training status badges (green = trained, orange = untrained).
//   • "Enter AR Session" button → presents QRScanGateView (mandatory QR scan).
//   • Once the session is ready (QR locked), calls onSessionReady(anchor, tags).
//
// Flow:
//   AnchorDirectoryView → AnchorHubView → QRScanGateView → AuthorModeView / OperatorModeView

import SwiftUI

struct AnchorHubView: View {

    let anchor: Anchor
    let mode: AppMode                               // .author or .operator
    let onSessionReady: (Anchor, [Tag]) -> Void     // proceed to AR
    let onBack: () -> Void                          // go back to directory

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    // Tags (refreshed from SIB on appear)
    @State private var tags: [Tag] = []
    // Loc-tags for Gemba Walk anchors (fetched instead of regular tags)
    @State private var locTags: [LocTag] = []
    @State private var isLoadingTags = false
    @State private var tagLoadError: String? = nil

    // Loc-Tag editing
    @State private var editingLocTag: LocTag? = nil

    // QR generator sheet
    @State private var showQRSheet = false

    // QR scan gate
    @State private var showScanGate = false

    // FTUE walkthrough
    @State private var showOnboarding = false

    // Tour frame capture
    @State private var tourFrames: [TourStep: CGRect] = [:]

    // Readiness (Operator only)
    @State private var readinessWarning: String? = nil
    @State private var isReadinessBlocked = false

    var body: some View {
        List {
            // ── Card ──────────────────────────────────────────────────────────
            Section {
                if anchor.anchorType == .locTag {
                    locTagInfoCard
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                } else {
                    qrCard
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
            }

            // ── Tags / Inspection Sets ──────────────────────────────────────────────
            if anchor.anchorType == .locTag {
                // ── Gemba Walk: loading state + issues list ──────────────────────
                if isLoadingTags {
                    Section { HStack { Spacer(); ProgressView("Loading tags…"); Spacer() } }
                } else if let err = tagLoadError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                        Button("Retry") { Task { await loadTags() } }
                            .buttonStyle(.borderedProminent).controlSize(.small)
                    }
                } else {
                    Section {
                        if locTags.isEmpty {
                            ContentUnavailableView {
                                Label("No Issues Placed", systemImage: "mappin.slash")
                            } description: {
                                Text(mode == .author
                                     ? "Enter the AR walk to place your first issue."
                                     : "The Author must complete the walk before inspection.")
                            }
                            .listRowBackground(Color.clear)
                        } else {
                            ForEach(locTags) { tag in
                                LocTagHubRow(tag: tag)
                                    .contentShape(Rectangle())
                                    .onTapGesture { editingLocTag = tag }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            Task { await deleteLocTag(tag) }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                    } header: {
                        HStack {
                            Text("Issues")
                            Spacer()
                            Text("\(locTags.count) issue\(locTags.count == 1 ? "" : "s")")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                // ── QR anchor: Inspection Sets (Tag Groups) ───────────────────────
                // Tags are managed per group in TagGroupListView / TagGroupDetailView.
                Section {
                    NavigationLink {
                        TagGroupListView(
                            anchor:         anchor,
                            mode:           mode,
                            onSessionReady: onSessionReady
                        )
                        .environmentObject(settings)
                        .environmentObject(appState)
                        .environmentObject(tour)
                    } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.teal.opacity(0.12))
                                    .frame(width: 36, height: 36)
                                Image(systemName: "checklist")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(.teal)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Inspection Sets")
                                    .font(.subheadline.bold())
                                Text(mode == .author
                                     ? "Create and manage grouped inspection tags"
                                     : "View and run tag inspection sets")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Tags")
                }
            }

            // ── AR Guides (QR anchors only; anchorType nil = legacy QR anchor) ───
            // E1: authoring entry requires the 'aroms' entitlement; operator
            // access stays governed by guide sharing/sessions.
            if anchor.anchorType != .locTag && (mode != .author || settings.hasProduct("aroms")) {
                Section {
                    NavigationLink {
                        GuideListView(anchor: anchor, mode: mode)
                            .environmentObject(settings)
                            .environmentObject(appState)
                            .environmentObject(tour)
                    } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.indigo.opacity(0.12))
                                    .frame(width: 36, height: 36)
                                Image(systemName: "list.bullet.clipboard")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(.indigo)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text("AR Guides")
                                    .font(.subheadline.bold())
                                Text(mode == .author
                                     ? "Create and manage work instructions"
                                     : "View published step-by-step guides")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Work Instructions")
                }
            }

            // ── Readiness warning (Operator, Loc-Tag) ───────────────────────────
            if anchor.anchorType == .locTag, let warning = readinessWarning {
                Section {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(isReadinessBlocked ? .red : .orange)
                }
            }

            // ── Enter AR session (Loc-Tag anchors only) ───────────────────────
            // QR anchors: AR entry is now through Inspection Sets → TagGroupDetailView.
            if anchor.anchorType == .locTag {
                Section {
                    Button {
                        appState.activeAnchor = anchor
                        appState.activeTags   = tags
                        // Loc-Tag: no QR scan needed — go straight to the AR mode.
                        onSessionReady(anchor, tags)
                    } label: {
                        HStack {
                            Spacer()
                            Label(
                                mode == .author
                                    ? (locTags.isEmpty ? "Start Audit Walk" : "Edit Walk")
                                    : "Load Walk",
                                systemImage: "figure.walk"
                            )
                            .font(.headline)
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                    .controlSize(.large)

                    HStack {
                        Spacer()
                        Image(systemName: "figure.walk.circle")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(mode == .author ? "Enter AR to place tags by tapping surfaces"
                                             : "Enter AR to re-localize and resolve tags")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(anchor.assetId)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                // ? help button — always visible, shows walkthrough for this anchor type
                Button { showOnboarding = true } label: {
                    Image(systemName: "questionmark.circle")
                }
                // QR share button — hidden for Loc-Tag anchors (no QR exists)
                if anchor.anchorType != .locTag {
                    Button { showQRSheet = true } label: {
                        Image(systemName: "qrcode")
                    }
                }
            }
        }
        .onAppear {
            Task { await loadTags() }
            // Tour: advance to anchorHub.
            // advancePast(.createAnchor) handles edge cases where the directory step
            // wasn't already advanced (e.g. re-entry). advancePast(.anchorQR) handles
            // the normal flow where existing-anchor selection skips CreateAnchorSheet,
            // or the user dismissed the sheet without tapping "Next" on the QR banner.
            tour.advancePast(.createAnchor)
            tour.advancePast(.anchorQR)
            // FTUE: show the walkthrough for this anchor type on first entry.
            // Gemba Walk and QR anchors each have their own seen flag so a user
            // who works with both types sees the right walkthrough for each.
            guard settings.ftueEnabled else { return }
            if anchor.anchorType == .locTag {
                if mode == .author, !settings.ftueGembaAuthorSeen {
                    settings.ftueGembaAuthorSeen = true
                    showOnboarding = true
                } else if mode != .author, !settings.ftueGembaOperatorSeen {
                    settings.ftueGembaOperatorSeen = true
                    showOnboarding = true
                }
            } else {
                if mode == .author, !settings.ftueAuthorSeen {
                    settings.ftueAuthorSeen = true
                    showOnboarding = true
                } else if mode != .author, !settings.ftueOperatorSeen {
                    settings.ftueOperatorSeen = true
                    showOnboarding = true
                }
            }
        }
        // ── Tour: collect spotlight target frames ─────────────────────────────
        .onPreferenceChange(TourFrameKey.self) { frames in
            tourFrames.merge(frames) { _, new in new }
        }
        // ── Tour: overlay for anchorHub (banner) + shareQR (spotlight) steps ──
        .overlay {
            if tour.isActive && tour.currentStep.screen == .anchorHub {
                CoachMarkOverlay(
                    step:       tour.currentStep,
                    targetRect: tourFrames[tour.currentStep],
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.25), value: tour.currentStep)
            }
        }
        // ── Edit loc-tag sheet ────────────────────────────────────────────────
        .sheet(item: $editingLocTag) { tag in
            LocTagEditSheet(locTag: tag) { updated in
                if let idx = locTags.firstIndex(where: { $0.id == updated.id }) {
                    locTags[idx] = updated
                }
            }
            .environmentObject(settings)
        }
        // ── QR generator ─────────────────────────────────────────────────────
        .sheet(isPresented: $showQRSheet) {
            qrGeneratorSheet
        }
        // ── FTUE walkthrough ──────────────────────────────────────────────────
        .sheet(isPresented: $showOnboarding) {
            let context: OnboardingContext = anchor.anchorType == .locTag
                ? (mode == .author ? .gembaAuthor : .gembaOperator)
                : (mode == .author ? .author      : .operatorMode)
            OnboardingSheet(context: context)
        }
        // ── QR scan gate ──────────────────────────────────────────────────────
        .fullScreenCover(isPresented: $showScanGate) {
            QRScanGateView(
                mode: mode,
                onSessionReady: {
                    showScanGate = false
                    onSessionReady(anchor, tags)
                },
                onCancel: { showScanGate = false }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
    }

    // ── QR card ───────────────────────────────────────────────────────────────

    private var qrCard: some View {
        HStack(spacing: 14) {
            // Small QR thumbnail placeholder
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white)
                    .frame(width: 56, height: 56)
                Image(systemName: "qrcode")
                    .font(.system(size: 30))
                    .foregroundStyle(.black)
            }
            .shadow(color: .black.opacity(0.08), radius: 3, y: 1)

            VStack(alignment: .leading, spacing: 3) {
                Text("Anchor QR Code")
                    .font(.subheadline.bold())
                Text("Permanent · key embedded")
                    .font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(.green)
                    Text("AES-256 encrypted").font(.caption2).foregroundStyle(.green)
                }
            }

            Spacer()

            Button {
                showQRSheet = true
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
                    .font(.caption.bold())
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.blue.opacity(0.10))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .background(
                GeometryReader { geo in
                    Color.clear.preference(
                        key: TourFrameKey.self,
                        value: [.shareQR: geo.frame(in: .global)]
                    )
                }
            )
        }
    }

    // ── Loc-Tag info card ─────────────────────────────────────────────────────

    private var locTagInfoCard: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.orange.opacity(0.15))
                    .frame(width: 56, height: 56)
                Image(systemName: "figure.walk.circle")
                    .font(.system(size: 30))
                    .foregroundStyle(.orange)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Gemba Audit Walk")
                    .font(.subheadline.bold())
                Text("No QR · surface-tap placement")
                    .font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    Image(systemName: "map.fill").font(.system(size: 9)).foregroundStyle(.orange)
                    Text("ARWorldMap spatial reference").font(.caption2).foregroundStyle(.orange)
                }
            }
            Spacer()
        }
    }

    // ── QR generator sheet ────────────────────────────────────────────────────

    @ViewBuilder
    private var qrGeneratorSheet: some View {
        // CANONICAL KEY SOURCE: use the key stored in SIB (anchor.encryptionKey)
        // — this is set once at anchor creation and never changes, so every device
        // and every open produces the exact same QR.  Fall back to Keychain only
        // for legacy anchors that pre-date Phase 3 key storage.
        let keyB64 = anchor.encryptionKey
            ?? AnchorEncryption.base64(for:
                appState.anchorEncryptionKey
                ?? AnchorEncryption.loadExistingKey(anchorId: anchor.id)
                ?? AnchorEncryption.getOrCreateKey(for: anchor.id))
        QRGeneratorView(
            anchor:        anchor,
            encryptionKey: keyB64,
            qrSizeCm:      anchor.qrSizeCm ?? 10.0
        )
    }

    // ── Tag helpers ───────────────────────────────────────────────────────────

    /// A tag is trained when the server says so (isTrained from GET /tags response)
    /// or when the in-memory session set contains this ID.
    private func isTagTrained(_ tag: Tag) -> Bool {
        if let serverTrained = tag.isTrained { return serverTrained }
        return appState.trainedTagIds.contains(tag.id) ||
               tag.metadata["feature_print_summary"] != nil ||
               tag.metadata["ocr_text"] != nil
    }

    // ── Network ───────────────────────────────────────────────────────────────

    private func deleteLocTag(_ tag: LocTag) async {
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteLocTag(id: tag.id)
            locTags.removeAll { $0.id == tag.id }
        } catch {
            // Surface the error inline — can't show an alert from here easily so
            // we append it to tagLoadError, which already has an error UI.
            tagLoadError = "Delete failed: \(friendlyMessage(for: error))"
        }
    }

    private func loadTags() async {
        // QR anchors: tags are managed per Inspection Set — only load for Loc-Tag anchors.
        guard anchor.anchorType == .locTag else { return }
        isLoadingTags = true
        tagLoadError  = nil
        let client    = SIBClient(settings: settings)
        do {
            // Gemba Walk: fetch loc-tags (issues placed by surface tap)
            let fetched = try await client.fetchLocTags(anchorId: anchor.id)
            locTags = fetched.sorted { $0.order < $1.order }
        } catch {
            tagLoadError = error.localizedDescription
        }
        isLoadingTags = false
    }
}

// ── Hub tag row ───────────────────────────────────────────────────────────────

private struct HubTagRow: View {
    let tag: Tag

    private var isTrained: Bool {
        if let serverTrained = tag.isTrained { return serverTrained }
        return tag.metadata["feature_print_summary"] != nil || tag.metadata["ocr_text"] != nil
    }

    var body: some View {
        HStack(spacing: 14) {
            // Type icon in colored circle
            ZStack {
                Circle()
                    .fill(tag.type.color.opacity(0.14))
                    .frame(width: 36, height: 36)
                Image(systemName: tag.type.iconName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tag.type.color)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(tag.label).font(.subheadline.bold()).lineLimit(1)
                Text(tag.type.displayName)
                    .font(.caption).foregroundStyle(.secondary)
            }

            Spacer()

            if isTrained {
                Label("Trained", systemImage: "checkmark.circle.fill")
                    .font(.caption.bold())
                    .foregroundStyle(.green)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.green.opacity(0.10))
                    .clipShape(Capsule())
            } else {
                Text("Untrained")
                    .font(.caption.bold())
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.orange.opacity(0.10))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}

// ── Hub row for Gemba Walk (LocTag) issues ────────────────────────────────────

private struct LocTagHubRow: View {
    let tag: LocTag

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.14))
                    .frame(width: 36, height: 36)
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.orange)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(tag.title).font(.subheadline.bold()).lineLimit(1)
                Text(tag.defectCategory.displayName)
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("#\(tag.order)")
                .font(.caption.bold().monospacedDigit())
                .foregroundStyle(.orange.opacity(0.8))
        }
        .padding(.vertical, 2)
    }
}

// ── QR key fetch fallback ─────────────────────────────────────────────────────
// Shown when the local device doesn't have the encryption key in Keychain.
// Fetches it from SIB (where it was stored at anchor creation) and opens the QR generator.

private struct QRKeyFetchView: View {
    let anchor: Anchor

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @Environment(\.dismiss) private var dismiss

    @State private var isFetching = true
    @State private var fetchError: String? = nil
    @State private var fetchedKeyB64: String? = nil

    var body: some View {
        Group {
            if isFetching {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading encryption key…").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = fetchError {
                VStack(spacing: 14) {
                    Image(systemName: "lock.trianglebadge.exclamationmark.fill")
                        .font(.system(size: 44)).foregroundStyle(.orange)
                    Text("Key not available").font(.headline)
                    Text(err).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("Close") { dismiss() }.buttonStyle(.borderedProminent)
                }
                .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let keyB64 = fetchedKeyB64 {
                QRGeneratorView(anchor: anchor, encryptionKey: keyB64)
            }
        }
        .task { await fetchKey() }
    }

    private func fetchKey() async {
        let client = SIBClient(settings: settings)
        do {
            let fetched = try await client.fetchAnchor(id: anchor.id)
            if let k = fetched.encryptionKey {
                // Cache in Keychain so future opens don't need SIB
                if let symKey = AnchorEncryption.key(fromBase64: k) {
                    appState.anchorEncryptionKey = symKey
                }
                fetchedKeyB64 = k
            } else {
                fetchError = "This anchor was created before Phase 3 — no encryption key stored in SIB. Ask the Author to share the QR from Author mode."
            }
        } catch {
            fetchError = "Could not retrieve anchor: \(error.localizedDescription)"
        }
        isFetching = false
    }
}
