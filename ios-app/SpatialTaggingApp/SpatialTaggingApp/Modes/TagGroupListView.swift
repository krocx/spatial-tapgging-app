// TagGroupListView.swift
//
// Entry point from AnchorHubView for the Inspection Sets (Tag Groups) feature.
// Mirrors GuideListView in structure and style.
//
// Author mode:
//   • Shows all Inspection Sets for this anchor.
//   • Toolbar "+" button → create a new Inspection Set.
//   • Tap row → TagGroupDetailView (view tags + Enter AR).
//   • Swipe-to-delete → removes the group (tags become ungrouped, not deleted).
//
// Operator mode:
//   • Shows all Inspection Sets.
//   • Groups with no trained tags are shown but visually indicated as not ready.
//   • Tap row → TagGroupDetailView (view tags + Enter AR to inspect).

import SwiftUI

struct TagGroupListView: View {

    let anchor:         Anchor
    let mode:           AppMode
    let onSessionReady: (Anchor, [Tag]) -> Void   // passed down from AnchorHubView

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @State private var groups:      [TagGroup] = []
    @State private var isLoading    = false
    @State private var loadError:   String? = nil

    // Author: creation sheet
    @State private var showCreateSheet = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading inspection sets…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 40)).foregroundStyle(.orange)
                    Text(err).font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)
                    Button("Retry") { Task { await loadGroups() } }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if groups.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(groups) { group in
                        NavigationLink {
                            TagGroupDetailView(
                                group:          group,
                                anchor:         anchor,
                                mode:           mode,
                                onSessionReady: onSessionReady
                            )
                            .environmentObject(settings)
                            .environmentObject(appState)
                            .environmentObject(tour)
                        } label: {
                            TagGroupRow(group: group)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if mode == .author {
                                Button(role: .destructive) {
                                    Task { await deleteGroup(group) }
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
        .navigationTitle("Inspection Sets")
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
        .task { await loadGroups() }
        // ── Author: create new group ──────────────────────────────────────────
        .sheet(isPresented: $showCreateSheet, onDismiss: { Task { await loadGroups() } }) {
            CreateTagGroupSheet(anchor: anchor)
                .environmentObject(settings)
                .environmentObject(appState)
        }
    }

    // ── Empty state ───────────────────────────────────────────────────────────

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Inspection Sets", systemImage: "checklist")
        } description: {
            if mode == .author {
                Text("Tap + to create your first Inspection Set for this anchor.")
            } else {
                Text("No inspection sets created yet. Ask the Author to set one up.")
            }
        } actions: {
            if mode == .author {
                Button("Create Set") { showCreateSheet = true }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    // ── Network ───────────────────────────────────────────────────────────────

    private func loadGroups() async {
        isLoading = true
        loadError = nil
        let client = SIBClient(settings: settings)
        do {
            groups = try await client.fetchTagGroups(anchorId: anchor.id)
        } catch {
            loadError = friendlyMessage(for: error)
        }
        isLoading = false
    }

    private func deleteGroup(_ group: TagGroup) async {
        let client = SIBClient(settings: settings)
        do {
            try await client.deleteTagGroup(id: group.id)
            groups.removeAll { $0.id == group.id }
        } catch {
            loadError = "Delete failed: \(friendlyMessage(for: error))"
        }
    }
}

// ── Tag Group row ─────────────────────────────────────────────────────────────

private struct TagGroupRow: View {
    let group: TagGroup

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.teal.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: "checklist")
                    .font(.system(size: 20))
                    .foregroundStyle(.teal)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(group.name)
                    .font(.subheadline.bold())
                    .lineLimit(1)
                if let desc = group.description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let author = group.createdBy {
                    Text("by \(author)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// ── Create Inspection Set sheet ───────────────────────────────────────────────

private struct CreateTagGroupSheet: View {

    let anchor: Anchor

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState

    @State private var name        = ""
    @State private var description = ""
    @State private var isSaving    = false
    @State private var saveError:  String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section("Set Details") {
                    TextField("Name (required)", text: $name)
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(2...4)
                }

                if let err = saveError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Inspection Set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        saveError = nil
        let client = SIBClient(settings: settings)
        do {
            let req = CreateTagGroupRequest(
                anchorId:    anchor.id,
                name:        name.trimmingCharacters(in: .whitespaces),
                description: description.trimmingCharacters(in: .whitespaces).isEmpty
                             ? nil
                             : description.trimmingCharacters(in: .whitespaces),
                createdBy:   settings.authorName.isEmpty ? nil : settings.authorName
            )
            _ = try await client.createTagGroup(req)
            dismiss()
        } catch {
            saveError = friendlyMessage(for: error)
        }
        isSaving = false
    }
}
