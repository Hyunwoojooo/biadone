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
  it("preserves message timestamps and derives conversation elapsed time", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "u1",
        role: "user",
        content: { parts: ["시간 포함 요청"] },
        createTime: 1_717_219_067.363,
        updateTime: 1_717_219_068
      },
      {
        id: "a1",
        role: "assistant",
        content: { parts: ["시간 포함 답변입니다."] },
        createTime: 1_717_219_127.363
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]).toMatchObject({
      createdAt: "2024-06-01T05:17:47.363Z",
      updatedAt: "2024-06-01T05:17:48.000Z"
    });
    expect(conversation.messages[1]?.createdAt).toBe(
      "2024-06-01T05:18:47.363Z"
    );
    expect(conversation.stats).toMatchObject({
      startedAt: "2024-06-01T05:17:47.363Z",
      endedAt: "2024-06-01T05:18:47.363Z",
      durationSeconds: 60
    });
  });

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

  it("filters system and empty messages while retaining tool results as context", () => {
    const rawMessages: RawChatGPTMessage[] = [
      { id: "s1", role: "system", content: { parts: ["hidden"] } },
      { id: "t1", role: "tool", content: { parts: ["internal"] } },
      { id: "a1", role: "assistant", content: { parts: [""] } },
      { id: "u1", role: "user", content: { parts: ["visible"] } }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]?.metadata).toMatchObject({
      messageCategory: "context_signal",
      contextSignalType: "connector_tool_result"
    });
    expect(conversation.messages[1]?.text).toBe("visible");
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

  it("classifies generic search and pointer JSON as context signals", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: {
          parts: [
            JSON.stringify({
              queries: ["JARVIS context graph"],
              response_length: "medium"
            })
          ]
        }
      },
      {
        id: "a2",
        role: "assistant",
        content: {
          parts: [
            JSON.stringify({
              pointers: ["1:4", "1:1"]
            })
          ]
        }
      },
      {
        id: "a3",
        role: "assistant",
        content: {
          parts: [
            JSON.stringify({
              search_query: [{ q: "OpenAI shared links" }]
            })
          ]
        }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(
      conversation.messages.map((message) => message.metadata.contextSignalType)
    ).toEqual(["search_query", "pointer_reference", "search_query"]);
    expect(conversation.stats.cleanConversationMessages).toBe(0);
    expect(conversation.stats.contextSignalMessages).toBe(3);
  });

  it("classifies shell, python, and sandbox artifact logs as context signals", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: { parts: ["bash -lc cat /home/oai/skills/docx/SKILL.md"] }
      },
      {
        id: "a2",
        role: "assistant",
        content: { parts: ["python - <<'PY'\nprint('hello')\nPY"] }
      },
      {
        id: "a3",
        role: "assistant",
        content: {
          parts: [
            "[CODEX_IMPLEMENTATION_PLAN.md 다운로드](sandbox:/mnt/data/CODEX_IMPLEMENTATION_PLAN.md)"
          ]
        }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(
      conversation.messages.map((message) => message.metadata.messageCategory)
    ).toEqual(["context_signal", "context_signal", "context_signal"]);
    expect(
      conversation.messages.map((message) => message.metadata.contextSignalType)
    ).toEqual([
      "bash_execution",
      "python_execution",
      "artifact_delivery_candidate"
    ]);
    expect(conversation.stats.cleanConversationMessages).toBe(0);
  });

  it("keeps natural-language artifact delivery answers in clean conversation", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: {
          parts: [
            "완료했습니다. 수정 반영한 파일은 [HTML 다운로드](sandbox:/mnt/data/index.html)에서 받을 수 있습니다."
          ]
        }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]?.metadata.messageCategory).toBe(
      "clean_conversation"
    );
    expect(conversation.messages[0]?.metadata.assistantMessageType).toBe(
      "final_answer_with_artifact"
    );
    expect(conversation.messages[0]?.metadata.semanticAnalyzable).toBe(true);
  });

  it("marks short assistant preambles as transitions", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: { parts: ["좋습니다. 이제 나눠 보겠습니다."] }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(conversation.messages[0]?.metadata.messageCategory).toBe(
      "clean_conversation"
    );
    expect(conversation.messages[0]?.metadata.assistantMessageType).toBe(
      "transition"
    );
  });

  it("classifies connector, skill read, and redacted plugin outputs as context signals", () => {
    const rawMessages: RawChatGPTMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: { parts: [JSON.stringify({ paths: ["Figma"], query: "create" })] }
      },
      {
        id: "a2",
        role: "assistant",
        content: {
          parts: [
            JSON.stringify({
              uri: "skill://figma/figma-use/SKILL.md",
              start_line: 1,
              num_lines: 120
            })
          ]
        }
      },
      {
        id: "a3",
        role: "assistant",
        content: { parts: ["The output of this plugin was redacted."] }
      }
    ];

    const conversation = normalizeConversation({ ...baseInput, rawMessages });

    expect(
      conversation.messages.map((message) => message.metadata.contextSignalType)
    ).toEqual(["connector_tool_call", "skill_read", "redacted_tool_result"]);
    expect(conversation.stats.cleanConversationMessages).toBe(0);
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
