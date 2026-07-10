import { describe, expect, it } from "vitest";

import { buildGptAuditMarkdown } from "../../src/core/export/gptAuditExport";
import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import { convertRuleResultToSemanticItems } from "../../src/core/extractors/ruleSemanticAdapter";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";

describe("buildGptAuditMarkdown", () => {
  it("renders GPT-readable audit sections with separation data", () => {
    const conversation = createConversation([
      message(1, "user", "MockExtractor 규칙을 구체적으로 만들어줘.", "clean_conversation"),
      message(2, "assistant", "규칙 초안을 만들었습니다.", "clean_conversation"),
      {
        ...message(
          3,
          "assistant",
          JSON.stringify({ system1_search_query: [{ q: "mock extractor" }] }),
          "context_signal"
        ),
        metadata: {
          messageCategory: "context_signal",
          contextSignalType: "search_query"
        }
      },
      {
        ...message(4, "assistant", "[thoughts 첨부]", "excluded_internal"),
        metadata: {
          messageCategory: "excluded_internal",
          internalContentType: "thoughts"
        }
      }
    ]);
    const result = extractMockStructure(conversation);

    const markdown = buildGptAuditMarkdown({
      analysisId: "ana_test",
      shareUrl: "https://chatgpt.com/share/test",
      conversation,
      result,
      hybridExtraction: {
        mode: "shadow",
        createdAt: "2026-07-10T00:00:00.000Z",
        ruleResult: {
          extractorVersion: result.extractor.version,
          items: convertRuleResultToSemanticItems(result)
        },
        llmResult: {
          status: "disabled",
          provider: null,
          model: null,
          items: [],
          error: { code: "SHADOW_DISABLED", message: "disabled in test" }
        }
      }
    });

    expect(markdown).toContain("# TIV GPT Audit File");
    expect(markdown).toContain("## 3. Separation Summary");
    expect(markdown).toContain('"overviewSourceCandidates"');
    expect(markdown).toContain('"cleanConversationCount": 2');
    expect(markdown).toContain('"contextSignalCount": 1');
    expect(markdown).toContain('"excludedInternalCount": 1');
    expect(markdown).toContain("## 6. Trigger Phrases");
    expect(markdown).toContain('"triggerPhrase": "MockExtractor 규칙을 구체적으로 만들어줘"');
    expect(markdown).toContain('"reviewRequired"');
    expect(markdown).toContain('"includeInMainBoard"');
    expect(markdown).toContain('"openQuestions"');
    expect(markdown).toContain("## 7. Sprint 5A Shadow Comparison");
    expect(markdown).toContain('"llmStatus": "disabled"');
    expect(markdown).toContain('"ruleItems"');
    expect(markdown).toContain('"llmItems": []');
    expect(markdown).toContain("## 8. Clean Conversation Messages");
    expect(markdown).toContain("## 9. Context Signals");
    expect(markdown).toContain("## 10. Excluded/Internal Messages");
  });
});

function createConversation(messages: CanonicalMessage[]): CanonicalConversation {
  return {
    id: "conv_test",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/test",
      normalizedUrl: "https://chatgpt.com/share/test",
      shareId: "test",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-09T00:00:00.000Z"
    },
    title: "테스트 대화",
    language: "ko",
    importedAt: "2026-07-09T00:00:00.000Z",
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages: messages.filter((item) => item.role === "user").length,
      assistantMessages: messages.filter((item) => item.role === "assistant").length,
      unsupportedMessages: 0,
      cleanConversationMessages: messages.filter(
        (item) => item.metadata.messageCategory === "clean_conversation"
      ).length,
      contextSignalMessages: messages.filter(
        (item) => item.metadata.messageCategory === "context_signal"
      ).length,
      excludedInternalMessages: messages.filter(
        (item) => item.metadata.messageCategory === "excluded_internal"
      ).length,
      totalChars: messages.reduce((sum, item) => sum + item.text.length, 0)
    },
    warnings: []
  };
}

function message(
  index: number,
  role: "user" | "assistant",
  text: string,
  messageCategory: CanonicalMessage["metadata"]["messageCategory"]
): CanonicalMessage {
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
      messageCategory
    }
  };
}
