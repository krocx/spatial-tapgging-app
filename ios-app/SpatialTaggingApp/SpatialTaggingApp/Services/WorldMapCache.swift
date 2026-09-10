// WorldMapCache.swift — B1 (2026.4.46): one world-map loader for every AR surface.
//
// Doctrine: the AUTHOR's world map is the origin; the QR is the key and a drift
// check. Spatial Inspection (anchor maps) and AR Work Instructions (guide maps)
// now share this loader, so they cache, refresh and fall back the same way:
//
//   1. Ask SIB for the map's META (tiny JSON: capturedAt + origin pose).
//   2. If the local copy carries the same capturedAt → use it (no download).
//   3. Otherwise download the map and cache it beside its meta.
//   4. Offline / SIB down → use whatever is cached; nothing cached → nil
//      (caller starts a fresh session).
//
// Files: Documents/WorldMaps/<key>.worldmap + <key>.meta.json, where key is
// the anchorId (unchanged from the old gate cache) or "guide-<guideId>".
//
// Meta is the SAME shape for both scopes so the drift check can be one function:
//   anchor map  → anchorPose           (sealed QR pose in the map's frame)
//   guide map   → referenceCameraPose  (author's camera at the reference photo)

import Foundation
import simd

/// Wire/meta shape shared by `/anchors/:id/worldmap/meta` and `/worldmap/guide/:id/meta`.
struct WorldMapMeta: Codable, Equatable {
    var capturedAt:          String?
    var anchorPose:          [Float]?
    var referenceCameraPose: [Float]?
    var sealedBy:            String?
    var sealed:              Bool?
    /// B2: the detected object's pose in the guide map's frame.
    var objectPoseInMap:     [Float]?
    var objectCalibratedAt:  String?

    var anchorPoseTransform:          simd_float4x4? { ARCoordinateFrame.transform(from: anchorPose) }
    var referenceCameraPoseTransform: simd_float4x4? { ARCoordinateFrame.transform(from: referenceCameraPose) }
    var objectPoseInMapTransform:     simd_float4x4? { ARCoordinateFrame.transform(from: objectPoseInMap) }
}

// ── B2: reference-object cache ────────────────────────────────────────────────
// Same discipline as maps: meta first (scannedAt/calibratedAt), reuse the local
// archive when unchanged, otherwise download; offline uses the cached copy.
enum ReferenceObjectCache {
    struct Bundle { let archive: Data; let meta: AnchorObjectMeta; let source: WorldMapBundle.Source }

    static func load(anchorId: String, client: SIBClient) async -> Bundle? {
        let localMeta = loadLocalMeta(anchorId)
        let local     = loadLocal(anchorId)
        let remoteMeta: AnchorObjectMeta?
        do { remoteMeta = try await client.fetchAnchorObjectMeta(anchorId: anchorId) }
        catch { remoteMeta = nil }
        if let rm = remoteMeta {
            if let local, let lm = localMeta, lm.scannedAt == rm.scannedAt {
                return Bundle(archive: local, meta: rm, source: .local)   // meta may carry a newer calibration
            }
            do {
                guard let data = try await client.fetchAnchorObject(anchorId: anchorId) else { clear(anchorId); return nil }
                store(anchorId, archive: data, meta: rm)
                return Bundle(archive: data, meta: rm, source: .remote)
            } catch {
                if let local, let lm = localMeta { return Bundle(archive: local, meta: lm, source: .local) }
                return nil
            }
        }
        // Offline / meta failed: whatever is cached.
        if let local, let lm = localMeta { return Bundle(archive: local, meta: lm, source: .local) }
        return nil
    }

    static func store(_ anchorId: String, archive: Data, meta: AnchorObjectMeta) {
        guard let u = url(anchorId, "arobject"), let mu = url(anchorId, "object.json") else { return }
        try? archive.write(to: u, options: .atomic)
        if let m = try? JSONEncoder().encode(meta) { try? m.write(to: mu, options: .atomic) }
    }
    static func clear(_ anchorId: String) {
        for ext in ["arobject", "object.json"] { if let u = url(anchorId, ext) { try? FileManager.default.removeItem(at: u) } }
    }
    private static func loadLocal(_ id: String) -> Data? { url(id, "arobject").flatMap { try? Data(contentsOf: $0) } }
    private static func loadLocalMeta(_ id: String) -> AnchorObjectMeta? {
        guard let u = url(id, "object.json"), let d = try? Data(contentsOf: u) else { return nil }
        return try? JSONDecoder().decode(AnchorObjectMeta.self, from: d)
    }
    private static func url(_ id: String, _ ext: String) -> URL? {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let dir = docs.appendingPathComponent("Objects", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(id).\(ext)")
    }
}

struct WorldMapBundle {
    enum Source { case local, remote }
    let map:    Data
    let meta:   WorldMapMeta
    let source: Source
    /// Spatial Inspection: true when the author sealed the origin pose with the map.
    var isSealed: Bool { meta.anchorPose?.count == 16 }
}

enum WorldMapCache {

    enum Scope {
        case anchor(String)
        case guide(String)

        var key: String {
            switch self {
            case .anchor(let id): return id
            case .guide(let id):  return "guide-\(id)"
            }
        }
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    /// Map + meta for a scope, freshest copy we can get. Never throws: network
    /// trouble degrades to the local copy, then to nil.
    static func load(_ scope: Scope, client: SIBClient) async -> WorldMapBundle? {
        let local     = loadLocal(scope)
        let localMeta = loadLocalMeta(scope)

        // 1. Meta first — cheap, tells us whether the cache is current.
        let remoteMeta: WorldMapMeta?
        do {
            switch scope {
            case .anchor(let id): remoteMeta = try await client.fetchWorldMapMeta(anchorId: id)
            case .guide(let id):  remoteMeta = try await client.fetchGuideWorldMapMeta(guideId: id)
            }
        } catch {
            remoteMeta = nil
            print("[WorldMapCache] \(scope.key): meta fetch failed (\(error.localizedDescription)) — using local copy if any")
        }

        // 2. Cache hit: same capturedAt (or server has no meta and we have a map).
        if let local, let lm = localMeta, let rm = remoteMeta,
           let a = lm.capturedAt, let b = rm.capturedAt, a == b {
            print("[WorldMapCache] \(scope.key): local copy is current (\(local.count / 1024) KB)")
            return WorldMapBundle(map: local, meta: rm, source: .local)
        }
        if remoteMeta == nil, let local {
            return WorldMapBundle(map: local, meta: localMeta ?? WorldMapMeta(), source: .local)
        }

        // 3. Download.
        do {
            let data: Data?
            switch scope {
            case .anchor(let id): data = try await client.fetchWorldMap(anchorId: id)
            case .guide(let id):  data = try await client.fetchGuideWorldMap(guideId: id)
            }
            guard let data else {
                // 404: no map on the server. A stale local copy is worse than none
                // (its frame belongs to a map the author has since removed).
                clear(scope)
                return nil
            }
            let meta = remoteMeta ?? WorldMapMeta()
            store(scope, map: data, meta: meta)
            print("[WorldMapCache] \(scope.key): downloaded (\(data.count / 1024) KB)")
            return WorldMapBundle(map: data, meta: meta, source: .remote)
        } catch {
            print("[WorldMapCache] \(scope.key): download failed (\(error.localizedDescription))")
            if let local { return WorldMapBundle(map: local, meta: localMeta ?? WorldMapMeta(), source: .local) }
            return nil
        }
    }

    // ── Store / clear ─────────────────────────────────────────────────────────

    static func store(_ scope: Scope, map: Data, meta: WorldMapMeta) {
        guard let url = fileURL(scope, ext: "worldmap") else { return }
        do {
            try map.write(to: url, options: .atomic)
            if let m = try? JSONEncoder().encode(meta), let mu = fileURL(scope, ext: "meta.json") {
                try? m.write(to: mu, options: .atomic)
            }
            print("[WorldMapCache] \(scope.key): cached (\(map.count / 1024) KB)")
        } catch {
            print("[WorldMapCache] \(scope.key): local save failed: \(error.localizedDescription)")
        }
    }

    static func clear(_ scope: Scope) {
        for ext in ["worldmap", "meta.json"] {
            if let u = fileURL(scope, ext: ext) { try? FileManager.default.removeItem(at: u) }
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private static func loadLocal(_ scope: Scope) -> Data? {
        guard let url = fileURL(scope, ext: "worldmap") else { return nil }
        return try? Data(contentsOf: url)
    }

    private static func loadLocalMeta(_ scope: Scope) -> WorldMapMeta? {
        guard let url = fileURL(scope, ext: "meta.json"), let d = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WorldMapMeta.self, from: d)
    }

    private static func fileURL(_ scope: Scope, ext: String) -> URL? {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let dir = docs.appendingPathComponent("WorldMaps", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(scope.key).\(ext)")
    }
}
