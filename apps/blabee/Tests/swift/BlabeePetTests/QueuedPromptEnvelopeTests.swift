import CoordinatorSwift
import Foundation
import Testing

@Suite("Queued action preview byte limits")
struct QueuedPromptEnvelopeTests {
    private let reference = String(repeating: "ab", count: 16)
    private var action: [String: Any] {
        ["title": "Preview", "objective": "a", "constraints": ["Keep existing work"],
         "done_when": ["Report the result"]]
    }

    @Test("Registration preflight rejects escaped expansion even when action JSON is bounded")
    func escapedExpansion() throws {
        var value = action
        value["constraints"] = [String(repeating: "\u{200D}", count: 8_192),
                                String(repeating: "\u{200D}", count: 8_192)]
        let original = try StrictJSONTransport.data(forJSONObject: value)
        #expect(original.count < 60_000)
        #expect(!QueuedPromptEnvelope.canRender(action: value))
        #expect(QueuedPromptEnvelope.message(reference: reference, action: value) == nil)
        #expect(try StrictJSONTransport.data(forJSONObject: value) == original)
    }

    @Test("Complete preview includes fixed text and quoting at the exact UTF-8 limit",
          arguments: [-1, 0, 1])
    func exactByteBoundary(delta: Int) throws {
        var value = action
        let base = try #require(QueuedPromptEnvelope.message(reference: reference, action: value))
        let padding = QueuedPromptEnvelope.maximumMessageBytes - base.utf8.count
        value["objective"] = String(repeating: "a", count: padding + 1 + delta)
        let rendered = QueuedPromptEnvelope.message(reference: reference, action: value)
        #expect(QueuedPromptEnvelope.canRender(action: value) == (delta <= 0))
        #expect((rendered != nil) == (delta <= 0))
        if let rendered {
            #expect(rendered.utf8.count == QueuedPromptEnvelope.maximumMessageBytes + delta)
            #expect(QueuedPromptEnvelope.classify(rendered) == .exact(reference: reference))
            #expect(QueuedPromptEnvelope.matches(rendered, reference: reference, action: value))
        }
    }

    @Test("Visible escaping and line quoting count toward the final byte limit")
    func escapedByteBoundary() throws {
        var value = action
        value["constraints"] = [String(repeating: "\u{200D}", count: 8_000),
                                String(repeating: "\n", count: 8_000)]
        let base = try #require(QueuedPromptEnvelope.message(reference: reference, action: value))
        let padding = QueuedPromptEnvelope.maximumMessageBytes - base.utf8.count
        value["objective"] = String(repeating: "a", count: padding + 1)
        let exact = try #require(QueuedPromptEnvelope.message(reference: reference, action: value))
        #expect(exact.utf8.count == QueuedPromptEnvelope.maximumMessageBytes)
        #expect(QueuedPromptEnvelope.canRender(action: value))
        value["objective"] = String(repeating: "a", count: padding + 2)
        #expect(!QueuedPromptEnvelope.canRender(action: value))
        #expect(QueuedPromptEnvelope.message(reference: reference, action: value) == nil)
    }

    @Test("Bounded Unicode and multiline actions remain intact for every valid reference",
          arguments: ["한글 👩‍💻\n둘째 줄\t확인", "English 🌻\n\\path\\file", "한글\u{202E} 표시"])
    func unicodeAndLines(objective: String) throws {
        var value = action
        value["objective"] = objective
        let original = try StrictJSONTransport.data(forJSONObject: value)
        #expect(QueuedPromptEnvelope.canRender(action: value))
        for reference in [reference, String(repeating: "0", count: 32), String(repeating: "f", count: 32)] {
            let rendered = try #require(QueuedPromptEnvelope.message(reference: reference, action: value))
            #expect(QueuedPromptEnvelope.matches(rendered, reference: reference, action: value))
            #expect(QueuedPromptEnvelope.matches(rendered.decomposedStringWithCanonicalMapping,
                                                reference: reference, action: value))
        }
        #expect(try StrictJSONTransport.data(forJSONObject: value) == original)
    }
}
