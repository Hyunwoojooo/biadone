import { describe, expect, it } from "vitest";

import {
  buildComparisonRows,
  buildMonitorTurns,
  buildParsingQaSummary,
  buildReviewRows,
  turnIdForMessageIndex,
  type MonitorMessage
} from "../../src/components/extraction-monitor/monitorModel";
import type {
  EvidenceEvaluatedItem,
  HybridExtractionResult,
  SemanticItem
} from "../../src/core/types/semantic";

describe("extraction monitor model", () => {
  it("pairs each user prompt with the final assistant answer and keeps signals", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "첫 질문"),
      message(
        2,
        "assistant",
        "확인하겠습니다",
        "clean_conversation",
        "transition"
      ),
      message(3, "assistant", "search", "context_signal"),
      message(
        4,
        "assistant",
        "최종 답변",
        "clean_conversation",
        "final_answer"
      ),
      message(5, "user", "두 번째 질문")
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      id: 1,
      user: { index: 1 },
      assistant: { index: 4 },
      scopeMessageIndexes: [1, 2, 4]
    });
    expect(
      turns[0]?.intermediateCleanMessages.map((item) => item.index)
    ).toEqual([2]);
    expect(turns[0]?.contextSignals.map((item) => item.index)).toEqual([3]);
    expect(turns[1]?.assistant).toBeNull();
  });

  it("compares rule and LLM items by type and evidence", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "PDF는 나중에 하고 링크로 진행하자"),
      message(2, "assistant", "링크 방식으로 정리했습니다")
    ]);
    const ruleDecision = semanticItem("rule_decision", "decision", [1], {
      label: "링크 방식 채택",
      status: "confirmed",
      source: "rule"
    });
    const llmDecision = semanticItem("llm_decision", "decision", [1], {
      label: "링크 방식 채택",
      status: "confirmed"
    });
    const llmPreference = semanticItem("llm_preference", "preference", [1], {
      label: "링크 입력 선호"
    });
    const sprint5 = hybrid(
      [ruleDecision],
      [llmDecision, llmPreference],
      [
        evaluated(llmDecision, "verified"),
        evaluated(llmPreference, "review_required")
      ]
    );

    const rows = buildComparisonRows(turns[0]!, sprint5);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: "decision",
      verdict: "Match",
      verificationStatus: "Verified"
    });
    expect(rows[1]).toMatchObject({
      type: "preference",
      verdict: "LLM only",
      verificationStatus: "Review"
    });
  });

  it("links review items back to their conversation turn", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "이 방식이 맞아?"),
      message(2, "assistant", "설명")
    ]);
    const llmDecision = semanticItem("llm_decision", "decision", [1], {
      label: "방식 확정"
    });
    const reviewed = evaluated(llmDecision, "review_required", [
      "DECISION_NOT_EXPLICIT"
    ]);
    const sprint5 = hybrid([], [llmDecision], [reviewed]);

    expect(buildReviewRows(turns, sprint5)[0]).toMatchObject({
      itemId: "llm_decision",
      turnId: 1,
      source: "LLM Shadow",
      issueCodes: ["DECISION_NOT_EXPLICIT"]
    });
  });

  it("summarizes canonical message categories for parsing QA", () => {
    const messages = [
      message(1, "user", "질문"),
      message(2, "assistant", "검색", "context_signal"),
      message(3, "assistant", "내부", "excluded_internal"),
      message(4, "assistant", "답변")
    ];
    messages[2]!.metadata.hasUnsupportedContent = true;
    const turns = buildMonitorTurns(messages);
    const summary = buildParsingQaSummary({
      messages,
      turnCount: turns.length,
      stats: {
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        totalMessages: 4,
        userMessages: 1,
        assistantMessages: 3,
        unsupportedMessages: 1,
        cleanConversationMessages: 2,
        contextSignalMessages: 1,
        excludedInternalMessages: 1,
        totalChars: 8
      },
      warnings: [
        {
          code: "UNSUPPORTED_CONTENT",
          message: "지원하지 않는 content가 있습니다.",
          severity: "warning"
        }
      ]
    });

    expect(summary).toMatchObject({
      status: "attention",
      counts: {
        total: 4,
        user: 1,
        assistant: 3,
        clean: 2,
        context: 1,
        internal: 1,
        unsupported: 1,
        turns: 1
      },
      warningCounts: { info: 0, warning: 1, error: 0 },
      countMismatch: false
    });
    expect(turnIdForMessageIndex(turns, 2)).toBe(1);
  });

  it("flags API statistics that do not reconcile with returned messages", () => {
    const messages = [message(1, "user", "질문")];
    const summary = buildParsingQaSummary({
      messages,
      turnCount: 1,
      stats: {
        startedAt: null,
        endedAt: null,
        durationSeconds: null,
        totalMessages: 2,
        userMessages: 1,
        assistantMessages: 1,
        unsupportedMessages: 0,
        cleanConversationMessages: 2,
        contextSignalMessages: 0,
        excludedInternalMessages: 0,
        totalChars: 2
      },
      warnings: []
    });

    expect(summary.status).toBe("attention");
    expect(summary.countMismatch).toBe(true);
  });
});

function message(
  index: number,
  role: "user" | "assistant",
  text: string,
  messageCategory: MonitorMessage["metadata"]["messageCategory"] = "clean_conversation",
  assistantMessageType?: MonitorMessage["metadata"]["assistantMessageType"]
): MonitorMessage {
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
      messageCategory,
      semanticAnalyzable: messageCategory === "clean_conversation",
      ...(assistantMessageType ? { assistantMessageType } : {})
    }
  };
}

function semanticItem(
  id: string,
  type: SemanticItem["type"],
  evidenceMessageIndexes: number[],
  overrides: Partial<SemanticItem> = {}
): SemanticItem {
  return {
    id,
    type,
    source: "llm",
    sourceItemId: null,
    label: "테스트 항목",
    description: "테스트 설명",
    status: null,
    category: null,
    triggerPhrase: "테스트",
    evidenceMessageIndexes,
    confidence: 0.9,
    reviewRequired: false,
    ...overrides
  };
}

function evaluated(
  item: SemanticItem,
  status: EvidenceEvaluatedItem["evidenceVerification"]["status"],
  issueCodes: string[] = []
): EvidenceEvaluatedItem {
  return {
    ...item,
    evidenceVerification: {
      status,
      matches: [],
      issues: issueCodes.map((code) => ({
        code: code as EvidenceEvaluatedItem["evidenceVerification"]["issues"][number]["code"],
        message: code,
        messageIndexes: item.evidenceMessageIndexes
      }))
    }
  };
}

function hybrid(
  ruleItems: SemanticItem[],
  llmItems: SemanticItem[],
  evaluatedItems: EvidenceEvaluatedItem[]
): HybridExtractionResult {
  return {
    mode: "shadow",
    createdAt: "2026-07-11T00:00:00.000Z",
    ruleResult: { extractorVersion: "3.4", items: ruleItems },
    llmResult: {
      extractorVersion: "5A-2.0",
      status: "completed",
      provider: "gemini",
      model: "gemini-test",
      items: llmItems,
      segments: [],
      metrics: {
        requestCount: 0,
        completedRequestCount: 0,
        failedRequestCount: 0,
        totalDurationMs: 0,
        providerDurationMs: 0,
        usage: {
          reportedRequestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          thoughtTokens: 0
        }
      },
      coverage: {
        cleanMessageCount: 2,
        analyzedMessageCount: 2,
        segmentCount: 0,
        semanticTypeCounts: {},
        representedMessageIndexes: [],
        evidenceMessageCoverageRatio: 0,
        unrepresentedSemanticTypes: [],
        invalidEvidenceItemIds: []
      }
    },
    evidenceVerifier: {
      name: "EvidenceVerifier",
      version: "5B-1.0",
      mode: "rule_based"
    },
    verifiedItems: evaluatedItems.filter(
      (item) => item.evidenceVerification.status === "verified"
    ),
    reviewQueue: evaluatedItems.filter(
      (item) => item.evidenceVerification.status === "review_required"
    ),
    rejectedItems: evaluatedItems.filter(
      (item) => item.evidenceVerification.status === "rejected"
    ),
    evidenceDiagnostics: {
      candidateCount: llmItems.length,
      verifiedItemCount: 0,
      reviewItemCount: 0,
      rejectedItemCount: 0,
      evidenceMatchCount: 0,
      verifiedMatchCount: 0,
      reviewMatchCount: 0,
      rejectedMatchCount: 0,
      reasonCounts: {}
    }
  };
}
