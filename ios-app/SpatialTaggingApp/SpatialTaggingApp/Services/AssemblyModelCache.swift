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

    private static func url(_ modelId: String, budget: Int? = nil) -> URL {
        dir.appendingPathComponent(budget.map { "\(modelId).\($0).glb" } ?? "\(modelId).glb")
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
        let u = url(modelId, budget: budget)
        if let data = try? Data(contentsOf: u, options: .mappedIfSafe), data.count > 20 {
            let meta = readMeta(u)
            return Fetched(data: data, variantBudget: meta.variantBudget, triangles: meta.triangles)
        }
        let dl = try await client.downloadModelGLB(id: modelId, budget: budget)
        guard dl.data.count > 20 else { throw AssemblyModelCacheError.empty }
        try? dl.data.write(to: u, options: .atomic)
        writeMeta(u, variantBudget: dl.variantBudget, triangles: dl.triangles)
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
