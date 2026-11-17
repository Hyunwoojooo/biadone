import Foundation
import Testing
@testable import CoordinatorSwift

@Suite("Runtime secret registration and decoded JSON detection")
struct RuntimeSecretCorpusTests {
    @Test(
        "registered secrets are detected in every decoded JSON string surface",
        arguments: [false, true], ["object", "array", "nested_array", "root", "key"]
    )
    func detectsEveryStringSurface(escaped: Bool, surface: String) throws {
        let secret = escaped
            ? "FictionalToken_\"escaped\"\\tail\n012345"
            : "FictionalToken_Plain_012345"
        let corpus = RuntimeSecretCorpus()
        corpus.register(secret)
        let candidate = "prefix \(secret) suffix"
        let value: Any
        switch surface {
        case "object": value = ["summary": candidate]
        case "array": value = ["constraints": [candidate]]
        case "nested_array": value = ["constraints": [[candidate]]]
        case "root": value = candidate
        default: value = [candidate: "safe"]
        }
        let encoded = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        let decoded = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed])

        // A mandatory JSON escape removes the original byte substring. The
        // decoded scan must still reject it at all five locations.
        #expect(corpus.containsKnownSecret(in: encoded) == !escaped)
        #expect(corpus.containsKnownSecret(inJSONObject: decoded))
        #expect(throws: CoordinatorError.self) {
            try corpus.assertNoKnownSecret(inJSONObject: decoded)
        }
    }

    @Test(
        "recognized secret fields remain discoverable in nested dictionaries and arrays",
        arguments: ["continuation_token", "correlation_token", "raw_continuation_token", "access_token", "refresh_token"]
    )
    func registersNestedKnownFields(key: String) {
        let secret = "FictionalRegisteredSecret_012345"
        let corpus = RuntimeSecretCorpus()
        let value: [String: Any] = ["wrapper": [["nested": [[key: secret]]]]]
        corpus.registerKnownSecrets(inJSONObject: value)

        #expect(corpus.containsKnownSecret(in: Data(secret.utf8)))
        #expect(corpus.containsKnownSecret(inJSONObject: [secret]))
    }

    @Test(
        "untyped public strings are never enrolled as secrets",
        arguments: ["object", "array", "nested_array", "root", "key", "known_field_array"]
    )
    func doesNotRegisterPublicStrings(surface: String) throws {
        let publicValue = "OrdinaryPublicText_012345"
        let corpus = RuntimeSecretCorpus()
        let value: Any
        switch surface {
        case "object": value = ["summary": publicValue]
        case "array": value = [publicValue]
        case "nested_array": value = ["wrapper": [[publicValue]]]
        case "root": value = publicValue
        case "key": value = [publicValue: "safe"]
        default: value = ["access_token": [publicValue]]
        }
        corpus.registerKnownSecrets(inJSONObject: value)

        #expect(!corpus.containsKnownSecret(in: Data(publicValue.utf8)))
        #expect(!corpus.containsKnownSecret(inJSONObject: value))
        try corpus.assertNoKnownSecret(inJSONObject: value)
    }

    @Test("registration still ignores values shorter than eight UTF-8 bytes")
    func preservesMinimumSecretLength() {
        let corpus = RuntimeSecretCorpus()
        corpus.register("Short7!")
        corpus.registerKnownSecrets(inJSONObject: ["access_token": "Tiny123"])
        corpus.register(Data([1, 2, 3, 4, 5, 6, 7]))

        #expect(!corpus.containsKnownSecret(inJSONObject: ["Short7!", "Tiny123"]))
        #expect(!corpus.containsKnownSecret(in: Data([1, 2, 3, 4, 5, 6, 7])))
        corpus.register("Eight123")
        #expect(corpus.containsKnownSecret(inJSONObject: ["Eight123"]))
    }

    @Test("raw binary secrets retain byte-level protection")
    func preservesBinarySecretDetection() throws {
        let corpus = RuntimeSecretCorpus()
        let secret = Data([0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8])
        corpus.register(secret)
        var output = Data([0x01])
        output.append(secret)
        output.append(0x02)

        #expect(corpus.containsKnownSecret(in: output))
        #expect(throws: CoordinatorError.self) { try corpus.assertNoKnownSecret(in: output) }
        let ordinary: [Any] = ["ordinary", NSNull(), 1, true]
        #expect(!corpus.containsKnownSecret(inJSONObject: ordinary))
        try corpus.assertNoKnownSecret(inJSONObject: ordinary)
    }

    @Test("one-time tokens leave the corpus 24 hours after their latest registration; others stay")
    func ephemeralTokensExpire() throws {
        let clock = CorpusTestClock()
        let corpus = RuntimeSecretCorpus(monotonicNanoseconds: clock.now)
        corpus.register("FictionalStorageKey_0123456789")
        corpus.registerEphemeral("FictionalCorrelation_0123456789")
        corpus.registerKnownEphemeralSecrets(inJSONObject: ["continuation_token": "FictionalContinuation_0123456789"])
        #expect(corpus.count == 3)
        let hour: UInt64 = 3_600 * 1_000_000_000
        clock.advance(23 * hour)
        corpus.registerEphemeral("FictionalCorrelation_0123456789")  // refreshed
        #expect(corpus.containsKnownSecret(in: Data("x FictionalContinuation_0123456789".utf8)))
        clock.advance(hour)
        #expect(!corpus.containsKnownSecret(in: Data("x FictionalContinuation_0123456789".utf8)))
        #expect(corpus.containsKnownSecret(in: Data("x FictionalCorrelation_0123456789".utf8)))
        #expect(corpus.containsKnownSecret(in: Data("x FictionalStorageKey_0123456789".utf8)))
        clock.advance(24 * hour)
        #expect(corpus.count == 1)
        #expect(corpus.containsKnownSecret(in: Data("x FictionalStorageKey_0123456789".utf8)))
    }

    @Test("one-time tokens are bounded; the oldest registration leaves first")
    func ephemeralTokensAreBounded() {
        let corpus = RuntimeSecretCorpus(monotonicNanoseconds: { 0 })
        for index in 0..<(RuntimeSecretCorpus.maximumEphemeralSecrets + 1) {
            corpus.registerEphemeral("FictionalBurstToken_\(index)")
        }
        #expect(corpus.count == RuntimeSecretCorpus.maximumEphemeralSecrets)
        #expect(!corpus.containsKnownSecret(in: Data("FictionalBurstToken_0 ".utf8)))
        #expect(corpus.containsKnownSecret(in: Data("FictionalBurstToken_1 ".utf8)))
    }

    @Test("a secret registered as permanent never expires even if also registered as one-time")
    func permanentWinsOverEphemeral() {
        let clock = CorpusTestClock()
        let corpus = RuntimeSecretCorpus(monotonicNanoseconds: clock.now)
        corpus.registerEphemeral("FictionalSharedToken_0123456789")
        corpus.register("FictionalSharedToken_0123456789")
        clock.advance(48 * 3_600 * 1_000_000_000)
        #expect(corpus.containsKnownSecret(in: Data("FictionalSharedToken_0123456789".utf8)))
        #expect(corpus.count == 1)
    }
}

private final class CorpusTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 1_000

    func now() -> UInt64 { lock.withLock { value } }
    func advance(_ nanoseconds: UInt64) { lock.withLock { value += nanoseconds } }
}
