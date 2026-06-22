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
//
// ── Interaction notes ────────────────────────────────────────────────────────
// v2 fixes a real bug (not just a polish pass): the original drag math read
// `rect` — already mutated by the PREVIOUS onChanged call in the same
// gesture — and then added DragGesture's `translation`, which is the TOTAL
// delta since the finger went down, not an incremental delta since the last
// callback. Every callback re-applied translation on top of an already-
// shifted rect, so the box raced ahead of the finger and got worse the
// longer you dragged — exactly the "hard to scale or move" complaint. Fixed
// by snapshotting the rect ONCE per gesture (`@GestureState`) and always
// computing `base + totalTranslation`, never `current + totalTranslation`.
//
// On top of that fix: hit targets for the corner/edge handles are now a
// generous 44×44pt invisible zone around each small visual dot (Apple HIG
// minimum tap target), edge midpoint handles were added for single-axis
// resize, a magnifying loupe appears above the finger while dragging so the
// touch point is never hidden under your own fingertip, and handles use
// `.highPriorityGesture` so a grab near a corner can never be swallowed by
// the box's move gesture.

import SwiftUI
import UIKit

struct ROIPickerView: View {

    let referenceImage: UIImage
    let tagLabel:        String
    let accentColor:      Color
    /// Called with the chosen ROI, or nil if the Author skipped.
    let onDone: (RegionOfInterest?) -> Void

    @Environment(\.dismiss) private var dismiss

    private static let defaultRect = CGRect(x: 0.30, y: 0.30, width: 0.40, height: 0.40)

    // Rect lives in unit (0...1) image-fraction space for the math, but is
    // dragged/rendered in the displayed image's local view-space.
    @State private var rect: CGRect = ROIPickerView.defaultRect
    @State private var imageFrame: CGRect = .zero   // where the image is actually laid out on screen

    // Snapshot of `rect` taken once at the start of the current drag — every
    // onChanged computes from THIS, never from the live `rect`, so deltas
    // never compound. Explicitly captured on the first onChanged of a given
    // gesture and cleared onEnded (plain @State, not @GestureState — there
    // are 9 separate gesture recognizers here — move + 8 handles — and
    // explicit capture/clear is unambiguous about which one currently owns
    // the snapshot, rather than relying on ten distinct `.updating` chains
    // sharing one piece of gesture state).
    @State private var dragBaseRect: CGRect?

    // UI-only state (not gesture math): which handle is currently grabbed,
    // and where the finger actually is — drives the highlight + magnifier.
    @State private var activeHandle: Handle?
    @State private var fingerPoint: CGPoint?
    @State private var isMovingBox = false

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

                        if let fingerPoint {
                            magnifier(at: fingerPoint, displayFrame: displayFrame, viewSize: geo.size)
                        }
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
            HStack {
                Spacer()
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        rect = ROIPickerView.defaultRect
                    }
                } label: {
                    Text("Reset")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(.trailing, 20)
            }
            Text("Mark Inspection Region").font(.headline).foregroundStyle(.white)
            Text("Drag the box around just \"\(tagLabel)\" so validation focuses on that feature, not the whole scene.")
                .font(.caption).foregroundStyle(.white.opacity(0.65))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
        }
        .padding(.top, 40)
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

    private enum Handle: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight
        case top, bottom, left, right

        var isCorner: Bool {
            switch self {
            case .topLeft, .topRight, .bottomLeft, .bottomRight: return true
            case .top, .bottom, .left, .right: return false
            }
        }
    }

    // Unit rect → screen-space rect within the given display frame.
    private func screenRect(_ r: CGRect, in displayFrame: CGRect) -> CGRect {
        CGRect(
            x: displayFrame.minX + r.minX * displayFrame.width,
            y: displayFrame.minY + r.minY * displayFrame.height,
            width: r.width * displayFrame.width,
            height: r.height * displayFrame.height
        )
    }

    private func anchorPoint(for handle: Handle, in boxRect: CGRect) -> CGPoint {
        switch handle {
        case .topLeft:     return CGPoint(x: boxRect.minX, y: boxRect.minY)
        case .topRight:    return CGPoint(x: boxRect.maxX, y: boxRect.minY)
        case .bottomLeft:  return CGPoint(x: boxRect.minX, y: boxRect.maxY)
        case .bottomRight: return CGPoint(x: boxRect.maxX, y: boxRect.maxY)
        case .top:         return CGPoint(x: boxRect.midX, y: boxRect.minY)
        case .bottom:      return CGPoint(x: boxRect.midX, y: boxRect.maxY)
        case .left:        return CGPoint(x: boxRect.minX, y: boxRect.midY)
        case .right:       return CGPoint(x: boxRect.maxX, y: boxRect.midY)
        }
    }

    @ViewBuilder
    private func roiOverlay(displayFrame: CGRect) -> some View {
        let boxRect = screenRect(rect, in: displayFrame)

        ZStack {
            // Dim everything outside the box
            Path { p in
                p.addRect(displayFrame)
                p.addRect(boxRect)
            }
            .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
            .allowsHitTesting(false)

            // Rule-of-thirds reference grid — only while actively adjusting,
            // so it doesn't clutter the view at rest.
            if isMovingBox || activeHandle != nil {
                thirdsGrid(boxRect: boxRect)
            }

            Rectangle()
                .strokeBorder(accentColor, lineWidth: 2.5)
                .frame(width: boxRect.width, height: boxRect.height)
                .position(x: boxRect.midX, y: boxRect.midY)
                .contentShape(Rectangle())
                .gesture(moveGesture(displayFrame: displayFrame))

            ForEach(Handle.allCases, id: \.self) { handle in
                handleView(handle, boxRect: boxRect)
                    .highPriorityGesture(handleGesture(handle, displayFrame: displayFrame))
            }
        }
    }

    private func thirdsGrid(boxRect: CGRect) -> some View {
        Path { p in
            for i in 1...2 {
                let x = boxRect.minX + boxRect.width * CGFloat(i) / 3
                p.move(to: CGPoint(x: x, y: boxRect.minY))
                p.addLine(to: CGPoint(x: x, y: boxRect.maxY))
                let y = boxRect.minY + boxRect.height * CGFloat(i) / 3
                p.move(to: CGPoint(x: boxRect.minX, y: y))
                p.addLine(to: CGPoint(x: boxRect.maxX, y: y))
            }
        }
        .stroke(Color.white.opacity(0.35), lineWidth: 1)
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    // Visual handle: a small dot/bar that grows slightly while grabbed,
    // sitting inside a much larger (44×44pt minimum) invisible tap target so
    // a finger near — not exactly on — the corner still grabs it.
    @ViewBuilder
    private func handleView(_ handle: Handle, boxRect: CGRect) -> some View {
        let point = anchorPoint(for: handle, in: boxRect)
        let isActive = activeHandle == handle
        let hitSize: CGFloat = 44

        Color.clear
            .frame(width: hitSize, height: hitSize)
            .contentShape(Rectangle())
            .overlay(visualIndicator(handle, isActive: isActive))
            .position(point)
    }

    @ViewBuilder
    private func visualIndicator(_ handle: Handle, isActive: Bool) -> some View {
        if handle.isCorner {
            Circle()
                .fill(accentColor)
                .frame(width: isActive ? 30 : 24, height: isActive ? 30 : 24)
                .overlay(Circle().stroke(.white, lineWidth: 2))
                .shadow(color: .black.opacity(0.4), radius: isActive ? 4 : 1)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
        } else {
            // Edge handles: short capsule bars, oriented along the edge they sit on.
            let isHorizontalEdge = handle == .top || handle == .bottom
            Capsule()
                .fill(accentColor)
                .frame(
                    width:  isHorizontalEdge ? (isActive ? 30 : 22) : (isActive ? 8 : 6),
                    height: isHorizontalEdge ? (isActive ? 8 : 6)  : (isActive ? 30 : 22)
                )
                .overlay(Capsule().stroke(.white, lineWidth: 1.5))
                .shadow(color: .black.opacity(0.4), radius: isActive ? 4 : 1)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
        }
    }

    // ── Gestures ──────────────────────────────────────────────────────────────
    // Both gestures snapshot `rect` into `dragBaseRect` exactly once (the
    // `if state == nil` guard inside `.updating`) and compute every frame as
    // `base + totalTranslation`. This is the actual fix for the reported
    // "hard to scale/move" behaviour — the previous version recomputed from
    // the live, already-mutated `rect` every callback and added the
    // cumulative-since-drag-start translation on top of that each time,
    // so the box visibly raced ahead of the finger.

    private func moveGesture(displayFrame: CGRect) -> some Gesture {
        DragGesture()
            .onChanged { value in
                if dragBaseRect == nil { dragBaseRect = rect }
                guard let base = dragBaseRect else { return }
                if !isMovingBox {
                    isMovingBox = true
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
                let dxFrac = value.translation.width  / max(displayFrame.width, 1)
                let dyFrac = value.translation.height / max(displayFrame.height, 1)
                var r = base
                r.origin.x = clamp(base.origin.x + dxFrac, 0, 1 - base.width)
                r.origin.y = clamp(base.origin.y + dyFrac, 0, 1 - base.height)
                rect = r
            }
            .onEnded { _ in
                isMovingBox = false
                dragBaseRect = nil
            }
    }

    private func handleGesture(_ handle: Handle, displayFrame: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragBaseRect == nil { dragBaseRect = rect }
                guard let base = dragBaseRect else { return }
                if activeHandle != handle {
                    activeHandle = handle
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }

                let dxFrac = value.translation.width  / max(displayFrame.width, 1)
                let dyFrac = value.translation.height / max(displayFrame.height, 1)
                rect = resizedRect(from: base, handle: handle, dxFrac: dxFrac, dyFrac: dyFrac)

                // Track the actual finger position (base anchor + raw point
                // translation, in screen points) — not the clamped handle —
                // so the magnifier follows the touch exactly even once the
                // box itself has hit a size/edge limit.
                let baseAnchor = anchorPoint(for: handle, in: screenRect(base, in: displayFrame))
                fingerPoint = CGPoint(
                    x: baseAnchor.x + value.translation.width,
                    y: baseAnchor.y + value.translation.height
                )
            }
            .onEnded { _ in
                activeHandle = nil
                fingerPoint = nil
                dragBaseRect = nil
            }
    }

    // Pure function: given the rect at drag-start and the total translation
    // so far (as unit fractions), returns the resulting rect. Never reads
    // `rect` directly — always operates on the passed-in `base` snapshot.
    private func resizedRect(from base: CGRect, handle: Handle, dxFrac: CGFloat, dyFrac: CGFloat) -> CGRect {
        switch handle {
        case .topLeft:
            let newX = clamp(base.minX + dxFrac, 0, base.maxX - minFraction)
            let newY = clamp(base.minY + dyFrac, 0, base.maxY - minFraction)
            return CGRect(x: newX, y: newY, width: base.maxX - newX, height: base.maxY - newY)
        case .topRight:
            let newMaxX = clamp(base.maxX + dxFrac, base.minX + minFraction, 1)
            let newY    = clamp(base.minY + dyFrac, 0, base.maxY - minFraction)
            return CGRect(x: base.minX, y: newY, width: newMaxX - base.minX, height: base.maxY - newY)
        case .bottomLeft:
            let newX    = clamp(base.minX + dxFrac, 0, base.maxX - minFraction)
            let newMaxY = clamp(base.maxY + dyFrac, base.minY + minFraction, 1)
            return CGRect(x: newX, y: base.minY, width: base.maxX - newX, height: newMaxY - base.minY)
        case .bottomRight:
            let newMaxX = clamp(base.maxX + dxFrac, base.minX + minFraction, 1)
            let newMaxY = clamp(base.maxY + dyFrac, base.minY + minFraction, 1)
            return CGRect(x: base.minX, y: base.minY, width: newMaxX - base.minX, height: newMaxY - base.minY)
        case .top:
            let newY = clamp(base.minY + dyFrac, 0, base.maxY - minFraction)
            return CGRect(x: base.minX, y: newY, width: base.width, height: base.maxY - newY)
        case .bottom:
            let newMaxY = clamp(base.maxY + dyFrac, base.minY + minFraction, 1)
            return CGRect(x: base.minX, y: base.minY, width: base.width, height: newMaxY - base.minY)
        case .left:
            let newX = clamp(base.minX + dxFrac, 0, base.maxX - minFraction)
            return CGRect(x: newX, y: base.minY, width: base.maxX - newX, height: base.height)
        case .right:
            let newMaxX = clamp(base.maxX + dxFrac, base.minX + minFraction, 1)
            return CGRect(x: base.minX, y: base.minY, width: newMaxX - base.minX, height: base.height)
        }
    }

    private func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
        guard hi > lo else { return lo }
        return max(lo, min(hi, v))
    }

    // ── Magnifier loupe ───────────────────────────────────────────────────────
    // Floats above the finger (never under it) showing a zoomed crop of the
    // reference image centred on the exact touch point, with a crosshair —
    // this is what makes fine corner/edge placement actually precise instead
    // of guessing where your fingertip is relative to the line underneath it.
    private func magnifier(at point: CGPoint, displayFrame: CGRect, viewSize: CGSize) -> some View {
        let loupeDiameter: CGFloat = 96
        let zoom: CGFloat = 2.75

        let fracX = (point.x - displayFrame.minX) / max(displayFrame.width, 1)
        let fracY = (point.y - displayFrame.minY) / max(displayFrame.height, 1)

        let loupeX = clamp(point.x, loupeDiameter / 2 + 4, viewSize.width - loupeDiameter / 2 - 4)
        let loupeY = max(loupeDiameter / 2 + 4, point.y - 78)

        return ZStack {
            Image(uiImage: referenceImage)
                .resizable()
                .frame(width: displayFrame.width * zoom, height: displayFrame.height * zoom)
                .offset(
                    x: loupeDiameter / 2 - fracX * displayFrame.width * zoom,
                    y: loupeDiameter / 2 - fracY * displayFrame.height * zoom
                )
                .frame(width: loupeDiameter, height: loupeDiameter)
                .clipped()

            Rectangle().fill(accentColor.opacity(0.9)).frame(width: loupeDiameter, height: 1)
            Rectangle().fill(accentColor.opacity(0.9)).frame(width: 1, height: loupeDiameter)
        }
        .frame(width: loupeDiameter, height: loupeDiameter)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white, lineWidth: 2.5))
        .shadow(color: .black.opacity(0.45), radius: 8, y: 3)
        .position(x: loupeX, y: loupeY)
        .allowsHitTesting(false)
        .transition(.opacity.combined(with: .scale(scale: 0.85)))
        .animation(.easeOut(duration: 0.12), value: point)
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
