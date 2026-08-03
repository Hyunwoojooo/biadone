import { describe, expect, it } from "vitest";

import {
  activeAttentionResultSchema,
  resolveActiveAttention,
  sealActiveAttentionInput,
  verifyActiveAttentionResultIntegrity
} from "../src/attentionDecision";
import { sealAttentionEligibilityShadowProjection } from "../src/eligibility";
import { rankAllPhase2GitHubCandidates } from "../src/crossSource/runAttentionRouter";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_MANAGED_RUN_ID,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

describe("Phase 4B active Attention resolver", () => {
  it("returns a scoped no-action only for complete negative coverage", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "none",
        managedScenario: "none"
      }).input
    );

    expect(result.decision).toMatchObject({
      status: "no_action",
      certainty: "scoped",
      topSuggestion: null,
      clarification: null,
      reasonCodes: ["DECISION_SCOPED_NO_ACTION"]
    });
    expect(result.coverage).toMatchObject({
      githubCandidateCoverage: "complete",
      managedCodexCoverage: "complete",
      negativeCandidateCoverageComplete: true
    });
    expect(activeAttentionResultSchema.parse(result)).toEqual(result);
    expect(verifyActiveAttentionResultIntegrity(result)).toBe(true);
  });

  it("promotes a native due-soon GitHub item into must_now", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "assigned_issue",
        deadlineAt: "2026-08-02T04:00:00.000Z"
      }).input
    );

    expect(result.decision.topSuggestion).toMatchObject({
      triggerSource: "github",
      triggerKind: "github_work_item",
      lane: "must_now",
      intervention: "do",
      dueAt: "2026-08-02T04:00:00.000Z",
      attentionDisposition: "active_candidate",
      upstreamObjectsRemainForbidden: true
    });
  });

  it("preserves the complete Phase 2 GitHub order beyond its three-item display bound", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "none",
      additionalGitHubTasks: [
        { id: 502, kind: "review_requested_pull_request", number: 43 },
        { id: 503, kind: "assigned_issue", number: 44 },
        { id: 504, kind: "review_requested_pull_request", number: 45 },
        { id: 505, kind: "assigned_issue", number: 46 }
      ]
    });
    const expectedSubjects = rankAllPhase2GitHubCandidates(
      fixture.input.baseAttentionInput
    ).map((candidate) => candidate.subjectId);
    const result = resolveActiveAttention(fixture.input);

    expect(expectedSubjects).toHaveLength(5);
    expect(
      result.rankedCandidates.map(
        (candidate) => candidate.githubSubjectId
      )
    ).toEqual(expectedSubjects);
  });

  it("preserves the weekly-outcome reason for GitHub and its linked managed failure", () => {
    const github = resolveActiveAttention(
      activeAttentionFixture({
        primaryOutcome: "Ship synthetic linked task",
        managedScenario: "none"
      }).input
    );
    expect(github.decision.topSuggestion).toMatchObject({
      triggerKind: "github_work_item",
      whyNowReasonCodes: expect.arrayContaining([
        "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
      ])
    });
    expect(github.decision.topSuggestion?.explanation).toContain(
      "이번 주 결과"
    );

    const managed = resolveActiveAttention(
      activeAttentionFixture({
        primaryOutcome: "Ship synthetic linked task",
        managedScenario: "failed"
      }).input
    );
    expect(managed.decision.topSuggestion).toMatchObject({
      triggerKind: "managed_failure",
      whyNowReasonCodes: expect.arrayContaining([
        "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
      ])
    });
  });

  it("prefers an older linked managed failure that matches the weekly outcome over a newer non-match", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubTitle: "Weekly launch outcome",
        primaryOutcome: "Ship weekly launch outcome",
        managedScenario: "failed",
        managedFailureAt: "2026-08-02T02:58:00.000Z",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "assigned_issue",
            number: 43,
            title: "Unrelated maintenance"
          }
        ],
        secondManagedFailure: true
      }).input
    );

    expect(
      result.rankedCandidates.filter(
        (candidate) => candidate.triggerKind === "managed_failure"
      )
    ).toHaveLength(2);
    expect(result.decision.topSuggestion).toMatchObject({
      managedRunId: ACTIVE_FIXTURE_MANAGED_RUN_ID,
      title: "Weekly launch outcome",
      whyNowReasonCodes: expect.arrayContaining([
        "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
      ])
    });
  });

  it("suppresses an older terminal failure when a newer managed attempt owns the same work loop", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        newerSameTargetScenario: "running"
      }).input
    );

    expect(
      result.assessments.find(
        (assessment) =>
          assessment.managedRunId === ACTIVE_FIXTURE_MANAGED_RUN_ID
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: ["INELIGIBLE_MANAGED_ATTEMPT_SUPERSEDED"]
    });
    expect(result.decision.status).toBe("no_action");
    expect(result.rankedCandidates).toHaveLength(0);
  });

  it("applies weekly-outcome matching to managed candidates linked to context-only authored PRs", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        githubTitle: "Weekly authored launch",
        primaryOutcome: "Ship weekly authored launch",
        managedScenario: "failed",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "authored_pull_request",
            number: 43,
            title: "Routine dependency cleanup"
          }
        ],
        secondManagedFailure: true
      }).input
    );

    expect(result.decision.topSuggestion).toMatchObject({
      managedRunId: ACTIVE_FIXTURE_MANAGED_RUN_ID,
      title: "Weekly authored launch",
      whyNowReasonCodes: expect.arrayContaining([
        "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
      ])
    });
  });

  it("routes GitHub native identity conflict to refresh and project mismatch to user review", () => {
    const identityConflict = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "failed",
        additionalGitHubTasks: [
          {
            id: 501,
            kind: "review_requested_pull_request",
            number: 42,
            title: "Conflicting native identity"
          }
        ]
      }).input
    );
    expect(
      identityConflict.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_LINK_IDENTITY_CONFLICT"]
    });

    const projectMismatch = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        githubProjectMismatch: true
      }).input
    );
    expect(projectMismatch.decision.status).toBe(
      "needs_clarification"
    );
    expect(
      projectMismatch.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "review_required",
      reviewRoute: "user_review",
      reasonCodes: ["REVIEW_LINK_PROJECT_MISMATCH"]
    });
  });

  it("uses the relation-selected GitHub task kind when one PR has multiple roles", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        additionalGitHubTasks: [
          {
            id: 501,
            kind: "review_requested_pull_request",
            number: 42,
            title: "Synthetic linked task"
          }
        ]
      }).input
    );

    expect(result.decision.topSuggestion).toMatchObject({
      triggerKind: "managed_failure",
      taskKind: "review_requested_pull_request"
    });
  });

  it("selects the latest direct managed failure and deduplicates its generic GitHub loop", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({ managedScenario: "failed" }).input
    );

    expect(result.rankedCandidates).toHaveLength(1);
    expect(result.decision.topSuggestion).toMatchObject({
      triggerSource: "codex_managed",
      triggerKind: "managed_failure",
      lane: "unblock",
      intervention: "inspect",
      state: "failed",
      reasonCodes: ["CANDIDATE_CODEX_LATEST_DIRECT_FAILURE"]
    });
    expect(
      result.assessments.find(
        (assessment) => assessment.triggerSource === "github"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: ["INELIGIBLE_DUPLICATE_OPEN_LOOP"],
      candidateId: null
    });

    const dueFailure = resolveActiveAttention(
      activeAttentionFixture({
        managedScenario: "failed",
        deadlineAt: "2026-08-02T04:00:00.000Z"
      }).input
    );
    expect(dueFailure.decision.topSuggestion).toMatchObject({
      triggerKind: "managed_failure",
      lane: "must_now",
      dueAt: "2026-08-02T04:00:00.000Z"
    });
  });

  it("supports a direct managed-run lifecycle failure without inventing an execution-state claim", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "run_failed"
      }).input
    );

    expect(result.decision.topSuggestion).toMatchObject({
      triggerKind: "managed_failure",
      state: "failed",
      certainty: "confirmed"
    });
  });

  it("excludes a superseded failure and routes observation gaps to refresh", () => {
    const healthy = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "running"
      }).input
    );
    expect(healthy.decision.status).toBe("no_action");
    expect(
      healthy.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: ["INELIGIBLE_MANAGED_RUN_HEALTHY"]
    });

    const recovered = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "recovered"
      }).input
    );
    expect(recovered.decision.status).toBe("no_action");
    expect(
      recovered.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: ["INELIGIBLE_FAILURE_RECOVERED"]
    });

    const gap = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "gap"
      }).input
    );
    expect(gap.decision).toMatchObject({
      status: "insufficient_evidence",
      reasonCodes: ["DECISION_REFRESH_REQUIRED"]
    });
    expect(
      gap.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_SOURCE_GAP"]
    });

    const pruned = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "pruned"
      }).input
    );
    expect(pruned.decision.status).toBe("insufficient_evidence");
    expect(
      pruned.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      reviewRoute: "refresh_sources",
      reasonCodes: ["REVIEW_SOURCE_HISTORY_PRUNED"]
    });

    const offline = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "offline"
      }).input
    );
    expect(offline.decision.status).toBe("insufficient_evidence");
    expect(offline.coverage).toMatchObject({
      managedCodexCoverage: "partial",
      negativeCandidateCoverageComplete: false
    });
    expect(
      offline.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "review_required",
      reviewRoute: "refresh_sources",
      reasonCodes: [
        "REVIEW_MANAGED_LIVE_OBSERVATION_UNAVAILABLE"
      ]
    });

    const endedUnknown = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "ended_unknown"
      }).input
    );
    expect(endedUnknown.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(endedUnknown.coverage.managedCodexCoverage).toBe("partial");
    expect(
      endedUnknown.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "review_required",
      reasonCodes: [
        "REVIEW_MANAGED_LIVE_OBSERVATION_UNAVAILABLE"
      ]
    });
  });

  it("creates follow-through only for a non-retroactive configured workflow after grace", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed",
        workflowAction: "request_review"
      }).input
    );

    expect(result.decision.topSuggestion).toMatchObject({
      triggerKind: "configured_follow_through",
      workflowActionKind: "request_review",
      lane: "close_loop",
      intervention: "close_loop",
      state: "not_started"
    });

    const unconfigured = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed"
      }).input
    );
    expect(unconfigured.decision.status).toBe("no_action");
    expect(
      unconfigured.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      reasonCodes: ["INELIGIBLE_FOLLOW_THROUGH_NOT_CONFIGURED"]
    });

    const retroactive = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed",
        workflowAction: "request_review",
        workflowConfiguredAt: "2026-08-02T02:56:00.000Z"
      }).input
    );
    expect(retroactive.decision.status).toBe("no_action");
    expect(
      retroactive.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      reasonCodes: ["INELIGIBLE_WORKFLOW_NOT_APPLICABLE_TO_RUN"]
    });
  });

  it("does not recommend a workflow already closed explicitly or by its matching artifact", () => {
    const closed = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed",
        workflowAction: "request_review",
        workflowClosure: "skipped"
      }).input
    );
    expect(closed.decision.status).toBe("no_action");
    expect(
      closed.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      reasonCodes: ["INELIGIBLE_FOLLOW_THROUGH_CLOSED"]
    });

    const artifactClosed = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "completed",
        workflowAction: "create_pull_request",
        artifactKind: "github_pull_request"
      }).input
    );
    expect(artifactClosed.decision.topSuggestion).toMatchObject({
      triggerKind: "github_work_item"
    });
    expect(
      artifactClosed.rankedCandidates.some(
        (candidate) =>
          candidate.triggerKind === "configured_follow_through"
      )
    ).toBe(false);
    expect(
      artifactClosed.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      reasonCodes: ["INELIGIBLE_FOLLOW_THROUGH_ARTIFACT_EXISTS"]
    });
  });

  it("does not turn an incompatible GitHub target into a workflow action", () => {
    const createPrForExistingPr = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed",
        workflowAction: "create_pull_request"
      }).input
    );
    expect(createPrForExistingPr.decision.status).toBe("no_action");
    expect(
      createPrForExistingPr.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: [
        "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE"
      ]
    });

    const requestReviewForIssue = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "completed",
        workflowAction: "request_review"
      }).input
    );
    expect(
      requestReviewForIssue.rankedCandidates.some(
        (candidate) =>
          candidate.triggerKind === "configured_follow_through"
      )
    ).toBe(false);
    expect(
      requestReviewForIssue.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: [
        "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE"
      ]
    });

    const requestReviewForReviewerPr = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "review_requested_pull_request",
        managedScenario: "completed",
        workflowAction: "request_review"
      }).input
    );
    expect(requestReviewForReviewerPr.decision.topSuggestion).toMatchObject({
      triggerSource: "github",
      triggerKind: "github_work_item"
    });
    expect(
      requestReviewForReviewerPr.rankedCandidates.some(
        (candidate) =>
          candidate.triggerKind === "configured_follow_through"
      )
    ).toBe(false);
    expect(
      requestReviewForReviewerPr.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: [
        "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE"
      ]
    });
  });

  it("does not apply a stored workflow after its project is archived", () => {
    const result = resolveActiveAttention(
      activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "completed",
        workflowAction: "request_review",
        projectArchived: true
      }).input
    );

    expect(result.decision.status).toBe("no_action");
    expect(
      result.rankedCandidates.some(
        (candidate) =>
          candidate.triggerKind === "configured_follow_through"
      )
    ).toBe(false);
    expect(
      result.assessments.find(
        (assessment) => assessment.triggerSource === "codex_managed"
      )
    ).toMatchObject({
      status: "ineligible",
      reasonCodes: ["INELIGIBLE_FOLLOW_THROUGH_NOT_CONFIGURED"]
    });
  });

  it("routes a user-review assessment to a bounded clarification payload", () => {
    const fixture = activeAttentionFixture({
      githubKind: "assigned_issue",
      managedScenario: "none"
    });
    const { projectionSha256: _projectionSha256, ...eligibilityContent } =
      fixture.input.eligibilityProjection;
    const eligibilityProjection = sealAttentionEligibilityShadowProjection({
      ...eligibilityContent,
      counts: { eligible: 0, reviewRequired: 1, ineligible: 0 },
      assessments: eligibilityContent.assessments.map((assessment) => ({
        ...assessment,
        actionKind: "do" as const,
        status: "review_required" as const,
        reviewRoute: "user_review" as const,
        reasonCodes: [
          "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" as const
        ]
      }))
    });
    const { inputSha256: _inputSha256, ...inputContent } = fixture.input;
    const input = sealActiveAttentionInput({
      ...inputContent,
      eligibilityProjection
    });
    const result = resolveActiveAttention(input);

    expect(result.decision).toMatchObject({
      status: "needs_clarification",
      certainty: null,
      topSuggestion: null,
      reasonCodes: ["DECISION_USER_CLARIFICATION_REQUIRED"],
      clarification: {
        triggerSource: "github"
      }
    });
  });

  it("is deterministic, rejects a tampered input hash, and never leaks raw Codex content", () => {
    const firstFixture = activeAttentionFixture({
      githubKind: "authored_pull_request",
      managedScenario: "failed"
    });
    const secondFixture = activeAttentionFixture({
      githubKind: "authored_pull_request",
      managedScenario: "failed"
    });
    const first = resolveActiveAttention(firstFixture.input);
    const second = resolveActiveAttention(secondFixture.input);

    expect(second).toEqual(first);
    expect(first.asOf).toBe(ACTIVE_FIXTURE_AS_OF);
    expect(JSON.stringify(first)).not.toContain(
      firstFixture.privateCodexThreadSentinel
    );
    expect(JSON.stringify(first)).not.toMatch(
      /"(?:prompt|answer|command|output|filePath|reasoning)"\s*:/u
    );
    expect(() =>
      resolveActiveAttention({
        ...firstFixture.input,
        inputSha256: "0".repeat(64)
      })
    ).toThrow(/hash/i);

    const { inputSha256: _futureHash, ...futureContent } =
      firstFixture.input;
    const futureInput = sealActiveAttentionInput({
      ...futureContent,
      managedRunStartedAtById: {
        ...futureContent.managedRunStartedAtById,
        [Object.keys(futureContent.managedRunStartedAtById)[0]!]:
          "2026-08-02T04:00:00.000Z"
      }
    });
    expect(() => resolveActiveAttention(futureInput)).toThrow(
      /exact replayable evidence graph/i
    );
  });
});
