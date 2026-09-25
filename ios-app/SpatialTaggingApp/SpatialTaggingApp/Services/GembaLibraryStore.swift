// GembaLibraryStore.swift - G4: the Audit Reference Library on the phone.
//
// One fetch per app launch (refreshed in the background on every walk start),
// cached in UserDefaults by `version` so the picker opens instantly and still
// works when the server is briefly unreachable mid-walk. Never throws into
// the UI: `library` is empty until the first successful load, and the form
// falls back to the legacy free-text finding when there is nothing to pick.

import Foundation
import Combine

@MainActor
final class GembaLibraryStore: ObservableObject {

    static let shared = GembaLibraryStore()

    @Published private(set) var library: GembaLibrary = .empty
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String? = nil

    private let cacheKey = "gemba_library_cache_v1"
    private var loadedAt: Date? = nil

    private init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let lib = try? JSONDecoder().decode(GembaLibrary.self, from: data) {
            library = lib
        }
    }

    var isEmpty: Bool { library.focusAreas.isEmpty }

    /// Refresh from SIB. Cheap to call often - skipped if fetched < 60 s ago
    /// unless `force`.
    func refresh(settings: AppSettings, force: Bool = false) async {
        if !force, let t = loadedAt, Date().timeIntervalSince(t) < 60 { return }
        guard settings.isConfigured, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let lib = try await SIBClient(settings: settings).fetchGembaLibrary()
            if lib.version != library.version || lib.focusAreas.count != library.focusAreas.count {
                library = lib
                if let data = try? JSONEncoder().encode(lib) { UserDefaults.standard.set(data, forKey: cacheKey) }
                AppLog.info("gemba", "library refreshed", ["areas": lib.focusAreas.count, "version": lib.version])
            }
            loadedAt = Date()
            lastError = nil
        } catch {
            lastError = friendlyMessage(for: error)
            AppLog.warn("gemba", "library refresh failed: \(lastError ?? "?")")
        }
    }
}
