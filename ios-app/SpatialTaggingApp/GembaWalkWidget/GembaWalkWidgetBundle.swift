// GembaWalkWidgetBundle.swift - G6: the widget extension entry point.
// Target: GembaWalkWidgetExtension (synchronized folder - every .swift in
// this folder is compiled into the extension). The only widget is the
// Gemba walk Live Activity.

import WidgetKit
import SwiftUI

@main
struct GembaWalkWidgetBundle: WidgetBundle {
    var body: some Widget {
        GembaWalkLiveActivity()
    }
}
