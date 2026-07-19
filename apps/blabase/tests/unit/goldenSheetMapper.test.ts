import { describe, expect, it } from "vitest";

import { buildGoldenSheetBundle } from "../../src/core/golden-sheet/goldenSheetMapper";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";

describe("buildGoldenSheetBundle", () => {
  it("maps canonical messages and creates blank human annotation rows", () => {
    const conversation = createConversation([
      message(1, "user", "첫 요청", "clean_conversation"),
      {
        ...message(2, "assistant", "검색 로그", "context_signal"),
        metadata: {
          messageCategory: "context_signal",
          contextSignalType: "search_query"
        }
      },
      {
        ...message(3, "assistant", "첫 답변", "clean_conversation"),
        updatedAt: "2026-07-18T03:03:30.000Z",
        metadata: {
          messageCategory: "clean_conversation",
          assistantMessageType: "final_answer"
        }
      },
      message(4, "user", "두 번째 요청", "clean_conversation"),
      {
        ...message(5, "assistant", "숨김", "excluded_internal"),
        metadata: {
          messageCategory: "excluded_internal",
          internalContentType: "thoughts"
        }
      }
    ]);

    const bundle = buildGoldenSheetBundle({
      analysisId: "ana_test",
      sessionId: "S-002",
      shareUrl: "https://chatgpt.com/share/new",
      conversation
    });

    expect(bundle.session).toMatchObject({
      sessionId: "S-002",
      title: "새 테스트 대화",
      sourceType: "ChatGPT 공유 링크",
      importedDate: "2026-07-18",
      labelingStatus: "미작성",
      datasetSplit: "미지정",
      startedAt: "2026-07-18T03:00:00.000Z",
      endedAt: "2026-07-18T03:05:00.000Z",
      durationSeconds: 300
    });
    expect(bundle.messages.map((row) => row.messageId)).toEqual([
      "S-002-M001",
      "S-002-M002",
      "S-002-M003",
      "S-002-M004",
      "S-002-M005"
    ]);
    expect(
      bundle.messages.map((row) => [
        row.messageClassification,
        row.analysisTarget
      ])
    ).toEqual([
      ["Clean Conversation", "예"],
      ["Context Signal", "보조 근거만"],
      ["Clean Conversation", "예"],
      ["Clean Conversation", "예"],
      ["Excluded/Internal", "아니오"]
    ]);
    expect(bundle.messages[1]?.note).toBe("search_query");
    expect(bundle.prompts).toEqual([
      {
        originalPrompt: "첫 요청",
        sessionId: "S-002",
        promptId: "S-002-P001",
        promptOrder: 1,
        userMessageId: "S-002-M001",
        previousAssistantMessageId: "",
        promptRole: "미분류",
        previousAnswerEvaluation: "미판정",
        authorJudgment: "미작성",
        reviewResult: "미검수",
        promptCreatedAt: "2026-07-18T03:01:00.000Z",
        answerCompletedAt: "2026-07-18T03:03:00.000Z",
        responseDurationSeconds: 120
      },
      {
        originalPrompt: "두 번째 요청",
        sessionId: "S-002",
        promptId: "S-002-P004",
        promptOrder: 2,
        userMessageId: "S-002-M004",
        previousAssistantMessageId: "S-002-M003",
        promptRole: "미분류",
        previousAnswerEvaluation: "미판정",
        authorJudgment: "미작성",
        reviewResult: "미검수",
        promptCreatedAt: "2026-07-18T03:04:00.000Z",
        answerCompletedAt: null,
        responseDurationSeconds: null
      }
    ]);
    expect(bundle.messages[0]).toMatchObject({
      createdAt: "2026-07-18T03:01:00.000Z",
      updatedAt: null
    });
  });
});

function createConversation(
  messages: CanonicalMessage[]
): CanonicalConversation {
  return {
    id: "conv_test",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/new",
      normalizedUrl: "https://chatgpt.com/share/new",
      shareId: "new",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-18T00:00:00.000Z"
    },
    title: "새 테스트 대화",
    language: "ko",
    importedAt: "2026-07-18T12:00:00.000Z",
    messages,
    stats: {
      startedAt: "2026-07-18T03:00:00.000Z",
      endedAt: "2026-07-18T03:05:00.000Z",
      durationSeconds: 300,
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
    createdAt: `2026-07-18T03:0${index}:00.000Z`,
    updatedAt: null,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw_${index}`,
      messageIndex: index,
      role
    },
    metadata: { messageCategory }
  };
}
