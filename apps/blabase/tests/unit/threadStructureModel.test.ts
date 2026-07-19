import { describe, expect, it } from "vitest";

import {
  buildMonitorTurns,
  type MonitorMessage
} from "../../src/components/extraction-monitor/monitorModel";
import { buildThreadStructure } from "../../src/components/extraction-monitor/threadStructureModel";
import type {
  EvidenceEvaluatedItem,
  HybridExtractionResult,
  SemanticItem
} from "../../src/core/types/semantic";

describe("thread structure model", () => {
  it("deduplicates rule and verified LLM concepts and excludes rejected items", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "API 대신 로컬 에이전트를 사용하자"),
      message(2, "assistant", "로컬 에이전트 방식으로 정리했습니다")
    ]);
    const ruleDecision = semanticItem("rule-decision", "decision", [1], {
      source: "rule",
      label: "로컬 에이전트 채택"
    });
    const llmDecision = semanticItem("llm-decision", "decision", [1], {
      label: "로컬 에이전트 채택"
    });
    const llmAction = semanticItem("llm-action", "action", [2], {
      label: "중계 구조 설계"
    });
    const rejected = semanticItem("llm-rejected", "topic", [1], {
      label: "제외할 개념"
    });
    const sprint5 = hybrid(
      [ruleDecision],
      [llmDecision, llmAction, rejected],
      [
        evaluated(llmDecision, "verified"),
        evaluated(llmAction, "review_required"),
        evaluated(rejected, "rejected")
      ]
    );

    const structure = buildThreadStructure(turns, sprint5);

    expect(structure.nodes).toHaveLength(2);
    expect(
      structure.nodes.find((node) => node.label === "로컬 에이전트 채택")
    ).toMatchObject({
      source: "mixed",
      verificationStatus: "verified",
      evidenceMessageIndexes: [1],
      turnIds: [1]
    });
    expect(structure.nodes.some((node) => node.label === "제외할 개념")).toBe(
      false
    );
  });

  it("connects concepts in the same turn and builds searchable flow messages", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "카카오톡으로 결과를 보내줘"),
      message(2, "assistant", "중계 서버를 거쳐 전달하겠습니다")
    ]);
    const channel = semanticItem("channel", "entity", [1], {
      label: "카카오톡"
    });
    const relay = semanticItem("relay", "action", [2], {
      label: "중계 서버 연결"
    });
    const sprint5 = hybrid(
      [],
      [channel, relay],
      [evaluated(channel, "verified"), evaluated(relay, "verified")]
    );

    const structure = buildThreadStructure(turns, sprint5);

    expect(structure.links).toHaveLength(1);
    expect(structure.links[0]).toMatchObject({ sharedTurnIds: [1] });
    expect(structure.flow).toHaveLength(2);
    expect(structure.flow[0]).toMatchObject({
      role: "user",
      turnId: 1,
      messageIndex: 1
    });
    expect(structure.flow[0]?.tags).toContain("카카오톡");
    expect(structure.flow[1]?.tags).toContain("중계 서버 연결");
  });
});

function message(
  index: number,
  role: "user" | "assistant",
  text: string
): MonitorMessage {
  return {
    id: `message-${index}`,
    index,
    role,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: null,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw-${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory: "clean_conversation",
      semanticAnalyzable: true,
      ...(role === "assistant" ? { assistantMessageType: "final_answer" } : {})
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
    label: id,
    description: `${id} 설명`,
    status: null,
    category: null,
    triggerPhrase: id,
    evidenceMessageIndexes,
    confidence: 0.9,
    reviewRequired: false,
    ...overrides
  };
}

function evaluated(
  item: SemanticItem,
  status: EvidenceEvaluatedItem["evidenceVerification"]["status"]
): EvidenceEvaluatedItem {
  return {
    ...item,
    evidenceVerification: {
      status,
      matches: [],
      issues: []
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
    createdAt: "2026-07-19T10:00:00.000Z",
    ruleResult: { extractorVersion: "test", items: ruleItems },
    llmResult: {
      extractorVersion: "test",
      status: "completed",
      provider: "gemini",
      model: "test",
      items: llmItems,
      segments: [],
      metrics: {
        requestCount: 1,
        completedRequestCount: 1,
        failedRequestCount: 0,
        totalDurationMs: 1,
        providerDurationMs: 1,
        usage: {
          reportedRequestCount: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cachedInputTokens: 0,
          thoughtTokens: 0
        }
      },
      coverage: {
        cleanMessageCount: 2,
        analyzedMessageCount: 2,
        segmentCount: 1,
        semanticTypeCounts: {},
        representedMessageIndexes: [1, 2],
        evidenceMessageCoverageRatio: 1,
        unrepresentedSemanticTypes: [],
        invalidEvidenceItemIds: []
      }
    },
    evidenceVerifier: {
      name: "EvidenceVerifier",
      version: "test",
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
      verifiedItemCount: evaluatedItems.filter(
        (item) => item.evidenceVerification.status === "verified"
      ).length,
      reviewItemCount: evaluatedItems.filter(
        (item) => item.evidenceVerification.status === "review_required"
      ).length,
      rejectedItemCount: evaluatedItems.filter(
        (item) => item.evidenceVerification.status === "rejected"
      ).length,
      evidenceMatchCount: 0,
      verifiedMatchCount: 0,
      reviewMatchCount: 0,
      rejectedMatchCount: 0,
      reasonCounts: {}
    }
  };
}
