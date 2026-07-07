import { describe, expect, it } from "vitest";

import { normalizeConversation } from "../../src/core/adapters/chatgpt-share";
import type { RawChatGPTMessage } from "../../src/core/adapters/chatgpt-share";

const baseInput = {
  originalUrl: "https://chatgpt.com/share/test",
  normalizedUrl: "https://chatgpt.com/share/test",
  shareId: "test",
  fetchedAt: "2026-07-05T00:00:00.000Z",
  adapterVersion: "0.1.0"
};

describe("normalizeConversation", () => {
  it("normalizes user and assistant roles and assigns indexes", () => {
    const rawMessages: RawChatGPTMessage[] = [
      { id: "u1", role: "user", content: { parts: ["hello"] } },
      { id: "a1", role: "assistant", content: { parts: ["hi"] } }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(conversation.messages.map((message) => message.index)).toEqual([1, 2]);
  });

  it("filters system, tool, and empty messages", () => {
    const rawMessages: RawChatGPTMessage[] = [
      { id: "s1", role: "system", content: { parts: ["hidden"] } },
      { id: "t1", role: "tool", content: { parts: ["internal"] } },
      { id: "a1", role: "assistant", content: { parts: [""] } },
      { id: "u1", role: "user", content: { parts: ["visible"] } }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.text).toBe("visible");
  });

  it("turns unsupported content into a placeholder", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "u1",
        role: "user",
        content: { content_type: "image_asset_pointer" }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]?.metadata.hasUnsupportedContent).toBe(true);
    expect(conversation.messages[0]?.blocks[0]).toMatchObject({
      type: "unsupported"
    });
  });

  it("classifies tool-call JSON as context signals", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: {
          parts: [
            JSON.stringify({
              system1_search_query: [{ q: "PlayMCP" }],
              response_length: "medium"
            })
          ]
        }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]?.metadata.messageCategory).toBe(
      "context_signal"
    );
    expect(conversation.messages[0]?.metadata.contextSignalType).toBe(
      "search_query"
    );
    expect(conversation.stats.contextSignalMessages).toBe(1);
  });

  it("classifies internal unsupported content separately", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: { content_type: "thoughts" }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]?.metadata.messageCategory).toBe(
      "excluded_internal"
    );
    expect(conversation.messages[0]?.metadata.internalContentType).toBe(
      "thoughts"
    );
    expect(conversation.stats.excludedInternalMessages).toBe(1);
  });
});
