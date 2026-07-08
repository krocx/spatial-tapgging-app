// TagInspectedSheet.swift — Phase 4: Session Reporting
//
// Bottom sheet presented over the AR view when a tag's inspection
// result is ready for operator confirmation.
//
// Shown in two scenarios:
//   • PASS committed: loop paused ~1 s after first stable PASS
//   • FAIL held 6 s: loop paused after FAIL persists for 6 consecutive seconds
//
// Buttons:
//   • "Re-inspect"    — dismiss sheet, restart live loop for this tag
//   • "Tag Inspected" — confirm result, store note, upload evidence, mark complete
//
// The sheet intentionally does NOT pause the AR session itself — only the
// validation loop is paused. The camera feed stays live so the operator
// can see the physical part while deciding whether to confirm or re-inspect.

import SwiftUI

struct TagInspectedSheet: View {

    // ── Inputs ─────────────────────────────────────────────────────────────────

    let tagLabel:    String
    let status:      ValidationStatus   // .pass or .fail
    let image:       UIImage?
    let fixedInSession: Bool            // true when this was FAIL→PASS

    // ── Callbacks ──────────────────────────────────────────────────────────────

    let onReInspect:    () -> Void
    let onConfirm:      (_ note: String?) -> Void
    /// Operator wants to re-frame the shot — dismiss sheet, show live AR with a capture button.
    let onRetakeImage:  () -> Void

    // ── Local state ────────────────────────────────────────────────────────────

    @State private var note: String = ""
    @FocusState private var noteFieldFocused: Bool

    // ── Body ───────────────────────────────────────────────────────────────────

    var body: some View {
        VStack(spacing: 0) {
            // ── Drag handle ──────────────────────────────────────────────────
            Capsule()
                .fill(Color.white.opacity(0.3))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 4)

            // ── Status header ────────────────────────────────────────────────
            HStack(spacing: 12) {
                Image(systemName: status == .pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(status == .pass ? Color.green : Color.red)

                VStack(alignment: .leading, spacing: 3) {
                    Text(status == .pass ? "PASS" : "FAIL")
                        .font(.title2.bold())
                        .foregroundStyle(status == .pass ? Color.green : Color.red)
                    HStack(spacing: 4) {
                        Text(tagLabel)
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        if fixedInSession {
                            Label("Fixed this session", systemImage: "wrench.adjustable.fill")
                                .font(.caption.bold())
                                .foregroundStyle(.yellow)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.yellow.opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            // ── Evidence image preview ────────────────────────────────────────
            if let img = image {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke((status == .pass ? Color.green : Color.red).opacity(0.6), lineWidth: 2)
                    )
                    // ── Retake button ─────────────────────────────────────────────
                    .overlay(alignment: .bottomTrailing) {
                        Button {
                            noteFieldFocused = false
                            onRetakeImage()
                        } label: {
                            Label("Retake", systemImage: "camera.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(Color.black.opacity(0.65), in: Capsule())
                        }
                        .padding(8)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 14)
            }

            // ── Optional note field ──────────────────────────────────────────
            VStack(alignment: .leading, spacing: 6) {
                Label("Add a note (optional)", systemImage: "note.text")
                    .font(.caption.bold())
                    .foregroundStyle(.white.opacity(0.6))

                TextField("", text: $note, axis: .vertical)
                    .placeholder(when: note.isEmpty) {
                        Text(status == .pass
                             ? "e.g. valve torqued to spec, slight discolouration noted"
                             : "e.g. loose connection, re-seated cable, waiting for part")
                            .foregroundStyle(.white.opacity(0.35))
                            .font(.subheadline)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .tint(.white)
                    .focused($noteFieldFocused)
                    .lineLimit(3, reservesSpace: true)
                    .padding(12)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 18)

            // ── Action buttons ────────────────────────────────────────────────
            VStack(spacing: 10) {
                // Primary: Tag Inspected
                Button {
                    noteFieldFocused = false
                    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                    onConfirm(trimmed.isEmpty ? nil : trimmed)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: status == .pass ? "checkmark.seal.fill" : "xmark.seal.fill")
                        Text("Tag Inspected")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                }
                .buttonStyle(.borderedProminent)
                .tint(status == .pass ? .green : .red)

                // Secondary: Re-inspect
                Button {
                    noteFieldFocused = false
                    onReInspect()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.counterclockwise.circle")
                        Text("Re-inspect")
                    }
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.bordered)
                .tint(.white)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(
            Color(white: 0.10)
                .ignoresSafeArea(edges: .bottom)
        )
        .onTapGesture {
            noteFieldFocused = false
        }
    }
}

// ── Text field placeholder helper ─────────────────────────────────────────────

private extension View {
    @ViewBuilder
    func placeholder<Content: View>(when shouldShow: Bool, @ViewBuilder placeholder: () -> Content) -> some View {
        ZStack(alignment: .topLeading) {
            if shouldShow { placeholder() }
            self
        }
    }
}
