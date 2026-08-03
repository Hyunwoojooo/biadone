import {
  sealActiveAttentionInput,
  type ActiveAttentionInput
} from "../../src/attentionDecision";
import { normalizeCodexSnapshotToWorkSignals } from "../../src/connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../../src/connectors/codex/types";
import {
  phase2AttentionInput,
  phase2AvailableSource
} from "../../src/crossSource/runAttentionRouter";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../../src/crossSource/versions";
import { sealAttentionEligibilityShadowProjection } from "../../src/eligibility";
import {
  activeAttentionFixture,
  type ActiveAttentionFixtureOptions
} from "../../tests/fixtures/activeAttentionFixture";

/**
 * Bounded, synthetic-only scenario names for the mutable Phase 4B Dev
 * Candidate. This builder is evaluation infrastructure, not production input.
 */
export const ACTIVE_ATTENTION_EVALUATION_SCENARIOS = [
  "github_assigned_focus",
  "github_review_unblock",
  "github_due_soon_must_now",
  "github_overdue_must_now",
  "github_authored_no_action",
  "complete_empty_no_action",
  "managed_running_no_action",
  "managed_turn_failure_unblock",
  "managed_run_failure_unblock",
  "managed_recovered_no_action",
  "managed_gap_refresh",
  "managed_pruned_refresh",
  "managed_failure_due_dedupe",
  "workflow_absent_no_action",
  "workflow_archived_project_no_action",
  "workflow_review_changes",
  "workflow_commit_changes",
  "workflow_create_pull_request_incompatible_pr",
  "workflow_request_review",
  "workflow_request_review_incompatible_review_request",
  "workflow_nonretroactive",
  "workflow_grace_active",
  "workflow_completed_closure",
  "workflow_skipped_closure",
  "workflow_commit_artifact",
  "workflow_pull_request_artifact",
  "workflow_over_generic_dedupe",
  "rank_due_over_failure",
  "rank_failure_over_review",
  "rank_review_over_focus",
  "rank_preserves_phase2_four_plus",
  "weekly_focus_reason_preserved",
  "rank_managed_focus_over_newer_nonmatch",
  "refresh_before_user_review",
  "standalone_user_review",
  "eligible_before_user_review",
  "github_unavailable_insufficient",
  "managed_failure_unbound_no_action",
  "managed_failure_missing_target_refresh",
  "managed_failure_project_mismatch_user_review",
  "tampered_input_hash",
  "future_run_start",
  "privacy_sentinel",
  "deterministic_repeat"
] as const;

export const ACTIVE_ATTENTION_PRIVATE_CODEX_SENTINEL =
  "PRIVATE_ACTIVE_CODEX_PROMPT_SENTINEL" as const;

export type ActiveAttentionEvaluationScenario =
  (typeof ACTIVE_ATTENTION_EVALUATION_SCENARIOS)[number];

export type ActiveAttentionEvaluationFixture = {
  input: unknown;
  privateSentinels: readonly string[];
};

export function buildActiveAttentionEvaluationFixture(
  scenario: ActiveAttentionEvaluationScenario
): ActiveAttentionEvaluationFixture {
  const fixture = buildScenarioFixture(scenario);
  let input: unknown = fixture.input;

  if (scenario === "refresh_before_user_review") {
    const { projectionSha256: _projectionSha256, ...content } =
      fixture.input.eligibilityProjection;
    const eligibilityProjection =
      sealAttentionEligibilityShadowProjection({
        ...content,
        counts: { eligible: 0, reviewRequired: 1, ineligible: 0 },
        assessments: content.assessments.map((assessment) => ({
          ...assessment,
          actionKind: "do" as const,
          status: "review_required" as const,
          reviewRoute: "user_review" as const,
          reasonCodes: [
            "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" as const
          ]
        }))
      });
    input = reseal(fixture.input, { eligibilityProjection });
  }

  if (scenario === "standalone_user_review") {
    input = withEligibilityUserReview(fixture.input, () => true);
  }

  if (scenario === "eligible_before_user_review") {
    const reviewSignalId = fixture.input.githubBatch?.signals.find(
      (signal) =>
        signal.kind === "work_item_observation" &&
        signal.subjectId === "github:object:502"
    )?.signalId;
    input = withEligibilityUserReview(
      fixture.input,
      (assessment) => assessment.sourceSignalId === reviewSignalId
    );
  }

  if (scenario === "privacy_sentinel") {
    input = withPrivateCodexContext(fixture.input);
  }

  if (scenario === "tampered_input_hash") {
    input = { ...fixture.input, inputSha256: "0".repeat(64) };
  }

  if (scenario === "future_run_start") {
    const managedRunId = Object.keys(
      fixture.input.managedRunStartedAtById
    )[0];
    input = reseal(fixture.input, {
      managedRunStartedAtById: managedRunId
        ? { [managedRunId]: "2026-08-02T04:00:00.000Z" }
        : {}
    });
  }

  return {
    input,
    privateSentinels:
      scenario === "privacy_sentinel"
        ? [ACTIVE_ATTENTION_PRIVATE_CODEX_SENTINEL]
        : []
  };
}

function buildScenarioFixture(
  scenario: ActiveAttentionEvaluationScenario
): ReturnType<typeof activeAttentionFixture> {
  switch (scenario) {
    case "github_assigned_focus":
      return activeAttentionFixture({ githubKind: "assigned_issue" });
    case "github_review_unblock":
      return activeAttentionFixture({
        githubKind: "review_requested_pull_request"
      });
    case "github_due_soon_must_now":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        deadlineAt: "2026-08-02T04:00:00.000Z"
      });
    case "github_overdue_must_now":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        deadlineAt: "2026-08-02T02:00:00.000Z"
      });
    case "github_authored_no_action":
      return activeAttentionFixture({
        githubKind: "authored_pull_request"
      });
    case "complete_empty_no_action":
      return activeAttentionFixture({ githubKind: "none" });
    case "managed_running_no_action":
      return managedFixture("running");
    case "managed_turn_failure_unblock":
    case "privacy_sentinel":
    case "deterministic_repeat":
      return managedFixture("failed");
    case "managed_run_failure_unblock":
      return managedFixture("run_failed");
    case "managed_recovered_no_action":
      return managedFixture("recovered");
    case "managed_gap_refresh":
      return managedFixture("gap");
    case "managed_pruned_refresh":
      return managedFixture("pruned");
    case "managed_failure_due_dedupe":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "failed",
        deadlineAt: "2026-08-02T04:00:00.000Z"
      });
    case "workflow_absent_no_action":
      return workflowFixture(null);
    case "workflow_archived_project_no_action":
      return workflowFixture("request_review", {
        projectArchived: true
      });
    case "workflow_review_changes":
      return workflowFixture("review_changes");
    case "workflow_commit_changes":
      return workflowFixture("commit_changes");
    case "workflow_create_pull_request_incompatible_pr":
      return workflowFixture("create_pull_request");
    case "workflow_request_review":
      return workflowFixture("request_review");
    case "workflow_request_review_incompatible_review_request":
      return workflowFixture("request_review", {
        githubKind: "review_requested_pull_request"
      });
    case "workflow_nonretroactive":
      return workflowFixture("request_review", {
        workflowConfiguredAt: "2026-08-02T02:56:00.000Z"
      });
    case "workflow_grace_active":
      return workflowFixture("request_review", {
        managedCompletedAt: "2026-08-02T02:59:30.000Z"
      });
    case "workflow_completed_closure":
      return workflowFixture("request_review", {
        workflowClosure: "completed"
      });
    case "workflow_skipped_closure":
      return workflowFixture("request_review", {
        workflowClosure: "skipped"
      });
    case "workflow_commit_artifact":
      return workflowFixture("commit_changes", {
        artifactKind: "github_commit"
      });
    case "workflow_pull_request_artifact":
      return workflowFixture("create_pull_request", {
        artifactKind: "github_pull_request",
        githubKind: "assigned_issue"
      });
    case "workflow_over_generic_dedupe":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "completed",
        workflowAction: "create_pull_request"
      });
    case "rank_due_over_failure":
      return activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "assigned_issue",
            number: 43,
            deadlineAt: "2026-08-02T04:00:00.000Z"
          }
        ]
      });
    case "rank_failure_over_review":
      return activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "review_requested_pull_request",
            number: 43
          }
        ]
      });
    case "rank_review_over_focus":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "review_requested_pull_request",
            number: 43
          }
        ]
      });
    case "rank_preserves_phase2_four_plus":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        additionalGitHubTasks: [
          {
            id: 502,
            kind: "review_requested_pull_request",
            number: 43
          },
          {
            id: 503,
            kind: "assigned_issue",
            number: 44,
            deadlineAt: "2026-08-02T04:00:00.000Z"
          },
          {
            id: 504,
            kind: "assigned_issue",
            number: 45,
            deadlineAt: "2026-08-02T02:00:00.000Z"
          },
          {
            id: 505,
            kind: "review_requested_pull_request",
            number: 46
          }
        ]
      });
    case "weekly_focus_reason_preserved":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        primaryOutcome: "Synthetic linked task"
      });
    case "rank_managed_focus_over_newer_nonmatch":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
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
      });
    case "refresh_before_user_review":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        managedScenario: "gap"
      });
    case "standalone_user_review":
      return activeAttentionFixture({ githubKind: "assigned_issue" });
    case "eligible_before_user_review":
      return activeAttentionFixture({
        githubKind: "assigned_issue",
        additionalGitHubTasks: [
          { id: 502, kind: "assigned_issue", number: 43 }
        ]
      });
    case "github_unavailable_insufficient":
      return activeAttentionFixture({
        githubKind: "none",
        githubAvailability: "unavailable"
      });
    case "managed_failure_unbound_no_action":
      return activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        bindManagedRun: false
      });
    case "managed_failure_missing_target_refresh":
      return activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        bindingGitHubObjectId: 999
      });
    case "managed_failure_project_mismatch_user_review":
      return activeAttentionFixture({
        githubKind: "authored_pull_request",
        managedScenario: "failed",
        githubProjectMismatch: true
      });
    case "tampered_input_hash":
    case "future_run_start":
      return managedFixture("failed");
  }
}

function managedFixture(
  managedScenario: NonNullable<
    ActiveAttentionFixtureOptions["managedScenario"]
  >
) {
  return activeAttentionFixture({
    githubKind: "authored_pull_request",
    managedScenario
  });
}

function workflowFixture(
  workflowAction: ActiveAttentionFixtureOptions["workflowAction"],
  overrides: Partial<ActiveAttentionFixtureOptions> = {}
) {
  return activeAttentionFixture({
    githubKind: "authored_pull_request",
    managedScenario: "completed",
    workflowAction,
    ...overrides
  });
}

function reseal(
  input: ActiveAttentionInput,
  overrides: Partial<
    Omit<ActiveAttentionInput, "contract" | "inputSha256">
  >
): ActiveAttentionInput {
  const { inputSha256: _inputSha256, ...content } = input;
  return sealActiveAttentionInput({ ...content, ...overrides });
}

function withEligibilityUserReview(
  input: ActiveAttentionInput,
  shouldReview: (
    assessment: ActiveAttentionInput["eligibilityProjection"]["assessments"][number]
  ) => boolean
): ActiveAttentionInput {
  const { projectionSha256: _projectionSha256, ...content } =
    input.eligibilityProjection;
  const assessments = content.assessments.map((assessment) =>
    shouldReview(assessment)
      ? {
          ...assessment,
          actionKind: "do" as const,
          status: "review_required" as const,
          reviewRoute: "user_review" as const,
          reasonCodes: [
            "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" as const
          ]
        }
      : assessment
  );
  const eligibilityProjection = sealAttentionEligibilityShadowProjection({
    ...content,
    counts: {
      eligible: assessments.filter(
        (assessment) => assessment.status === "eligible"
      ).length,
      reviewRequired: assessments.filter(
        (assessment) => assessment.status === "review_required"
      ).length,
      ineligible: assessments.filter(
        (assessment) => assessment.status === "ineligible"
      ).length
    },
    assessments
  });
  return reseal(input, { eligibilityProjection });
}

function withPrivateCodexContext(
  input: ActiveAttentionInput
): ActiveAttentionInput {
  const normalized = normalizeCodexSnapshotToWorkSignals(
    privateCodexSnapshot(),
    {
      asOf: input.asOf,
      freshnessPolicy: {
        version: SNAPSHOT_VALIDITY_POLICY_VERSION,
        maxAgeMsBySource: {
          github: 10 * 60 * 1_000,
          codex: 10 * 60 * 1_000
        },
        maxFutureClockSkewMs: 60_000
      }
    }
  );
  if (normalized.status !== "normalized") {
    throw new TypeError("Synthetic private Codex context did not normalize.");
  }
  const baseAttentionInput = phase2AttentionInput({
    asOf: input.asOf,
    github: input.baseAttentionInput.sources.github,
    codex: phase2AvailableSource(normalized.batch),
    googleCalendar: input.baseAttentionInput.sources.googleCalendar,
    notion: input.baseAttentionInput.sources.notion,
    focus: input.baseAttentionInput.focus
  });
  return reseal(input, { baseAttentionInput });
}

function privateCodexSnapshot(): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion:
      "codex-app-server-conversation-and-execution-v1",
    contentMode: "conversation_and_execution",
    codexVersion: "codex-cli synthetic",
    fetchedAt: "2026-08-02T02:59:00.000Z",
    lookbackStart: "2026-07-26T03:00:00.000Z",
    truncated: false,
    conversationStoreSha256: "a".repeat(64),
    conversationRetentionDays: 7,
    scopeIds: ["9".repeat(24)],
    sessions: [
      {
        id: "a".repeat(24),
        source: "codex",
        kind: "coding_session",
        scopeId: "9".repeat(24),
        projectLabel: "synthetic-private-context",
        taskSummary: null,
        taskSummarySource: null,
        createdAt: "2026-08-02T02:40:00.000Z",
        updatedAt: "2026-08-02T02:58:00.000Z",
        activityState: "idle",
        attentionState: null,
        content: {
          state: "complete",
          contentSha256: "b".repeat(64),
          contentSourceUpdatedAt: "2026-08-02T02:58:00.000Z",
          collectedAt: "2026-08-02T02:58:30.000Z",
          expiresAt: "2026-08-09T02:58:30.000Z",
          historicalTurnStatus: "completed",
          latestTurnCompletedAt: "2026-08-02T02:57:00.000Z",
          turnCount: 1,
          userPromptCount: 1,
          agentResponseCount: 0,
          commandExecutionCount: 0,
          failedCommandCount: 0,
          fileChangeCount: 0,
          toolCallCount: 0,
          omittedReasoningItemCount: 0,
          omittedUnsupportedItemCount: 0,
          truncated: false,
          reasonCodes: [],
          latestUserPromptExcerpt:
            ACTIVE_ATTENTION_PRIVATE_CODEX_SENTINEL,
          latestAgentResponseExcerpt: null,
          latestExecutionSummary: null
        }
      }
    ]
  };
}
