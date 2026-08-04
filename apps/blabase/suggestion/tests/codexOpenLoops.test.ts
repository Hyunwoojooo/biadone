import { describe, expect, it } from "vitest";

import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import {
  CODEX_OPEN_LOOP_INPUT_CONTRACT,
  adaptCodexWorkSignalBatchToOpenLoopInput,
  codexOpenLoopInputSchema,
  codexOpenLoopLedgerSchema,
  extractCodexOpenLoops,
  type CodexOpenLoopInput,
  type CodexOpenLoopSignalInput
} from "../src/developerSignals/codexOpenLoops";

const AS_OF = "2026-08-05T12:00:00.000Z";
const SUBJECT_ID = `codex:execution:${"a".repeat(24)}`;
const PROJECT_ID = `project_${"b".repeat(32)}`;
const SIGNAL_1 = `sig_${"1".repeat(32)}`;
const SIGNAL_2 = `sig_${"2".repeat(32)}`;
const SIGNAL_3 = `sig_${"3".repeat(32)}`;

describe("Codex open-loop extractor v1", () => {
  it("extracts bounded goal and explicit remaining work as ledger-only claims", () => {
    const input = makeInput([
      makeSignal({
        taskSummary: "결제 API 정리",
        latestUserPromptExcerpt:
          "다음 단계로 실패한 결제 테스트를 수정해야 해."
      })
    ]);

    const first = extractCodexOpenLoops(input);
    const second = extractCodexOpenLoops(input);

    expect(first).toEqual(second);
    expect(codexOpenLoopLedgerSchema.parse(first)).toEqual(first);
    expect(
      first.claims.map((claim) => claim.claimType).sort()
    ).toEqual([
      "goal",
      "remaining_work"
    ]);
    expect(first.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimType: "goal",
          ruleId: "TASK_SUMMARY_AS_GOAL",
          confidence: 0.45,
          verificationStatus: "unverified",
          lifecycleStatus: "open",
          attentionDisposition: "ledger_input_only",
          forbiddenAsAttentionCandidate: true
        }),
        expect.objectContaining({
          claimType: "remaining_work",
          ruleId: "USER_EXPLICIT_REMAINING_WORK",
          confidence: 0.72,
          verificationStatus: "evidence_supported",
          lifecycleStatus: "open",
          attentionDisposition: "ledger_input_only",
          forbiddenAsAttentionCandidate: true
        })
      ])
    );
    expect(first.attentionDisposition).toBe("not_connected");
    expect(first.forbiddenAsAttentionCandidate).toBe(true);
    expect(first.counts).toEqual({
      open: 2,
      expired: 0,
      superseded: 0,
      byType: {
        goal: 1,
        remaining_work: 1,
        blocker: 0,
        verification_needed: 0,
        follow_through: 0
      }
    });
  });

  it("classifies explicit blockers, verification needs, follow-through, and failed execution", () => {
    const blocker = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          latestUserPromptExcerpt:
            "배포 권한이 없어서 진행할 수 없어 막혔어.",
          latestExecutionSummary: "completed · exit 2 · npm test"
        })
      ])
    );
    expect(
      blocker.claims.filter((claim) => claim.claimType === "blocker")
    ).toEqual([
      expect.objectContaining({ ruleId: "USER_EXPLICIT_BLOCKER" }),
      expect.objectContaining({
        ruleId: "EXECUTION_FAILED_NEEDS_INSPECTION",
        value: "최근 실패한 실행 결과를 확인해야 합니다.",
        confidence: 0.85
      })
    ]);

    const verification = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          latestUserPromptExcerpt:
            "변경된 로그인 동작은 브라우저에서 검증이 필요해.",
          latestAgentResponseExcerpt:
            "구현은 끝났지만 테스트를 하지 못해 확인이 필요합니다."
        })
      ])
    );
    expect(
      verification.claims.map((claim) => claim.claimType)
    ).toEqual(["verification_needed", "verification_needed"]);

    const followThrough = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          latestAgentResponseExcerpt:
            "구현을 완료했습니다. 다음 단계로 PR을 생성해야 합니다."
        })
      ])
    );
    expect(followThrough.claims).toEqual([
      expect.objectContaining({
        claimType: "follow_through",
        ruleId: "AGENT_EXPLICIT_FOLLOW_THROUGH",
        lifecycleStatus: "open"
      })
    ]);
  });

  it("lowers confidence and verification when historical evidence is partial", () => {
    const ledger = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          historicalContextCompleteness: "partial",
          contentTruncated: true,
          latestUserPromptExcerpt: "릴리스 전에 테스트가 필요합니다."
        })
      ])
    );

    expect(ledger.claims).toEqual([
      expect.objectContaining({
        claimType: "verification_needed",
        confidence: 0.55,
        verificationStatus: "unverified"
      })
    ]);
  });

  it("expires old evidence and supersedes older claims with a newer revision", () => {
    const ledger = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          signalId: SIGNAL_1,
          sourceUpdatedAt: "2026-07-20T12:00:00.000Z",
          evidenceValidUntil: "2026-07-27T12:00:00.000Z",
          latestUserPromptExcerpt: "API 문서를 수정해야 합니다."
        }),
        makeSignal({
          signalId: SIGNAL_2,
          sourceUpdatedAt: "2026-08-04T10:00:00.000Z",
          latestUserPromptExcerpt: "API 예제를 추가해야 합니다."
        })
      ])
    );

    const old = ledger.claims.find((claim) =>
      claim.evidenceRefs.some((evidence) => evidence.signalId === SIGNAL_1)
    );
    const current = ledger.claims.find((claim) =>
      claim.evidenceRefs.some((evidence) => evidence.signalId === SIGNAL_2)
    );
    expect(old).toMatchObject({
      lifecycleStatus: "superseded",
      supersededBySignalId: SIGNAL_2
    });
    expect(current).toMatchObject({
      lifecycleStatus: "open",
      supersededBySignalId: null
    });
    expect(ledger.counts).toMatchObject({
      open: 1,
      expired: 0,
      superseded: 1
    });

    const expiredOnly = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          signalId: SIGNAL_3,
          sourceUpdatedAt: "2026-07-20T12:00:00.000Z",
          evidenceValidUntil: "2026-07-27T12:00:00.000Z",
          latestUserPromptExcerpt: "API 문서를 수정해야 합니다."
        })
      ])
    );
    expect(expiredOnly.claims[0]).toMatchObject({
      lifecycleStatus: "expired",
      supersededBySignalId: null
    });
  });

  it("uses a strict later completion marker to supersede action claims without creating a candidate", () => {
    const ledger = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          signalId: SIGNAL_1,
          sourceUpdatedAt: "2026-08-04T09:00:00.000Z",
          latestUserPromptExcerpt: "결제 회귀 테스트를 수정해야 합니다."
        }),
        makeSignal({
          signalId: SIGNAL_2,
          sourceUpdatedAt: "2026-08-04T10:00:00.000Z",
          historicalTurnStatus: "completed",
          latestUserPromptExcerpt: null,
          latestAgentResponseExcerpt: "요청한 변경을 완료했습니다."
        })
      ])
    );

    expect(ledger.claims).toEqual([
      expect.objectContaining({
        claimType: "remaining_work",
        lifecycleStatus: "superseded",
        supersededBySignalId: SIGNAL_2,
        forbiddenAsAttentionCandidate: true
      })
    ]);
  });

  it("does not infer an open loop from vague status or a completion-only answer", () => {
    const ledger = extractCodexOpenLoops(
      makeInput([
        makeSignal({
          taskSummary: null,
          latestUserPromptExcerpt: "현재 상태를 알려줘.",
          latestAgentResponseExcerpt: "작업을 완료했습니다.",
          latestExecutionSummary: "completed · exit 0 · npm test"
        })
      ])
    );

    expect(ledger.claims).toEqual([]);
    expect(ledger.counts.open).toBe(0);
  });

  it("adapts only integrity-verified current Codex manifest facts", () => {
    const batch = normalizeCodexBatch(conversationSnapshot());
    const adapted = adaptCodexWorkSignalBatchToOpenLoopInput({
      batch,
      asOf: AS_OF
    });

    expect(codexOpenLoopInputSchema.parse(adapted)).toEqual(adapted);
    expect(adapted).toMatchObject({
      contract: CODEX_OPEN_LOOP_INPUT_CONTRACT,
      asOf: AS_OF,
      signals: [
        {
          projectId: null,
          historicalContextCompleteness: "complete",
          historicalTurnStatus: "completed",
          contentTruncated: false,
          taskSummary: "결제 API 정리",
          latestUserPromptExcerpt: "다음 단계 테스트를 실행해야 합니다.",
          latestAgentResponseExcerpt:
            "구현했습니다. 후속으로 PR을 생성해야 합니다.",
          latestExecutionSummary: "failed · exit 1 · npm test"
        }
      ]
    });
    expect(adapted.signals[0]?.factEvidence).toHaveLength(4);
    expect(
      adapted.signals[0]?.factEvidence.map((evidence) => evidence.field)
    ).toEqual([
      "task_summary",
      "latest_user_prompt_excerpt",
      "latest_agent_response_excerpt",
      "latest_execution_summary"
    ]);
    const ledger = extractCodexOpenLoops(adapted);
    expect(ledger.claims.length).toBeGreaterThan(0);
    expect(
      ledger.claims.every(
        (claim) =>
          claim.forbiddenAsAttentionCandidate &&
          claim.attentionDisposition === "ledger_input_only"
      )
    ).toBe(true);
  });

  it("drops expired conversation excerpts at the adapter boundary", () => {
    const snapshot = conversationSnapshot();
    snapshot.sessions[0] = {
      ...snapshot.sessions[0]!,
      content: {
        ...snapshot.sessions[0]!.content,
        state: "stale",
        expiresAt: "2026-08-05T11:00:00.000Z"
      }
    };
    const adapted = adaptCodexWorkSignalBatchToOpenLoopInput({
      batch: normalizeCodexBatch(snapshot),
      asOf: AS_OF
    });

    expect(adapted.signals[0]).toMatchObject({
      historicalContextCompleteness: "unavailable",
      historicalTurnStatus: "unknown",
      contentTruncated: false,
      taskSummary: "결제 API 정리",
      latestUserPromptExcerpt: null,
      latestAgentResponseExcerpt: null,
      latestExecutionSummary: null
    });
    expect(adapted.signals[0]?.factEvidence).toHaveLength(1);
    expect(extractCodexOpenLoops(adapted).claims).toEqual([
      expect.objectContaining({ claimType: "goal" })
    ]);
  });

  it("rejects tampered, stale, wrong-source, and as-of-mismatched batches", () => {
    const batch = normalizeCodexBatch(conversationSnapshot());
    expect(() =>
      adaptCodexWorkSignalBatchToOpenLoopInput({
        batch: { ...batch, batchSha256: "f".repeat(64) },
        asOf: AS_OF
      })
    ).toThrow("CODEX_OPEN_LOOP_BATCH_INTEGRITY_FAILED");

    const staleBatch = normalizeCodexBatch(conversationSnapshot(), {
      asOf: "2026-08-05T13:00:01.000Z",
      maxCodexAgeMs: 60 * 60 * 1_000
    });
    expect(() =>
      adaptCodexWorkSignalBatchToOpenLoopInput({
        batch: staleBatch,
        asOf: "2026-08-05T13:00:01.000Z"
      })
    ).toThrow("CODEX_OPEN_LOOP_SOURCE_NOT_CURRENT");

    expect(() =>
      adaptCodexWorkSignalBatchToOpenLoopInput({
        batch,
        asOf: "2026-08-05T12:00:01.000Z"
      })
    ).toThrow("CODEX_OPEN_LOOP_AS_OF_MISMATCH");

    expect(() =>
      adaptCodexWorkSignalBatchToOpenLoopInput({
        batch: {
          ...batch,
          source: "github",
          assessment: { ...batch.assessment, source: "github" }
        },
        asOf: AS_OF
      })
    ).toThrow();
  });

  it("rejects unavailable excerpts, duplicate IDs, future evidence, and unbounded text", () => {
    expect(() =>
      codexOpenLoopInputSchema.parse(
        makeInput([
          makeSignal({
            historicalContextCompleteness: "unavailable",
            latestUserPromptExcerpt: "해야 할 일이 있습니다."
          })
        ])
      )
    ).toThrow();
    expect(() =>
      codexOpenLoopInputSchema.parse(
        makeInput([makeSignal(), makeSignal()])
      )
    ).toThrow();
    expect(() =>
      codexOpenLoopInputSchema.parse(
        makeInput([
          makeSignal({ sourceUpdatedAt: "2026-08-06T12:00:00.000Z" })
        ])
      )
    ).toThrow();
    expect(() =>
      codexOpenLoopInputSchema.parse(
        makeInput([
          makeSignal({ latestUserPromptExcerpt: "x".repeat(201) })
        ])
      )
    ).toThrow();
  });
});

function makeInput(
  signals: CodexOpenLoopSignalInput[]
): CodexOpenLoopInput {
  return {
    contract: CODEX_OPEN_LOOP_INPUT_CONTRACT,
    asOf: AS_OF,
    signals
  };
}

function makeSignal(
  overrides: Partial<CodexOpenLoopSignalInput> = {}
): CodexOpenLoopSignalInput {
  const signal: CodexOpenLoopSignalInput = {
    signalId: SIGNAL_1,
    subjectId: SUBJECT_ID,
    projectId: PROJECT_ID,
    sourceUpdatedAt: "2026-08-04T09:00:00.000Z",
    evidenceValidUntil: "2026-08-11T09:00:00.000Z",
    historicalContextCompleteness: "complete",
    historicalTurnStatus: "completed",
    contentTruncated: false,
    taskSummary: null,
    latestUserPromptExcerpt: null,
    latestAgentResponseExcerpt: null,
    latestExecutionSummary: null,
    factEvidence: [],
    ...overrides
  };
  if (overrides.factEvidence === undefined) {
    signal.factEvidence = [
      ["task_summary", signal.taskSummary],
      ["latest_user_prompt_excerpt", signal.latestUserPromptExcerpt],
      ["latest_agent_response_excerpt", signal.latestAgentResponseExcerpt],
      ["latest_execution_summary", signal.latestExecutionSummary]
    ].flatMap(([field, value]) =>
      typeof value === "string"
        ? [
            {
              field: field as CodexOpenLoopSignalInput["factEvidence"][number]["field"],
              valueSha256: runtimeSha256({
                domain: "codex-session-field-v0.1",
                field,
                value
              }),
              observedAt: signal.sourceUpdatedAt,
              sourceUpdatedAt: signal.sourceUpdatedAt
            }
          ]
        : []
    );
  }
  return signal;
}

function conversationSnapshot(): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion:
      "codex-app-server-conversation-and-execution-v1",
    contentMode: "conversation_and_execution",
    codexVersion: "codex-cli synthetic",
    fetchedAt: "2026-08-05T11:59:00.000Z",
    lookbackStart: "2026-07-06T11:59:00.000Z",
    truncated: false,
    conversationStoreSha256: "c".repeat(64),
    conversationRetentionDays: 7,
    scopeIds: ["1".repeat(24)],
    sessions: [
      {
        id: "a".repeat(24),
        source: "codex",
        kind: "coding_session",
        scopeId: "1".repeat(24),
        projectLabel: "synthetic-project",
        taskSummary: "결제 API 정리",
        taskSummarySource: "thread_name",
        createdAt: "2026-08-05T09:00:00.000Z",
        updatedAt: "2026-08-05T11:58:00.000Z",
        activityState: "not_loaded",
        attentionState: null,
        content: {
          ...emptyCodexContentManifest(),
          state: "complete",
          contentSha256: "d".repeat(64),
          contentSourceUpdatedAt: "2026-08-05T11:58:00.000Z",
          collectedAt: "2026-08-05T11:59:00.000Z",
          expiresAt: "2026-08-12T11:59:00.000Z",
          historicalTurnStatus: "completed",
          latestTurnCompletedAt: "2026-08-05T11:57:00.000Z",
          turnCount: 1,
          userPromptCount: 1,
          agentResponseCount: 1,
          commandExecutionCount: 1,
          failedCommandCount: 1,
          fileChangeCount: 0,
          toolCallCount: 0,
          reasonCodes: [],
          latestUserPromptExcerpt:
            "다음 단계 테스트를 실행해야 합니다.",
          latestAgentResponseExcerpt:
            "구현했습니다. 후속으로 PR을 생성해야 합니다.",
          latestExecutionSummary: "failed · exit 1 · npm test"
        }
      }
    ]
  };
}

function normalizeCodexBatch(
  snapshot: CodexSnapshot,
  options: { asOf?: string; maxCodexAgeMs?: number } = {}
) {
  const normalized = normalizeCodexSnapshotToWorkSignals(snapshot, {
    asOf: options.asOf ?? AS_OF,
    freshnessPolicy: {
      version: "codex-open-loop-test-freshness-v1",
      maxAgeMsBySource: {
        github: 60 * 60 * 1_000,
        codex: options.maxCodexAgeMs ?? 60 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60 * 1_000
    }
  });
  if (normalized.status !== "normalized") {
    throw new Error("Synthetic Codex batch did not normalize.");
  }
  return normalized.batch;
}
