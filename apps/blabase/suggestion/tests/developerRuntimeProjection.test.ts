import { describe, expect, it } from "vitest";

import {
  resolveActiveAttention,
  type ActiveAttentionResult
} from "../src/attentionDecision";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import {
  adaptCodexWorkSignalBatchToOpenLoopInput,
  extractCodexOpenLoops,
  type CodexOpenLoopLedger
} from "../src/developerSignals/codexOpenLoops";
import {
  buildDeveloperRuntimeProjection,
  developerRuntimeProjectionSchema,
  developerRuntimePublicSummarySchema,
  verifyDeveloperRuntimeProjection,
  type DeveloperRuntimeProjectionInput
} from "../src/developerSignals/runtimeProjection";
import {
  ACTIVE_FIXTURE_AS_OF,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

const RUN_ID = `run_${"1".repeat(32)}`;
const ANALYSIS_ID = `analysis_${"2".repeat(32)}`;
const PRIVATE_CODEX_TITLE = "Private Codex payment plan";
const PRIVATE_CODEX_PROMPT =
  "다음 단계로 비공개 결제 회귀 테스트를 실행해야 합니다.";
const PRIVATE_CODEX_RESPONSE =
  "구현했습니다. 후속으로 비공개 PR을 생성해야 합니다.";

describe("developer runtime sidecar projection v0.1", () => {
  it("assembles GitHub decisions and Codex history without promoting history", () => {
    const input = runtimeInput();
    const first = buildDeveloperRuntimeProjection(input);
    const second = buildDeveloperRuntimeProjection(input);

    expect(second).toEqual(first);
    expect(developerRuntimeProjectionSchema.parse(first)).toEqual(first);
    expect(verifyDeveloperRuntimeProjection(first)).toBe(true);
    expect(first.ledger.workItems).toHaveLength(1);
    expect(first.ledger.executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "codex",
          state: "unknown",
          reasonCodes: expect.arrayContaining([
            "CODEX_CURRENT_EXECUTION_STATE_UNKNOWN"
          ])
        })
      ])
    );
    expect(first.ledger.openLoops.length).toBeGreaterThan(1);
    expect(
      first.ledger.nextActions.some(
        (action) => action.state === "selected"
      )
    ).toBe(true);
    expect(
      first.ledger.nextActions.some(
        (action) =>
          action.state === "ineligible" &&
          action.reasonCodes.includes(
            "CODEX_HISTORY_CURRENTNESS_UNVERIFIED"
          )
      )
    ).toBe(true);

    const selected = first.funnel.traces.filter(
      (trace) => trace.stages.selected.outcome === "selected"
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ source: "github" });

    const codexTraces = first.funnel.traces.filter(
      (trace) => trace.source === "codex"
    );
    expect(codexTraces.length).toBeGreaterThan(0);
    expect(
      codexTraces.every(
        (trace) =>
          trace.candidateId === null &&
          trace.stages.verified.outcome === "rejected" &&
          trace.stages.verified.reasonCodes.includes(
            "CODEX_HISTORY_CURRENTNESS_UNVERIFIED"
          ) &&
          trace.stages.eligibility.outcome === "not_reached"
      )
    ).toBe(true);
  });

  it("publishes hashes and aggregate counts without private display fields", () => {
    const projection = buildDeveloperRuntimeProjection(runtimeInput());
    const summary = projection.publicSummary;

    expect(developerRuntimePublicSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      privacyClass: "public_aggregate_metadata",
      ledgerId: projection.ledger.ledgerId,
      ledgerSha256: projection.ledger.ledgerSha256,
      funnelId: projection.funnel.funnelId,
      funnelSha256: projection.funnel.projectionSha256
    });
    expect(summary.entityCounts.workItems).toBe(
      projection.ledger.workItems.length
    );
    expect(summary.claimCounts.total).toBe(
      runtimeInput().codexOpenLoopLedger.claims.length
    );
    expect(summary.stageSummaries).toEqual(
      projection.funnel.stageSummaries
    );

    const serialized = JSON.stringify(summary);
    for (const privateValue of [
      "Synthetic linked task",
      "synthetic/private",
      PRIVATE_CODEX_TITLE,
      PRIVATE_CODEX_PROMPT,
      PRIVATE_CODEX_RESPONSE,
      "https://",
      "/Users/"
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(collectKeys(summary)).not.toEqual(
      expect.arrayContaining([
        "title",
        "excerpt",
        "url",
        "destinationurl",
        "path"
      ])
    );
    expect(
      developerRuntimePublicSummarySchema.safeParse({
        ...summary,
        title: "must remain private"
      }).success
    ).toBe(false);
  });

  it("safely handles GitHub work items that have no actionability facts", () => {
    const fixture = activeAttentionFixture({
      githubKind: "assigned_issue",
      managedScenario: "none"
    });
    const result = resolveActiveAttention(fixture.input);
    const projection = buildDeveloperRuntimeProjection({
      asOf: ACTIVE_FIXTURE_AS_OF,
      runId: RUN_ID,
      analysisId: ANALYSIS_ID,
      codeProvenance: {
        codeState: "unavailable",
        codeCommitSha: null,
        codeFingerprintSha256: null
      },
      githubBatch: fixture.githubBatch,
      codexBatch: null,
      activeAttentionResult: result,
      eligibilityProjection: fixture.eligibilityProjection,
      codexOpenLoopLedger: emptyOpenLoopLedger()
    });

    expect(projection.ledger.blockers).toEqual([]);
    expect(projection.funnel.selectedCandidateId).toBe(
      result.decision.topSuggestion?.candidateId
    );
  });

  it("rejects inputs whose component as-of times do not match", () => {
    expect(() =>
      buildDeveloperRuntimeProjection({
        ...runtimeInput(),
        asOf: "2026-08-02T03:00:01.000Z"
      })
    ).toThrow();
  });
});

function runtimeInput(): DeveloperRuntimeProjectionInput {
  const fixture = activeAttentionFixture({
    githubKind: "assigned_issue",
    managedScenario: "none"
  });
  const activeAttentionResult: ActiveAttentionResult =
    resolveActiveAttention(fixture.input);
  const codexBatch = normalizeCodexBatch();
  const codexOpenLoopLedger = extractCodexOpenLoops(
    adaptCodexWorkSignalBatchToOpenLoopInput({
      batch: codexBatch,
      asOf: ACTIVE_FIXTURE_AS_OF
    })
  );
  return {
    asOf: ACTIVE_FIXTURE_AS_OF,
    runId: RUN_ID,
    analysisId: ANALYSIS_ID,
    codeProvenance: {
      codeState: "unavailable",
      codeCommitSha: null,
      codeFingerprintSha256: null
    },
    githubBatch: fixture.githubBatch,
    codexBatch,
    activeAttentionResult,
    eligibilityProjection: fixture.eligibilityProjection,
    codexOpenLoopLedger
  };
}

function normalizeCodexBatch(): RuntimeWorkSignalBatch {
  const normalized = normalizeCodexSnapshotToWorkSignals(codexSnapshot(), {
    asOf: ACTIVE_FIXTURE_AS_OF,
    freshnessPolicy: {
      version: "developer-runtime-synthetic-freshness-v0.1",
      maxAgeMsBySource: {
        github: 60 * 60 * 1_000,
        codex: 60 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60 * 1_000
    }
  });
  if (normalized.status !== "normalized") {
    throw new Error("Synthetic Codex runtime batch did not normalize.");
  }
  return normalized.batch;
}

function codexSnapshot(): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-conversation-and-execution-v1",
    contentMode: "conversation_and_execution",
    codexVersion: "codex-cli synthetic",
    fetchedAt: "2026-08-02T02:59:00.000Z",
    lookbackStart: "2026-07-03T02:59:00.000Z",
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
        projectLabel: "private-codex-project",
        taskSummary: PRIVATE_CODEX_TITLE,
        taskSummarySource: "thread_name",
        createdAt: "2026-08-02T02:30:00.000Z",
        updatedAt: "2026-08-02T02:58:00.000Z",
        activityState: "not_loaded",
        attentionState: null,
        content: {
          ...emptyCodexContentManifest(),
          state: "complete",
          contentSha256: "d".repeat(64),
          contentSourceUpdatedAt: "2026-08-02T02:58:00.000Z",
          collectedAt: "2026-08-02T02:59:00.000Z",
          expiresAt: "2026-08-09T02:59:00.000Z",
          historicalTurnStatus: "completed",
          latestTurnCompletedAt: "2026-08-02T02:57:00.000Z",
          turnCount: 1,
          userPromptCount: 1,
          agentResponseCount: 1,
          commandExecutionCount: 1,
          failedCommandCount: 1,
          fileChangeCount: 0,
          toolCallCount: 0,
          reasonCodes: [],
          latestUserPromptExcerpt: PRIVATE_CODEX_PROMPT,
          latestAgentResponseExcerpt: PRIVATE_CODEX_RESPONSE,
          latestExecutionSummary: "failed · exit 1 · npm test"
        }
      }
    ]
  };
}

function emptyOpenLoopLedger(): CodexOpenLoopLedger {
  return extractCodexOpenLoops({
    contract: "codex-open-loop-input-v1",
    asOf: ACTIVE_FIXTURE_AS_OF,
    signals: []
  });
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    key.toLowerCase(),
    ...collectKeys(nested)
  ]);
}
