// FindingDetailSections.swift — G4: the read-only body of a Gemba finding,
// shared by the Author peek sheet and the Operator completion sheet so the
// two never drift. Reference question · category + risk · photos with
// captions (each opens full-screen). Legacy findings (no question) show
// their defect category + severity exactly as before.

import SwiftUI

struct FindingDetailSections: View {
    let tag: LocTag
    @EnvironmentObject private var settings: AppSettings
    @State private var images: [String: UIImage] = [:]
    @State private var viewing: LocTagPhoto? = nil

    var body: some View {
        // ── Reference question ────────────────────────────────────────────────
        if tag.questionCode != nil {
            Section("Audit Reference") {
                if let fa = tag.focusAreaCode {
                    LabeledContent("Focus Area") {
                        Text([fa, tag.focusAreaTitle].compactMap { $0 }.joined(separator: " — "))
                            .foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(tag.questionTitle ?? tag.title).font(.body.weight(.semibold))
                        Spacer()
                        Text(tag.questionCode ?? "").font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    if let t = tag.questionText { Text(t).font(.footnote).foregroundStyle(.secondary) }
                }
                .padding(.vertical, 2)
            }
        }

        // ── Category / risk (or legacy classification) ────────────────────────
        Section(tag.questionCode != nil ? "Finding" : "Classification") {
            if let c = tag.findingCategory {
                LabeledContent("Category") {
                    Label(c.longName, systemImage: c.symbol)
                        .foregroundStyle(Color(FindingPanel.color(for: tag)))
                        .font(.subheadline.weight(.semibold))
                }
            } else {
                LabeledContent("Category") { Text(tag.defectCategory.displayName).foregroundStyle(.secondary) }
            }
            if let r = tag.riskRating {
                LabeledContent("Preliminary risk") { Text(r.displayName).foregroundStyle(.secondary) }
            }
            if let sev = tag.severity, tag.findingCategory == nil {
                LabeledContent("Severity") { Text(sev.displayName).foregroundStyle(.secondary) }
            }
            if let note = tag.defectCategoryNote, !note.isEmpty {
                LabeledContent("Note") { Text(note).foregroundStyle(.secondary) }
            }
        }

        if !tag.description.isEmpty {
            Section(tag.questionCode != nil ? "Notes" : "Description") {
                Text(tag.description).font(.body)
            }
        }

        // ── Photos ────────────────────────────────────────────────────────────
        let photos = tag.allPhotos
        if !photos.isEmpty {
            Section("Photos (\(photos.count))") {
                ForEach(photos) { p in
                    Button { viewing = p } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Group {
                                if let img = images[p.markupPath ?? p.path] {
                                    Image(uiImage: img).resizable().scaledToFill()
                                } else {
                                    ZStack { Color.secondary.opacity(0.15); ProgressView().controlSize(.small) }
                                }
                            }
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(p.caption?.isEmpty == false ? p.caption! : "No caption")
                                    .font(.subheadline)
                                    .foregroundStyle(p.caption?.isEmpty == false ? .primary : .secondary)
                                    .lineLimit(3)
                                if p.markupPath != nil {
                                    Label("Marked up", systemImage: "pencil.tip.crop.circle").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                    .task { await load(p.markupPath ?? p.path) }
                }
            }
            .fullScreenCover(item: $viewing) { p in
                PhotoLightbox(image: images[p.markupPath ?? p.path], caption: p.caption)
            }
        }
    }

    private func load(_ filename: String) async {
        guard images[filename] == nil else { return }
        if let data = try? await SIBClient(settings: settings).fetchLocTagImage(filename: filename),
           let img = UIImage(data: data) {
            await MainActor.run { images[filename] = img }
        }
    }
}

/// Full-screen photo with its caption. Tap anywhere to close.
struct PhotoLightbox: View {
    let image: UIImage?
    let caption: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image).resizable().scaledToFit().ignoresSafeArea()
            } else {
                ProgressView().tint(.white)
            }
            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.subheadline).foregroundStyle(.white)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white.opacity(0.85))
            }
            .padding()
        }
        .onTapGesture { dismiss() }
    }
}
