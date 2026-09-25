// FindingPanelNode.swift - G4 (2026.4.46): the floating panel above a Gemba
// finding pin, so an auditor / operator can READ a finding from where they
// stand instead of walking up and tapping every orange dot.
//
// Same design language as the AR OMS step panels (ARGuideSessionView):
//   • a collapsed PILL by default - stop number, title, category chip - so the
//     AR view is never blocked; tap to expand,
//   • an expanded CARD - code, question, category + risk, notes, photo count -
//     tap it to open the full sheet.
// World-anchored at scene root (never a child of the pulsing pin), full
// billboard, opaque textures (no alpha-sort flicker). Textures are drawn with
// UIKit; the SCNPlane size sets the physical scale.
//
// Node naming (what the tap handler looks for, walking up parents):
//   fpanel_<id>  container      fpill_<id>  pill      fcard_<id>  card

import SceneKit
import UIKit

enum FindingPanel {

    enum Part { case pill, card, cardOpen }

    /// Height of the panel centre above the pin, metres.
    static let lift: Float = 0.42

    // ── Public API ────────────────────────────────────────────────────────────

    /// Build the panel for `tag` and attach it to `root` above `pinPosition`.
    @discardableResult
    static func attach(to root: SCNNode, tag: LocTag, index: Int, pinPosition p: simd_float3, minimized: Bool = true) -> SCNNode {
        root.childNode(withName: "fpanel_\(tag.id)", recursively: false)?.removeFromParentNode()

        let container = SCNNode()
        container.name = "fpanel_\(tag.id)"
        container.simdPosition = simd_float3(p.x, p.y + lift, p.z)
        let bb = SCNBillboardConstraint(); bb.freeAxes = .all
        container.constraints = [bb]

        let pill = SCNNode(geometry: plane(0.30, 0.07, image: renderPill(tag: tag, index: index)))
        pill.name = "fpill_\(tag.id)"
        container.addChildNode(pill)

        let cardImg = renderCard(tag: tag, index: index)
        let cardH = Float(0.30 * cardImg.size.height / cardImg.size.width)
        let card = SCNNode(geometry: plane(0.30, CGFloat(cardH), image: cardImg))
        card.name = "fcard_\(tag.id)"
        card.simdPosition = simd_float3(0, (cardH - 0.07) / 2, 0)   // grow upward from the pill line
        container.addChildNode(card)

        // Thin tether down to the pin so the panel reads as belonging to it.
        let tether = SCNNode(geometry: SCNCylinder(radius: 0.0015, height: CGFloat(lift - 0.05)))
        tether.geometry?.firstMaterial?.diffuse.contents = UIColor.white.withAlphaComponent(0.35)
        tether.geometry?.firstMaterial?.lightingModel = .constant
        tether.name = "ftether_\(tag.id)"
        tether.simdPosition = simd_float3(p.x, p.y + (lift - 0.05) / 2 + 0.02, p.z)
        root.childNode(withName: tether.name!, recursively: false)?.removeFromParentNode()
        root.addChildNode(tether)

        setMinimized(container, minimized)
        root.addChildNode(container)
        return container
    }

    static func remove(from root: SCNNode, tagId: String) {
        root.childNode(withName: "fpanel_\(tagId)", recursively: false)?.removeFromParentNode()
        root.childNode(withName: "ftether_\(tagId)", recursively: false)?.removeFromParentNode()
    }

    static func setMinimized(_ container: SCNNode, _ minimized: Bool) {
        for c in container.childNodes {
            if c.name?.hasPrefix("fpill_") == true { c.isHidden = !minimized }
            if c.name?.hasPrefix("fcard_") == true { c.isHidden =  minimized }
        }
    }

    static func isMinimized(_ container: SCNNode) -> Bool {
        container.childNodes.first { $0.name?.hasPrefix("fcard_") == true }?.isHidden ?? true
    }

    /// Operator navigation: fade panels that are not the current target.
    static func setDimmed(_ container: SCNNode, _ dimmed: Bool) {
        container.opacity = dimmed ? 0.45 : 1.0
    }

    /// Resolve a hit-test result to (finding id, which part). Walks up parents.
    /// On the card, the bottom "Open ›" band is `.cardOpen`; anywhere else on
    /// the card is `.card` (collapse). Uses the plane's local coordinates -
    /// the card plane is centred on its own origin, +y up.
    static func hit(_ result: SCNHitTestResult) -> (tagId: String, part: Part)? {
        var cur: SCNNode? = result.node
        while let n = cur {
            if let name = n.name {
                if name.hasPrefix("fpill_") { return (String(name.dropFirst(6)), .pill) }
                if name.hasPrefix("fcard_") {
                    let h = Float((n.geometry as? SCNPlane)?.height ?? 0.2)
                    let footerBand = Float(0.30 * footerPt / 512)      // metres
                    let inFooter = result.node === n && result.localCoordinates.y < -h / 2 + footerBand
                    return (String(name.dropFirst(6)), inFooter ? .cardOpen : .card)
                }
            }
            cur = n.parent
        }
        return nil
    }
    /// Height of the card's footer band in texture points (matches renderCard).
    private static let footerPt: CGFloat = 64

    /// Re-render after an edit (new caption, category…). Keeps expanded state.
    static func update(in root: SCNNode, tag: LocTag, index: Int) {
        guard let container = root.childNode(withName: "fpanel_\(tag.id)", recursively: false) else { return }
        let min = isMinimized(container)
        let pin = simd_float3(container.simdPosition.x, container.simdPosition.y - lift, container.simdPosition.z)
        attach(to: root, tag: tag, index: index, pinPosition: pin, minimized: min)
    }

    // ── Geometry helper ───────────────────────────────────────────────────────

    private static func plane(_ w: CGFloat, _ h: CGFloat, image: UIImage) -> SCNPlane {
        let p = SCNPlane(width: w, height: h)
        p.cornerRadius = 0.012
        let m = SCNMaterial()
        m.diffuse.contents = image
        m.lightingModel    = .constant
        m.isDoubleSided    = true
        p.firstMaterial = m
        return p
    }

    // ── Colours ───────────────────────────────────────────────────────────────

    static func color(for tag: LocTag) -> UIColor {
        switch tag.findingCategory {
        case .strength: return UIColor(red: 0.13, green: 0.62, blue: 0.32, alpha: 1)
        case .ofi:      return UIColor(red: 0.93, green: 0.60, blue: 0.10, alpha: 1)
        case .nc:       return UIColor(red: 0.80, green: 0.16, blue: 0.16, alpha: 1)
        case .none:     return UIColor.systemOrange
        }
    }
    // Warm, light "frosted" surface with dark ink - easier on the eye than
    // orange-on-black, and orange stays the Gemba identity as the accent.
    private static let surface  = UIColor(red: 0.985, green: 0.975, blue: 0.955, alpha: 1)
    private static let ink      = UIColor(red: 0.12, green: 0.12, blue: 0.14, alpha: 1)
    private static let inkMuted = UIColor(red: 0.40, green: 0.40, blue: 0.44, alpha: 1)
    private static let hairline = UIColor(red: 0.86, green: 0.83, blue: 0.78, alpha: 1)

    /// Draw text vertically centred in `rect` (single line, truncating).
    private static func drawCentered(_ text: String, in rect: CGRect, font: UIFont, color: UIColor, align: NSTextAlignment = .left) {
        let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail; p.alignment = align
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p]
        let h = ceil(font.lineHeight)
        let r = CGRect(x: rect.minX, y: rect.midY - h / 2, width: rect.width, height: h)
        (text as NSString).draw(with: r, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attrs, context: nil)
    }

    // ── Textures ──────────────────────────────────────────────────────────────

    /// 512 × 120 pt ↔ 0.30 × 0.07 m. Badge · title · category/risk chip · chevron.
    private static func renderPill(tag: LocTag, index: Int) -> UIImage {
        let W: CGFloat = 512, H: CGFloat = 120
        let size = CGSize(width: W, height: H)
        let accent = color(for: tag)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)
            surface.setFill(); UIBezierPath(roundedRect: r, cornerRadius: 30).fill()
            let ring = UIBezierPath(roundedRect: r.insetBy(dx: 1.5, dy: 1.5), cornerRadius: 28.5)
            ring.lineWidth = 3; accent.withAlphaComponent(0.75).setStroke(); ring.stroke()

            // Badge: stop number
            let badgeR = CGRect(x: 18, y: 24, width: 72, height: 72)
            accent.setFill(); UIBezierPath(ovalIn: badgeR).fill()
            drawCentered("\(index + 1)", in: badgeR, font: UIFont.systemFont(ofSize: 32, weight: .heavy), color: .white, align: .center)

            // Right chip: category (+ risk) or legacy defect category - soft tint, accent text
            let chipText: String = {
                if let c = tag.findingCategory {
                    return tag.riskRating.map { "\(c.displayName) · \($0.shortName)" } ?? c.displayName
                }
                return tag.defectCategory.displayName
            }()
            let chipFont = UIFont.systemFont(ofSize: 21, weight: .bold)
            let cSz = (chipText as NSString).size(withAttributes: [.font: chipFont])
            let chipW = min(ceil(cSz.width) + 30, 210)
            let chipR = CGRect(x: W - 62 - chipW, y: H / 2 - 21, width: chipW, height: 42)
            accent.withAlphaComponent(0.16).setFill(); UIBezierPath(roundedRect: chipR, cornerRadius: 21).fill()
            drawCentered(chipText, in: chipR.insetBy(dx: 10, dy: 0), font: chipFont, color: accent, align: .center)

            // Title
            let titleR = CGRect(x: badgeR.maxX + 16, y: 0, width: chipR.minX - badgeR.maxX - 28, height: H)
            drawCentered(tag.questionTitle ?? tag.title, in: titleR, font: UIFont.systemFont(ofSize: 26, weight: .semibold), color: ink)

            // Expand chevron
            drawCentered("›", in: CGRect(x: W - 56, y: 0, width: 30, height: H), font: UIFont.systemFont(ofSize: 40, weight: .medium), color: inkMuted, align: .center)
        }
    }

    /// 512 × (content) pt ↔ 0.30 m wide. Code · category · risk · question · notes · photos.
    /// Tap anywhere on the card to collapse; the bottom "Open ›" band opens the sheet.
    private static func renderCard(tag: LocTag, index: Int) -> UIImage {
        let W: CGFloat = 512
        let accent = color(for: tag)
        let pad: CGFloat = 24

        let title = tag.questionTitle ?? tag.title
        let body  = tag.questionText ?? (tag.description.isEmpty ? nil : tag.description)
        let notes = tag.questionText != nil && !tag.description.isEmpty ? tag.description : nil
        let bodyFont  = UIFont.systemFont(ofSize: 21, weight: .regular)
        let notesFont = UIFont.italicSystemFont(ofSize: 20)
        func height(_ s: String?, _ f: UIFont, maxLines: Int) -> CGFloat {
            guard let s, !s.isEmpty else { return 0 }
            let para = NSMutableParagraphStyle(); para.lineBreakMode = .byWordWrapping
            let r = (s as NSString).boundingRect(with: CGSize(width: W - 2 * pad, height: .greatestFiniteMagnitude),
                                                 options: [.usesLineFragmentOrigin], attributes: [.font: f, .paragraphStyle: para], context: nil)
            return min(ceil(r.height), ceil(f.lineHeight) * CGFloat(maxLines)) + 8
        }
        let bodyH  = height(body,  bodyFont,  maxLines: 4)
        let notesH = height(notes, notesFont, maxLines: 2)
        let H: CGFloat = 16 + 56 + 12 + 40 + bodyH + notesH + footerPt + 8
        let size = CGSize(width: W, height: H)

        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)
            surface.setFill(); UIBezierPath(roundedRect: r, cornerRadius: 26).fill()
            let ring = UIBezierPath(roundedRect: r.insetBy(dx: 1.5, dy: 1.5), cornerRadius: 24.5)
            ring.lineWidth = 3; accent.withAlphaComponent(0.75).setStroke(); ring.stroke()

            var y: CGFloat = 16
            // Header: badge + code + chips
            let badgeR = CGRect(x: pad, y: y, width: 56, height: 56)
            accent.setFill(); UIBezierPath(ovalIn: badgeR).fill()
            drawCentered("\(index + 1)", in: badgeR, font: UIFont.systemFont(ofSize: 26, weight: .heavy), color: .white, align: .center)

            var x = badgeR.maxX + 14
            let codeFont = UIFont.monospacedSystemFont(ofSize: 21, weight: .semibold)
            if let line = tag.referenceLine {
                let w = ceil((line as NSString).size(withAttributes: [.font: codeFont]).width)
                drawCentered(line, in: CGRect(x: x, y: y, width: min(w, W - pad - x), height: 26), font: codeFont, color: inkMuted)
            }
            func chip(_ text: String, tint: UIColor, textColor: UIColor) {
                let f = UIFont.systemFont(ofSize: 18, weight: .bold)
                let w = ceil((text as NSString).size(withAttributes: [.font: f]).width) + 22
                let cr = CGRect(x: x, y: y + 28, width: w, height: 28)
                guard cr.maxX < W - pad else { return }
                tint.setFill(); UIBezierPath(roundedRect: cr, cornerRadius: 14).fill()
                drawCentered(text, in: cr, font: f, color: textColor, align: .center)
                x = cr.maxX + 8
            }
            if let c = tag.findingCategory { chip(c.displayName, tint: accent.withAlphaComponent(0.16), textColor: accent) }
            else { chip(tag.defectCategory.displayName, tint: accent.withAlphaComponent(0.16), textColor: accent) }
            if let rr = tag.riskRating { chip(rr.displayName, tint: hairline.withAlphaComponent(0.6), textColor: ink) }
            if let s = tag.severity, tag.findingCategory == nil { chip(s.displayName, tint: hairline.withAlphaComponent(0.6), textColor: ink) }
            y = badgeR.maxY + 12

            // Title
            drawCentered(title, in: CGRect(x: pad, y: y, width: W - 2 * pad, height: 36), font: UIFont.systemFont(ofSize: 27, weight: .bold), color: ink)
            y += 40

            // Body (question text or description)
            if let body, bodyH > 0 {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
                (body as NSString).draw(with: CGRect(x: pad, y: y, width: W - 2 * pad, height: bodyH - 8), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                         attributes: [.font: bodyFont, .foregroundColor: ink.withAlphaComponent(0.85), .paragraphStyle: p], context: nil)
                y += bodyH
            }
            if let notes, notesH > 0 {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
                ("“\(notes)”" as NSString).draw(with: CGRect(x: pad, y: y, width: W - 2 * pad, height: notesH - 8), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                                 attributes: [.font: notesFont, .foregroundColor: inkMuted, .paragraphStyle: p], context: nil)
                y += notesH
            }

            // Footer band: photos summary + "Open ›" (the tappable open zone)
            let footR = CGRect(x: 0, y: H - footerPt, width: W, height: footerPt)
            hairline.withAlphaComponent(0.5).setFill()
            UIBezierPath(rect: CGRect(x: pad, y: footR.minY, width: W - 2 * pad, height: 1)).fill()
            let photos = tag.allPhotos
            let foot: String = photos.isEmpty ? "No photo"
                : (photos.count == 1 ? "📷 1 photo" : "📷 \(photos.count) photos")
                  + (photos.first?.caption.map { " · \($0)" } ?? "")
            drawCentered(foot, in: CGRect(x: pad, y: footR.minY, width: W - 2 * pad - 130, height: footerPt),
                         font: UIFont.systemFont(ofSize: 20, weight: .medium), color: inkMuted)
            let openR = CGRect(x: W - pad - 110, y: footR.minY + 12, width: 110, height: footerPt - 24)
            accent.setFill(); UIBezierPath(roundedRect: openR, cornerRadius: (footerPt - 24) / 2).fill()
            drawCentered("Open ›", in: openR, font: UIFont.systemFont(ofSize: 21, weight: .bold), color: .white, align: .center)
        }
    }
}
