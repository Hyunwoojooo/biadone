import { describe, expect, it } from "vitest";

import type { WorkSuggestionBoardPublic } from "../src/suggestionBoard/contracts";
import { workSuggestionBoardPublicSchema } from "../src/suggestionBoard/contracts";
import { workBoardApiResponseSchema } from "../src/suggestionBoard/monitoringSchema";
import {
  buildSemanticContinuationTitlePresentation,
  createEmptySemanticContinuationIntentStore,
  createSemanticContinuationIntentDecision,
  createSemanticContinuationWorkBoardResponse,
  findSemanticContinuationConfirmationTarget,
  sealSemanticContinuationIntentStore
} from "../src/semanticContinuation";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const REGISTRY_SHA = "f".repeat(64);
const INSTALLATION_SECRET = "e".repeat(64);

describe("Semantic Continuation title overlay", () => {
  it("returns a separate displayTitle envelope and leaves the base Board byte-identical", () => {
    const board = genericBoard();
    const base = workBoardApiResponseSchema.parse({
      status: "ready",
      mode: "full",
      reasonCode: null,
      board
    });
    const before = JSON.stringify(base);
    const presentation = buildSemanticContinuationTitlePresentation({
      board,
      registrySha256: REGISTRY_SHA,
      store: storeFor(board)
    });
    const response = createSemanticContinuationWorkBoardResponse(
      base,
      presentation
    );

    expect(presentation).toEqual({
      contract: "semantic-continuation-presentation-v0.2",
      schemaVersion: "semantic-continuation-presentation-schema-v0.2",
      baseGeneratedAt: board.generatedAt,
      overlays: [
        { itemRef: ITEM_REF, displayTitle: "blabase QA 진행하기" }
      ]
    });
    expect(JSON.stringify(response.base)).toBe(before);
    expect(workBoardApiResponseSchema.parse(response.base)).toEqual(base);
    expect(board.primary?.item.title).toBe("Recent GitHub activity");
    expect(board.primary?.item.summary).toBe("Recent GitHub activity");
  });

  it("returns no presentation for missing, corrupt, stale, or mismatched state", () => {
    const board = genericBoard();
    const activeStore = storeFor(board);
    const emptyStore = createEmptySemanticContinuationIntentStore(
      board.generatedAt,
      INSTALLATION_SECRET
    );
    const staleBoard = { ...board, generatedAt: "2026-08-14T12:00:00.000Z" };

    const presentations = [
      buildSemanticContinuationTitlePresentation({
          board,
          registrySha256: REGISTRY_SHA,
          store: null
        }),
      buildSemanticContinuationTitlePresentation({
          board,
          registrySha256: REGISTRY_SHA,
          store: { contract: "corrupt-private-store" }
        }),
      buildSemanticContinuationTitlePresentation({
          board,
          registrySha256: REGISTRY_SHA,
          store: emptyStore
        }),
      buildSemanticContinuationTitlePresentation({
          board,
          registrySha256: "0".repeat(64),
          store: activeStore
        }),
      buildSemanticContinuationTitlePresentation({
          board: staleBoard,
          registrySha256: REGISTRY_SHA,
          store: activeStore
        })
    ];
    for (const presentation of presentations) {
      expect(presentation).toBeNull();
    }
    expect(JSON.stringify(board)).toBe(JSON.stringify(genericBoard()));
  });

  it("finds only a display-only mapped continuation target", () => {
    const board = genericBoard();
    expect(
      findSemanticContinuationConfirmationTarget(board, {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF
      })
    ).toEqual({
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      observedAt: "2026-08-13T10:00:00.000Z",
      candidateExpiresAt: "2026-08-14T10:00:00.000Z"
    });
    expect(
      findSemanticContinuationConfirmationTarget(
        {
          ...board,
          primary: board.primary && { ...board.primary, lane: "setup" }
        },
        { itemRef: ITEM_REF, workContextRef: CONTEXT_REF }
      )
    ).toBeNull();
  });
});

function genericBoard(): WorkSuggestionBoardPublic {
  return workSuggestionBoardPublicSchema.parse({
    contract: "work-suggestion-board-public-v0.1",
    schemaVersion: "work-suggestion-board-schema-v0.1",
    generatedAt: "2026-08-13T12:05:00.000Z",
    prominentLane: "continuation",
    primary: {
      lane: "continuation",
      item: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        kind: "recent_github_push",
        title: "Recent GitHub activity",
        summary: "Recent GitHub activity",
        observedAt: "2026-08-13T10:00:00.000Z",
        expiresAt: "2026-08-14T10:00:00.000Z",
        evidenceBand: "single_source",
        capability: "display",
        action: null,
        caveatCodes: []
      }
    },
    alternatives: [],
    continuationStatus: "available",
    executionPolicy: {
      automaticExecutionAllowed: false,
      explicitUserActionRequired: true,
      externalMutationAllowed: false
    }
  });
}

function storeFor(board: WorkSuggestionBoardPublic) {
  const target = findSemanticContinuationConfirmationTarget(board, {
    itemRef: ITEM_REF,
    workContextRef: CONTEXT_REF
  });
  if (target === null) throw new TypeError("Synthetic target missing");
  const empty = createEmptySemanticContinuationIntentStore(
    "2026-08-13T12:00:00.000Z",
    INSTALLATION_SECRET
  );
  const decision = createSemanticContinuationIntentDecision({
    confirmation: {
      intent: "QA_RUN",
      subjectLabel: "blabase",
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    },
    target,
    registrySha256: REGISTRY_SHA,
    confirmedAt: "2026-08-13T12:00:00.000Z",
    supersedesDecisionId: null
  });
  return sealSemanticContinuationIntentStore(
    {
      contract: empty.contract,
      schemaVersion: empty.schemaVersion,
      authKeyId: empty.authKeyId,
      revision: 1,
      updatedAt: decision.confirmedAt,
      decisions: [decision]
    },
    INSTALLATION_SECRET
  );
}
