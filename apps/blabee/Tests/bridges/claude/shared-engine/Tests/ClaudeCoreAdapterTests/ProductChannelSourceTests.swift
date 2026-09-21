@testable import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

@Suite("Product Channel source binding")
struct ProductChannelSourceTests {
    @Test("Only the complete enrolled source wrapper preserves a pending selection",
          arguments: ["exact", "bare", "wrong_source", "changed_body", "batched", "trailing_text"])
    func selectionWrapper(_ variant: String) throws {
        let f = try ProductAuthorityFixture(storage: .lifecycleMemory)
        try f.prepare()
        let boundary = f.boundaryID
        let event = try f.selectedEvent()
        let id = try #require(event["selection_id"] as? String)
        let token = try #require(event["delivery_token"] as? String)
        let content = "Blabee selection reference. Call claim_selection_v1 with these values; execute only the returned action after a successful claim.\n"
            + "{\"selection_id\":\"\(id)\",\"delivery_token\":\"\(token)\"}"
        let wrapper = "<channel source=\"blabee-claude\" selection_id=\"\(id)\">\n\(content)\n</channel>"
        let text: String
        switch variant {
        case "bare": text = content
        case "wrong_source": text = wrapper.replacingOccurrences(of: "source=\"blabee-claude\"", with: "source=\"other-server\"")
        case "changed_body": text = wrapper.replacingOccurrences(of: "Blabee selection", with: "Another selection")
        case "batched": text = wrapper + "\n" + wrapper
        case "trailing_text": text = wrapper + "\ncontinue"
        default: text = wrapper
        }
        try f.hook("UserPromptSubmit", ["prompt_id": productID(), "prompt_sha256": productDigest(text)])
        if variant == "exact" {
            #expect(f.boundaryID == boundary)
            let action = try f.claim(event)
            #expect(action["selection_id"] as? String == id)
            try f.complete(id)
        } else {
            #expect(f.boundaryID != boundary)
            productWireRejected("binding_mismatch") { try f.claim(event) }
            #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.isEmpty == true)
        }
    }

    @Test("A configured plugin source differs from standalone and cannot use bare probe content",
          arguments: ["exact", "standalone", "bare"])
    func configuredPluginProbe(_ variant: String) throws {
        // This validates source binding only. It does not qualify or enable a
        // plugin in the installed service's separate enrollment allowlist.
        let source = "plugin:blabee:blabee-claude"
        let f = try ProductAuthorityFixture(storage: .lifecycleMemory, channelSource: source)
        try f.startup(); try f.prompt(); try f.open(); try f.emit()
        let boundary = f.boundaryID
        _ = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        let event = try #require(try f.poll())
        #expect(event["channel_source"] as? String == source)
        let id = try #require(event["probe_id"] as? String)
        let nonce = try #require(event["nonce"] as? String)
        let content = "Blabee connection probe. Call ack_readiness_probe_v1 with these values; do not run a task.\n"
            + "{\"probe_id\":\"\(id)\",\"nonce\":\"\(nonce)\"}"
        let observedSource = variant == "standalone" ? "blabee-claude" : source
        let wrapper = "<channel source=\"\(observedSource)\" kind=\"readiness_probe\" probe_id=\"\(id)\">\n\(content)\n</channel>"
        try f.hook("UserPromptSubmit", ["prompt_id": productID(), "prompt_sha256": productDigest(variant == "bare" ? content : wrapper)])
        if variant == "exact" {
            #expect(f.boundaryID == boundary)
            let reply = try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": id, "nonce": nonce])
            #expect(reply["acknowledged"] as? Bool == true)
            #expect(try f.snapshot()["ready"] as? Bool == true)
        } else {
            #expect(f.boundaryID != boundary)
            #expect((try f.snapshot()["cards"] as? [[String: Any]])?.isEmpty == true)
        }
    }
}
