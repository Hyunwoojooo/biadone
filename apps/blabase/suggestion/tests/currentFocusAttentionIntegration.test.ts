import { describe, expect, it } from "vitest";

import {
  resolveActiveAttention,
  sealActiveAttentionInput
} from "../src/attentionDecision";
import { resolveManagedCodexArtifactRelations } from "../src/artifacts";
import { resolveCurrentClaimAuthority } from "../src/claims";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import { finalizeRuntimeWorkSignalBatch } from "../src/crossSource/workSignalIntegrity";
import {
  resolveCurrentFocusFromEvidence,
  resolveFocusAwareAttentionShadow
} from "../src/currentFocus";
import { resolveAttentionEligibilityShadow } from "../src/eligibility";
import { resolveManagedCodexWorkRelations } from "../src/relations";
import {
  ACTIVE_FIXTURE_AS_OF,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

describe("Current Focus Attention shadow integration", () => {
  it("reorders only the focused candidate inside the same safety tier without changing Active Attention", () => {
    const first = activeAttentionFixture({
      managedScenario: "running",
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Second same-tier task"
        }
      ]
    });
    const firstResult = resolveActiveAttention(first.input);
    const firstTopSubjectId =
      firstResult.decision.topSuggestion?.githubSubjectId;
    expect(firstTopSubjectId).toMatch(/^github:object:/);
    const focusObjectId =
      firstTopSubjectId === "github:object:501" ? 502 : 501;
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      bindingGitHubObjectId: focusObjectId,
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Second same-tier task"
        }
      ]
    });
    const result = resolveActiveAttention(fixture.input);
    const resultBeforeShadow = structuredClone(result);
    const focus = resolveFixtureFocus(fixture);

    expect(focus.currentFocus.status).toBe("selected");
    expect(result.rankedCandidates).toHaveLength(2);
    expect(
      new Set(
        result.rankedCandidates.map((candidate) =>
          JSON.stringify([
            candidate.lane,
            candidate.dueAt,
            candidate.triggerKind
          ])
        )
      ).size
    ).toBe(1);

    const shadow = resolveFocusAwareAttentionShadow({
      asOf: ACTIVE_FIXTURE_AS_OF,
      currentFocus: focus.currentFocus,
      activeAttentionResult: result,
      eligibilityProjectionSha256:
        fixture.eligibilityProjection.projectionSha256,
      workRelationProjectionSha256:
        fixture.workRelations.projectionSha256,
      claimAuthorityProjectionSha256: fixture.claims.projectionSha256
    });

    expect(shadow).toMatchObject({
      status: "evaluated",
      existingTopCandidateId:
        result.decision.topSuggestion?.candidateId,
      wouldSwitch: true,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      attentionSelectionEffect: "none"
    });
    expect(shadow.counterfactualTopCandidateId).not.toBe(
      shadow.existingTopCandidateId
    );
    expect(
      shadow.matches.find(
        (match) =>
          match.candidateId === shadow.counterfactualTopCandidateId
      )
    ).toMatchObject({ match: "exact", counterfactualRank: 1 });
    expect(result).toEqual(resultBeforeShadow);
    expect(result.resultSha256).toBe(resultBeforeShadow.resultSha256);
    const serializedSidecars = JSON.stringify({ focus, shadow });
    expect(serializedSidecars).not.toContain(
      fixture.privateCodexThreadSentinel
    );
    expect(serializedSidecars).not.toContain(
      fixture.managedPublicProjection.runs[0]?.managedRunId
    );
    expect(serializedSidecars).not.toContain(
      fixture.managedPublicProjection.runs[0]?.executionId
    );
    expect(serializedSidecars).not.toMatch(
      /"(?:command|conversation|filePath|prompt|token)"\s*:/u
    );
    expect(serializedSidecars).not.toMatch(/\b[a-f0-9]{40}\b/u);
  });

  it("keeps a healthy managed Focus observational when no Active candidate is eligible", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      githubKind: "authored_pull_request",
      githubActionability: nonActionablePullRequest()
    });
    const result = resolveActiveAttention(fixture.input);
    const focus = resolveFixtureFocus(fixture);
    expect(focus.currentFocus.status).toBe("selected");
    expect(result.rankedCandidates).toEqual([]);

    const shadow = resolveFocusAwareAttentionShadow({
      asOf: ACTIVE_FIXTURE_AS_OF,
      currentFocus: focus.currentFocus,
      activeAttentionResult: result,
      eligibilityProjectionSha256:
        fixture.eligibilityProjection.projectionSha256,
      workRelationProjectionSha256:
        fixture.workRelations.projectionSha256,
      claimAuthorityProjectionSha256: fixture.claims.projectionSha256
    });

    expect(shadow).toMatchObject({
      status: "not_applied",
      existingTopCandidateId: null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false,
      attentionSelectionEffect: "none"
    });
  });

  it("keeps a verified push focus-selectable when only GitHub actionability coverage is partial", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      artifactKind: "github_commit",
      githubKind: "authored_pull_request",
      githubActionability: nonActionablePullRequest(),
      githubPushOccurredAt: "2026-08-02T02:58:30.000Z"
    });
    const completeFocus = resolveFixtureFocus(fixture);
    if (fixture.githubBatch === null) {
      throw new Error("Expected an available GitHub fixture batch.");
    }
    const partialBatch = actionabilityOnlyPartialBatch(
      fixture.githubBatch
    );
    const partialGraph = resolveLifecycleGraph(fixture, partialBatch);
    const activeInputBeforeFocus = structuredClone(
      partialGraph.activeInput
    );
    const activeAttention = partialGraph.activeAttention;
    const focus = resolveCurrentFocusFromEvidence(partialGraph.input);

    expect(partialBatch.signals).toEqual(fixture.githubBatch.signals);
    expect(partialBatch.assessment).toMatchObject({
      freshness: "fresh",
      completeness: "partial",
      truncated: false,
      candidateSetComplete: false,
      reasonCodes: expect.arrayContaining([
        "GITHUB_ACTIONABILITY_PARTIAL"
      ])
    });
    expect(partialBatch.assessment.reasonCodes).not.toContain(
      "GITHUB_ACTIVITIES_PARTIAL"
    );
    expect(partialBatch.assessment.reasonCodes).not.toContain(
      "GITHUB_ACTIVITIES_UNAVAILABLE"
    );
    expect(completeFocus.recentMeaningfulEvents.coverage.github).toBe(
      "complete"
    );
    expect(focus.recentMeaningfulEvents.coverage.github).toBe(
      "complete"
    );
    expect(
      focus.recentMeaningfulEvents.events.find(
        (event) => event.kind === "github_push"
      )
    ).toMatchObject({
      currentness: "current",
      attentionCapability: "focus_selector"
    });
    expect(focus.currentFocus.status).toBe("selected");

    const shadow = resolveFocusAwareAttentionShadow({
      asOf: ACTIVE_FIXTURE_AS_OF,
      currentFocus: focus.currentFocus,
      activeAttentionResult: activeAttention,
      eligibilityProjectionSha256:
        partialGraph.eligibilityProjection.projectionSha256,
      workRelationProjectionSha256:
        partialGraph.workRelations.projectionSha256,
      claimAuthorityProjectionSha256:
        partialGraph.claims.projectionSha256
    });

    expect(shadow.attentionSelectionEffect).toBe("none");
    expect(partialGraph.activeInput).toEqual(activeInputBeforeFocus);
    expect(resolveActiveAttention(partialGraph.activeInput)).toEqual(
      activeAttention
    );
    expect(JSON.stringify({ focus, shadow })).not.toContain(
      '"nativeSubjectId"'
    );
  });

  it("does not move a focus match across a lane and due-date safety tier", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      bindingGitHubObjectId: 501,
      additionalGitHubTasks: [
        {
          id: 502,
          kind: "assigned_issue",
          number: 43,
          title: "Urgent different-tier task",
          deadlineAt: "2026-08-02T04:00:00.000Z"
        }
      ]
    });
    const result = resolveActiveAttention(fixture.input);
    const focus = resolveFixtureFocus(fixture);
    expect(result.decision.topSuggestion?.githubSubjectId).toBe(
      "github:object:502"
    );
    const focusedTargetRef = result.assessments.find(
      (assessment) =>
        assessment.githubSubjectId === "github:object:501"
    )?.targetRef;
    expect(focusedTargetRef).toBeDefined();
    expect(focus.currentFocus.selectedFocus?.latestMeaningfulEvent).toMatchObject(
      {
        claimTargetRefs: expect.arrayContaining([
          focusedTargetRef
        ])
      }
    );

    const shadow = resolveFocusAwareAttentionShadow({
      asOf: ACTIVE_FIXTURE_AS_OF,
      currentFocus: focus.currentFocus,
      activeAttentionResult: result,
      eligibilityProjectionSha256:
        fixture.eligibilityProjection.projectionSha256,
      workRelationProjectionSha256:
        fixture.workRelations.projectionSha256,
      claimAuthorityProjectionSha256: fixture.claims.projectionSha256
    });

    expect(shadow).toMatchObject({
      status: "evaluated",
      existingTopCandidateId:
        result.decision.topSuggestion?.candidateId,
      counterfactualTopCandidateId:
        result.decision.topSuggestion?.candidateId,
      wouldSwitch: false,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      attentionSelectionEffect: "none"
    });
  });

  it("rejects dependency tampering before producing a counterfactual", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running"
    });
    const result = resolveActiveAttention(fixture.input);
    const focus = resolveFixtureFocus(fixture);

    expect(() =>
      resolveFocusAwareAttentionShadow({
        asOf: ACTIVE_FIXTURE_AS_OF,
        currentFocus: focus.currentFocus,
        activeAttentionResult: result,
        eligibilityProjectionSha256: "0".repeat(64),
        workRelationProjectionSha256:
          fixture.workRelations.projectionSha256,
        claimAuthorityProjectionSha256:
          fixture.claims.projectionSha256
      })
    ).toThrow(/exact evidence graph/i);
  });
});

function resolveFixtureFocus(
  fixture: ReturnType<typeof activeAttentionFixture>
) {
  return resolveCurrentFocusFromEvidence({
    asOf: ACTIVE_FIXTURE_AS_OF,
    githubBatch: fixture.githubBatch,
    codexInventoryBatch: null,
    managedPublicProjection: fixture.managedPublicProjection,
    managedSemanticProjection: fixture.managedSemanticProjection,
    managedRunStartedAtById:
      fixture.input.managedRunStartedAtById,
    workRelationProjection: fixture.workRelations,
    artifactRelationProjection: fixture.artifacts,
    claimAuthorityProjection: fixture.claims,
    contextRegistrySha256:
      fixture.workRelations.contextRegistrySha256
  });
}

function actionabilityOnlyPartialBatch(
  batch: RuntimeWorkSignalBatch
): RuntimeWorkSignalBatch {
  const reasonCodes = [
    ...batch.assessment.reasonCodes.filter(
      (code) =>
        code !== "GITHUB_ACTIONABILITY_PARTIAL" &&
        code !== "GITHUB_ACTIONABILITY_UNAVAILABLE"
    ),
    "GITHUB_ACTIONABILITY_PARTIAL" as const
  ].sort();
  const issues = [
    ...batch.issues.filter(
      (issue) =>
        issue.code !== "GITHUB_ACTIONABILITY_PARTIAL" &&
        issue.code !== "GITHUB_ACTIONABILITY_UNAVAILABLE"
    ),
    {
      code: "GITHUB_ACTIONABILITY_PARTIAL" as const,
      subjectId: null,
      recordSha256: null
    }
  ].sort((left, right) => left.code.localeCompare(right.code));
  const {
    batchSha256: _batchSha256,
    signalCount: _signalCount,
    ...draft
  } = batch;
  return finalizeRuntimeWorkSignalBatch({
    ...draft,
    assessment: {
      ...draft.assessment,
      completeness: "partial",
      candidateSetComplete: false,
      reasonCodes
    },
    issues
  });
}

function resolveLifecycleGraph(
  fixture: ReturnType<typeof activeAttentionFixture>,
  githubBatch: RuntimeWorkSignalBatch
) {
  const workRelations = resolveManagedCodexWorkRelations({
    asOf: ACTIVE_FIXTURE_AS_OF,
    managedProjection: fixture.managedPublicProjection,
    bindingStore: fixture.bindingStore,
    githubBatch,
    contextRegistry: fixture.contextRegistry
  });
  const artifacts = resolveManagedCodexArtifactRelations({
    asOf: ACTIVE_FIXTURE_AS_OF,
    workRelationProjection: workRelations,
    attributionStore: fixture.artifactStore,
    githubBatch
  });
  const claims = resolveCurrentClaimAuthority({
    asOf: ACTIVE_FIXTURE_AS_OF,
    managedProjection: fixture.managedPublicProjection,
    managedSemantics: fixture.managedSemanticProjection,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    githubBatch,
    contextRegistry: fixture.contextRegistry
  });
  const eligibilityProjection = resolveAttentionEligibilityShadow({
    asOf: ACTIVE_FIXTURE_AS_OF,
    githubBatch,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    claimAuthorityProjection: claims
  });
  const activeInput = sealActiveAttentionInput({
    contract: fixture.input.contract,
    asOf: ACTIVE_FIXTURE_AS_OF,
    baseAttentionInput: {
      ...fixture.input.baseAttentionInput,
      sources: {
        ...fixture.input.baseAttentionInput.sources,
        github: { status: "available", batch: githubBatch }
      }
    },
    githubBatch,
    eligibilityProjection,
    managedPublicProjection: fixture.managedPublicProjection,
    managedSemanticProjection: fixture.managedSemanticProjection,
    managedRunStartedAtById:
      fixture.input.managedRunStartedAtById,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    claimAuthorityProjection: claims,
    workflowProjection: fixture.workflowProjection
  });
  const activeAttention = resolveActiveAttention(activeInput);
  return {
    workRelations,
    artifacts,
    claims,
    eligibilityProjection,
    activeInput,
    activeAttention,
    input: {
      asOf: ACTIVE_FIXTURE_AS_OF,
      githubBatch,
      codexInventoryBatch: null,
      managedPublicProjection: fixture.managedPublicProjection,
      managedSemanticProjection: fixture.managedSemanticProjection,
      managedRunStartedAtById:
        fixture.input.managedRunStartedAtById,
      workRelationProjection: workRelations,
      artifactRelationProjection: artifacts,
      claimAuthorityProjection: claims,
      contextRegistrySha256: fixture.contextRegistry.registrySha256
    }
  };
}

function nonActionablePullRequest() {
  return {
    collectionState: "complete" as const,
    draft: false,
    reviewDecision: "none" as const,
    checksSummary: {
      collectionState: "complete" as const,
      state: "passing" as const,
      totalCount: 1,
      completedCount: 1,
      failedCount: 0,
      pendingCount: 0,
      truncated: false
    },
    mergeable: true,
    mergeConflict: false,
    unresolvedChangeRequestCount: 0,
    requestedReviewerCount: 0,
    actionRequired: false,
    actionRequiredReasons: []
  };
}
