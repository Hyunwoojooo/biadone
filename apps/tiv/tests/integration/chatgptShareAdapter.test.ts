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

  it("restores conversations embedded inside React Flight row strings", async () => {
    const fixture = makeEnqueueFixture([
      `66:${JSON.stringify({
        _1: {
          author: { role: "user" },
          id: "u1",
          content: {
            content_type: "text",
            parts: ["Flight row 안의 사용자 메시지"]
          }
        },
        _2: {
          author: { role: "assistant" },
          id: "a1",
          content: {
            content_type: "text",
            parts: ["Flight row 안의 답변 메시지"]
          }
        },
        linear_conversation: [{ message: "_1" }, { message: "_2" }]
      })}`,
      "P67:[{}]"
    ]);

    const result = await importChatGPTShareUrl({
      url: "https://chatgpt.com/share/react-flight-fixture",
      fetchHtml: async () => fixture
    });

    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(result.conversation.messages[0]?.text).toContain("사용자 메시지");
  });

  it("restores conversations from flat React Flight table payloads", async () => {
    const fixture = makeEnqueueFixture([
      "id",
      "author",
      "role",
      "content",
      "content_type",
      "parts",
      "user",
      "assistant",
      "text",
      "flat table user message",
      "flat table assistant message",
      { _0: 9, _1: 13, _3: 15 },
      { _0: 10, _1: 14, _3: 16 },
      { _2: 6 },
      { _2: 7 },
      { _4: 8, _5: [9] },
      { _4: 8, _5: [10] },
      "linear_conversation",
      [11, 12]
    ]);

    const result = await importChatGPTShareUrl({
      url: "https://chatgpt.com/share/react-flight-table-fixture",
      fetchHtml: async () => fixture
    });

    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(result.conversation.messages[1]?.text).toContain("assistant message");
  });
});

function makeEnqueueFixture(payload: unknown): string {
  const encodedPayload = JSON.stringify(JSON.stringify(payload));
  return `<!doctype html><script>window.__reactRouterContext.streamController.enqueue(${encodedPayload});</script>`;
}
