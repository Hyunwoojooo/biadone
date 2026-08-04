import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  attentionMonitorDirectory,
  attentionReplayInputDirectory,
  readAttentionMonitorStore,
  readAttentionReplayInputArtifact,
  recordAttentionFeedback,
  recordAttentionFailure,
  recordAttentionRun
} from "../src/attention/localMonitorStore";
import { createAttentionFailureRecord } from "../src/attention/execution";
import {
  attentionMonitorRunSchema,
  currentAttentionReplayInputArtifactSchema
} from "../src/attention/monitoringSchema";
import { resolveActiveAttention } from "../src/attentionDecision";
import {
  phase2AttentionInput,
  phase2UnavailableSource,
  runPhase2AttentionRouter
} from "../src/crossSource/runAttentionRouter";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import { activeAttentionFixture } from "./fixtures/activeAttentionFixture";

const AS_OF = "2026-08-02T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Phase 4 Attention monitor compatibility", () => {
  it("rejects a current success run whose latency does not match its timestamps", () => {
    const active = activeRunFixture();
    expect(
      attentionMonitorRunSchema.safeParse({
        ...active,
        latencyMs: active.latencyMs + 1
      }).success
    ).toBe(false);
    expect(
      attentionMonitorRunSchema.safeParse({
        ...active,
        completedAt: "2026-08-02T11:59:59.999Z",
        latencyMs: 0
      }).success
    ).toBe(false);
  });

  it("records review-required active assessments without mapping them to provisional", () => {
    const active = activeRunFixture();
    const parsed = attentionMonitorRunSchema.parse(active);

    expect(parsed).toMatchObject({
      contract: "attention-monitor-run-v0.5",
      resultContract: "cross-source-active-attention-result-v0.5",
      candidateCounts: {
        eligible: 0,
        reviewRequired: 1,
        ineligible: 0
      },
      candidateAssessments: [
        {
          status: "review_required",
          reviewRoute: "user_review",
          triggerKind: "github_work_item"
        }
      ]
    });
    expect(JSON.stringify(parsed)).not.toContain("provisional");
    expect(
      attentionMonitorRunSchema.safeParse({
        ...active,
        candidateCounts: {
          eligible: 0,
          provisional: 1,
          ineligible: 0
        }
      }).success
    ).toBe(false);
    expect(
      attentionMonitorRunSchema.safeParse({
        ...active,
        policyVersion:
          "aggressive-evidence-bound-attention-policy-v0.2"
      }).success
    ).toBe(false);
  });

  it("binds an active top candidate to exactly one eligible active assessment", () => {
    const candidateId = `attention_${"c".repeat(32)}`;
    const assessment = {
      assessmentId: `attention_assessment_${"d".repeat(32)}`,
      candidateId,
      triggerSource: "github" as const,
      triggerKind: "github_work_item" as const,
      status: "eligible" as const,
      reviewRoute: "none" as const,
      reasonCodes: ["ELIGIBLE_GITHUB_DIRECT_WORK" as const]
    };
    const suggested = {
      ...activeRunFixture(),
      decisionStatus: "suggested" as const,
      certainty: "confirmed" as const,
      topCandidateId: candidateId,
      candidateCounts: {
        eligible: 1,
        reviewRequired: 0,
        ineligible: 0
      },
      candidateAssessments: [assessment],
      coverageDisposition: "scoped_complete" as const,
      decisionReasonCodes: ["DECISION_BEST_ELIGIBLE_CANDIDATE"]
    };

    expect(attentionMonitorRunSchema.safeParse(suggested).success).toBe(
      true
    );
    expect(
      attentionMonitorRunSchema.safeParse({
        ...suggested,
        topCandidateId: `att_${"e".repeat(32)}`
      }).success
    ).toBe(false);
    expect(
      attentionMonitorRunSchema.safeParse({
        ...suggested,
        topCandidateId: `attention_${"e".repeat(32)}`
      }).success
    ).toBe(false);
  });

  it("reads replay-backed v0.3 metadata and preserves the raw record across future writes", async () => {
    const cwd = await temporaryDirectory();
    const { rawRun, replayArtifact } = previousRunFixture();
    const monitorDirectory = attentionMonitorDirectory(cwd);
    const replayDirectory = attentionReplayInputDirectory(cwd);
    await mkdir(replayDirectory, { recursive: true });
    await writeFile(
      join(monitorDirectory, "monitor.json"),
      `${JSON.stringify({
        contract: "attention-monitor-store-v0.1",
        updatedAt: AS_OF,
        runs: [rawRun],
        feedback: [],
        failures: []
      })}\n`,
      "utf8"
    );
    await writeFile(
      join(replayDirectory, `${rawRun.runId}.json`),
      `${JSON.stringify(replayArtifact)}\n`,
      "utf8"
    );

    const parsed = await readAttentionMonitorStore(
      cwd,
      new Date("2026-08-02T12:01:00.000Z")
    );
    expect(parsed.runs[0]).toMatchObject({
      contract: "attention-monitor-run-v0.3",
      replayArtifactState: "available",
      candidateCounts: {
        eligible: 0,
        provisional: 0,
        ineligible: 0
      }
    });
    await expect(
      readAttentionReplayInputArtifact(rawRun.runId, cwd)
    ).resolves.toEqual(replayArtifact);

    await recordAttentionFeedback(
      { runId: rawRun.runId, feedbackType: "helpful" },
      cwd,
      new Date("2026-08-02T12:02:00.000Z")
    );
    const persisted = JSON.parse(
      await readFile(join(monitorDirectory, "monitor.json"), "utf8")
    ) as { runs: Array<Record<string, unknown>> };
    expect(persisted.runs[0]).toEqual(rawRun);
  });

  it("stores an exact replay v2 input and binds feedback to the active top candidate", async () => {
    const cwd = await temporaryDirectory();
    const { input } = activeAttentionFixture();
    const result = resolveActiveAttention(input);
    expect(result.decision.status).toBe("suggested");
    const topCandidateId = result.decision.topSuggestion?.candidateId;
    expect(topCandidateId).toMatch(/^attention_[a-f0-9]{32}$/);

    const runId = `run_${"c".repeat(32)}`;
    const analysisId = `analysis_${"d".repeat(32)}`;
    const sessionId = `session_${"e".repeat(32)}`;
    const replayArtifact =
      currentAttentionReplayInputArtifactSchema.parse({
        contract: "attention-replay-input-v2",
        runId,
        analysisId,
        sessionId,
        capturedAt: AS_OF,
        inputSha256: input.inputSha256,
        privacyClass: "private_local_engine_input",
        retentionDays: 30,
        input
      });
    const replayArtifactSha256 = runtimeSha256({
      domain: "attention-private-replay-artifact-v2",
      artifact: replayArtifact
    });
    const run = activeRunFromResult({
      result,
      runId,
      analysisId,
      sessionId,
      replayArtifactSha256
    });

    await recordAttentionRun(
      run,
      replayArtifact,
      cwd,
      new Date(AS_OF)
    );
    await expect(
      readAttentionReplayInputArtifact(runId, cwd)
    ).resolves.toEqual(replayArtifact);
    await expect(
      recordAttentionFeedback(
        { runId, feedbackType: "helpful" },
        cwd,
        new Date("2026-08-02T03:01:00.000Z")
      )
    ).resolves.toMatchObject({
      runId,
      candidateId: topCandidateId,
      feedbackType: "helpful"
    });

    expect(
      currentAttentionReplayInputArtifactSchema.safeParse({
        ...replayArtifact,
        input: {
          ...input,
          baseAttentionInput: {
            ...input.baseAttentionInput,
            focus: {
              ...input.baseAttentionInput.focus,
              primaryOutcome: "tampered after capture"
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("reads the previous v0.4 active run against its original replay v2 input", async () => {
    const cwd = await temporaryDirectory();
    const { input } = activeAttentionFixture();
    const result = resolveActiveAttention(input);
    const runId = `run_${"8".repeat(32)}`;
    const analysisId = `analysis_${"9".repeat(32)}`;
    const sessionId = `session_${"a".repeat(32)}`;
    const replayArtifact =
      currentAttentionReplayInputArtifactSchema.parse({
        contract: "attention-replay-input-v2",
        runId,
        analysisId,
        sessionId,
        capturedAt: AS_OF,
        inputSha256: input.inputSha256,
        privacyClass: "private_local_engine_input",
        retentionDays: 30,
        input
      });
    const replayArtifactSha256 = runtimeSha256({
      domain: "attention-private-replay-artifact-v2",
      artifact: replayArtifact
    });
    const current = activeRunFromResult({
      result,
      runId,
      analysisId,
      sessionId,
      replayArtifactSha256
    });
    const previous = attentionMonitorRunSchema.parse({
      ...current,
      contract: "attention-monitor-run-v0.4",
      orchestratorVersion: "attention-live-orchestrator-v0.4",
      resultContract: "cross-source-active-attention-result-v0.4",
      policyVersion: "aggressive-evidence-bound-attention-policy-v0.3",
      candidateRuleVersion:
        "github-managed-codex-active-candidate-rule-v0.1",
      rankingPolicyVersion: "active-attention-ranking-policy-v0.2",
      resolverVersion: "active-attention-decision-resolver-v0.3"
    });
    await mkdir(attentionReplayInputDirectory(cwd), {
      recursive: true
    });
    await mkdir(attentionMonitorDirectory(cwd), { recursive: true });
    await writeFile(
      join(attentionReplayInputDirectory(cwd), `${runId}.json`),
      `${JSON.stringify(replayArtifact)}\n`,
      "utf8"
    );
    await writeFile(
      join(attentionMonitorDirectory(cwd), "monitor.json"),
      `${JSON.stringify({
        contract: "attention-monitor-store-v0.1",
        updatedAt: AS_OF,
        runs: [previous],
        feedback: [],
        failures: []
      })}\n`,
      "utf8"
    );

    const parsed = await readAttentionMonitorStore(
      cwd,
      new Date("2026-08-02T12:01:00.000Z")
    );
    expect(parsed.runs[0]).toMatchObject({
      contract: "attention-monitor-run-v0.4",
      orchestratorVersion: "attention-live-orchestrator-v0.4",
      resultContract: "cross-source-active-attention-result-v0.4"
    });
  });

  it("reads and raw-preserves the previous v0.2 failure contract", async () => {
    const cwd = await temporaryDirectory();
    const monitorDirectory = attentionMonitorDirectory(cwd);
    const previousFailure = {
      contract: "attention-monitor-failure-v0.2",
      runId: `run_${"1".repeat(32)}`,
      analysisId: `analysis_${"2".repeat(32)}`,
      sessionId: `session_${"3".repeat(32)}`,
      status: "failed",
      startedAt: AS_OF,
      completedAt: AS_OF,
      stage: "source_sync",
      errorCode: "SOURCE_SYNC_FAILED",
      retryCount: 0,
      latencyMs: 0,
      engineVersion: "attention-live-orchestrator-v0.2",
      freshnessPolicyVersion: "attention-live-freshness-policy-v0.1",
      inputSchemaVersion: "cross-source-attention-input-v0.3",
      resultSchemaVersion: "cross-source-attention-result-v0.3",
      policyVersion: "aggressive-evidence-bound-attention-policy-v0.2",
      githubCandidateRuleVersion:
        "github-project-aware-candidate-rule-v0.2",
      codexOverviewRuleVersion:
        "codex-historical-context-overview-rule-v0.3",
      codeCommitSha: "a".repeat(40),
      codeState: "declared_commit",
      codeFingerprintSha256: null,
      privacyClass: "private_local_metadata",
      retentionDays: 30
    } as const;
    await mkdir(monitorDirectory, { recursive: true });
    await writeFile(
      join(monitorDirectory, "monitor.json"),
      `${JSON.stringify({
        contract: "attention-monitor-store-v0.1",
        updatedAt: AS_OF,
        runs: [],
        feedback: [],
        failures: [previousFailure]
      })}\n`,
      "utf8"
    );

    const parsed = await readAttentionMonitorStore(
      cwd,
      new Date("2026-08-02T12:01:00.000Z")
    );
    expect(parsed.failures[0]).toEqual(previousFailure);

    const currentFailure = createAttentionFailureRecord({
      executionIds: {
        runId: `run_${"4".repeat(32)}`,
        analysisId: `analysis_${"5".repeat(32)}`,
        sessionId: `session_${"6".repeat(32)}`
      },
      startedAt: new Date("2026-08-02T12:02:00.000Z"),
      completedAt: new Date("2026-08-02T12:02:00.000Z"),
      stage: "attention_resolution",
      codeProvenance: {
        codeCommitSha: null,
        codeState: "unavailable",
        codeFingerprintSha256: null
      }
    });
    await recordAttentionFailure(
      currentFailure,
      cwd,
      new Date(currentFailure.completedAt)
    );
    const persisted = JSON.parse(
      await readFile(join(monitorDirectory, "monitor.json"), "utf8")
    ) as { failures: Array<Record<string, unknown>> };
    expect(
      persisted.failures.find(
        (failure) => failure.runId === previousFailure.runId
      )
    ).toEqual(previousFailure);
    expect(currentFailure.contract).toBe(
      "attention-monitor-failure-v0.4"
    );
  });
});

function activeRunFromResult(input: {
  result: ReturnType<typeof resolveActiveAttention>;
  runId: string;
  analysisId: string;
  sessionId: string;
  replayArtifactSha256: string;
}) {
  const { result } = input;
  return attentionMonitorRunSchema.parse({
    contract: "attention-monitor-run-v0.5",
    runId: input.runId,
    analysisId: input.analysisId,
    sessionId: input.sessionId,
    resultId: result.resultId,
    status: "completed",
    asOf: result.asOf,
    startedAt: AS_OF,
    completedAt: AS_OF,
    codeCommitSha: null,
    codeState: "unavailable",
    codeFingerprintSha256: null,
    inputSha256: result.inputSha256,
    resultSha256: result.resultSha256,
    replayArtifactState: "available",
    replayArtifactSha256: input.replayArtifactSha256,
    orchestratorVersion: "attention-live-orchestrator-v0.5",
    freshnessPolicyVersion:
      "attention-live-freshness-policy-v0.1",
    freshnessPolicy: {
      githubMaxAgeMs: 30 * 60 * 1_000,
      codexMaxAgeMs: 5 * 60 * 1_000,
      maxFutureClockSkewMs: 60 * 1_000
    },
    resultContract: result.contract,
    policyVersion: result.policyVersion,
    candidateRuleVersion: result.candidateRuleVersion,
    lanePolicyVersion: result.lanePolicyVersion,
    rankingPolicyVersion: result.rankingPolicyVersion,
    resolverVersion: result.resolverVersion,
    idPolicyVersion: result.idPolicyVersion,
    decisionStatus: result.decision.status,
    certainty: result.decision.certainty,
    topCandidateId:
      result.decision.topSuggestion?.candidateId ?? null,
    alternativeCount: result.decision.alternatives.length,
    candidateCounts: result.counts,
    candidateAssessmentDetailState: "available",
    candidateAssessments: result.assessments.map((assessment) => ({
      assessmentId: assessment.assessmentId,
      candidateId: assessment.candidateId,
      triggerSource: assessment.triggerSource,
      triggerKind: assessment.triggerKind,
      status: assessment.status,
      reviewRoute: assessment.reviewRoute,
      reasonCodes: assessment.reasonCodes
    })),
    codexExecutionCount: 0,
    coverageDisposition: result.coverage.negativeCandidateCoverageComplete
      ? "scoped_complete"
      : result.decision.status === "suggested"
        ? "limited_but_sufficient"
        : "insufficient",
    decisionReasonCodes: result.decision.reasonCodes,
    caveatCodes: result.decision.caveatCodes,
    sources: [
      unavailableSourceMonitor("github"),
      unavailableSourceMonitor("codex")
    ],
    latencyMs: 0,
    errors: []
  });
}

function activeRunFixture() {
  return {
    contract: "attention-monitor-run-v0.5" as const,
    runId: `run_${"4".repeat(32)}`,
    analysisId: `analysis_${"5".repeat(32)}`,
    sessionId: `session_${"6".repeat(32)}`,
    resultId: `attention_result_${"7".repeat(32)}`,
    status: "completed" as const,
    asOf: AS_OF,
    startedAt: AS_OF,
    completedAt: AS_OF,
    codeCommitSha: null,
    codeState: "unavailable" as const,
    codeFingerprintSha256: null,
    inputSha256: "8".repeat(64),
    resultSha256: "9".repeat(64),
    replayArtifactState: "available" as const,
    replayArtifactSha256: "a".repeat(64),
    orchestratorVersion: "attention-live-orchestrator-v0.5" as const,
    freshnessPolicyVersion:
      "attention-live-freshness-policy-v0.1" as const,
    freshnessPolicy: {
      githubMaxAgeMs: 30 * 60 * 1_000,
      codexMaxAgeMs: 5 * 60 * 1_000,
      maxFutureClockSkewMs: 60 * 1_000
    },
    resultContract: "cross-source-active-attention-result-v0.5",
    policyVersion: "aggressive-evidence-bound-attention-policy-v0.4",
    candidateRuleVersion:
      "github-managed-codex-active-candidate-rule-v0.2",
    lanePolicyVersion: "active-attention-lane-policy-v0.1",
    rankingPolicyVersion: "active-attention-ranking-policy-v0.3",
    resolverVersion: "active-attention-decision-resolver-v0.4",
    idPolicyVersion: "active-attention-id-v0.1",
    decisionStatus: "needs_clarification" as const,
    certainty: null,
    topCandidateId: null,
    alternativeCount: 0,
    candidateCounts: {
      eligible: 0,
      reviewRequired: 1,
      ineligible: 0
    },
    candidateAssessmentDetailState: "available" as const,
    candidateAssessments: [
      {
        assessmentId: `attention_assessment_${"b".repeat(32)}`,
        candidateId: null,
        triggerSource: "github" as const,
        triggerKind: "github_work_item" as const,
        status: "review_required" as const,
        reviewRoute: "user_review" as const,
        reasonCodes: [
          "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" as const
        ]
      }
    ],
    codexExecutionCount: 0,
    coverageDisposition: "insufficient" as const,
    decisionReasonCodes: ["DECISION_USER_CLARIFICATION_REQUIRED"],
    caveatCodes: [],
    sources: [
      unavailableSourceMonitor("github"),
      unavailableSourceMonitor("codex")
    ],
    latencyMs: 0,
    errors: []
  };
}

function unavailableSourceMonitor(source: "github" | "codex") {
  return {
    source,
    inputState: "disconnected" as const,
    unavailableReason: "CONNECTOR_DISCONNECTED" as const,
    freshness: null,
    completeness: null,
    snapshotFetchedAt: null,
    sourceSnapshotSha256: null,
    batchSha256: null,
    normalizerVersion: null,
    candidateSetComplete: false,
    signalCount: 0,
    skippedRecordCount: 0,
    issueCodes: []
  };
}

function previousRunFixture() {
  const input = phase2AttentionInput({
    asOf: AS_OF,
    github: phase2UnavailableSource("CONNECTOR_DISCONNECTED"),
    codex: phase2UnavailableSource("CONNECTOR_DISCONNECTED")
  });
  const result = runPhase2AttentionRouter(input);
  const runId = `run_${"1".repeat(32)}`;
  const analysisId = `analysis_${"2".repeat(32)}`;
  const sessionId = `session_${"3".repeat(32)}`;
  const replayArtifact = {
    contract: "attention-replay-input-v1" as const,
    runId,
    analysisId,
    sessionId,
    capturedAt: AS_OF,
    inputSha256: result.inputSha256,
    privacyClass: "private_local_engine_input" as const,
    retentionDays: 30 as const,
    input
  };
  const replayArtifactSha256 = runtimeSha256({
    domain: "attention-private-replay-artifact-v1",
    artifact: replayArtifact
  });
  const rawRun = {
    contract: "attention-monitor-run-v0.3" as const,
    runId,
    analysisId,
    sessionId,
    resultId: result.resultId,
    status: "completed" as const,
    asOf: AS_OF,
    startedAt: AS_OF,
    completedAt: AS_OF,
    codeCommitSha: null,
    codeState: "unavailable" as const,
    codeFingerprintSha256: null,
    inputSha256: result.inputSha256,
    resultSha256: result.resultSha256,
    replayArtifactState: "available" as const,
    replayArtifactSha256,
    orchestratorVersion: "attention-live-orchestrator-v0.2" as const,
    freshnessPolicyVersion:
      "attention-live-freshness-policy-v0.1" as const,
    freshnessPolicy: {
      githubMaxAgeMs: 30 * 60 * 1_000,
      codexMaxAgeMs: 5 * 60 * 1_000,
      maxFutureClockSkewMs: 60 * 1_000
    },
    resultContract: result.contract,
    policyVersion: result.policyVersion,
    githubCandidateRuleVersion: result.githubCandidateRuleVersion,
    codexOverviewRuleVersion: result.codexOverviewRuleVersion,
    decisionStatus: result.decision.status,
    certainty: result.decision.certainty,
    topCandidateId: null,
    alternativeCount: 0,
    candidateCounts: {
      eligible: 0,
      provisional: 0,
      ineligible: 0
    },
    codexExecutionCount: 0,
    coverageDisposition: result.coverage.disposition,
    decisionReasonCodes: result.decision.reasonCodes,
    caveatCodes: result.decision.caveatCodes,
    sources: [
      unavailableSourceMonitor("github"),
      unavailableSourceMonitor("codex")
    ],
    latencyMs: 0,
    errors: [
      { source: "github" as const, code: "CONNECTOR_DISCONNECTED" },
      { source: "codex" as const, code: "CONNECTOR_DISCONNECTED" }
    ]
  };
  return { rawRun, replayArtifact };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-attention-v04-compat-")
  );
  temporaryDirectories.push(directory);
  return directory;
}
