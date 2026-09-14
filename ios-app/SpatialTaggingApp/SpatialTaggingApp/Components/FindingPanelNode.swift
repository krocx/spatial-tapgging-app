// FindingPanelNode.swift — G4 (2026.4.46): the floating panel above a Gemba
// finding pin, so an auditor / operator can READ a finding from where they
// stand instead of walking up and tapping every orange dot.
//
// Same design language as the AR OMS step panels (ARGuideSessionView):
//   • a collapsed PILL by default — stop number, title, category chip — so the
//     AR view is never blocked; tap to expand,
//   • an expanded CARD — code, question, category + risk, notes, photo count —
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

    enum Part { case pill, card }

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

    /// Resolve a hit-test node to (finding id, which part). Walks up parents.
    static func hit(_ node: SCNNode) -> (tagId: String, part: Part)? {
        var cur: SCNNode? = node
        while let n = cur {
            if let name = n.name {
                if name.hasPrefix("fpill_") { return (String(name.dropFirst(6)), .pill) }
                if name.hasPrefix("fcard_") { return (String(name.dropFirst(6)), .card) }
            }
            cur = n.parent
        }
        return nil
    }

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
    private static let surface = UIColor(red: 0.06, green: 0.08, blue: 0.13, alpha: 1)

    // ── Textures ──────────────────────────────────────────────────────────────

    /// 512 × 120 pt ↔ 0.30 × 0.07 m. Badge · title · category/risk chip · chevron.
    private static func renderPill(tag: LocTag, index: Int) -> UIImage {
        let W: CGFloat = 512, H: CGFloat = 120
        let size = CGSize(width: W, height: H)
        let accent = color(for: tag)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)
            surface.setFill(); UIBezierPath(roundedRect: r, cornerRadius: 26).fill()
            let ring = UIBezierPath(roundedRect: r.insetBy(dx: 2, dy: 2), cornerRadius: 24)
            ring.lineWidth = 4; accent.setStroke(); ring.stroke()

            // Badge: stop number
            let badgeR = CGRect(x: 16, y: 22, width: 76, height: 76)
            accent.setFill(); UIBezierPath(ovalIn: badgeR).fill()
            let bStr = "\(index + 1)" as NSString
            let bAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 34, weight: .heavy), .foregroundColor: UIColor.white]
            let bSz = bStr.size(withAttributes: bAttrs)
            bStr.draw(at: CGPoint(x: badgeR.midX - bSz.width / 2, y: badgeR.midY - bSz.height / 2), withAttributes: bAttrs)

            // Right chip: category (+ risk) or legacy defect category
            let chipText: String = {
                if let c = tag.findingCategory {
                    return tag.riskRating.map { "\(c.displayName) · \($0.shortName)" } ?? c.displayName
                }
                return tag.defectCategory.displayName
            }()
            let chipAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 22, weight: .bold), .foregroundColor: UIColor.white]
            let cSz = (chipText as NSString).size(withAttributes: chipAttrs)
            let chipW = min(cSz.width + 28, 200)
            let chipR = CGRect(x: W - 60 - chipW, y: H / 2 - 22, width: chipW, height: 44)
            accent.withAlphaComponent(0.9).setFill(); UIBezierPath(roundedRect: chipR, cornerRadius: 22).fill()
            let cp = NSMutableParagraphStyle(); cp.alignment = .center; cp.lineBreakMode = .byTruncatingTail
            var chipDraw = chipAttrs; chipDraw[.paragraphStyle] = cp
            (chipText as NSString).draw(with: CGRect(x: chipR.minX + 8, y: chipR.minY + 8, width: chipR.width - 16, height: 30),
                                        options: .truncatesLastVisibleLine,
                                        attributes: chipDraw, context: nil)

            // Title
            let tp = NSMutableParagraphStyle(); tp.lineBreakMode = .byTruncatingTail
            let tAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 26, weight: .bold), .foregroundColor: UIColor.white, .paragraphStyle: tp]
            let title = tag.questionTitle ?? tag.title
            let titleR = CGRect(x: 108, y: H / 2 - 18, width: chipR.minX - 120, height: 36)
            (title as NSString).draw(with: titleR, options: .truncatesLastVisibleLine, attributes: tAttrs, context: nil)

            ("›" as NSString).draw(at: CGPoint(x: 466, y: H / 2 - 26), withAttributes: [
                .font: UIFont.systemFont(ofSize: 38, weight: .semibold), .foregroundColor: UIColor.white.withAlphaComponent(0.6)])
        }
    }

    /// 512 × (content) pt ↔ 0.30 m wide. Code · category · risk · question · notes · photos.
    private static func renderCard(tag: LocTag, index: Int) -> UIImage {
        let W: CGFloat = 512
        let accent = color(for: tag)
        let pad: CGFloat = 24

        // Measure body text to size the card.
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
            return min(ceil(r.height), f.lineHeight * CGFloat(maxLines)) + 8
        }
        let bodyH  = height(body,  bodyFont,  maxLines: 4)
        let notesH = height(notes, notesFont, maxLines: 2)
        let H: CGFloat = 16 + 56 + 12 + 40 + bodyH + notesH + 56 + 16
        let size = CGSize(width: W, height: H)

        return UIGraphicsImageRenderer(size: size).image { _ in
            let r = CGRect(origin: .zero, size: size)
            surface.setFill(); UIBezierPath(roundedRect: r, cornerRadius: 26).fill()
            let ring = UIBezierPath(roundedRect: r.insetBy(dx: 2, dy: 2), cornerRadius: 24)
            ring.lineWidth = 4; accent.setStroke(); ring.stroke()

            var y: CGFloat = 16
            // Header: badge + code + chips
            let badgeR = CGRect(x: pad, y: y, width: 56, height: 56)
            accent.setFill(); UIBezierPath(ovalIn: badgeR).fill()
            let bStr = "\(index + 1)" as NSString
            let bAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 26, weight: .heavy), .foregroundColor: UIColor.white]
            let bSz = bStr.size(withAttributes: bAttrs)
            bStr.draw(at: CGPoint(x: badgeR.midX - bSz.width / 2, y: badgeR.midY - bSz.height / 2), withAttributes: bAttrs)

            var x = badgeR.maxX + 14
            let codeAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedSystemFont(ofSize: 22, weight: .semibold), .foregroundColor: UIColor.white.withAlphaComponent(0.85)]
            if let line = tag.referenceLine {
                (line as NSString).draw(at: CGPoint(x: x, y: y + 4), withAttributes: codeAttrs)
                x += (line as NSString).size(withAttributes: codeAttrs).width + 14
            }
            func chip(_ text: String, fill: UIColor) {
                let a: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 19, weight: .bold), .foregroundColor: UIColor.white]
                let s = (text as NSString).size(withAttributes: a)
                let cr = CGRect(x: x, y: y + 30, width: s.width + 22, height: 30)
                guard cr.maxX < W - pad else { return }
                fill.setFill(); UIBezierPath(roundedRect: cr, cornerRadius: 15).fill()
                (text as NSString).draw(at: CGPoint(x: cr.minX + 11, y: cr.minY + 4), withAttributes: a)
                x = cr.maxX + 8
            }
            x = badgeR.maxX + 14
            if let c = tag.findingCategory { chip(c.displayName, fill: accent) }
            else { chip(tag.defectCategory.displayName, fill: accent) }
            if let rr = tag.riskRating { chip(rr.displayName, fill: UIColor.white.withAlphaComponent(0.18)) }
            if let s = tag.severity, tag.findingCategory == nil { chip(s.displayName, fill: UIColor.white.withAlphaComponent(0.18)) }
            y = badgeR.maxY + 12

            // Title
            let tp = NSMutableParagraphStyle(); tp.lineBreakMode = .byTruncatingTail
            (title as NSString).draw(with: CGRect(x: pad, y: y, width: W - 2 * pad, height: 36), options: .truncatesLastVisibleLine,
                                      attributes: [.font: UIFont.systemFont(ofSize: 27, weight: .bold), .foregroundColor: UIColor.white, .paragraphStyle: tp], context: nil)
            y += 40

            // Body (question text or description)
            if let body, bodyH > 0 {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
                (body as NSString).draw(with: CGRect(x: pad, y: y, width: W - 2 * pad, height: bodyH - 8), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                         attributes: [.font: bodyFont, .foregroundColor: UIColor.white.withAlphaComponent(0.85), .paragraphStyle: p], context: nil)
                y += bodyH
            }
            if let notes, notesH > 0 {
                let p = NSMutableParagraphStyle(); p.lineBreakMode = .byTruncatingTail
                ("“\(notes)”" as NSString).draw(with: CGRect(x: pad, y: y, width: W - 2 * pad, height: notesH - 8), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                                 attributes: [.font: notesFont, .foregroundColor: UIColor.white.withAlphaComponent(0.7), .paragraphStyle: p], context: nil)
                y += notesH
            }

            // Footer: photos + open hint
            let photos = tag.allPhotos
            let foot: String = photos.isEmpty ? "No photo"
                : (photos.count == 1 ? "📷 1 photo" : "📷 \(photos.count) photos")
                  + (photos.first?.caption.map { " · \($0)" } ?? "")
            let fp = NSMutableParagraphStyle(); fp.lineBreakMode = .byTruncatingTail
            (foot as NSString).draw(with: CGRect(x: pad, y: y + 14, width: W - 2 * pad - 130, height: 30), options: .truncatesLastVisibleLine,
                                     attributes: [.font: UIFont.systemFont(ofSize: 20, weight: .medium), .foregroundColor: UIColor.white.withAlphaComponent(0.7), .paragraphStyle: fp], context: nil)
            ("Open ›" as NSString).draw(at: CGPoint(x: W - pad - 92, y: y + 12), withAttributes: [
                .font: UIFont.systemFont(ofSize: 22, weight: .semibold), .foregroundColor: accent])
        }
    }
}
