import { describe, expect, it } from "vitest";

import { createLlmShadowSegments } from "../../src/core/extractors/llmShadowSegmentation";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";
import type { TopicFlowItem } from "../../src/core/types/structures";

describe("createLlmShadowSegments", () => {
  it("preserves topic boundaries and overlaps the previous assistant for reaction context", () => {
    const conversation = createConversation([
      message(1, "user", "a".repeat(12)),
      message(2, "assistant", "b".repeat(12)),
      message(3, "user", "c".repeat(12)),
      message(4, "assistant", "d".repeat(12)),
      message(5, "assistant", "tool payload", "context_signal")
    ]);
    const topicFlow = [
      topic("topic_001", "첫 번째 주제", 1, 2),
      topic("topic_002", "두 번째 주제", 3, 4)
    ];

    const segments = createLlmShadowSegments(conversation, topicFlow, {
      maxCharsPerSegment: 25,
      maxMessagesPerSegment: 10,
      maxSegments: 10
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]?.messages.map((item) => item.index)).toEqual([1, 2]);
    expect(segments[0]?.contextMessages).toEqual([]);
    expect(segments[1]?.messages.map((item) => item.index)).toEqual([3, 4]);
    expect(segments[1]?.contextMessages.map((item) => item.index)).toEqual([2]);
    expect(segments.map((segment) => segment.label)).toEqual([
      "첫 번째 주제",
      "두 번째 주제"
    ]);
    expect(
      segments.flatMap((segment) => segment.messages.map((item) => item.index))
    ).toEqual([1, 2, 3, 4]);
  });

  it("rebalances long conversations to respect the maximum segment count", () => {
    const conversation = createConversation(
      Array.from({ length: 6 }, (_, index) =>
        message(
          index + 1,
          index % 2 === 0 ? "user" : "assistant",
          "x".repeat(10)
        )
      )
    );

    const segments = createLlmShadowSegments(conversation, [], {
      maxCharsPerSegment: 15,
      maxMessagesPerSegment: 10,
      maxSegments: 3
    });

    expect(segments).toHaveLength(3);
    expect(
      segments.flatMap((segment) => segment.messages.map((item) => item.index))
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

function topic(
  id: string,
  label: string,
  startMessageIndex: number,
  endMessageIndex: number
): TopicFlowItem {
  return {
    id,
    order: Number(id.slice(-3)),
    label,
    summary: label,
    startMessageIndex,
    endMessageIndex,
    changeReason: "new_user_question",
    evidenceMessageIndexes: [startMessageIndex],
    confidence: 0.9
  };
}

function createConversation(
  messages: CanonicalMessage[]
): CanonicalConversation {
  return {
    id: "conv_segments",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/segments",
      normalizedUrl: "https://chatgpt.com/share/segments",
      shareId: "segments",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-10T00:00:00.000Z"
    },
    title: "Segment test",
    language: "ko",
    importedAt: "2026-07-10T00:00:00.000Z",
    messages,
    stats: {
      startedAt: null,
      endedAt: null,
      durationSeconds: null,
      totalMessages: messages.length,
      userMessages: messages.filter((item) => item.role === "user").length,
      assistantMessages: messages.filter((item) => item.role === "assistant")
        .length,
      unsupportedMessages: 0,
      cleanConversationMessages: messages.filter(
        (item) => item.metadata.messageCategory === "clean_conversation"
      ).length,
      contextSignalMessages: messages.filter(
        (item) => item.metadata.messageCategory === "context_signal"
      ).length,
      excludedInternalMessages: 0,
      totalChars: messages.reduce((sum, item) => sum + item.text.length, 0)
    },
    warnings: []
  };
}

function message(
  index: number,
  role: "user" | "assistant",
  text: string,
  category: CanonicalMessage["metadata"]["messageCategory"] = "clean_conversation"
): CanonicalMessage {
  return {
    id: `msg_${index}`,
    index,
    role,
    createdAt: null,
    updatedAt: null,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw_${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory: category,
      semanticAnalyzable: category === "clean_conversation"
    }
  };
}
