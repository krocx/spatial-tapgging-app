//
//  GLBLoader.swift
//  SpatialTaggingApp
//
//  AR OJT slice 2 - our own glTF 2.0 binary reader → SceneKit.
//
//  Why not USDZ: the portal's USDZ export renames every node ("Object_123"),
//  so per-part show/hide/animate cannot address the assembly's parts. The GLB
//  that SIB's Cortona3D importer writes is a deliberately small subset -
//  nodes with names + a 4x4 matrix (or TRS), POSITION + indices, a base-colour
//  material - and this loader reads exactly that subset, preserving node
//  names (`cmp:<part>`) and glTF `extras` (part number / description).
//  Anything outside the subset (textures, skins, animations, sparse accessors)
//  is ignored rather than failing, and any GLB we did not write is handled the
//  same way; callers fall back to the USDZ path when `parts` comes back empty.
//
//  Normals: the GLB carries none. Small models are un-indexed with flat
//  normals so CAD edges stay crisp; anything larger stays INDEXED with
//  area-weighted vertex normals - a third of the vertices and no temporary
//  arrays of SCNVector3, which is the difference between a 185-step Cortona
//  assembly playing on an iPhone and the app being killed for memory.
//
//  Budget (2026.4.46): every device has a triangle budget from its memory;
//  a model over budget is reduced on the way in by our own vertex-clustering
//  decimation (grid cells, cluster average, degenerate faces dropped) until it
//  fits. The load reports what it did so the session can say so.
//
//  Apple SDKs only (Foundation, SceneKit, simd). No third-party code.
//

import Foundation
import SceneKit
import simd
import UIKit

/// Result of loading an assembly GLB.
struct GLBAssembly {
    /// Root node; add it to the scene. Node names are preserved.
    let root:      SCNNode
    /// Named part nodes (`cmp:*`) by name.
    let parts:     [String: SCNNode]
    /// glTF `extras` per node name (partNumber, description, displayName, objectID…).
    let extras:    [String: [String: Any]]
    /// Local-frame rest transform per part (before any step delta), by name.
    let restTransforms: [String: simd_float4x4]
    let meshCount:     Int
    let triangleCount: Int
    /// Bounds in the assembly frame (root-local), if any geometry.
    let bounds:    (min: simd_float3, max: simd_float3)?
    /// What the loader had to do to fit the device.
    let info:      GLBLoadInfo
}

struct GLBLoadInfo {
    /// Triangles in the file (instances counted once per node reference).
    var sourceTriangles: Int = 0
    /// Triangles actually built.
    var loadedTriangles: Int = 0
    var budget: Int = 0
    var reduced: Bool { loadedTriangles < sourceTriangles }
    var flatShaded: Bool = false
    var seconds: Double = 0
    var summary: String {
        let m = { (n: Int) in n >= 1_000_000 ? String(format: "%.1fM", Double(n) / 1e6) : n >= 1000 ? "\(n / 1000)k" : "\(n)" }
        return reduced ? "\(m(sourceTriangles)) triangles, reduced to \(m(loadedTriangles)) for this device"
                       : "\(m(loadedTriangles)) triangles"
    }
}

struct GLBLoadOptions {
    /// Triangles this device renders comfortably in an AR session alongside a world map.
    var triangleBudget: Int
    /// Up to this many triangles the model is un-indexed with flat normals (crisp CAD edges).
    var flatShadingUpTo: Int = 150_000
    /// 0…1 while parsing, building and (if needed) reducing.
    var progress: (@Sendable (Double) -> Void)? = nil

    /// Memory is the honest proxy: a world map, the camera and SceneKit share it.
    static func forThisDevice() -> GLBLoadOptions {
        let gb = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        let budget = gb >= 12 ? 2_500_000 : gb >= 7.5 ? 1_200_000 : gb >= 5.5 ? 700_000 : 350_000
        return GLBLoadOptions(triangleBudget: budget)
    }
}

enum GLBLoaderError: Error, LocalizedError {
    case notGLB, malformed(String)
    var errorDescription: String? {
        switch self {
        case .notGLB:             return "Not a GLB file"
        case .malformed(let why): return "Malformed GLB: \(why)"
        }
    }
}

enum GLBLoader {

    // MARK: - Public

    static func load(url: URL, options: GLBLoadOptions = .forThisDevice()) throws -> GLBAssembly {
        try load(data: try Data(contentsOf: url, options: .mappedIfSafe), options: options)
    }

    static func load(data: Data, options: GLBLoadOptions = .forThisDevice()) throws -> GLBAssembly {
        // Header: magic 'glTF', version 2, total length; then chunks (JSON, BIN).
        guard data.count >= 20, data.readUInt32(at: 0) == 0x46546C67 else { throw GLBLoaderError.notGLB }
        guard data.readUInt32(at: 4) == 2 else { throw GLBLoaderError.malformed("unsupported GLB version") }
        var offset = 12
        var jsonData: Data?; var bin: Data?
        while offset + 8 <= data.count {
            let len  = Int(data.readUInt32(at: offset))
            let type = data.readUInt32(at: offset + 4)
            let start = offset + 8
            guard start + len <= data.count else { throw GLBLoaderError.malformed("chunk overruns file") }
            let chunk = data.subdata(in: start ..< start + len)
            if type == 0x4E4F534A { jsonData = chunk } else if type == 0x004E4942 { bin = chunk }
            offset = start + len
        }
        guard let jd = jsonData,
              let json = try JSONSerialization.jsonObject(with: jd) as? [String: Any] else {
            throw GLBLoaderError.malformed("no JSON chunk")
        }
        return try build(json: json, bin: bin ?? Data(), options: options)
    }

    // MARK: - Build

    private static func build(json: [String: Any], bin: Data, options: GLBLoadOptions) throws -> GLBAssembly {
        let t0 = Date()
        var info = GLBLoadInfo(); info.budget = options.triangleBudget
        let bufferViews = json["bufferViews"] as? [[String: Any]] ?? []
        let accessors   = json["accessors"]   as? [[String: Any]] ?? []
        let meshesJ     = json["meshes"]      as? [[String: Any]] ?? []
        let materialsJ  = json["materials"]   as? [[String: Any]] ?? []
        let nodesJ      = json["nodes"]       as? [[String: Any]] ?? []
        let scenesJ     = json["scenes"]      as? [[String: Any]] ?? []
        let sceneIdx    = json["scene"] as? Int ?? 0

        // Materials - one SCNMaterial per glTF material, cloned per part later
        // so highlight/ghost changes stay local to a part.
        let materials: [SCNMaterial] = materialsJ.map { m in
            let mat = SCNMaterial()
            mat.lightingModel = .physicallyBased
            var rgba: [Double] = [0.8, 0.8, 0.8, 1]
            if let pbr = m["pbrMetallicRoughness"] as? [String: Any] {
                if let f = pbr["baseColorFactor"] as? [Double], f.count == 4 { rgba = f }
                mat.metalness.contents = pbr["metallicFactor"] as? Double ?? 0.1
                mat.roughness.contents = pbr["roughnessFactor"] as? Double ?? 0.8
            }
            mat.diffuse.contents = UIColor(red: rgba[0], green: rgba[1], blue: rgba[2], alpha: 1)
            mat.transparency = rgba[3]
            mat.transparencyMode = .aOne
            mat.blendMode = .alpha
            mat.isDoubleSided = (m["doubleSided"] as? Bool) ?? true
            mat.writesToDepthBuffer = true; mat.readsFromDepthBuffer = true
            return mat
        }
        let fallbackMaterial: SCNMaterial = {
            let mat = SCNMaterial(); mat.lightingModel = .physicallyBased
            mat.diffuse.contents = UIColor(white: 0.8, alpha: 1); mat.metalness.contents = 0.1; mat.roughness.contents = 0.8
            mat.isDoubleSided = true; return mat
        }()

        // Census first: how many triangles will this scene draw? (instances count
        // once per reference). Decides flat vs indexed and whether to reduce.
        let sceneIdx0   = json["scene"] as? Int ?? 0
        var meshRefs: [Int: Int] = [:]
        func census(_ i: Int, _ seen: inout Set<Int>) {
            guard i < nodesJ.count, !seen.contains(i) else { return }; seen.insert(i)
            if let mi = nodesJ[i]["mesh"] as? Int { meshRefs[mi, default: 0] += 1 }
            for c in nodesJ[i]["children"] as? [Int] ?? [] { census(c, &seen) }
        }
        var seen = Set<Int>()
        for r in (sceneIdx0 < scenesJ.count ? scenesJ[sceneIdx0]["nodes"] as? [Int] : nil) ?? Array(nodesJ.indices) { census(r, &seen) }
        func primTriangles(_ p: [String: Any]) -> Int {
            if let ia = p["indices"] as? Int, ia < accessors.count { return (accessors[ia]["count"] as? Int ?? 0) / 3 }
            if let attrs = p["attributes"] as? [String: Any], let pa = attrs["POSITION"] as? Int, pa < accessors.count { return (accessors[pa]["count"] as? Int ?? 0) / 3 }
            return 0
        }
        for (mi, refs) in meshRefs where mi < meshesJ.count {
            for p in meshesJ[mi]["primitives"] as? [[String: Any]] ?? [] where (p["mode"] as? Int ?? 4) == 4 { info.sourceTriangles += primTriangles(p) * refs }
        }
        let flat = info.sourceTriangles <= options.flatShadingUpTo
        info.flatShaded = flat
        // Reduction factor: keep everything under budget; every mesh is reduced
        // by the same ratio so parts keep their relative detail.
        let ratio = info.sourceTriangles > options.triangleBudget ? Double(options.triangleBudget) / Double(info.sourceTriangles) : 1
        var trianglesSoFar = 0
        options.progress?(0.05)

        // Meshes - built once, geometry shared between nodes that reference the same mesh.
        var geometryCache: [Int: [SCNGeometry]] = [:]
        var meshCount = 0, triangleCount = 0
        func geometries(forMesh mi: Int) throws -> [SCNGeometry] {
            if let g = geometryCache[mi] { return g }
            guard mi < meshesJ.count, let prims = meshesJ[mi]["primitives"] as? [[String: Any]] else { return [] }
            var out: [SCNGeometry] = []
            for p in prims {
                let mode = p["mode"] as? Int ?? 4
                guard mode == 4,
                      let attrs = p["attributes"] as? [String: Any],
                      let posAcc = attrs["POSITION"] as? Int else { continue }
                let positions = try readFloat3(accessorIndex: posAcc, accessors: accessors, views: bufferViews, bin: bin)
                var indices: [UInt32]
                if let ia = p["indices"] as? Int {
                    indices = try readIndices(accessorIndex: ia, accessors: accessors, views: bufferViews, bin: bin)
                } else {
                    indices = (0 ..< UInt32(positions.count)).map { $0 }
                }
                var triCount = indices.count / 3
                guard triCount > 0 else { continue }
                var geo: SCNGeometry
                if flat {
                    geo = flatGeometry(positions: positions, indices: indices)
                } else {
                    var pos = positions, idx = indices
                    if ratio < 1 { (pos, idx) = decimate(positions: pos, indices: idx, keep: ratio) }
                    triCount = idx.count / 3
                    guard triCount > 0 else { continue }
                    geo = indexedGeometry(positions: pos, indices: idx)
                }
                trianglesSoFar += triCount
                if info.sourceTriangles > 0 { options.progress?(0.05 + 0.85 * min(1, Double(trianglesSoFar) / Double(max(1, Int(Double(info.sourceTriangles) * ratio))))) }
                let mi2 = p["material"] as? Int
                geo.materials = [(mi2 != nil && mi2! < materials.count) ? materials[mi2!] : fallbackMaterial]
                out.append(geo)
                meshCount += 1; triangleCount += triCount
            }
            geometryCache[mi] = out
            return out
        }

        // Nodes
        var parts: [String: SCNNode] = [:]
        var extras: [String: [String: Any]] = [:]
        var rest: [String: simd_float4x4] = [:]
        var built: [Int: SCNNode] = [:]
        var bmin = simd_float3(repeating: .greatestFiniteMagnitude), bmax = simd_float3(repeating: -.greatestFiniteMagnitude)
        var anyGeometry = false

        func buildNode(_ i: Int, parentWorld: simd_float4x4) throws -> SCNNode {
            if let n = built[i] { return n }
            guard i < nodesJ.count else { throw GLBLoaderError.malformed("node index \(i) out of range") }
            let nj = nodesJ[i]
            let node = SCNNode()
            let name = nj["name"] as? String ?? "node\(i)"
            node.name = name
            let local = localMatrix(nj)
            node.simdTransform = local
            let world = parentWorld * local
            // Every named node is addressable as a part (2026.4.46): Cortona
            // exports use `cmp:<part>`, designer-picked CAD exports use whatever
            // the CAD tool named the node - the Procedure Designer lists the
            // same names from the GLB, so they always agree.
            // Unnamed nodes get the same `node<i>` name the server's part tree
            // uses, so a hidden root reaches the app under one name.
            parts[name] = node; rest[name] = local
            if let ex = nj["extras"] as? [String: Any] { extras[name] = ex }
            if let mi = nj["mesh"] as? Int {
                let geos = try geometries(forMesh: mi)
                if geos.count == 1 {
                    node.geometry = geos[0]
                } else {
                    for (k, g) in geos.enumerated() { let c = SCNNode(geometry: g); c.name = "\(name)#\(k)"; node.addChildNode(c) }
                }
                for g in geos {
                    // bounds in the assembly frame
                    let (lo, hi) = g.boundingBox
                    for corner in [lo, hi] {
                        let w = world * simd_float4(Float(corner.x), Float(corner.y), Float(corner.z), 1)
                        bmin = simd_min(bmin, simd_float3(w.x, w.y, w.z)); bmax = simd_max(bmax, simd_float3(w.x, w.y, w.z))
                    }
                    anyGeometry = true
                }
            }
            for c in nj["children"] as? [Int] ?? [] { node.addChildNode(try buildNode(c, parentWorld: world)) }
            built[i] = node
            return node
        }

        let root = SCNNode(); root.name = "assembly"
        let rootIds = (sceneIdx < scenesJ.count ? scenesJ[sceneIdx]["nodes"] as? [Int] : nil) ?? Array(nodesJ.indices)
        for r in rootIds { root.addChildNode(try buildNode(r, parentWorld: matrix_identity_float4x4)) }

        // Per-part material instances: clone so a highlight on one part never
        // bleeds into another part sharing the same glTF material.
        for (_, p) in parts {
            p.enumerateHierarchy { n, _ in
                guard let g = n.geometry else { return }
                g.materials = g.materials.map { $0.copy() as! SCNMaterial }
            }
        }

        info.loadedTriangles = triangleCount
        info.seconds = Date().timeIntervalSince(t0)
        options.progress?(1)
        AppLog.info("model", String(format: "[GLBLoader] parts=%d meshes=%d tris=%d (source %d, budget %d, %@) in %.1f s",
                                    parts.count, meshCount, triangleCount, info.sourceTriangles, info.budget, flat ? "flat" : "indexed", info.seconds))
        return GLBAssembly(root: root, parts: parts, extras: extras, restTransforms: rest,
                           meshCount: meshCount, triangleCount: triangleCount,
                           bounds: anyGeometry ? (bmin, bmax) : nil, info: info)
    }

    // MARK: - Geometry builders (no SCNVector3 arrays - straight into buffers)

    /// Small models: un-indexed, one flat normal per face - crisp CAD edges.
    private static func flatGeometry(positions: [simd_float3], indices: [UInt32]) -> SCNGeometry {
        let triCount = indices.count / 3
        var v = [Float](); v.reserveCapacity(triCount * 9)
        var n = [Float](); n.reserveCapacity(triCount * 9)
        for t in 0 ..< triCount {
            let i0 = Int(indices[t * 3]), i1 = Int(indices[t * 3 + 1]), i2 = Int(indices[t * 3 + 2])
            guard i0 < positions.count, i1 < positions.count, i2 < positions.count else { continue }
            let a = positions[i0], b = positions[i1], c = positions[i2]
            var fn = simd_cross(b - a, c - a)
            let len = simd_length(fn); fn = len > 1e-12 ? fn / len : simd_float3(0, 1, 0)
            for q in [a, b, c] { v.append(q.x); v.append(q.y); v.append(q.z); n.append(fn.x); n.append(fn.y); n.append(fn.z) }
        }
        let count = v.count / 3
        let vsrc = SCNGeometrySource(data: v.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .vertex, vectorCount: count,
                                     usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let nsrc = SCNGeometrySource(data: n.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .normal, vectorCount: count,
                                     usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        var idx = [UInt32](); idx.reserveCapacity(count); for i in 0 ..< UInt32(count) { idx.append(i) }
        let elem = SCNGeometryElement(data: idx.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles,
                                      primitiveCount: count / 3, bytesPerIndex: 4)
        return SCNGeometry(sources: [vsrc, nsrc], elements: [elem])
    }

    /// Large models: indexed, area-weighted vertex normals (CAD exports keep
    /// hard edges as split vertices, so creases survive; shared vertices smooth).
    private static func indexedGeometry(positions: [simd_float3], indices: [UInt32]) -> SCNGeometry {
        let n = positions.count
        var acc = [simd_float3](repeating: .zero, count: n)
        let triCount = indices.count / 3
        for t in 0 ..< triCount {
            let i0 = Int(indices[t * 3]), i1 = Int(indices[t * 3 + 1]), i2 = Int(indices[t * 3 + 2])
            guard i0 < n, i1 < n, i2 < n else { continue }
            let fn = simd_cross(positions[i1] - positions[i0], positions[i2] - positions[i0])   // area-weighted
            acc[i0] += fn; acc[i1] += fn; acc[i2] += fn
        }
        var v = [Float](); v.reserveCapacity(n * 3)
        var nn = [Float](); nn.reserveCapacity(n * 3)
        for i in 0 ..< n {
            let p = positions[i]; v.append(p.x); v.append(p.y); v.append(p.z)
            let l = simd_length(acc[i]); let q = l > 1e-12 ? acc[i] / l : simd_float3(0, 1, 0)
            nn.append(q.x); nn.append(q.y); nn.append(q.z)
        }
        let vsrc = SCNGeometrySource(data: v.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .vertex, vectorCount: n,
                                     usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let nsrc = SCNGeometrySource(data: nn.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .normal, vectorCount: n,
                                     usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let elem: SCNGeometryElement
        if n < 65_536 {
            let i16 = indices.map { UInt16($0) }
            elem = SCNGeometryElement(data: i16.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: triCount, bytesPerIndex: 2)
        } else {
            elem = SCNGeometryElement(data: indices.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: triCount, bytesPerIndex: 4)
        }
        return SCNGeometry(sources: [vsrc, nsrc], elements: [elem])
    }

    // MARK: - Decimation (own code): vertex clustering on a grid

    /// Reduce a mesh to about `keep` of its triangles: vertices in the same grid
    /// cell collapse to their average, faces that lose a corner are dropped.
    /// Coarsens the grid until the target is met (a few passes at most).
    /// Silhouettes and large faces survive; tiny detail (thread, chamfers) goes -
    /// exactly what a device over budget cannot show anyway.
    static func decimate(positions: [simd_float3], indices: [UInt32], keep: Double) -> ([simd_float3], [UInt32]) {
        let triCount = indices.count / 3
        let target = max(12, Int(Double(triCount) * keep))
        guard triCount > target, positions.count > 8 else { return (positions, indices) }
        var lo = simd_float3(repeating: .greatestFiniteMagnitude), hi = simd_float3(repeating: -.greatestFiniteMagnitude)
        for p in positions { lo = simd_min(lo, p); hi = simd_max(hi, p) }
        let ext = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 1e-6)
        // Cells per axis from the target: a surface's triangle count grows with k².
        var k = max(4.0, (Double(target) * 0.9).squareRoot())
        var best: ([simd_float3], [UInt32]) = (positions, indices)
        for _ in 0 ..< 6 {
            let cell = ext / Float(k)
            var cellOf = [Int32](repeating: -1, count: positions.count)
            var map: [Int64: Int32] = [:]
            var sums: [simd_float3] = [], counts: [Int32] = []
            for (i, p) in positions.enumerated() {
                let g = SIMD3<Int32>((p - lo) / cell, rounding: .down)
                let key = Int64(g.x) &* 73856093 ^ Int64(g.y) &* 19349663 ^ Int64(g.z) &* 83492791
                if let c = map[key] { cellOf[i] = c; sums[Int(c)] += p; counts[Int(c)] += 1 }
                else { let c = Int32(sums.count); map[key] = c; cellOf[i] = c; sums.append(p); counts.append(1) }
            }
            var newPos = [simd_float3](); newPos.reserveCapacity(sums.count)
            for (i, s) in sums.enumerated() { newPos.append(s / Float(counts[i])) }
            var newIdx = [UInt32](); newIdx.reserveCapacity(target * 3)
            for t in 0 ..< triCount {
                let a = cellOf[Int(indices[t * 3])], b = cellOf[Int(indices[t * 3 + 1])], c = cellOf[Int(indices[t * 3 + 2])]
                if a != b, b != c, a != c { newIdx.append(UInt32(a)); newIdx.append(UInt32(b)); newIdx.append(UInt32(c)) }
            }
            best = (newPos, newIdx)
            if newIdx.count / 3 <= Int(Double(target) * 1.25) { break }
            k *= 0.7
        }
        return best
    }

    // MARK: - glTF node transform

    private static func localMatrix(_ nj: [String: Any]) -> simd_float4x4 {
        if let m = nj["matrix"] as? [Double], m.count == 16 {
            // glTF matrices are column-major, same as simd_float4x4(columns:)
            let f = m.map { Float($0) }
            return simd_float4x4(columns: (
                simd_float4(f[0],  f[1],  f[2],  f[3]),
                simd_float4(f[4],  f[5],  f[6],  f[7]),
                simd_float4(f[8],  f[9],  f[10], f[11]),
                simd_float4(f[12], f[13], f[14], f[15])))
        }
        var t = simd_float3(0, 0, 0), s = simd_float3(1, 1, 1)
        var q = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
        if let v = nj["translation"] as? [Double], v.count == 3 { t = simd_float3(Float(v[0]), Float(v[1]), Float(v[2])) }
        if let v = nj["scale"]       as? [Double], v.count == 3 { s = simd_float3(Float(v[0]), Float(v[1]), Float(v[2])) }
        if let v = nj["rotation"]    as? [Double], v.count == 4 { q = simd_quatf(ix: Float(v[0]), iy: Float(v[1]), iz: Float(v[2]), r: Float(v[3])) }
        var m = simd_float4x4(q)
        m.columns.0 *= s.x; m.columns.1 *= s.y; m.columns.2 *= s.z
        m.columns.3 = simd_float4(t, 1)
        return m
    }

    // MARK: - Accessors

    private static func view(forAccessor ai: Int, accessors: [[String: Any]], views: [[String: Any]], bin: Data)
        throws -> (data: Data, offset: Int, count: Int, componentType: Int, stride: Int?) {
        guard ai < accessors.count else { throw GLBLoaderError.malformed("accessor \(ai) out of range") }
        let a = accessors[ai]
        guard let vi = a["bufferView"] as? Int, vi < views.count else { throw GLBLoaderError.malformed("accessor \(ai) has no bufferView") }
        let v = views[vi]
        let off = (v["byteOffset"] as? Int ?? 0) + (a["byteOffset"] as? Int ?? 0)
        let len = v["byteLength"] as? Int ?? 0
        guard off <= bin.count, (v["byteOffset"] as? Int ?? 0) + len <= bin.count else { throw GLBLoaderError.malformed("bufferView \(vi) overruns BIN") }
        return (bin, off, a["count"] as? Int ?? 0, a["componentType"] as? Int ?? 5126, v["byteStride"] as? Int)
    }

    private static func readFloat3(accessorIndex ai: Int, accessors: [[String: Any]], views: [[String: Any]], bin: Data) throws -> [simd_float3] {
        let (data, off, count, ct, stride) = try view(forAccessor: ai, accessors: accessors, views: views, bin: bin)
        guard ct == 5126 else { throw GLBLoaderError.malformed("POSITION must be float32") }
        let step = stride ?? 12
        guard count > 0 else { return [] }
        guard off + (count - 1) * step + 12 <= data.count else { throw GLBLoaderError.malformed("POSITION overruns BIN") }
        var out = [simd_float3](); out.reserveCapacity(count)
        data.withUnsafeBytes { raw in
            let base = raw.baseAddress!
            for i in 0 ..< count {
                let p = base + off + i * step
                let x = p.loadUnaligned(as: Float.self), y = (p + 4).loadUnaligned(as: Float.self), z = (p + 8).loadUnaligned(as: Float.self)
                out.append(simd_float3(x, y, z))
            }
        }
        return out
    }

    private static func readIndices(accessorIndex ai: Int, accessors: [[String: Any]], views: [[String: Any]], bin: Data) throws -> [UInt32] {
        let (data, off, count, ct, _) = try view(forAccessor: ai, accessors: accessors, views: views, bin: bin)
        let size: Int
        switch ct { case 5121: size = 1; case 5123: size = 2; case 5125: size = 4
        default: throw GLBLoaderError.malformed("unsupported index component type \(ct)") }
        guard count > 0 else { return [] }
        guard off + count * size <= data.count else { throw GLBLoaderError.malformed("indices overrun BIN") }
        var out = [UInt32](); out.reserveCapacity(count)
        data.withUnsafeBytes { raw in
            let base = raw.baseAddress! + off
            for i in 0 ..< count {
                switch size {
                case 1: out.append(UInt32((base + i).loadUnaligned(as: UInt8.self)))
                case 2: out.append(UInt32((base + i * 2).loadUnaligned(as: UInt16.self)))
                default: out.append((base + i * 4).loadUnaligned(as: UInt32.self))
                }
            }
        }
        return out
    }
}

private extension Data {
    func readUInt32(at offset: Int) -> UInt32 {
        guard offset + 4 <= count else { return 0 }
        return withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self) }
    }
}
