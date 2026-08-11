import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/attention/liveAttention", () => ({
  asEphemeralAttentionPreview: vi.fn((run: Record<string, unknown>) => ({
    ...run,
    contract: "attention-monitor-preview-v1",
    analysisId: null,
    sessionId: null,
    replayArtifactState: "not_recorded",
    replayArtifactSha256: null
  })),
  evaluateCurrentAttention: vi.fn()
}));

vi.mock("../src/attention/codeProvenance", () => ({
  resolveAttentionCodeProvenance: vi.fn().mockResolvedValue({
    codeCommitSha: "a".repeat(40),
    codeState: "declared_commit",
    codeFingerprintSha256: null
  }),
  unavailableCodeProvenance: vi.fn(() => ({
    codeCommitSha: null,
    codeState: "unavailable",
    codeFingerprintSha256: null
  }))
}));

vi.mock("../src/sync/runtime", () => ({
  syncRuntimeSources: vi.fn().mockResolvedValue({
    status: "ready",
    revision: "pipeline:test",
    generatedAt: "2026-07-27T00:00:00.000Z",
    sources: [],
    adapterMode: "coordinator"
  })
}));

vi.mock("../src/attention/localMonitorStore", async () => {
  class AttentionMonitorStoreError extends Error {
    constructor(
      public readonly code:
        | "STORE_READ_FAILED"
        | "STORE_WRITE_FAILED"
        | "RUN_NOT_FOUND"
    ) {
      super(code);
      this.name = "AttentionMonitorStoreError";
    }
  }
  return {
    AttentionMonitorStoreError,
    recordAttentionFailure: vi.fn(),
    recordAttentionRun: vi.fn(),
    readAttentionHistory: vi.fn(),
    recordAttentionFeedback: vi.fn()
  };
});

import {
  GET as getAttention,
  POST as refreshAttention
} from "../app/api/attention/route";
import { POST as postFeedback } from "../app/api/attention/feedback/route";
import { GET as getHistory } from "../app/api/attention/history/route";
import { evaluateCurrentAttention } from "../src/attention/liveAttention";
import {
  resolveAttentionCodeProvenance,
  unavailableCodeProvenance
} from "../src/attention/codeProvenance";
import type { AttentionHistoryResponse } from "../src/attention/monitoringSchema";
import {
  AttentionMonitorStoreError,
  readAttentionHistory,
  recordAttentionFeedback,
  recordAttentionFailure,
  recordAttentionRun
} from "../src/attention/localMonitorStore";
import {
  syncRuntimeSources
} from "../src/sync/runtime";

beforeEach(() => {
  vi.mocked(resolveAttentionCodeProvenance).mockResolvedValue({
    codeCommitSha: "a".repeat(40),
    codeState: "declared_commit",
    codeFingerprintSha256: null
  });
  vi.mocked(unavailableCodeProvenance).mockReturnValue({
    codeCommitSha: null,
    codeState: "unavailable",
    codeFingerprintSha256: null
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Attention routes", () => {
  it("previews stored snapshots without mutating history on local GET", async () => {
    setDevelopmentEnvironment();
    const evaluated = evaluatedFixture();
    vi.mocked(evaluateCurrentAttention).mockResolvedValue(
      evaluated as never
    );

    const response = await getAttention(
      new Request("http://localhost:3102/api/attention")
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(evaluateCurrentAttention).toHaveBeenCalledWith({
      refreshSources: false
    });
    expect(syncRuntimeSources).not.toHaveBeenCalled();
    expect(recordAttentionRun).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "ready",
      result: evaluated.result,
      baseResult: evaluated.baseResult,
      eligibilityProjection: evaluated.eligibilityProjection,
      recentMeaningfulEvents: evaluated.recentMeaningfulEvents,
      currentWorkstreams: evaluated.currentWorkstreams,
      currentFocus: evaluated.currentFocus,
      focusAwareAttentionShadow:
        evaluated.focusAwareAttentionShadow,
      recentWork: null,
      run: {
        ...evaluated.run,
        contract: "attention-monitor-preview-v1",
        replayArtifactState: "not_recorded",
        replayArtifactSha256: null
      },
      monitoring: { state: "preview", warningCode: null }
    });
    expect(JSON.stringify(payload)).not.toContain(
      "private-replay-input"
    );
    expect(JSON.stringify(payload)).not.toContain("raw-thread-id");
    expect(JSON.stringify(payload)).not.toContain("/Users/private");
    expect(JSON.stringify(payload)).not.toContain("secret-token");
    expect(JSON.stringify(payload)).not.toContain(
      "PRIVATE_RECENT_WORK_SIDECAR"
    );
  });

  it("exposes only the bounded Recent Work public summary", async () => {
    setDevelopmentEnvironment();
    const evaluated = evaluatedFixture();
    evaluated.recentWorkPublicSummary = {
      displayLabel: "Safe recent work",
      pushOccurredAt: "2026-07-26T11:58:00.000Z",
      trackingState: "in_sync",
      aheadCount: 0,
      behindCount: 0,
      correlation: "repository_scope_only",
      presentation: "display_only",
      attentionSelectionEffect: "none",
      executionEffect: "none"
    };
    vi.mocked(evaluateCurrentAttention).mockResolvedValue(evaluated as never);

    const response = await getAttention(
      new Request("http://localhost:3102/api/attention")
    );
    const payload = await response.json();
    expect(payload.recentWork).toEqual(evaluated.recentWorkPublicSummary);
    expect(JSON.stringify(payload)).not.toContain(
      "PRIVATE_RECENT_WORK_SIDECAR"
    );
    expect(JSON.stringify(payload.recentWork)).not.toContain("Sha256");
    expect(JSON.stringify(payload.recentWork)).not.toContain("project_");
  });

  it("refreshes both sources only through a same-origin local POST", async () => {
    setDevelopmentEnvironment();
    const evaluated = evaluatedFixture();
    vi.mocked(evaluateCurrentAttention).mockResolvedValue(
      evaluated as never
    );

    const response = await refreshAttention(
      new Request("http://localhost:3102/api/attention", {
        method: "POST",
        headers: { origin: "http://localhost:3102" }
      })
    );

    expect(response.status).toBe(200);
    expect(syncRuntimeSources).toHaveBeenCalledOnce();
    expect(evaluateCurrentAttention).toHaveBeenCalledWith({
      refreshSources: false,
      startedAt: expect.any(Date),
      executionIds: {
        runId: expect.stringMatching(/^run_[a-f0-9]{32}$/),
        analysisId: expect.stringMatching(
          /^analysis_[a-f0-9]{32}$/
        ),
        sessionId: expect.stringMatching(
          /^session_[a-f0-9]{32}$/
        )
      },
      codeProvenance: {
        codeCommitSha: "a".repeat(40),
        codeState: "declared_commit",
        codeFingerprintSha256: null
      }
    });
    expect(recordAttentionRun).toHaveBeenCalledWith(
      evaluated.run,
      evaluated.replayArtifact
    );
    await expect(response.json()).resolves.toMatchObject({
      monitoring: { state: "recorded", warningCode: null }
    });
  });

  it("keeps a current result available when history persistence degrades", async () => {
    setDevelopmentEnvironment();
    const evaluated = evaluatedFixture();
    vi.mocked(evaluateCurrentAttention).mockResolvedValue(
      evaluated as never
    );
    vi.mocked(recordAttentionRun).mockRejectedValue(
      new Error("PRIVATE_PATH")
    );

    const response = await refreshAttention(
      new Request("http://localhost:3102/api/attention", {
        method: "POST",
        headers: { origin: "http://localhost:3102" }
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.monitoring).toEqual({
      state: "degraded",
      warningCode: "RUN_HISTORY_WRITE_FAILED"
    });
    expect(payload.run).toMatchObject({
      contract: "attention-monitor-preview-v1",
      analysisId: null,
      sessionId: null,
      replayArtifactState: "not_recorded",
      replayArtifactSha256: null
    });
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_PATH");
  });

  it("records a sanitized source-sync failure for an explicit POST", async () => {
    setDevelopmentEnvironment();
    vi.mocked(syncRuntimeSources).mockRejectedValueOnce(
      new Error("secret-token=never-persist")
    );

    const response = await refreshAttention(
      new Request("http://localhost:3102/api/attention", {
        method: "POST",
        headers: { origin: "http://localhost:3102" }
      })
    );
    const payload = await response.json();
    const failure = vi.mocked(recordAttentionFailure).mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      status: "error",
      code: "ATTENTION_RUN_FAILED",
      message:
        "현재 작업 제안을 만들지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요."
    });
    expect(evaluateCurrentAttention).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      runId: expect.stringMatching(/^run_[a-f0-9]{32}$/),
      analysisId: expect.stringMatching(/^analysis_[a-f0-9]{32}$/),
      sessionId: expect.stringMatching(/^session_[a-f0-9]{32}$/),
      status: "failed",
      stage: "source_sync",
      errorCode: "SOURCE_SYNC_FAILED",
      retryCount: 0,
      engineVersion: "attention-live-orchestrator-v0.6",
      inputSchemaVersion: "cross-source-active-attention-input-v0.4",
      resultSchemaVersion: "cross-source-active-attention-result-v0.5",
      policyVersion: "aggressive-evidence-bound-attention-policy-v0.4",
      candidateRuleVersion:
        "github-managed-codex-active-candidate-rule-v0.2",
      lanePolicyVersion: "active-attention-lane-policy-v0.1",
      rankingPolicyVersion: "active-attention-ranking-policy-v0.3",
      resolverVersion: "active-attention-decision-resolver-v0.4",
      idPolicyVersion: "active-attention-id-v0.1",
      contract: "attention-monitor-failure-v0.5",
      codeCommitSha: "a".repeat(40),
      codeState: "declared_commit",
      codeFingerprintSha256: null,
      privacyClass: "private_local_metadata",
      retentionDays: 30
    });
    expect(JSON.stringify(failure)).not.toContain(
      "secret-token=never-persist"
    );
  });

  it("records resolver failure metadata with the pre-sync execution IDs", async () => {
    setDevelopmentEnvironment();
    vi.mocked(evaluateCurrentAttention).mockRejectedValueOnce(
      new Error("private resolver details")
    );

    const response = await refreshAttention(
      new Request("http://localhost:3102/api/attention", {
        method: "POST",
        headers: { origin: "http://localhost:3102" }
      })
    );
    const evaluationInput = vi.mocked(evaluateCurrentAttention).mock
      .calls[0][0];
    const failure = vi.mocked(recordAttentionFailure).mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(failure).toMatchObject({
      ...evaluationInput?.executionIds,
      status: "failed",
      stage: "attention_resolution",
      errorCode: "ATTENTION_RESOLUTION_FAILED",
      retryCount: 0
    });
    expect(JSON.stringify(failure)).not.toContain(
      "private resolver details"
    );
  });

  it("rejects remote and cross-origin access before evaluating", async () => {
    setDevelopmentEnvironment();

    const remote = await getAttention(
      new Request("https://app.example/api/attention")
    );
    const crossOrigin = await refreshAttention(
      new Request("http://localhost:3102/api/attention", {
        method: "POST",
        headers: { origin: "https://attacker.example" }
      })
    );

    expect(remote.status).toBe(404);
    expect(crossOrigin.status).toBe(403);
    expect(evaluateCurrentAttention).not.toHaveBeenCalled();
  });

  it("accepts a same-origin 127.0.0.1 development request", async () => {
    setDevelopmentEnvironment();
    const evaluated = evaluatedFixture();
    vi.mocked(evaluateCurrentAttention).mockResolvedValue(
      evaluated as never
    );

    const response = await refreshAttention(
      new Request("http://127.0.0.1:3102/api/attention", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3102" }
      })
    );

    expect(response.status).toBe(200);
    expect(recordAttentionRun).toHaveBeenCalledWith(
      evaluated.run,
      evaluated.replayArtifact
    );
  });

  it("returns metadata-only history without caching", async () => {
    setDevelopmentEnvironment();
    const history: AttentionHistoryResponse = {
      status: "ready",
      generatedAt: "2026-07-26T12:00:00.000Z",
      retentionDays: 30,
      runCount: 0,
      failureCount: 0,
      feedbackCount: 0,
      feedbackEventCount: 0,
      decisionCounts: {
        suggested: 0,
        needs_clarification: 0,
        no_action: 0,
        insufficient_evidence: 0
      },
      feedbackCounts: {
        helpful: 0,
        wrong_priority: 0,
        already_done: 0,
        not_mine: 0,
        insufficient_context: 0
      },
      failures: [],
      entries: []
    };
    vi.mocked(readAttentionHistory).mockResolvedValue(history);

    const response = await getHistory(
      new Request("http://localhost:3102/api/attention/history")
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual(history);
  });

  it("validates and records explicit feedback without free text", async () => {
    setDevelopmentEnvironment();
    const feedback = {
      feedbackId: "00000000-0000-4000-8000-000000000001"
    };
    vi.mocked(recordAttentionFeedback).mockResolvedValue(
      feedback as never
    );

    const response = await postFeedback(
      new Request(
        "http://localhost:3102/api/attention/feedback",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3102",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            runId: `run_${"a".repeat(32)}`,
            feedbackType: "helpful"
          })
        }
      )
    );

    expect(response.status).toBe(200);
    expect(recordAttentionFeedback).toHaveBeenCalledWith({
      runId: `run_${"a".repeat(32)}`,
      feedbackType: "helpful"
    });
    await expect(response.json()).resolves.toEqual({
      status: "recorded",
      feedback
    });
  });

  it("returns a safe not-found response for feedback on an unknown run", async () => {
    setDevelopmentEnvironment();
    vi.mocked(recordAttentionFeedback).mockRejectedValue(
      new AttentionMonitorStoreError("RUN_NOT_FOUND")
    );

    const response = await postFeedback(
      new Request(
        "http://localhost:3102/api/attention/feedback",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3102",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            runId: `run_${"a".repeat(32)}`,
            feedbackType: "already_done"
          })
        }
      )
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "RUN_NOT_FOUND",
      message: "평가할 Attention 실행 기록을 찾지 못했습니다."
    });
  });
});

function evaluatedFixture() {
  return {
    result: {
      resultId: `res_${"b".repeat(32)}`,
      decision: { status: "insufficient_evidence" }
    },
    baseResult: {
      resultId: `result_${"c".repeat(32)}`
    },
    eligibilityProjection: {
      projectionSha256: "d".repeat(64)
    },
    developerSignals: {
      publicSummary: {
        contract: "developer-runtime-public-summary-v0.1",
        summarySha256: "e".repeat(64)
      }
    },
    recentMeaningfulEvents: null,
    currentWorkstreams: null,
    currentFocus: {
      status: "unavailable",
      projectionSha256: "f".repeat(64),
      reasonCodes: ["FOCUS_PROJECTION_UNAVAILABLE"],
      attentionSelectionEffect: "none"
    },
    focusAwareAttentionShadow: {
      status: "unavailable",
      projectionSha256: "1".repeat(64),
      existingTopCandidateId: null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false,
      attentionSelectionEffect: "none"
    },
    recentWork: {
      marker: "PRIVATE_RECENT_WORK_SIDECAR"
    },
    recentWorkPublicSummary: null as null | Record<string, unknown>,
    run: {
      runId: `run_${"a".repeat(32)}`,
      resultId: `res_${"b".repeat(32)}`
    },
    replayArtifact: {
      marker: "private-replay-input"
    }
  };
}

function setDevelopmentEnvironment() {
  vi.stubEnv("NODE_ENV", "development");
}

function expectNoStore(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}
