// AnchorLabOverlay.swift — Anchor Lab (2026.4.46)
//
// "Is anchoring accurate?" answered with a number instead of a feeling.
// Shown in Operator mode when Settings → Anchor Lab is on:
//
//   • Lock report — how THIS session found its origin: source (sealed map /
//     QR / object / approximate), relocalize + converge seconds, the live
//     QR's disagreement with the origin (mm / °), ambient light, approach
//     angle. All from ARSessionManager's trust layer.
//   • Mark truth — pick a tag, aim the crosshair at the PHYSICAL feature the
//     tag was placed on, tap Mark. The crosshair raycast (LiDAR mesh when the
//     device has it) gives the real point; the error is the distance to where
//     the tag rendered. Sent to SIB as one AnchorAccuracySample — numbers
//     only, never an image — and charted per device / origin / run in the
//     portal (docs/ANCHOR-LAB.md has the home protocol).
//
// Tester-facing, deliberately plain: a card on the trailing edge that
// collapses to a pill so it never hides the inspection UI.

import SwiftUI
import simd

struct AnchorLabOverlay: View {

    let anchorId: String
    let tags: [Tag]
    let report: ARSessionManager.OriginLockReport?
    let confidence: ARSessionManager.OriginConfidence
    let qrDiscrepancy: ARSessionManager.PoseDelta?
    /// Where the tag is drawn right now (world), nil if not placed.
    let renderedPosition: (String) -> simd_float3?
    /// Crosshair probe: the real-world point under the screen centre + camera position.
    let probe: () -> (hit: simd_float3, camera: simd_float3)?
    /// The session origin (tags' frame) for the error vector.
    let originTransform: simd_float4x4?
    let client: SIBClient
    let by: String
    /// Lab door: "map" (relocalize only) or "qr" (the gate). Nil in Operator mode.
    var runType: String? = nil
    /// Lab door: a preset run label (chips) overrides the free-text field.
    var presetRun: String? = nil
    /// Lab door: told after every mark (label, mm, sent) so the run summary can build.
    var onMark: ((String, Double, Bool) -> Void)? = nil

    @State private var expanded = true
    @State private var armedTagId: String? = nil
    @State private var run: String = UserDefaults.standard.string(forKey: "anchor_lab_run") ?? ""
    @State private var rows: [(label: String, mm: Double, ok: Bool)] = []
    @State private var toast: String? = nil
    @State private var sending = false

    var body: some View {
        ZStack {
            if armedTagId != nil {
                CrosshairView(locked: true).allowsHitTesting(false)
            }
            HStack {
                Spacer()
                VStack(alignment: .trailing, spacing: 8) {
                    if expanded { card } else { pill }
                }
                .padding(.trailing, 12)
            }
        }
    }

    // ── Collapsed ─────────────────────────────────────────────────────────────
    private var pill: some View {
        Button { withAnimation(.easeInOut(duration: 0.2)) { expanded = true } } label: {
            HStack(spacing: 6) {
                Image(systemName: "scope")
                Text(String(format: "Lab · %@", shortConfidence)).font(.caption2.bold())
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Color.black.opacity(0.75), in: Capsule())
            .foregroundStyle(.white)
        }
    }

    // ── Expanded card ─────────────────────────────────────────────────────────
    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Anchor Lab", systemImage: "scope").font(.caption.bold()).foregroundStyle(.white)
                Spacer()
                Button { withAnimation(.easeInOut(duration: 0.2)) { expanded = false } } label: {
                    Image(systemName: "chevron.right.circle.fill").foregroundStyle(.white.opacity(0.7))
                }
            }

            // Lock report
            VStack(alignment: .leading, spacing: 3) {
                labRow("Origin", sourceLabel, tint: sourceTint)
                if let r = report {
                    if let s = r.relocalizeS { labRow("Relocalize", String(format: "%.1f s", s)) }
                    if let s = r.convergeS   { labRow("Converge",   String(format: "%.1f s", s)) }
                    if let a = r.approachDeg { labRow("Approach",   String(format: "%.0f°", a)) }
                    if let l = r.lightLux    { labRow("Light",      String(format: "%.0f", l)) }
                }
                if let d = qrDiscrepancy {
                    labRow("QR vs origin", String(format: "%.0f mm · %.1f°", d.mm, d.deg),
                           tint: d.mm > 20 || d.deg > 2 ? .orange : .green)
                } else if let r = report, let mm = r.qrDriftMm {
                    labRow("QR at lock", String(format: "%.0f mm · %.1f°", mm, r.qrDriftDeg ?? 0))
                }
            }

            Divider().overlay(Color.white.opacity(0.2))

            // Run label — typed once, remembered (the Lab door passes a preset instead)
            if presetRun == nil { HStack(spacing: 6) {
                Image(systemName: "tag").font(.caption2).foregroundStyle(.white.opacity(0.6))
                TextField("run label (door · evening · 2 m)", text: $run)
                    .font(.caption2).foregroundStyle(.white)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: run) { UserDefaults.standard.set($0, forKey: "anchor_lab_run") }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8)) }

            // Tag chips → arm one
            Text(armedTagId == nil ? "Pick a tag, then aim the crosshair at its real feature"
                                   : "Aim the crosshair at the physical feature")
                .font(.caption2).foregroundStyle(.white.opacity(0.7))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(tags) { tag in
                        let placed = renderedPosition(tag.id) != nil
                        Button {
                            armedTagId = armedTagId == tag.id ? nil : tag.id
                        } label: {
                            Text(tag.label).font(.caption2.bold()).lineLimit(1)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(armedTagId == tag.id ? Color.cyan : Color.white.opacity(placed ? 0.14 : 0.05), in: Capsule())
                                .foregroundStyle(armedTagId == tag.id ? .black : (placed ? .white : .white.opacity(0.4)))
                        }
                        .disabled(!placed)
                    }
                }
            }

            if let id = armedTagId {
                Button { mark(tagId: id) } label: {
                    HStack {
                        if sending { ProgressView().tint(.black).scaleEffect(0.7) }
                        Text("Mark where it really is").font(.caption.bold())
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(Color.cyan, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.black)
                }
                .disabled(sending)
            }

            // This session's marks
            if !rows.isEmpty {
                Divider().overlay(Color.white.opacity(0.2))
                ForEach(Array(rows.suffix(4).enumerated()), id: \.offset) { _, r in
                    HStack {
                        Text(r.label).font(.caption2).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                        Spacer()
                        Text(String(format: "%.0f mm", r.mm)).font(.caption2.monospacedDigit().bold())
                            .foregroundStyle(r.mm <= 10 ? .green : r.mm <= 25 ? .orange : .red)
                        Image(systemName: r.ok ? "checkmark.icloud" : "icloud.slash").font(.caption2)
                            .foregroundStyle(r.ok ? .green : .orange)
                    }
                }
                let med = median(rows.map { $0.mm })
                labRow("Median (\(rows.count))", String(format: "%.0f mm", med), tint: med <= 10 ? .green : .orange)
            }

            if let t = toast {
                Text(t).font(.caption2).foregroundStyle(.orange).lineLimit(2)
            }
        }
        .padding(12)
        .frame(width: 250)
        .background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 14))
    }

    // ── Measurement ───────────────────────────────────────────────────────────

    private func mark(tagId: String) {
        guard let rendered = renderedPosition(tagId) else { toast = "Tag isn't placed yet"; return }
        guard let p = probe() else { toast = "No surface under the crosshair — move closer"; return }
        let delta = p.hit - rendered
        let mm = Double(simd_length(delta)) * 1000
        // Error vector in the origin's frame (rotation only), so runs from
        // different sides are comparable.
        var dx = delta.x, dy = delta.y, dz = delta.z
        if let o = originTransform {
            let r = simd_float3x3(simd_float3(o.columns.0.x, o.columns.0.y, o.columns.0.z),
                                  simd_float3(o.columns.1.x, o.columns.1.y, o.columns.1.z),
                                  simd_float3(o.columns.2.x, o.columns.2.y, o.columns.2.z))
            let local = simd_inverse(r) * delta
            dx = local.x; dy = local.y; dz = local.z
        }
        let label = tags.first { $0.id == tagId }?.label ?? tagId
        let source: String = {
            if case .approximate = confidence { return "approximate" }
            return report?.source ?? "qr"
        }()
        let sample = SIBClient.AnchorAccuracySample(
            tagId: tagId, tagLabel: label, errorMm: (mm * 10).rounded() / 10,
            dxMm: Double(dx) * 1000, dyMm: Double(dy) * 1000, dzMm: Double(dz) * 1000,
            distanceM: Double(simd_length(p.hit - p.camera)),
            originSource: source,
            relocalizeS: report?.relocalizeS, convergeS: report?.convergeS,
            qrDriftMm: (qrDiscrepancy?.mm ?? report?.qrDriftMm).map { Double($0) },
            qrDriftDeg: (qrDiscrepancy?.deg ?? report?.qrDriftDeg).map { Double($0) },
            lightLux: report?.lightLux, approachDeg: report?.approachDeg.map { Double($0) },
            device: DeviceModel.identifier, osVersion: UIDevice.current.systemVersion, appVersion: AppVersion.current,
            run: (presetRun ?? run).isEmpty ? nil : (presetRun ?? run), by: by.isEmpty ? nil : by,
            at: ISO8601DateFormatter().string(from: Date()), runType: runType)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        armedTagId = nil
        sending = true
        toast = nil
        AppLog.info("lab", String(format: "Anchor Lab mark %@: %.1f mm (%@)", label, mm, source))
        Task {
            var ok = true
            do { try await client.postAnchorAccuracy(anchorId: anchorId, sample: sample) }
            catch { ok = false; toast = "Saved locally only — \(error.localizedDescription)" }
            rows.append((label, mm, ok))
            onMark?(label, mm, ok)
            sending = false
        }
    }

    // ── Bits ──────────────────────────────────────────────────────────────────

    private var sourceLabel: String {
        switch confidence {
        case .approximate: return "approximate"
        case .relocalizing: return "relocalizing…"
        case .aligning: return "aligning…"
        default: return report?.source ?? "qr"
        }
    }
    private var shortConfidence: String {
        switch confidence {
        case .locked: return (report?.source ?? "qr")
        case .approximate: return "≈"
        case .aligning: return "aligning"
        case .relocalizing: return "reloc"
        case .none: return report?.source ?? "qr"
        }
    }
    private var sourceTint: Color {
        switch confidence {
        case .approximate: return .orange
        case .locked: return .green
        default: return .white
        }
    }
    private func labRow(_ k: String, _ v: String, tint: Color = .white) -> some View {
        HStack {
            Text(k).font(.caption2).foregroundStyle(.white.opacity(0.6))
            Spacer()
            Text(v).font(.caption2.monospacedDigit()).foregroundStyle(tint)
        }
    }
    private func median(_ xs: [Double]) -> Double {
        let s = xs.sorted(); guard !s.isEmpty else { return 0 }
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }
}
