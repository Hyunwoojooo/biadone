import { describe, expect, it } from "vitest";

import { createGitHubArtifactId } from "../src/artifacts/contracts";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import {
  runtimeWorkSignalSchema
} from "../src/crossSource/schema";
import {
  GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
  SNAPSHOT_VALIDITY_POLICY_VERSION
} from "../src/crossSource/versions";
import {
  verifyRuntimeWorkSignalBatchIntegrity,
  verifyRuntimeWorkSignalIntegrity
} from "../src/crossSource/workSignalIntegrity";
import {
  syntheticNormalizedSignalSchema
} from "../src/evaluation/crossSourceDatasetSchema";
import { mapRuntimeBatchToSyntheticEvaluationSignals } from "../src/evaluation/mapRuntimeWorkSignals";

const options = {
  asOf: "2026-07-26T12:01:00.000Z",
  freshnessPolicy: {
    version: SNAPSHOT_VALIDITY_POLICY_VERSION,
    maxAgeMsBySource: {
      github: 10 * 60 * 1000,
      codex: 10 * 60 * 1000
    },
    maxFutureClockSkewMs: 1_000
  }
};
const PUSH_HEAD_OID =
  "0123456789abcdef0123456789abcdef01234567";
const PUSH_ARTIFACT_ID = createGitHubArtifactId({
  kind: "github_commit",
  repositoryId: 101,
  oid: PUSH_HEAD_OID
});

describe("GitHub runtime WorkSignal normalization", () => {
  it("is deterministic and preserves only source-supported meaning", () => {
    const snapshot = githubSnapshot();
    const reordered: GitHubSnapshot = {
      ...snapshot,
      tasks: [...snapshot.tasks].reverse(),
      activities: [...snapshot.activities].reverse()
    };
    const first = normalizeGitHubSnapshotToWorkSignals(
      snapshot,
      options
    );
    const second = normalizeGitHubSnapshotToWorkSignals(
      reordered,
      options
    );

    expect(first.status).toBe("normalized");
    expect(second).toEqual(first);
    if (first.status !== "normalized") return;
    const { batch } = first;
    expect(verifyRuntimeWorkSignalBatchIntegrity(batch)).toEqual({
      ok: true,
      issues: []
    });

    const workItems = batch.signals.filter(
      (signal) => signal.kind === "work_item_observation"
    );
    const deadlines = batch.signals.filter(
      (signal) => signal.kind === "deadline_observation"
    );
    const activities = batch.signals.filter(
      (signal) => signal.kind === "activity_observation"
    );
    expect(workItems).toHaveLength(4);
    expect(deadlines).toHaveLength(1);
    expect(activities).toHaveLength(1);
    expect(activities[0]?.facts).not.toHaveProperty("artifactId");
    expect(deadlines[0]).toMatchObject({
      attentionCapability: "candidate_input",
      facts: {
        taskKind: "review_requested_pull_request",
        semanticRole: "direct_work_item",
        eligibilityLimit: "draft_state_unknown"
      }
    });
    const deadline = deadlines[0];
    expect(deadline?.kind).toBe("deadline_observation");
    if (deadline?.kind === "deadline_observation") {
      expect(
        runtimeWorkSignalSchema.safeParse({
          ...deadline,
          evidence: deadline.evidence.filter(
            (evidence) =>
              evidence.type !== "github_query_membership"
          )
        }).success
      ).toBe(false);
      expect(
        runtimeWorkSignalSchema.safeParse({
          ...deadline,
          evidence: deadline.evidence.filter(
            (evidence) =>
              evidence.type !== "github_object_field" ||
              evidence.field !== "milestone_due_at"
          )
        }).success
      ).toBe(false);
    }

    const assigned = workItems.find(
      (signal) => signal.facts.taskKind === "assigned_issue"
    );
    expect(assigned).toMatchObject({
      attentionCapability: "candidate_input",
      facts: {
        relationship: "assigned_to_user",
        semanticRole: "direct_work_item",
        eligibilityLimit: "none",
        draftState: "not_applicable"
      }
    });
    expect(
      assigned?.evidence.some(
        (evidence) =>
          evidence.type === "github_query_membership" &&
          evidence.queryKind === "assigned_open_issue"
      )
    ).toBe(true);

    const review = workItems.find(
      (signal) =>
        signal.facts.taskKind ===
        "review_requested_pull_request"
    );
    const authoredSamePullRequest = workItems.find(
      (signal) =>
        signal.facts.taskKind === "authored_pull_request" &&
        signal.subjectId === review?.subjectId
    );
    expect(review).toMatchObject({
      attentionCapability: "candidate_input",
      facts: {
        relationship: "review_requested_from_user",
        eligibilityLimit: "draft_state_unknown",
        draftState: "unknown"
      }
    });
    expect(authoredSamePullRequest).toMatchObject({
      subjectId: review?.subjectId,
      attentionCapability: "overview_only",
      facts: {
        relationship: "authored_by_user",
        semanticRole: "context_only",
        eligibilityLimit: "not_actionable_by_source_kind"
      }
    });
    expect(authoredSamePullRequest?.signalId).not.toBe(
      review?.signalId
    );

    const unsafe = workItems.find(
      (signal) => signal.subjectId === "github:object:203"
    );
    expect(unsafe?.facts.destinationUrl).toBeNull();
    expect(batch.issues).toContainEqual(
      expect.objectContaining({
        code: "UNSAFE_DESTINATION",
        subjectId: "github:object:203"
      })
    );

    const serialized = JSON.stringify(batch);
    expect(serialized).not.toContain('"urgency"');
    expect(serialized).not.toContain('"impact"');
    expect(serialized).not.toContain('"urgent"');
    expect(serialized).not.toContain('"today"');
    expect(serialized).not.toContain('"nativeField"');
  });

  it("keeps legacy v3 push facts on the existing normalizer contract", () => {
    const snapshot: GitHubSnapshot = {
      ...githubSnapshot(),
      schemaVersion: "github-snapshot-v3",
      actionabilityCoverage: {
        state: "unavailable",
        authoredPullRequestCount: 2,
        attemptedCount: 0,
        collectedCount: 0,
        truncated: true
      }
    };
    const result = normalizeGitHubSnapshotToWorkSignals(
      snapshot,
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    expect(result.batch.normalizerVersion).toBe(
      GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION
    );
    const pushSignal = result.batch.signals.find(
      (signal) => signal.kind === "activity_observation"
    );
    expect(pushSignal?.facts).not.toHaveProperty("artifactId");
  });

  it("normalizes v4 pushes with exact native identity and only an opaque artifact ID", () => {
    const legacy = githubSnapshot();
    const push = legacy.activities[0];
    expect(push).toBeDefined();
    if (!push) return;
    const snapshot: GitHubSnapshot = {
      ...legacy,
      schemaVersion: "github-snapshot-v4",
      actionabilityCoverage: {
        state: "unavailable",
        authoredPullRequestCount: 2,
        attemptedCount: 0,
        collectedCount: 0,
        truncated: true
      },
      activities: [{ ...push, artifactId: PUSH_ARTIFACT_ID }]
    };

    const result = normalizeGitHubSnapshotToWorkSignals(
      snapshot,
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    expect(result.batch).toMatchObject({
      sourceSchemaVersion: "github-snapshot-v4",
      normalizerVersion:
        GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION
    });
    expect(verifyRuntimeWorkSignalBatchIntegrity(result.batch)).toEqual({
      ok: true,
      issues: []
    });

    const pushSignal = result.batch.signals.find(
      (signal) =>
        signal.kind === "activity_observation" &&
        signal.facts.activityKind === "push"
    );
    expect(pushSignal).toMatchObject({
      subjectId: "github:activity:event-1",
      sourceScopeId: "repository:101",
      facts: {
        activityKind: "push",
        artifactId: PUSH_ARTIFACT_ID
      },
      evidence: [
        {
          type: "github_activity_record",
          activityId: "event-1",
          activityKind: "push"
        }
      ]
    });
    expect(JSON.stringify(result.batch)).not.toContain(PUSH_HEAD_OID);
    if (pushSignal?.kind !== "activity_observation") return;
    const { artifactId: _artifactId, ...legacyFacts } =
      pushSignal.facts;
    expect(
      runtimeWorkSignalSchema.safeParse({
        ...pushSignal,
        facts: legacyFacts
      }).success
    ).toBe(false);
  });

  it("rejects v4 activities whose opaque artifact identity does not match push semantics", () => {
    const legacy = githubSnapshot();
    const push = legacy.activities[0];
    expect(push).toBeDefined();
    if (!push) return;
    const v4Base = {
      ...legacy,
      schemaVersion: "github-snapshot-v4",
      actionabilityCoverage: {
        state: "unavailable",
        authoredPullRequestCount: 2,
        attemptedCount: 0,
        collectedCount: 0,
        truncated: true
      }
    };

    for (const activity of [
      push,
      {
        ...push,
        activityKind: "ref_created",
        artifactId: PUSH_ARTIFACT_ID
      }
    ]) {
      expect(
        normalizeGitHubSnapshotToWorkSignals(
          { ...v4Base, activities: [activity] },
          options
        )
      ).toMatchObject({
        status: "rejected",
        failure: { code: "SNAPSHOT_PARSE_FAILED" }
      });
    }
  });

  it("normalizes v6 lifecycle activity with a canonical native work-item identity", () => {
    const legacy = githubSnapshot();
    const push = legacy.activities[0];
    expect(push).toBeDefined();
    if (!push) return;
    const snapshot: GitHubSnapshot = {
      ...legacy,
      schemaVersion: "github-snapshot-v6",
      actionabilityCoverage: {
        state: "unavailable",
        authoredPullRequestCount: 2,
        attemptedCount: 0,
        collectedCount: 0,
        truncated: true
      },
      activities: [
        {
          ...push,
          artifactId: PUSH_ARTIFACT_ID,
          subjectObjectId: null
        },
        {
          id: "event-close-11",
          source: "github",
          kind: "user_activity",
          activityKind: "issue_closed",
          repositoryId: 101,
          repositoryFullName: "acme/app",
          occurredAt: "2026-07-26T11:59:30.000Z",
          subjectType: "issue",
          subjectNumber: 11,
          subjectObjectId: 201,
          subjectTitle: "PRIVATE_ACTIVITY_TITLE",
          refName: null,
          reviewState: null,
          artifactId: null
        }
      ]
    };

    const result = normalizeGitHubSnapshotToWorkSignals(snapshot, options);
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    expect(result.batch).toMatchObject({
      sourceSchemaVersion: "github-snapshot-v6",
      normalizerVersion:
        GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
    });
    const lifecycle = result.batch.signals.find(
      (signal) =>
        signal.kind === "activity_observation" &&
        signal.facts.activityKind === "issue_closed"
    );
    expect(lifecycle).toMatchObject({
      facts: {
        subjectNumber: 11,
        nativeSubjectId: "github:object:201",
        artifactId: null
      }
    });
    expect(verifyRuntimeWorkSignalBatchIntegrity(result.batch)).toEqual({
      ok: true,
      issues: []
    });
  });

  it("reads v5 lifecycle identity with its frozen pre-canonical normalizer", () => {
    const legacy = githubSnapshot();
    const push = legacy.activities[0];
    expect(push).toBeDefined();
    if (!push) return;
    const snapshot: GitHubSnapshot = {
      ...legacy,
      schemaVersion: "github-snapshot-v5",
      actionabilityCoverage: {
        state: "unavailable",
        authoredPullRequestCount: 2,
        attemptedCount: 0,
        collectedCount: 0,
        truncated: true
      },
      activities: [
        {
          ...push,
          artifactId: PUSH_ARTIFACT_ID,
          subjectObjectId: null
        },
        {
          id: "event-close-v5",
          source: "github",
          kind: "user_activity",
          activityKind: "pull_request_closed",
          repositoryId: 101,
          repositoryFullName: "acme/app",
          occurredAt: "2026-07-26T11:59:30.000Z",
          subjectType: "pull_request",
          subjectNumber: 11,
          subjectObjectId: 999,
          subjectTitle: "PRIVATE_ACTIVITY_TITLE",
          refName: null,
          reviewState: null,
          artifactId: null
        }
      ]
    };

    const result = normalizeGitHubSnapshotToWorkSignals(snapshot, options);
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    expect(result.batch).toMatchObject({
      sourceSchemaVersion: "github-snapshot-v5",
      normalizerVersion:
        GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION
    });
    expect(verifyRuntimeWorkSignalBatchIntegrity(result.batch)).toEqual({
      ok: true,
      issues: []
    });
  });

  it("keeps positive tasks when activity coverage is unavailable", () => {
    const snapshot = githubSnapshot({
      activitiesState: "unavailable",
      activities: []
    });
    const result = normalizeGitHubSnapshotToWorkSignals(
      snapshot,
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;

    expect(
      result.batch.signals.filter(
        (signal) => signal.kind === "work_item_observation"
      )
    ).toHaveLength(4);
    expect(result.batch.assessment).toMatchObject({
      completeness: "partial",
      usableForCurrentCandidates: true
    });
    expect(result.batch.issues).toContainEqual({
      code: "GITHUB_ACTIVITIES_UNAVAILABLE",
      subjectId: null,
      recordSha256: null
    });
  });

  it("preserves truncation while keeping visible positive facts", () => {
    const result = normalizeGitHubSnapshotToWorkSignals(
      githubSnapshot({ truncated: true }),
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;

    expect(result.batch.assessment).toMatchObject({
      truncated: true,
      candidateSetComplete: false
    });
    expect(result.batch.signals.length).toBeGreaterThan(0);
    expect(
      result.batch.signals.every(
        (signal) => signal.completeness === "truncated"
      )
    ).toBe(true);
  });

  it("keeps a verified authored PR failure actionable while global actionability coverage is partial", () => {
    const result = normalizeGitHubSnapshotToWorkSignals(
      githubSnapshot({
        schemaVersion: "github-snapshot-v3",
        actionabilityCoverage: {
          state: "partial",
          authoredPullRequestCount: 2,
          attemptedCount: 2,
          collectedCount: 1,
          truncated: false
        },
        tasks: [
          githubTask({
            id: 301,
            kind: "authored_pull_request",
            number: 31,
            title: "Fix failing checkout checks",
            htmlUrl: "https://github.com/acme/app/pull/31",
            actionability: {
              collectionState: "partial",
              draft: false,
              reviewDecision: "unknown",
              checksSummary: {
                collectionState: "complete",
                state: "failing",
                totalCount: 2,
                completedCount: 2,
                failedCount: 1,
                pendingCount: 0,
                truncated: false
              },
              mergeable: true,
              mergeConflict: false,
              unresolvedChangeRequestCount: null,
              requestedReviewerCount: 0,
              actionRequired: true,
              actionRequiredReasons: ["checks_failed"]
            }
          }),
          githubTask({
            id: 302,
            kind: "authored_pull_request",
            number: 32,
            title: "Actionability unavailable",
            htmlUrl: "https://github.com/acme/app/pull/32"
          })
        ],
        activities: []
      }),
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;

    expect(result.batch.assessment).toMatchObject({
      completeness: "partial",
      truncated: false,
      candidateSetComplete: false,
      usableForCurrentCandidates: true,
      reasonCodes: expect.arrayContaining([
        "GITHUB_ACTIONABILITY_PARTIAL"
      ])
    });
    const actionable = result.batch.signals.find(
      (signal) => signal.subjectId === "github:object:301"
    );
    expect(actionable).toMatchObject({
      kind: "work_item_observation",
      completeness: "complete",
      attentionCapability: "candidate_input",
      facts: {
        semanticRole: "direct_work_item",
        eligibilityLimit: "none",
        draftState: "ready",
        actionability: {
          actionRequired: true,
          actionRequiredReasons: ["checks_failed"]
        }
      }
    });
    if (actionable?.kind !== "work_item_observation") return;
    const actionabilityFields = new Set(
      actionable.evidence
        .filter((evidence) => evidence.type === "github_object_field")
        .map((evidence) => evidence.field)
    );
    for (const field of [
      "collection_state",
      "draft",
      "review_decision",
      "checks_summary",
      "mergeable",
      "merge_conflict",
      "unresolved_change_request_count",
      "requested_reviewer_count",
      "action_required",
      "action_required_reasons"
    ] as const) {
      expect(actionabilityFields.has(field)).toBe(true);
    }
    expect(
      runtimeWorkSignalSchema.safeParse({
        ...actionable,
        evidence: actionable.evidence.filter(
          (evidence) =>
            evidence.type !== "github_object_field" ||
            evidence.field !== "action_required"
        )
      }).success
    ).toBe(false);

    expect(
      result.batch.signals.find(
        (signal) => signal.subjectId === "github:object:302"
      )
    ).toMatchObject({
      attentionCapability: "overview_only",
      facts: {
        semanticRole: "context_only",
        eligibilityLimit: "not_actionable_by_source_kind"
      }
    });
  });

  it("crosses into the synthetic evaluation contract only through an explicit mapper", () => {
    const normalized = normalizeGitHubSnapshotToWorkSignals(
      githubSnapshot(),
      options
    );
    expect(normalized.status).toBe("normalized");
    if (normalized.status !== "normalized") return;

    const mapping = mapRuntimeBatchToSyntheticEvaluationSignals(
      normalized.batch,
      {
        snapshotId: "integration/github/snapshot-1",
        fixtureRef:
          "private://integration/github/current-v2/snapshot-1"
      }
    );
    expect(
      mapRuntimeBatchToSyntheticEvaluationSignals(
        normalized.batch,
        {
          snapshotId: "integration/github/snapshot-1",
          fixtureRef:
            "private://integration/github/current-v2/snapshot-1"
        }
      )
    ).toEqual(mapping);
    expect(mapping.signalCount).toBe(
      normalized.batch.signalCount
    );
    expect(mapping.runtimeAssessment).toEqual(
      normalized.batch.assessment
    );
    expect(
      mapping.signals.find(
        (signal) =>
          signal.kind === "review_requested" &&
          signal.subjectId === "github:object:202"
      )
    ).toMatchObject({
      facts: {
        draft: "unknown",
        eligibilityLimit: "draft_state_unknown"
      },
      destinationRef: "github://acme/app/pull/22"
    });
    expect(
      syntheticNormalizedSignalSchema.safeParse(
        normalized.batch.signals[0]
      ).success
    ).toBe(false);
    expect(
      runtimeWorkSignalSchema.safeParse(mapping.signals[0]).success
    ).toBe(false);
    expect(() =>
      mapRuntimeBatchToSyntheticEvaluationSignals(
        {
          ...normalized.batch,
          collectorVersion: "tampered-collector"
        },
        {
          snapshotId: "integration/github/snapshot-1",
          fixtureRef:
            "private://integration/github/current-v2/snapshot-1"
        }
      )
    ).toThrow("integrity verification failed");
    expect(() =>
      mapRuntimeBatchToSyntheticEvaluationSignals(
        normalized.batch,
        {
          snapshotId: "invalid snapshot id",
          fixtureRef:
            "private://integration/github/current-v2/snapshot-1"
        }
      )
    ).toThrow();
  });
});

describe("Codex v2 safe overview normalization", () => {
  it("does not invent progress, failure, completion, or request lifecycle", () => {
    const result = normalizeCodexSnapshotToWorkSignals(
      codexSnapshot(),
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    const { batch } = result;

    expect(batch.signals).toHaveLength(4);
    expect(
      batch.signals.every(
        (signal) =>
          signal.kind === "execution_observation" &&
          signal.attentionCapability === "overview_only"
      )
    ).toBe(true);
    const active = batch.signals.find(
      (signal) =>
        signal.kind === "execution_observation" &&
        signal.facts.nativeActivityState === "active"
    );
    const systemError = batch.signals.find(
      (signal) =>
        signal.kind === "execution_observation" &&
        signal.facts.nativeActivityState === "system_error"
    );
    const idle = batch.signals.find(
      (signal) =>
        signal.kind === "execution_observation" &&
        signal.facts.nativeActivityState === "idle"
    );
    expect(active).toMatchObject({
      facts: {
        semanticState: "unknown",
        nativeAttentionState: "waiting_on_approval",
        attentionSemanticRole: "overview_badge_only",
        taskSummary: null,
        taskSummarySemanticRole: "display_only_unknown",
        destinationUrl: null
      }
    });
    expect(systemError).toMatchObject({
      facts: {
        semanticState: "unknown"
      }
    });
    expect(idle).toMatchObject({
      facts: {
        semanticState: "idle"
      }
    });

    const serialized = JSON.stringify(batch);
    for (const unsupported of [
      "requestId",
      "requestedAt",
      "resolvedAt",
      "expiredAt",
      "execution_exception",
      "transient_attention_lifecycle",
      '"running"',
      '"failed"',
      '"stalled"',
      '"completed"'
    ]) {
      expect(serialized).not.toContain(unsupported);
    }
    expect(verifyRuntimeWorkSignalBatchIntegrity(batch).ok).toBe(true);
    expect(active?.kind).toBe("execution_observation");
    if (active?.kind === "execution_observation") {
      expect(
        runtimeWorkSignalSchema.safeParse({
          ...active,
          evidence: active.evidence.filter(
            (evidence) => evidence.field !== "activity_state"
          )
        }).success
      ).toBe(false);
    }
  });

  it("keeps an opted-in summary as display-only unknown", () => {
    const snapshot = codexSnapshot({
      collectorVersion:
        "codex-app-server-activity-summary-v1",
      contentMode: "activity_summary",
      sessions: [
        codexSession({
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          taskSummary: "결제 API를 수정해줘",
          taskSummarySource: "first_user_request"
        })
      ]
    });
    const result = normalizeCodexSnapshotToWorkSignals(
      snapshot,
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;

    expect(result.batch.signals).toHaveLength(1);
    expect(result.batch.signals[0]).toMatchObject({
      kind: "execution_observation",
      facts: {
        taskSummary: "결제 API를 수정해줘",
        taskSummarySource: "first_user_request",
        taskSummarySemanticRole: "display_only_unknown"
      }
    });
    expect(
      result.batch.signals.some(
        (signal) =>
          signal.kind === "work_item_observation" ||
          signal.kind === "deadline_observation"
      )
    ).toBe(false);
  });

  it("detects schema-valid integrity tampering", () => {
    const result = normalizeCodexSnapshotToWorkSignals(
      codexSnapshot(),
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    const active = result.batch.signals.find(
      (signal) =>
        signal.kind === "execution_observation" &&
        signal.facts.nativeActivityState === "active"
    );
    expect(active?.kind).toBe("execution_observation");
    if (!active || active.kind !== "execution_observation") return;

    const tampered = {
      ...active,
      facts: {
        ...active.facts,
        projectLabel: "tampered-project"
      }
    };
    expect(runtimeWorkSignalSchema.safeParse(tampered).success).toBe(
      true
    );
    expect(verifyRuntimeWorkSignalIntegrity(tampered)).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        "OBSERVATION_ID_MISMATCH",
        "SIGNAL_HASH_MISMATCH"
      ])
    });
  });

  it("rejects raw connector extras without echoing them", () => {
    const rawSecret = "SECRET RAW COMMAND OUTPUT";
    const snapshot = {
      ...codexSnapshot(),
      sessions: [
        {
          ...codexSession(),
          rawCommandOutput: rawSecret
        }
      ]
    };
    const result = normalizeCodexSnapshotToWorkSignals(
      snapshot,
      options
    );
    expect(result).toMatchObject({
      status: "rejected",
      failure: {
        code: "SNAPSHOT_PARSE_FAILED"
      }
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);

    const blankSummaryResult =
      normalizeCodexSnapshotToWorkSignals(
        {
          ...codexSnapshot({
            collectorVersion:
              "codex-app-server-activity-summary-v1",
            contentMode: "activity_summary"
          }),
          sessions: [
            {
              ...codexSession(),
              taskSummary: "   ",
              taskSummarySource: "first_user_request"
            }
          ]
        },
        options
      );
    expect(blankSummaryResult).toMatchObject({
      status: "rejected",
      failure: {
        code: "SNAPSHOT_PARSE_FAILED"
      }
    });
  });

  it("rejects generic connector evidence at the runtime boundary", () => {
    const result = normalizeCodexSnapshotToWorkSignals(
      codexSnapshot(),
      options
    );
    expect(result.status).toBe("normalized");
    if (result.status !== "normalized") return;
    const signal = result.batch.signals[0];
    expect(signal).toBeDefined();
    if (!signal) return;

    const genericEvidence = {
      ...signal,
      evidence: [
        {
          type: "connector_field",
          nativeField: "anything",
          source: "codex"
        }
      ]
    };
    expect(
      runtimeWorkSignalSchema.safeParse(genericEvidence).success
    ).toBe(false);

    if (signal.kind !== "execution_observation") return;
    const wrongNativeIdentity = {
      ...signal,
      evidence: signal.evidence.map((evidence, index) =>
        index === 0
          ? {
              ...evidence,
              sessionId: "eeeeeeeeeeeeeeeeeeeeeeee"
            }
          : evidence
      )
    };
    expect(
      runtimeWorkSignalSchema.safeParse(wrongNativeIdentity).success
    ).toBe(false);
  });
});

function githubSnapshot(
  overrides: Partial<GitHubSnapshot> = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "Iv1.client",
    appSlug: "blabase",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-07-26T12:00:00.000Z",
    user: { id: 7, login: "nika" },
    truncated: false,
    activityWindowStart: "2026-06-26T12:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 10,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 10,
        fullName: "acme/app",
        private: true,
        archived: false,
        updatedAt: "2026-07-26T11:00:00.000Z"
      }
    ],
    tasks: [
      githubTask({
        id: 201,
        kind: "assigned_issue",
        number: 11,
        title: "Urgent today checkout fix",
        htmlUrl: "https://github.com/acme/app/issues/11",
        labelNames: ["urgent", "today"]
      }),
      githubTask({
        id: 202,
        kind: "review_requested_pull_request",
        number: 22,
        title: "Review API",
        htmlUrl: "https://github.com/acme/app/pull/22",
        milestoneDueAt: "2026-07-27T00:00:00.000Z"
      }),
      githubTask({
        id: 202,
        kind: "authored_pull_request",
        number: 22,
        title: "Review API",
        htmlUrl: "https://github.com/acme/app/pull/22"
      }),
      githubTask({
        id: 203,
        kind: "authored_pull_request",
        number: 23,
        title: "Unsafe destination",
        htmlUrl:
          "https://github.com.evil.test/acme/app/pull/23?token=secret"
      })
    ],
    activities: [
      {
        id: "event-1",
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 101,
        repositoryFullName: "acme/app",
        occurredAt: "2026-07-26T11:59:00.000Z",
        subjectType: "branch",
        subjectNumber: null,
        subjectTitle: null,
        refName: "feature/checkout",
        reviewState: null
      }
    ],
    ...overrides
  };
}

function githubTask(
  overrides: Partial<GitHubSnapshot["tasks"][number]> = {}
): GitHubSnapshot["tasks"][number] {
  return {
    id: 201,
    source: "github",
    kind: "assigned_issue",
    repositoryId: 101,
    repositoryFullName: "acme/app",
    number: 11,
    title: "Checkout fix",
    htmlUrl: "https://github.com/acme/app/issues/11",
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-26T11:50:00.000Z",
    ...overrides
  };
}

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli 0.150.0",
    fetchedAt: "2026-07-26T12:00:00.000Z",
    lookbackStart: "2026-06-26T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["111111111111111111111111"],
    sessions: [
      codexSession({
        id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        activityState: "active",
        attentionState: "waiting_on_approval"
      }),
      codexSession({
        id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        activityState: "system_error"
      }),
      codexSession({
        id: "cccccccccccccccccccccccc",
        activityState: "idle"
      }),
      codexSession({
        id: "dddddddddddddddddddddddd",
        activityState: "not_loaded"
      })
    ],
    ...overrides
  };
}

function codexSession(
  overrides: Partial<CodexSnapshot["sessions"][number]> = {}
): CodexSnapshot["sessions"][number] {
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    source: "codex",
    kind: "coding_session",
    scopeId: "111111111111111111111111",
    projectLabel: "blabase",
    taskSummary: null,
    taskSummarySource: null,
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-26T11:59:00.000Z",
    activityState: "active",
    attentionState: null,
    content: emptyCodexContentManifest(),
    ...overrides
  };
}
