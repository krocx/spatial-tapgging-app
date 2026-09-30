//
//  AssemblyModelCache.swift
//  SpatialTaggingApp
//
//  AR OJT - on-disk cache for assembly GLBs (4–25 MB each). Author placement
//  and every operator run would otherwise re-download the same file; on a
//  slow link that download is also the single most likely thing to fail, so
//  failures here carry the real reason (HTTP status / transport error) for
//  the UI instead of a generic "could not download".
//

import Foundation

enum AssemblyModelCache {

    private static var dir: URL {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("assembly-glb", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func url(_ modelId: String, budget: Int? = nil, revision: Int? = nil) -> URL {
        let rev = revision.map { ".r\($0)" } ?? ""
        return dir.appendingPathComponent(budget.map { "\(modelId)\(rev).\($0).glb" } ?? "\(modelId)\(rev).glb")
    }

    /// The server's current GLB revision, or nil when it cannot be asked
    /// (offline, older server) - then whatever is cached is used.
    private static func currentRevision(modelId: String, client: SIBClient) async -> Int? {
        (try? await client.fetchModel(id: modelId))?.glbRevision
    }

    /// One file per model: drop every cached copy of this model except the
    /// one just written (other revisions, and other budgets from a Settings
    /// override). A device keeps the copy it uses, never a collection.
    private static func evictOthers(modelId: String, keep: URL) {
        let fm = FileManager.default
        let keepName = keep.lastPathComponent
        for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] {
            let n = f.lastPathComponent
            guard n.hasPrefix(modelId + ".") else { continue }
            if n != keepName && n != keepName + ".meta" { try? fm.removeItem(at: f) }
        }
    }

    /// Newest cached file for this model and budget, any revision (offline fallback).
    private static func anyCached(modelId: String, budget: Int?) -> URL? {
        let fm = FileManager.default
        let suffix = budget.map { ".\($0).glb" } ?? ".glb"
        let files = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
            .filter { $0.lastPathComponent.hasPrefix(modelId + ".") && $0.lastPathComponent.hasSuffix(suffix) && !$0.lastPathComponent.hasSuffix(".meta") }
        return files.max { a, b in
            let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return da < db
        }
    }

    /// Cached bytes if present, else download (long timeout) and cache.
    /// Throws with a human-readable reason on failure.
    static func glb(modelId: String, client: SIBClient) async throws -> Data {
        try await glb(modelId: modelId, budget: nil, client: client).data
    }

    /// The model sized for this device (docs/ar-ojt/MODEL-VARIANTS.md): asks
    /// the server for `budget` triangles and caches whatever it answered with
    /// under that budget, so the device downloads a reduced copy once and
    /// never reduces it again. Without a budget, or against an older server,
    /// this is the full model as before.
    struct Fetched { let data: Data; let variantBudget: Int?; let triangles: Int? }
    static func glb(modelId: String, budget: Int?, client: SIBClient) async throws -> Fetched {
        // The cache is keyed on the server's GLB revision, so a model rewritten
        // in place (assembled-pose switch) is fetched again rather than served
        // from the old file. Unreachable server: the newest cached copy.
        let revision = await currentRevision(modelId: modelId, client: client)
        let u = revision.map { url(modelId, budget: budget, revision: $0) } ?? anyCached(modelId: modelId, budget: budget) ?? url(modelId, budget: budget)
        if let data = try? Data(contentsOf: u, options: .mappedIfSafe), data.count > 20 {
            let meta = readMeta(u)
            return Fetched(data: data, variantBudget: meta.variantBudget, triangles: meta.triangles)
        }
        let dl = try await client.downloadModelGLB(id: modelId, budget: budget)
        guard dl.data.count > 20 else { throw AssemblyModelCacheError.empty }
        let target = url(modelId, budget: budget, revision: revision)
        try? dl.data.write(to: target, options: .atomic)
        writeMeta(target, variantBudget: dl.variantBudget, triangles: dl.triangles)
        evictOthers(modelId: modelId, keep: target)
        return Fetched(data: dl.data, variantBudget: dl.variantBudget, triangles: dl.triangles)
    }

    // Sidecar: which variant a cached file is, so a cache hit logs the same as a download.
    private static func metaURL(_ u: URL) -> URL { u.appendingPathExtension("meta") }
    private static func writeMeta(_ u: URL, variantBudget: Int?, triangles: Int?) {
        let s = "\(variantBudget ?? -1) \(triangles ?? -1)"
        try? s.data(using: .utf8)?.write(to: metaURL(u), options: .atomic)
    }
    private static func readMeta(_ u: URL) -> (variantBudget: Int?, triangles: Int?) {
        guard let s = try? String(contentsOf: metaURL(u), encoding: .utf8) else { return (nil, nil) }
        let parts = s.split(separator: " ").compactMap { Int($0) }
        guard parts.count == 2 else { return (nil, nil) }
        return (parts[0] >= 0 ? parts[0] : nil, parts[1] >= 0 ? parts[1] : nil)
    }

    static func evict(modelId: String) {
        let fm = FileManager.default
        for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where f.lastPathComponent.hasPrefix(modelId + ".") {
            try? fm.removeItem(at: f)
        }
    }

    /// True when the error only says "the task was cancelled" - the caller went
    /// away, nothing to show the user.
    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let e = error as? SIBClientError, case .networkError(let inner) = e { return (inner as? URLError)?.code == .cancelled }
        return (error as? URLError)?.code == .cancelled
    }

    /// Reason text for the UI from any thrown error.
    static func reason(_ error: Error) -> String {
        if let e = error as? SIBClientError {
            switch e {
            case .httpError(let code, let msg): return code == 404 ? "The assembly model no longer exists on the server (\(msg)). Re-import the guide." : "Server said \(code): \(msg)"
            case .networkError(let inner):      return "Network: \(inner.localizedDescription)"
            default:                            return e.localizedDescription
            }
        }
        return error.localizedDescription
    }
}

enum AssemblyModelCacheError: Error, LocalizedError {
    case empty
    var errorDescription: String? { "The server returned an empty model file." }
}
