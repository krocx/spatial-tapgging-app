// GembaWalkWidgetBundle.swift — G6: the widget extension entry point.
// Target: GembaWalkWidget (Widget Extension). See XCODE-SETUP.md.

import WidgetKit
import SwiftUI

@main
struct GembaWalkWidgetBundle: WidgetBundle {
    var body: some Widget {
        GembaWalkLiveActivity()
    }
}
