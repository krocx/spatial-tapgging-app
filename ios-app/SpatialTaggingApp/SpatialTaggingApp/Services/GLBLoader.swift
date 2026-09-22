//
//  GLBLoader.swift
//  SpatialTaggingApp
//
//  AR OJT slice 2 — our own glTF 2.0 binary reader → SceneKit.
//
//  Why not USDZ: the portal's USDZ export renames every node ("Object_123"),
//  so per-part show/hide/animate cannot address the assembly's parts. The GLB
//  that SIB's Cortona3D importer writes is a deliberately small subset —
//  nodes with names + a 4x4 matrix (or TRS), POSITION + indices, a base-colour
//  material — and this loader reads exactly that subset, preserving node
//  names (`cmp:<part>`) and glTF `extras` (part number / description).
//  Anything outside the subset (textures, skins, animations, sparse accessors)
//  is ignored rather than failing, and any GLB we did not write is handled the
//  same way; callers fall back to the USDZ path when `parts` comes back empty.
//
//  Normals: the GLB carries none (viewers shade flat). We un-index every
//  primitive and compute flat normals so CAD edges stay crisp under SceneKit's
//  PBR lighting — the same fix the portal applies before its USDZ export.
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

    static func load(url: URL) throws -> GLBAssembly {
        try load(data: try Data(contentsOf: url, options: .mappedIfSafe))
    }

    static func load(data: Data) throws -> GLBAssembly {
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
        return try build(json: json, bin: bin ?? Data())
    }

    // MARK: - Build

    private static func build(json: [String: Any], bin: Data) throws -> GLBAssembly {
        let bufferViews = json["bufferViews"] as? [[String: Any]] ?? []
        let accessors   = json["accessors"]   as? [[String: Any]] ?? []
        let meshesJ     = json["meshes"]      as? [[String: Any]] ?? []
        let materialsJ  = json["materials"]   as? [[String: Any]] ?? []
        let nodesJ      = json["nodes"]       as? [[String: Any]] ?? []
        let scenesJ     = json["scenes"]      as? [[String: Any]] ?? []
        let sceneIdx    = json["scene"] as? Int ?? 0

        // Materials — one SCNMaterial per glTF material, cloned per part later
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

        // Meshes — built once, geometry shared between nodes that reference the same mesh.
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
                let triCount = indices.count / 3
                guard triCount > 0 else { continue }
                // Un-index + flat normals.
                var flatPos = [simd_float3](); flatPos.reserveCapacity(triCount * 3)
                var flatNrm = [simd_float3](); flatNrm.reserveCapacity(triCount * 3)
                for t in 0 ..< triCount {
                    let i0 = Int(indices[t * 3]), i1 = Int(indices[t * 3 + 1]), i2 = Int(indices[t * 3 + 2])
                    guard i0 < positions.count, i1 < positions.count, i2 < positions.count else { continue }
                    let a = positions[i0], b = positions[i1], c = positions[i2]
                    var n = simd_cross(b - a, c - a)
                    let len = simd_length(n); n = len > 1e-12 ? n / len : simd_float3(0, 1, 0)
                    flatPos.append(a); flatPos.append(b); flatPos.append(c)
                    flatNrm.append(n); flatNrm.append(n); flatNrm.append(n)
                }
                guard !flatPos.isEmpty else { continue }
                let vsrc = SCNGeometrySource(vertices: flatPos.map { SCNVector3($0) })
                let nsrc = SCNGeometrySource(normals: flatNrm.map { SCNVector3($0) })
                let idx: [UInt32] = (0 ..< UInt32(flatPos.count)).map { $0 }
                let elem = SCNGeometryElement(indices: idx, primitiveType: .triangles)
                let geo = SCNGeometry(sources: [vsrc, nsrc], elements: [elem])
                let mi2 = p["material"] as? Int
                geo.materials = [(mi2 != nil && mi2! < materials.count) ? materials[mi2!] : fallbackMaterial]
                out.append(geo)
                meshCount += 1; triangleCount += flatPos.count / 3
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
            // the CAD tool named the node — the Procedure Designer lists the
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

        AppLog.info("model", "[GLBLoader] parts=\(parts.count) meshes=\(meshCount) tris=\(triangleCount)")
        return GLBAssembly(root: root, parts: parts, extras: extras, restTransforms: rest,
                           meshCount: meshCount, triangleCount: triangleCount,
                           bounds: anyGeometry ? (bmin, bmax) : nil)
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
