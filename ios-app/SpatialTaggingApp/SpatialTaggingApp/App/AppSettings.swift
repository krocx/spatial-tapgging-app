// AppSettings.swift — Phase 2.5
// Persistent user configuration (SIB URL, API key, default asset ID) stored in UserDefaults.

import Foundation

final class AppSettings: ObservableObject {

    @Published var sibBaseURL: String {
        didSet { UserDefaults.standard.set(sibBaseURL, forKey: "sib_base_url") }
    }

    @Published var defaultAssetId: String {
        didSet { UserDefaults.standard.set(defaultAssetId, forKey: "default_asset_id") }
    }

    /// Phase 2.5: X-API-Key sent on every SIB request.
    /// Leave empty for local dev (SIB ignores the header when SIB_API_KEY env var is unset).
    @Published var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: "sib_api_key") }
    }

    init() {
        sibBaseURL     = UserDefaults.standard.string(forKey: "sib_base_url")     ?? ""
        defaultAssetId = UserDefaults.standard.string(forKey: "default_asset_id") ?? ""
        apiKey         = UserDefaults.standard.string(forKey: "sib_api_key")      ?? ""
    }

    /// True when the user has entered a non-empty SIB URL
    var isConfigured: Bool { !sibBaseURL.trimmingCharacters(in: .whitespaces).isEmpty }

    /// Base URL with no trailing slash
    var normalizedBaseURL: String {
        sibBaseURL.trimmingCharacters(in: .init(charactersIn: "/ "))
    }
}
