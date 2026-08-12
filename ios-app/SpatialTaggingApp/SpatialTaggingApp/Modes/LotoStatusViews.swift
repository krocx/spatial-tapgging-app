// LotoStatusViews.swift — iLOTO slice 2: point detail, per-kind management,
// and the panel status list.
//
//   LotoPointDetailSheet — one point: state, owner, serial, event history with
//                          evidence photos, contextual Apply/Remove (cert-gated).
//                          Shared by the lists AND the AR walk.
//   LotoKindView         — Safe Off / LOTO tile destination: that kind's points
//                          with live state, "Define points in AR" for authoring.
//   LotoStatusListView   — Check Status tile destination: every point + AR walk.
//
// All state shown here is SERVER-derived (GET /loto/status) — the client never
// computes lock state from cached events.

import SwiftUI

// ════════════════════════════════════════════════════════════════════════════
// MARK: - Point detail sheet
// ════════════════════════════════════════════════════════════════════════════

struct LotoPointDetailSheet: View {

    let anchor:      Anchor
    let status:      LotoPointStatus
    let isCertified: Bool
    /// Authors may delete a CLEAR point (server refuses while locked).
    let allowDelete: Bool
    /// Called with fresh derived status after an apply/remove succeeds.
    let onChanged: (LotoPointStatus) -> Void
    let onDeleted: () -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var events: [LotoEvent] = []
    @State private var photos: [String: UIImage] = [:]   // eventId → evidence
    @State private var showApply = false
    @State private var showRemove = false
    @State private var deleteError: String? = nil
    @State private var isDeleting = false

    private var point: LotoPoint { status.point }
    private var isMyLock: Bool { status.lockedBy == settings.authorName }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LotoPointHeaderRow(point: point)
                    stateRow
                }

                // ── Contextual action ───────────────────────────────────────
                Section {
                    if !isCertified {
                        Label("Complete My LOTO Training to apply or remove locks.",
                              systemImage: "lock.fill")
                            .font(.caption).foregroundStyle(.secondary)
                    } else if status.isLocked {
                        Button {
                            showRemove = true
                        } label: {
                            Label(isMyLock ? "Remove my lock…" : "Lock details / override…",
                                  systemImage: isMyLock ? "lock.open.fill" : "exclamationmark.shield")
                        }
                        .foregroundStyle(isMyLock ? Color.green : Color.orange)
                    } else {
                        Button {
                            showApply = true
                        } label: {
                            Label("Apply \(point.kind.displayName)…",
                                  systemImage: point.kind == .loto ? "lock.fill" : "power")
                        }
                        .foregroundStyle(point.kind == .loto ? Color.red : Color.orange)
                    }
                }

                // ── History (append-only, newest first) ─────────────────────
                Section {
                    if events.isEmpty {
                        Text("No events yet.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        ForEach(events) { event in
                            eventRow(event)
                        }
                    }
                } header: {
                    Text("History")
                } footer: {
                    Text("Events are permanent records — nothing here can be edited or deleted.")
                }

                if allowDelete && !status.isLocked {
                    Section {
                        if let err = deleteError {
                            Label(err, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption).foregroundStyle(.red)
                        }
                        Button(role: .destructive) {
                            Task { await deletePoint() }
                        } label: {
                            if isDeleting { ProgressView() }
                            else { Label("Delete point", systemImage: "trash") }
                        }
                    } footer: {
                        Text("Removes the marker; the event history is kept for audit.")
                    }
                }
            }
            .navigationTitle(point.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await loadHistory() }
            .sheet(isPresented: $showApply) {
                LotoApplyFlowView(anchor: anchor, point: point) { fresh in
                    onChanged(fresh)
                }
                .environmentObject(settings)
            }
            .sheet(isPresented: $showRemove) {
                LotoRemoveFlowView(anchor: anchor, status: status) { fresh in
                    onChanged(fresh)
                }
                .environmentObject(settings)
            }
        }
    }

    private var stateRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(status.isLocked ? (point.kind == .loto ? Color.red : Color.yellow) : Color.green)
                .frame(width: 10, height: 10)
            if status.isLocked {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Locked by \(status.lockedByName ?? "?")").font(.subheadline.bold())
                    HStack(spacing: 6) {
                        if let at = status.lockedAt {
                            Text(LotoFormat.relative(at)).font(.caption).foregroundStyle(.secondary)
                        }
                        if let s = status.lockSerial {
                            Text("· lock \(s)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("Clear — no lock applied").font(.subheadline)
            }
            Spacer()
        }
    }

    private func eventRow(_ event: LotoEvent) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: eventIcon(event.type))
                    .font(.caption)
                    .foregroundStyle(eventColor(event.type))
                Text(eventTitle(event))
                    .font(.caption.bold())
                Spacer()
                Text(LotoFormat.relative(event.createdAt))
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            if event.type == .overrideRemove, let o = event.override {
                Text("Override by \(o.supervisorName): \(o.reason)")
                    .font(.caption2).foregroundStyle(.orange)
            }
            if let serial = event.lockSerial {
                Text("Lock \(serial)").font(.caption2).foregroundStyle(.secondary)
            }
            if let img = photos[event.id] {
                Image(uiImage: img)
                    .resizable().scaledToFit()
                    .frame(maxHeight: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(.vertical, 2)
    }

    private func eventIcon(_ t: LotoEventType) -> String {
        switch t {
        case .apply:          return "lock.fill"
        case .remove:         return "lock.open.fill"
        case .overrideRemove: return "exclamationmark.shield.fill"
        }
    }

    private func eventColor(_ t: LotoEventType) -> Color {
        switch t {
        case .apply:          return point.kind == .loto ? .red : .orange
        case .remove:         return .green
        case .overrideRemove: return .orange
        }
    }

    private func eventTitle(_ e: LotoEvent) -> String {
        switch e.type {
        case .apply:          return "Applied by \(e.userName)"
        case .remove:         return "Removed by \(e.userName)"
        case .overrideRemove: return "OVERRIDE removal"
        }
    }

    private func loadHistory() async {
        let client = SIBClient(settings: settings)
        guard let all = try? await client.fetchLotoEvents(anchorId: anchor.id) else { return }
        events = all.filter { $0.pointId == point.id }
        // Evidence thumbnails for the most recent few events.
        for event in events.prefix(5) {
            guard let file = event.photoPath, photos[event.id] == nil else { continue }
            if let data = try? await client.fetchLotoEventPhoto(filename: file),
               let img = UIImage(data: data) {
                photos[event.id] = img
            }
        }
    }

    private func deletePoint() async {
        isDeleting = true
        deleteError = nil
        do {
            try await SIBClient(settings: settings).deleteLotoPoint(id: point.id)
            isDeleting = false
            onDeleted()
            dismiss()
        } catch {
            deleteError = error.localizedDescription
            isDeleting = false
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MARK: - Per-kind view (Safe Off / LOTO tiles)
// ════════════════════════════════════════════════════════════════════════════

struct LotoKindView: View {

    let anchor:      Anchor
    let kind:        LotoPointKind
    let isCertified: Bool

    @EnvironmentObject private var settings: AppSettings

    @State private var statuses: [LotoPointStatus] = []
    @State private var isLoading = true
    @State private var loadError: String? = nil
    @State private var showAR = false
    @State private var selected: LotoPointStatus? = nil

    private var accent: Color { kind == .loto ? .red : .orange }

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
                } else if statuses.isEmpty {
                    ContentUnavailableView {
                        Label("No \(kind.displayName) points", systemImage: kind == .loto ? "lock" : "power")
                    } description: {
                        Text("An author defines the \(kind == .loto ? "switches" : "circuit breakers") on this panel by placing points in AR.")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(statuses) { st in
                        Button { selected = st } label: { pointRow(st) }
                            .buttonStyle(.plain)
                    }
                }
            } header: {
                if !statuses.isEmpty {
                    Text("\(statuses.filter(\.isLocked).count) locked of \(statuses.count)")
                }
            }

            Section {
                Button {
                    showAR = true
                } label: {
                    Label("Define points in AR", systemImage: "arkit")
                }
            } footer: {
                Text("Author mode: tap \(kind == .loto ? "switches" : "breakers") on the physical panel to place \(kind == .loto ? "red LOTO" : "yellow Safe Off") markers. The panel map saves when you finish.")
            }
        }
        .navigationTitle(kind.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(isPresented: $showAR, onDismiss: { Task { await load() } }) {
            // QR-gated: scan the panel QR first, then author in that frame.
            LotoARGateFlow(
                anchor: anchor,
                mode: .author(kind: kind),
                isCertified: isCertified,
                onExit: { showAR = false }
            )
        }
        .sheet(item: $selected) { st in
            LotoPointDetailSheet(
                anchor:      anchor,
                status:      st,
                isCertified: isCertified,
                allowDelete: true,
                onChanged:   { _ in selected = nil; Task { await load() } },
                onDeleted:   { Task { await load() } }
            )
            .environmentObject(settings)
        }
    }

    private func pointRow(_ st: LotoPointStatus) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(st.isLocked ? accent : Color.green)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(st.point.label).font(.subheadline.bold())
                if st.isLocked {
                    Text("Locked by \(st.lockedByName ?? "?") \(st.lockedAt.map(LotoFormat.relative) ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Clear").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    private func load() async {
        isLoading = statuses.isEmpty
        loadError = nil
        do {
            let s = try await SIBClient(settings: settings).fetchLotoStatus(anchorId: anchor.id)
            statuses = s.points.filter { $0.point.kind == kind }
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MARK: - AR LOTO map home (view · edit · delete)
// ════════════════════════════════════════════════════════════════════════════

struct LotoMapHomeView: View {

    let anchor:      Anchor
    let isCertified: Bool

    @EnvironmentObject private var settings: AppSettings

    @State private var map: LotoMap? = nil
    @State private var isLoading = true
    @State private var loadError: String? = nil
    @State private var arMode: LotoARMode? = nil
    @State private var confirmDelete = false
    @State private var isDeleting = false

    var body: some View {
        List {
            Section {
                if isLoading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let m = map {
                    HStack(spacing: 12) {
                        Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                            .font(.title3).foregroundStyle(.teal)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Flow map v\(m.version)").font(.subheadline.bold())
                            Text("\(m.strokes.count) line\(m.strokes.count == 1 ? "" : "s") · \(m.strokes.filter { $0.fedByPointId != nil }.count) linked to breakers")
                                .font(.caption).foregroundStyle(.secondary)
                            Text("by \(m.createdBy) · \(LotoFormat.relative(m.createdAt))")
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                } else {
                    ContentUnavailableView {
                        Label("No flow map yet", systemImage: "bolt")
                    } description: {
                        Text("Draw the panel's electricity flow in AR: start each line at its Safe Off breaker so the map greys out de-energized circuits live.")
                    }
                    .listRowBackground(Color.clear)
                }
                if let err = loadError {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    arMode = .status
                } label: {
                    Label("View in AR (with live status)", systemImage: "arkit")
                }
                .disabled(map == nil)

                Button {
                    arMode = .mapEdit
                } label: {
                    Label(map == nil ? "Draw flow map in AR" : "Edit flow map in AR",
                          systemImage: "pencil.and.outline")
                }
            } footer: {
                Text("Drawing: tap a Safe Off marker to start a line at its breaker, then tap along the conduit. Saving creates a new version; earlier versions are kept.")
            }

            if map != nil {
                Section {
                    Button(role: .destructive) { confirmDelete = true } label: {
                        if isDeleting { ProgressView() }
                        else { Label("Delete flow map", systemImage: "trash") }
                    }
                }
            }
        }
        .navigationTitle("AR LOTO Map")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(item: $arMode, onDismiss: { Task { await load() } }) { m in
            LotoARGateFlow(anchor: anchor, mode: m, isCertified: isCertified,
                           onExit: { arMode = nil })
        }
        .confirmationDialog("Delete the flow map?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete all versions", role: .destructive) { Task { await deleteMap() } }
        } message: {
            Text("Removes the drawing only — points, locks and the audit trail are untouched.")
        }
    }

    private func load() async {
        isLoading = map == nil
        loadError = nil
        do {
            map = try await SIBClient(settings: settings).fetchLotoMap(anchorId: anchor.id)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func deleteMap() async {
        isDeleting = true
        do {
            try await SIBClient(settings: settings).deleteLotoMap(anchorId: anchor.id)
            map = nil
        } catch {
            loadError = error.localizedDescription
        }
        isDeleting = false
    }
}

extension LotoARMode: Identifiable {
    var id: String {
        switch self {
        case .author(let kind): return "author-\(kind.rawValue)"
        case .status:           return "status"
        case .mapEdit:          return "mapEdit"
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MARK: - Check Status (all points + AR walk)
// ════════════════════════════════════════════════════════════════════════════

struct LotoStatusListView: View {

    let anchor:      Anchor
    let isCertified: Bool

    @EnvironmentObject private var settings: AppSettings

    @State private var status: LotoAnchorStatus? = nil
    @State private var isLoading = true
    @State private var loadError: String? = nil
    @State private var showAR = false
    @State private var selected: LotoPointStatus? = nil

    var body: some View {
        List {
            if let s = status {
                Section {
                    HStack(spacing: 14) {
                        summaryChip(count: s.lotoActive, label: "LOTO", color: .red)
                        summaryChip(count: s.safeOffActive, label: "Safe Off", color: .orange)
                        summaryChip(count: s.points.filter { !$0.isLocked }.count, label: "Clear", color: .green)
                    }
                    .listRowBackground(Color.clear)
                }
            }

            Section {
                if isLoading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let err = loadError {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.red)
                } else if status?.points.isEmpty != false {
                    ContentUnavailableView {
                        Label("No points defined", systemImage: "mappin.slash")
                    } description: {
                        Text("Define Safe Off and LOTO points from the hub first.")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(status!.points) { st in
                        Button { selected = st } label: { row(st) }
                            .buttonStyle(.plain)
                    }
                }
            }

            Section {
                Button { showAR = true } label: {
                    Label("Walk the panel in AR", systemImage: "arkit")
                }
                .disabled(status?.points.isEmpty != false)
            } footer: {
                Text("Markers appear at each point: solid = locked, hollow = clear. Tap any marker for details.")
            }
        }
        .navigationTitle("Check Status")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(isPresented: $showAR, onDismiss: { Task { await load() } }) {
            // QR-gated: the status walk relocalizes from the panel QR too.
            LotoARGateFlow(
                anchor: anchor,
                mode: .status,
                isCertified: isCertified,
                onExit: { showAR = false }
            )
        }
        .sheet(item: $selected) { st in
            LotoPointDetailSheet(
                anchor:      anchor,
                status:      st,
                isCertified: isCertified,
                allowDelete: false,
                onChanged:   { _ in selected = nil; Task { await load() } },
                onDeleted:   { Task { await load() } }
            )
            .environmentObject(settings)
        }
    }

    private func summaryChip(count: Int, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(count)").font(.title3.bold()).foregroundStyle(count > 0 ? color : .secondary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background((count > 0 ? color : Color.secondary).opacity(0.10),
                    in: RoundedRectangle(cornerRadius: 10))
    }

    private func row(_ st: LotoPointStatus) -> some View {
        HStack(spacing: 10) {
            Image(systemName: st.point.kind == .loto ? "lock.fill" : "power")
                .font(.caption)
                .foregroundStyle(st.point.kind == .loto ? Color.red : Color.orange)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(st.point.label).font(.subheadline.bold())
                if st.isLocked {
                    Text("Locked by \(st.lockedByName ?? "?") \(st.lockedAt.map(LotoFormat.relative) ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Clear").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Circle()
                .fill(st.isLocked ? (st.point.kind == .loto ? Color.red : Color.yellow) : Color.green)
                .frame(width: 10, height: 10)
        }
        .contentShape(Rectangle())
    }

    private func load() async {
        isLoading = status == nil
        loadError = nil
        do {
            status = try await SIBClient(settings: settings).fetchLotoStatus(anchorId: anchor.id)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}
