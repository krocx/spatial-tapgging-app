// AppLog.swift — QA logging: the phone's log lines, shipped to SIB.
//
// A work iPhone can't hand over its console, so every line that matters is
// also queued here and POSTed to `/logs` in small batches (every 5 s, or
// when 50 lines pile up). SIB files them per device per day; the portal's
// Admin → Logs page and `/logs/export.txt` read them back.
//
//   AppLog.info("model", "loaded", ["slots": 2])
//   AppLog.debug("presence", "pose", ["x": 0.12])      ← sent only with QA Mode on
//   AppLog.warn / AppLog.error(...)                    ← error also carries the caller
//
// QA Mode (Settings → Diagnostics) is per device, off by default, auto-off
// after 24 h, and shows a small badge in AR views so nobody forgets it's on.
// With QA Mode off only info/warn/error are sent. Everything is ALSO printed
// to the Xcode console as before.
//
// Redaction: keys, tokens and base64 blobs are replaced before the line
// leaves the phone (the server does a second pass). Never log images.
//
// Not a crash reporter: an uncaught crash can't flush the queue. On the next
// launch, if the previous session didn't end cleanly, one marker line
// ("previous session ended abnormally") is sent so the timeline shows the gap.

import Foundation
import UIKit

enum AppLogLevel: String, Codable, Comparable {
    case debug, info, warn, error
    private var rank: Int { switch self { case .debug: 0; case .info: 1; case .warn: 2; case .error: 3 } }
    static func < (a: AppLogLevel, b: AppLogLevel) -> Bool { a.rank < b.rank }
}

struct AppLogEntry: Codable {
    let ts:     String
    let level:  AppLogLevel
    let module: String
    let msg:    String
    var ctx:    [String: AppLogValue]?
}

/// JSON-safe context value.
enum AppLogValue: Codable {
    case string(String), number(Double), bool(Bool), null
    init(_ v: Any?) {
        switch v {
        case nil:                self = .null
        case let s as String:    self = .string(AppLog.redact(String(s.prefix(300))))
        case let b as Bool:      self = .bool(b)
        case let i as Int:       self = .number(Double(i))
        case let f as Float:     self = .number(Double(f))
        case let d as Double:    self = .number(d)
        case let c as CGFloat:   self = .number(Double(c))
        default:                 self = .string(AppLog.redact(String(describing: v!).prefix(300).description))
        }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n.isFinite ? n : 0)
        case .bool(let b):   try c.encode(b)
        case .null:          try c.encodeNil()
        }
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }
}

final class AppLog {

    static let shared = AppLog()

    // ── Public API ────────────────────────────────────────────────────────────

    static func debug(_ module: String, _ msg: String, _ ctx: [String: Any?]? = nil) { shared.log(.debug, module, msg, ctx) }
    static func info (_ module: String, _ msg: String, _ ctx: [String: Any?]? = nil) { shared.log(.info,  module, msg, ctx) }
    static func warn (_ module: String, _ msg: String, _ ctx: [String: Any?]? = nil) { shared.log(.warn,  module, msg, ctx) }
    static func error(_ module: String, _ msg: String, _ ctx: [String: Any?]? = nil,
                      file: String = #fileID, line: Int = #line, function: String = #function) {
        var c = ctx ?? [:]
        c["at"] = "\(file):\(line) \(function)"
        shared.log(.error, module, msg, c)
    }

    /// QA Mode — debug lines are sent only while this is on. Persisted per
    /// device with an expiry so a forgotten toggle turns itself off.
    static var qaMode: Bool {
        get {
            let d = UserDefaults.standard
            guard d.bool(forKey: "qa_mode") else { return false }
            let until = d.double(forKey: "qa_mode_until")
            if until > 0 && Date().timeIntervalSince1970 > until { d.set(false, forKey: "qa_mode"); return false }
            return true
        }
        set {
            let d = UserDefaults.standard
            d.set(newValue, forKey: "qa_mode")
            d.set(newValue ? Date().addingTimeInterval(24 * 3600).timeIntervalSince1970 : 0, forKey: "qa_mode_until")
            shared.log(.info, "app", newValue ? "QA Mode ON (24 h)" : "QA Mode OFF")
            shared.flush()
        }
    }

    /// Stable per-install id (not the hardware serial, not the user).
    static let deviceId: String = {
        let d = UserDefaults.standard
        if let id = d.string(forKey: "qa_device_id") { return id }
        let id = String(UUID().uuidString.prefix(8)).lowercased()
        d.set(id, forKey: "qa_device_id"); return id
    }()

    /// Rolling context every line inherits (anchor / guide / step). Set by
    /// the views as the technician moves; cleared on exit.
    static func setContext(_ key: String, _ value: String?) {
        shared.q.async { shared.context[key] = value }
    }

    /// Wire once at launch: server URL, key and identity come from settings.
    static func configure(settings: AppSettings) {
        shared.settings = settings
        shared.markLaunch()
        shared.startTimer()
    }

    /// Send whatever is queued now (called on background / QA toggle).
    func flush() { q.async { self.send() } }
    static func flush() { shared.flush() }

    // ── Internals ─────────────────────────────────────────────────────────────

    private let q = DispatchQueue(label: "applog", qos: .utility)
    private var buffer: [AppLogEntry] = []
    private var context: [String: String?] = [:]
    private weak var settings: AppSettings?
    private var timer: DispatchSourceTimer?
    private var sending = false
    private let maxBuffer = 2000
    private let batchTrigger = 50
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()

    private func log(_ level: AppLogLevel, _ module: String, _ msg: String, _ ctx: [String: Any?]? = nil) {
        let clean = AppLog.redact(msg)
        #if DEBUG
        print("[\(module)] \(level.rawValue.uppercased()) \(clean)")
        #endif
        if level == .debug && !AppLog.qaMode { return }
        let ts = iso.string(from: Date())
        var values: [String: AppLogValue] = [:]
        if let ctx { for (k, v) in ctx { values[String(k.prefix(32))] = AppLogValue(v) } }
        q.async {
            for (k, v) in self.context { if let v, values[k] == nil { values[k] = .string(v) } }
            let entry = AppLogEntry(ts: ts, level: level, module: module.lowercased(), msg: String(clean.prefix(2000)),
                                    ctx: values.isEmpty ? nil : values)
            self.buffer.append(entry)
            if self.buffer.count > self.maxBuffer { self.buffer.removeFirst(self.buffer.count - self.maxBuffer) }
            if self.buffer.count >= self.batchTrigger || level == .error { self.send() }
        }
    }

    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 5, repeating: 5)
        t.setEventHandler { [weak self] in self?.send() }
        t.resume(); timer = t
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.markCleanExit(); self?.flush()
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { _ in
            UserDefaults.standard.set(false, forKey: "qa_clean_exit")
        }
    }

    /// Runs on `q`. One in-flight batch at a time; failures keep the lines.
    private func send() {
        guard !sending, !buffer.isEmpty, let settings, settings.isConfigured else { return }
        let batch = Array(buffer.prefix(500))
        sending = true
        let device: [String: Any] = [
            "id": AppLog.deviceId,
            "model": DeviceModel.identifier,
            "os": "iOS \(UIDevice.current.systemVersion)",
            "app": AppVersion.current,
            "employeeId": settings.employeeId,
            "name": settings.uamUserName.isEmpty ? settings.authorName : settings.uamUserName,
            "qaMode": AppLog.qaMode,
        ]
        guard let entriesData = try? JSONEncoder().encode(batch),
              let entries = try? JSONSerialization.jsonObject(with: entriesData),
              let body = try? JSONSerialization.data(withJSONObject: ["device": device, "entries": entries]),
              let url = URL(string: settings.normalizedBaseURL + "/logs") else { sending = false; return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let key = settings.apiKey.trimmingCharacters(in: .whitespaces)
        if !key.isEmpty { req.setValue(key, forHTTPHeaderField: "X-API-Key") }
        if !settings.uamToken.isEmpty { req.setValue(settings.uamToken, forHTTPHeaderField: "X-User-Token") }
        req.httpBody = body
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self else { return }
            self.q.async {
                let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
                if ok { self.buffer.removeFirst(min(batch.count, self.buffer.count)) }
                self.sending = false
            }
        }.resume()
    }

    // Abnormal-exit marker: set clean=false at launch, true when backgrounded.
    private func markLaunch() {
        let d = UserDefaults.standard
        let hadPrevious = d.object(forKey: "qa_clean_exit") != nil
        if hadPrevious && !d.bool(forKey: "qa_clean_exit") {
            log(.warn, "app", "previous session ended abnormally (crash or kill)", nil)
        }
        d.set(false, forKey: "qa_clean_exit")
        log(.info, "app", "launch", ["version": AppVersion.current, "device": DeviceModel.identifier,
                                     "os": UIDevice.current.systemVersion, "qa": AppLog.qaMode])
    }
    private func markCleanExit() { UserDefaults.standard.set(true, forKey: "qa_clean_exit") }

    // ── Redaction ─────────────────────────────────────────────────────────────

    private static let patterns: [(NSRegularExpression, String)] = {
        let make: (String, String) -> (NSRegularExpression, String) = { p, r in
            (try! NSRegularExpression(pattern: p, options: [.caseInsensitive]), r)
        }
        return [
            make(#"(bearer\s+)[A-Za-z0-9._-]+"#, "$1[redacted]"),
            make(#"((?:api|admin|ip|aes|enc(?:ryption)?)[_-]?key"?\s*[:=]\s*"?)[^"\s,}]+"#, "$1[redacted]"),
            make(#"sk-[A-Za-z0-9_-]{12,}"#, "[redacted]"),
            make(#"(?:[A-Za-z0-9+/]{4}){20,}={0,2}"#, "[redacted:b64]"),
            make(#"\b[A-Za-z0-9_-]{40,}\b"#, "[redacted]"),
        ]
    }()
    static func redact(_ s: String) -> String {
        var out = s
        for (re, rep) in patterns {
            out = re.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: rep)
        }
        return out
    }
}
