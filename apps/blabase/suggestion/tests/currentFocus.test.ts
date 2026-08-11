import { describe, expect, it } from "vitest";

import {
  sealActiveAttentionResult,
  type ActiveAttentionCandidate,
  type ActiveAttentionResult
} from "../src/attentionDecision/contracts";
import { resolveActiveAttention } from "../src/attentionDecision/resolveActiveAttention";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type {
  GitHubPullRequestActionabilitySignal,
  GitHubSnapshot,
  GitHubTaskSignal,
  GitHubUserActivitySignal
} from "../src/connectors/github/types";
import {
  createClaimLineageRef,
  createNormalizedWorkClaim,
  resolveClaimAuthority,
  type ClaimAuthorityProjection,
  type NormalizedWorkClaim
} from "../src/claims";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import {
  RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION,
  RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
  SNAPSHOT_VALIDITY_POLICY_VERSION
} from "../src/crossSource/versions";
import { finalizeRuntimeWorkSignalBatch } from "../src/crossSource/workSignalIntegrity";
import {
  createCurrentFocusId,
  createConfirmedCurrentFocusInput,
  createCurrentWorkstreamId,
  currentFocusProjectionSchema,
  focusAwareAttentionShadowProjectionSchema,
  reconstructCurrentWorkStreams,
  resolveCurrentFocus,
  resolveCurrentFocusFromEvidence,
  resolveFocusAwareAttentionShadow,
  sealCurrentFocusProjection,
  type CurrentFocusProjection
} from "../src/currentFocus";
import {
  createFocusIdentityRef,
  createFocusSubjectRef,
  createFocusEvidenceRef,
  createRecentMeaningfulEventId,
  compareRecentMeaningfulEvents,
  projectRecentMeaningfulEvents,
  recentMeaningfulEventProjectionSchema,
  sealRecentMeaningfulEvent,
  sealRecentMeaningfulEventProjection,
  type RecentMeaningfulEvent,
  type RecentMeaningfulEventProjection
} from "../src/recentEvents";
import { resolveEmptyManagedWorkEvidence } from "../src/workEvidence/currentWorkEvidence";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_PROJECT_ID,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

const AS_OF = ACTIVE_FIXTURE_AS_OF;
const FETCHED_AT = "2026-08-02T02:59:00.000Z";
const PROJECT_A = ACTIVE_FIXTURE_PROJECT_ID;
const PROJECT_B = `project_${"9".repeat(32)}`;
const REPOSITORY = {
  id: 101,
  fullName: "synthetic/private"
} as const;

type EmptyManagedEvidence = ReturnType<
  typeof resolveEmptyManagedWorkEvidence
>;

describe("Recent Meaningful Events and Current Focus", () => {
  it("connects a GitHub native activity to its exact task WorkStream", () => {
    const batch = githubBatch({
      tasks: [githubTask()],
      activities: [
        githubActivity({
          id: "activity-open-501",
          activityKind: "issue_opened"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.recentMeaningfulEvents.events).toHaveLength(1);
    expect(result.currentWorkstreams.workstreams).toHaveLength(1);
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      level: "exact_task",
      projectId: PROJECT_A,
      totalEventCount: 1,
      currentness: "current",
      reconstructionConfidence: "high"
    });
    expect(result.currentFocus).toMatchObject({
      status: "selected",
      explicitFocusApplied: false,
      attentionSelectionEffect: "none",
      selectedFocus: {
        level: "exact_task",
        projectId: PROJECT_A
      }
    });
  });

  it("uses generic GitHub labels and never publishes source titles", () => {
    const batch = githubBatch({
      tasks: [githubTask({ title: "PRIVATE_GITHUB_TITLE_SENTINEL" })],
      activities: [
        githubActivity({
          subjectTitle: "PRIVATE_ACTIVITY_TITLE_SENTINEL"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);
    const serialized = JSON.stringify(result);

    expect(result.currentFocus.selectedFocus?.displayLabel).toBe(
      "GitHub issue #42"
    );
    expect(serialized).not.toContain("PRIVATE_GITHUB_TITLE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_ACTIVITY_TITLE_SENTINEL");
  });

  it("downgrades issue or pull-request activity without a native number to project scope", () => {
    const batch = githubBatch({
      activities: [
        githubActivity({
          subjectType: "issue",
          subjectNumber: null,
          subjectTitle: "PRIVATE_INCOMPLETE_IDENTITY_SENTINEL"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.recentMeaningfulEvents.events[0]).toMatchObject({
      identityScope: "project",
      displayLabel: "GitHub issue"
    });
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      level: "project",
      projectId: PROJECT_A
    });
    expect(JSON.stringify(result)).not.toContain(
      "PRIVATE_INCOMPLETE_IDENTITY_SENTINEL"
    );
  });

  it("records GitHub actionability as a proxy-time blocker and excludes generic updatedAt", () => {
    const actionability: GitHubPullRequestActionabilitySignal = {
      collectionState: "complete",
      draft: false,
      reviewDecision: "none",
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
      unresolvedChangeRequestCount: 0,
      requestedReviewerCount: 0,
      actionRequired: true,
      actionRequiredReasons: ["checks_failed"]
    };
    const batch = githubBatch({
      tasks: [
        githubTask({
          kind: "authored_pull_request",
          actionability
        }),
        githubTask({ id: 502, number: 43, title: "Poll-only task" })
      ]
    });
    const result = resolveGitHubFocus(batch);
    const blocker = result.recentMeaningfulEvents.events.find(
      (event) => event.kind === "github_ci_failed"
    );

    expect(blocker).toMatchObject({
      timeBasis: "source_updated_state_observation",
      semanticRole: "blocker",
      attentionCapability: "focus_selector",
      completeness: "complete",
      currentness: "current"
    });
    expect(
      result.recentMeaningfulEvents.diagnostics.some(
        (item) => item.reasonCode === "EXCLUDED_GENERIC_UPDATED_AT"
      )
    ).toBe(true);
    expect(result.currentFocus.selectedFocus?.activeBlocker).toBe(
      "ci_failed"
    );
  });

  it("does not promote complete actionability through globally partial GitHub activity coverage", () => {
    const actionability: GitHubPullRequestActionabilitySignal = {
      collectionState: "complete",
      draft: false,
      reviewDecision: "none",
      checksSummary: {
        collectionState: "complete",
        state: "failing",
        totalCount: 1,
        completedCount: 1,
        failedCount: 1,
        pendingCount: 0,
        truncated: false
      },
      mergeable: true,
      mergeConflict: false,
      unresolvedChangeRequestCount: 0,
      requestedReviewerCount: 0,
      actionRequired: true,
      actionRequiredReasons: ["checks_failed"]
    };
    const batch = githubBatch({
      tasks: [
        githubTask({
          kind: "authored_pull_request",
          actionability
        })
      ],
      activities: [],
      activitiesState: "unavailable"
    });
    const result = resolveGitHubFocus(batch);
    const event = result.recentMeaningfulEvents.events.find(
      (item) => item.kind === "github_ci_failed"
    );

    expect(batch.assessment).toMatchObject({
      freshness: "fresh",
      completeness: "partial"
    });
    expect(event).toMatchObject({
      currentness: "partial",
      attentionCapability: "historical_context_only"
    });
    expect(result.currentFocus.status).toBe("unresolved");
  });

  it("retains complete current actionability across newer managed progress but not from historical review activity alone", () => {
    const actionability: GitHubPullRequestActionabilitySignal = {
      collectionState: "complete",
      draft: false,
      reviewDecision: "none",
      checksSummary: {
        collectionState: "complete",
        state: "failing",
        totalCount: 1,
        completedCount: 1,
        failedCount: 1,
        pendingCount: 0,
        truncated: false
      },
      mergeable: true,
      mergeConflict: false,
      unresolvedChangeRequestCount: 0,
      requestedReviewerCount: 0,
      actionRequired: true,
      actionRequiredReasons: ["checks_failed"]
    };
    const managed = activeAttentionFixture({
      githubKind: "authored_pull_request",
      githubActionability: actionability,
      managedScenario: "completed",
      managedCompletedAt: "2026-08-02T02:59:30.000Z"
    });
    const managedResult = resolveCurrentFocusFromEvidence(
      activeFixtureRecentInput(managed)
    );
    expect(
      managedResult.currentWorkstreams.workstreams[0]?.latestMeaningfulEvent.kind
    ).toBe("codex_turn_completed");
    expect(
      managedResult.currentWorkstreams.workstreams[0]?.activeBlocker
    ).toBe("ci_failed");

    const historicalBatch = githubBatch({
      tasks: [githubTask({ kind: "review_requested_pull_request" })],
      activities: [
        githubActivity({
          activityKind: "pull_request_reviewed",
          subjectType: "pull_request",
          reviewState: "changes_requested"
        })
      ]
    });
    const historical = resolveGitHubFocus(historicalBatch);
    expect(
      historical.currentWorkstreams.workstreams[0]?.latestMeaningfulEvent.kind
    ).toBe("github_changes_requested");
    expect(historical.currentWorkstreams.workstreams[0]?.activeBlocker).toBe(
      "none"
    );
  });

  it("excludes comment-only GitHub activity outside the v0.1 allowlist", () => {
    const batch = githubBatch({
      tasks: [
        githubTask(),
        githubTask({
          id: 502,
          kind: "review_requested_pull_request",
          number: 43
        })
      ],
      activities: [
        githubActivity({
          id: "activity-comment-501",
          activityKind: "issue_commented"
        }),
        githubActivity({
          id: "activity-review-comment-502",
          activityKind: "pull_request_review_commented",
          subjectType: "pull_request",
          subjectNumber: 43
        })
      ]
    });
    const projection = projectRecentMeaningfulEvents(
      recentInput(resolveEmptyManagedWorkEvidence({
        asOf: AS_OF,
        githubBatch: batch,
        contextRegistry: null
      }))
    );

    expect(projection.events).toHaveLength(0);
    expect(
      projection.diagnostics.filter(
        (item) => item.reasonCode === "EXCLUDED_UNSUPPORTED_ACTIVITY_KIND"
      )
    ).toHaveLength(2);
  });

  it("separates identical titles and timestamps when native identities differ", () => {
    const occurredAt = "2026-08-02T02:58:00.000Z";
    const batch = githubBatch({
      tasks: [
        githubTask({ title: "Same title" }),
        githubTask({ id: 502, number: 43, title: "Same title" })
      ],
      activities: [
        githubActivity({ id: "activity-501", occurredAt }),
        githubActivity({
          id: "activity-502",
          subjectNumber: 43,
          occurredAt
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.currentWorkstreams.workstreams).toHaveLength(2);
    expect(
      new Set(
        result.currentWorkstreams.workstreams.map(
          (workstream) => workstream.workstreamId
        )
      ).size
    ).toBe(2);
    expect(result.currentFocus).toMatchObject({
      status: "unresolved",
      selectedFocus: null,
      reasonCodes: ["FOCUS_LATEST_EVENT_TIE"]
    });
  });

  it("creates only a project-level WorkStream from same-project repository activity", () => {
    const batch = githubBatch({
      activities: [
        githubActivity({
          id: "push-1",
          activityKind: "push",
          subjectType: "repository",
          subjectNumber: null,
          occurredAt: "2026-08-02T02:57:00.000Z"
        }),
        githubActivity({
          id: "push-2",
          activityKind: "push",
          subjectType: "repository",
          subjectNumber: null,
          occurredAt: "2026-08-02T02:58:00.000Z"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.currentWorkstreams.workstreams).toHaveLength(1);
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      level: "project",
      projectId: PROJECT_A,
      totalEventCount: 2,
      reconstructionConfidence: "medium"
    });
    expect(result.currentFocus).toMatchObject({
      status: "selected",
      selectedFocus: { level: "project", projectId: PROJECT_A },
      reasonCodes: [
        "FOCUS_LATEST_DIRECT_COMPLETE_EVENT",
        "FOCUS_PROJECT_LEVEL_ONLY"
      ]
    });
  });

  it("keeps Codex inventory historical-only even when it is newest", () => {
    const github = githubBatch({
      tasks: [githubTask()],
      activities: [
        githubActivity({ occurredAt: "2026-08-02T02:57:00.000Z" })
      ]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: github,
      contextRegistry: null
    });
    const result = resolveCurrentFocusFromEvidence({
      ...recentInput(evidence),
      codexInventoryBatch: codexInventoryBatch()
    });

    const inventory = result.recentMeaningfulEvents.events.find(
      (event) => event.source === "codex_inventory"
    );
    expect(inventory).toMatchObject({
      kind: "codex_project_activity",
      timeBasis: "inventory_updated_at",
      currentness: "historical_only",
      semanticRole: "historical_context",
      attentionCapability: "historical_context_only"
    });
    expect(result.currentFocus.selectedFocus?.latestMeaningfulEvent.source).toBe(
      "github"
    );
  });

  it("excludes repeated adjacent managed failure observations from the meaningful timeline", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "repeated_failed"
    });
    const projection = projectRecentMeaningfulEvents(
      activeFixtureRecentInput(fixture)
    );

    expect(
      projection.events.filter(
        (event) => event.kind === "codex_turn_failed"
      )
    ).toHaveLength(1);
    expect(
      projection.diagnostics.filter(
        (item) =>
          item.reasonCode === "EXCLUDED_REPEATED_ERROR_OBSERVATION"
      )
    ).toHaveLength(1);
    expect(
      projection.events.find(
        (event) => event.kind === "codex_turn_failed"
      )?.occurredAt
    ).toBe("2026-08-02T02:58:00.000Z");
  });

  it("retains the newest 1,000 meaningful events with explicit omission counts", () => {
    const activities = Array.from({ length: 1_005 }, (_, index) =>
      githubActivity({
        id: `bounded-push-${index}`,
        activityKind: "push",
        subjectType: "repository",
        subjectNumber: null,
        occurredAt: new Date(
          Date.parse("2026-08-01T00:00:00.000Z") + index * 1_000
        ).toISOString()
      })
    );
    const projection = projectRecentMeaningfulEvents(
      recentInput(
        resolveEmptyManagedWorkEvidence({
          asOf: AS_OF,
          githubBatch: githubBatch({ activities }),
          contextRegistry: null
        })
      )
    );

    expect(projection.events).toHaveLength(1_000);
    expect(projection.diagnostics).toHaveLength(1_005);
    expect(projection.counts).toMatchObject({
      omittedMeaningfulEventCount: 5,
      omittedDiagnosticCount: 0
    });
    expect(projection.events[0]?.occurredAt).toBe(
      activities.at(-1)?.occurredAt
    );
  });

  it("keeps unsupported Notion and Calendar records out of the event contract", () => {
    const event = syntheticRecentEvent({
      targetRef: `claim_subject_${"1".repeat(32)}`
    });
    expect(
      recentMeaningfulEventProjectionSchema.safeParse({
        source: "notion"
      }).success
    ).toBe(false);
    expect(
      recentMeaningfulEventProjectionSchema.safeParse({
        source: "google_calendar"
      }).success
    ).toBe(false);
    expect(JSON.stringify(event)).not.toMatch(/notion|google_calendar/i);
  });
});

describe("Current Focus quality, reconstruction, and determinism gates", () => {
  it("joins managed direct events to the exact GitHub WorkStream only through an active binding", () => {
    const fixture = activeAttentionFixture({ managedScenario: "running" });
    const result = resolveCurrentFocusFromEvidence(
      activeFixtureRecentInput(fixture)
    );

    expect(
      result.recentMeaningfulEvents.events.map((event) => event.kind)
    ).toEqual(
      expect.arrayContaining(["codex_run_started", "codex_turn_started"])
    );
    expect(
      result.recentMeaningfulEvents.events
        .filter((event) => event.source === "codex_managed")
        .every(
          (event) =>
            event.timeBasis === "collector_observed_at" &&
            event.occurredAt === event.observedAt &&
            event.sourceUpdatedAt === null
        )
    ).toBe(true);
    expect(
      result.recentMeaningfulEvents.diagnostics.some(
        (item) =>
          item.reasonCode === "EXCLUDED_HEARTBEAT_OR_STREAM_NOISE"
      )
    ).toBe(true);
    expect(result.currentWorkstreams.workstreams).toHaveLength(1);
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      level: "exact_task",
      projectId: PROJECT_A,
      relatedSources: ["codex_managed"],
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_EXACT_NATIVE_IDENTITY",
        "WORKSTREAM_EXPLICIT_WORK_RELATION",
        "WORKSTREAM_MANAGED_EXECUTION_IDENTITY"
      ])
    });
    expect(result.currentFocus.status).toBe("selected");
  });

  it.each([
    ["failed", "codex_turn_failed", "codex_failure"],
    ["completed", "codex_turn_completed", "none"]
  ] as const)(
    "projects a verified managed %s lifecycle without inventory inference",
    (managedScenario, latestKind, blocker) => {
      const fixture = activeAttentionFixture({ managedScenario });
      const result = resolveCurrentFocusFromEvidence(
        activeFixtureRecentInput(fixture)
      );

      expect(
        result.recentMeaningfulEvents.events.some(
          (event) => event.kind === latestKind
        )
      ).toBe(true);
      expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
        level: "exact_task",
        authoritativeState: "open",
        completionState: "active",
        currentness: "current",
        completeness: "complete",
        activeBlocker: blocker
      });
      expect(result.currentFocus.status).toBe("selected");
    }
  );

  it("keeps the WorkStream and explicit Focus identity stable from PR open to merge", () => {
    const open = resolveGitHubFocus(
      githubBatch({
        tasks: [githubTask({ kind: "authored_pull_request" })],
        activities: [
          githubActivity({
            id: "pr-open-42",
            activityKind: "pull_request_opened",
            subjectType: "pull_request",
            occurredAt: "2026-08-02T02:57:00.000Z"
          })
        ]
      })
    );
    const openWorkstreamId =
      open.currentWorkstreams.workstreams[0]?.workstreamId;
    expect(openWorkstreamId).toBeDefined();

    const mergedEvidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: githubBatch({
        tasks: [],
        activities: [
          githubActivity({
            id: "pr-merge-42",
            activityKind: "pull_request_merged",
            subjectType: "pull_request",
            occurredAt: "2026-08-02T02:59:00.000Z"
          })
        ]
      }),
      contextRegistry: null
    });
    const merged = resolveCurrentFocusFromEvidence(
      recentInput(mergedEvidence)
    );
    expect(merged.currentWorkstreams.workstreams[0]?.workstreamId).toBe(
      openWorkstreamId
    );
    const explicit = resolveCurrentFocus({
      asOf: AS_OF,
      recentEventProjection: merged.recentMeaningfulEvents,
      workstreamProjection: merged.currentWorkstreams,
      workRelationProjection: mergedEvidence.workRelations,
      artifactRelationProjection: mergedEvidence.artifacts,
      claimAuthorityProjection: mergedEvidence.claims,
      explicitFocus: createConfirmedCurrentFocusInput({
        workstreamId: openWorkstreamId!,
        confirmedAt: "2026-08-02T02:58:00.000Z",
        validUntil: "2026-08-03T02:58:00.000Z"
      })
    });
    expect(explicit).toMatchObject({
      status: "selected",
      explicitFocusApplied: true,
      selectedFocus: {
        workstreamId: openWorkstreamId,
        completionState: "completed"
      }
    });
  });

  it("treats a managed-only completion as execution completion, not task completion", () => {
    const fixture = activeAttentionFixture({
      githubKind: "none",
      managedScenario: "completed"
    });
    const result = resolveCurrentFocusFromEvidence(
      activeFixtureRecentInput(fixture)
    );

    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      authoritativeState: "completed",
      completionState: "execution_completed",
      activeBlocker: "none"
    });
  });

  it("retains a verified active artifact relation without exposing a commit SHA", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      artifactKind: "github_commit"
    });
    const result = resolveCurrentFocusFromEvidence(
      activeFixtureRecentInput(fixture)
    );
    const stream = result.currentWorkstreams.workstreams[0];
    const serialized = JSON.stringify(result);

    expect(stream?.reasonCodes).toContain(
      "WORKSTREAM_VERIFIED_ARTIFACT_RELATION"
    );
    expect(
      stream?.relationEvidenceRefs.some((ref) =>
        ref.startsWith("artifact_relation_")
      )
    ).toBe(true);
    expect(serialized).not.toContain("a".repeat(40));
    expect(serialized).not.toContain(fixture.privateCodexThreadSentinel);
    expect(serialized).not.toContain("codex:execution:");
  });

  it.each([
    ["stale", { fetchedAt: "2026-08-02T02:40:00.000Z", maxAgeMs: 60_000 }],
    ["partial", { truncated: true, activitiesState: "partial" as const }]
  ])("abstains on %s GitHub evidence instead of falling back", (_label, quality) => {
    const occurredAt =
      "fetchedAt" in quality
        ? "2026-08-02T02:39:00.000Z"
        : "2026-08-02T02:58:00.000Z";
    const batch = githubBatch({
      ...quality,
      tasks: [githubTask({ updatedAt: occurredAt })],
      activities: [githubActivity({ occurredAt })]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.currentFocus.status).toBe("unresolved");
    expect(result.currentFocus.selectedFocus).toBeNull();
    expect(result.currentFocus.reasonCodes).toEqual(
      expect.arrayContaining([
        _label === "stale" ? "FOCUS_SOURCE_STALE" : "FOCUS_SOURCE_PARTIAL"
      ])
    );
  });

  it.each(["gap", "pruned"] as const)(
    "abstains on managed %s evidence",
    (managedScenario) => {
      const fixture = activeAttentionFixture({ managedScenario });
      const result = resolveCurrentFocusFromEvidence(
        activeFixtureRecentInput(fixture)
      );

      expect(result.recentMeaningfulEvents.coverage.codexManaged).toBe(
        "partial"
      );
      expect(result.currentFocus.status).not.toBe("selected");
      expect(result.currentFocus.selectedFocus).toBeNull();
    }
  );

  it.each([
    ["github", "unavailable", "FOCUS_PROJECTION_UNAVAILABLE"],
    ["codexManaged", "partial", "FOCUS_SOURCE_PARTIAL"]
  ] as const)(
    "abstains when global %s direct-source coverage is %s",
    (source, coverage, reasonCode) => {
      const batch = githubBatch({
        tasks: [githubTask()],
        activities: [githubActivity()]
      });
      const evidence = resolveEmptyManagedWorkEvidence({
        asOf: AS_OF,
        githubBatch: batch,
        contextRegistry: null
      });
      const recent = projectRecentMeaningfulEvents(recentInput(evidence));
      const degraded = resealRecentProjection(recent, recent.events, {
        ...recent.coverage,
        [source]: coverage
      });
      const workstreams = reconstructCurrentWorkStreams({
        asOf: AS_OF,
        recentEventProjection: degraded,
        workRelationProjection: evidence.workRelations,
        artifactRelationProjection: evidence.artifacts,
        claimAuthorityProjection: evidence.claims
      });
      const focus = resolveCurrentFocus({
        asOf: AS_OF,
        recentEventProjection: degraded,
        workstreamProjection: workstreams,
        workRelationProjection: evidence.workRelations,
        artifactRelationProjection: evidence.artifacts,
        claimAuthorityProjection: evidence.claims
      });

      expect(focus).toMatchObject({
        status: "unresolved",
        selectedFocus: null,
        reasonCodes: [reasonCode]
      });
    }
  );

  it("does not derive an active blocker from a partial managed failure", () => {
    const fixture = activeAttentionFixture({ managedScenario: "failed_gap" });
    const result = resolveCurrentFocusFromEvidence(
      activeFixtureRecentInput(fixture)
    );
    const failedEvent = result.recentMeaningfulEvents.events.find(
      (event) => event.kind === "codex_turn_failed"
    );

    expect(failedEvent).toMatchObject({
      currentness: "partial",
      completeness: "partial",
      attentionCapability: "historical_context_only"
    });
    expect(result.currentWorkstreams.workstreams[0]?.activeBlocker).toBe(
      "none"
    );
  });

  it("is deterministic, collapses duplicates, and preserves the documented tie order", () => {
    const base = githubBatch({
      tasks: [githubTask()],
      activities: [githubActivity()]
    });
    const first = resolveGitHubFocus(base);
    const second = resolveGitHubFocus(base);
    expect(second).toEqual(first);

    const activity = base.signals.find(
      (signal) => signal.kind === "activity_observation"
    );
    expect(activity).toBeDefined();
    const duplicateBatch = resealBatch(base, [
      ...base.signals,
      activity!
    ]);
    const duplicate = resolveGitHubFocus(duplicateBatch);
    expect(duplicate.recentMeaningfulEvents.events).toHaveLength(1);
    expect(duplicate.recentMeaningfulEvents.counts.duplicate).toBe(1);
    expect(
      duplicate.recentMeaningfulEvents.diagnostics.some(
        (item) => item.reasonCode === "EXCLUDED_DUPLICATE_EVENT"
      )
    ).toBe(true);

    const permuted = resolveGitHubFocus(
      resealBatch(base, [...base.signals].reverse())
    );
    expect(
      permuted.recentMeaningfulEvents.events.map((event) => event.eventId)
    ).toEqual(
      first.recentMeaningfulEvents.events.map((event) => event.eventId)
    );
    expect(permuted.currentFocus.selectedFocus?.workstreamId).toBe(
      first.currentFocus.selectedFocus?.workstreamId
    );
  });

  it("uses the single latest event, not an additive plurality of older events", () => {
    const older = Array.from({ length: 7 }, (_, index) =>
      githubActivity({
        id: `old-${index}`,
        subjectNumber: 42,
        occurredAt: new Date(
          Date.parse("2026-08-02T02:40:00.000Z") + index * 1_000
        ).toISOString()
      })
    );
    const batch = githubBatch({
      tasks: [
        githubTask({ title: "Old plurality" }),
        githubTask({ id: 502, number: 43, title: "Single newest" })
      ],
      activities: [
        ...older,
        githubActivity({
          id: "newest",
          subjectNumber: 43,
          subjectTitle: "Single newest",
          occurredAt: "2026-08-02T02:58:00.000Z"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.currentWorkstreams.workstreams).toHaveLength(2);
    expect(result.currentFocus.selectedFocus?.displayLabel).toBe(
      "GitHub issue #43"
    );
  });

  it("lets an unexpired explicit confirmation win over implicit recency", () => {
    const batch = githubBatch({
      tasks: [
        githubTask({ title: "Older confirmed" }),
        githubTask({ id: 502, number: 43, title: "Newer implicit" })
      ],
      activities: [
        githubActivity({
          id: "older",
          occurredAt: "2026-08-02T02:56:00.000Z"
        }),
        githubActivity({
          id: "newer",
          subjectNumber: 43,
          occurredAt: "2026-08-02T02:58:00.000Z"
        })
      ]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    const implicit = resolveCurrentFocusFromEvidence(recentInput(evidence));
    const older = implicit.currentWorkstreams.workstreams.find(
      (workstream) => workstream.displayLabel === "GitHub issue #42"
    );
    expect(older).toBeDefined();
    const explicit = resolveCurrentFocus({
      asOf: AS_OF,
      recentEventProjection: implicit.recentMeaningfulEvents,
      workstreamProjection: implicit.currentWorkstreams,
      workRelationProjection: evidence.workRelations,
      artifactRelationProjection: evidence.artifacts,
      claimAuthorityProjection: evidence.claims,
      explicitFocus: createConfirmedCurrentFocusInput({
        workstreamId: older!.workstreamId,
        confirmedAt: "2026-08-02T02:59:00.000Z",
        validUntil: "2026-08-03T02:59:00.000Z"
      })
    });

    expect(explicit).toMatchObject({
      status: "selected",
      explicitFocusApplied: true,
      selectedFocus: { workstreamId: older!.workstreamId },
      reasonCodes: ["FOCUS_EXPLICIT_USER_CONFIRMATION"]
    });
  });

  it.each([
    ["pull_request_merged", "completed"],
    ["pull_request_closed", "cancelled"]
  ] as const)(
    "preserves terminal GitHub %s state without rewriting it as active",
    (activityKind, completionState) => {
      const batch = githubBatch({
        tasks: [],
        activities: [
          githubActivity({
            activityKind,
            subjectType: "pull_request"
          })
        ]
      });
      const result = resolveGitHubFocus(batch);

      expect(result.currentWorkstreams.workstreams[0]?.completionState).toBe(
        completionState
      );
      expect(result.currentFocus).toMatchObject({
        status: "selected",
        selectedFocus: {
          completionState,
          activeBlocker: "none"
        },
        attentionSelectionEffect: "none",
        forbiddenAsAttentionCandidate: true
      });
    }
  );

  it("preserves a terminal GitHub lifecycle across a newer related managed event", () => {
    const batch = githubBatch({
      tasks: [],
      activities: [
        githubActivity({
          activityKind: "pull_request_merged",
          subjectType: "pull_request",
          occurredAt: "2026-08-02T02:57:00.000Z"
        })
      ]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    const recent = projectRecentMeaningfulEvents(recentInput(evidence));
    const merged = recent.events[0]!;
    const managed = sealRecentMeaningfulEvent({
      contract: merged.contract,
      ruleVersion: merged.ruleVersion,
      idPolicyVersion: merged.idPolicyVersion,
      eventId: createRecentMeaningfulEventId({
        scenario: "managed-after-merge"
      }),
      source: "codex_managed",
      nativeSubjectRef: createFocusSubjectRef({
        scenario: "managed-after-merge"
      }),
      projectId: merged.projectId,
      identityScope: "exact_task",
      identityRefs: merged.identityRefs,
      claimTargetRefs: merged.claimTargetRefs,
      relationRefs: merged.relationRefs,
      kind: "codex_turn_started",
      occurredAt: "2026-08-02T02:59:00.000Z",
      observedAt: "2026-08-02T02:59:00.000Z",
      sourceUpdatedAt: null,
      timeBasis: "collector_observed_at",
      freshness: "current",
      completeness: "complete",
      currentness: "current",
      semanticRole: "meaningful_progress",
      attentionCapability: "focus_selector",
      displayLabel: "Managed Codex work",
      evidenceRef: createFocusEvidenceRef({
        scenario: "managed-after-merge"
      }),
      sourceSnapshotSha256:
        evidence.managedSemantics.projectionSha256,
      sourceBatchSha256: null,
      normalizerVersion: evidence.managedSemantics.ruleVersion,
      reasonCodes: ["INCLUDED_MEANINGFUL_DIRECT_EVENT"]
    });
    const augmented = resealRecentProjection(recent, [managed, merged]);
    const workstreams = reconstructCurrentWorkStreams({
      asOf: AS_OF,
      recentEventProjection: augmented,
      workRelationProjection: evidence.workRelations,
      artifactRelationProjection: evidence.artifacts,
      claimAuthorityProjection: evidence.claims
    });

    expect(workstreams.workstreams[0]).toMatchObject({
      latestMeaningfulEvent: { kind: "codex_turn_started" },
      authoritativeState: "completed",
      completionState: "completed",
      activeBlocker: "none",
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_TERMINAL_STATE_PRESERVED"
      ])
    });
  });

  it("abstains when a latest terminal event conflicts with current open authority", () => {
    const batch = githubBatch({
      tasks: [githubTask({ kind: "review_requested_pull_request" })],
      activities: [
        githubActivity({
          activityKind: "pull_request_merged",
          subjectType: "pull_request"
        })
      ]
    });
    const result = resolveGitHubFocus(batch);

    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      authoritativeState: "conflict",
      completionState: "unknown",
      currentness: "conflict",
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_AUTHORITATIVE_STATE_CONFLICT"
      ])
    });
    expect(result.currentFocus).toMatchObject({
      status: "unresolved",
      selectedFocus: null,
      reasonCodes: ["FOCUS_AUTHORITY_CONFLICT"]
    });
  });

  it("preserves a current terminal authority claim and abstains on equal-authority conflict", () => {
    const batch = githubBatch({
      tasks: [githubTask()],
      activities: [githubActivity({ activityKind: "issue_reopened" })]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    const completedClaims = replaceGitHubStateClaim(
      evidence.claims,
      "completed"
    );
    const completed = resolveCurrentFocusFromEvidence({
      ...recentInput(evidence),
      claimAuthorityProjection: completedClaims
    });
    expect(completed.currentWorkstreams.workstreams[0]).toMatchObject({
      authoritativeState: "completed",
      completionState: "completed",
      activeBlocker: "none",
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_TERMINAL_STATE_PRESERVED"
      ])
    });
    expect(completed.currentFocus.selectedFocus).toMatchObject({
      authoritativeState: "completed",
      completionState: "completed"
    });

    const conflictingClaims = addConflictingGitHubStateClaim(
      evidence.claims,
      "completed"
    );
    const conflicted = resolveCurrentFocusFromEvidence({
      ...recentInput(evidence),
      claimAuthorityProjection: conflictingClaims
    });
    expect(conflicted.currentWorkstreams.workstreams[0]).toMatchObject({
      authoritativeState: "conflict",
      currentness: "conflict"
    });
    expect(conflicted.currentFocus).toMatchObject({
      status: "unresolved",
      selectedFocus: null,
      reasonCodes: ["FOCUS_AUTHORITY_CONFLICT"]
    });
  });

  it("keeps a WorkStream ID stable when relation identity evidence is enriched", () => {
    const batch = githubBatch({
      tasks: [githubTask()],
      activities: [githubActivity()]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    const recent = projectRecentMeaningfulEvents(recentInput(evidence));
    const baseline = reconstructCurrentWorkStreams({
      asOf: AS_OF,
      recentEventProjection: recent,
      workRelationProjection: evidence.workRelations,
      artifactRelationProjection: evidence.artifacts,
      claimAuthorityProjection: evidence.claims
    });
    const event = recent.events[0]!;
    const { eventSha256: _eventSha256, ...eventContent } = event;
    const enrichedEvent = sealRecentMeaningfulEvent({
      ...eventContent,
      identityRefs: [
        ...event.identityRefs,
        createFocusIdentityRef({ relationRef: `relation_${"a".repeat(32)}` })
      ].sort()
    });
    const enrichedProjection = resealRecentProjection(recent, [enrichedEvent]);
    const enriched = reconstructCurrentWorkStreams({
      asOf: AS_OF,
      recentEventProjection: enrichedProjection,
      workRelationProjection: evidence.workRelations,
      artifactRelationProjection: evidence.artifacts,
      claimAuthorityProjection: evidence.claims
    });

    expect(enriched.workstreams[0]?.workstreamId).toBe(
      baseline.workstreams[0]?.workstreamId
    );
  });

  it("rejects mismatched asOf/dependency hashes and schema-valid batch tampering", () => {
    const batch = githubBatch({
      tasks: [githubTask()],
      activities: [githubActivity()]
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    const input = recentInput(evidence);
    const valid = projectRecentMeaningfulEvents(input);

    expect(() =>
      projectRecentMeaningfulEvents({
        ...input,
        asOf: "2026-08-02T03:00:01.000Z"
      })
    ).toThrow();
    expect(() =>
      projectRecentMeaningfulEvents({
        ...input,
        contextRegistrySha256: "f".repeat(64)
      })
    ).toThrow();
    expect(
      recentMeaningfulEventProjectionSchema.safeParse({
        ...valid,
        projectionSha256: "0".repeat(64)
      }).success
    ).toBe(false);

    const tamperedBatch = {
      ...batch,
      signals: batch.signals.map((signal) =>
        signal.kind === "work_item_observation"
          ? {
              ...signal,
              facts: { ...signal.facts, title: "tampered-title" }
            }
          : signal
      )
    } as RuntimeWorkSignalBatch;
    expect(() =>
      projectRecentMeaningfulEvents({
        ...input,
        githubBatch: tamperedBatch
      })
    ).toThrow();
  });

  it("fails closed on rehashed unsupported source schemas and freshness policy versions", () => {
    const batch = githubBatch({
      tasks: [githubTask()],
      activities: [githubActivity()]
    });
    const {
      batchSha256: _githubBatchSha256,
      signalCount: _githubSignalCount,
      ...githubDraft
    } = batch;
    const unsupportedGitHub = finalizeRuntimeWorkSignalBatch({
      ...githubDraft,
      sourceSchemaVersion: "github-snapshot-v999"
    });
    const unsupportedGitHubEvidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: unsupportedGitHub,
      contextRegistry: null
    });
    expect(() =>
      projectRecentMeaningfulEvents(
        recentInput(unsupportedGitHubEvidence)
      )
    ).toThrow(/source batch is not request-time exact/);

    const unsupportedPolicy = finalizeRuntimeWorkSignalBatch({
      ...githubDraft,
      assessment: {
        ...githubDraft.assessment,
        freshnessPolicyVersion: "unsupported-policy-v999"
      }
    });
    const unsupportedPolicyEvidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: unsupportedPolicy,
      contextRegistry: null
    });
    expect(() =>
      projectRecentMeaningfulEvents(
        recentInput(unsupportedPolicyEvidence)
      )
    ).toThrow(/source batch is not request-time exact/);

    const codex = codexInventoryBatch();
    const {
      batchSha256: _codexBatchSha256,
      signalCount: _codexSignalCount,
      ...codexDraft
    } = codex;
    const unsupportedCodex = finalizeRuntimeWorkSignalBatch({
      ...codexDraft,
      sourceSchemaVersion: "codex-snapshot-v2"
    });
    const evidence = resolveEmptyManagedWorkEvidence({
      asOf: AS_OF,
      githubBatch: batch,
      contextRegistry: null
    });
    expect(() =>
      projectRecentMeaningfulEvents(
        recentInput(evidence, unsupportedCodex)
      )
    ).toThrow(/source batch is not request-time exact/);
  });
});

describe("focus-aware Active Attention shadow ranking", () => {
  it("counterfactually promotes an exact focus match inside one safety tier without mutating Active Attention", () => {
    const fixture = activeAttentionFixture({
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Exact focused candidate"
        }
      ]
    });
    const active = resolveActiveAttention(fixture.input);
    expect(active.rankedCandidates.length).toBeGreaterThanOrEqual(2);
    const focusedCandidate = active.rankedCandidates[1]!;
    const focus = syntheticSelectedFocus(focusedCandidate, {
      level: "exact_task",
      projectId: focusedCandidate.projectId
    }, active);
    const before = JSON.stringify(active);
    const shadow = resolveShadow(active, focus);

    expect(shadow).toMatchObject({
      status: "evaluated",
      existingTopCandidateId: active.rankedCandidates[0]!.candidateId,
      counterfactualTopCandidateId: focusedCandidate.candidateId,
      wouldSwitch: true,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      attentionSelectionEffect: "none"
    });
    expect(
      shadow.matches.find(
        (match) => match.candidateId === focusedCandidate.candidateId
      )
    ).toMatchObject({ match: "exact", counterfactualRank: 1 });
    expect(JSON.stringify(active)).toBe(before);
    expect(active.resultSha256).toBe(
      JSON.parse(before).resultSha256 as string
    );
  });

  it("uses exact project identity as a weaker match than exact task identity", () => {
    const fixture = activeAttentionFixture({
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Project focused candidate"
        }
      ]
    });
    const original = resolveActiveAttention(fixture.input);
    const active = withCandidateProjects(original, [PROJECT_A, PROJECT_B]);
    const focusedCandidate = active.rankedCandidates[1]!;
    const focus = syntheticSelectedFocus(focusedCandidate, {
      level: "project",
      projectId: PROJECT_B
    }, active);
    const shadow = resolveShadow(active, focus);

    expect(shadow.counterfactualTopCandidateId).toBe(
      focusedCandidate.candidateId
    );
    expect(
      shadow.matches.find(
        (match) => match.candidateId === focusedCandidate.candidateId
      )?.match
    ).toBe("project");
    expect(shadow.reasonCodes).toContain("SHADOW_PROJECT_FOCUS_MATCH");
  });

  it("never crosses lane/deadline/blocker safety tiers or changes the candidate universe", () => {
    const fixture = activeAttentionFixture({
      deadlineAt: "2026-08-02T02:30:00.000Z",
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Lower safety tier focus"
        }
      ]
    });
    const active = resolveActiveAttention(fixture.input);
    expect(active.rankedCandidates[0]?.lane).toBe("must_now");
    const lower = active.rankedCandidates.find(
      (candidate) => candidate.lane !== "must_now"
    );
    expect(lower).toBeDefined();
    const focus = syntheticSelectedFocus(lower!, {
      level: "exact_task",
      projectId: lower!.projectId
    }, active);
    const shadow = resolveShadow(active, focus);
    const serialized = JSON.stringify({ focus, shadow });

    expect(shadow).toMatchObject({
      existingTopCandidateId: active.rankedCandidates[0]!.candidateId,
      counterfactualTopCandidateId:
        active.rankedCandidates[0]!.candidateId,
      wouldSwitch: false,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      attentionSelectionEffect: "none"
    });
    expect(shadow.matches.map((match) => match.candidateId).sort()).toEqual(
      active.rankedCandidates.map((candidate) => candidate.candidateId).sort()
    );
    expect(serialized).not.toMatch(
      /PRIVATE_CODEX_THREAD|raw command|\/Users\/|Bearer |token_[A-Za-z0-9]/
    );
    expect(
      focusAwareAttentionShadowProjectionSchema.safeParse({
        ...shadow,
        wouldSwitch: true
      }).success
    ).toBe(false);
    expect(
      currentFocusProjectionSchema.safeParse({
        ...focus,
        selectedFocus: {
          ...focus.selectedFocus!,
          displayLabel: "tampered"
        }
      }).success
    ).toBe(false);
  });

  it("reports complete shadow audit coverage when more than 100 candidates exist", () => {
    const fixture = activeAttentionFixture({
      additionalGitHubTasks: Array.from({ length: 104 }, (_, index) => ({
        id: 1_000 + index,
        kind: "assigned_issue" as const,
        number: 1_000 + index,
        title: `Bounded candidate ${index}`
      }))
    });
    const active = resolveActiveAttention(fixture.input);
    expect(active.rankedCandidates).toHaveLength(105);
    const focus = syntheticSelectedFocus(
      active.rankedCandidates.at(-1)!,
      {
        level: "exact_task",
        projectId: active.rankedCandidates.at(-1)!.projectId
      },
      active
    );
    const shadow = resolveShadow(active, focus);

    expect(shadow.matches).toHaveLength(100);
    expect(shadow).toMatchObject({
      totalMatchCount: 105,
      omittedMatchCount: 5,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      attentionSelectionEffect: "none"
    });
  });
});

function resolveShadow(
  active: ActiveAttentionResult,
  focus: CurrentFocusProjection
) {
  return resolveFocusAwareAttentionShadow({
    asOf: active.asOf,
    currentFocus: focus,
    activeAttentionResult: active,
    eligibilityProjectionSha256:
      active.dependencies.eligibilityProjectionSha256,
    workRelationProjectionSha256:
      active.dependencies.workRelationProjectionSha256,
    claimAuthorityProjectionSha256:
      active.dependencies.claimAuthorityProjectionSha256
  });
}

function syntheticSelectedFocus(
  candidate: ActiveAttentionCandidate,
  input: {
    level: "exact_task" | "project";
    projectId: string | null;
  },
  active: ActiveAttentionResult
): CurrentFocusProjection {
  const targetRef = candidate.targetRef;
  const identityRef = createFocusIdentityRef(
    input.level === "exact_task"
      ? { targetRef }
      : { scope: "project_workstream", projectId: input.projectId }
  );
  const workstreamId = createCurrentWorkstreamId(identityRef);
  const event = syntheticRecentEvent({
    targetRef,
    projectId: input.projectId,
    identityScope: input.level,
    includeTargetRef: input.level === "exact_task"
  });
  const dependencies = {
    recentEventProjectionSha256: runtimeSha256({ synthetic: "recent" }),
    workstreamProjectionSha256: runtimeSha256({ synthetic: "streams" }),
    workRelationProjectionSha256:
      active.dependencies.workRelationProjectionSha256,
    artifactRelationProjectionSha256:
      active.dependencies.artifactRelationProjectionSha256,
    claimAuthorityProjectionSha256:
      active.dependencies.claimAuthorityProjectionSha256
  };
  return sealCurrentFocusProjection({
    contract: "current-focus-projection-v0.1",
    schemaVersion: "current-focus-schema-v0.1",
    selectionPolicyVersion: "recent-direct-current-focus-policy-v0.2",
    idPolicyVersion: "current-focus-id-v0.1",
    rolloutVersion: "current-focus-shadow-rollout-v0.1",
    asOf: AS_OF,
    recentWindowMs: 7 * 24 * 60 * 60 * 1_000,
    dependencies,
    inputSha256: runtimeSha256({
      domain: "synthetic-current-focus-input-v0.1",
      workstreamId,
      eventId: event.eventId
    }),
    status: "selected",
    selectedFocus: {
      focusId: createCurrentFocusId({
        workstreamId,
        latestEventId: event.eventId
      }),
      workstreamId,
      projectId: input.projectId,
      level: input.level,
      displayLabel: "Synthetic public focus",
      identityRefs: [identityRef],
      latestMeaningfulEvent: event,
      authoritativeState: "open",
      activeBlocker: "none",
      owner: "user",
      completionState: "active",
      currentness: "current",
      completeness: "complete",
      reconstructionConfidence:
        input.level === "exact_task" ? "high" : "medium"
    },
    reasonCodes:
      input.level === "project"
        ? [
            "FOCUS_LATEST_DIRECT_COMPLETE_EVENT",
            "FOCUS_PROJECT_LEVEL_ONLY"
          ]
        : ["FOCUS_LATEST_DIRECT_COMPLETE_EVENT"],
    explicitFocusApplied: false,
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

function withCandidateProjects(
  result: ActiveAttentionResult,
  projectIds: string[]
): ActiveAttentionResult {
  const rankedCandidates = result.rankedCandidates.map(
    (candidate, index) => ({
      ...candidate,
      projectId: projectIds[index] ?? candidate.projectId
    })
  );
  const byId = new Map(
    rankedCandidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const { resultSha256: _resultSha256, ...content } = result;
  return sealActiveAttentionResult({
    ...content,
    rankedCandidates,
    decision: {
      ...content.decision,
      topSuggestion: content.decision.topSuggestion
        ? byId.get(content.decision.topSuggestion.candidateId) ?? null
        : null,
      alternatives: content.decision.alternatives.map(
        (candidate) => byId.get(candidate.candidateId) ?? candidate
      )
    }
  });
}

function githubBatch(input: {
  tasks?: GitHubTaskSignal[];
  activities?: GitHubUserActivitySignal[];
  fetchedAt?: string;
  truncated?: boolean;
  activitiesState?: "available" | "partial" | "unavailable";
  maxAgeMs?: number;
} = {}): RuntimeWorkSignalBatch {
  const tasks = input.tasks ?? [];
  const activities = input.activities ?? [];
  const fetchedAt = input.fetchedAt ?? FETCHED_AT;
  const authored = tasks.filter(
    (task) => task.kind === "authored_pull_request"
  );
  const actionabilityCollected = authored.filter(
    (task) => task.actionability !== undefined
  );
  const v3 = actionabilityCollected.length > 0;
  const repositoryRecords = new Map<number, string>([
    [REPOSITORY.id, REPOSITORY.fullName]
  ]);
  for (const record of [...tasks, ...activities]) {
    repositoryRecords.set(record.repositoryId, record.repositoryFullName);
  }
  const snapshot: GitHubSnapshot = {
    schemaVersion: v3 ? "github-snapshot-v3" : "github-snapshot-v2",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt,
    user: { id: 1, login: "synthetic" },
    truncated: input.truncated ?? false,
    activityWindowStart: "2026-07-01T00:00:00.000Z",
    activitiesState: input.activitiesState ?? "available",
    activitiesTruncated:
      (input.truncated ?? false) || input.activitiesState === "partial",
    ...(v3
      ? {
          actionabilityCoverage: {
            state:
              actionabilityCollected.length === authored.length &&
              actionabilityCollected.every(
                (task) =>
                  task.actionability?.collectionState === "complete"
              )
                ? ("complete" as const)
                : ("partial" as const),
            authoredPullRequestCount: authored.length,
            attemptedCount: authored.length,
            collectedCount: actionabilityCollected.length,
            truncated: false
          }
        }
      : {}),
    installations: [
      {
        id: 1,
        accountLogin: "synthetic",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [...repositoryRecords].map(([id, fullName]) => ({
      id,
      source: "github" as const,
      kind: "repository" as const,
      installationId: 1,
      fullName,
      private: true,
      archived: false,
      updatedAt: fetchedAt
    })),
    tasks,
    activities
  };
  const normalized = normalizeGitHubSnapshotToWorkSignals(snapshot, {
    asOf: AS_OF,
    freshnessPolicy: {
      version: SNAPSHOT_VALIDITY_POLICY_VERSION,
      maxAgeMsBySource: {
        github: input.maxAgeMs ?? 10 * 60 * 1_000,
        codex: 10 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60_000
    },
    contextRegistrySha256: null,
    resolveProjectId: (sourceScopeId) =>
      sourceScopeId === `repository:${REPOSITORY.id}`
        ? PROJECT_A
        : sourceScopeId === "repository:202"
          ? PROJECT_B
          : null
  });
  if (normalized.status !== "normalized") {
    throw new TypeError("Synthetic GitHub snapshot did not normalize.");
  }
  return normalized.batch;
}

function activeFixtureRecentInput(
  fixture: ReturnType<typeof activeAttentionFixture>
) {
  return {
    asOf: AS_OF,
    githubBatch: fixture.githubBatch,
    codexInventoryBatch: null,
    managedPublicProjection: fixture.managedPublicProjection,
    managedSemanticProjection: fixture.managedSemanticProjection,
    managedRunStartedAtById: fixture.input.managedRunStartedAtById,
    workRelationProjection: fixture.workRelations,
    artifactRelationProjection: fixture.artifacts,
    claimAuthorityProjection: fixture.claims,
    contextRegistrySha256: fixture.workRelations.contextRegistrySha256
  };
}

function resealBatch(
  batch: RuntimeWorkSignalBatch,
  signals: RuntimeWorkSignalBatch["signals"]
): RuntimeWorkSignalBatch {
  const {
    batchSha256: _batchSha256,
    signalCount: _signalCount,
    ...draft
  } = batch;
  return finalizeRuntimeWorkSignalBatch({ ...draft, signals });
}

function resealRecentProjection(
  projection: RecentMeaningfulEventProjection,
  events: RecentMeaningfulEvent[],
  coverage: RecentMeaningfulEventProjection["coverage"] = projection.coverage
): RecentMeaningfulEventProjection {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  const orderedEvents = [...events].sort(compareRecentMeaningfulEvents);
  return sealRecentMeaningfulEventProjection({
    ...content,
    coverage,
    events: orderedEvents,
    counts: {
      ...content.counts,
      included: orderedEvents.filter(
        (event) => event.attentionCapability === "focus_selector"
      ).length,
      contextOnly: orderedEvents.filter(
        (event) => event.attentionCapability === "historical_context_only"
      ).length
    }
  });
}

function githubTask(
  overrides: Partial<GitHubTaskSignal> = {}
): GitHubTaskSignal {
  const kind = overrides.kind ?? "assigned_issue";
  const repositoryFullName =
    overrides.repositoryFullName ?? REPOSITORY.fullName;
  const number = overrides.number ?? 42;
  return {
    id: 501,
    source: "github",
    kind,
    repositoryId: REPOSITORY.id,
    repositoryFullName,
    number,
    title: "Synthetic task",
    htmlUrl:
      kind === "assigned_issue"
        ? `https://github.com/${repositoryFullName}/issues/${number}`
        : `https://github.com/${repositoryFullName}/pull/${number}`,
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: FETCHED_AT,
    ...overrides
  };
}

function githubActivity(
  overrides: Partial<GitHubUserActivitySignal> = {}
): GitHubUserActivitySignal {
  return {
    id: "activity-501",
    source: "github",
    kind: "user_activity",
    activityKind: "issue_opened",
    repositoryId: REPOSITORY.id,
    repositoryFullName: REPOSITORY.fullName,
    occurredAt: "2026-08-02T02:58:00.000Z",
    subjectType: "issue",
    subjectNumber: 42,
    subjectTitle: "Synthetic task",
    refName: null,
    reviewState: null,
    ...overrides
  };
}

function codexInventoryBatch(): RuntimeWorkSignalBatch {
  const snapshot: CodexSnapshot = {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli test",
    fetchedAt: FETCHED_AT,
    lookbackStart: "2026-07-01T00:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["1".repeat(24)],
    sessions: [
      {
        id: "a".repeat(24),
        source: "codex",
        kind: "coding_session",
        scopeId: "1".repeat(24),
        projectLabel: "private-project-label",
        taskSummary: null,
        taskSummarySource: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T02:59:00.000Z",
        activityState: "active",
        attentionState: "waiting_on_approval",
        content: emptyCodexContentManifest()
      }
    ]
  };
  const normalized = normalizeCodexSnapshotToWorkSignals(snapshot, {
    asOf: AS_OF,
    freshnessPolicy: {
      version: SNAPSHOT_VALIDITY_POLICY_VERSION,
      maxAgeMsBySource: {
        github: 10 * 60 * 1_000,
        codex: 10 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60_000
    },
    contextRegistrySha256: null,
    resolveProjectId: () => PROJECT_A
  });
  if (normalized.status !== "normalized") {
    throw new TypeError("Synthetic Codex snapshot did not normalize.");
  }
  return normalized.batch;
}

function recentInput(
  evidence: EmptyManagedEvidence,
  codexInventoryBatch: RuntimeWorkSignalBatch | null = null
) {
  return {
    asOf: evidence.asOf,
    githubBatch: evidence.githubBatch,
    codexInventoryBatch,
    managedPublicProjection: evidence.managedProjection,
    managedSemanticProjection: evidence.managedSemantics,
    managedRunStartedAtById: evidence.managedRunStartedAtById,
    workRelationProjection: evidence.workRelations,
    artifactRelationProjection: evidence.artifacts,
    claimAuthorityProjection: evidence.claims,
    contextRegistrySha256: evidence.contextRegistry?.registrySha256 ?? null
  };
}

function resolveGitHubFocus(batch: RuntimeWorkSignalBatch) {
  const evidence = resolveEmptyManagedWorkEvidence({
    asOf: AS_OF,
    githubBatch: batch,
    contextRegistry: null
  });
  return resolveCurrentFocusFromEvidence(recentInput(evidence));
}

function replaceGitHubStateClaim(
  projection: ClaimAuthorityProjection,
  value: "completed" | "cancelled"
): ClaimAuthorityProjection {
  const original = githubStateClaim(projection);
  return rebuildClaims(projection, [
    ...projection.claims.filter((claim) => claim.claimId !== original.claimId),
    copiedStateClaim(original, value, original.lineageRef)
  ]);
}

function addConflictingGitHubStateClaim(
  projection: ClaimAuthorityProjection,
  value: "completed" | "cancelled"
): ClaimAuthorityProjection {
  const original = githubStateClaim(projection);
  return rebuildClaims(projection, [
    ...projection.claims,
    copiedStateClaim(
      original,
      value,
      createClaimLineageRef({
        source: "github",
        syntheticConflict: original.claimId
      })
    )
  ]);
}

function githubStateClaim(
  projection: ClaimAuthorityProjection
): NormalizedWorkClaim {
  const claim = projection.claims.find(
    (candidate) => candidate.field === "github_work_item_state"
  );
  if (!claim) throw new TypeError("Synthetic GitHub state claim is missing.");
  return claim;
}

function copiedStateClaim(
  original: NormalizedWorkClaim,
  value: "completed" | "cancelled",
  lineageRef: string
): NormalizedWorkClaim {
  return createNormalizedWorkClaim({
    target: original.target,
    lineageRef,
    field: "github_work_item_state",
    value: { type: "enum", value },
    source: "github",
    origin: "github_normalized_snapshot",
    freshness: "current",
    completeness: "complete",
    directness: "explicit",
    observedAt: original.observedAt,
    sourceUpdatedAt: original.sourceUpdatedAt,
    evidenceRefs: original.evidenceRefs,
    relationRefs: original.relationRefs
  });
}

function rebuildClaims(
  projection: ClaimAuthorityProjection,
  claims: NormalizedWorkClaim[]
): ClaimAuthorityProjection {
  return resolveClaimAuthority({
    asOf: projection.asOf,
    dependencies: projection.inputs,
    sourceCoverage: projection.sourceCoverage,
    claims
  });
}

function syntheticRecentEvent(input: {
  targetRef: string;
  projectId?: string | null;
  occurredAt?: string;
  identityScope?: "exact_task" | "project";
  includeTargetRef?: boolean;
}) {
  const identityScope = input.identityScope ?? "exact_task";
  const identityRef = createFocusIdentityRef(
    identityScope === "exact_task"
      ? { targetRef: input.targetRef }
      : {
          scope: "project_workstream",
          projectId: input.projectId ?? PROJECT_A
        }
  );
  const eventId = createRecentMeaningfulEventId({
    targetRef: input.targetRef,
    occurredAt: input.occurredAt ?? "2026-08-02T02:58:00.000Z"
  });
  return sealRecentMeaningfulEvent({
    contract: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    eventId,
    source: "github",
    nativeSubjectRef: createFocusSubjectRef({ targetRef: input.targetRef }),
    projectId: input.projectId ?? PROJECT_A,
    identityScope,
    identityRefs: [identityRef],
    claimTargetRefs:
      input.includeTargetRef === false ? [] : [input.targetRef],
    relationRefs: [],
    kind: "github_issue_opened",
    occurredAt: input.occurredAt ?? "2026-08-02T02:58:00.000Z",
    observedAt: FETCHED_AT,
    sourceUpdatedAt: input.occurredAt ?? "2026-08-02T02:58:00.000Z",
    timeBasis: "source_occurred_at",
    freshness: "current",
    completeness: "complete",
    currentness: "current",
    semanticRole: "meaningful_progress",
    attentionCapability: "focus_selector",
    displayLabel: "Synthetic public label",
    evidenceRef: createFocusEvidenceRef({ eventId }),
    sourceSnapshotSha256: runtimeSha256({ snapshot: eventId }),
    sourceBatchSha256: runtimeSha256({ batch: eventId }),
    normalizerVersion: "synthetic-test-normalizer-v0.1",
    reasonCodes: ["INCLUDED_MEANINGFUL_DIRECT_EVENT"]
  });
}
