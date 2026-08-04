import { describe, expect, it } from "vitest";

import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import {
  buildDeveloperWorkLedger,
  createDeveloperWorkEntityId,
  createDeveloperWorkEvidenceId,
  developerWorkLedgerSchema,
  verifyDeveloperWorkLedger,
  type DeveloperWorkEvidence,
  type DeveloperWorkLedgerDraft
} from "../src/developerSignals/workLedger";

const AS_OF = "2026-08-05T01:00:00.000Z";
const RUN_ID = `run_${"1".repeat(32)}`;
const ANALYSIS_ID = `analysis_${"2".repeat(32)}`;
const RESULT_ID = `attention_result_${"3".repeat(32)}`;

describe("developer work ledger v0.1", () => {
  it("seals a canonical, reproducible ledger with every developer-work entity", () => {
    const draft = ledgerDraft();
    const forward = buildDeveloperWorkLedger(draft);
    const reversed = buildDeveloperWorkLedger({
      ...draft,
      pipelineVersions: {
        ...draft.pipelineVersions,
        collected: [...draft.pipelineVersions.collected].reverse()
      },
      sourceSnapshots: [...draft.sourceSnapshots].reverse(),
      evidence: [...draft.evidence].reverse(),
      projects: [...draft.projects].reverse(),
      workItems: [...draft.workItems].reverse(),
      executions: [...draft.executions].reverse(),
      openLoops: [...draft.openLoops].reverse(),
      blockers: [...draft.blockers].reverse(),
      nextActions: [...draft.nextActions].reverse()
    });

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      contract: "developer-work-ledger-v0.1",
      schemaVersion: "developer-work-ledger-schema-v0.1",
      runId: RUN_ID,
      analysisId: ANALYSIS_ID,
      resultId: RESULT_ID,
      privacyClass: "private_local_metadata"
    });
    expect(forward.projects).toHaveLength(1);
    expect(forward.workItems).toHaveLength(1);
    expect(forward.executions).toHaveLength(1);
    expect(forward.openLoops).toHaveLength(1);
    expect(forward.blockers).toHaveLength(1);
    expect(forward.nextActions).toHaveLength(1);
    expect(developerWorkLedgerSchema.parse(forward)).toEqual(forward);
    expect(verifyDeveloperWorkLedger(forward)).toBe(true);
  });

  it("rejects hash tampering and dangling entity provenance", () => {
    const ledger = buildDeveloperWorkLedger(ledgerDraft());

    expect(
      developerWorkLedgerSchema.safeParse({
        ...ledger,
        ledgerSha256: "0".repeat(64)
      }).success
    ).toBe(false);

    const unknownEvidence = `ledger_evidence_${"f".repeat(32)}`;
    expect(() =>
      buildDeveloperWorkLedger({
        ...ledgerDraft(),
        nextActions: ledgerDraft().nextActions.map((action) => ({
          ...action,
          evidenceIds: [unknownEvidence]
        }))
      })
    ).toThrow();
  });

  it("binds an evidence ID to privacy-minimized provenance", () => {
    const evidence = ledgerDraft().evidence[0]!;
    const changedValue = "9".repeat(64);
    const changedId = createDeveloperWorkEvidenceId({
      source: evidence.source,
      sourceRecordSha256: evidence.sourceRecordSha256,
      sourceSnapshotSha256: evidence.sourceSnapshotSha256,
      valueSha256: changedValue,
      observedAt: evidence.observedAt,
      role: evidence.role
    });

    expect(changedId).not.toBe(evidence.evidenceId);
    expect(
      developerWorkLedgerSchema.safeParse({
        ...buildDeveloperWorkLedger(ledgerDraft()),
        evidence: [
          {
            ...evidence,
            valueSha256: changedValue
          }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps GitHub verification and review blockers as first-class semantics", () => {
    const draft = ledgerDraft();
    for (const kind of [
      "ci_failure",
      "changes_requested",
      "merge_conflict"
    ] as const) {
      expect(
        buildDeveloperWorkLedger({
          ...draft,
          blockers: draft.blockers.map((blocker) => ({ ...blocker, kind }))
        }).blockers[0]?.kind
      ).toBe(kind);
    }
    for (const kind of ["verification_needed", "code_review"] as const) {
      expect(
        buildDeveloperWorkLedger({
          ...draft,
          openLoops: draft.openLoops.map((loop) => ({ ...loop, kind }))
        }).openLoops[0]?.kind
      ).toBe(kind);
    }
  });
});

function ledgerDraft(): DeveloperWorkLedgerDraft {
  const githubSnapshot = runtimeSha256("synthetic-github-snapshot");
  const codexSnapshot = runtimeSha256("synthetic-codex-snapshot");
  const projectEvidence = evidence({
    source: "github",
    sourceSnapshotSha256: githubSnapshot,
    sourceRecordSha256: runtimeSha256("synthetic-project-record"),
    valueSha256: runtimeSha256("synthetic-project-value"),
    role: "identity",
    reasonCodes: ["PROJECT_SCOPE_CONFIRMED"]
  });
  const stateEvidence = evidence({
    source: "github",
    sourceSnapshotSha256: githubSnapshot,
    sourceRecordSha256: runtimeSha256("synthetic-work-item-record"),
    valueSha256: runtimeSha256("synthetic-open-state"),
    role: "state",
    reasonCodes: ["WORK_ITEM_OPEN_CONFIRMED"]
  });
  const executionEvidence = evidence({
    source: "codex",
    sourceSnapshotSha256: codexSnapshot,
    sourceRecordSha256: runtimeSha256("synthetic-execution-record"),
    valueSha256: runtimeSha256("synthetic-failed-state"),
    role: "execution",
    reasonCodes: ["EXECUTION_FAILURE_CONFIRMED"]
  });
  const projectId = createDeveloperWorkEntityId("project", {
    sourceScopeSha256: runtimeSha256("synthetic-project-scope")
  });
  const workItemId = createDeveloperWorkEntityId("work_item", {
    source: "github",
    sourceObjectSha256: runtimeSha256("synthetic-issue-42")
  });
  const executionId = createDeveloperWorkEntityId("execution", {
    source: "codex",
    sourceExecutionSha256: runtimeSha256("synthetic-execution")
  });
  const openLoopId = createDeveloperWorkEntityId("open_loop", {
    workItemId,
    executionId,
    kind: "execution_failure"
  });
  const blockerId = createDeveloperWorkEntityId("blocker", {
    openLoopId,
    kind: "execution_failure"
  });
  const nextActionId = createDeveloperWorkEntityId("next_action", {
    workItemId,
    executionId,
    kind: "focus_or_resume"
  });

  return {
    runId: RUN_ID,
    analysisId: ANALYSIS_ID,
    resultId: RESULT_ID,
    asOf: AS_OF,
    inputSha256: runtimeSha256("synthetic-active-attention-input"),
    privacyClass: "private_local_metadata",
    retentionDays: 30,
    codeProvenance: {
      codeState: "dirty_worktree",
      codeCommitSha: null,
      codeFingerprintSha256: runtimeSha256("synthetic-code-fingerprint")
    },
    pipelineVersions: {
      collected: ["source-sync-v0.1", "snapshot-contract-v0.1"],
      normalized: ["runtime-work-signal-normalizer-v0.1"],
      interpreted: ["current-work-evidence-v0.1"],
      verified: ["claim-authority-v0.1"],
      eligibility: ["active-attention-candidate-rule-v0.1"],
      selection: ["active-attention-ranking-v0.1"]
    },
    sourceSnapshots: [
      {
        source: "github",
        state: "collected",
        snapshotSha256: githubSnapshot,
        collectedAt: "2026-08-05T00:55:00.000Z",
        collectionVersion: "github-collector-v0.1",
        reasonCodes: ["SOURCE_COLLECTED"]
      },
      {
        source: "codex",
        state: "collected",
        snapshotSha256: codexSnapshot,
        collectedAt: "2026-08-05T00:56:00.000Z",
        collectionVersion: "codex-collector-v0.1",
        reasonCodes: ["SOURCE_COLLECTED"]
      }
    ],
    evidence: [projectEvidence, stateEvidence, executionEvidence],
    projects: [
      {
        projectId,
        label: "Synthetic developer project",
        state: "active",
        sourceScopeRefs: [
          {
            source: "github",
            sourceScopeSha256: runtimeSha256("synthetic-project-scope")
          }
        ],
        evidenceIds: [projectEvidence.evidenceId],
        reasonCodes: ["PROJECT_ACTIVE"]
      }
    ],
    workItems: [
      {
        workItemId,
        projectId,
        source: "github",
        sourceObjectSha256: runtimeSha256("synthetic-issue-42"),
        kind: "issue",
        title: "Synthetic issue",
        state: "open",
        dueAt: null,
        evidenceIds: [stateEvidence.evidenceId],
        reasonCodes: ["WORK_ITEM_OPEN"]
      }
    ],
    executions: [
      {
        executionId,
        projectId,
        workItemId,
        source: "codex",
        sourceExecutionSha256: runtimeSha256("synthetic-execution"),
        state: "failed",
        startedAt: "2026-08-05T00:40:00.000Z",
        updatedAt: "2026-08-05T00:50:00.000Z",
        completedAt: "2026-08-05T00:50:00.000Z",
        evidenceIds: [executionEvidence.evidenceId],
        reasonCodes: ["EXECUTION_FAILED"]
      }
    ],
    openLoops: [
      {
        openLoopId,
        projectId,
        workItemId,
        executionId,
        kind: "execution_failure",
        state: "open",
        openedAt: "2026-08-05T00:50:00.000Z",
        dueAt: null,
        evidenceIds: [executionEvidence.evidenceId],
        reasonCodes: ["FAILED_EXECUTION_OPEN_LOOP"]
      }
    ],
    blockers: [
      {
        blockerId,
        projectId,
        workItemId,
        executionId,
        openLoopId,
        kind: "execution_failure",
        state: "active",
        severity: "critical",
        evidenceIds: [executionEvidence.evidenceId],
        reasonCodes: ["CURRENT_EXECUTION_FAILURE"]
      }
    ],
    nextActions: [
      {
        nextActionId,
        projectId,
        workItemId,
        executionId,
        openLoopId,
        blockerIds: [blockerId],
        kind: "focus_or_resume",
        title: "Resume the failed synthetic execution",
        firstStep: "Open the verified Codex execution.",
        state: "selected",
        dueAt: null,
        evidenceIds: [executionEvidence.evidenceId],
        reasonCodes: ["SELECTED_CURRENT_EXECUTION_FAILURE"]
      }
    ]
  };
}

function evidence(input: {
  source: DeveloperWorkEvidence["source"];
  sourceSnapshotSha256: string;
  sourceRecordSha256: string;
  valueSha256: string;
  role: DeveloperWorkEvidence["role"];
  reasonCodes: string[];
}): DeveloperWorkEvidence {
  const base = {
    ...input,
    signalId: null,
    claimId: null,
    relationId: null,
    observedAt: "2026-08-05T00:55:00.000Z",
    sourceUpdatedAt: "2026-08-05T00:54:00.000Z",
    directness: "explicit" as const,
    freshness: "current" as const,
    completeness: "complete" as const,
    verification: "verified" as const
  };
  return {
    evidenceId: createDeveloperWorkEvidenceId(base),
    ...base
  };
}
