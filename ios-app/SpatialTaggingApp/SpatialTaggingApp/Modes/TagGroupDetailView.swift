// TagGroupDetailView.swift
//
// Shows the tags belonging to one Inspection Set and provides the AR entry point.
// Self-contained: handles its own QR scan gate and calls onSessionReady after scan.
//
// Author mode:
//   • Shows tag list with trained/untrained badges.
//   • Swipe-to-delete individual tags.
//   • "Enter AR" → QR scan → AuthorModeView with groupId threaded through AddTagSheet.
//     New tags placed in this session inherit the group's ID.
//
// Operator mode:
//   • Shows tag list with trained/untrained badges (read-only, no delete).
//   • "Enter AR (Inspect)" → QR scan → OperatorModeView with this group's tags only.

import SwiftUI

struct TagGroupDetailView: View {

    let group:          TagGroup
    let anchor:         Anchor
    let mode:           AppMode
    let onSessionReady: (Anchor, [Tag]) -> Void   // called after QR scan, with group's tags

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @State private var tags:       [Tag] = []
    @State private var isLoading   = false
    @State private var loadError:  String? = nil
    @State private var showScanGate = false

    // Cached tags for the AR session — set when "Enter AR" is tapped so the
    // fullScreenCover content closure doesn't race against the @State refresh.
    @State private var sessionTags: [Tag] = []

    private var trainedCount: Int { tags.filter { $0.isTrained == true }.count }

    var body: some View {
        Group {
            if isLoading && tags.isEmpty {
                ProgressView("Loading tags…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError, tags.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 40)).foregroundStyle(.orange)
                    Text(err).font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)
                    Button("Retry") { Task { await loadTags() } }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    // ── Tag list ──────────────────────────────────────────────
                    Section {
                        if tags.isEmpty {
                            ContentUnavailableView {
                                Label("No Tags Yet", systemImage: "tag.slash")
                            } description: {
                                Text(mode == .author
                                     ? "Enter AR to place your first tag in this set."
                                     : "The Author must add and train tags before inspection.")
                            }
                            .listRowBackground(Color.clear)
                        } else {
                            ForEach(tags) { tag in
                                TagGroupTagRow(tag: tag)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        if mode == .author {
                                            Button(role: .destructive) {
                                                Task { await deleteTag(tag) }
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                        }
                                    }
                            }
                        }
                    } header: {
                        HStack {
                            Text("Tags")
                            Spacer()
                            Text("\(trainedCount)/\(tags.count) trained")
                                .foregroundStyle(.secondary)
                        }
                    }

                    // ── Enter AR button ───────────────────────────────────────
                    Section {
                        Button {
                            sessionTags = tags
                            appState.activeAnchor  = anchor
                            appState.activeTags    = tags   // only this group's tags
                            appState.activeGroupId = group.id
                            showScanGate = true
                        } label: {
                            HStack {
                                Spacer()
                                Label(
                                    mode == .author ? "Enter AR" : "Enter AR (Inspect)",
                                    systemImage: "play.fill"
                                )
                                .font(.headline)
                                Spacer()
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.blue)
                        .controlSize(.large)

                        // Readiness hint
                        if mode == .operator, trainedCount < tags.count, !tags.isEmpty {
                            HStack {
                                Spacer()
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.caption).foregroundStyle(.orange)
                                Text("\(tags.count - trainedCount) tag\(tags.count - trainedCount == 1 ? "" : "s") not yet trained")
                                    .font(.caption).foregroundStyle(.orange)
                                Spacer()
                            }
                        } else {
                            HStack {
                                Spacer()
                                Image(systemName: "qrcode.viewfinder")
                                    .font(.caption).foregroundStyle(.secondary)
                                Text("Scan anchor QR to lock the session origin")
                                    .font(.caption).foregroundStyle(.secondary)
                                Spacer()
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.large)
        .task { await loadTags() }
        // ── QR scan gate ──────────────────────────────────────────────────────
        // QRScanGateView requires appState.activeAnchor + appState.activeTags
        // to be set before presentation — done above when "Enter AR" is tapped.
        .fullScreenCover(isPresented: $showScanGate) {
            QRScanGateView(
                mode: mode,
                onSessionReady: {
                    showScanGate = false
                    onSessionReady(anchor, sessionTags)
                },
                onCancel: { showScanGate = false }
            )
            .environmentObject(settings)
            .environmentObject(appState)
            .environmentObject(tour)
        }
    }

    // ── Network ───────────────────────────────────────────────────────────────

    private func loadTags() async {
        isLoading = true
        loadError = nil
        let client = SIBClient(settings: settings)
        do {
            tags = try await client.fetchTags(anchorId: anchor.id, groupId: group.id)
        } catch {
            loadError = friendlyMessage(for: error)
        }
        isLoading = false
    }

    private func deleteTag(_ tag: Tag) async {
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteTag(id: tag.id)
            tags.removeAll { $0.id == tag.id }
        } catch {
            loadError = "Delete failed: \(friendlyMessage(for: error))"
        }
    }
}

// ── Tag row ───────────────────────────────────────────────────────────────────

private struct TagGroupTagRow: View {
    let tag: Tag

    private var isTrained: Bool { tag.isTrained == true }

    var body: some View {
        HStack(spacing: 12) {
            // Tag type icon
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(tag.type.color.opacity(0.12))
                    .frame(width: 34, height: 34)
                Image(systemName: tag.type.iconName)
                    .font(.system(size: 15))
                    .foregroundStyle(tag.type.color)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(tag.label)
                    .font(.subheadline.bold())
                    .lineLimit(1)
                Text(tag.type.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !tag.expectedOutcome.isEmpty {
                    Text(tag.expectedOutcome)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Trained / Untrained badge
            Text(isTrained ? "Trained" : "Untrained")
                .font(.caption2.bold())
                .foregroundStyle(isTrained ? .green : .orange)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    (isTrained ? Color.green : Color.orange).opacity(0.10)
                )
                .clipShape(Capsule())
        }
        .padding(.vertical, 2)
    }
}
