import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

private typealias Codec = ClaudeProductWireCodec

private struct WireFixture {
    let name: String
    let contract: String
    let valid: Bool
    let value: [String: Any]
}

private func fixtures() throws -> [WireFixture] {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    // The checked-in container includes deliberately invalid fractional inputs.
    // Decode that trusted container permissively, then validate each case's raw
    // envelope through the real codec. Duplicate-key/byte fixtures stay separate.
    let data = try Data(contentsOf: root.appendingPathComponent("fixtures/product-wire/cases.json"))
    let value = try object(JSONSerialization.jsonObject(with: data))
    #expect(value["schema_version"] as? String == "blabee.product-wire.fixtures.v1")
    return try #require(value["cases"] as? [[String: Any]]).map {
        WireFixture(name: try #require($0["name"] as? String),
                    contract: try #require($0["contract"] as? String),
                    valid: try #require($0["valid"] as? Bool),
                    value: try #require($0["value"] as? [String: Any]))
    }
}

private func fixture(_ contract: String, _ kind: String, _ operation: String,
                     provider: String = "claude") throws -> [String: Any] {
    try #require(try fixtures().first {
        $0.valid && $0.contract == contract && $0.value["kind"] as? String == kind
            && $0.value["operation"] as? String == operation && $0.value["provider"] as? String == provider
            && (kind == "request" || $0.value["ok"] as? Bool == true)
    }).value
}

private func json(_ value: [String: Any]) throws -> Data { try StrictJSONTransport.data(forJSONObject: value) }
private func object(_ value: Any?) throws -> [String: Any] { try #require(value as? [String: Any]) }
private func uuid(_ n: Int = 99) -> String {
    String(format: "%08d-0000-4000-8000-%012d", n, n)
}
private func connection(_ request: [String: Any], owner: Bool = true) throws -> Codec.ExpectedConnection {
    let expected = try object(request["authority"] ?? request["target"] ?? request["payload"])
    let service = try #require(expected["service_incarnation"] as? String)
    return Codec.ExpectedConnection(
        serviceIncarnation: try #require(UUID(uuidString: service)),
        ownerConnectionID: owner ? (expected["owner_connection_id"] as? String).flatMap(UUID.init(uuidString:)) : nil)
}
private func rejects(_ expected: Codec.WireError? = nil, _ body: () throws -> Void) {
    do { try body(); Issue.record("Wire codec unexpectedly accepted the input") }
    catch let error as Codec.WireError { if let expected { #expect(error == expected) } }
    catch { Issue.record("Wire codec leaked an unexpected error type") }
}
private func nested(_ value: inout [String: Any], _ key: String,
                    _ edit: (inout [String: Any]) -> Void) throws {
    var child = try object(value[key]); edit(&child); value[key] = child
}

@Suite("Product wire codec")
private struct ProductWireCodecTests {
    @Test("Swift structure checks agree with shared independent JSON Schema fixtures")
    func sharedFixtures() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let all = try fixtures()
        #expect(all.count >= 131)
        for entry in all {
            do {
                _ = try codec.inspectEnvelope(json(entry.value))
                #expect(entry.valid, Comment(rawValue: entry.name))
            } catch {
                #expect(!entry.valid, Comment(rawValue: entry.name))
            }
        }
    }

    @Test("Every declared reply round-trips only with its request and connection")
    func responseRoundtrips() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        for entry in try fixtures() where entry.valid && entry.value["kind"] as? String == "response" {
            // Explicit variants exercise schema structure; their request IDs
            // and operation bindings still match the ordinary request fixture.
            let operation = try #require(entry.value["operation"] as? String)
            let provider = try #require(entry.value["provider"] as? String)
            var requestValue = try fixture(entry.contract, "request", operation, provider: provider)
            if operation == "hook", let waiter = (entry.value["result"] as? [String: Any])?["waiter"] as? [String: Any] {
                var payload = try object(requestValue["payload"])
                payload.removeValue(forKey: "source")
                payload["event"] = "Stop"
                payload["prompt_id"] = waiter["prompt_id"]
                payload["background_task_ids"] = [String]()
                requestValue["payload"] = payload
            }
            let request = try codec.decodeRequest(json(requestValue))
            let response = try codec.decodeResponse(json(entry.value), matching: request, connection: connection(requestValue))
            #expect(response.kind == .response)
            #expect(response.requestID == request.requestID)
            #expect(try codec.encodeResponse(entry.value, matching: request, connection: connection(requestValue))
                == response.canonicalJSON)
        }
    }

    @Test("Raw duplicate keys, escaped aliases, malformed bytes and resource limits reject")
    func strictRawTransport() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let original = try json(fixture("claude-owner.v1", "request", "renew"))
        let source = String(decoding: original, as: UTF8.self)
        let invalid = [
            Data(source.replacingOccurrences(of: "\"role\":\"owner\"", with: "\"role\":\"owner\",\"role\":\"owner\"").utf8),
            Data(source.replacingOccurrences(of: "\"renewal_sequence\":\"1\"",
                with: "\"renewal_sequence\":\"1\",\"renewal_\\u0073equence\":\"2\"").utf8),
            original + Data([0xff]),
            original + Data(" trailing".utf8),
            Data("[]".utf8),
            Data(repeating: 32, count: Codec.maximumMessageBytes + 1),
            Data((String(repeating: "{\"nested\":", count: Codec.maximumDepth + 1)
                  + "{}" + String(repeating: "}", count: Codec.maximumDepth + 1)).utf8),
        ]
        for bytes in invalid { rejects(.malformedJSON) { _ = try codec.inspectEnvelope(bytes) } }
    }

    @Test("Replies compare the contract, request ID, provider, role and operation")
    func commonCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let ownerValue = try fixture("claude-owner.v1", "request", "renew")
        let owner = try codec.decodeRequest(json(ownerValue))
        let context = try connection(ownerValue)
        var response = try fixture("claude-owner.v1", "response", "renew")
        response["request_id"] = uuid()
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: owner, connection: context) }
        let differentOperation = try fixture("claude-owner.v1", "response", "end")
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(differentOperation), matching: owner, connection: context) }
        let differentContract = try fixture("claude-session.v3", "response", "bridge.open")
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(differentContract), matching: owner, connection: context) }
        let claudeValue = try fixture("pet-provider.v1", "request", "snapshot")
        let claude = try codec.decodeRequest(json(claudeValue))
        let codexResponse = try fixture("pet-provider.v1", "response", "snapshot", provider: "codex")
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(codexResponse), matching: claude, connection: connection(claudeValue)) }
        let bridgeValue = try fixture("claude-session.v3", "request", "bridge.open")
        let bridge = try codec.decodeRequest(json(bridgeValue))
        let hookResponse = try fixture("claude-session.v3", "response", "hook")
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(hookResponse), matching: bridge, connection: connection(bridgeValue)) }
        rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(hookResponse)) }
    }

    @Test("Error replies cannot bypass request, authority, Pet target or enrollment connection correlation")
    func errorCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let operations = [
            ("claude-owner.v1", "enroll", "claude"),
            ("claude-owner.v1", "enroll_observed", "claude"),
            ("claude-owner.v1", "renew", "claude"),
            ("claude-session.v3", "bridge.poll", "claude"),
            ("pet-provider.v1", "snapshot", "claude"),
            ("pet-provider.v1", "snapshot", "codex"),
        ]
        let all = try fixtures()
        for (contract, operation, provider) in operations {
            let value = try fixture(contract, "request", operation, provider: provider)
            let request = try codec.decodeRequest(json(value))
            let context = try connection(value)
            let original = try #require(all.first {
                $0.valid && $0.contract == contract && $0.value["kind"] as? String == "response"
                    && $0.value["operation"] as? String == operation && $0.value["provider"] as? String == provider
                    && $0.value["ok"] as? Bool == false
            }).value
            _ = try codec.decodeResponse(json(original), matching: request, connection: context)
            var wrongRequest = original
            wrongRequest["request_id"] = uuid()
            rejects(.correlationMismatch) {
                _ = try codec.decodeResponse(json(wrongRequest), matching: request, connection: context)
            }
            if original["authority"] != nil || original["target"] != nil {
                var wrongBinding = original
                let key = original["authority"] != nil ? "authority" : "target"
                try nested(&wrongBinding, key) { $0["scope_id"] = uuid() }
                _ = try codec.inspectEnvelope(json(wrongBinding))
                rejects(.correlationMismatch) {
                    _ = try codec.decodeResponse(json(wrongBinding), matching: request, connection: context)
                }
            }
            rejects(.correlationMismatch) {
                _ = try codec.decodeResponse(json(original), matching: request,
                    connection: Codec.ExpectedConnection(serviceIncarnation: UUID(), ownerConnectionID: context.ownerConnectionID))
            }
            if context.ownerConnectionID != nil {
                rejects(.correlationMismatch) {
                    _ = try codec.decodeResponse(json(original), matching: request,
                        connection: Codec.ExpectedConnection(serviceIncarnation: context.serviceIncarnation, ownerConnectionID: UUID()))
                }
            }
        }
    }

    @Test("All six authority identifiers and owner connection context are exact")
    func authorityCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let requestValue = try fixture("claude-owner.v1", "request", "renew")
        let request = try codec.decodeRequest(json(requestValue))
        let context = try connection(requestValue)
        let original = try fixture("claude-owner.v1", "response", "renew")
        for field in ["scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch"] {
            var response = original
            try nested(&response, "authority") { $0[field] = uuid() }
            _ = try codec.inspectEnvelope(json(response)) // Well-formed, wrong binding.
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: context) }
        }
        rejects(.missingConnectionContext) {
            _ = try codec.decodeResponse(json(original), matching: request,
                connection: Codec.ExpectedConnection(serviceIncarnation: context.serviceIncarnation))
        }
        rejects(.correlationMismatch) {
            _ = try codec.decodeResponse(json(original), matching: request,
                connection: Codec.ExpectedConnection(serviceIncarnation: context.serviceIncarnation, ownerConnectionID: UUID()))
        }
        rejects(.correlationMismatch) {
            _ = try codec.decodeResponse(json(original), matching: request,
                connection: Codec.ExpectedConnection(serviceIncarnation: UUID(), ownerConnectionID: context.ownerConnectionID))
        }
    }

    @Test("Enrollment cannot accept client-assigned authority and matches its private-connection references")
    func enrollmentReferences() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let requestValue = try fixture("claude-owner.v1", "request", "enroll")
        let request = try codec.decodeRequest(json(requestValue))
        let original = try fixture("claude-owner.v1", "response", "enroll")
        #expect(requestValue["authority"] == nil)
        for field in ["service_incarnation", "owner_connection_id"] {
            var response = original
            try nested(&response, "authority") { $0[field] = uuid() }
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(requestValue)) }
        }
        var response = original
        try nested(&response, "result") { $0["grant_pipe_id"] = uuid() }
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(requestValue)) }
        // New scope/native/incarnation/epoch IDs are service-issued after the
        // request, not identifiers the client is permitted to assign.
        response = original
        try nested(&response, "authority") { $0["scope_id"] = uuid() }
        _ = try codec.decodeResponse(json(response), matching: request, connection: connection(requestValue))
    }

    @Test("Observed enrollment binds the actual native ID and adds no client-assigned scope authority")
    func observedEnrollmentReferences() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let originalRequest = try fixture("claude-owner.v1", "request", "enroll_observed")
        let originalResponse = try fixture("claude-owner.v1", "response", "enroll_observed")
        for source in ["startup", "resume", "fork"] {
            var value = originalRequest
            try nested(&value, "payload") { $0["source"] = source }
            let request = try codec.decodeRequest(json(value))
            _ = try codec.decodeResponse(json(originalResponse), matching: request, connection: connection(value))
            var wrongNativeID = originalResponse
            try nested(&wrongNativeID, "authority") { $0["native_session_id"] = uuid() }
            rejects(.correlationMismatch) {
                _ = try codec.decodeResponse(json(wrongNativeID), matching: request, connection: connection(value))
            }
        }
        let invalidSources: [Any] = ["compact", "clear", "Startup", "resume\n", "", 1, true, NSNull()]
        for invalidSource in invalidSources {
            var value = originalRequest
            try nested(&value, "payload") { $0["source"] = invalidSource }
            rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(value)) }
        }
        let invalidIDs: [Any] = ["native-session", "AAAAAAAA-0000-4000-8000-000000000099", "", 1, NSNull()]
        for invalidID in invalidIDs {
            var value = originalRequest
            try nested(&value, "payload") { $0["native_session_id"] = invalidID }
            rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(value)) }
        }
        for key in ["scope_id", "session_incarnation", "authority_epoch"] {
            var value = originalRequest
            try nested(&value, "payload") { $0[key] = uuid() }
            rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(value)) }
        }
        var legacy = originalRequest
        legacy["operation"] = "enroll"
        rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(legacy)) }
    }

    @Test("Renewal receipts and original selection results match the requesting operation")
    func operationCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let ownerValue = try fixture("claude-owner.v1", "request", "renew")
        let owner = try codec.decodeRequest(json(ownerValue))
        var response = try fixture("claude-owner.v1", "response", "renew")
        var result = try object(response["result"])
        try nested(&result, "lease") { $0["renewal_sequence"] = "2" }
        response["result"] = result
        rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: owner, connection: connection(ownerValue)) }
        for operation in ["selection.claim", "selection.complete"] {
            let value = try fixture("claude-session.v3", "request", operation)
            let request = try codec.decodeRequest(json(value))
            var response = try fixture("claude-session.v3", "response", operation)
            try nested(&response, "result") { $0["selection_id"] = uuid() }
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
    }

    @Test("Pet replies preserve scope, incarnation, authority epoch, generation and the complete v1 selection binding")
    func petCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let value = try fixture("pet-provider.v1", "request", "select")
        let request = try codec.decodeRequest(json(value))
        let original = try fixture("pet-provider.v1", "response", "select")
        for field in ["scope_id", "service_incarnation", "session_incarnation", "authority_epoch", "ui_generation"] {
            var response = original
            try nested(&response, "target") { $0[field] = field == "ui_generation" ? "2" : uuid() }
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
        for field in ["packet_id", "revision", "option_id", "selection_id"] {
            var response = original
            var result = try object(response["result"])
            try nested(&result, "selection") {
                $0[field] = field == "revision" ? 2 : (field == "selection_id" ? uuid() : "different")
            }
            response["result"] = result
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
        let bindingKeys = ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
                           "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"]
        for field in bindingKeys {
            var response = original
            var result = try object(response["result"])
            var selection = try object(result["selection"])
            try nested(&selection, "binding") { $0[field] = field == "boundary_sequence" ? 2 : "different" }
            result["selection"] = selection; response["result"] = result
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
    }

    @Test("Dismissal receipts bind every card and session field and cannot become selection or native approval")
    func petDismissalCorrelation() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        var value = try fixture("pet-provider.v1", "request", "select")
        var payload = try object(value["payload"])
        payload.removeValue(forKey: "option_id"); payload.removeValue(forKey: "selection_id")
        payload["interaction_id"] = "interaction-dismiss-fixture"
        value["operation"] = "dismiss_interaction"; value["payload"] = payload
        let request = try codec.decodeRequest(json(value))
        var original = value
        original["kind"] = "response"; original.removeValue(forKey: "payload")
        original["ok"] = true; original["result"] = ["dismissal": payload, "dismissed": true]
        _ = try codec.decodeResponse(json(original), matching: request, connection: connection(value))
        for field in ["interaction_id", "packet_id", "revision"] {
            var response = original
            var result = try object(response["result"])
            try nested(&result, "dismissal") { $0[field] = field == "revision" ? 2 : "different-card" }
            response["result"] = result
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
        for field in ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
                      "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"] {
            var response = original, result = try object(original["result"])
            var dismissal = try object(result["dismissal"])
            try nested(&dismissal, "binding") { $0[field] = field == "boundary_sequence" ? 2 : "different-session" }
            result["dismissal"] = dismissal; response["result"] = result
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
        for field in ["scope_id", "service_incarnation", "session_incarnation", "authority_epoch", "ui_generation"] {
            var response = original
            try nested(&response, "target") { $0[field] = field == "ui_generation" ? "2" : uuid() }
            rejects(.correlationMismatch) { _ = try codec.decodeResponse(json(response), matching: request, connection: connection(value)) }
        }
        for extra in ["option_id", "selection_id", "permission_id"] {
            var request = value
            try nested(&request, "payload") { $0[extra] = "not-a-dismissal-field" }
            rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(request)) }
        }
        var falseReceipt = original
        try nested(&falseReceipt, "result") { $0["dismissed"] = false }
        rejects(.invalidEnvelope) { _ = try codec.decodeResponse(json(falseReceipt), matching: request, connection: connection(value)) }
    }

    @Test("UInt64 string boundaries retain all bits and invalid numeric values reject")
    func integerBoundaries() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        for boundary in ["0", "9007199254740992", "18446744073709551615"] {
            var response = try fixture("claude-owner.v1", "response", "renew")
            var result = try object(response["result"])
            try nested(&result, "lease") { $0["deadline_nanoseconds"] = boundary }
            response["result"] = result
            let parsed = try codec.inspectEnvelope(json(response))
            let decoded = try StrictJSONTransport.object(from: parsed.canonicalJSON)
            #expect(try object(try object(decoded["result"])["lease"])["deadline_nanoseconds"] as? String == boundary)
        }
        let invalidValues: [Any] = ["18446744073709551616", "-1", "00", "1\n", "1.0", 1, true]
        for invalid in invalidValues {
            var response = try fixture("claude-owner.v1", "response", "renew")
            var result = try object(response["result"])
            try nested(&result, "lease") { $0["deadline_nanoseconds"] = invalid }
            response["result"] = result
            rejects(.invalidEnvelope) { _ = try codec.inspectEnvelope(json(response)) }
        }
    }

    @Test("Known credentials cannot hide in opaque values, array strings, keys or escaped JSON")
    func knownSecretReflection() throws {
        let corpus = RuntimeSecretCorpus()
        let secret = "synthetic-capability-for-wire-tests-only"
        corpus.register(secret)
        let codec = Codec(credentialCorpus: corpus)
        let original = try fixture("pet-provider.v1", "response", "snapshot", provider: "codex")
        let values: [[String: Any]] = [
            ["summary": secret], ["array": ["safe", [secret]]],
            [secret: "safe"], ["nested": ["prefix-" + secret + "-suffix"]],
        ]
        for value in values {
            var response = original
            var result = try object(response["result"])
            try nested(&result, "projection") { $0["value"] = value }
            response["result"] = result
            rejects(.secretReflection) { _ = try codec.inspectEnvelope(json(response)) }
        }
        var response = original
        var result = try object(response["result"])
        try nested(&result, "projection") { $0["value"] = ["text": secret] }
        response["result"] = result
        let escaped = secret.unicodeScalars.map { String(format: "\\u%04x", $0.value) }.joined()
        let raw = String(decoding: try json(response), as: UTF8.self).replacingOccurrences(of: secret, with: escaped)
        rejects(.secretReflection) { _ = try codec.inspectEnvelope(Data(raw.utf8)) }
        let requestValue = try fixture("pet-provider.v1", "request", "snapshot", provider: "codex")
        let request = try codec.decodeRequest(json(requestValue))
        rejects(.secretReflection) { _ = try codec.encodeResponse(response, matching: request, connection: connection(requestValue)) }
        #expect(!corpus.containsKnownSecret(in: Data("unregistered-public-text".utf8)))
    }

    @Test("Transient references appear only in MCP readiness and Hook delivery slots, never grants or acknowledgements")
    func oneUseReferences() throws {
        let corpus = RuntimeSecretCorpus()
        let codec = Codec(credentialCorpus: corpus)
        let cases = try fixtures().filter { $0.name.hasPrefix("poll/variant-") }
        #expect(cases.count == 2)
        for entry in cases { _ = try codec.inspectEnvelope(json(entry.value)) }
        _ = try codec.decodeRequest(json(fixture("claude-session.v3", "request", "readiness.ack")))
        _ = try codec.decodeRequest(json(fixture("claude-session.v3", "request", "selection.claim")))
        // A capability supplied in the syntactically permitted nonce slot must
        // still be rejected. Field position never overrides the credential corpus.
        corpus.register(String(repeating: "a", count: 64))
        for entry in cases { rejects(.secretReflection) { _ = try codec.inspectEnvelope(json(entry.value)) } }
    }

    @Test("Opaque DTOs remain explicitly unvalidated and Codex queue payloads preserve their existing fields")
    func opaqueBoundary() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        let proposal = try codec.decodeRequest(json(fixture("claude-session.v3", "request", "proposal.emit")))
        #expect(proposal.requiresInnerValidation)
        let requestValue = try fixture("pet-provider.v1", "request", "select", provider: "codex")
        let request = try codec.decodeRequest(json(requestValue))
        let responseValue = try fixture("pet-provider.v1", "response", "select", provider: "codex")
        let response = try codec.decodeResponse(json(responseValue), matching: request, connection: connection(requestValue))
        #expect(response.requiresInnerValidation)
        let decoded = try StrictJSONTransport.object(from: response.canonicalJSON)
        let receipt = try object(try object(try object(decoded["result"])["receipt"])["value"])
        #expect(receipt["status"] as? String == "queued_next_turn")
        #expect(receipt["queue_id"] as? String == "codex-queue-fixture")
        #expect(try json(receipt) == json(try object(try object(try object(responseValue["result"])["receipt"])["value"])))
        #expect(try object(requestValue["target"])["authority_epoch"] == nil)
        var old = requestValue
        old["schema_version"] = "blabee.pet.v1"
        rejects(.unsupportedVersion) { _ = try codec.inspectEnvelope(json(old)) }
    }

    @Test("Original v1 binding identifiers retain NFC and Unicode scalar rules")
    func bindingNormalization() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        var value = try fixture("pet-provider.v1", "request", "select", provider: "codex")
        var payload = try object(value["payload"])
        try nested(&payload, "binding") { $0["project_id"] = "Cafe\u{301}" }
        value["payload"] = payload
        rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(value)) }
        try nested(&payload, "binding") { $0["project_id"] = "Caf\u{e9}" }
        value["payload"] = payload
        _ = try codec.decodeRequest(json(value))
    }

    @Test("Missing and empty background observations remain distinguishable without inferring completion")
    func nativeObservationShape() throws {
        let codec = Codec(credentialCorpus: RuntimeSecretCorpus())
        var value = try #require(try fixtures().first { $0.name == "hook/variant-3" }).value
        let absent = try codec.decodeRequest(json(value))
        try nested(&value, "payload") { $0["background_task_ids"] = [] }
        let empty = try codec.decodeRequest(json(value))
        #expect(absent.canonicalJSON != empty.canonicalJSON)
        var payload = try object(value["payload"])
        payload["event"] = "SessionEnd"
        value["payload"] = payload
        rejects(.invalidEnvelope) { _ = try codec.decodeRequest(json(value)) }
    }
}
