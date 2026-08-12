import { describe, expect, it } from "vitest";

import {
  createActiveAttentionResultId,
  resolveActiveAttention,
  sealActiveAttentionResult
} from "../src/attentionDecision";
import {
  createContinuationCandidateId,
  sealContinuationCandidate,
  sealContinuationDecision,
  type ContinuationCandidate,
  type ContinuationDecision
} from "../src/continuation";
import {
  CONTINUATION_ACTION_POLICY_VERSION,
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
  WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  WORK_SUGGESTION_BOARD_EXECUTION_POLICY,
  createWorkSuggestionBoardId,
  createWorkSuggestionBoardItemId,
  createWorkSuggestionBoardSourceItemRef,
  sealWorkSuggestionBoardInput,
  sealWorkSuggestionBoardResult,
  verifyWorkSuggestionBoardInputIntegrity,
  verifyWorkSuggestionBoardResultIntegrity,
  workSuggestionBoardInputSchema,
  workSuggestionBoardPublicSchema,
  workSuggestionBoardResultSemanticSha256,
  workSuggestionBoardResultSha256,
  workSuggestionBoardResultSchema,
  type WorkSuggestionBoardInput,
  type WorkSuggestionBoardItem
} from "../src/suggestionBoard";
import {
  ACTIVE_FIXTURE_AS_OF,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

const CONTINUATION_PROJECT_ID = `project_${"6".repeat(32)}`;
const STARTED_AT = "2026-08-02T02:59:00.000Z";
const COMPLETED_AT = "2026-08-02T02:59:01.000Z";

describe("Work Suggestion Board contracts", () => {
  it("keeps valid Attention primary without changing its sealed hash", () => {
    const active = suggestedAttention();
    const continuation = decisionWithPrimary("offers_available");
    const input = boardInput(active, continuation);
    const activeCandidate = active.decision.topSuggestion;
    const continuationCandidate = continuation.primary;
    expect(activeCandidate).not.toBeNull();
    expect(continuationCandidate).not.toBeNull();

    const primary = boardItem(
      "attention",
      activeCandidate!.candidateId,
      activeCandidate!.title,
      activeCandidate!.title,
      "verified_attention",
      activeCandidate!.projectId,
      "display",
      activeCandidate!.sourceUpdatedAt,
      activeCandidate!.dueAt
    );
    const result = boardResult(input, primary, []);

    expect(result.prominentLane).toBe("attention");
    expect(result.input.active).toEqual(active);
    expect(result.input.active.resultSha256).toBe(active.resultSha256);
    expect(result.dependencies.activeResultSha256).toBe(active.resultSha256);
    expect(result.dependencies.continuationResultSha256).toBe(
      continuation.resultSha256
    );
    expect(result.dependencies.continuationSemanticResultSha256).toBe(
      continuation.semanticResultSha256
    );
    expect(verifyWorkSuggestionBoardResultIntegrity(result)).toBe(true);
  });

  it("uses Continuation, then Setup, then none only when Attention is absent", () => {
    const active = noActionAttention();
    const continuation = decisionWithPrimary("offers_available");
    const continuationPrimary = continuation.primary!;
    const continuationResult = boardResult(
      boardInput(active, continuation),
      boardItem(
        "continuation",
        continuationPrimary.candidateId,
        continuationPrimary.localDisplayLabel,
        continuationPrimary.localDisplayLabel,
        "single_source",
        continuationPrimary.workContextId
      ),
      []
    );
    expect(continuationResult.prominentLane).toBe("continuation");

    const setup = decisionWithPrimary("setup_required");
    const setupPrimary = setup.primary!;
    const setupResult = boardResult(
      boardInput(active, setup),
      boardItem(
        "setup",
        setupPrimary.candidateId,
        setupPrimary.localDisplayLabel,
        setupPrimary.localDisplayLabel,
        "setup",
        setupPrimary.workContextId,
        "open_setup_surface"
      ),
      []
    );
    expect(setupResult.prominentLane).toBe("setup");

    const emptyResult = boardResult(
      boardInput(active, emptyContinuation()),
      null,
      []
    );
    expect(emptyResult.prominentLane).toBe("none");
    expect(emptyResult.primary).toBeNull();
    expect(emptyResult.alternatives).toEqual([]);
  });

  it("bounds, deduplicates, and canonically orders alternatives", () => {
    const active = resolveActiveAttention(
      activeAttentionFixture({
        additionalGitHubTasks: [
          { id: 502, kind: "review_requested_pull_request", number: 43 },
          { id: 503, kind: "assigned_issue", number: 44 }
        ]
      }).input
    );
    const input = boardInput(active, emptyContinuation());
    const primaryCandidate = active.decision.topSuggestion!;
    const primary = boardItem(
      "attention",
      primaryCandidate.candidateId,
      primaryCandidate.title,
      primaryCandidate.title,
      "verified_attention",
      primaryCandidate.projectId,
      "display",
      primaryCandidate.sourceUpdatedAt,
      primaryCandidate.dueAt
    );
    const alternatives = active.decision.alternatives
      .map((candidate) =>
        boardItem(
          "attention",
          candidate.candidateId,
          candidate.title,
          candidate.title,
          "verified_attention",
          candidate.projectId,
          "display",
          candidate.sourceUpdatedAt,
          candidate.dueAt
        )
      );
    expect(alternatives).toHaveLength(2);
    const valid = boardResult(input, primary, alternatives);
    expect(valid.alternatives).toEqual(alternatives);

    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        alternatives: [...alternatives, alternatives[0]!]
      })
    ).toThrow();
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        alternatives: [alternatives[0]!, alternatives[0]!]
      })
    ).toThrow(/sealed lane order|exact projection/i);
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        alternatives: [...alternatives].reverse()
      })
    ).toThrow(/sealed lane order|exact projection/i);
  });

  it("fails closed for tampering, unknown versions, and mixed Continuation", () => {
    const active = noActionAttention();
    const continuation = emptyContinuation();
    const input = boardInput(active, continuation);
    const result = boardResult(input, null, []);

    expect(verifyWorkSuggestionBoardInputIntegrity({
      ...input,
      inputSha256: "0".repeat(64)
    })).toBe(false);
    expect(() =>
      workSuggestionBoardInputSchema.safeParse({
        ...input,
        active: {
          ...active,
          decision: {
            ...active.decision,
            scopeStatement: "Nested tamper"
          }
        }
      })
    ).not.toThrow();
    expect(() =>
      workSuggestionBoardResultSchema.safeParse({
        ...result,
        input: {
          ...input,
          continuation: {
            ...continuation,
            resultSha256: "0".repeat(64)
          }
        }
      })
    ).not.toThrow();
    expect(verifyWorkSuggestionBoardResultIntegrity({
      ...result,
      resultSha256: "0".repeat(64)
    })).toBe(false);
    expect(verifyWorkSuggestionBoardResultIntegrity({
      ...result,
      semanticResultSha256: "0".repeat(64)
    })).toBe(false);
    expect(workSuggestionBoardResultSchema.safeParse({
      ...result,
      dependencies: {
        ...result.dependencies,
        continuationSemanticResultSha256: "0".repeat(64)
      }
    }).success).toBe(false);
    expect(workSuggestionBoardInputSchema.safeParse({
      ...input,
      schemaVersion: "work-suggestion-board-schema-v9"
    }).success).toBe(false);
    expect(workSuggestionBoardInputSchema.safeParse({
      ...input,
      continuation: {
        ...continuation,
        schemaVersion: "continuation-decision-schema-v9"
      }
    }).success).toBe(false);
    expect(workSuggestionBoardResultSchema.safeParse({
      ...result,
      input: {
        ...input,
        active: { ...active, resultSha256: "f".repeat(64) }
      }
    }).success).toBe(false);

    const nonFiniteInput = {
      ...input,
      active: {
        ...active,
        counts: {
          ...active.counts,
          eligible: Number.POSITIVE_INFINITY
        }
      }
    };
    expect(() =>
      workSuggestionBoardInputSchema.safeParse(nonFiniteInput)
    ).not.toThrow();
    expect(workSuggestionBoardInputSchema.safeParse(nonFiniteInput).success).toBe(
      false
    );
    expect(() =>
      verifyWorkSuggestionBoardInputIntegrity(nonFiniteInput)
    ).not.toThrow();
    expect(verifyWorkSuggestionBoardInputIntegrity(nonFiniteInput)).toBe(false);

    const nonFiniteResult = { ...result, input: nonFiniteInput };
    expect(() =>
      workSuggestionBoardResultSchema.safeParse(nonFiniteResult)
    ).not.toThrow();
    expect(
      workSuggestionBoardResultSchema.safeParse(nonFiniteResult).success
    ).toBe(false);
    expect(() =>
      verifyWorkSuggestionBoardResultIntegrity(nonFiniteResult)
    ).not.toThrow();
    expect(verifyWorkSuggestionBoardResultIntegrity(nonFiniteResult)).toBe(
      false
    );
  });

  it("seals deterministically and fixes execution authority to explicit read-only actions", () => {
    const input = boardInput(noActionAttention(), emptyContinuation());
    const first = boardResult(input, null, []);
    const second = boardResult(input, null, []);
    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe("work-suggestion-board-schema-v0.2");
    expect(workSuggestionBoardResultSemanticSha256(first)).toBe(
      first.semanticResultSha256
    );
    const semanticTamper = {
      ...first,
      semanticResultSha256: "0".repeat(64)
    };
    const reboundResultSha256 = workSuggestionBoardResultSha256(
      semanticTamper
    );
    expect(reboundResultSha256).not.toBe(first.resultSha256);
    expect(
      workSuggestionBoardResultSchema.safeParse({
        ...semanticTamper,
        resultSha256: reboundResultSha256
      }).success
    ).toBe(false);
    expect(first.executionPolicy).toEqual(
      WORK_SUGGESTION_BOARD_EXECUTION_POLICY
    );
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(first),
        executionPolicy: {
          automaticExecutionAllowed: true,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      } as never)
    ).toThrow();
  });

  it("keeps Board semantics stable while run-only lineage changes", () => {
    const active = noActionAttention();
    const continuation = emptyContinuation();
    const originalInput = boardInput(active, continuation);
    const original = boardResult(originalInput, null, []);
    const replayedContinuation = sealContinuationDecision({
      ...withoutResultHash(continuation),
      run: {
        ...continuation.run,
        runId: `continuation_run_${"9".repeat(32)}`,
        latencyMs: 2
      }
    });
    const replayedInput = boardInput(active, replayedContinuation);
    const replayed = boardResult(replayedInput, null, []);

    expect(replayedContinuation.semanticResultSha256).toBe(
      continuation.semanticResultSha256
    );
    expect(replayedContinuation.resultSha256).not.toBe(
      continuation.resultSha256
    );
    expect(replayedInput.inputSha256).not.toBe(originalInput.inputSha256);
    expect(replayed.boardId).not.toBe(original.boardId);
    expect(replayed.dependencies.continuationResultSha256).not.toBe(
      original.dependencies.continuationResultSha256
    );
    expect(replayed.dependencies.continuationSemanticResultSha256).toBe(
      original.dependencies.continuationSemanticResultSha256
    );
    expect(replayed.semanticResultSha256).toBe(original.semanticResultSha256);
    expect(replayed.resultSha256).not.toBe(original.resultSha256);
  });

  it("excludes source, candidate, Board ID, and locator lineage from Board semantics", () => {
    const active = noActionAttention();
    const originalCandidate = continuationCandidate();
    const relinedCandidate = candidate({
      marker: "9",
      candidateKind: "recent_github_push",
      workContextId: CONTINUATION_PROJECT_ID,
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      explicitPreference: 5
    });
    const originalContinuation = continuationDecision(
      "offers_available",
      originalCandidate
    );
    const relinedContinuation = continuationDecision(
      "offers_available",
      relinedCandidate
    );
    const originalItem = boardItem(
      "continuation",
      originalCandidate.candidateId,
      originalCandidate.localDisplayLabel,
      originalCandidate.localDisplayLabel,
      originalCandidate.evidenceBand,
      originalCandidate.workContextId
    );
    const relinedItem = boardItem(
      "continuation",
      relinedCandidate.candidateId,
      relinedCandidate.localDisplayLabel,
      relinedCandidate.localDisplayLabel,
      relinedCandidate.evidenceBand,
      relinedCandidate.workContextId
    );
    const original = boardResult(
      boardInput(active, originalContinuation),
      originalItem,
      []
    );
    const relined = boardResult(
      boardInput(active, relinedContinuation),
      relinedItem,
      []
    );

    expect(relinedCandidate.sourceObservationIds).not.toEqual(
      originalCandidate.sourceObservationIds
    );
    expect(relinedCandidate.candidateId).not.toBe(originalCandidate.candidateId);
    expect(relinedItem.sourceItemRef).not.toBe(originalItem.sourceItemRef);
    expect(relinedItem.boardItemId).not.toBe(originalItem.boardItemId);
    expect(relinedContinuation.semanticResultSha256).toBe(
      originalContinuation.semanticResultSha256
    );
    expect(relinedContinuation.resultSha256).not.toBe(
      originalContinuation.resultSha256
    );
    expect(relined.boardId).not.toBe(original.boardId);
    expect(relined.semanticResultSha256).toBe(original.semanticResultSha256);
    expect(relined.resultSha256).not.toBe(original.resultSha256);

    const rescoredCandidate = candidate({
      marker: "3",
      candidateKind: "recent_github_push",
      workContextId: CONTINUATION_PROJECT_ID,
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      explicitPreference: 4
    });
    const rescoredContinuation = continuationDecision(
      "offers_available",
      rescoredCandidate
    );
    const rescored = boardResult(
      boardInput(active, rescoredContinuation),
      originalItem,
      []
    );
    expect(rescoredCandidate.candidateId).toBe(originalCandidate.candidateId);
    expect(rescoredContinuation.semanticResultSha256).not.toBe(
      originalContinuation.semanticResultSha256
    );
    expect(rescored.semanticResultSha256).toBe(original.semanticResultSha256);
    expect(rescored.resultSha256).not.toBe(original.resultSha256);

    const originalSetup = setupCandidate();
    const relocatedSetup = candidate({
      marker: "4",
      candidateKind: "workspace_mapping",
      workContextId: null,
      evidenceBand: "setup",
      capability: "open_setup_surface",
      availability: "setup_required",
      explicitPreference: 5,
      privateTargetMarker: "9"
    });
    const originalSetupContinuation = continuationDecision(
      "setup_required",
      originalSetup
    );
    const relocatedSetupContinuation = continuationDecision(
      "setup_required",
      relocatedSetup
    );
    const setupItem = boardItem(
      "setup",
      originalSetup.candidateId,
      originalSetup.localDisplayLabel,
      originalSetup.localDisplayLabel,
      originalSetup.evidenceBand,
      null,
      "open_setup_surface"
    );
    const originalSetupBoard = boardResult(
      boardInput(active, originalSetupContinuation),
      setupItem,
      []
    );
    const relocatedSetupBoard = boardResult(
      boardInput(active, relocatedSetupContinuation),
      setupItem,
      []
    );

    expect(relocatedSetup.candidateId).toBe(originalSetup.candidateId);
    expect(relocatedSetup.candidateSha256).not.toBe(
      originalSetup.candidateSha256
    );
    expect(relocatedSetupContinuation.semanticResultSha256).toBe(
      originalSetupContinuation.semanticResultSha256
    );
    expect(relocatedSetupBoard.semanticResultSha256).toBe(
      originalSetupBoard.semanticResultSha256
    );
    expect(relocatedSetupBoard.resultSha256).not.toBe(
      originalSetupBoard.resultSha256
    );
  });

  it("excludes Active artifact lineage but binds ordered Board semantics", () => {
    const active = suggestedAttention();
    const activeCandidate = active.decision.topSuggestion!;
    const primary = boardItem(
      "attention",
      activeCandidate.candidateId,
      activeCandidate.title,
      activeCandidate.title,
      "verified_attention",
      activeCandidate.projectId,
      "display",
      activeCandidate.sourceUpdatedAt,
      activeCandidate.dueAt
    );
    const continuation = emptyContinuation();
    const original = boardResult(
      boardInput(active, continuation),
      primary,
      []
    );
    const replayInputSha256 = "e".repeat(64);
    const replayedActive = sealActiveAttentionResult({
      ...withoutActiveResultHash(active),
      inputSha256: replayInputSha256,
      resultId: createActiveAttentionResultId({
        inputSha256: replayInputSha256,
        policyVersion: active.policyVersion
      })
    });
    const replayed = boardResult(
      boardInput(replayedActive, continuation),
      primary,
      []
    );

    expect(replayedActive.decision).toEqual(active.decision);
    expect(replayedActive.resultSha256).not.toBe(active.resultSha256);
    expect(replayed.dependencies.activeResultSha256).not.toBe(
      original.dependencies.activeResultSha256
    );
    expect(replayed.semanticResultSha256).toBe(original.semanticResultSha256);
    expect(replayed.resultSha256).not.toBe(original.resultSha256);

    const renamedCandidate = candidate({
      marker: "3",
      candidateKind: "recent_github_push",
      workContextId: CONTINUATION_PROJECT_ID,
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      explicitPreference: 5,
      localDisplayLabel: "Renamed recent work"
    });
    const renamedContinuation = continuationDecision(
      "offers_available",
      renamedCandidate
    );
    const renamedItem = boardItem(
      "continuation",
      renamedCandidate.candidateId,
      renamedCandidate.localDisplayLabel,
      renamedCandidate.localDisplayLabel,
      renamedCandidate.evidenceBand,
      renamedCandidate.workContextId
    );
    const baselineCandidate = continuationCandidate();
    const baselineBoard = boardResult(
      boardInput(
        noActionAttention(),
        continuationDecision("offers_available", baselineCandidate)
      ),
      boardItem(
        "continuation",
        baselineCandidate.candidateId,
        baselineCandidate.localDisplayLabel,
        baselineCandidate.localDisplayLabel,
        baselineCandidate.evidenceBand,
        baselineCandidate.workContextId
      ),
      []
    );
    const renamedBoard = boardResult(
      boardInput(noActionAttention(), renamedContinuation),
      renamedItem,
      []
    );
    expect(renamedItem.boardItemId).toBe(baselineBoard.primary?.boardItemId);
    expect(renamedBoard.semanticResultSha256).not.toBe(
      baselineBoard.semanticResultSha256
    );
    expect(renamedBoard.resultSha256).not.toBe(baselineBoard.resultSha256);
  });

  it("rejects capability escalation and rewrites of source-bound fields", () => {
    const continuation = decisionWithPrimary("offers_available");
    const input = boardInput(noActionAttention(), continuation);
    const sourceCandidate = continuation.primary!;
    const primary = boardItem(
      "continuation",
      sourceCandidate.candidateId,
      sourceCandidate.localDisplayLabel,
      sourceCandidate.localDisplayLabel,
      sourceCandidate.evidenceBand,
      sourceCandidate.workContextId
    );
    const valid = boardResult(input, primary, []);

    for (const capability of [
      "resume_exact_session",
      "external_mutation"
    ] as const) {
      expect(() =>
        sealWorkSuggestionBoardResult({
          ...withoutResultHash(valid),
          primary: { ...primary, capability }
        } as never)
      ).toThrow();
    }
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        primary: { ...primary, capability: "open_source" }
      })
    ).toThrow(/exact projection|sealed lane order/i);
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        primary: { ...primary, localDisplayLabel: "Rewritten label" }
      })
    ).toThrow(/exact projection|sealed lane order/i);
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutResultHash(valid),
        primary: { ...primary, summary: "A new semantic claim" }
      })
    ).toThrow(/source display label|exact projection/i);

    const futureSetup = candidate({
      marker: "8",
      candidateKind: "workspace_mapping",
      workContextId: null,
      evidenceBand: "setup",
      capability: "map_or_select",
      availability: "future_capability_blocked",
      explicitPreference: 5
    });
    expect(() =>
      continuationDecision("offers_available", futureSetup)
    ).toThrow();
  });

  it("filters duplicate confirmed contexts across lanes and within Continuation", () => {
    const active = suggestedAttention();
    const activeCandidate = active.decision.topSuggestion!;
    const duplicateCandidate = candidate({
      marker: "5",
      candidateKind: "recent_github_push",
      workContextId: activeCandidate.projectId,
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      explicitPreference: 4
    });
    const duplicateDecision = continuationDecision(
      "offers_available",
      duplicateCandidate
    );
    const input = boardInput(active, duplicateDecision);
    const primary = boardItem(
      "attention",
      activeCandidate.candidateId,
      activeCandidate.title,
      activeCandidate.title,
      "verified_attention",
      activeCandidate.projectId,
      "display",
      activeCandidate.sourceUpdatedAt,
      activeCandidate.dueAt
    );
    const duplicateAlternative = boardItem(
      "continuation",
      duplicateCandidate.candidateId,
      duplicateCandidate.localDisplayLabel,
      duplicateCandidate.localDisplayLabel,
      duplicateCandidate.evidenceBand,
      duplicateCandidate.workContextId
    );
    expect(() =>
      boardResult(input, primary, [duplicateAlternative])
    ).toThrow(/sealed lane order|exact projection/i);

    const first = continuationCandidate();
    const second = candidate({
      marker: "7",
      candidateKind: "recent_github_push",
      workContextId: `project_${"7".repeat(32)}`,
      evidenceBand: "single_source",
      capability: "display",
      availability: "ready",
      explicitPreference: 4
    });
    const twoCandidateDecision = continuationDecision(
      "offers_available",
      first,
      [second]
    );
    const continuationInput = boardInput(
      noActionAttention(),
      twoCandidateDecision
    );
    const firstItem = boardItem(
      "continuation",
      first.candidateId,
      first.localDisplayLabel,
      first.localDisplayLabel,
      first.evidenceBand,
      first.workContextId
    );
    const secondSourceRef = createWorkSuggestionBoardSourceItemRef({
      lane: "continuation",
      sourceStableId: second.candidateId
    });
    const rewrittenSecond = {
      ...boardItem(
        "continuation",
        second.candidateId,
        second.localDisplayLabel,
        second.localDisplayLabel,
        second.evidenceBand,
        second.workContextId
      ),
      workContextId: first.workContextId,
      boardItemId: createWorkSuggestionBoardItemId({
        lane: "continuation",
        sourceItemRef: secondSourceRef,
        workContextId: first.workContextId
      })
    };
    expect(() =>
      boardResult(continuationInput, firstItem, [rewrittenSecond])
    ).toThrow(/sealed lane order|exact projection/i);
  });

  it("keeps the public Board free of private targets, hashes, locators, and native IDs", () => {
    const publicBoard = {
      contract: WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
      schemaVersion: WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
      generatedAt: ACTIVE_FIXTURE_AS_OF,
      prominentLane: "attention",
      primary: {
        lane: "attention",
        item: {
          itemRef: `item_ref_${"A".repeat(22)}`,
          workContextRef: null,
          kind: "active_attention",
          title: "Review the current task",
          summary: "Review the current task",
          observedAt: ACTIVE_FIXTURE_AS_OF,
          expiresAt: null,
          evidenceBand: "verified_attention",
          capability: "display",
          action: null,
          caveatCodes: []
        }
      },
      alternatives: [],
      continuationStatus: "empty",
      executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
    } as const;
    const parsed = workSuggestionBoardPublicSchema.parse(publicBoard);
    expect(parsed.schemaVersion).toBe("work-suggestion-board-schema-v0.1");
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(
      /(?:privateActionTarget|resultSha256|semanticResultSha256|inputSha256|sourceItemRef|workContextId|sourceUrl|filePath|session_|managed_run_|evidence_)/u
    );
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      resultSha256: "a".repeat(64)
    }).success).toBe(false);
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      primary: {
        ...publicBoard.primary,
        item: {
          ...publicBoard.primary.item,
          summary: "A second semantic claim"
        }
      }
    }).success).toBe(false);
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      prominentLane: "none",
      primary: null,
      alternatives: [],
      continuationStatus: "available"
    }).success).toBe(false);
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      primary: {
        ...publicBoard.primary,
        item: {
          ...publicBoard.primary.item,
          summary: "Open https://private.example/repository"
        }
      }
    }).success).toBe(false);
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      primary: {
        ...publicBoard.primary,
        item: {
          ...publicBoard.primary.item,
          sourceUrl: "https://private.example/repository"
        }
      }
    }).success).toBe(false);

    const publicContinuation = {
      lane: "continuation",
      item: {
        itemRef: `item_ref_${"B".repeat(22)}`,
        workContextRef: null,
        kind: "recent_github_push",
        title: "Recent work",
        summary: "Recent work",
        observedAt: STARTED_AT,
        expiresAt: "2026-08-09T03:00:00.000Z",
        evidenceBand: "single_source",
        capability: "display",
        action: null,
        caveatCodes: []
      }
    } as const;
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      prominentLane: "continuation",
      primary: publicContinuation,
      alternatives: [publicBoard.primary],
      continuationStatus: "available"
    }).success).toBe(false);
    for (const continuationStatus of ["empty", "unavailable"] as const) {
      expect(workSuggestionBoardPublicSchema.safeParse({
        ...publicBoard,
        prominentLane: "continuation",
        primary: publicContinuation,
        alternatives: [],
        continuationStatus
      }).success).toBe(false);
    }
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...publicBoard,
      prominentLane: "continuation",
      primary: {
        ...publicContinuation,
        item: {
          ...publicContinuation.item,
          summary: "A rewritten Continuation claim"
        }
      },
      alternatives: [],
      continuationStatus: "available"
    }).success).toBe(false);
  });
});

function suggestedAttention() {
  return resolveActiveAttention(activeAttentionFixture().input);
}

function noActionAttention() {
  return resolveActiveAttention(
    activeAttentionFixture({
      githubKind: "none",
      managedScenario: "none"
    }).input
  );
}

function boardInput(
  active: ReturnType<typeof resolveActiveAttention>,
  continuation: ContinuationDecision
): WorkSuggestionBoardInput {
  return sealWorkSuggestionBoardInput({
    contract: WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
    precedencePolicyVersion:
      WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
    idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
    active,
    continuation
  });
}

function boardResult(
  input: WorkSuggestionBoardInput,
  primary: WorkSuggestionBoardItem | null,
  alternatives: WorkSuggestionBoardItem[]
) {
  const prominentLane = primary?.lane ?? "none";
  return sealWorkSuggestionBoardResult({
    contract: WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
    boardId: createWorkSuggestionBoardId({
      inputSha256: input.inputSha256,
      composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
      precedencePolicyVersion:
        WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
      idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION
    }),
    asOf: ACTIVE_FIXTURE_AS_OF,
    composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
    precedencePolicyVersion:
      WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
    idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
    input,
    dependencies: {
      inputSha256: input.inputSha256,
      activeResultSha256: input.active.resultSha256,
      continuationResultSha256: input.continuation.resultSha256,
      continuationSemanticResultSha256:
        input.continuation.semanticResultSha256
    },
    prominentLane,
    primary,
    alternatives,
    executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
  });
}

function boardItem(
  lane: "attention" | "continuation" | "setup",
  sourceStableId: string,
  localDisplayLabel: string,
  summary: string,
  evidenceBand:
    | "verified_attention"
    | "exact"
    | "corroborated"
    | "single_source"
    | "setup",
  workContextId: string | null,
  capability: "display" | "open_source" | "open_setup_surface" = "display",
  observedAt: string | null = STARTED_AT,
  expiresAt: string | null = "2026-08-09T03:00:00.000Z"
): WorkSuggestionBoardItem {
  const sourceItemRef = createWorkSuggestionBoardSourceItemRef({
    lane,
    sourceStableId
  });
  return {
    boardItemId: createWorkSuggestionBoardItemId({
      lane,
      sourceItemRef,
      workContextId
    }),
    lane,
    sourceItemRef,
    workContextId,
    localDisplayLabel,
    summary,
    observedAt,
    expiresAt,
    evidenceBand,
    capability
  };
}

function emptyContinuation(): ContinuationDecision {
  return continuationDecision("no_recent_context", null);
}

function decisionWithPrimary(
  status: "offers_available" | "setup_required"
): ContinuationDecision {
  return continuationDecision(
    status,
    status === "setup_required" ? setupCandidate() : continuationCandidate()
  );
}

function continuationDecision(
  status: "offers_available" | "setup_required" | "no_recent_context",
  primary: ContinuationCandidate | null,
  alternatives: ContinuationCandidate[] = []
): ContinuationDecision {
  return sealContinuationDecision({
    contract: CONTINUATION_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_DECISION_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    status,
    primary,
    alternatives,
    coverageCode: "COMPLETE",
    reasonCodes: [
      status === "offers_available"
        ? "OFFERS_AVAILABLE"
        : status === "setup_required"
          ? "SETUP_REQUIRED"
          : "NO_RECENT_CONTEXT"
    ],
    run: {
      runId: `continuation_run_${"1".repeat(32)}`,
      analysisId: `analysis_${"2".repeat(32)}`,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      status: "completed",
      codeCommitSha: "a".repeat(40),
      inputSha256: "b".repeat(64),
      dependencies: continuationDependencies(),
      datasetVersion: null,
      datasetSha256: null,
      observationCount: (primary === null ? 0 : 1) + alternatives.length,
      admittedCandidateCount:
        (primary === null ? 0 : 1) + alternatives.length,
      excludedCandidateCount: 0,
      errors: [],
      latencyMs: 1,
      tokenUsage: null
    }
  });
}

function continuationCandidate(): ContinuationCandidate {
  return candidate({
    marker: "3",
    candidateKind: "recent_github_push",
    workContextId: CONTINUATION_PROJECT_ID,
    evidenceBand: "single_source",
    capability: "display",
    availability: "ready",
    explicitPreference: 5
  });
}

function setupCandidate(): ContinuationCandidate {
  return candidate({
    marker: "4",
    candidateKind: "workspace_mapping",
    workContextId: null,
    evidenceBand: "setup",
    capability: "open_setup_surface",
    availability: "setup_required",
    explicitPreference: 5
  });
}

function candidate(input: {
  marker: string;
  candidateKind: "recent_github_push" | "workspace_mapping";
  workContextId: string | null;
  evidenceBand: "single_source" | "setup";
  capability: "display" | "open_setup_surface" | "map_or_select";
  availability:
    | "ready"
    | "setup_required"
    | "future_capability_blocked";
  explicitPreference: number;
  localDisplayLabel?: string;
  privateTargetMarker?: string;
}): ContinuationCandidate {
  const sourceObservationIds = [
    `continuation_observation_${input.marker.repeat(32)}`
  ];
  const candidateId = createContinuationCandidateId({
    candidateKind: input.candidateKind,
    workContextId: input.workContextId,
    sourceObservationIds,
    observedAt: STARTED_AT
  });
  const privateTargetMarker = input.privateTargetMarker ?? "8";
  return sealContinuationCandidate({
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateId,
    candidateKind: input.candidateKind,
    workContextId: input.workContextId,
    sourceObservationIds,
    localDisplayLabel:
      input.localDisplayLabel ??
      (input.evidenceBand === "setup" ? "Connect workspace" : "Recent work"),
    observedAt: STARTED_AT,
    expiresAt: "2026-08-09T03:00:00.000Z",
    evidenceBand: input.evidenceBand,
    capability: input.capability,
    availability: input.availability,
    continuityScore: 70 + input.explicitPreference,
    scoreBreakdown: {
      recency: 35,
      exactCorroboration: 20,
      resumability: 10,
      localContinuity: 5,
      explicitPreference: input.explicitPreference
    },
    reasonCodes: ["RECENT_ACTIVITY"],
    caveatCodes: [],
    privateActionTarget:
      input.capability === "open_setup_surface"
        ? {
            capability: "open_setup_surface",
            targetRef: `private_target_${privateTargetMarker.repeat(32)}`
          }
        : null
  });
}

function continuationDependencies() {
  return {
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    activityWindowPolicyVersion:
      CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    ruleVersion: CONTINUATION_RULE_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    resolverVersion: CONTINUATION_RESOLVER_VERSION,
    actionPolicyVersion: CONTINUATION_ACTION_POLICY_VERSION,
    publicProjectionPolicyVersion:
      CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
    workContextRegistryContract: "work-context-registry-v1" as const,
    workContextRegistrySha256: "c".repeat(64),
    github: {
      state: "unavailable" as const,
      source: "github" as const,
      reasonCode: "SOURCE_MISSING" as const
    },
    codex: {
      state: "unavailable" as const,
      source: "codex" as const,
      reasonCode: "SOURCE_MISSING" as const
    },
    configSha256: "d".repeat(64)
  };
}

function withoutResultHash<
  T extends { resultSha256: string; semanticResultSha256: string }
>(
  result: T
): Omit<T, "resultSha256" | "semanticResultSha256"> {
  const {
    semanticResultSha256: _semanticResultSha256,
    resultSha256: _resultSha256,
    ...content
  } = result;
  return content;
}

function withoutActiveResultHash(
  result: ReturnType<typeof suggestedAttention>
) {
  const { resultSha256: _resultSha256, ...content } = result;
  return content;
}
