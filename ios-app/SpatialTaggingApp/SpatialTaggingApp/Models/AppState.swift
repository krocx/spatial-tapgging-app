// AppState.swift — Phase 2.5
// Global app state shared across all views.
// Phase 2.5 adds: anchorEncryptionKey (AES-256-GCM key from QR or Keychain)
// Phase 2.5 (origin): anchorNormalisedTransform — gravity-aligned QR frame stored
//   on scan so tag positions can be saved as anchor-relative offsets.

import Foundation
import ARKit
import CryptoKit
import simd

enum AppMode: Equatable { case none; case author; case `operator` }

enum ScanState: Equatable {
    case scanning
    case detected(QRAnchorContext)
    case locked(QRAnchorContext)
}

enum ConnectionState {
    case unknown, checking, connected
    case failed(String)
    var isConnected: Bool { if case .connected = self { return true }; return false }
}

final class AppState: ObservableObject {

    @Published var mode: AppMode = .none
    @Published var scanState: ScanState = .scanning
    @Published var activeAnchor: Anchor? = nil
    @Published var activeTags: [Tag] = []
    @Published var activeSession: SIBSession? = nil
    @Published var lastValidationResult: AnchorValidationResult? = nil
    @Published var connectionState: ConnectionState = .unknown
    @Published var errorMessage: String? = nil
    /// Tag IDs that have had pass-state images successfully uploaded this session.
    @Published var trainedTagIds: Set<String> = []
    /// Phase 2.5: AES-256-GCM key for the current anchor.
    /// Author: retrieved from (or saved to) Keychain when anchor is locked.
    /// Operator: extracted from QR payload on scan.
    /// Used to encrypt images before upload (Author) and decrypt them during validate-all (Operator).
    var anchorEncryptionKey: SymmetricKey? = nil

    /// Phase 3: gravity-aligned 4×4 transform of the QR anchor, set by QRScanGateView
    /// before either Author or Operator mode is entered.  Guaranteed non-nil for any
    /// active AR session.
    ///
    /// Tag positions stored as `anchor_rel_x/y/z` in tag metadata are expressed
    /// relative to this frame.  Converting them to world-space requires the CURRENT
    /// session's normalised transform — set once per session by QRScanGateView.
    var anchorNormalisedTransform: simd_float4x4? = nil

    /// The live ARSession created by QRScanGateView and kept alive so that
    /// AuthorModeView / OperatorModeView can link to it without a session reset.
    /// When both views share this session, the locked ARImageAnchor remains tracked
    /// and ARSessionManager can continuously refine lockedAnchorTransform.
    /// Set in QRScanGateView.lockSession(); cleared in reset().
    var activeARSession: ARSession? = nil

    var lockedContext: QRAnchorContext? {
        if case .locked(let ctx) = scanState { return ctx }; return nil
    }

    var isAnchorLocked: Bool {
        if case .locked = scanState { return true }; return false
    }

    // ── Anchor-relative coordinate helpers ───────────────────────────────────

    /// Convert a world-space position (from ARKit raycast) into anchor-relative
    /// coordinates using the current session's normalised anchor transform.
    /// Returns nil if no anchor transform has been locked yet.
    func toAnchorRelative(_ worldPos: simd_float3) -> simd_float3? {
        guard let t = anchorNormalisedTransform else { return nil }
        return ARCoordinateFrame.toAnchorRelative(worldPos: worldPos, anchorTransform: t)
    }

    /// Recover the world-space position of an anchor-relative offset using the
    /// current session's normalised anchor transform.
    /// Returns nil if no anchor transform is available for this session.
    func toWorldSpace(_ anchorRelativePos: simd_float3) -> simd_float3? {
        guard let t = anchorNormalisedTransform else { return nil }
        return ARCoordinateFrame.toWorldSpace(anchorRelativePos: anchorRelativePos,
                                              anchorTransform: t)
    }

    func reset() {
        scanState = .scanning
        activeAnchor = nil
        activeTags = []
        activeSession = nil
        lastValidationResult = nil
        errorMessage = nil
        trainedTagIds = []
        anchorEncryptionKey = nil
        anchorNormalisedTransform = nil
        // Release the shared session — any view holding a link will keep it alive
        // until it dismisses and pauses via its own onDisappear.
        activeARSession = nil
    }

    // ── LastAuthorSession persistence (UserDefaults) ──────────────────────────
    // Persists only the anchor ID + assetId; full tags are re-fetched on resume.

    private static let lastSessionKey = "spatial.lastAuthorSession"

    /// Call after Author mode successfully loads an anchor + its tags.
    func saveLastAuthorSession() {
        guard let anchor = activeAnchor else { return }
        let session = LastAuthorSession(
            anchorId:      anchor.id,
            assetId:       anchor.assetId,
            savedAt:       ISO8601DateFormatter().string(from: Date()),
            trainedTagIds: Array(trainedTagIds)
        )
        if let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: Self.lastSessionKey)
        }
    }

    /// Returns the last saved Author session, or nil if none exists.
    func loadLastAuthorSession() -> LastAuthorSession? {
        guard let data = UserDefaults.standard.data(forKey: Self.lastSessionKey) else { return nil }
        return try? JSONDecoder().decode(LastAuthorSession.self, from: data)
    }

    /// Clears the persisted session (called on explicit exit from Author mode).
    func clearLastAuthorSession() {
        UserDefaults.standard.removeObject(forKey: Self.lastSessionKey)
    }
}
