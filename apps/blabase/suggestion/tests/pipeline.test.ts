import { describe, expect, it } from "vitest";

import {
  resolveSuggestionCandidates,
  runSuggestionEngine,
  SuggestionEngineError,
  type SuggestionCandidateExtraction
} from "../src/runSuggestionEngine";
import type {
  RawTaskCandidate,
  RawTaskStateSignal,
  SourceStatus
} from "../src/types";
import {
  conversationFixture,
  rawCandidateFixture,
  verifiedCandidateFixture
} from "./helpers";

const providerConfig = {
  id: "gemini" as const,
  apiKey: "test-key",
  model: "test-model"
};

describe("suggestion engine pipeline", () => {
  it("requires three restored conversations before any provider call", async () => {
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      return providerResponse();
    };

    await expect(
      runSuggestionEngine({
        restored: [
          { inputIndex: 0, conversation: conversationFixture({ id: "a" }) },
          { inputIndex: 1, conversation: conversationFixture({ id: "b" }) }
        ],
        sources: sourceStatuses(2),
        providerConfig,
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toBeInstanceOf(SuggestionEngineError);
    expect(fetchCount).toBe(0);
  });

  it("produces a suggestion from three successful extractions", async () => {
    const result = await runSuggestionEngine({
      restored: ["a", "b", "c"].map((id, inputIndex) => ({
        inputIndex,
        conversation: conversationFixture({ id })
      })),
      sources: sourceStatuses(3),
      providerConfig,
      fetchImpl: (async () => providerResponse()) as typeof fetch,
      now: () => "2026-07-24T00:00:00.000Z"
    });

    expect(result.status).toBe("suggested");
    expect(result.run).toMatchObject({
      sourceCount: 3,
      requestCount: 3,
      failedRequestCount: 0,
      provider: "gemini",
      model: "test-model"
    });
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
  });

  it("aborts when fewer than three LLM extractions succeed", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) return new Response("failure", { status: 500 });
      return providerResponse();
    };

    await expect(
      runSuggestionEngine({
        restored: ["a", "b", "c"].map((id, inputIndex) => ({
          inputIndex,
          conversation: conversationFixture({ id })
        })),
        sources: sourceStatuses(3),
        providerConfig,
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toMatchObject({
      code: "NOT_ENOUGH_SUCCESSFUL_EXTRACTIONS"
    });
  });

  it("uses a separate terminal state signal to suppress stale open work", async () => {
    const result = await runSuggestionEngine({
      restored: terminalStateScenario(),
      sources: sourceStatuses(4),
      providerConfig,
      fetchImpl: terminalStateFetch() as typeof fetch,
      now: () => "2026-07-24T00:02:00.000Z"
    });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.topSuggestion).toBeNull();
    expect(result.decisionDiagnostics.mergedCandidateCount).toBe(1);
  });

  it("rejects a low-quality screen terminal signal before lineage merge", async () => {
    const result = await runSuggestionEngine({
      restored: terminalStateScenario({
        sourceId: "screen-terminal",
        modality: "screen",
        authority: "screen_observation",
        observedFrom: "2026-07-24T00:01:00.000Z",
        observedTo: "2026-07-24T00:01:00.000Z",
        confidenceFloor: 0.4,
        confidenceCeiling: 0.7,
        coverageRatio: 0.5,
        conflictCount: 0,
        issueCount: 0
      }),
      sources: sourceStatuses(4),
      providerConfig,
      fetchImpl: terminalStateFetch() as typeof fetch,
      now: () => "2026-07-24T00:02:00.000Z"
    });

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
    expect(result.decisionDiagnostics.reasonCounts).toMatchObject({
      SCREEN_COVERAGE_TOO_LOW: 1,
      SCREEN_OBSERVATION_CONFIDENCE_TOO_LOW: 1
    });
  });

  it("rejects a screen candidate with verification issues before lineage merge", () => {
    const restored = ["structured-a", "structured-b", "structured-c", "screen"].map(
      (id, inputIndex) => ({
        inputIndex,
        conversation: conversationFixture({ id })
      })
    );
    const extractionResults: SuggestionCandidateExtraction[] = restored.map(
      ({ inputIndex, conversation }) => ({
        status: "completed",
        inputIndex,
        conversationId: conversation.id,
        failureCode: null,
        candidates: [
          verifiedCandidateFixture({
            conversationId: conversation.id,
            sourceContexts:
              conversation.id === "screen"
                ? [
                    {
                      sourceId: "screen",
                      modality: "screen",
                      authority: "screen_observation",
                      observedFrom: "2026-07-24T00:00:00.000Z",
                      observedTo: "2026-07-24T00:01:00.000Z",
                      confidenceFloor: 0.95,
                      confidenceCeiling: 0.99,
                      coverageRatio: 1,
                      conflictCount: 0,
                      issueCount: 0
                    }
                  ]
                : [],
            verificationIssues:
              conversation.id === "screen"
                ? ["DEADLINE_SOURCE_NOT_VERIFIED"]
                : []
          })
        ],
        stateSignals: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      })
    );

    const result = resolveSuggestionCandidates({
      restored,
      sources: sourceStatuses(4),
      extractionResults,
      provider: "gemini",
      model: "test-model",
      analysisTimestamp: "2026-07-24T00:02:00.000Z",
      startedAt: "2026-07-24T00:02:00.000Z",
      completedAt: "2026-07-24T00:02:00.000Z"
    });

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
    expect(result.decisionDiagnostics.reasonCounts).toMatchObject({
      SCREEN_CANDIDATE_VERIFICATION_FAILED: 1
    });
  });

  it("isolates an invalid screen deadline through the full provider pipeline", async () => {
    const restored = ["structured-a", "structured-b", "structured-c", "screen"].map(
      (id, inputIndex) => ({
        inputIndex,
        conversation: conversationFixture({ id }),
        ...(id === "screen"
          ? {
              sourceContext: {
                sourceId: "screen-provider-output",
                modality: "screen" as const,
                authority: "screen_observation" as const,
                observedFrom: "2026-07-24T00:00:00.000Z",
                observedTo: "2026-07-24T00:01:00.000Z",
                confidenceFloor: 0.95,
                confidenceCeiling: 0.99,
                coverageRatio: 1,
                conflictCount: 0,
                issueCount: 0
              }
            }
          : {})
      })
    );
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit
    ) => {
      const body = JSON.parse(String(init?.body)) as { input?: unknown };
      const prompt = typeof body.input === "string" ? body.input : "";
      if (!prompt.includes('"id":"screen"')) return providerResponse();
      return providerResponse({
        candidates: [
          rawCandidateFixture({
            deadlineKind: "absolute",
            deadlineText: "2026-07-30T12:00:00.000Z"
          })
        ],
        stateSignals: []
      });
    };

    const result = await runSuggestionEngine({
      restored,
      sources: sourceStatuses(4),
      providerConfig,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => "2026-07-24T00:02:00.000Z"
    });

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
    expect(result.decisionDiagnostics.reasonCounts).toMatchObject({
      SCREEN_CANDIDATE_VERIFICATION_FAILED: 1
    });
    expect(result.decisionDiagnostics.verificationIssueCounts).toMatchObject({
      DEADLINE_SOURCE_NOT_VERIFIED: 1
    });
  });
});

function providerResponse(
  output: {
    candidates: RawTaskCandidate[];
    stateSignals: RawTaskStateSignal[];
  } = {
    candidates: [rawCandidateFixture()],
    stateSignals: []
  }
): Response {
  return Response.json({
    id: "request-test",
    model: "test-model",
    output_text: JSON.stringify(output),
    usage: {
      total_input_tokens: 10,
      total_output_tokens: 5,
      total_tokens: 15
    }
  });
}

function terminalStateScenario(
  screenSourceContext?: Parameters<
    typeof terminalStateScenarioWithContext
  >[0]
) {
  return terminalStateScenarioWithContext(screenSourceContext);
}

function terminalStateScenarioWithContext(screenSourceContext?: {
  sourceId: string;
  modality: "screen";
  authority: "screen_observation";
  observedFrom: string;
  observedTo: string;
  confidenceFloor: number | null;
  confidenceCeiling: number | null;
  coverageRatio: number | null;
  conflictCount: number;
  issueCount: number;
}) {
  return [
    { inputIndex: 0, conversation: conversationFixture({ id: "open-a" }) },
    {
      inputIndex: 1,
      conversation: conversationFixture({
        id: "terminal",
        userText: "계약서 검토 상태를 확인해줘.",
        assistantText: "계약서 검토와 회신을 완료했어.",
        endedAt: "2026-07-24T00:01:00.000Z"
      }),
      sourceContext: screenSourceContext
    },
    { inputIndex: 2, conversation: conversationFixture({ id: "open-b" }) },
    { inputIndex: 3, conversation: conversationFixture({ id: "open-c" }) }
  ];
}

function terminalStateFetch() {
  return async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input?: unknown };
    const prompt = typeof body.input === "string" ? body.input : "";
    if (prompt.includes('"id":"terminal"')) {
      return providerResponse({
        candidates: [],
        stateSignals: [
          rawStateSignalFixture({
            state: "completed",
            evidence: [
              {
                kind: "state",
                messageIndex: 2,
                quote: "계약서 검토와 회신을 완료했어"
              }
            ]
          })
        ]
      });
    }
    return providerResponse();
  };
}

function rawStateSignalFixture(
  overrides: Partial<RawTaskStateSignal> = {}
): RawTaskStateSignal {
  const candidate = rawCandidateFixture();
  return {
    title: candidate.title,
    target: candidate.target,
    deliverable: candidate.deliverable,
    state: "completed",
    evidence: candidate.evidence,
    ...overrides
  };
}

function sourceStatuses(count: number): SourceStatus[] {
  return Array.from({ length: count }, (_, inputIndex) => ({
    inputIndex,
    status: "restored",
    conversationId: `conversation-${inputIndex}`,
    title: null,
    messageCount: 2,
    errorCode: null,
    errorMessage: null
  }));
}
