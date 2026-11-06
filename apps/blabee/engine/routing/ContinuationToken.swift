import CryptoKit
import Foundation
import Security

/// CSPRNG-issued continuation material. There is intentionally no public or
/// internal initializer that accepts caller-provided token bytes.
public struct ContinuationTokenMaterial: Sendable {
    public let token: String
    public let entropyBits: Int
    public let fingerprint: String
    private let fingerprintKey: Data?

    private init(generatedBytes: [UInt8], hmacKey: Data?) throws {
        let encoded = Data(generatedBytes)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        try require(
            encoded.count >= 16 && encoded.utf8.allSatisfy(Self.isBase64URLByte),
            "generated_token_invalid"
        )
        token = encoded
        entropyBits = generatedBytes.count * 8
        fingerprint = try Self.fingerprint(for: encoded, hmacKey: hmacKey)
        fingerprintKey = hmacKey
    }

    public static func generate(
        bytes: Int = 32,
        hmacKey: Data? = nil
    ) throws -> ContinuationTokenMaterial {
        try require(
            bytes >= 16,
            "token_entropy_too_low",
            "tokens need at least 128 bits of entropy"
        )
        try require(
            bytes <= 768,
            "token_size_too_large",
            "tokens must fit the v1 opaque_token limit"
        )

        var random = [UInt8](repeating: 0, count: bytes)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
            throw CoordinatorError("generated_token_invalid", "secure random generation failed")
        }
        defer {
            _ = random.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        return try ContinuationTokenMaterial(generatedBytes: random, hmacKey: hmacKey)
    }

    public static func fingerprint(
        for token: String,
        hmacKey: Data? = nil
    ) throws -> String {
        try require(!token.isEmpty, "continuation_token_missing")
        if let hmacKey {
            let digest = HMAC<SHA256>.authenticationCode(
                for: Data(token.utf8),
                using: SymmetricKey(data: hmacKey)
            )
            return "hmac-sha256:" + digest.map { String(format: "%02x", $0) }.joined()
        }
        let digest = SHA256.hash(data: Data(token.utf8))
        return "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Verifies a v1 SHA-256 fingerprint. Both well-formed and malformed input
    /// traverse a fixed-length digest comparison before the shape check returns.
    public static func verify(
        token: String,
        fingerprint: String,
        hmacKey: Data? = nil
    ) -> Bool {
        let wantsHMAC = fingerprint.hasPrefix("hmac-sha256:")
        let usableKey = wantsHMAC ? hmacKey : nil
        let expected = (try? Self.fingerprint(for: token, hmacKey: usableKey))
            ?? (wantsHMAC ? "hmac-sha256:" : "sha256:") + String(repeating: "0", count: 64)
        let equal = constantTimeEqual(expected, fingerprint)
        return Self.isFingerprint(fingerprint)
            && !token.isEmpty
            && (!wantsHMAC || hmacKey != nil)
            && equal
    }

    public func verifyGeneratedIntegrity() -> Bool {
        Self.verify(token: token, fingerprint: fingerprint, hmacKey: fingerprintKey)
    }

    public static func constantTimeEqual(_ left: String, _ right: String) -> Bool {
        let leftDigest = Array(SHA256.hash(data: Data(left.utf8)))
        let rightDigest = Array(SHA256.hash(data: Data(right.utf8)))
        var difference: UInt8 = 0
        for index in leftDigest.indices {
            difference |= leftDigest[index] ^ rightDigest[index]
        }
        return difference == 0
    }

    private static func isFingerprint(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        let prefixLength: Int
        if bytes.starts(with: Array("sha256:".utf8)) {
            prefixLength = 7
        } else if bytes.starts(with: Array("hmac-sha256:".utf8)) {
            prefixLength = 12
        } else {
            return false
        }
        guard bytes.count == prefixLength + 64 else { return false }
        return bytes.dropFirst(prefixLength).allSatisfy { byte in
            (0x30...0x39).contains(byte) || (0x61...0x66).contains(byte)
        }
    }

    private static func isBase64URLByte(_ byte: UInt8) -> Bool {
        (0x41...0x5A).contains(byte)
            || (0x61...0x7A).contains(byte)
            || (0x30...0x39).contains(byte)
            || byte == 0x2D
            || byte == 0x5F
    }
}
