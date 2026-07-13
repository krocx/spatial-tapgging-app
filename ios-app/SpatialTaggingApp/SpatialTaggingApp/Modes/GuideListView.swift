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
//   • Tap guide row → QRScanGateView (QR scan to lock AR origin) → ARGuideSessionView.
//   • Empty state guides operator to ask the Author to publish a guide.

import SwiftUI

struct GuideListView: View {

    let anchor: Anchor
    let mode:   AppMode

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @State private var guides:       [ARGuide] = []
    @State private var isLoading     = false
    @State private var loadError:    String? = nil

    // Author: create / edit
    @State private var showCreateSheet = false
    @State private var editingGuide:   ARGuide? = nil

    // Operator: session flow
    @State private var selectedGuide:  ARGuide? = nil
    @State private var pendingGuide:   ARGuide? = nil   // waiting for QR scan
    @State private var showScanGate    = false
    @State private var guideSteps:     [GuideStep] = []
    @State private var showSession     = false

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
                        GuideRow(guide: guide, mode: mode)
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
                    Button {
                        showCreateSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .task { await loadGuides() }
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
        // ── Operator: QR scan gate before session ─────────────────────────────
        // onDismiss fires after the dismiss animation fully completes, which is
        // the only reliable place to present the next fullScreenCover.  Using
        // asyncAfter is not reliable because its offset is relative to the state
        // change, not the end of the modal animation.
        .fullScreenCover(isPresented: $showScanGate, onDismiss: {
            if selectedGuide != nil {
                showSession = true
            }
        }) {
            QRScanGateView(
                mode: .operator,
                onSessionReady: {
                    // Set session data before dismissing so onDismiss finds it.
                    if let guide = pendingGuide, !guideSteps.isEmpty {
                        selectedGuide = guide
                    }
                    showScanGate = false
                },
                onCancel: {
                    selectedGuide = nil   // clear any stale state from a prior session
                    showScanGate  = false
                    pendingGuide  = nil
                }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
        // ── Operator: AR Guide session ────────────────────────────────────────
        .fullScreenCover(isPresented: $showSession) {
            if let guide = selectedGuide {
                ARGuideSessionView(
                    anchor: anchor,
                    guide:  guide,
                    steps:  guideSteps
                )
                .environmentObject(settings)
                .environmentObject(appState)
            }
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
            // Operator: fetch steps then initiate QR scan
            pendingGuide = guide
            Task {
                await fetchStepsAndStartSession(guide)
            }
        }
    }

    private func fetchStepsAndStartSession(_ guide: ARGuide) async {
        let client = SIBClient(settings: settings)
        do {
            let steps = try await client.fetchGuideSteps(guideId: guide.id)
            guideSteps   = steps
            showScanGate = true
        } catch {
            loadError = "Couldn't load steps: \(friendlyMessage(for: error))"
        }
    }

    private func deleteGuide(_ guide: ARGuide) async {
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteGuide(id: guide.id)
            guides.removeAll { $0.id == guide.id }
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
            guides = try await client.fetchGuides(
                anchorId:           anchor.id,
                includeUnpublished: mode == .author
            )
        } catch {
            loadError = friendlyMessage(for: error)
        }
        isLoading = false
    }
}

// ── Guide row ─────────────────────────────────────────────────────────────────

private struct GuideRow: View {
    let guide: ARGuide
    let mode:  AppMode

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.indigo.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: "list.bullet.clipboard")
                    .font(.system(size: 20))
                    .foregroundStyle(.indigo)
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

            // Published / draft badge (Author only)
            if mode == .author {
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
            } else {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
