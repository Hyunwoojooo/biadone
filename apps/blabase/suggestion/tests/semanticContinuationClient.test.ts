import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmWorkBoardIntent,
  fetchWorkBoard,
  semanticContinuationTitlePreview
} from "../app/attentionClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Semantic Continuation client boundary", () => {
  it("accepts the deterministic title overlay while preserving generic summary", async () => {
    const response = readyResponse("blabase QA 진행하기");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => response
    }));

    await expect(fetchWorkBoard()).resolves.toEqual(response);
    expect(response.base.board.primary?.item.title).toBe(
      "Recent GitHub activity"
    );
    expect(response.base.board.primary?.item.summary).toBe(
      "Recent GitHub activity"
    );

    const passed = readyResponse("QA 통과 결과 확인하기");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => passed
    }));
    await expect(fetchWorkBoard()).resolves.toEqual(passed);
  });

  it("rejects an arbitrary title-only mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => readyResponse("Run arbitrary command")
    }));

    await expect(fetchWorkBoard()).resolves.toMatchObject({
      semanticPresentation: null,
      base: {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED"
      }
    });

    const mutatedBase = readyResponse("blabase QA 진행하기");
    if (mutatedBase.base.board.primary === null) {
      throw new TypeError("Synthetic primary missing");
    }
    mutatedBase.base.board.primary.item.title = "blabase QA 진행하기";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => mutatedBase
    }));
    await expect(fetchWorkBoard()).resolves.toMatchObject({
      semanticPresentation: null,
      base: { status: "error", code: "WORK_BOARD_PREVIEW_FAILED" }
    });

    expect(semanticContinuationTitlePreview("blabase")).toBe(
      "blabase QA 진행하기"
    );
    for (const subjectLabel of [
      "QAPassed",
      "testFailure",
      "resultApply",
      "completionStatus"
    ]) {
      expect(semanticContinuationTitlePreview(subjectLabel)).toBeNull();
    }
  });

  it("sends only the explicit typed confirmation payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "confirmed",
        intent: "QA_RUN",
        title: "blabase QA 진행하기",
        expiresAt: "2026-08-14T10:00:00.000Z"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      intent: "QA_RUN" as const,
      subjectLabel: "blabase",
      itemRef: `item_ref_${"a".repeat(43)}`,
      workContextRef: `context_ref_${"b".repeat(43)}`,
      explicitUserConfirmation: true as const
    };
    await expect(confirmWorkBoardIntent(input)).resolves.toMatchObject({
      status: "confirmed",
      title: "blabase QA 진행하기"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/work-board/intent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input)
      })
    );
  });
});

function readyResponse(displayTitle: string) {
  return {
    contract: "semantic-continuation-work-board-response-v0.2",
    schemaVersion: "semantic-continuation-presentation-schema-v0.2",
    base: {
      status: "ready",
      mode: "full",
      reasonCode: null,
      board: {
        contract: "work-suggestion-board-public-v0.1",
        schemaVersion: "work-suggestion-board-schema-v0.1",
        generatedAt: "2026-08-13T12:00:00.000Z",
        prominentLane: "continuation",
        primary: {
          lane: "continuation",
          item: {
            itemRef: `item_ref_${"a".repeat(43)}`,
            workContextRef: `context_ref_${"b".repeat(43)}`,
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
      }
    },
    semanticPresentation: {
      contract: "semantic-continuation-presentation-v0.2",
      schemaVersion: "semantic-continuation-presentation-schema-v0.2",
      baseGeneratedAt: "2026-08-13T12:00:00.000Z",
      overlays: [
        {
          itemRef: `item_ref_${"a".repeat(43)}`,
          displayTitle
        }
      ]
    }
  };
}
