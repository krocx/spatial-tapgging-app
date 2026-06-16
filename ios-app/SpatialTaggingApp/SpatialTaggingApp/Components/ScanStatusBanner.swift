// ScanStatusBanner.swift — Phase 2A / 2.5
// Animated status banner overlaid on the AR camera view.
// Phase 2.5: TrackingLimitedBanner added — shown when ARKit tracking is not
// yet .normal so the user knows to wait before the QR lock is accepted.

import SwiftUI
import ARKit

struct ScanStatusBanner: View {

    let scanState: ScanState

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.title2)
                .foregroundColor(.white)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.bold()).foregroundColor(.white)
                if let sub = subtitle {
                    Text(sub).font(.caption).foregroundColor(.white.opacity(0.85))
                }
            }
            Spacer()
            if case .scanning = scanState { ProgressView().tint(.white).scaleEffect(0.8) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(bannerColor.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.25), radius: 8, x: 0, y: 4)
        .animation(.easeInOut(duration: 0.3), value: bannerColor)
    }

    private var iconName: String {
        switch scanState {
        case .scanning:  return "qrcode.viewfinder"
        case .detected:  return "qrcode"
        case .locked:    return "checkmark.seal.fill"
        }
    }

    private var title: String {
        switch scanState {
        case .scanning:        return "Scanning for QR Code…"
        case .detected:        return "QR Detected — Locking…"
        case .locked(let ctx): return "Anchor Locked ✓"
        }
    }

    private var subtitle: String? {
        switch scanState {
        case .scanning:          return "Point camera at the inspection point QR code"
        case .detected(let ctx): return "\(ctx.assetId) · \(ctx.anchorId)"
        case .locked(let ctx):   return "\(ctx.assetId) · \(ctx.anchorId)"
        }
    }

    private var bannerColor: Color {
        switch scanState {
        case .scanning: return .blue
        case .detected: return .orange
        case .locked:   return .green
        }
    }
}

// ── Tracking limited banner ───────────────────────────────────────────────────
// Shown beneath ScanStatusBanner when ARKit is still initialising its world model.
// The QR lock is gated on .normal tracking so we surface the reason here.

struct TrackingLimitedBanner: View {

    let reason: ARCamera.TrackingState.Reason

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption.bold())
                .foregroundStyle(.white)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Color.orange.opacity(0.75))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var message: String {
        switch reason {
        case .initializing:
            return "Initialising AR — move device slowly to build the scene"
        case .excessiveMotion:
            return "Moving too fast — slow down for a stable lock"
        case .insufficientFeatures:
            return "Not enough visual detail — point at a textured surface"
        case .relocalizing:
            return "Relocalising — slowly scan the environment"
        @unknown default:
            return "Tracking limited — move device slowly"
        }
    }
}
