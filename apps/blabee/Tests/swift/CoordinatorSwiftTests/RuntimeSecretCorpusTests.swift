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
}
