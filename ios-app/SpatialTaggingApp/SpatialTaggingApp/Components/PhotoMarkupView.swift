// PhotoMarkupView.swift — G5 (2026.4.46): draw on a finding photo.
//
// Circle the issue, draw an arrow, write a number — the auditor's hand on the
// evidence. PencilKit canvas over the photo, finger or Apple Pencil, four
// ink colours (orange first — Gemba identity), two widths, undo, clear.
// "Done" flattens the strokes onto a copy of the photo at full resolution;
// the original is never modified (the server keeps both: `path` and
// `markupPath`). Phase 2 — anchored 3D strokes in AR — is separate.

import SwiftUI
import PencilKit

struct PhotoMarkupView: View {
    let image: UIImage
    /// Existing markup (re-editing): drawn back as the starting state if given.
    var existing: PKDrawing? = nil
    let onDone: (UIImage, PKDrawing) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var canvas = PKCanvasView()
    @State private var inkColor: UIColor = .systemOrange
    @State private var thick = false
    @State private var strokes = 0
    @State private var canvasSize: CGSize = .zero

    private let colours: [(String, UIColor)] = [("Orange", .systemOrange), ("Red", .systemRed), ("White", .white), ("Black", .black)]

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                GeometryReader { geo in
                    let fit = fitSize(image.size, in: geo.size)
                    ZStack {
                        Image(uiImage: image).resizable().scaledToFit()
                        MarkupCanvas(canvas: canvas, tool: tool, existing: existing, onStroke: { strokes = $0 })
                            .onAppear { canvasSize = fit }
                            .onChange(of: fit) { canvasSize = $0 }
                    }
                    .frame(width: fit.width, height: fit.height)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
                }
                .padding(.bottom, 64)

                // Tool strip — house style: thin material bar, capsule controls
                VStack {
                    Spacer()
                    HStack(spacing: 14) {
                        ForEach(colours, id: \.0) { name, c in
                            Button { inkColor = c } label: {
                                Circle().fill(Color(c))
                                    .frame(width: 26, height: 26)
                                    .overlay(Circle().stroke(.white, lineWidth: inkColor == c ? 3 : 0))
                                    .overlay(Circle().stroke(.black.opacity(0.35), lineWidth: 1))
                            }
                            .accessibilityLabel(name)
                        }
                        Divider().frame(height: 22)
                        Button { thick.toggle() } label: {
                            Image(systemName: thick ? "lineweight" : "pencil.line")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(width: 34, height: 34)
                                .background(thick ? Color.white.opacity(0.22) : .clear, in: Circle())
                        }
                        .accessibilityLabel(thick ? "Thick line" : "Thin line")
                        Button { canvas.undoManager?.undo() } label: {
                            Image(systemName: "arrow.uturn.backward").font(.body.weight(.semibold)).foregroundStyle(.white).frame(width: 34, height: 34)
                        }
                        .disabled(strokes == 0)
                        Button { canvas.drawing = PKDrawing(); strokes = 0 } label: {
                            Image(systemName: "trash").font(.body.weight(.semibold)).foregroundStyle(.white).frame(width: 34, height: 34)
                        }
                        .disabled(strokes == 0)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 14)
                }
            }
            .navigationTitle("Mark up photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { finish() }.fontWeight(.semibold).disabled(strokes == 0 && existing == nil)
                }
            }
        }
    }

    private var tool: PKInkingTool { PKInkingTool(.pen, color: inkColor, width: thick ? 14 : 6) }

    private func fitSize(_ img: CGSize, in box: CGSize) -> CGSize {
        guard img.width > 0, img.height > 0, box.width > 0, box.height > 0 else { return .zero }
        let s = min(box.width / img.width, box.height / img.height)
        return CGSize(width: floor(img.width * s), height: floor(img.height * s))
    }

    /// Flatten strokes onto a full-resolution copy of the photo.
    private func finish() {
        let drawing = canvas.drawing
        let bounds = CGRect(origin: .zero, size: canvasSize == .zero ? canvas.bounds.size : canvasSize)
        let scale = bounds.width > 0 ? image.size.width / bounds.width : 1
        let out = UIGraphicsImageRenderer(size: image.size, format: {
            let f = UIGraphicsImageRendererFormat.default(); f.scale = 1; return f
        }()).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
            drawing.image(from: bounds, scale: scale).draw(in: CGRect(origin: .zero, size: image.size))
        }
        AppLog.info("gemba", "photo markup", ["strokes": drawing.strokes.count])
        onDone(out, drawing)
        dismiss()
    }
}

/// PencilKit canvas, transparent, sized by its SwiftUI frame.
struct MarkupCanvas: UIViewRepresentable {
    let canvas: PKCanvasView
    let tool: PKInkingTool
    var existing: PKDrawing?
    var onStroke: (Int) -> Void

    func makeUIView(context: Context) -> PKCanvasView {
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        canvas.alwaysBounceVertical = false
        canvas.isScrollEnabled = false
        canvas.delegate = context.coordinator
        if let existing { canvas.drawing = existing }
        canvas.tool = tool
        return canvas
    }
    func updateUIView(_ uiView: PKCanvasView, context: Context) { uiView.tool = tool }
    func makeCoordinator() -> Coordinator { Coordinator(onStroke: onStroke) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let onStroke: (Int) -> Void
        init(onStroke: @escaping (Int) -> Void) { self.onStroke = onStroke }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { onStroke(canvasView.drawing.strokes.count) }
    }
}
