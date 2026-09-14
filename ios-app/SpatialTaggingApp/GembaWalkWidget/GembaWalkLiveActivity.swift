// GembaWalkLiveActivity.swift — G6 (2026.4.46): Dynamic Island + Lock Screen
// presentation of a Gemba walk. Orange is the identity; compact view is one
// glance: pin · distance · progress.
//
// Target: GembaWalkWidget. Needs GembaWalkActivity.swift in this target too.

import ActivityKit
import WidgetKit
import SwiftUI

struct GembaWalkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GembaWalkActivityAttributes.self) { context in
            // ── Lock Screen / banner ──────────────────────────────────────────
            HStack(spacing: 14) {
                Image(systemName: icon(context.state))
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(accent(context.state), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline(context.state)).font(.headline).lineLimit(1)
                    Text(context.state.nextTitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Text(context.attributes.spaceName + (context.attributes.headerLine.isEmpty ? "" : " · " + context.attributes.headerLine))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(distance(context.state)).font(.title3.weight(.bold).monospacedDigit())
                    Text("\(context.state.done)/\(context.state.total)").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: icon(context.state)).font(.title2).foregroundStyle(accent(context.state)).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(distance(context.state)).font(.title3.weight(.bold).monospacedDigit()).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 1) {
                        Text(headline(context.state)).font(.caption).foregroundStyle(.secondary)
                        Text(context.state.nextTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: Double(context.state.done), total: Double(max(context.state.total, 1)))
                        .tint(.orange)
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: icon(context.state)).foregroundStyle(accent(context.state))
            } compactTrailing: {
                Text(context.state.phase == "paused" ? "↑" : context.state.phase == "background" ? "⏸" : distance(context.state))
                    .font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(accent(context.state))
            } minimal: {
                Image(systemName: icon(context.state)).foregroundStyle(accent(context.state))
            }
            .keylineTint(.orange)
        }
    }

    private func accent(_ s: GembaWalkActivityAttributes.ContentState) -> Color {
        switch s.phase {
        case "arrived": return .green
        case "paused", "background": return .gray
        case "done":    return .green
        default:
            switch s.category { case "NC": return .red; case "STRENGTH": return .green; default: return .orange }
        }
    }
    private func icon(_ s: GembaWalkActivityAttributes.ContentState) -> String {
        switch s.phase {
        case "arrived": return "checkmark.circle.fill"
        case "paused":  return "iphone.radiowaves.left.and.right"
        case "background": return "arrow.up.forward.app"
        case "done":    return "flag.checkered"
        default:        return "mappin.and.ellipse"
        }
    }
    private func headline(_ s: GembaWalkActivityAttributes.ContentState) -> String {
        switch s.phase {
        case "arrived": return "You're here"
        case "paused":  return "Raise your phone to update"
        case "background": return "Open SpatialTagging to continue"
        case "done":    return "Gemba walk complete"
        default:        return "Next finding"
        }
    }
    private func distance(_ s: GembaWalkActivityAttributes.ContentState) -> String {
        guard let d = s.distanceM else { return "—" }
        return d < 10 ? String(format: "%.1f m", d) : "\(Int(d.rounded())) m"
    }
}
