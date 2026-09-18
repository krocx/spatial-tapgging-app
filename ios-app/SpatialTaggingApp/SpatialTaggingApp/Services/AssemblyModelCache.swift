//
//  AssemblyModelCache.swift
//  SpatialTaggingApp
//
//  AR OJT — on-disk cache for assembly GLBs (4–25 MB each). Author placement
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

    private static func url(_ modelId: String) -> URL { dir.appendingPathComponent("\(modelId).glb") }

    /// Cached bytes if present, else download (long timeout) and cache.
    /// Throws with a human-readable reason on failure.
    static func glb(modelId: String, client: SIBClient) async throws -> Data {
        let u = url(modelId)
        if let data = try? Data(contentsOf: u, options: .mappedIfSafe), data.count > 20 { return data }
        let data = try await client.downloadModelGLB(id: modelId)
        guard data.count > 20 else { throw AssemblyModelCacheError.empty }
        try? data.write(to: u, options: .atomic)
        return data
    }

    static func evict(modelId: String) { try? FileManager.default.removeItem(at: url(modelId)) }

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
