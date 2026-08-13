import { describe, expect, it } from "vitest";

import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../src/crossSource/canonicalHash";
import {
  continuationResolvedDecisionSchema,
  continuationResolvedDecisionSha256
} from "../src/continuation/resolveContinuation";
import {
  WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
  composeWorkSuggestionBoard,
  verifyWorkSuggestionBoardResultAgainstInput,
  workSuggestionBoardResultSchema
} from "../src/suggestionBoard";
import {
  BOARD_FIXTURE_SECRET,
  authenticBoardFixture,
  composeAuthenticBoard
} from "./fixtures/suggestionBoardFixture";

const REJECTION = {
  ok: false,
  code: "WORK_SUGGESTION_BOARD_INPUT_REJECTED"
} as const;

describe("composeWorkSuggestionBoard", () => {
  it("accepts a genuine full R1/R2/R3 chain and verifies exact recomposition", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(
      verifyWorkSuggestionBoardResultAgainstInput(
        fixture.bundle,
        fixture.trustedOptions,
        composed.board
      )
    ).toBe(true);
    expect(composed.board.prominentLane).toBe("attention");
    const {
      inputSha256,
      ...exactInputContent
    } = composed.board.input;
    expect(inputSha256).toBe(runtimeSha256({
      domain: WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
      value: exactInputContent
    }));
  });

  it("rejects a schema-valid lane value that would be trim-transformed", () => {
    const fixture = authenticBoardFixture({ active: "no_action" });
    const resolved = fixture.bundle.continuationResolvedDecision;
    const primary = resolved.decision.primary;
    expect(primary).not.toBeNull();
    if (primary === null) return;
    const trimTransforming = {
      ...resolved,
      decision: {
        ...resolved.decision,
        primary: {
          ...primary,
          localDisplayLabel: ` ${primary.localDisplayLabel} `
        }
      }
    };

    expect(
      continuationResolvedDecisionSchema.safeParse(trimTransforming).success
    ).toBe(true);
    expect(
      composeWorkSuggestionBoard(
        {
          ...fixture.bundle,
          continuationResolvedDecision: trimTransforming
        },
        fixture.trustedOptions
      )
    ).toEqual(REJECTION);
  });

  it("rejects a bare base Decision before composing a Board", () => {
    const fixture = authenticBoardFixture();
    expect(
      composeWorkSuggestionBoard(
        {
          ...fixture.bundle,
          continuationResolvedDecision:
            fixture.bundle.continuationResolvedDecision.decision
        },
        fixture.trustedOptions
      )
    ).toEqual(REJECTION);
  });

  it("rejects locally rehashed outer forgery and every trusted authority mismatch", () => {
    const fixture = authenticBoardFixture();
    const resolved = fixture.bundle.continuationResolvedDecision;
    const forgedContent = {
      ...withoutOuterResultHash(resolved),
      sourceAssessments: resolved.sourceAssessments.map((assessment, index) =>
        index === 0
          ? { ...assessment, coverage: "unknown" as const }
          : assessment
      ) as typeof resolved.sourceAssessments
    };
    const forged = {
      ...forgedContent,
      resultSha256: continuationResolvedDecisionSha256(forgedContent)
    };
    expect(
      composeWorkSuggestionBoard(
        { ...fixture.bundle, continuationResolvedDecision: forged },
        fixture.trustedOptions
      )
    ).toEqual(REJECTION);

    for (const trustedOptions of [
      { ...fixture.trustedOptions, installationSecret: "wrong-secret" },
      {
        ...fixture.trustedOptions,
        expectedRegistrySha256: "0".repeat(64)
      },
      {
        ...fixture.trustedOptions,
        expectedCodeCommitSha: "e".repeat(40)
      },
      {
        ...fixture.trustedOptions,
        expectedDatasetVersion: "forged-v1",
        expectedDatasetSha256: "e".repeat(64)
      }
    ]) {
      expect(
        composeWorkSuggestionBoard(fixture.bundle, trustedOptions)
      ).toEqual(REJECTION);
    }
    const wrongAsOf = {
      ...fixture.bundle,
      continuationResolutionEnvelope: {
        ...fixture.bundle.continuationResolutionEnvelope,
        asOf: "2026-08-02T02:59:59.999Z"
      }
    };
    expect(
      composeWorkSuggestionBoard(wrongAsOf, fixture.trustedOptions)
    ).toEqual(REJECTION);
  });

  it("rejects an Active tamper and preserves exact Active bytes/hash/reference", () => {
    const fixture = authenticBoardFixture();
    const active = fixture.bundle.active;
    const before = runtimeCanonicalJson(active);
    const hashBefore = active.resultSha256;
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.board.input.active).toBe(active);
    expect(runtimeCanonicalJson(active)).toBe(before);
    expect(active.resultSha256).toBe(hashBefore);

    expect(
      composeWorkSuggestionBoard(
        {
          ...fixture.bundle,
          active: {
            ...active,
            decision: {
              ...active.decision,
              scopeStatement: "tampered"
            }
          }
        },
        fixture.trustedOptions
      )
    ).toEqual(REJECTION);
  });

  it("preserves Active-first lane order and deduplicates only equal non-null WorkContext", () => {
    const duplicate = authenticBoardFixture({
      continuationCount: 2,
      continuationMappedToActive: true
    });
    const composed = composeAuthenticBoard(duplicate);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const items = [composed.board.primary!, ...composed.board.alternatives];
    expect(items[0]?.lane).toBe("attention");
    expect(items.some((item) => item.workContextId === items[0]?.workContextId && item.lane !== "attention")).toBe(false);
    expect(items.map((item) => item.lane)).toEqual([
      "attention",
      "continuation"
    ]);

    const clarification = authenticBoardFixture({
      active: "clarification"
    });
    const clarificationBoard = composeAuthenticBoard(clarification);
    expect(clarificationBoard.ok).toBe(true);
    if (!clarificationBoard.ok) return;
    expect(clarificationBoard.board.primary?.lane).toBe("attention");
    expect(clarificationBoard.board.primary?.observedAt).toBeNull();
  });

  it("keeps same label/different WorkContext and distinct null Setup candidates", () => {
    const sameLabel = authenticBoardFixture({
      active: "no_action",
      continuationCount: 3
    });
    const ready = composeAuthenticBoard(sameLabel);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const readyItems = [ready.board.primary!, ...ready.board.alternatives];
    expect(readyItems.map((item) => item.localDisplayLabel)).toEqual([
      "Recent GitHub activity",
      "Recent GitHub activity",
      "Recent GitHub activity"
    ]);
    expect(new Set(readyItems.map((item) => item.workContextId)).size).toBe(3);

    const setup = authenticBoardFixture({
      active: "no_action",
      continuationCount: 3,
      mapContinuation: false
    });
    const setupBoard = composeAuthenticBoard(setup);
    expect(setupBoard.ok).toBe(true);
    if (!setupBoard.ok) return;
    const setupItems = [setupBoard.board.primary!, ...setupBoard.board.alternatives];
    expect(setupItems).toHaveLength(3);
    expect(setupItems.every((item) => item.lane === "setup")).toBe(true);
    expect(setupItems.every((item) => item.workContextId === null)).toBe(true);
    const sourceCandidates = [
      setup.bundle.continuationResolvedDecision.decision.primary!,
      ...setup.bundle.continuationResolvedDecision.decision.alternatives
    ];
    expect(setupItems.map((item) => item.privateActionTarget)).toEqual(
      sourceCandidates.map((candidate) => candidate.privateActionTarget)
    );
  });

  it("excludes private target locators from semantics but binds visible changes", () => {
    const firstFixture = authenticBoardFixture({
      active: "no_action",
      mapContinuation: false,
      sourceIdOffset: 0
    });
    const relocatedFixture = authenticBoardFixture({
      active: "no_action",
      mapContinuation: false,
      sourceIdOffset: 100
    });
    const visiblyChangedFixture = authenticBoardFixture({
      active: "no_action",
      mapContinuation: false,
      sourceIdOffset: 0,
      activityAt: "2026-08-02T02:20:00.000Z"
    });
    const first = composeAuthenticBoard(firstFixture);
    const relocated = composeAuthenticBoard(relocatedFixture);
    const visiblyChanged = composeAuthenticBoard(visiblyChangedFixture);
    expect(first.ok).toBe(true);
    expect(relocated.ok).toBe(true);
    expect(visiblyChanged.ok).toBe(true);
    if (!first.ok || !relocated.ok || !visiblyChanged.ok) return;

    expect(first.board.primary?.privateActionTarget).not.toEqual(
      relocated.board.primary?.privateActionTarget
    );
    expect(relocated.board.semanticResultSha256).toBe(
      first.board.semanticResultSha256
    );
    expect(relocated.board.resultSha256).not.toBe(first.board.resultSha256);
    expect(visiblyChanged.board.primary?.observedAt).not.toBe(
      first.board.primary?.observedAt
    );
    expect(visiblyChanged.board.semanticResultSha256).not.toBe(
      first.board.semanticResultSha256
    );
  });

  it("is deterministic, exact top-three, and rejects a locally valid omitted alternative", () => {
    const fixture = authenticBoardFixture({
      active: "no_action",
      continuationCount: 3
    });
    const first = composeAuthenticBoard(fixture);
    const second = composeAuthenticBoard(fixture);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect([first.board.primary, ...first.board.alternatives]).toHaveLength(3);

    const omitted = {
      ...first.board,
      alternatives: first.board.alternatives.slice(0, 1)
    };
    expect(workSuggestionBoardResultSchema.safeParse(omitted).success).toBe(false);
    expect(
      verifyWorkSuggestionBoardResultAgainstInput(
        fixture.bundle,
        fixture.trustedOptions,
        omitted
      )
    ).toBe(false);
  });

  it("never serializes the installation secret and fails closed for hostile boundaries", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(JSON.stringify(composed.board)).not.toContain(BOARD_FIXTURE_SECRET);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const throwing = Object.defineProperty({}, "active", {
      get(): never {
        throw new Error("hostile getter");
      }
    });
    for (const value of [BigInt(1), cycle, throwing, undefined, []]) {
      expect(() => composeWorkSuggestionBoard(value, fixture.trustedOptions)).not.toThrow();
      expect(composeWorkSuggestionBoard(value, fixture.trustedOptions)).toEqual(REJECTION);
      expect(() =>
        verifyWorkSuggestionBoardResultAgainstInput(
          value,
          fixture.trustedOptions,
          composed.board
        )
      ).not.toThrow();
      expect(
        verifyWorkSuggestionBoardResultAgainstInput(
          value,
          fixture.trustedOptions,
          composed.board
        )
      ).toBe(false);
    }
  });
});

function withoutOuterResultHash<T extends { resultSha256: string }>(
  value: T
): Omit<T, "resultSha256"> {
  const { resultSha256: _resultSha256, ...content } = value;
  return content;
}
