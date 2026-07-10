import { describe, expect, it } from "vitest";

import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import { convertRuleResultToSemanticItems } from "../../src/core/extractors/ruleSemanticAdapter";
import type { CanonicalConversation, CanonicalMessage } from "../../src/core/types/conversation";

describe("convertRuleResultToSemanticItems", () => {
  it("maps rule output into the common SemanticItem contract", () => {
    const conversation = createConversation([
      message(1, "user", "PDF는 추후로 빼자. 링크로만 진행하자."),
      message(2, "assistant", "링크 기반 방향으로 정리했습니다."),
      message(3, "user", "노션용 md 파일로 만들어줘.")
    ]);

    const items = convertRuleResultToSemanticItems(extractMockStructure(conversation));

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "intent", source: "rule" }),
        expect.objectContaining({ type: "decision", status: "deferred" }),
        expect.objectContaining({ type: "decision", status: "confirmed" }),
        expect.objectContaining({ type: "action", category: "user_requested" }),
        expect.objectContaining({ type: "preference", category: "format" })
      ])
    );
    expect(items.every((item) => item.sourceItemId !== null)).toBe(true);
  });
});

function createConversation(messages: CanonicalMessage[]): CanonicalConversation {
  return {
    id: "conv_semantic",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/test",
      normalizedUrl: "https://chatgpt.com/share/test",
      shareId: "test",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-10T00:00:00.000Z"
    },
    title: "Semantic test",
    language: "ko",
    importedAt: "2026-07-10T00:00:00.000Z",
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages: messages.filter((item) => item.role === "user").length,
      assistantMessages: messages.filter((item) => item.role === "assistant").length,
      unsupportedMessages: 0,
      cleanConversationMessages: messages.length,
      contextSignalMessages: 0,
      excludedInternalMessages: 0,
      totalChars: messages.reduce((sum, item) => sum + item.text.length, 0)
    },
    warnings: []
  };
}

function message(index: number, role: "user" | "assistant", text: string): CanonicalMessage {
  return {
    id: `msg_${index}`,
    index,
    role,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw_${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory: "clean_conversation",
      semanticAnalyzable: true
    }
  };
}
