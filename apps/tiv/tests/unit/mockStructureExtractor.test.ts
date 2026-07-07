import { describe, expect, it } from "vitest";

import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";

describe("extractMockStructure", () => {
  it("extracts Sprint 3A board items and preferences from clean user messages", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 추후 기능으로 빼자."),
      cleanMessage(2, "assistant", "좋습니다. 링크 기반으로 먼저 가겠습니다."),
      cleanMessage(3, "user", "오케이. 이제 MockExtractor 규칙을 구체적으로 만들어줘."),
      contextSignal(4, "assistant", "{\"system1_search_query\":[{\"q\":\"mock extractor\"}]}"),
      internalMessage(5, "assistant", "[thoughts 첨부: v0.1에서는 분석 제외]")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "deferred",
          evidenceMessageIndexes: [1]
        })
      ])
    );
    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          evidenceMessageIndexes: [3]
        })
      ])
    );
    expect(result.preferenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "avoidance",
          evidenceMessageIndexes: [1]
        }),
        expect.objectContaining({
          category: "specificity_depth",
          evidenceMessageIndexes: [3]
        })
      ])
    );
    expect(result.diagnostics.contextSignalCount).toBe(1);
    expect(result.diagnostics.excludedInternalCount).toBe(1);
  });

  it("pairs assistant answers with the next user reaction for satisfaction", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "규칙을 제안해줘."),
      cleanMessage(2, "assistant", "규칙 초안을 제안했습니다."),
      cleanMessage(3, "user", "좋은데, 예시를 조금 더 추가해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals).toEqual([
      expect.objectContaining({
        assistantMessageIndex: 2,
        userReactionMessageIndex: 3,
        status: "correction_requested",
        secondaryStatuses: expect.arrayContaining(["partially_satisfied"]),
        evidenceMessageIndexes: [2, 3]
      })
    ]);
  });

  it("caps confidence for example-like text", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "예: “이걸로 하자”, “PDF는 빼자” 같은 문장")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions[0]?.confidence).toBeLessThanOrEqual(0.35);
    expect(result.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXAMPLE_TEXT_DETECTED",
          messageIndexes: [1]
        })
      ])
    );
  });

  it("marks repeated preferences as reinforced without counting adjacent duplicates", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 일단 추후 기능으로 빼자."),
      cleanMessage(2, "user", "PDF 업로드는 일단 추후 기능으로 빼자."),
      cleanMessage(3, "assistant", "PDF는 후순위로 두겠습니다."),
      cleanMessage(4, "user", "다시 말하지만 PDF 업로드는 추후 기능으로 두자.")
    ]);

    const result = extractMockStructure(conversation);
    const pdfAvoidance = result.preferenceSignals.find(
      (signal) =>
        signal.category === "avoidance" &&
        signal.evidenceMessageIndexes.includes(1)
    );

    expect(pdfAvoidance).toMatchObject({
      reinforced: true,
      evidenceMessageIndexes: [1, 4]
    });
    expect(result.diagnostics.duplicateMessageIndexes).toEqual([2]);
    expect(result.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_MESSAGE_SKIPPED",
          messageIndexes: [2]
        })
      ])
    );
  });

  it("resolves open questions when a later decision shares the same topic", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 어떻게 처리해야 할까?"),
      cleanMessage(2, "assistant", "후순위로 둘 수 있습니다."),
      cleanMessage(3, "user", "PDF 업로드는 추후 기능으로 빼자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.openQuestions[0]).toMatchObject({
      status: "resolved",
      resolvedByDecisionId: result.board.decisions[0]?.id
    });
    expect(result.board.decisions[0]).toMatchObject({
      status: "deferred"
    });
  });

  it("creates more specific topic flow labels and change reasons", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "ChatGPT 공유 링크 분석 구조를 설명해줘."),
      cleanMessage(2, "assistant", "공유 링크 분석 구조를 설명했습니다."),
      cleanMessage(3, "user", "PDF 업로드는 추후 기능으로 빼자."),
      cleanMessage(4, "assistant", "범위를 링크 기반으로 좁히겠습니다."),
      cleanMessage(5, "user", "이제 MockExtractor 구현을 시작하자."),
      cleanMessage(6, "assistant", "구현을 시작하겠습니다."),
      cleanMessage(7, "user", "Sprint 3 문서를 .md 파일로 정리해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.topicFlow.map((topic) => topic.changeReason)).toEqual([
      "new_user_question",
      "scope_changed",
      "implementation_phase_started",
      "artifact_requested"
    ]);
    expect(result.topicFlow.map((topic) => topic.label)).toEqual([
      "ChatGPT Share Adapter 설명",
      "PDF 업로드 결정",
      "MockExtractor 구현",
      "Sprint 3 문서화"
    ]);
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
      fetchedAt: "2026-07-08T00:00:00.000Z"
    },
    title: "테스트 대화",
    language: "ko",
    importedAt: "2026-07-08T00:00:00.000Z",
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter(
        (message) => message.role === "assistant"
      ).length,
      unsupportedMessages: 0,
      cleanConversationMessages: messages.filter(
        (message) => message.metadata.messageCategory === "clean_conversation"
      ).length,
      contextSignalMessages: messages.filter(
        (message) => message.metadata.messageCategory === "context_signal"
      ).length,
      excludedInternalMessages: messages.filter(
        (message) => message.metadata.messageCategory === "excluded_internal"
      ).length,
      totalChars: messages.reduce((sum, message) => sum + message.text.length, 0)
    },
    warnings: []
  };
}

function cleanMessage(
  index: number,
  role: "user" | "assistant",
  text: string
): CanonicalMessage {
  return message(index, role, text, "clean_conversation");
}

function contextSignal(
  index: number,
  role: "user" | "assistant",
  text: string
): CanonicalMessage {
  return {
    ...message(index, role, text, "context_signal"),
    metadata: {
      messageCategory: "context_signal",
      contextSignalType: "search_query"
    }
  };
}

function internalMessage(
  index: number,
  role: "user" | "assistant",
  text: string
): CanonicalMessage {
  return {
    ...message(index, role, text, "excluded_internal"),
    metadata: {
      messageCategory: "excluded_internal",
      internalContentType: "thoughts"
    }
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
