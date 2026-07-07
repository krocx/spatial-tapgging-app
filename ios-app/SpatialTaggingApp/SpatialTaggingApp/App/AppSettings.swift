// AppSettings.swift
// Persistent user configuration stored in UserDefaults.

import Foundation

final class AppSettings: ObservableObject {

    @Published var sibBaseURL: String {
        didSet { UserDefaults.standard.set(sibBaseURL, forKey: "sib_base_url") }
    }

    @Published var defaultAssetId: String {
        didSet { UserDefaults.standard.set(defaultAssetId, forKey: "default_asset_id") }
    }

    /// X-API-Key sent on every SIB request.
    /// Leave empty for local dev (SIB ignores the header when SIB_API_KEY env var is unset).
    @Published var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: "sib_api_key") }
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

    /// Resets all seen flags so the auto-show fires again on next entry to each mode.
    func resetFTUE() {
        ftueHomeSeen     = false
        ftueAuthorSeen   = false
        ftueOperatorSeen = false
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
        sibBaseURL     = UserDefaults.standard.string(forKey: "sib_base_url")     ?? ""
        defaultAssetId = UserDefaults.standard.string(forKey: "default_asset_id") ?? ""
        apiKey         = UserDefaults.standard.string(forKey: "sib_api_key")      ?? ""
        // ftueEnabled defaults to true on first launch (no key in UserDefaults yet)
        ftueEnabled      = (UserDefaults.standard.object(forKey: "ftue_enabled")       as? Bool) ?? true
        ftueHomeSeen     = UserDefaults.standard.bool(forKey: "ftue_home_seen")
        ftueAuthorSeen   = UserDefaults.standard.bool(forKey: "ftue_author_seen")
        ftueOperatorSeen = UserDefaults.standard.bool(forKey: "ftue_operator_seen")
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
