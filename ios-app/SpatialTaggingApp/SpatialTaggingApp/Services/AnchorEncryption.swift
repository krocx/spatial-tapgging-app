// AnchorEncryption.swift — Phase 2.5
// Client-side AES-256-GCM encryption for pass-state images.
//
// Design:
//  • Each anchor gets a unique 256-bit symmetric key generated once on the Author device.
//  • The key is stored in the iOS Keychain (survives app restarts, not iCloud-synced).
//  • The key is embedded in the QR code payload so any device that scans the QR can decrypt.
//  • The SIB server only ever stores ciphertext — plaintext never leaves the Author's device.
//  • When the Operator device scans the QR it extracts the key, passes it in validate-all,
//    and the SIB decrypts stored images in-memory for comparison.
//
// Wire format (CryptoKit SealedBox.combined):
//   base64( nonce[12] || ciphertext || authTag[16] )

import CryptoKit
import Foundation

enum AnchorEncryptionError: LocalizedError {
    case invalidKeyData
    case encryptionFailed
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .invalidKeyData:   return "Invalid encryption key data"
        case .encryptionFailed: return "Image encryption failed"
        case .decryptionFailed: return "Image decryption failed"
        }
    }
}

struct AnchorEncryption {

    // ── Key lifecycle ─────────────────────────────────────────────────────────

    /// Returns the AES-256 key for an anchor.
    /// If no key exists yet (first time Author opens this anchor), one is generated and stored.
    static func getOrCreateKey(for anchorId: String) -> SymmetricKey {
        if let existing = loadKey(anchorId: anchorId) { return existing }
        let newKey = SymmetricKey(size: .bits256)
        saveKey(newKey, anchorId: anchorId)
        return newKey
    }

    /// Reconstruct a SymmetricKey from the base64 string embedded in the QR code.
    /// Call this when an Operator device scans the QR and extracts `encryptionKey`.
    static func key(fromBase64 base64String: String) -> SymmetricKey? {
        guard let data = Data(base64Encoded: base64String),
              data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }

    /// Export a key as a base64 string for embedding in the QR payload.
    static func base64(for key: SymmetricKey) -> String {
        key.withUnsafeBytes { Data($0).base64EncodedString() }
    }

    // ── Encrypt / Decrypt ─────────────────────────────────────────────────────

    /// Encrypt a JPEG base64 string using AES-256-GCM.
    /// Returns: base64( nonce[12] || ciphertext || authTag[16] )
    static func encrypt(imageBase64: String, using key: SymmetricKey) throws -> String {
        guard let imageData = Data(base64Encoded: imageBase64) else {
            throw AnchorEncryptionError.encryptionFailed
        }
        do {
            let sealedBox = try AES.GCM.seal(imageData, using: key)
            guard let combined = sealedBox.combined else {
                throw AnchorEncryptionError.encryptionFailed
            }
            return combined.base64EncodedString()
        } catch {
            throw AnchorEncryptionError.encryptionFailed
        }
    }

    /// Decrypt a base64(nonce||ciphertext||authTag) string, returning a JPEG base64 string.
    static func decrypt(encryptedBase64: String, using key: SymmetricKey) throws -> String {
        guard let combined = Data(base64Encoded: encryptedBase64) else {
            throw AnchorEncryptionError.decryptionFailed
        }
        do {
            let sealedBox = try AES.GCM.SealedBox(combined: combined)
            let plaintext = try AES.GCM.open(sealedBox, using: key)
            return plaintext.base64EncodedString()
        } catch {
            throw AnchorEncryptionError.decryptionFailed
        }
    }

    // ── Keychain ──────────────────────────────────────────────────────────────

    private static let keychainService = "com.spatial.anchor-keys"

    /// Public read-only Keychain lookup — returns nil if no key exists yet.
    /// Used by Operator mode on the same device to find a key without creating one.
    static func loadExistingKey(anchorId: String) -> SymmetricKey? {
        loadKey(anchorId: anchorId)
    }

    /// Remove the Keychain entry for a deleted anchor.
    /// Silent no-op if the key was never stored on this device.
    static func deleteKey(anchorId: String) {
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: anchorId,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func saveKey(_ key: SymmetricKey, anchorId: String) {
        let keyData = key.withUnsafeBytes { Data($0) }
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: anchorId,
            kSecValueData:   keyData,
        ]
        // Delete any existing entry first (idempotent upsert)
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("[AnchorEncryption] Keychain save failed for \(anchorId): \(status)")
        }
    }

    private static func loadKey(anchorId: String) -> SymmetricKey? {
        let query: [CFString: Any] = [
            kSecClass:            kSecClassGenericPassword,
            kSecAttrService:      keychainService,
            kSecAttrAccount:      anchorId,
            kSecReturnData:       true,
            kSecMatchLimit:       kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }
}
