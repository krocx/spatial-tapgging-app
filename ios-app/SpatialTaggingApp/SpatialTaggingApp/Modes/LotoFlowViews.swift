// LotoFlowViews.swift — iLOTO slice 2: the Apply and Remove checklist flows.
//
// These mirror the server's rules (sib/src/loto/loto-core.ts) but the SERVER
// is the referee — if this UI ever lets a step slip through, the POST returns
// a 4xx and we show that message verbatim. The UI's job is to make the right
// path the easy path:
//
//   LOTO apply    : notify affected → shut down → [apply physical lock]
//                   → photo evidence → TRY TEST → serial → submit
//   Safe Off apply: shut down → [apply lock] → photo → serial → submit
//   Remove        : reverse checklist → photo (optional) → submit
//   Override      : a separate, explicit flow — supervisor identity, reason,
//                   and the three OSHA exception confirmations. Never a
//                   fallback the UI reaches silently.
//
// Steps are enforced IN ORDER: each confirm stays disabled until the previous
// one is checked, because the order is the procedure (docs/ILOTO.md §6).

import SwiftUI

// ── Checklist copy (keys mirror loto-core.ts CHECKLISTS) ────────────────────

struct LotoChecklistItem: Identifiable {
    let key:      String
    let title:    String
    let subtitle: String
    var id: String { key }
}

enum LotoChecklists {

    static func apply(for kind: LotoPointKind) -> [LotoChecklistItem] {
        switch kind {
        case .loto:
            return [
                .init(key: "notifiedAffected", title: "Affected employees notified",
                      subtitle: "Everyone who operates or works near this equipment knows lockout is starting."),
                .init(key: "shutDown", title: "Equipment shut down",
                      subtitle: "Normal stopping procedure completed; energy source isolated at this switch."),
                .init(key: "tryTestNoStart", title: "Try test — no energization",
                      subtitle: "Start attempted with the normal controls: nothing moved, nothing energized. Controls returned to off/neutral."),
            ]
        case .safeoff:
            return [
                .init(key: "shutDown", title: "Equipment shut down",
                      subtitle: "Breaker opened; the equipment is out of service."),
            ]
        }
    }

    static func remove(for kind: LotoPointKind) -> [LotoChecklistItem] {
        switch kind {
        case .loto:
            return [
                .init(key: "toolsRemoved", title: "Tools and materials removed",
                      subtitle: "Work area inspected; nothing left inside the equipment."),
                .init(key: "personnelClear", title: "All personnel clear",
                      subtitle: "Nobody is in or on the equipment."),
                .init(key: "notifiedAffected", title: "Affected employees notified",
                      subtitle: "Everyone knows the equipment is about to re-energize."),
            ]
        case .safeoff:
            return [
                .init(key: "personnelClear", title: "All personnel clear",
                      subtitle: "Safe to re-energize the breaker."),
            ]
        }
    }

    /// The try test is separated visually in the LOTO apply flow — it comes
    /// AFTER the physical lock + photo, matching the real sequence.
    static let tryTestKey = "tryTestNoStart"
}

// ── Shared image helper ─────────────────────────────────────────────────────

func lotoJpegBase64(_ image: UIImage, maxDim: CGFloat = 1280) -> String? {
    let scale = min(1, maxDim / max(image.size.width, image.size.height))
    let size  = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let renderer = UIGraphicsImageRenderer(size: size)
    let resized  = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return resized.jpegData(compressionQuality: 0.72)?.base64EncodedString()
}

// ════════════════════════════════════════════════════════════════════════════
// MARK: - Apply flow
// ════════════════════════════════════════════════════════════════════════════

struct LotoApplyFlowView: View {

    let anchor: Anchor
    let point:  LotoPoint
    /// Called with the fresh server-derived status after a successful submit.
    let onCompleted: (LotoPointStatus) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var confirms: [String: Bool] = [:]
    @State private var photo: UIImage? = nil
    @State private var showCamera = false
    @State private var lockSerial = ""
    @State private var note = ""
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    private var items: [LotoChecklistItem] { LotoChecklists.apply(for: point.kind) }
    /// Items before the physical-lock step (try test comes after the photo).
    private var preLockItems: [LotoChecklistItem] { items.filter { $0.key != LotoChecklists.tryTestKey } }
    private var tryTestItem: LotoChecklistItem? { items.first { $0.key == LotoChecklists.tryTestKey } }

    private var preLockDone: Bool { preLockItems.allSatisfy { confirms[$0.key] == true } }
    private var allConfirmed: Bool { items.allSatisfy { confirms[$0.key] == true } }
    private var canSubmit: Bool { allConfirmed && photo != nil && !isSubmitting }

    private var accent: Color { point.kind == .loto ? .red : .yellow }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LotoPointHeaderRow(point: point)
                }

                // ── 1. Pre-lock confirmations, in order ─────────────────────
                Section {
                    ForEach(Array(preLockItems.enumerated()), id: \.element.id) { idx, item in
                        checklistRow(item: item,
                                     enabled: idx == 0 || confirms[preLockItems[idx - 1].key] == true)
                    }
                } header: {
                    Text("Before the lock")
                } footer: {
                    Text("Confirm in order — the order is the procedure.")
                }

                // ── 2. Physical lock + photo evidence ───────────────────────
                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "lock.fill").foregroundStyle(accent)
                        Text("Apply the physical \(point.kind == .loto ? "red" : "yellow") lock now, then photograph it in place.")
                            .font(.subheadline)
                    }
                    if let img = photo {
                        Image(uiImage: img)
                            .resizable().scaledToFit()
                            .frame(maxHeight: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    Button {
                        showCamera = true
                    } label: {
                        Label(photo == nil ? "Photograph the applied lock" : "Retake photo",
                              systemImage: "camera.fill")
                    }
                    .disabled(!preLockDone)
                } header: {
                    Text("Evidence (required)")
                }

                // ── 3. Try test (LOTO only) — after the lock is on ──────────
                if let tryTest = tryTestItem {
                    Section {
                        checklistRow(item: tryTest, enabled: preLockDone && photo != nil)
                    } header: {
                        Text("Verification")
                    } footer: {
                        Text("The step most often skipped in the field — and the one that catches a lock on the wrong isolator.")
                    }
                }

                // ── 4. Lock serial + note ───────────────────────────────────
                Section {
                    TextField("Lock serial (e.g. L-042)", text: $lockSerial)
                        .autocorrectionDisabled()
                    TextField("Note (optional)", text: $note)
                } header: {
                    Text("Lock details")
                }

                if let err = submitError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSubmitting { ProgressView().padding(.trailing, 6) }
                            Text("Record \(point.kind.displayName) applied").bold()
                            Spacer()
                        }
                    }
                    .disabled(!canSubmit)
                    .listRowBackground(canSubmit ? accent.opacity(0.85) : Color(.systemGray4))
                    .foregroundStyle(canSubmit ? (point.kind == .loto ? Color.white : Color.black) : Color.secondary)
                } footer: {
                    Text("Recorded as isolated — verify physically before body contact. The lock protects; the app records.")
                }
            }
            .navigationTitle("Apply \(point.kind.displayName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sheet(isPresented: $showCamera) {
                CameraPickerView { photo = $0 }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    private func checklistRow(item: LotoChecklistItem, enabled: Bool) -> some View {
        Toggle(isOn: Binding(
            get: { confirms[item.key] == true },
            set: { confirms[item.key] = $0 }
        )) {
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.subheadline.bold())
                Text(item.subtitle).font(.caption).foregroundStyle(.secondary)
            }
        }
        .toggleStyle(LotoCheckToggleStyle(accent: accent))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }

    private func submit() async {
        guard let img = photo, let base64 = lotoJpegBase64(img) else {
            submitError = "Photo could not be processed — retake it."
            return
        }
        isSubmitting = true
        submitError = nil
        let req = CreateLotoEventRequest(
            anchorId:    anchor.id,
            pointId:     point.id,
            type:        .apply,
            userId:      settings.authorName,
            userName:    settings.authorName,
            lockSerial:  lockSerial.trimmingCharacters(in: .whitespaces).isEmpty ? nil : lockSerial.trimmingCharacters(in: .whitespaces),
            checklist:   confirms,
            photoBase64: base64,
            override:    nil,
            note:        note.trimmingCharacters(in: .whitespaces).isEmpty ? nil : note
        )
        do {
            let resp = try await SIBClient(settings: settings).submitLotoEvent(req)
            isSubmitting = false
            onCompleted(resp.status)
            dismiss()
        } catch {
            // Server messages are written for humans ("Checklist incomplete: …",
            // "Point is already locked by …") — show them verbatim.
            submitError = error.localizedDescription
            isSubmitting = false
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MARK: - Remove flow (own lock) + supervisor override
// ════════════════════════════════════════════════════════════════════════════

struct LotoRemoveFlowView: View {

    let anchor: Anchor
    let status: LotoPointStatus            // must be .locked
    let onCompleted: (LotoPointStatus) -> Void

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var confirms: [String: Bool] = [:]
    @State private var photo: UIImage? = nil
    @State private var showCamera = false
    @State private var isSubmitting = false
    @State private var submitError: String? = nil

    // Override path — explicit, never a fallback.
    @State private var showOverrideForm = false
    @State private var supervisorName = ""
    @State private var overrideReason = ""
    @State private var ovAbsent = false
    @State private var ovContacted = false
    @State private var ovWillInform = false

    private var point: LotoPoint { status.point }
    private var isMyLock: Bool { status.lockedBy == settings.authorName }
    private var items: [LotoChecklistItem] { LotoChecklists.remove(for: point.kind) }
    private var allConfirmed: Bool { items.allSatisfy { confirms[$0.key] == true } }
    private var overrideComplete: Bool {
        ovAbsent && ovContacted && ovWillInform
            && !supervisorName.trimmingCharacters(in: .whitespaces).isEmpty
            && !overrideReason.trimmingCharacters(in: .whitespaces).isEmpty
    }
    private var accent: Color { point.kind == .loto ? .red : .yellow }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LotoPointHeaderRow(point: point)
                    if let name = status.lockedByName, let at = status.lockedAt {
                        Label("Locked by \(name) · \(LotoFormat.relative(at))", systemImage: "lock.fill")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let serial = status.lockSerial {
                        Label("Lock \(serial)", systemImage: "number").font(.caption).foregroundStyle(.secondary)
                    }
                }

                if isMyLock {
                    ownRemovalSections
                } else if !showOverrideForm {
                    // Not your lock: say so plainly, and make override a
                    // deliberate second decision.
                    Section {
                        Label("This lock belongs to \(status.lockedByName ?? "another employee"). Only they may remove it — one lock, one person.",
                              systemImage: "person.fill.xmark")
                            .font(.subheadline)
                    } footer: {
                        Text("If they are unavailable, a supervisor may perform a documented override under the site's exception procedure.")
                    }
                    Section {
                        Button(role: .destructive) {
                            showOverrideForm = true
                        } label: {
                            Label("Supervisor override…", systemImage: "exclamationmark.shield")
                        }
                    }
                } else {
                    overrideSections
                }

                if let err = submitError {
                    Section {
                        Label(err, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isMyLock ? "Remove \(point.kind.displayName)" : "Locked")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .sheet(isPresented: $showCamera) {
                CameraPickerView { photo = $0 }
            }
            .interactiveDismissDisabled(isSubmitting)
        }
    }

    // ── Own-lock removal ────────────────────────────────────────────────────

    @ViewBuilder
    private var ownRemovalSections: some View {
        Section {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                Toggle(isOn: Binding(
                    get: { confirms[item.key] == true },
                    set: { confirms[item.key] = $0 }
                )) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).font(.subheadline.bold())
                        Text(item.subtitle).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(LotoCheckToggleStyle(accent: accent))
                .disabled(!(idx == 0 || confirms[items[idx - 1].key] == true))
                .opacity((idx == 0 || confirms[items[idx - 1].key] == true) ? 1 : 0.45)
            }
        } header: {
            Text("Before removal")
        }

        Section {
            if let img = photo {
                Image(uiImage: img)
                    .resizable().scaledToFit()
                    .frame(maxHeight: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            Button { showCamera = true } label: {
                Label(photo == nil ? "Photo after removal (recommended)" : "Retake photo",
                      systemImage: "camera")
            }
        } header: {
            Text("Evidence")
        }

        Section {
            Button {
                Task { await submit(type: .remove, override: nil) }
            } label: {
                HStack {
                    Spacer()
                    if isSubmitting { ProgressView().padding(.trailing, 6) }
                    Text("Record lock removed").bold()
                    Spacer()
                }
            }
            .disabled(!allConfirmed || isSubmitting)
            .listRowBackground(allConfirmed ? Color.green.opacity(0.85) : Color(.systemGray4))
            .foregroundStyle(allConfirmed ? Color.white : Color.secondary)
        } footer: {
            Text("The equipment may re-energize after this — be sure the area is clear before restoring power.")
        }
    }

    // ── Override ────────────────────────────────────────────────────────────

    @ViewBuilder
    private var overrideSections: some View {
        Section {
            TextField("Supervisor name", text: $supervisorName)
            TextField("Reason for override", text: $overrideReason, axis: .vertical)
                .lineLimit(2...4)
        } header: {
            Text("Supervisor override")
        } footer: {
            Text("This action is recorded as a distinct override event and highlighted in every audit.")
        }

        Section {
            Toggle(isOn: $ovAbsent) {
                Text("Verified \(status.lockedByName ?? "the employee") is not at the facility")
                    .font(.subheadline)
            }
            Toggle(isOn: $ovContacted) {
                Text("Reasonable effort made to contact them").font(.subheadline)
            }
            Toggle(isOn: $ovWillInform) {
                Text("They will be informed before resuming work").font(.subheadline)
            }
        } header: {
            Text("Exception conditions (all required)")
        }

        Section {
            if let img = photo {
                Image(uiImage: img)
                    .resizable().scaledToFit()
                    .frame(maxHeight: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            Button { showCamera = true } label: {
                Label(photo == nil ? "Photo after removal (recommended)" : "Retake photo",
                      systemImage: "camera")
            }
        }

        Section {
            Button(role: .destructive) {
                Task {
                    await submit(type: .overrideRemove, override: LotoOverride(
                        supervisorName:         supervisorName.trimmingCharacters(in: .whitespaces),
                        reason:                 overrideReason.trimmingCharacters(in: .whitespaces),
                        verifiedAbsent:         ovAbsent,
                        contactAttempted:       ovContacted,
                        willInformBeforeReturn: ovWillInform
                    ))
                }
            } label: {
                HStack {
                    Spacer()
                    if isSubmitting { ProgressView().padding(.trailing, 6) }
                    Text("Record override removal").bold()
                    Spacer()
                }
            }
            .disabled(!overrideComplete || isSubmitting)
        }
    }

    private func submit(type: LotoEventType, override: LotoOverride?) async {
        isSubmitting = true
        submitError = nil
        let base64 = photo.flatMap { lotoJpegBase64($0) }
        let req = CreateLotoEventRequest(
            anchorId:    anchor.id,
            pointId:     point.id,
            type:        type,
            userId:      settings.authorName,
            userName:    settings.authorName,
            lockSerial:  nil,
            checklist:   confirms,
            photoBase64: base64,
            override:    override,
            note:        nil
        )
        do {
            let resp = try await SIBClient(settings: settings).submitLotoEvent(req)
            isSubmitting = false
            onCompleted(resp.status)
            dismiss()
        } catch {
            submitError = error.localizedDescription
            isSubmitting = false
        }
    }
}

// ── Shared bits ─────────────────────────────────────────────────────────────

struct LotoPointHeaderRow: View {
    let point: LotoPoint
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill((point.kind == .loto ? Color.red : Color.yellow).opacity(0.15))
                    .frame(width: 36, height: 36)
                Image(systemName: point.kind == .loto ? "lock.fill" : "power")
                    .foregroundStyle(point.kind == .loto ? Color.red : Color.orange)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(point.label).font(.subheadline.bold())
                HStack(spacing: 6) {
                    Text(point.kind.displayName).font(.caption).foregroundStyle(.secondary)
                    if let c = point.circuitId {
                        Text("· \(c)").font(.caption).foregroundStyle(.secondary)
                    }
                    if !point.modelSlots.isEmpty {
                        Label(point.modelSlots.count == 1 ? "3D asset" : "\(point.modelSlots.count) 3D assets",
                              systemImage: "cube")
                            .font(.caption2).foregroundStyle(.teal)
                    }
                }
            }
        }
    }
}

/// Checkbox-style toggle — checklist rows read as confirmations, not settings.
struct LotoCheckToggleStyle: ToggleStyle {
    let accent: Color
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(configuration.isOn ? accent : Color(.systemGray3))
                    .padding(.top, 1)
                configuration.label
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
    }
}

enum LotoFormat {
    static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
    static func relative(_ iso: String) -> String {
        guard let d = date(iso) else { return "" }
        let r = RelativeDateTimeFormatter()
        r.unitsStyle = .abbreviated
        return r.localizedString(for: d, relativeTo: Date())
    }
}
