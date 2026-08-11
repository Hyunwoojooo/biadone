import { describe, expect, it } from "vitest";

import {
  sealCodexLocalGitSnapshot,
  type CodexLocalGitSnapshot
} from "../src/connectors/codex/localGitContracts";
import type { ConfirmedRepositoryScopeLinkResolution } from "../src/context";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import type { CurrentFocusProjection } from "../src/currentFocus";
import { createRecentMeaningfulEventId } from "../src/recentEvents";
import {
  projectRecentWorkPublicSummary,
  recentWorkMatchSchema,
  recentWorkPublicSummarySchema,
  resolveRecentWork,
  resolveRecentWorkPresentationMode
} from "../src/recentWork";
import { resolveActiveAttention } from "../src/attentionDecision";
import {
  activeAttentionFixture,
  ACTIVE_FIXTURE_PROJECT_ID
} from "./fixtures/activeAttentionFixture";

const AS_OF = "2026-08-09T12:00:00.000Z";
const PUSH_AT = "2026-08-09T11:00:00.000Z";
const SCOPE_ID = "b".repeat(24);
const PROJECT_ID = `project_${"1".repeat(32)}`;

describe("Recent Work sidecar", () => {
  it("matches exact current evidence deterministically and exposes only a bounded summary", () => {
    const input = exactInput();
    const first = resolveRecentWork(input);
    const second = resolveRecentWork(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "matched",
      reasonCodes: ["RECENT_WORK_MATCHED"],
      match: {
        displayLabel: "Private recent work",
        pushOccurredAt: PUSH_AT,
        trackingState: "ahead",
        aheadCount: 2,
        behindCount: 0,
        correlation: "repository_scope_only"
      },
      attentionSelectionEffect: "none",
      candidateEligibilityEffect: "none",
      rankingEffect: "none",
      executionEffect: "none"
    });
    expect(projectRecentWorkPublicSummary(first, "shadow")).toBeNull();
    const summary = projectRecentWorkPublicSummary(first, "present");
    expect(summary).toEqual({
      displayLabel: "Private recent work",
      pushOccurredAt: PUSH_AT,
      trackingState: "ahead",
      aheadCount: 2,
      behindCount: 0,
      correlation: "repository_scope_only",
      presentation: "display_only",
      attentionSelectionEffect: "none",
      executionEffect: "none"
    });
    const serialized = JSON.stringify(summary);
    for (const forbidden of [
      PROJECT_ID,
      SCOPE_ID,
      "repository_scope_link_",
      "local_repo_",
      "local_commit_",
      "github_repo_",
      "/Users/private",
      "refs/heads/private",
      "github.com/private",
      "PRIVATE_THREAD"
    ]) {
    expect(serialized).not.toContain(forbidden);
    }
  expect(() =>
    recentWorkPublicSummarySchema.parse({
      ...summary!,
      aheadCount: null
    })
  ).toThrow();

  const invalidTrackingCounts = [
    { trackingState: "in_sync", aheadCount: 1, behindCount: 0 },
    { trackingState: "in_sync", aheadCount: 0, behindCount: 1 },
    { trackingState: "ahead", aheadCount: 0, behindCount: 0 },
    { trackingState: "ahead", aheadCount: 1, behindCount: 1 },
    { trackingState: "behind", aheadCount: 0, behindCount: 0 },
    { trackingState: "behind", aheadCount: 1, behindCount: 1 },
    { trackingState: "diverged", aheadCount: 0, behindCount: 1 },
    { trackingState: "diverged", aheadCount: 1, behindCount: 0 },
    { trackingState: "not_configured", aheadCount: 0, behindCount: 0 }
  ] as const;
  for (const invalid of invalidTrackingCounts) {
    expect(() =>
      recentWorkMatchSchema.parse({ ...first.match!, ...invalid })
    ).toThrow();
    expect(() =>
      recentWorkPublicSummarySchema.parse({ ...summary!, ...invalid })
    ).toThrow();
  }
  });

  it("canonicalizes a valid seconds-only timestamp at the public seam", () => {
    const projection = resolveRecentWork(
      exactInput({ pushOccurredAt: "2026-08-09T11:00:00Z" })
    );
    const internalMatch = recentWorkMatchSchema.parse(projection.match);
    expect(internalMatch.pushOccurredAt).toBe(
      "2026-08-09T11:00:00Z"
    );
    expect(() =>
      recentWorkPublicSummarySchema.parse({
        displayLabel: internalMatch.displayLabel,
        pushOccurredAt: internalMatch.pushOccurredAt,
        trackingState: internalMatch.trackingState,
        aheadCount: internalMatch.aheadCount,
        behindCount: internalMatch.behindCount,
        correlation: "repository_scope_only",
        presentation: "display_only",
        attentionSelectionEffect: "none",
        executionEffect: "none"
      })
    ).toThrow();

    const summary = projectRecentWorkPublicSummary(
      projection,
      "present"
    );
    expect(summary?.pushOccurredAt).toBe(
      "2026-08-09T11:00:00.000Z"
    );
    expect(recentWorkPublicSummarySchema.parse(summary)).toEqual(
      summary
    );

    expect(
      projectRecentWorkPublicSummary(
        {
          ...projection,
          match: {
            ...internalMatch,
            pushOccurredAt: "invalid"
          }
        },
        "present"
      )
    ).toBeNull();
  });

  it("requires one exact push repository scope and honors +60 second skew", () => {
    expect(
      resolveRecentWork(
        exactInput({ pushOccurredAt: "2026-08-09T12:01:00.000Z" })
      ).status
    ).toBe("matched");
    expect(
      resolveRecentWork(
        exactInput({ pushOccurredAt: "2026-08-09T12:01:00.001Z" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_FOCUS_STALE"]);
    expect(
      resolveRecentWork(
        exactInput({ localGitFetchedAt: "2026-08-09T12:01:00.000Z" })
      ).status
    ).toBe("matched");
    expect(
      resolveRecentWork(
        exactInput({ localGitFetchedAt: "2026-08-09T12:01:00.001Z" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_LOCAL_GIT_STALE"]);
    expect(
      resolveRecentWork(
        exactInput({ pushRepositoryOpaqueId: "202" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_LINK_UNAVAILABLE"]);
    expect(
      resolveRecentWork(
        exactInput({ duplicatePushSignal: true })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_FOCUS_REPOSITORY_CONFLICT"]);
  });

  it("fails partial and stale Focus, stale Local Git, and confirmed-link ties closed", () => {
    expect(
      resolveRecentWork(
        exactInput({ eventCompleteness: "partial" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_FOCUS_NOT_CURRENT"]);
    expect(
      resolveRecentWork(
        exactInput({ pushOccurredAt: "2026-08-08T11:59:59.999Z" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_FOCUS_STALE"]);
    expect(
      resolveRecentWork(
        exactInput({ localGitFetchedAt: "2026-08-09T11:54:59.999Z" })
      ).reasonCodes
    ).toEqual(["RECENT_WORK_LOCAL_GIT_STALE"]);
    const tied = exactInput();
    tied.confirmedLinks = {
      ...tied.confirmedLinks,
      links: [
        ...tied.confirmedLinks.links,
        {
          ...tied.confirmedLinks.links[0],
          linkId: `repository_scope_link_${"d".repeat(32)}`,
          scopes: {
            ...tied.confirmedLinks.links[0].scopes,
            codex: {
              source: "codex",
              resourceType: "scope",
              opaqueId: "c".repeat(24)
            }
          }
        }
      ]
    };
    expect(resolveRecentWork(tied).reasonCodes).toEqual([
      "RECENT_WORK_LINK_TIE"
    ]);
  });

  it.each(["unborn", "unavailable"] as const)(
    "rejects %s Local Git state",
    (trackingState) => {
      const input = exactInput({ trackingState });
      expect(resolveRecentWork(input).reasonCodes).toEqual([
        trackingState === "unborn"
          ? "RECENT_WORK_LOCAL_GIT_UNBORN"
          : "RECENT_WORK_LOCAL_GIT_UNAVAILABLE"
      ]);
    }
  );

  it("defaults missing and invalid rollout values to shadow", () => {
    expect(resolveRecentWorkPresentationMode({})).toBe("shadow");
    expect(
      resolveRecentWorkPresentationMode({
        BLABASE_RECENT_WORK_PRESENTATION_MODE: "invalid"
      })
    ).toBe("shadow");
    expect(
      resolveRecentWorkPresentationMode({
        BLABASE_RECENT_WORK_PRESENTATION_MODE: "present"
      })
    ).toBe("present");
  });

  it("cannot mutate the Active input, result, or hashes", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      artifactKind: "github_commit",
      githubPushOccurredAt: "2026-08-02T02:58:30.000Z"
    });
    expect(ACTIVE_FIXTURE_PROJECT_ID).toMatch(/^project_/);
    const inputBefore = structuredClone(fixture.input);
    const activeBefore = resolveActiveAttention(fixture.input);
    resolveRecentWork(exactInput());
    const activeAfter = resolveActiveAttention(fixture.input);
    expect(fixture.input).toEqual(inputBefore);
    expect(activeAfter).toEqual(activeBefore);
    expect(activeAfter.inputSha256).toBe(activeBefore.inputSha256);
    expect(activeAfter.resultSha256).toBe(activeBefore.resultSha256);
  });
});

function exactInput(options?: {
  eventCompleteness?: "complete" | "partial";
  pushOccurredAt?: string;
  localGitFetchedAt?: string;
  trackingState?: "ahead" | "unborn" | "unavailable";
  pushRepositoryOpaqueId?: string;
  duplicatePushSignal?: boolean;
}) {
  const pushOccurredAt = options?.pushOccurredAt ?? PUSH_AT;
  const snapshot = localGitSnapshot(options);
  const githubBatch = pushBatch(
    pushOccurredAt,
    options?.pushRepositoryOpaqueId ?? "101",
    options?.duplicatePushSignal ?? false
  );
  return {
    asOf: AS_OF,
    currentFocus: currentFocus({
      ...options,
      pushOccurredAt,
      eventId: selectedPushEventId(githubBatch)
    }),
    githubBatch,
    confirmedLinks: confirmedLinks(snapshot),
    localGitSnapshot: snapshot
  };
}

function currentFocus(options?: {
  eventCompleteness?: "complete" | "partial";
  pushOccurredAt?: string;
  eventId?: string;
}): CurrentFocusProjection {
  const completeness = options?.eventCompleteness ?? "complete";
  return {
    status: "selected",
    projectionSha256: "e".repeat(64),
    selectedFocus: {
      projectId: PROJECT_ID,
      displayLabel: "Private recent work",
      currentness: "current",
      completeness: "complete",
      latestMeaningfulEvent: {
        eventId: options?.eventId,
        source: "github",
        kind: "github_push",
        occurredAt: options?.pushOccurredAt ?? PUSH_AT,
        freshness: "current",
        completeness,
        currentness: "current",
        attentionCapability: "focus_selector",
        eventSha256: "f".repeat(64)
      }
    }
  } as CurrentFocusProjection;
}

function pushBatch(
  sourceUpdatedAt: string,
  repositoryOpaqueId: string,
  duplicate: boolean
): RuntimeWorkSignalBatch {
  const signal = {
    kind: "activity_observation",
    signalId: `signal_${"4".repeat(32)}`,
    sourceScopeId: `repository:${repositoryOpaqueId}`,
    sourceUpdatedAt,
    facts: { activityKind: "push" }
  };
  return {
    batchSha256: "9".repeat(64),
    signals: duplicate ? [signal, { ...signal }] : [signal]
  } as unknown as RuntimeWorkSignalBatch;
}

function selectedPushEventId(batch: RuntimeWorkSignalBatch): string {
  const signal = batch.signals[0]!;
  if (
    signal.kind !== "activity_observation" ||
    signal.sourceUpdatedAt === null
  ) {
    throw new TypeError("Expected a push activity signal.");
  }
  return createRecentMeaningfulEventId({
    source: "github",
    kind: "github_push",
    stableIdentity: {
      signalId: signal.signalId,
      kind: "github_push",
      sourceUpdatedAt: signal.sourceUpdatedAt
    }
  });
}

function confirmedLinks(
  snapshot: CodexLocalGitSnapshot
): ConfirmedRepositoryScopeLinkResolution {
  return {
    status: "ready",
    registrySha256: "a".repeat(64),
    links: [
      {
        linkId: `repository_scope_link_${"c".repeat(32)}`,
        projectId: PROJECT_ID,
        scopes: {
          github: {
            source: "github",
            resourceType: "repository",
            opaqueId: "101"
          },
          codex: {
            source: "codex",
            resourceType: "scope",
            opaqueId: SCOPE_ID
          }
        },
        registrySha256: "a".repeat(64),
        githubFetchedAt: "2026-08-09T11:59:00.000Z",
        localGitSnapshotSha256: snapshot.snapshotSha256,
        correlation: "repository_scope_only"
      }
    ]
  };
}

function localGitSnapshot(options?: {
  localGitFetchedAt?: string;
  trackingState?: "ahead" | "unborn" | "unavailable";
}): CodexLocalGitSnapshot {
  const trackingState = options?.trackingState ?? "ahead";
  const available = trackingState !== "unavailable";
  const hasHead = available && trackingState !== "unborn";
  return sealCodexLocalGitSnapshot({
    schemaVersion: "codex-local-git-snapshot-v1",
    collectorVersion: "codex-local-git-metadata-v1",
    upstreamBasis: "local_tracking_ref_without_network_refresh",
    fetchedAt:
      options?.localGitFetchedAt ?? "2026-08-09T11:59:00.000Z",
    scopeIds: [SCOPE_ID],
    repositories: [
      {
        scopeId: SCOPE_ID,
        repositoryId: `local_repo_${"1".repeat(64)}`,
        headCommitId: hasHead
          ? `local_commit_${"2".repeat(64)}`
          : null,
        githubRepositoryKey: `github_repo_${"3".repeat(32)}`,
        mappingEligibility: "exact",
        trackingState,
        aheadCount: trackingState === "ahead" ? 2 : null,
        behindCount: trackingState === "ahead" ? 0 : null,
        headCommittedAt: hasHead
          ? "2026-08-09T11:00:00.000Z"
          : null,
        unavailableReason:
          trackingState === "unavailable"
            ? "GIT_EXECUTION_FAILED"
            : null
      }
    ],
    truncated: false
  });
}
