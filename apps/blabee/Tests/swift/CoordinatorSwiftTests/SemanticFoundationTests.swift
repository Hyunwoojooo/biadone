import Foundation
import Testing
@testable import CoordinatorSwift

private func expectFoundationCode(_ expected: String, _ operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("expected error \(expected)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private func makeBinding(
    projectID: String = "project",
    sessionID: String = "session",
    sourceTurnID: String = "turn",
    sourcePromptID: String = "prompt",
    episodeID: String = "episode",
    episodeRootPromptID: String = "root-prompt",
    episodeBaselineCheckpointID: String = "checkpoint",
    decisionBoundaryID: String = "boundary",
    boundarySequence: Int64 = 1
) throws -> CoordinatorBinding {
    try CoordinatorBinding(
        projectID: projectID,
        sessionID: sessionID,
        sourceTurnID: sourceTurnID,
        sourcePromptID: sourcePromptID,
        episodeID: episodeID,
        episodeRootPromptID: episodeRootPromptID,
        episodeBaselineCheckpointID: episodeBaselineCheckpointID,
        decisionBoundaryID: decisionBoundaryID,
        boundarySequence: boundarySequence
    )
}

@Test("RFC3339 instants preserve nanosecond ordering and normalize offsets")
func RFC3339NanosecondOrdering() throws {
    let zero = try RFC3339Instant("2026-08-21T01:00:00.000000000Z")
    let one = try RFC3339Instant("2026-08-21T01:00:00.000000001Z")
    #expect(zero < one)
    #expect(one.nanosecond == 1)

    let offset = try RFC3339Instant("2026-08-21T10:00:00.123456789+09:00")
    let utc = try RFC3339Instant("2026-08-21T01:00:00.123456789Z")
    #expect(offset == utc)
    #expect(Set([offset, utc]).count == 1)
    #expect(offset.rawValue == "2026-08-21T10:00:00.123456789+09:00")

    #expect(
        try RFC3339Instant("2026-08-21T01:00:00.1Z")
            == RFC3339Instant("2026-08-21T01:00:00.100000000Z")
    )
    #expect(
        try RFC3339Instant("2026-08-21T01:00:00Z")
            == RFC3339Instant("2026-08-21T01:00:00.000000000Z")
    )
}

@Test("RFC3339 parser validates Gregorian leap dates and strict syntax")
func RFC3339CalendarValidation() throws {
    _ = try RFC3339Instant("2000-02-29T23:59:59.9-23:59")
    _ = try RFC3339Instant("0000-02-29T00:00:00Z")

    for invalid in [
        "1900-02-29T00:00:00Z",
        "2026-02-29T01:00:00Z",
        "2026-04-31T01:00:00Z",
        "2026-08-21T01:00:00.1234567890Z",
        "2026-08-21T01:00:00.Z",
        "2026-08-21t01:00:00z",
        "2026-08-21T01:00:00+24:00",
        "2026-08-21T01:00:60Z",
    ] {
        expectFoundationCode("timestamp_invalid") {
            _ = try RFC3339Instant(invalid)
        }
    }

    expectFoundationCode("packet_expiry_invalid") {
        _ = try RFC3339Instant("not-a-timestamp", code: "packet_expiry_invalid")
    }
}

@Test("binding keys remain unambiguous for adversarial identifier boundaries")
func CoordinatorBindingKeysAreTyped() throws {
    let first = try makeBinding(projectID: "a", sessionID: "b|c", sourceTurnID: "d")
    let second = try makeBinding(projectID: "a|b", sessionID: "c", sourceTurnID: "d")

    #expect(first.turnKey != second.turnKey)
    #expect(first.boundaryKey != second.boundaryKey)
    #expect(first.fullKey != second.fullKey)
    #expect(Set([first.turnKey, second.turnKey]).count == 2)
    #expect(Set([first.fullKey, second.fullKey]).count == 2)

    let roundTrip = try CoordinatorBinding(jsonObject: first.jsonObject)
    #expect(roundTrip == first)
    #expect(roundTrip.boundarySequence == 1)
}

@Test("binding validation preserves stable coordinator error codes")
func CoordinatorBindingValidationCodes() throws {
    expectFoundationCode("binding_incomplete") {
        _ = try makeBinding(sessionID: "")
    }
    expectFoundationCode("source_turn_id_invalid") {
        _ = try makeBinding(sourceTurnID: String(repeating: "a", count: 513))
    }
    expectFoundationCode("binding_incomplete") {
        _ = try makeBinding(boundarySequence: 0)
    }
    expectFoundationCode("project_id_invalid") {
        _ = try makeBinding(projectID: "project_cafe\u{301}")
    }

    var missing = try makeBinding().jsonObject
    missing.removeValue(forKey: "source_prompt_id")
    expectFoundationCode("binding_incomplete") {
        _ = try CoordinatorBinding(jsonObject: missing)
    }
}

@Test("continuation tokens enforce entropy bounds and base64url encoding")
func ContinuationTokenEntropyBounds() throws {
    expectFoundationCode("token_entropy_too_low") {
        _ = try ContinuationTokenMaterial.generate(bytes: 15)
    }
    expectFoundationCode("token_size_too_large") {
        _ = try ContinuationTokenMaterial.generate(bytes: 769)
    }

    let minimum = try ContinuationTokenMaterial.generate(bytes: 16)
    let defaultMaterial = try ContinuationTokenMaterial.generate()
    let maximum = try ContinuationTokenMaterial.generate(bytes: 768)
    #expect(minimum.entropyBits == 128)
    #expect(defaultMaterial.entropyBits == 256)
    #expect(maximum.entropyBits == 6_144)
    #expect(maximum.token.count == 1_024)
    #expect(
        [minimum.token, defaultMaterial.token, maximum.token].allSatisfy { token in
            token.utf8.allSatisfy { byte in
                (0x41...0x5A).contains(byte)
                    || (0x61...0x7A).contains(byte)
                    || (0x30...0x39).contains(byte)
                    || byte == 0x2D
                    || byte == 0x5F
            }
        }
    )
    #expect(minimum.token != defaultMaterial.token)
    #expect(minimum.verifyGeneratedIntegrity())
    #expect(defaultMaterial.verifyGeneratedIntegrity())
    #expect(maximum.verifyGeneratedIntegrity())
}

@Test("token fingerprints use SHA-256 or configured HMAC and verify in constant work")
func ContinuationTokenFingerprintVerification() throws {
    let material = try ContinuationTokenMaterial.generate()
    #expect(material.fingerprint.count == 71)
    #expect(ContinuationTokenMaterial.verify(token: material.token, fingerprint: material.fingerprint))
    #expect(!ContinuationTokenMaterial.verify(token: material.token + "x", fingerprint: material.fingerprint))
    #expect(!ContinuationTokenMaterial.verify(token: material.token, fingerprint: "sha256:not-hex"))
    #expect(!ContinuationTokenMaterial.verify(token: material.token, fingerprint: material.fingerprint.uppercased()))

    #expect(
        try ContinuationTokenMaterial.fingerprint(for: "fixture")
            == "sha256:f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d"
    )
    #expect(ContinuationTokenMaterial.constantTimeEqual("same", "same"))
    #expect(!ContinuationTokenMaterial.constantTimeEqual("short", "a-different-length"))

    let key = Data("fictional-coordinator-hmac-key".utf8)
    let hmac = try ContinuationTokenMaterial.generate(hmacKey: key)
    #expect(hmac.fingerprint.hasPrefix("hmac-sha256:"))
    #expect(hmac.fingerprint.count == 76)
    #expect(ContinuationTokenMaterial.verify(token: hmac.token, fingerprint: hmac.fingerprint, hmacKey: key))
    #expect(
        !ContinuationTokenMaterial.verify(
            token: hmac.token,
            fingerprint: hmac.fingerprint,
            hmacKey: Data("wrong-key".utf8)
        )
    )
    #expect(!ContinuationTokenMaterial.verify(token: hmac.token, fingerprint: hmac.fingerprint))
    #expect(hmac.verifyGeneratedIntegrity())
}
