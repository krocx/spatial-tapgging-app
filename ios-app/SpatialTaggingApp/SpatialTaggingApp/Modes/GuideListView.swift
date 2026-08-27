// GuideListView.swift — AR OMS Phase 1
//
// Entry point from AnchorHubView for the AR Guide feature.
//
// Author mode:
//   • Shows all guides (drafts + published) with draft/published badge.
//   • Toolbar "+" button → GuideEditorView sheet to create a new guide.
//   • Tap existing guide row → GuideEditorView sheet to edit.
//
// Operator mode:
//   • Shows only published guides.
//   • Steps are fetched in parallel with the guide list so placement status
//     is known immediately — rows with unplaced steps show a ⚠ badge and
//     tapping them shows an alert instead of starting the session.
//   • Tap a ready guide → QRScanGateView → ARGuideSessionView.

import SwiftUI

struct GuideListView: View {

    let anchor: Anchor
    let mode:   AppMode

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @State private var guides:    [ARGuide] = []
    @State private var allSteps:  [String: [GuideStep]] = [:]   // guideId → steps (cached)
    @State private var isLoading  = false
    @State private var loadError: String? = nil

    // Author: create / edit
    @State private var showCreateSheet = false
    @State private var editingGuide:   ARGuide? = nil

    // Operator: session flow
    @State private var pendingGuide:  ARGuide? = nil
    @State private var showScanGate   = false
    @State private var guideSteps:    [GuideStep] = []
    @State private var sessionInput:  GuideSessionInput? = nil

    // Pilot hardening: transient "queued sign-offs uploaded" banner
    @State private var syncedBanner: String? = nil

    // Operator: unplaced-steps alert
    @State private var showUnplacedAlert  = false
    @State private var unplacedAlertGuide = ""
    @State private var unplacedCount      = 0

    private struct GuideSessionInput: Identifiable {
        let guide: ARGuide
        let steps: [GuideStep]
        var id: String { guide.id }
    }

    // All steps placed (or steps not yet loaded — optimistic)
    private func isReady(_ guide: ARGuide) -> Bool {
        guard let steps = allSteps[guide.id], !steps.isEmpty else { return true }
        return steps.allSatisfy { $0.isPlaced }
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading guides…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 40)).foregroundStyle(.orange)
                    Text(err).font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)
                    Button("Retry") { Task { await loadGuides() } }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if guides.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(guides) { guide in
                        GuideRow(guide: guide, mode: mode, isReady: isReady(guide))
                            .contentShape(Rectangle())
                            .onTapGesture { handleTap(guide) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if mode == .author {
                                    Button(role: .destructive) {
                                        Task { await deleteGuide(guide) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("AR Guides")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if mode == .author {
                ToolbarItem(placement: .primaryAction) {
                    Button { showCreateSheet = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .task { await loadGuides() }
        // Pilot hardening: push any sign-offs that were saved offline. The
        // guide list is the natural sync point — every run starts here.
        .task {
            guard PendingSessionQueue.count > 0 else { return }
            let n = await PendingSessionQueue.drain(client: SIBClient(settings: settings))
            if n > 0 {
                syncedBanner = "\(n) saved sign-off\(n == 1 ? "" : "s") uploaded"
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                syncedBanner = nil
            }
        }
        .overlay(alignment: .bottom) {
            if let banner = syncedBanner {
                Label(banner, systemImage: "checkmark.icloud.fill")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Color.green.opacity(0.9), in: Capsule())
                    .padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: syncedBanner)
        // ── Unplaced steps alert ──────────────────────────────────────────────
        .alert("Guide Not Ready", isPresented: $showUnplacedAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("\"\(unplacedAlertGuide)\" has \(unplacedCount) step\(unplacedCount == 1 ? "" : "s") that haven't been placed in AR yet.\n\nAsk the Author to open the Guide Editor on their device and place the remaining steps before running this guide.")
        }
        // ── Author: create new guide ──────────────────────────────────────────
        .sheet(isPresented: $showCreateSheet, onDismiss: { Task { await loadGuides() } }) {
            GuideEditorView(anchor: anchor, guide: nil)
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
        }
        // ── Author: edit existing guide ───────────────────────────────────────
        .sheet(item: $editingGuide, onDismiss: { Task { await loadGuides() } }) { guide in
            GuideEditorView(anchor: anchor, guide: guide)
                .environmentObject(settings)
                .environmentObject(appState)
                .environmentObject(tour)
        }
        // ── Operator: QR scan gate ────────────────────────────────────────────
        .fullScreenCover(isPresented: $showScanGate, onDismiss: {
            guard let guide = pendingGuide, !guideSteps.isEmpty else { return }
            DispatchQueue.main.async {
                sessionInput = GuideSessionInput(guide: guide, steps: guideSteps)
            }
        }) {
            QRScanGateView(
                mode: .operator,
                onSessionReady: { showScanGate = false },
                onCancel: {
                    pendingGuide = nil
                    showScanGate = false
                }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        // ── Operator: AR Guide session ────────────────────────────────────────
        .fullScreenCover(item: $sessionInput) { input in
            ARGuideSessionView(
                anchor: anchor,
                guide:  input.guide,
                steps:  input.steps
            )
            .environmentObject(settings)
            .environmentObject(appState)
        }
    }

    // ── Empty state ───────────────────────────────────────────────────────────

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Guides", systemImage: "list.clipboard")
        } description: {
            if mode == .author {
                Text("Tap + to create your first AR Guide for this anchor.")
            } else {
                Text("No published guides yet. Ask the Author to create and publish a guide.")
            }
        } actions: {
            if mode == .author {
                Button("Create Guide") { showCreateSheet = true }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private func handleTap(_ guide: ARGuide) {
        if mode == .author {
            editingGuide = guide
        } else {
            // Block if any steps are unplaced
            if !isReady(guide) {
                let steps = allSteps[guide.id] ?? []
                unplacedAlertGuide = guide.name
                unplacedCount      = steps.filter { !$0.isPlaced }.count
                showUnplacedAlert  = true
                return
            }
            // Use cached steps — no second fetch needed
            pendingGuide = guide
            guideSteps   = allSteps[guide.id] ?? []
            showScanGate = true
        }
    }

    private func deleteGuide(_ guide: ARGuide) async {
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteGuide(id: guide.id)
            guides.removeAll { $0.id == guide.id }
            allSteps.removeValue(forKey: guide.id)
        } catch {
            loadError = "Delete failed: \(friendlyMessage(for: error))"
        }
    }

    // ── Network ───────────────────────────────────────────────────────────────

    private func loadGuides() async {
        isLoading = true
        loadError = nil
        let client = SIBClient(settings: settings)
        do {
            let loaded = try await client.fetchGuides(
                anchorId:           anchor.id,
                includeUnpublished: mode == .author
            )
            guides = loaded

            // Fetch steps for all guides in parallel so placement status is
            // known immediately — avoids a second round-trip when Operator taps.
            var stepsMap: [String: [GuideStep]] = [:]
            await withTaskGroup(of: (String, [GuideStep]).self) { group in
                for g in loaded {
                    group.addTask {
                        let steps = (try? await client.fetchGuideSteps(guideId: g.id)) ?? []
                        return (g.id, steps)
                    }
                }
                for await (id, steps) in group {
                    stepsMap[id] = steps
                }
            }
            allSteps = stepsMap
        } catch {
            loadError = friendlyMessage(for: error)
        }
        isLoading = false
    }
}

// ── Guide row ─────────────────────────────────────────────────────────────────

private struct GuideRow: View {
    let guide:   ARGuide
    let mode:    AppMode
    let isReady: Bool           // false → has unplaced steps (Operator mode warning)

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(iconBgColor)
                    .frame(width: 44, height: 44)
                Image(systemName: iconName)
                    .font(.system(size: 20))
                    .foregroundStyle(iconFgColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(guide.name)
                    .font(.subheadline.bold())
                    .lineLimit(1)
                if !guide.description.isEmpty {
                    Text(guide.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text("by \(guide.createdBy)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            trailingBadge
        }
        .padding(.vertical, 4)
        .opacity(mode == .operator && !isReady ? 0.65 : 1.0)
    }

    // ── Computed appearance ───────────────────────────────────────────────────

    private var iconName: String {
        if mode == .operator && !isReady { return "exclamationmark.triangle.fill" }
        return "list.bullet.clipboard"
    }

    private var iconBgColor: Color {
        if mode == .operator && !isReady { return Color.orange.opacity(0.12) }
        return Color.indigo.opacity(0.12)
    }

    private var iconFgColor: Color {
        if mode == .operator && !isReady { return .orange }
        return .indigo
    }

    @ViewBuilder
    private var trailingBadge: some View {
        if mode == .author {
            // Author: show published/draft badge
            if guide.published {
                Text("Live")
                    .font(.caption2.bold())
                    .foregroundStyle(.green)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Color.green.opacity(0.10))
                    .clipShape(Capsule())
            } else {
                Text("Draft")
                    .font(.caption2.bold())
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Color.orange.opacity(0.10))
                    .clipShape(Capsule())
            }
        } else if !isReady {
            // Operator: guide has unplaced steps
            Text("Not ready")
                .font(.caption2.bold())
                .foregroundStyle(.orange)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Color.orange.opacity(0.10))
                .clipShape(Capsule())
        } else {
            // Operator: ready to run
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}
