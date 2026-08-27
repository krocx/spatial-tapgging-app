//
//  TagEnvelope.swift — .tag envelope reader (spec: docs/TAG-FORMAT.md, tag/1.0)
//
//  PROPRIETARY & CONFIDENTIAL — Applied Materials. Patent pending.
//
//  The reference conformant reader (spec §6): parse → canonicalize →
//  verify Ed25519 → pin issuer → cache for offline. The payload contains no
//  JSON numbers by format rule, so the canonical form (sorted keys, no
//  whitespace, JSON.stringify escaping) is byte-reproducible here.
//

import Foundation
import CryptoKit

// MARK: - Envelope model

struct TagStreamRef: Codable {
    let name: String
    let ref: String
    let sha256: String
    let contentVersion: String?
}

struct TagMemberRef: Codable {
    let tagId: String
    let label: String
    let ref: String
    let sha256: String
}

struct TagSubject: Codable {
    let id: String
    let label: String
    let anchorId: String?
    let assetId: String?
    let type: String?
}

struct TagEnvelopeSignature: Codable {
    let alg: String
    let publicKey: String   // raw 32-byte Ed25519 key, base64
    let sig: String         // raw 64-byte signature, base64
}

/// Decoded view of the payload for app consumption. Verification does NOT
/// use this struct — it canonicalizes the raw JSON so unknown (future)
/// fields still count toward the signature.
struct TagPayloadView: Codable {
    let format: String
    let kind: String        // "part" | "assembly" ("group" reserved)
    let subject: TagSubject
    let streams: [TagStreamRef]
    let members: [TagMemberRef]?
    let contentVersion: String
}

enum TagEnvelopeError: Error, LocalizedError {
    case malformed(String)
    case unsupportedFormat(String)
    case signatureInvalid
    case issuerMismatch

    var errorDescription: String? {
        switch self {
        case .malformed(let d):        return "Malformed .tag envelope: \(d)"
        case .unsupportedFormat(let f): return "Unsupported .tag format \(f) — update the app"
        case .signatureInvalid:        return ".tag signature verification failed — envelope may be tampered"
        case .issuerMismatch:          return ".tag signed by an unknown issuer — does not match the pinned server key"
        }
    }
}

// MARK: - Reader

enum TagEnvelopeReader {

    /// Parse + verify an envelope (spec §6 steps 1–3).
    /// `pinnedIssuerKey` — base64 raw key from a previous scan; nil on first
    /// contact (trust-on-first-scan, then call `pinIssuer`).
    static func read(_ data: Data, pinnedIssuerKey: String?) throws -> TagPayloadView {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payloadObj = root["payload"] as? [String: Any],
              let sigObj = root["signature"] as? [String: Any],
              let alg = sigObj["alg"] as? String,
              let pubB64 = sigObj["publicKey"] as? String,
              let sigB64 = sigObj["sig"] as? String
        else { throw TagEnvelopeError.malformed("missing payload or signature block") }

        guard alg == "Ed25519" else { throw TagEnvelopeError.malformed("unknown signature alg \(alg)") }
        guard let format = payloadObj["format"] as? String, format == "tag/1.0"
        else { throw TagEnvelopeError.unsupportedFormat((payloadObj["format"] as? String) ?? "?") }

        if let pinned = pinnedIssuerKey, pinned != pubB64 { throw TagEnvelopeError.issuerMismatch }

        // Verify over the canonical payload bytes — includes unknown fields.
        let canonical = try canonicalize(payloadObj)
        guard let pubRaw = Data(base64Encoded: pubB64), pubRaw.count == 32,
              let sigRaw = Data(base64Encoded: sigB64), sigRaw.count == 64,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pubRaw),
              key.isValidSignature(sigRaw, for: Data(canonical.utf8))
        else { throw TagEnvelopeError.signatureInvalid }

        // Typed view for the app.
        let payloadData = try JSONSerialization.data(withJSONObject: payloadObj)
        guard let view = try? JSONDecoder().decode(TagPayloadView.self, from: payloadData)
        else { throw TagEnvelopeError.malformed("payload missing required fields") }
        guard view.kind == "part" || view.kind == "assembly"
        else { throw TagEnvelopeError.malformed("unknown kind \(view.kind)") }
        return view
    }

    /// Verify a resolved stream's bytes against its manifest hash (spec §6 step 4).
    static func streamMatches(_ streamData: Data, expectedSha256: String) -> Bool {
        SHA256.hash(data: streamData).map { String(format: "%02x", $0) }.joined() == expectedSha256
    }

    // MARK: Issuer pinning (spec §4 trust model)

    private static let pinKey = "sib.tag.pinnedIssuerKey"

    static var pinnedIssuer: String? { UserDefaults.standard.string(forKey: pinKey) }
    static func pinIssuer(_ publicKeyB64: String) { UserDefaults.standard.set(publicKeyB64, forKey: pinKey) }
    static func unpinIssuer() { UserDefaults.standard.removeObject(forKey: pinKey) }  // key rotation

    // MARK: Offline cache (spec §7)

    private static var cacheDir: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tags", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func cache(_ envelopeData: Data, subjectId: String) {
        try? envelopeData.write(to: cacheDir.appendingPathComponent("\(subjectId).tag"), options: .atomic)
    }

    /// Cached envelope — re-verified against the pinned issuer on every read,
    /// so a tampered cache file fails exactly like a tampered download.
    static func cached(subjectId: String) -> (data: Data, payload: TagPayloadView)? {
        guard let data = try? Data(contentsOf: cacheDir.appendingPathComponent("\(subjectId).tag")),
              let payload = try? read(data, pinnedIssuerKey: pinnedIssuer)
        else { return nil }
        return (data, payload)
    }

    // MARK: Canonicalization (spec §3 — must match tag-core.ts byte-for-byte)

    static func canonicalize(_ value: Any) throws -> String {
        if value is NSNull { return "null" }
        if let s = value as? String { return escapeJSON(s) }
        if let b = value as? Bool { return b ? "true" : "false" }   // NSNumber bools first
        if value is NSNumber {
            // Format rule: payloads carry no JSON numbers (spec §2).
            throw TagEnvelopeError.malformed("determinism rule violated — JSON number in payload")
        }
        if let arr = value as? [Any] {
            return "[" + (try arr.map { try canonicalize($0) }).joined(separator: ",") + "]"
        }
        if let obj = value as? [String: Any] {
            let parts = try obj.keys.sorted().map { key in
                escapeJSON(key) + ":" + (try canonicalize(obj[key]!))
            }
            return "{" + parts.joined(separator: ",") + "}"
        }
        throw TagEnvelopeError.malformed("unsupported JSON value in payload")
    }

    /// String escaping identical to JavaScript's JSON.stringify: the five
    /// shorthand escapes, \u00XX for other control chars, non-ASCII kept raw.
    private static func escapeJSON(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}

// MARK: - Live subscription (spec §7 — the continuous emitter, M2)

/// A `changed` push from GET /anchors/:id/subscribe.
struct TagChangeEvent: Codable {
    let contentVersion: String
    let payloadSha256: String
    /// "stream:<name>" / "member:<tagId>" — re-fetch only these.
    let changed: [String]?
}

/// SSE listener for a chamber's .tag change feed. Usage:
///   let sub = TagSubscription(baseURL: url, apiKey: key, anchorId: id) { event in
///       // re-emit the envelope, verify, refresh only event.changed streams
///   }
///   sub.start()   … later …   sub.stop()
final class TagSubscription {
    private let url: URL
    private let apiKey: String?
    private let onChange: (TagChangeEvent) -> Void
    private var task: Task<Void, Never>?

    init?(baseURL: URL, apiKey: String?, anchorId: String, onChange: @escaping (TagChangeEvent) -> Void) {
        guard let u = URL(string: "/anchors/\(anchorId)/subscribe", relativeTo: baseURL) else { return nil }
        self.url = u
        self.apiKey = apiKey
        self.onChange = onChange
    }

    func start() {
        stop()
        task = Task { [url, apiKey, onChange] in
            while !Task.isCancelled {
                var req = URLRequest(url: url)
                req.timeoutInterval = 3600
                if let apiKey { req.setValue(apiKey, forHTTPHeaderField: "X-API-Key") }
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: req)
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                    var eventName = ""
                    for try await line in bytes.lines {
                        if Task.isCancelled { return }
                        if line.hasPrefix("event: ") {
                            eventName = String(line.dropFirst(7))
                        } else if line.hasPrefix("data: "), eventName == "changed" {
                            if let data = String(line.dropFirst(6)).data(using: .utf8),
                               let event = try? JSONDecoder().decode(TagChangeEvent.self, from: data) {
                                await MainActor.run { onChange(event) }
                            }
                        }
                        // blank lines end an SSE message; heartbeats (": hb") are ignored
                        if line.isEmpty { eventName = "" }
                    }
                } catch { /* fall through to backoff-reconnect */ }
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // 5s reconnect backoff
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    deinit { stop() }
}
