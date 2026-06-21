// ROIPickerView.swift
//
// Optional Author-side step: lets the Author drag out a rectangle on a
// captured reference image to mark the specific feature being inspected
// (a cable connector, a switch, a valve) instead of leaving validation to
// score the entire frame. The returned RegionOfInterest is normalised
// (0.0–1.0 fractions of image width/height, origin top-left) so it applies
// identically regardless of the live frame's resolution.
//
// Entirely optional — if the Author taps "Skip", no ROI is set and the tag
// validates against the full frame exactly as it did before this feature
// existed.

import SwiftUI

struct ROIPickerView: View {

    let referenceImage: UIImage
    let tagLabel:        String
    let accentColor:      Color
    /// Called with the chosen ROI, or nil if the Author skipped.
    let onDone: (RegionOfInterest?) -> Void

    @Environment(\.dismiss) private var dismiss

    // Rect lives in unit (0...1) image-fraction space for the math, but is
    // dragged/rendered in the displayed image's local view-space.
    @State private var rect: CGRect = CGRect(x: 0.30, y: 0.30, width: 0.40, height: 0.40)
    @State private var imageFrame: CGRect = .zero   // where the image is actually laid out on screen

    private let minFraction: CGFloat = 0.08   // smallest allowed ROI side, as a fraction of the image

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                GeometryReader { geo in
                    let displayFrame = aspectFitFrame(for: referenceImage.size, in: geo.size)
                    ZStack {
                        Image(uiImage: referenceImage)
                            .resizable()
                            .frame(width: displayFrame.width, height: displayFrame.height)
                            .position(x: displayFrame.midX, y: displayFrame.midY)

                        roiOverlay(displayFrame: displayFrame)
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                    .onAppear { imageFrame = displayFrame }
                    .onChange(of: geo.size) { _ in imageFrame = aspectFitFrame(for: referenceImage.size, in: geo.size) }
                }

                footer
            }
        }
    }

    // ── Header / footer ───────────────────────────────────────────────────────

    private var header: some View {
        VStack(spacing: 6) {
            Text("Mark Inspection Region").font(.headline).foregroundStyle(.white)
            Text("Drag the box around just \"\(tagLabel)\" so validation focuses on that feature, not the whole scene.")
                .font(.caption).foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
        }
        .padding(.top, 56)
        .padding(.bottom, 12)
    }

    private var footer: some View {
        HStack(spacing: 14) {
            Button {
                onDone(nil)
                dismiss()
            } label: {
                Text("Skip").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 16)
            }
            .buttonStyle(.bordered)
            .tint(.white)

            Button {
                onDone(RegionOfInterest(x: rect.minX, y: rect.minY, w: rect.width, h: rect.height))
                dismiss()
            } label: {
                Text("Use This Region").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 16)
            }
            .buttonStyle(.borderedProminent)
            .tint(accentColor)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 40)
        .padding(.top, 8)
    }

    // ── ROI rectangle + handles ───────────────────────────────────────────────

    @ViewBuilder
    private func roiOverlay(displayFrame: CGRect) -> some View {
        let boxRect = CGRect(
            x: displayFrame.minX + rect.minX * displayFrame.width,
            y: displayFrame.minY + rect.minY * displayFrame.height,
            width: rect.width * displayFrame.width,
            height: rect.height * displayFrame.height
        )

        ZStack {
            // Dim everything outside the box
            Path { p in
                p.addRect(displayFrame)
                p.addRect(boxRect)
            }
            .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
            .allowsHitTesting(false)

            Rectangle()
                .strokeBorder(accentColor, lineWidth: 2.5)
                .frame(width: boxRect.width, height: boxRect.height)
                .position(x: boxRect.midX, y: boxRect.midY)
                .gesture(moveGesture(displayFrame: displayFrame))

            ForEach(Corner.allCases, id: \.self) { corner in
                handle(at: corner, boxRect: boxRect)
                    .gesture(resizeGesture(corner: corner, displayFrame: displayFrame))
            }
        }
    }

    private enum Corner: CaseIterable { case topLeft, topRight, bottomLeft, bottomRight }

    private func handle(at corner: Corner, boxRect: CGRect) -> some View {
        let point: CGPoint
        switch corner {
        case .topLeft:     point = CGPoint(x: boxRect.minX, y: boxRect.minY)
        case .topRight:    point = CGPoint(x: boxRect.maxX, y: boxRect.minY)
        case .bottomLeft:  point = CGPoint(x: boxRect.minX, y: boxRect.maxY)
        case .bottomRight: point = CGPoint(x: boxRect.maxX, y: boxRect.maxY)
        }
        return Circle()
            .fill(accentColor)
            .frame(width: 26, height: 26)
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .position(point)
    }

    // ── Gestures (work in unit-fraction space, scaled by displayFrame) ───────

    private func moveGesture(displayFrame: CGRect) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let dxFrac = value.translation.width  / max(displayFrame.width, 1)
                let dyFrac = value.translation.height / max(displayFrame.height, 1)
                var r = rect
                r.origin.x = clamp(r.origin.x + dxFrac, 0, 1 - r.width)
                r.origin.y = clamp(r.origin.y + dyFrac, 0, 1 - r.height)
                rect = r
            }
    }

    private func resizeGesture(corner: Corner, displayFrame: CGRect) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let dxFrac = value.translation.width  / max(displayFrame.width, 1)
                let dyFrac = value.translation.height / max(displayFrame.height, 1)
                var r = rect

                switch corner {
                case .topLeft:
                    let newX = clamp(r.minX + dxFrac, 0, r.maxX - minFraction)
                    let newY = clamp(r.minY + dyFrac, 0, r.maxY - minFraction)
                    r = CGRect(x: newX, y: newY, width: r.maxX - newX, height: r.maxY - newY)
                case .topRight:
                    let newMaxX = clamp(r.maxX + dxFrac, r.minX + minFraction, 1)
                    let newY    = clamp(r.minY + dyFrac, 0, r.maxY - minFraction)
                    r = CGRect(x: r.minX, y: newY, width: newMaxX - r.minX, height: r.maxY - newY)
                case .bottomLeft:
                    let newX    = clamp(r.minX + dxFrac, 0, r.maxX - minFraction)
                    let newMaxY = clamp(r.maxY + dyFrac, r.minY + minFraction, 1)
                    r = CGRect(x: newX, y: r.minY, width: r.maxX - newX, height: newMaxY - r.minY)
                case .bottomRight:
                    let newMaxX = clamp(r.maxX + dxFrac, r.minX + minFraction, 1)
                    let newMaxY = clamp(r.maxY + dyFrac, r.minY + minFraction, 1)
                    r = CGRect(x: r.minX, y: r.minY, width: newMaxX - r.minX, height: newMaxY - r.minY)
                }
                rect = r
            }
    }

    private func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
        guard hi > lo else { return lo }
        return max(lo, min(hi, v))
    }

    // Largest rect of `size`'s aspect ratio that fits inside `bounds`, centred.
    private func aspectFitFrame(for size: CGSize, in bounds: CGSize) -> CGRect {
        guard size.width > 0, size.height > 0, bounds.width > 0, bounds.height > 0 else {
            return CGRect(origin: .zero, size: bounds)
        }
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let w = size.width * scale
        let h = size.height * scale
        return CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
    }
}
