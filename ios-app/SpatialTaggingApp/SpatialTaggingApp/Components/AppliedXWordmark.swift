// AppliedXWordmark.swift - the brand signature (docs/BRAND.md)
//
// `appliedx`, lowercase: "applied" in the wordmark blue, "x" in the wordmark
// green. Always this view, never typed by hand, never one colour, never
// "AppliedX". The two colours belong to the wordmark alone. System font for
// now (the app does not bundle Open Sans); weight regular, tight tracking.

import SwiftUI

struct AppliedXWordmark: View {
    var size: CGFloat = 28

    // Trial (2026-10): 4495BC / 7AB800 on the app home page. If kept, move
    // the pair into --ax-wm-blue / --ax-wm-green (tokens.css + BRAND.md) so
    // the portal wordmark matches; the wordmark has one pair of colours.
    static let blue  = Color(red: 0x44 / 255, green: 0x95 / 255, blue: 0xBC / 255)
    static let green = Color(red: 0x7A / 255, green: 0xB8 / 255, blue: 0x00 / 255)

    var body: some View {
        (Text("applied").foregroundColor(Self.blue) + Text("x").foregroundColor(Self.green))
            .font(.system(size: size, weight: .regular))
            .kerning(-size * 0.01)
            .accessibilityLabel("applied x")
    }
}
