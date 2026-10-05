// AppliedXWordmark.swift - the brand signature (docs/BRAND.md)
//
// `appliedx`, lowercase: "applied" in the wordmark blue, "x" in the wordmark
// green. Always this view, never typed by hand, never one colour, never
// "AppliedX". The two colours belong to the wordmark alone. System font for
// now (the app does not bundle Open Sans); weight regular, tight tracking.

import SwiftUI

struct AppliedXWordmark: View {
    var size: CGFloat = 28

    static let blue  = Color(red: 0x66 / 255, green: 0xB3 / 255, blue: 0xFF / 255)   // --ax-wm-blue
    static let green = Color(red: 0x35 / 255, green: 0xC6 / 255, blue: 0x35 / 255)   // --ax-wm-green

    var body: some View {
        (Text("applied").foregroundColor(Self.blue) + Text("x").foregroundColor(Self.green))
            .font(.system(size: size, weight: .regular))
            .kerning(-size * 0.01)
            .accessibilityLabel("applied x")
    }
}
