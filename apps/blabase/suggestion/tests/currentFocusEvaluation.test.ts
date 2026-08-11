import { describe, expect, it } from "vitest";

import {
  currentFocusEvaluationRunRecordSchema,
  runCurrentFocusEvaluation
} from "../src/evaluation/currentFocusEvaluation";

const STARTED_AT = new Date("2026-08-06T10:00:00.000Z");
const CODE = {
  commitSha: null,
  state: "dirty_worktree" as const,
  fingerprintSha256: "a".repeat(64)
};

describe("Current Focus synthetic baseline", () => {
  it("passes all 13 required cases with zero safety or privacy leakage", () => {
    const record = runCurrentFocusEvaluation({
      startedAt: STARTED_AT,
      completedAt: STARTED_AT,
      code: CODE
    });

    expect(currentFocusEvaluationRunRecordSchema.parse(record)).toEqual(record);
    expect(record).toMatchObject({
      status: "passed",
      counts: {
        total: 13,
        passed: 13,
        failed: 0,
        actualSelectionChanges: 0
      },
      metrics: {
        currentFocusPrecision: 1,
        abstentionAccuracy: 1,
        topSwitchPrecision: 1,
        contextOnlyLeakageCount: 0,
        eligibilityDiffCount: 0,
        staleCurrentnessViolationCount: 0,
        deterministicHashFailureCount: 0,
        privacySentinelLeakageCount: 0,
        dependencyTamperAcceptedCount: 0
      },
      comparison: {
        activeAttentionCandidateUniverseChanged: false,
        activeAttentionEligibilityChanged: false,
        activeAttentionSelectionChanged: false,
        attentionSelectionEffect: "none"
      }
    });
  });

  it("reconstructs Codex, verified push, and current CI failure as one exact WorkStream", () => {
    const record = evaluation();
    const result = caseById(record, "FOCUS-DEV-001");

    expect(result).toMatchObject({
      status: "passed",
      focusStatus: "selected",
      workstreamCount: 1,
      latestEventKind: "github_ci_failed",
      activeBlocker: "ci_failed",
      relatedSources: ["codex_managed", "github"],
      wouldSwitch: false,
      activeResultUnchanged: true,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0
    });
    expect(result.historicalEventKinds).toContain("github_push");
  });

  it("keeps an older push as history after merge without resurrecting a candidate", () => {
    const record = evaluation();
    const result = caseById(record, "FOCUS-DEV-002");

    expect(result).toMatchObject({
      status: "passed",
      focusStatus: "selected",
      workstreamCount: 1,
      latestEventKind: "github_pull_request_merged",
      completionState: "completed",
      activeBlocker: "none",
      existingTopCandidateId: null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false
    });
    expect(result.historicalEventKinds).toContain("github_push");
  });

  it("is deterministic across replays and rejects dependency tampering", () => {
    const first = evaluation();
    const second = evaluation();

    expect(second.cases).toEqual(first.cases);
    expect(caseById(first, "FOCUS-DEV-012")).toMatchObject({
      status: "passed",
      focusStatus: "rejected",
      deterministic: true,
      dependencyTamperAcceptedCount: 0,
      reasonCodes: ["DEPENDENCY_TAMPER_REJECTED"]
    });
    expect(caseById(first, "FOCUS-DEV-013")).toMatchObject({
      status: "passed",
      privacySentinelLeakageCount: 0
    });
  });
});

function evaluation() {
  return runCurrentFocusEvaluation({
    startedAt: STARTED_AT,
    completedAt: STARTED_AT,
    code: CODE
  });
}

function caseById(
  record: ReturnType<typeof evaluation>,
  caseId: string
) {
  const result = record.cases.find((item) => item.caseId === caseId);
  if (!result) throw new TypeError(`Missing evaluation case ${caseId}.`);
  return result;
}
