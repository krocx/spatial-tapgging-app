// DemoGuidePickerView.swift - demo entry (2026.4.46)
//
// The operator has no chamber in front of them (another site, a meeting
// room, a demo) but wants to run a published Work Instruction. This picker
// lists every ready guide across chambers; choosing one opens the AR session
// in demo placement: no QR, no world map - the whole scene appears where the
// person taps, turned to face them, and the record is marked demo.
//
//   ChamberScanView "No chamber here? Run a demo" ──► this ──► ARGuideSessionView(startInDemo)
//
// Ready = published, every step placed (or the guide carries a placed assembly).

import SwiftUI

struct DemoGuidePickerView: View {
    let onPick: (Anchor, ARGuide, [GuideStep]) -> Void
    let onCancel: () -> Void

    @EnvironmentObject private var settings: AppSettings

    private struct Row: Identifiable {
        let anchor: Anchor
        let guide:  ARGuide
        let steps:  [GuideStep]
        var id: String { guide.id }
        var ready: Bool { !steps.isEmpty && steps.allSatisfy { $0.isPlaced } || guide.assembly?.pose != nil }
    }
    private struct Group_: Identifiable {
        let anchor: Anchor
        let rows:   [Row]
        var id: String { anchor.id }
    }

    @State private var groups:    [Group_] = []
    @State private var isLoading  = true
    @State private var loadError: String? = nil
    @State private var query      = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label {
                        Text("The guide appears where you tap and faces you. Full run, sign-off included; the record is marked as a demo and nothing is written to a chamber.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } icon: {
                        Image(systemName: "hand.tap").foregroundStyle(.green)
                    }
                }
                if isLoading {
                    Section { ProgressView("Loading guides…").frame(maxWidth: .infinity) }
                } else if let err = loadError {
                    Section {
                        Text(err).font(.subheadline).foregroundStyle(.secondary)
                        Button("Retry") { Task { await load() } }
                    }
                } else if filtered.isEmpty {
                    Section {
                        Text(query.isEmpty ? "No published guides with placed steps yet." : "Nothing matches \"\(query)\".")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(filtered) { g in
                        Section(g.anchor.assetId) {
                            ForEach(g.rows) { r in
                                Button { onPick(r.anchor, r.guide, r.steps) } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: r.guide.hasAssembly ? "cube.transparent" : "list.number")
                                            .foregroundStyle(r.guide.hasAssembly ? .green : .blue)
                                            .frame(width: 24)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(r.guide.name).font(.body).foregroundStyle(.primary)
                                            Text("\(r.steps.count) step\(r.steps.count == 1 ? "" : "s")\(r.guide.hasAssembly ? " · 3D model" : "")")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Guide or chamber")
            .navigationTitle("Run a demo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { onCancel() } }
            }
        }
        .task { await load() }
    }

    private var filtered: [Group_] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return groups }
        return groups.compactMap { g in
            if g.anchor.assetId.lowercased().contains(q) { return g }
            let rows = g.rows.filter { $0.guide.name.lowercased().contains(q) }
            return rows.isEmpty ? nil : Group_(anchor: g.anchor, rows: rows)
        }
    }

    /// Chambers → published guides → steps, fetched in parallel per chamber.
    private func load() async {
        isLoading = true; loadError = nil
        let client = SIBClient(settings: settings)
        do {
            let chambers = try await client.fetchAnchors().filter { $0.isChamber }
            let built: [Group_] = try await withThrowingTaskGroup(of: Group_?.self) { tg in
                for a in chambers {
                    tg.addTask {
                        let guides = try await client.fetchGuides(anchorId: a.id)
                        guard !guides.isEmpty else { return nil }
                        let rows: [Row] = try await withThrowingTaskGroup(of: Row.self) { sg in
                            for g in guides { sg.addTask { Row(anchor: a, guide: g, steps: try await client.fetchGuideSteps(guideId: g.id)) } }
                            var out: [Row] = []
                            for try await r in sg where r.ready { out.append(r) }
                            return out.sorted { $0.guide.name.localizedCaseInsensitiveCompare($1.guide.name) == .orderedAscending }
                        }
                        return rows.isEmpty ? nil : Group_(anchor: a, rows: rows)
                    }
                }
                var out: [Group_] = []
                for try await g in tg { if let g { out.append(g) } }
                return out.sorted { $0.anchor.assetId.localizedCaseInsensitiveCompare($1.anchor.assetId) == .orderedAscending }
            }
            groups = built
        } catch {
            loadError = friendlyMessage(for: error)
        }
        isLoading = false
    }
}
