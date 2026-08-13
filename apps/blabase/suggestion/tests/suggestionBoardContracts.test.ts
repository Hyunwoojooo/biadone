import { describe, expect, it } from "vitest";

import { runtimeCanonicalJson } from "../src/crossSource/canonicalHash";
import {
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
  WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
  WORK_SUGGESTION_BOARD_RESULT_HASH_DOMAIN,
  WORK_SUGGESTION_BOARD_SEMANTIC_RESULT_HASH_DOMAIN,
  WORK_SUGGESTION_BOARD_EXECUTION_POLICY,
  createWorkSuggestionBoardItemId,
  createWorkSuggestionBoardSourceItemRef,
  sealWorkSuggestionBoardResult,
  verifyWorkSuggestionBoardInputIntegrity,
  verifyWorkSuggestionBoardResultIntegrity,
  workSuggestionBoardInputSchema,
  workSuggestionBoardItemSchema,
  workSuggestionBoardPublicSchema,
  workSuggestionBoardResultSchema
} from "../src/suggestionBoard";
import {
  authenticBoardFixture,
  composeAuthenticBoard
} from "./fixtures/suggestionBoardFixture";

describe("Work Suggestion Board v0.3 contracts", () => {
  it("binds the exact Active result and outer plus nested R-003 hashes", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    const { board } = composed;
    expect(board.contract).toBe("work-suggestion-board-result-v0.3");
    expect(board.schemaVersion).toBe("work-suggestion-board-schema-v0.3");
    expect(board.input.contract).toBe("work-suggestion-board-input-v0.3");
    expect(WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN).toBe(
      "work-suggestion-board-input-hash-v0.3"
    );
    expect(WORK_SUGGESTION_BOARD_RESULT_HASH_DOMAIN).toBe(
      "work-suggestion-board-result-hash-v0.3"
    );
    expect(WORK_SUGGESTION_BOARD_SEMANTIC_RESULT_HASH_DOMAIN).toBe(
      "work-suggestion-board-semantic-result-hash-v0.3"
    );
    expect(board.composerVersion).toBe("work-suggestion-board-composer-v0.1");
    expect(board.precedencePolicyVersion).toBe(
      "attention-continuation-setup-precedence-v0.1"
    );
    expect(board.idPolicyVersion).toBe(
      "work-suggestion-board-id-policy-v0.1"
    );
    expect(board.input.active).toBe(fixture.bundle.active);
    expect(board.input.continuation).toBe(
      fixture.bundle.continuationResolvedDecision
    );
    expect(board.dependencies).toEqual({
      inputSha256: board.input.inputSha256,
      activeResultSha256: fixture.bundle.active.resultSha256,
      continuationResolvedResultSha256:
        fixture.bundle.continuationResolvedDecision.resultSha256,
      continuationResultSha256:
        fixture.bundle.continuationResolvedDecision.decision.resultSha256,
      continuationSemanticResultSha256:
        fixture.bundle.continuationResolvedDecision.decision
          .semanticResultSha256
    });
    expect(verifyWorkSuggestionBoardInputIntegrity(board.input)).toBe(true);
    expect(verifyWorkSuggestionBoardResultIntegrity(board)).toBe(true);
  });

  it("rejects bare decisions, mixed versions, nested tampering, and hash tampering", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const input = composed.board.input;

    for (const invalid of [
      {
        ...input,
        continuation: input.continuation.decision
      },
      {
        ...input,
        schemaVersion: "work-suggestion-board-schema-v0.2"
      },
      {
        ...input,
        continuation: {
          ...input.continuation,
          schemaVersion: "continuation-resolved-decision-schema-v9"
        }
      },
      {
        ...input,
        active: {
          ...input.active,
          decision: {
            ...input.active.decision,
            scopeStatement: "forged"
          }
        }
      },
      { ...input, inputSha256: "0".repeat(64) }
    ]) {
      expect(() => workSuggestionBoardInputSchema.safeParse(invalid)).not.toThrow();
      expect(workSuggestionBoardInputSchema.safeParse(invalid).success).toBe(false);
      expect(verifyWorkSuggestionBoardInputIntegrity(invalid)).toBe(false);
    }
  });

  it("requires the complete expected top-three sequence, not an arbitrary prefix", () => {
    const fixture = authenticBoardFixture({ continuationCount: 3 });
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const board = composed.board;
    expect([board.primary, ...board.alternatives]).toHaveLength(3);

    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutBoardHashes(board),
        alternatives: board.alternatives.slice(0, 1)
      })
    ).toThrow(/exact projection|sealed lane order/i);
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutBoardHashes(board),
        alternatives: [...board.alternatives].reverse()
      })
    ).toThrow(/exact projection|sealed lane order/i);
  });

  it("keeps execution authority read-only and rejects capability elevation", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const board = composed.board;
    expect(board.executionPolicy).toEqual(
      WORK_SUGGESTION_BOARD_EXECUTION_POLICY
    );
    expect(() =>
      sealWorkSuggestionBoardResult({
        ...withoutBoardHashes(board),
        executionPolicy: {
          automaticExecutionAllowed: true,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      } as never)
    ).toThrow();
    if (board.primary !== null) {
      expect(() =>
        sealWorkSuggestionBoardResult({
          ...withoutBoardHashes(board),
          primary: {
            ...board.primary,
            capability: "external_mutation"
          }
        } as never)
      ).toThrow();
    }
  });

  it("preserves a valid open-source target and rejects capability-target mismatches", () => {
    const sourceItemRef = createWorkSuggestionBoardSourceItemRef({
      lane: "continuation",
      sourceStableId: `continuation_candidate_${"1".repeat(32)}`
    });
    const privateActionTarget = {
      capability: "open_source" as const,
      targetRef: `private_target_${"2".repeat(32)}`
    };
    const openSourceItem = {
      boardItemId: createWorkSuggestionBoardItemId({
        lane: "continuation",
        sourceItemRef,
        workContextId: `project_${"3".repeat(32)}`
      }),
      lane: "continuation" as const,
      sourceItemRef,
      workContextId: `project_${"3".repeat(32)}`,
      localDisplayLabel: "Recent source activity",
      summary: "Recent source activity",
      observedAt: "2026-08-13T11:30:00.000Z",
      expiresAt: "2026-08-20T11:30:00.000Z",
      evidenceBand: "single_source" as const,
      capability: "open_source" as const,
      privateActionTarget
    };
    const parsed = workSuggestionBoardItemSchema.parse(openSourceItem);
    expect(parsed.privateActionTarget).toEqual(privateActionTarget);

    expect(workSuggestionBoardItemSchema.safeParse({
      ...openSourceItem,
      capability: "display"
    }).success).toBe(false);
    expect(workSuggestionBoardItemSchema.safeParse({
      ...openSourceItem,
      privateActionTarget: {
        capability: "open_setup_surface",
        targetRef: privateActionTarget.targetRef
      }
    }).success).toBe(false);
  });

  it("fails closed for hostile unknown values", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const throwing = Object.defineProperty({}, "contract", {
      get(): never {
        throw new Error("hostile getter");
      }
    });
    for (const value of [BigInt(1), Number.NaN, undefined, cycle, throwing]) {
      expect(() => workSuggestionBoardInputSchema.safeParse(value)).not.toThrow();
      expect(workSuggestionBoardInputSchema.safeParse(value).success).toBe(false);
      expect(() => workSuggestionBoardResultSchema.safeParse(value)).not.toThrow();
      expect(workSuggestionBoardResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it("keeps nonempty public v0.1 Boards safe from private text and lineage", () => {
    const attentionBoard = {
      contract: WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
      schemaVersion: WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
      generatedAt: "2026-08-13T12:00:00.000Z",
      prominentLane: "attention",
      primary: {
        lane: "attention",
        item: {
          itemRef: `item_ref_${"A".repeat(22)}`,
          workContextRef: null,
          kind: "active_attention",
          title: "Review the current task",
          summary: "Review the current task",
          observedAt: "2026-08-13T11:30:00.000Z",
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
    const continuationBoard = {
      ...attentionBoard,
      prominentLane: "continuation",
      primary: {
        lane: "continuation",
        item: {
          itemRef: `item_ref_${"B".repeat(22)}`,
          workContextRef: `context_ref_${"C".repeat(22)}`,
          kind: "recent_github_push",
          title: "Recent source activity",
          summary: "Recent source activity",
          observedAt: "2026-08-13T11:30:00.000Z",
          expiresAt: "2026-08-20T11:30:00.000Z",
          evidenceBand: "single_source",
          capability: "display",
          action: null,
          caveatCodes: []
        }
      },
      continuationStatus: "available"
    } as const;
    expect(workSuggestionBoardPublicSchema.parse(attentionBoard)).toEqual(
      attentionBoard
    );
    expect(workSuggestionBoardPublicSchema.parse(continuationBoard)).toEqual(
      continuationBoard
    );
    expect(attentionBoard.contract).toBe("work-suggestion-board-public-v0.1");
    expect(attentionBoard.schemaVersion).toBe("work-suggestion-board-schema-v0.1");
    expect(JSON.stringify([attentionBoard, continuationBoard])).not.toMatch(
      /(?:resultSha256|inputSha256|privateActionTarget|sourceItemRef|workContextId)/u
    );

    for (const capability of ["open_source", "open_setup_surface"] as const) {
      for (const action of [
        null,
        {
          contract: "continuation-public-action-ref-v0.1",
          actionRef: `action_ref_${"D".repeat(22)}`,
          capability,
          expiresAt: "2026-08-13T12:05:00.000Z",
          explicitUserActionRequired: true
        }
      ]) {
        expect(workSuggestionBoardPublicSchema.safeParse({
          ...attentionBoard,
          primary: {
            ...attentionBoard.primary,
            item: {
              ...attentionBoard.primary.item,
              capability,
              action
            }
          }
        }).success).toBe(false);
      }
    }

    for (const sentinel of [
      "Open https://private.example/repository",
      "/Users/private/worktree",
      "f".repeat(40),
      `session_${"9".repeat(24)}`
    ]) {
      for (const board of [attentionBoard, continuationBoard]) {
        expect(workSuggestionBoardPublicSchema.safeParse({
          ...board,
          primary: {
            ...board.primary,
            item: {
              ...board.primary.item,
              title: sentinel,
              summary: sentinel
            }
          }
        }).success).toBe(false);
      }
    }
    expect(workSuggestionBoardPublicSchema.safeParse({
      ...attentionBoard,
      primary: {
        ...attentionBoard.primary,
        item: {
          ...attentionBoard.primary.item,
          sourceUrl: "https://private.example/repository"
        }
      }
    }).success).toBe(false);
  });

  it("seals deterministically without mutating exact lane objects", () => {
    const fixture = authenticBoardFixture();
    const activeBefore = runtimeCanonicalJson(fixture.bundle.active);
    const resolvedBefore = runtimeCanonicalJson(
      fixture.bundle.continuationResolvedDecision
    );
    const first = composeAuthenticBoard(fixture);
    const second = composeAuthenticBoard(fixture);
    expect(second).toEqual(first);
    expect(runtimeCanonicalJson(fixture.bundle.active)).toBe(activeBefore);
    expect(runtimeCanonicalJson(fixture.bundle.continuationResolvedDecision)).toBe(
      resolvedBefore
    );
  });
});

function withoutBoardHashes<T extends {
  resultSha256: string;
  semanticResultSha256: string;
}>(result: T): Omit<T, "resultSha256" | "semanticResultSha256"> {
  const {
    resultSha256: _resultSha256,
    semanticResultSha256: _semanticResultSha256,
    ...content
  } = result;
  return content;
}

// Compile-time checks for the stable policy tuple used by hand-sealed callers.
const _policyTuple = {
  contract: WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  inputContract: WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
  composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  precedencePolicyVersion: WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
  idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION
} as const;

void _policyTuple;
