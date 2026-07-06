import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { importChatGPTShareUrl } from "../../src/core/adapters/chatgpt-share";

describe("ChatGPTShareAdapter", () => {
  it("converts fixture HTML into CanonicalConversation", async () => {
    const fixture = await readFile(
      join(process.cwd(), "tests/fixtures/chatgpt-share/simple-ko.html"),
      "utf8"
    );

    const result = await importChatGPTShareUrl({
      url: "https://chatgpt.com/share/simple-ko",
      fetchHtml: async () => fixture
    });

    expect(result.raw?.payloadCount).toBe(1);
    expect(result.conversation.stats.totalMessages).toBe(2);
    expect(result.conversation.stats.userMessages).toBe(1);
    expect(result.conversation.stats.assistantMessages).toBe(1);
    expect(result.conversation.messages[0]?.role).toBe("user");
    expect(result.conversation.messages[0]?.text).toContain(
      "JARVIS Context Mapper"
    );
    expect(result.conversation.messages[1]?.role).toBe("assistant");
    expect(result.conversation.messages[1]?.text).toContain("공유 링크 기반");
  });
});
