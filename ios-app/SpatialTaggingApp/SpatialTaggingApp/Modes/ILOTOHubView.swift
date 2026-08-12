// ILOTOHubView.swift — the iLOTO hub for a control-panel anchor (slice 1).
//
// Structure per docs/ILOTO.md §3:
//   • Live status banner first — the first question at a panel is always
//     "what state is this in", before any menu.
//   • Six tiles: Safe Off, LOTO (both certification-gated), Check Status,
//     My LOTO, AR LOTO Map, My LOTO Training.
//
// Slice 1 ships the hub + real cert gate (server-backed) with the flows
// behind the tiles arriving in slices 2–4. Tiles never hide: a locked tile
// explains WHY it is locked and routes to Training.

import SwiftUI

struct ILOTOHubView: View {

    let anchor: Anchor
    let onBack: () -> Void

    @EnvironmentObject private var settings: AppSettings

    @State private var status: LotoAnchorStatus? = nil
    @State private var certification: LotoCertification? = nil
    @State private var isLoading = true
    @State private var loadError: String? = nil
    @State private var placeholder: PlaceholderInfo? = nil
    @State private var route: LotoHubRoute? = nil
    /// Locks I hold anywhere (not just this panel) — the shift-end nudge.
    @State private var myLockCount = 0

    /// Cert gate: Safe Off and LOTO require a valid, unexpired certification.
    /// Everything else stays open — an affected employee must be able to SEE
    /// state without being authorized to change it.
    private var isCertified: Bool { certification?.isValid == true }

    var body: some View {
        List {
            // ── Panel card + status banner ─────────────────────────────────
            Section {
                panelCard
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            if let err = loadError {
                Section {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                }
            }

            // ── The six tiles ──────────────────────────────────────────────
            Section {
                lotoTileGrid
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
            } footer: {
                if !isCertified {
                    Label("Safe Off and LOTO unlock after you complete My LOTO Training.",
                          systemImage: "lock.fill")
                        .font(.caption)
                }
            }

            // ── Safety stance — always visible, never says "safe" ──────────
            Section {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.shield.fill")
                        .foregroundStyle(.orange).font(.subheadline)
                    Text("This app records and verifies. The physical lock — and your own try test — are the safety controls. Always verify at the panel before body contact.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("iLOTO")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") { onBack() }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $placeholder) { info in
            LotoPlaceholderSheet(info: info)
        }
        .navigationDestination(item: $route) { r in
            Group {
                switch r {
                case .safeOff:
                    LotoKindView(anchor: anchor, kind: .safeoff, isCertified: isCertified)
                case .loto:
                    LotoKindView(anchor: anchor, kind: .loto, isCertified: isCertified)
                case .checkStatus:
                    LotoStatusListView(anchor: anchor, isCertified: isCertified)
                case .myLoto:
                    MyLotoView()
                case .training:
                    LotoTrainingView(onCertChanged: { Task { await load() } })
                case .map:
                    LotoMapHomeView(anchor: anchor, isCertified: isCertified)
                }
            }
            .environmentObject(settings)
            // Status may have changed inside the flows — refresh on return.
            .onDisappear { Task { await load() } }
        }
    }

    // ── Panel card ─────────────────────────────────────────────────────────

    private var panelCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.red.opacity(0.12))
                        .frame(width: 42, height: 42)
                    Image(systemName: "bolt.shield")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.red)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(anchor.assetId)
                        .font(.headline)
                    Text("Control panel · QR + world map")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if isLoading { ProgressView() }
            }

            // Status banner — derived server-side from the append-only log.
            if let s = status {
                HStack(spacing: 12) {
                    statusPill(count: s.lotoActive, label: "LOTO active",
                               color: .red, icon: "lock.fill")
                    statusPill(count: s.safeOffActive, label: "safe off",
                               color: .yellow, icon: "power")
                    Spacer()
                    if let last = s.lastEventAt {
                        Text(relative(last))
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }

            // Certification strip
            HStack(spacing: 6) {
                Image(systemName: isCertified ? "checkmark.seal.fill" : "seal")
                    .font(.caption)
                    .foregroundStyle(isCertified ? .green : .secondary)
                if let cert = certification, cert.isValid {
                    Text("Certified · expires \(shortDate(cert.expiresAt))")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Not certified — complete My LOTO Training to apply or remove locks")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func statusPill(count: Int, label: String, color: Color, icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption2)
            Text("\(count) \(label)").font(.caption.bold())
        }
        .foregroundStyle(count > 0 ? color : .secondary)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background((count > 0 ? color : Color.secondary).opacity(0.12), in: Capsule())
    }

    // ── Tiles ──────────────────────────────────────────────────────────────

    private var lotoTileGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                  spacing: 10) {
            lotoTile(icon: "power", tint: .yellow, title: "Safe Off",
                     caption: safeOffCaption, gated: true) {
                route = .safeOff
            }
            lotoTile(icon: "lock.fill", tint: .red, title: "LOTO",
                     caption: lotoCaption, gated: true) {
                route = .loto
            }
            lotoTile(icon: "eye", tint: .blue, title: "Check Status",
                     caption: "AR + list", gated: false) {
                route = .checkStatus
            }
            lotoTile(icon: "person.fill",
                     tint: myLockCount > 0 ? .red : .indigo,
                     title: "My LOTO",
                     caption: myLockCount > 0
                        ? "\(myLockCount) active lock\(myLockCount == 1 ? "" : "s")!"
                        : "My active locks",
                     gated: false) {
                route = .myLoto
            }
            lotoTile(icon: "point.topleft.down.curvedto.point.bottomright.up", tint: .teal,
                     title: "AR LOTO Map", caption: "Electricity flow", gated: false) {
                route = .map
            }
            lotoTile(icon: "graduationcap.fill", tint: .green, title: "My LOTO Training",
                     caption: isCertified ? "Certified ✓" : "Get certified", gated: false) {
                route = .training
            }
        }
    }

    private func lotoTile(icon: String, tint: Color, title: String, caption: String,
                          gated: Bool, action: @escaping () -> Void) -> some View {
        let locked = gated && !isCertified
        return Button {
            if locked {
                placeholder = .init(title: "\(title) is locked",
                    message: "Applying or removing locks requires a valid LOTO certification. Complete My LOTO Training first — it takes a few minutes.")
            } else {
                action()
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(locked ? Color.secondary : tint)
                    Spacer()
                    if locked {
                        Image(systemName: "lock.fill")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(locked ? .secondary : .primary)
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(locked ? Color(.separator) : tint.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var safeOffCaption: String {
        guard let s = status else { return "Apply · Remove" }
        return s.safeOffActive > 0 ? "\(s.safeOffActive) active" : "Apply · Remove"
    }

    private var lotoCaption: String {
        guard let s = status else { return "Apply · Remove" }
        return s.lotoActive > 0 ? "\(s.lotoActive) active" : "Apply · Remove"
    }

    // ── Data ───────────────────────────────────────────────────────────────

    private func load() async {
        isLoading = true
        loadError = nil
        let client = SIBClient(settings: settings)
        do {
            async let statusFetch = client.fetchLotoStatus(anchorId: anchor.id)
            async let certFetch   = client.fetchLotoCertifications(userId: settings.authorName)
            async let myFetch     = client.fetchMyLoto(userId: settings.authorName)
            let (s, certs, mine) = try await (statusFetch, certFetch, myFetch)
            status        = s
            certification = certs.first(where: { $0.isValid }) ?? certs.first
            myLockCount   = mine.count
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func relative(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let r = RelativeDateTimeFormatter()
        r.unitsStyle = .abbreviated
        return "last event " + r.localizedString(for: date, relativeTo: Date())
    }

    private func shortDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

/// Pushed destinations from the hub tiles (slices 2–3).
enum LotoHubRoute: String, Identifiable, Hashable {
    case safeOff, loto, checkStatus, myLoto, training, map
    var id: String { rawValue }
}

// ── Placeholder sheet (remaining slice 3/4 tiles) ──────────────────────────

private struct PlaceholderInfo: Identifiable {
    let id = UUID()
    let title:   String
    let message: String
}

private struct LotoPlaceholderSheet: View {
    let info: PlaceholderInfo
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "hammer.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.secondary)
                Text(info.message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Spacer()
            }
            .padding(.top, 40)
            .navigationTitle(info.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
