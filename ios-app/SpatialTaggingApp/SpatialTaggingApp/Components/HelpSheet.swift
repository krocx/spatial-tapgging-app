// HelpSheet.swift — Phase 3 (Team Sharing)
//
// Reusable context-aware help sheet.
// Each major view passes a [HelpStep] array; this sheet renders them as
// a scrollable card list.  Triggered by the ? button in the nav bar.
//
// Usage:
//   .sheet(isPresented: $showHelp) { HelpSheet(steps: HelpContent.authorMode) }

import SwiftUI

// ── Data model ────────────────────────────────────────────────────────────────

struct HelpStep: Identifiable {
    let id = UUID()
    let icon:   String   // SF Symbol name
    let title:  String
    let detail: String
}

// ── Sheet view ────────────────────────────────────────────────────────────────

struct HelpSheet: View {

    let steps: [HelpStep]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        HelpStepCard(step: step, index: index + 1)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// ── Step card ─────────────────────────────────────────────────────────────────

private struct HelpStepCard: View {
    let step:  HelpStep
    let index: Int

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Step number + icon stack
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.12))
                    .frame(width: 46, height: 46)
                Image(systemName: step.icon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text("\(index)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color(.systemFill), in: Capsule())
                    Text(step.title)
                        .font(.subheadline.bold())
                }
                Text(step.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}

// ── Content library ───────────────────────────────────────────────────────────

enum HelpContent {

    static let home: [HelpStep] = [
        HelpStep(icon: "pencil.circle.fill", title: "Author Mode",
                 detail: "Authors set up anchors and train each inspection tag. Pick an anchor from the directory, place tags by tapping on surfaces, then train them."),
        HelpStep(icon: "eye.circle.fill", title: "Operator Mode",
                 detail: "Operators run inspections by scanning the anchor QR code. The app validates each tag position against the trained reference."),
        HelpStep(icon: "arrow.counterclockwise.circle.fill", title: "Continue Session",
                 detail: "Your last Author session is saved. Tap it to resume training where you left off."),
        HelpStep(icon: "qrcode", title: "Share Anchor QR",
                 detail: "Tap 'Share Anchor QR' to generate a QR code with the embedded encryption key — share this with Operators for secure inspection."),
    ]

    static let authorMode: [HelpStep] = [
        HelpStep(icon: "hand.tap.fill", title: "Place Tags",
                 detail: "Tap any detected surface to place a tag marker. A placement sheet appears — fill in the tag label and type."),
        HelpStep(icon: "qrcode.viewfinder", title: "Scan QR (Optional)",
                 detail: "Scan the anchor QR code to lock accurate 3D positions. Tags placed without scanning use estimated positions; they auto-upgrade once the QR is scanned."),
        HelpStep(icon: "camera.viewfinder", title: "Train Each Tag",
                 detail: "Tap a tag marker or the Train button in the tag list to begin training. Different tag types use different capture flows (honeycomb walk-around, cone, or text scan)."),
        HelpStep(icon: "checkmark.circle.fill", title: "Training Complete",
                 detail: "Tags show a green checkmark when trained. Progress is tracked in the training bar at the bottom."),
        HelpStep(icon: "qrcode", title: "Share QR with Team",
                 detail: "Tap the QR icon in the top bar to generate an encrypted QR for Operators. Print or share this — it embeds the decryption key."),
    ]

    static let operatorMode: [HelpStep] = [
        HelpStep(icon: "qrcode.viewfinder", title: "Scan the Anchor QR",
                 detail: "Point your camera at the anchor QR code (printed or displayed near the equipment). This locks the AR session to the physical asset."),
        HelpStep(icon: "scope", title: "Inspect Each Tag",
                 detail: "Walk to each tag marker (shown as floating indicators in AR). Hold steady near a cone-guided tag; honeycomb tags require the trained viewing angle."),
        HelpStep(icon: "checkmark.seal.fill", title: "PASS / FAIL Results",
                 detail: "Each tag shows a PASS or FAIL result with a confidence score. A final PASS/FAIL for the whole anchor is shown at the end."),
        HelpStep(icon: "arrow.counterclockwise", title: "Re-inspect Failed Tags",
                 detail: "Use 'Re-inspect Failed' to only re-run failed checks without repeating already-passing tags."),
    ]
}
