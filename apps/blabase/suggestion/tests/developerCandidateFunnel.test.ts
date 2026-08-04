import { describe, expect, it } from "vitest";

import {
  runtimeSha256,
  runtimeStableId
} from "../src/crossSource/canonicalHash";
import {
  buildDeveloperCandidateFunnel,
  candidateFunnelReferencesLedger,
  developerCandidateFunnelProjectionSchema,
  verifyDeveloperCandidateFunnel,
  type DeveloperCandidateFunnelDraft,
  type DeveloperCandidateTrace
} from "../src/developerSignals/candidateFunnel";
import {
  buildDeveloperWorkLedger,
  createDeveloperWorkEntityId,
  createDeveloperWorkEvidenceId,
  type DeveloperWorkLedger
} from "../src/developerSignals/workLedger";

const AS_OF = "2026-08-05T01:00:00.000Z";
const RUN_ID = `run_${"1".repeat(32)}`;
const ANALYSIS_ID = `analysis_${"2".repeat(32)}`;
const RESULT_ID = `attention_result_${"3".repeat(32)}`;

describe("developer candidate funnel v0.1", () => {
  it("preserves stage counts and reasons from collection through selection", () => {
    const ledger = ledgerFixture();
    const funnel = buildDeveloperCandidateFunnel(funnelDraft(ledger));
    const summary = Object.fromEntries(
      funnel.stageSummaries.map((stage) => [stage.stage, stage])
    );

    expect(summary.collected?.outcomeCounts.collected).toBe(3);
    expect(summary.normalized?.outcomeCounts).toMatchObject({
      normalized: 2,
      rejected: 1,
      notReached: 0
    });
    expect(summary.interpreted?.outcomeCounts).toMatchObject({
      interpreted: 2,
      notReached: 1
    });
    expect(summary.verified?.outcomeCounts).toMatchObject({
      verified: 2,
      notReached: 1
    });
    expect(summary.eligibility?.outcomeCounts).toMatchObject({
      eligible: 1,
      reviewRequired: 1,
      notReached: 1
    });
    expect(summary.selected?.outcomeCounts).toMatchObject({
      selected: 1,
      notReached: 2
    });
    expect(summary.normalized?.reasonCounts).toEqual([
      { reasonCode: "NORMALIZATION_REJECTED", count: 1 },
      { reasonCode: "NORMALIZED_WORK_SIGNAL", count: 2 }
    ]);
    expect(funnel.selectedCandidateSeedId).toBe(
      funnel.traces[0]?.candidateSeedId
    );
    expect(funnel.selectedCandidateId).toBe(
      funnel.traces[0]?.candidateId
    );
    expect(funnel.selectedNextActionId).toBe(
      ledger.nextActions[0]?.nextActionId
    );
    expect(candidateFunnelReferencesLedger(funnel, ledger)).toBe(true);
    expect(
      developerCandidateFunnelProjectionSchema.parse(funnel)
    ).toEqual(funnel);
  });

  it("is deterministic for unordered trace and reason input", () => {
    const ledger = ledgerFixture();
    const draft = funnelDraft(ledger);
    const forward = buildDeveloperCandidateFunnel(draft);
    const reversed = buildDeveloperCandidateFunnel({
      ...draft,
      normalizationVersions: [...draft.normalizationVersions].reverse(),
      traces: [...draft.traces]
        .reverse()
        .map((trace) => ({
          ...trace,
          stages: {
            ...trace.stages,
            eligibility: {
              ...trace.stages.eligibility,
              reasonCodes: [
                ...trace.stages.eligibility.reasonCodes
              ].reverse()
            }
          }
        }))
    });

    expect(reversed).toEqual(forward);
    expect(verifyDeveloperCandidateFunnel(forward)).toBe(true);
  });

  it("rejects an impossible stage transition and projection tampering", () => {
    const ledger = ledgerFixture();
    const draft = funnelDraft(ledger);
    const impossible: DeveloperCandidateTrace = {
      ...draft.traces[0]!,
      stages: {
        ...draft.traces[0]!.stages,
        normalized: {
          stage: "normalized",
          outcome: "rejected",
          reasonCodes: ["NORMALIZATION_REJECTED"],
          evidenceIds: [ledger.evidence[0]!.evidenceId]
        }
      }
    };

    expect(() =>
      buildDeveloperCandidateFunnel({
        ...draft,
        traces: [impossible]
      })
    ).toThrow();

    const funnel = buildDeveloperCandidateFunnel(draft);
    expect(
      developerCandidateFunnelProjectionSchema.safeParse({
        ...funnel,
        projectionSha256: "0".repeat(64)
      }).success
    ).toBe(false);
  });

  it("detects a valid funnel that points at another ledger action", () => {
    const ledger = ledgerFixture();
    const draft = funnelDraft(ledger);
    const otherActionId = createDeveloperWorkEntityId("next_action", {
      synthetic: "other-action"
    });
    const mismatched = buildDeveloperCandidateFunnel({
      ...draft,
      traces: draft.traces.map((trace, index) =>
        index === 0 ? { ...trace, nextActionId: otherActionId } : trace
      )
    });

    expect(verifyDeveloperCandidateFunnel(mismatched)).toBe(true);
    expect(candidateFunnelReferencesLedger(mismatched, ledger)).toBe(false);
  });
});

function funnelDraft(
  ledger: DeveloperWorkLedger
): DeveloperCandidateFunnelDraft {
  const evidenceId = ledger.evidence[0]!.evidenceId;
  const selectedNextActionId = ledger.nextActions[0]!.nextActionId;
  const selected = completeTrace({
    seed: "a",
    evidenceId,
    outcome: "eligible",
    selected: true,
    nextActionId: selectedNextActionId
  });
  const review = completeTrace({
    seed: "b",
    evidenceId,
    outcome: "review_required",
    selected: false,
    nextActionId: null
  });
  const rejected = normalizedRejectedTrace("c", evidenceId);

  return {
    runId: ledger.runId,
    analysisId: ledger.analysisId,
    resultId: ledger.resultId,
    ledgerId: ledger.ledgerId,
    ledgerSha256: ledger.ledgerSha256,
    asOf: ledger.asOf,
    inputSha256: ledger.inputSha256,
    candidateRuleVersion: "active-candidate-rule-v0.1",
    normalizationVersions: [
      "github-normalizer-v0.1",
      "codex-normalizer-v0.1"
    ],
    interpretationVersions: ["current-work-evidence-v0.1"],
    verifierVersions: ["claim-authority-v0.1"],
    eligibilityPolicyVersion: "active-eligibility-v0.1",
    selectionPolicyVersion: "active-ranking-v0.1",
    traces: [selected, review, rejected]
  };
}

function completeTrace(input: {
  seed: string;
  evidenceId: string;
  outcome: "eligible" | "review_required" | "ineligible";
  selected: boolean;
  nextActionId: string | null;
}): DeveloperCandidateTrace {
  const eligible = input.outcome === "eligible";
  return {
    candidateSeedId: runtimeStableId("seed", "synthetic-funnel-v0.1", {
      seed: input.seed
    }),
    candidateId: eligible
      ? runtimeStableId("attention", "synthetic-funnel-v0.1", {
          seed: input.seed
        })
      : null,
    source: "github",
    sourceRecordSha256: runtimeSha256(`synthetic-record-${input.seed}`),
    nextActionId: input.nextActionId,
    stages: {
      collected: {
        stage: "collected",
        outcome: "collected",
        reasonCodes: ["SOURCE_RECORD_COLLECTED"],
        evidenceIds: [input.evidenceId]
      },
      normalized: {
        stage: "normalized",
        outcome: "normalized",
        reasonCodes: ["NORMALIZED_WORK_SIGNAL"],
        evidenceIds: [input.evidenceId]
      },
      interpreted: {
        stage: "interpreted",
        outcome: "interpreted",
        reasonCodes: ["WORK_INTENT_INTERPRETED"],
        evidenceIds: [input.evidenceId]
      },
      verified: {
        stage: "verified",
        outcome: "verified",
        reasonCodes: ["MATERIAL_EVIDENCE_VERIFIED"],
        evidenceIds: [input.evidenceId]
      },
      eligibility: {
        stage: "eligibility",
        outcome: input.outcome,
        reasonCodes:
          input.outcome === "eligible"
            ? ["ELIGIBLE_DIRECT_WORK"]
            : input.outcome === "review_required"
              ? ["REVIEW_SOURCE_CONFLICT"]
              : ["INELIGIBLE_NOT_CURRENT"],
        evidenceIds: [input.evidenceId]
      },
      selected: eligible
        ? {
            stage: "selected",
            outcome: input.selected ? "selected" : "not_selected",
            reasonCodes: [
              input.selected ? "SELECTED_TOP_RANKED" : "NOT_SELECTED_LOWER_RANK"
            ],
            evidenceIds: [input.evidenceId]
          }
        : {
            stage: "selected",
            outcome: "not_reached",
            reasonCodes: ["NOT_REACHED_NOT_ELIGIBLE"],
            evidenceIds: []
          }
    }
  };
}

function normalizedRejectedTrace(
  seed: string,
  evidenceId: string
): DeveloperCandidateTrace {
  const notReached = <
    T extends "interpreted" | "verified" | "eligibility" | "selected"
  >(stage: T) => ({
    stage,
    outcome: "not_reached" as const,
    reasonCodes: ["NOT_REACHED_NORMALIZATION_REJECTED"],
    evidenceIds: []
  });
  return {
    candidateSeedId: runtimeStableId("seed", "synthetic-funnel-v0.1", {
      seed
    }),
    candidateId: null,
    source: "github",
    sourceRecordSha256: runtimeSha256(`synthetic-record-${seed}`),
    nextActionId: null,
    stages: {
      collected: {
        stage: "collected",
        outcome: "collected",
        reasonCodes: ["SOURCE_RECORD_COLLECTED"],
        evidenceIds: [evidenceId]
      },
      normalized: {
        stage: "normalized",
        outcome: "rejected",
        reasonCodes: ["NORMALIZATION_REJECTED"],
        evidenceIds: [evidenceId]
      },
      interpreted: notReached("interpreted"),
      verified: notReached("verified"),
      eligibility: notReached("eligibility"),
      selected: notReached("selected")
    }
  };
}

function ledgerFixture(): DeveloperWorkLedger {
  const snapshotSha256 = runtimeSha256("synthetic-github-snapshot");
  const sourceRecordSha256 = runtimeSha256("synthetic-work-item-record");
  const valueSha256 = runtimeSha256("synthetic-open-state");
  const evidenceBase = {
    source: "github" as const,
    sourceRecordSha256,
    sourceSnapshotSha256: snapshotSha256,
    valueSha256,
    signalId: null,
    claimId: null,
    relationId: null,
    observedAt: "2026-08-05T00:55:00.000Z",
    sourceUpdatedAt: "2026-08-05T00:54:00.000Z",
    role: "state" as const,
    directness: "explicit" as const,
    freshness: "current" as const,
    completeness: "complete" as const,
    verification: "verified" as const,
    reasonCodes: ["WORK_ITEM_OPEN_CONFIRMED"]
  };
  const evidence = {
    evidenceId: createDeveloperWorkEvidenceId(evidenceBase),
    ...evidenceBase
  };
  const projectId = createDeveloperWorkEntityId("project", {
    synthetic: "project"
  });
  const nextActionId = createDeveloperWorkEntityId("next_action", {
    projectId,
    synthetic: "selected-action"
  });
  return buildDeveloperWorkLedger({
    runId: RUN_ID,
    analysisId: ANALYSIS_ID,
    resultId: RESULT_ID,
    asOf: AS_OF,
    inputSha256: runtimeSha256("synthetic-active-attention-input"),
    privacyClass: "private_local_metadata",
    retentionDays: 30,
    codeProvenance: {
      codeState: "unavailable",
      codeCommitSha: null,
      codeFingerprintSha256: null
    },
    pipelineVersions: {
      collected: ["source-sync-v0.1"],
      normalized: ["runtime-work-signal-normalizer-v0.1"],
      interpreted: ["current-work-evidence-v0.1"],
      verified: ["claim-authority-v0.1"],
      eligibility: ["active-eligibility-v0.1"],
      selection: ["active-ranking-v0.1"]
    },
    sourceSnapshots: [
      {
        source: "github",
        state: "collected",
        snapshotSha256,
        collectedAt: "2026-08-05T00:55:00.000Z",
        collectionVersion: "github-collector-v0.1",
        reasonCodes: ["SOURCE_COLLECTED"]
      }
    ],
    evidence: [evidence],
    projects: [
      {
        projectId,
        label: "Synthetic project",
        state: "active",
        sourceScopeRefs: [
          {
            source: "github",
            sourceScopeSha256: runtimeSha256("synthetic-scope")
          }
        ],
        evidenceIds: [evidence.evidenceId],
        reasonCodes: ["PROJECT_ACTIVE"]
      }
    ],
    workItems: [],
    executions: [],
    openLoops: [],
    blockers: [],
    nextActions: [
      {
        nextActionId,
        projectId,
        workItemId: null,
        executionId: null,
        openLoopId: null,
        blockerIds: [],
        kind: "open_source",
        title: "Open the synthetic source",
        firstStep: "Open the verified work item.",
        state: "selected",
        dueAt: null,
        evidenceIds: [evidence.evidenceId],
        reasonCodes: ["SELECTED_TOP_RANKED"]
      }
    ]
  });
}
