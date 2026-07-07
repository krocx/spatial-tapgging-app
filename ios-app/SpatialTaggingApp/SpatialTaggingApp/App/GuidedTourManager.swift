// GuidedTourManager.swift
// Drives the step-by-step interactive guided tour for first-time users.
// Injected as @EnvironmentObject from the app root so every participating view
// can read the current step and show its own coach mark.

import SwiftUI
import UIKit

// ── Tour steps ────────────────────────────────────────────────────────────────

enum TourStep: Int, CaseIterable {
    // Home screen
    case welcome            //  0: personalised welcome card
    case tapSettings        //  1: spotlight on ⚙️ gear button
    // Inside Settings sheet
    case selectServer       //  2: spotlight on server preset buttons
    case testConnection     //  3: spotlight on Test Connection button
    case saveSettings       //  4: spotlight on Save button
    // Back on home screen
    case tapAuthor          //  5: spotlight on Author Mode button
    // Inside Author flow
    case createAnchor       //  6: spotlight on + (new anchor) button
    case scanQRAuthor       //  7: banner — point camera at QR code
    case placeTag           //  8: banner — tap surface to place tag
    case trainTag           //  9: banner — tap Train on a placed tag
    // Back to home → Operator
    case tapOperator        // 10: spotlight on Operator Mode button
    // Inside Operator flow
    case scanQROperator     // 11: banner — scan anchor QR
    case runInspection      // 12: banner — walk to tags + validate
    // Finish
    case done               // 13: celebration card
}

// ── Step metadata ─────────────────────────────────────────────────────────────

extension TourStep {

    // Which screen renders this step's coach mark
    enum Screen {
        case home, settings, anchorDirectory, qrScan, authorMode, operatorMode
    }

    var screen: Screen {
        switch self {
        case .welcome, .tapSettings, .tapAuthor, .tapOperator, .done:
            return .home
        case .selectServer, .testConnection, .saveSettings:
            return .settings
        case .createAnchor:
            return .anchorDirectory
        case .scanQRAuthor, .scanQROperator:
            return .qrScan
        case .placeTag, .trainTag:
            return .authorMode
        case .runInspection:
            return .operatorMode
        }
    }

    /// True → render a spotlight cutout; False → render a floating card / banner.
    /// Toolbar buttons (.createAnchor) use banner mode because their CGRect is
    /// not reliably accessible through SwiftUI preference keys.
    var usesSpotlight: Bool {
        switch self {
        case .tapSettings, .selectServer, .testConnection,
             .saveSettings, .tapAuthor, .tapOperator:
            return true
        default:
            return false
        }
    }

    var sfIcon: String {
        switch self {
        case .welcome:                  return "hand.wave.fill"
        case .tapSettings:              return "gearshape.fill"
        case .selectServer:             return "server.rack"
        case .testConnection:           return "network"
        case .saveSettings:             return "checkmark.circle.fill"
        case .tapAuthor:                return "pencil.circle.fill"
        case .createAnchor:             return "plus.circle.fill"
        case .scanQRAuthor,
             .scanQROperator:           return "qrcode.viewfinder"
        case .placeTag:                 return "hand.tap.fill"
        case .trainTag:                 return "camera.viewfinder"
        case .tapOperator:              return "eye.circle.fill"
        case .runInspection:            return "scope"
        case .done:                     return "checkmark.seal.fill"
        }
    }

    var headline: String {
        switch self {
        case .welcome:        return ""   // built dynamically with device owner name
        case .tapSettings:    return "Open Settings"
        case .selectServer:   return "Choose Your Server"
        case .testConnection: return "Test the Connection"
        case .saveSettings:   return "Save & Close"
        case .tapAuthor:      return "Try Author Mode"
        case .createAnchor:   return "Create an Anchor"
        case .scanQRAuthor:   return "Scan the Anchor QR"
        case .placeTag:       return "Place a Tag"
        case .trainTag:       return "Train the Tag"
        case .tapOperator:    return "Now Try Operator Mode"
        case .scanQROperator: return "Scan the Anchor QR"
        case .runInspection:  return "Run Your First Inspection"
        case .done:           return "You're All Set! 🎉"
        }
    }

    var body: String {
        switch self {
        case .welcome:
            return ""
        case .tapSettings:
            return "First, let's point the app at your server.\nTap the ⚙️ Settings button."
        case .selectServer:
            return "Tap Internal Server or Render Server\nto auto-fill the connection details."
        case .testConnection:
            return "Tap Test Connection to verify the app\ncan reach your SIB server."
        case .saveSettings:
            return "All good! Tap Save to apply your settings\nand close."
        case .tapAuthor:
            return "You're connected! Now let's explore\nhow Authors create inspection tags."
        case .createAnchor:
            return "Tap the + button to create a new anchor,\nor select an existing one to continue."
        case .scanQRAuthor:
            return "Point your camera at the physical anchor\nQR code to lock the AR session origin."
        case .placeTag:
            return "Tap any flat surface on the equipment\nto place an inspection tag at that point."
        case .trainTag:
            return "Tap Train on a tag and walk around it,\ncapturing reference views from multiple angles."
        case .tapOperator:
            return "Great work in Author Mode! Now let's run\nan inspection as an Operator would in the field."
        case .scanQROperator:
            return "Scan the same anchor QR code.\nFloating tag markers will appear in AR."
        case .runInspection:
            return "Walk to each floating tag and step into\nthe cone — validation fires automatically."
        case .done:
            return "You've completed the full walkthrough.\nYou're ready to inspect for real."
        }
    }

    /// Button label for steps that require a manual tap to advance
    var nextLabel: String {
        switch self {
        case .done: return "Start Using the App"
        default:    return "Next →"
        }
    }
}

// ── Preference key — publishes screen-space frames of spotlight targets ───────

struct TourFrameKey: PreferenceKey {
    static var defaultValue: [TourStep: CGRect] = [:]
    static func reduce(value: inout [TourStep: CGRect],
                       nextValue: () -> [TourStep: CGRect]) {
        value.merge(nextValue()) { _, new in new }
    }
}

// ── Manager ───────────────────────────────────────────────────────────────────

@MainActor
final class GuidedTourManager: ObservableObject {

    @Published var currentStep: TourStep = .welcome
    @Published var isActive: Bool = false

    /// Device owner name extracted from UIDevice.current.name.
    /// "Karthik's iPhone" → "Karthik"; bare "iPhone" → "there".
    nonisolated var ownerName: String {
        let raw = UIDevice.current.name
        for sep in ["'s ", "\u{2019}s "] {           // straight + curly apostrophe
            if let range = raw.range(of: sep) {
                let candidate = String(raw[..<range.lowerBound])
                let deviceWords = ["iPhone", "iPad", "iPod", "Mac"]
                if !candidate.isEmpty && !deviceWords.contains(candidate) {
                    return candidate
                }
            }
        }
        return "there"
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    func start() {
        currentStep = .welcome
        withAnimation(.easeIn(duration: 0.3)) { isActive = true }
    }

    /// Move to the next step unconditionally.
    func advance() {
        guard isActive else { return }
        let nextRaw = currentStep.rawValue + 1
        if let next = TourStep(rawValue: nextRaw) {
            withAnimation(.spring(response: 0.38, dampingFraction: 0.80)) {
                currentStep = next
            }
        } else {
            finish()
        }
    }

    /// Advance only when we're currently ON the specified step.
    /// Safe to call from any action handler without order dependency.
    func advancePast(_ step: TourStep) {
        guard isActive, currentStep == step else { return }
        advance()
    }

    func skip() { finish() }

    private func finish() {
        withAnimation(.easeOut(duration: 0.25)) { isActive = false }
    }
}
