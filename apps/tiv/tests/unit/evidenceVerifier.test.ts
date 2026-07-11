import { describe, expect, it } from "vitest";

import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";
import type { SemanticItem } from "../../src/core/types/semantic";
import { verifyLlmEvidence } from "../../src/core/validation/evidenceVerifier";

describe("verifyLlmEvidence", () => {
  it("verifies an explicit user decision with an exact quote span", () => {
    const conversation = createConversation([
      message(1, "user", "공유 링크 방식으로 진행하자.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_decision_001",
        type: "decision",
        status: "confirmed",
        triggerPhrase: "공유 링크 방식으로 진행하자",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.verifiedItems).toHaveLength(1);
    expect(result.reviewQueue).toHaveLength(0);
    expect(result.rejectedItems).toHaveLength(0);
    expect(
      result.verifiedItems[0]?.evidenceVerification.matches[0]
    ).toMatchObject({
      messageId: "msg_1",
      messageIndex: 1,
      quote: "공유 링크 방식으로 진행하자",
      startChar: 0,
      endChar: 15,
      supportType: "explicit",
      verificationStatus: "verified"
    });
  });

  it("verifies an accepted assistant proposal only when the next user accepts it", () => {
    const conversation = createConversation([
      message(1, "assistant", "링크 기반으로 진행하는 것이 좋습니다."),
      message(2, "user", "좋아. 그걸로 하자.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_decision_002",
        type: "decision",
        status: "confirmed",
        triggerPhrase: "링크 기반으로 진행하는 것이 좋습니다.",
        evidenceMessageIndexes: [1, 2]
      })
    ]);

    expect(result.verifiedItems).toHaveLength(1);
    expect(result.verifiedItems[0]?.evidenceVerification.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageIndex: 1,
          supportType: "accepted_context"
        }),
        expect.objectContaining({
          messageIndex: 2,
          quote: "좋아",
          supportType: "accepted_context"
        })
      ])
    );
  });

  it("rejects an assistant-only user decision", () => {
    const conversation = createConversation([
      message(1, "assistant", "링크 방식으로 확정하겠습니다.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_decision_003",
        type: "decision",
        status: "confirmed",
        triggerPhrase: "링크 방식으로 확정하겠습니다",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.rejectedItems).toHaveLength(1);
    expect(result.rejectedItems[0]?.evidenceVerification.issues).toContainEqual(
      expect.objectContaining({ code: "ASSISTANT_ONLY_USER_CLAIM" })
    );
  });

  it("keeps a candidate decision in review even when the user accepts the proposal", () => {
    const conversation = createConversation([
      message(1, "assistant", "링크 기반으로 진행하는 것이 좋습니다."),
      message(2, "user", "좋아. 그걸로 하자.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_decision_candidate",
        type: "decision",
        status: "candidate",
        triggerPhrase: "좋아. 그걸로 하자.",
        evidenceMessageIndexes: [1, 2]
      })
    ]);

    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0]?.evidenceVerification.issues[0]?.code).toBe(
      "DECISION_NOT_EXPLICIT"
    );
  });

  it("routes a question-like decision claim to review", () => {
    const conversation = createConversation([
      message(1, "user", "너가 제안한 방식이 내가 말한 방식이 맞아?")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_decision_004",
        type: "decision",
        status: "confirmed",
        triggerPhrase: "너가 제안한 방식이 내가 말한 방식이 맞아?",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0]?.evidenceVerification).toMatchObject({
      status: "review_required",
      issues: [expect.objectContaining({ code: "DECISION_NOT_EXPLICIT" })]
    });
  });

  it("verifies satisfaction from an assistant and its next matching user reaction", () => {
    const conversation = createConversation([
      message(1, "assistant", "표 형식 초안을 만들었습니다."),
      message(2, "user", "좋은데, 항목을 조금 더 추가해줘.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_satisfaction_001",
        type: "satisfaction",
        status: "partially_satisfied",
        triggerPhrase: "좋은데, 항목을 조금 더 추가해줘.",
        evidenceMessageIndexes: [1, 2]
      })
    ]);

    expect(result.verifiedItems).toHaveLength(1);
    expect(
      result.verifiedItems[0]?.evidenceVerification.matches.map(
        (match) => match.messageIndex
      )
    ).toEqual([1, 2]);
  });

  it("rejects satisfaction inferred from an assistant answer alone", () => {
    const conversation = createConversation([
      message(1, "assistant", "방향성은 그렇게 이해하면 됩니다.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_satisfaction_002",
        type: "satisfaction",
        status: "satisfied",
        triggerPhrase: "방향성은 그렇게 이해하면 됩니다.",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.rejectedItems).toHaveLength(1);
    expect(result.rejectedItems[0]?.evidenceVerification.issues[0]?.code).toBe(
      "SATISFACTION_PAIR_REQUIRED"
    );
  });

  it("does not use an assistant transition as the satisfaction answer", () => {
    const conversation = createConversation([
      message(
        1,
        "assistant",
        "최신 자료를 확인해보겠습니다.",
        "clean_conversation",
        "transition"
      ),
      message(2, "user", "좋아.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_satisfaction_transition",
        type: "satisfaction",
        status: "satisfied",
        triggerPhrase: "좋아.",
        evidenceMessageIndexes: [1, 2]
      })
    ]);

    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0]?.evidenceVerification.issues[0]?.code).toBe(
      "SATISFACTION_PAIR_REQUIRED"
    );
  });

  it("rejects missing and non-clean evidence indexes", () => {
    const conversation = createConversation([
      message(1, "user", "분석해줘."),
      message(2, "assistant", "tool call", "context_signal")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_action_001",
        type: "action",
        triggerPhrase: "tool call",
        evidenceMessageIndexes: [2, 99]
      })
    ]);

    expect(result.rejectedItems).toHaveLength(1);
    expect(
      result.rejectedItems[0]?.evidenceVerification.issues.map(
        (item) => item.code
      )
    ).toEqual(["NON_CLEAN_EVIDENCE", "OUT_OF_RANGE_MESSAGE_INDEX"]);
  });

  it("routes an unmatched trigger phrase to review instead of inventing a span", () => {
    const conversation = createConversation([
      message(1, "user", "결과를 표로 정리해줘.")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_preference_001",
        type: "preference",
        triggerPhrase: "JSON으로 정리해줘",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0]?.evidenceVerification).toMatchObject({
      matches: [],
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "TRIGGER_PHRASE_NOT_FOUND" })
      ])
    });
  });

  it("keeps exact evidence under review when confidence is low", () => {
    const conversation = createConversation([
      message(1, "user", "왜 이 방식이 필요한 거야?")
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_open_question_001",
        type: "open_question",
        triggerPhrase: "왜 이 방식이 필요한 거야?",
        evidenceMessageIndexes: [1],
        confidence: 0.6
      })
    ]);

    expect(result.reviewQueue).toHaveLength(1);
    expect(
      result.reviewQueue[0]?.evidenceVerification.matches[0]
    ).toMatchObject({ verificationStatus: "verified" });
    expect(result.evidenceDiagnostics.reasonCounts).toMatchObject({
      LOW_CONFIDENCE: 1
    });
  });

  it("verifies an assistant artifact completion as an explicit completed action", () => {
    const conversation = createConversation([
      message(
        1,
        "assistant",
        "검수용 Markdown 파일을 생성했습니다.",
        "clean_conversation",
        "final_answer_with_artifact"
      )
    ]);

    const result = verifyLlmEvidence(conversation, [
      semanticItem({
        id: "llm_action_002",
        type: "action",
        status: "completed",
        triggerPhrase: "Markdown 파일을 생성했습니다",
        evidenceMessageIndexes: [1]
      })
    ]);

    expect(result.verifiedItems).toHaveLength(1);
    expect(result.evidenceDiagnostics).toMatchObject({
      candidateCount: 1,
      verifiedItemCount: 1,
      reviewItemCount: 0,
      rejectedItemCount: 0,
      verifiedMatchCount: 1
    });
  });
});

function semanticItem(
  overrides: Partial<SemanticItem> & Pick<SemanticItem, "id" | "type">
): SemanticItem {
  return {
    id: overrides.id,
    type: overrides.type,
    source: "llm",
    sourceItemId: null,
    label: overrides.label ?? "테스트 항목",
    description: overrides.description ?? "테스트 설명",
    status: overrides.status ?? null,
    category: overrides.category ?? null,
    triggerPhrase: overrides.triggerPhrase ?? null,
    evidenceMessageIndexes: overrides.evidenceMessageIndexes ?? [],
    confidence: overrides.confidence ?? 0.9,
    reviewRequired: true
  };
}

function createConversation(
  messages: CanonicalMessage[]
): CanonicalConversation {
  return {
    id: "conv_evidence",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/evidence",
      normalizedUrl: "https://chatgpt.com/share/evidence",
      shareId: "evidence",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-11T00:00:00.000Z"
    },
    title: "Evidence test",
    language: "ko",
    importedAt: "2026-07-11T00:00:00.000Z",
    messages,
    stats: {
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
  category: CanonicalMessage["metadata"]["messageCategory"] = "clean_conversation",
  assistantMessageType?: CanonicalMessage["metadata"]["assistantMessageType"]
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
      messageCategory: category,
      semanticAnalyzable: category === "clean_conversation",
      ...(assistantMessageType ? { assistantMessageType } : {})
    }
  };
}
