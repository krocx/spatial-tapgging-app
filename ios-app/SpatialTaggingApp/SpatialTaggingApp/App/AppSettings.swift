// AppSettings.swift
// Persistent user configuration stored in UserDefaults.

import Foundation
import UIKit

final class AppSettings: ObservableObject {

    @Published var sibBaseURL: String {
        didSet { UserDefaults.standard.set(sibBaseURL, forKey: "sib_base_url") }
    }

    /// X-API-Key sent on every SIB request.
    /// Leave empty for local dev (SIB ignores the header when SIB_API_KEY env var is unset).
    @Published var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: "sib_api_key") }
    }

    // ── Identity ──────────────────────────────────────────────────────────────

    /// Display name used as `createdBy` when creating anchors.
    /// Defaults to the first name extracted from the device name (e.g. "Karthik's iPhone" → "Karthik").
    /// Editable in Settings so users with generic device names can set a meaningful name.
    @Published var authorName: String {
        didSet { UserDefaults.standard.set(authorName, forKey: "author_name") }
    }

    /// Every previous authorName this installation has used.
    /// Anchors tagged with any of these names still appear under "My Anchors" after a rename,
    /// avoiding orphaned anchors without requiring a server-side migration.
    @Published var previousAuthorNames: [String] {
        didSet {
            if let data = try? JSONEncoder().encode(previousAuthorNames) {
                UserDefaults.standard.set(data, forKey: "previous_author_names")
            }
        }
    }

    /// True once the user has explicitly saved Settings at least once, confirming
    /// (or updating) the auto-detected author name. Drives the home-screen nudge.
    @Published var authorNameConfirmed: Bool {
        didSet { UserDefaults.standard.set(authorNameConfirmed, forKey: "author_name_confirmed") }
    }

    /// Current name plus all previous names — kept for display purposes
    /// (the "by [name]" caption in Shared rows). Not used for filtering.
    var allKnownNames: [String] {
        ([authorName] + previousAuthorNames).filter { !$0.isEmpty }
    }

    /// IDs of anchors created on THIS device. Used as the authoritative
    /// My Anchors / Shared split — more reliable than name matching because
    /// it survives renames and doesn't break when authorName drifts between
    /// creation and display time. Clears only if app data is wiped.
    @Published var myAnchorIds: Set<String> {
        didSet {
            if let data = try? JSONEncoder().encode(Array(myAnchorIds)) {
                UserDefaults.standard.set(data, forKey: "my_anchor_ids")
            }
        }
    }

    /// When true, the Anchor Directory shows a "Shared" section containing anchors
    /// created by other users and legacy anchors with no createdBy.
    /// Toggle in Settings; defaults to true so nothing disappears unexpectedly on upgrade.
    @Published var showSharedAnchors: Bool {
        didSet { UserDefaults.standard.set(showSharedAnchors, forKey: "show_shared_anchors") }
    }

    // ── First Time User Experience ────────────────────────────────────────────

    /// When true the onboarding walkthrough auto-shows on first entry to each mode.
    /// Users can disable auto-show in Settings; the ? Help button always works regardless.
    @Published var ftueEnabled: Bool {
        didSet { UserDefaults.standard.set(ftueEnabled, forKey: "ftue_enabled") }
    }

    /// Per-mode seen flags — set true the moment the auto-show fires so it won't repeat.
    @Published var ftueHomeSeen: Bool {
        didSet { UserDefaults.standard.set(ftueHomeSeen, forKey: "ftue_home_seen") }
    }
    @Published var ftueAuthorSeen: Bool {
        didSet { UserDefaults.standard.set(ftueAuthorSeen, forKey: "ftue_author_seen") }
    }
    @Published var ftueOperatorSeen: Bool {
        didSet { UserDefaults.standard.set(ftueOperatorSeen, forKey: "ftue_operator_seen") }
    }
    @Published var ftueGembaAuthorSeen: Bool {
        didSet { UserDefaults.standard.set(ftueGembaAuthorSeen, forKey: "ftue_gemba_author_seen") }
    }
    @Published var ftueGembaOperatorSeen: Bool {
        didSet { UserDefaults.standard.set(ftueGembaOperatorSeen, forKey: "ftue_gemba_operator_seen") }
    }
    @Published var ftueGuideOperatorSeen: Bool {
        didSet { UserDefaults.standard.set(ftueGuideOperatorSeen, forKey: "ftue_guide_operator_seen") }
    }

    /// Resets all seen flags so the auto-show fires again on next entry to each mode.
    func resetFTUE() {
        ftueHomeSeen            = false
        ftueAuthorSeen          = false
        ftueOperatorSeen        = false
        ftueGembaAuthorSeen     = false
        ftueGembaOperatorSeen   = false
        ftueGuideOperatorSeen   = false
    }

    // ── Guided Tour ──────────────────────────────────────────────────────────

    /// When true the interactive spotlight tour auto-starts on first launch.
    @Published var guidedTourEnabled: Bool {
        didSet { UserDefaults.standard.set(guidedTourEnabled, forKey: "guided_tour_enabled") }
    }

    /// Set to true once the tour has been seen (so it doesn't auto-start again).
    @Published var guidedTourSeen: Bool {
        didSet { UserDefaults.standard.set(guidedTourSeen, forKey: "guided_tour_seen") }
    }

    func resetGuidedTour() {
        guidedTourSeen = false
    }

    init() {
        sibBaseURL = UserDefaults.standard.string(forKey: "sib_base_url") ?? ""
        apiKey     = UserDefaults.standard.string(forKey: "sib_api_key")  ?? ""

        // Author name: use stored value if set; otherwise extract first name from device name
        // e.g. "Karthik's iPhone" → "Karthik", bare "iPhone" → full device name as fallback
        if let stored = UserDefaults.standard.string(forKey: "author_name"), !stored.isEmpty {
            authorName = stored
        } else {
            let raw = UIDevice.current.name
            var derived = ""
            for sep in ["'s ", "\u{2019}s "] {
                if let range = raw.range(of: sep) {
                    let candidate = String(raw[..<range.lowerBound])
                    let deviceWords = ["iPhone", "iPad", "iPod", "Mac"]
                    if !candidate.isEmpty && !deviceWords.contains(candidate) {
                        derived = candidate
                        break
                    }
                }
            }
            authorName = derived.isEmpty ? raw : derived
        }

        if let data = UserDefaults.standard.data(forKey: "previous_author_names"),
           let names = try? JSONDecoder().decode([String].self, from: data) {
            previousAuthorNames = names
        } else {
            previousAuthorNames = []
        }
        authorNameConfirmed = UserDefaults.standard.bool(forKey: "author_name_confirmed")

        if let data = UserDefaults.standard.data(forKey: "my_anchor_ids"),
           let ids = try? JSONDecoder().decode([String].self, from: data) {
            myAnchorIds = Set(ids)
        } else {
            myAnchorIds = []
        }

        showSharedAnchors = (UserDefaults.standard.object(forKey: "show_shared_anchors") as? Bool) ?? true
        // ftueEnabled defaults to true on first launch (no key in UserDefaults yet)
        ftueEnabled           = (UserDefaults.standard.object(forKey: "ftue_enabled") as? Bool) ?? true
        ftueHomeSeen          = UserDefaults.standard.bool(forKey: "ftue_home_seen")
        ftueAuthorSeen        = UserDefaults.standard.bool(forKey: "ftue_author_seen")
        ftueOperatorSeen      = UserDefaults.standard.bool(forKey: "ftue_operator_seen")
        ftueGembaAuthorSeen   = UserDefaults.standard.bool(forKey: "ftue_gemba_author_seen")
        ftueGembaOperatorSeen = UserDefaults.standard.bool(forKey: "ftue_gemba_operator_seen")
        ftueGuideOperatorSeen = UserDefaults.standard.bool(forKey: "ftue_guide_operator_seen")
        guidedTourEnabled = (UserDefaults.standard.object(forKey: "guided_tour_enabled") as? Bool) ?? true
        guidedTourSeen    = UserDefaults.standard.bool(forKey: "guided_tour_seen")
    }

    /// True when the user has entered a non-empty SIB URL
    var isConfigured: Bool { !sibBaseURL.trimmingCharacters(in: .whitespaces).isEmpty }

    /// Base URL with no trailing slash
    var normalizedBaseURL: String {
        sibBaseURL.trimmingCharacters(in: .init(charactersIn: "/ "))
    }
}
