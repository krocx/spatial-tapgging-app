// MyLotoView.swift — iLOTO slice 3: every lock I currently hold, across ALL
// panels. The answer to the classic incident: a lock forgotten at shift end,
// three buildings away from where you're standing.
//
// Each row deep-links straight into the Remove flow (the anchor record is
// fetched on tap so the flow has full context). An empty list is the goal
// state and says so.

import SwiftUI

struct MyLotoView: View {

    @EnvironmentObject private var settings: AppSettings

    @State private var entries: [MyLotoEntry] = []
    @State private var isLoading = true
    @State private var loadError: String? = nil

    // Remove deep-link
    @State private var removeTarget: RemoveTarget? = nil
    @State private var isFetchingAnchor = false

    private struct RemoveTarget: Identifiable {
        let anchor: Anchor
        let status: LotoPointStatus
        var id: String { status.point.id }
    }

    var body: some View {
        List {
            Section {
                if isLoading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let err = loadError {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                } else if entries.isEmpty {
                    ContentUnavailableView {
                        Label("No active locks", systemImage: "checkmark.seal")
                    } description: {
                        Text("You hold no locks anywhere. This is the right way to end a shift.")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(entries, id: \.status.point.id) { entry in
                        Button {
                            Task { await openRemove(entry) }
                        } label: {
                            row(entry)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: {
                if !entries.isEmpty {
                    Text("\(entries.count) active lock\(entries.count == 1 ? "" : "s")")
                }
            } footer: {
                if !entries.isEmpty {
                    Text("Remove every lock you hold before leaving site, or hand over to the on-coming shift under the site's transfer procedure.")
                }
            }
        }
        .navigationTitle("My LOTO")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .overlay { if isFetchingAnchor { ProgressView() } }
        .sheet(item: $removeTarget) { target in
            LotoRemoveFlowView(anchor: target.anchor, status: target.status) { _ in
                Task { await load() }
            }
            .environmentObject(settings)
        }
    }

    private func row(_ entry: MyLotoEntry) -> some View {
        let point = entry.status.point
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill((point.kind == .loto ? Color.red : Color.yellow).opacity(0.15))
                    .frame(width: 36, height: 36)
                Image(systemName: point.kind == .loto ? "lock.fill" : "power")
                    .foregroundStyle(point.kind == .loto ? Color.red : Color.orange)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(point.label).font(.subheadline.bold())
                Text(entry.anchorName)
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    if let at = entry.status.lockedAt {
                        Text("since \(LotoFormat.relative(at))")
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    if let s = entry.status.lockSerial {
                        Text("· lock \(s)").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer()
            Text("Remove")
                .font(.caption.bold())
                .foregroundStyle(.green)
            Image(systemName: "chevron.right")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    private func load() async {
        isLoading = entries.isEmpty
        loadError = nil
        do {
            entries = try await SIBClient(settings: settings).fetchMyLoto(userId: settings.authorName)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func openRemove(_ entry: MyLotoEntry) async {
        isFetchingAnchor = true
        defer { isFetchingAnchor = false }
        do {
            let anchor = try await SIBClient(settings: settings).fetchAnchor(id: entry.anchorId)
            removeTarget = RemoveTarget(anchor: anchor, status: entry.status)
        } catch {
            loadError = "Could not open panel: \(error.localizedDescription)"
        }
    }
}
