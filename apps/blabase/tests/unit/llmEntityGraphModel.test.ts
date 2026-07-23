import { describe, expect, it } from "vitest";

import {
  buildMonitorTurns,
  type MonitorMessage
} from "../../src/components/extraction-monitor/monitorModel";
import { buildLlmEntityGraph } from "../../src/components/extraction-monitor/llmEntityGraphModel";
import type {
  EvidenceEvaluatedItem,
  HybridExtractionResult,
  SemanticItem
} from "../../src/core/types/semantic";

describe("LLM entity graph model", () => {
  it("places the strongest verified intent at the center and excludes rejected items", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "대화에서 핵심 지식을 다시 찾고 싶어"),
      message(2, "assistant", "지식 그래프로 정리하겠습니다"),
      message(3, "user", "먼저 entity graph를 구현해줘"),
      message(4, "assistant", "그래프 구현안을 만들었습니다")
    ]);
    const intent = item("intent", "intent", "대화 지식 재사용", [1], 0.93);
    const topic = item("topic", "topic", "Entity Graph", [3], 0.95);
    const action = item("action", "action", "그래프 구현", [3], 0.88);
    const rejected = item("rejected", "entity", "잘못된 인물", [2], 0.99);
    const sprint5 = hybrid([
      evaluated(intent, "verified"),
      evaluated(topic, "verified"),
      evaluated(action, "review_required"),
      evaluated(rejected, "rejected")
    ]);

    const graph = buildLlmEntityGraph(turns, sprint5);
    const core = graph.nodes.find((node) => node.isCore);

    expect(core).toMatchObject({
      label: "대화 지식 재사용",
      type: "intent",
      verificationStatus: "verified",
      x: 50,
      y: 50
    });
    expect(graph.coreNodeId).toBe(core?.id);
    expect(graph.nodes.some((node) => node.label === "잘못된 인물")).toBe(
      false
    );
    expect(graph.stats).toEqual({
      candidateCount: 4,
      verifiedCount: 2,
      reviewCount: 1,
      rejectedCount: 1,
      uniqueNodeCount: 3,
      matchingNodeCount: 3,
      displayedNodeCount: 3,
      omittedNodeCount: 0
    });
  });

  it("connects every visible item to the core and adds shared-evidence edges", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "공유 링크를 지식 그래프로 정리해줘"),
      message(2, "assistant", "핵심 의도와 작업을 연결하겠습니다")
    ]);
    const intent = evaluated(
      item("intent", "intent", "지식 그래프 만들기", [1], 0.96),
      "verified"
    );
    const topic = evaluated(
      item("topic", "topic", "공유 링크 분석", [1], 0.91),
      "verified"
    );
    const action = evaluated(
      item("action", "action", "그래프 결과 확인", [1], 0.87),
      "review_required"
    );

    const graph = buildLlmEntityGraph(turns, hybrid([intent, topic, action]));
    const coreEdges = graph.edges.filter(
      (edge) => edge.from === graph.coreNodeId
    );

    expect(graph.nodes).toHaveLength(3);
    expect(coreEdges).toHaveLength(2);
    expect(
      graph.edges.some(
        (edge) =>
          edge.relation === "shared_evidence" &&
          edge.sharedMessageIndexes.includes(1)
      )
    ).toBe(true);
  });

  it("preserves review nodes and produces a deterministic bounded ring layout", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "중심 개념과 여러 관련 항목을 정리해줘"),
      message(2, "assistant", "관련 항목을 연결하겠습니다")
    ]);
    const candidates = Array.from({ length: 12 }, (_, index) =>
      evaluated(
        item(
          `item-${index}`,
          index === 0 ? "intent" : "entity",
          index === 0 ? "대화 구조 파악" : `관련 항목 ${index}`,
          [1],
          0.9 - index * 0.01
        ),
        index % 3 === 0 ? "review_required" : "verified"
      )
    );

    const first = buildLlmEntityGraph(turns, hybrid(candidates));
    const second = buildLlmEntityGraph(turns, hybrid(candidates));

    expect(first).toEqual(second);
    expect(
      first.nodes.some((node) => node.verificationStatus === "review_required")
    ).toBe(true);
    expect(
      first.nodes.every(
        (node) => node.x >= 8 && node.x <= 92 && node.y >= 8 && node.y <= 92
      )
    ).toBe(true);
    expect(
      first.edges.filter((edge) => edge.relation === "core_layout")
    ).toHaveLength(first.nodes.length - 1);
    expect(first.edges).toHaveLength(66);
  });

  it("keeps verified and review representations separate for the same label", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "같은 키워드의 검증 상태를 구분해줘"),
      message(2, "assistant", "상태별로 구분하겠습니다")
    ]);
    const verified = evaluated(
      {
        ...item("verified", "topic", "Graph QA", [1], 0.61),
        description: "검증된 설명",
        triggerPhrase: "검증된 문구"
      },
      "verified"
    );
    const review = evaluated(
      {
        ...item("review", "topic", "Graph QA", [1], 0.99),
        description: "리뷰 설명",
        triggerPhrase: "리뷰 문구"
      },
      "review_required"
    );
    const lowerConfidenceDuplicate = evaluated(
      {
        ...item("verified-duplicate", "topic", "Graph QA", [1], 0.4),
        description: "낮은 신뢰도의 고유 검색 문구",
        triggerPhrase: "보조 trigger"
      },
      "verified"
    );

    const sprint5 = hybrid([verified, lowerConfidenceDuplicate, review]);
    const graph = buildLlmEntityGraph(turns, sprint5);
    const searched = buildLlmEntityGraph(turns, sprint5, {
      query: "고유 검색 문구"
    });

    expect(graph.nodes).toHaveLength(2);
    expect(
      graph.nodes.find((node) => node.verificationStatus === "verified")
    ).toMatchObject({
      confidence: 0.61,
      description: "검증된 설명",
      triggerPhrase: "검증된 문구"
    });
    expect(
      graph.nodes.find((node) => node.verificationStatus === "review_required")
    ).toMatchObject({
      confidence: 0.99,
      description: "리뷰 설명",
      triggerPhrase: "리뷰 문구"
    });
    expect(
      searched.nodes.some((node) => node.itemIds.includes("verified"))
    ).toBe(true);
  });

  it("reports omitted nodes and searches the full accepted candidate set", () => {
    const turns = buildMonitorTurns([
      message(1, "user", "많은 후보 중 원하는 항목을 찾아줘"),
      message(2, "assistant", "전체 후보에서 검색하겠습니다")
    ]);
    const candidates = Array.from({ length: 25 }, (_, index) =>
      evaluated(
        item(
          `candidate-${index}`,
          index === 0 ? "intent" : "entity",
          index === 0 ? "전체 후보 탐색" : `숨은 후보 ${index}`,
          [1],
          0.99 - index * 0.01
        ),
        "verified"
      )
    );
    const sprint5 = hybrid(candidates);

    const defaultGraph = buildLlmEntityGraph(turns, sprint5);
    const searchedGraph = buildLlmEntityGraph(turns, sprint5, {
      query: "숨은 후보 23"
    });

    expect(defaultGraph.nodes).toHaveLength(19);
    expect(defaultGraph.stats).toMatchObject({
      uniqueNodeCount: 25,
      displayedNodeCount: 19,
      omittedNodeCount: 6
    });
    expect(searchedGraph.nodes.map((node) => node.label)).toContain(
      "숨은 후보 23"
    );
    expect(searchedGraph.stats).toMatchObject({
      matchingNodeCount: 1,
      displayedNodeCount: 2,
      omittedNodeCount: 0
    });
  });

  it("returns an empty graph when the LLM has no accepted candidates", () => {
    const graph = buildLlmEntityGraph([], hybrid([]));

    expect(graph).toMatchObject({
      coreNodeId: null,
      nodes: [],
      edges: []
    });
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
    createdAt: null,
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

function item(
  id: string,
  type: SemanticItem["type"],
  label: string,
  evidenceMessageIndexes: number[],
  confidence: number
): SemanticItem {
  return {
    id,
    type,
    source: "llm",
    sourceItemId: null,
    label,
    description: `${label} 설명`,
    status: null,
    category: null,
    triggerPhrase: label,
    evidenceMessageIndexes,
    confidence,
    reviewRequired: true
  };
}

function evaluated(
  semanticItem: SemanticItem,
  status: EvidenceEvaluatedItem["evidenceVerification"]["status"]
): EvidenceEvaluatedItem {
  return {
    ...semanticItem,
    evidenceVerification: {
      status,
      matches: [],
      issues: []
    }
  };
}

function hybrid(
  evaluatedItems: EvidenceEvaluatedItem[]
): HybridExtractionResult {
  const llmItems: SemanticItem[] = evaluatedItems;
  const verifiedItems = evaluatedItems.filter(
    (item) => item.evidenceVerification.status === "verified"
  );
  const reviewQueue = evaluatedItems.filter(
    (item) => item.evidenceVerification.status === "review_required"
  );
  const rejectedItems = evaluatedItems.filter(
    (item) => item.evidenceVerification.status === "rejected"
  );

  return {
    mode: "shadow",
    createdAt: "2026-07-23T00:00:00.000Z",
    ruleResult: { extractorVersion: "test", items: [] },
    llmResult: {
      extractorVersion: "test",
      status: "completed",
      provider: "gemini",
      model: "test-model",
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
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          cachedInputTokens: 0,
          thoughtTokens: 0
        }
      },
      coverage: {
        cleanMessageCount: 0,
        analyzedMessageCount: 0,
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
      version: "test",
      mode: "rule_based"
    },
    verifiedItems,
    reviewQueue,
    rejectedItems,
    evidenceDiagnostics: {
      candidateCount: evaluatedItems.length,
      verifiedItemCount: verifiedItems.length,
      reviewItemCount: reviewQueue.length,
      rejectedItemCount: rejectedItems.length,
      evidenceMatchCount: 0,
      verifiedMatchCount: 0,
      reviewMatchCount: 0,
      rejectedMatchCount: 0,
      reasonCounts: {}
    }
  };
}
