import { describe, expect, it } from "vitest";

import {
  buildLauncherWorkBoardProjection,
  launcherWorkBoardProjectionSchema
} from "../src/launcher";
import type { SemanticContinuationWorkBoardResponse } from "../src/semanticContinuation/contracts";
import { workBoardResponse } from "./fixtures/launcherWorkBoardFixture";

describe("launcher Work Board projection", () => {
  it("flattens primary and alternatives in order and applies only the exact semantic title", () => {
    const input = workBoardResponse();
    const before = structuredClone(input);

    expect(buildLauncherWorkBoardProjection(input)).toEqual({
      contract: "blabase-launcher-work-board-v1",
      generatedAt: "2026-08-13T09:00:00.000Z",
      mode: "full",
      prominentLane: "attention",
      continuationStatus: "available",
      items: [
        {
          lane: "attention",
          title: "현재 확인할 Attention",
          evidenceBand: "verified_attention",
          caveatCodes: [],
          expiresAt: null,
          capability: "display",
          action: null
        },
        {
          lane: "continuation",
          title: "QA 진행 상태 확인하기",
          evidenceBand: "corroborated",
          caveatCodes: ["SOURCE_COVERAGE_PARTIAL"],
          expiresAt: "2026-08-14T08:00:00.000Z",
          capability: "display",
          action: null
        },
        {
          lane: "setup",
          title: "작업공간 연결하기",
          evidenceBand: "setup",
          caveatCodes: ["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"],
          expiresAt: "2026-08-14T08:00:00.000Z",
          capability: "display",
          action: null
        }
      ]
    });
    expect(input).toEqual(before);
  });

  it("accepts a full empty Board and preserves active-only fallback as a typed result", () => {
    const empty = workBoardResponse();
    if (empty.base.status !== "ready") throw new Error("ready fixture");
    empty.base.board.primary = null;
    empty.base.board.alternatives = [];
    empty.base.board.prominentLane = "none";
    empty.base.board.continuationStatus = "empty";
    empty.semanticPresentation = null;
    expect(buildLauncherWorkBoardProjection(empty)).toMatchObject({
      mode: "full",
      prominentLane: "none",
      continuationStatus: "empty",
      items: []
    });

    const fallback = workBoardResponse();
    if (fallback.base.status !== "ready") throw new Error("ready fixture");
    fallback.base.mode = "active_only_fallback";
    fallback.base.reasonCode = "CONTINUATION_PREREQUISITES_UNAVAILABLE";
    fallback.base.board.primary = fallback.base.board.primary;
    fallback.base.board.alternatives = [];
    fallback.base.board.continuationStatus = "unavailable";
    fallback.semanticPresentation = null;
    expect(buildLauncherWorkBoardProjection(fallback)).toMatchObject({
      mode: "active_only_fallback",
      continuationStatus: "unavailable"
    });
  });

  it.each([
    "2026-08-12T08:00:00.000Z",
    "2026-08-30T08:00:00.000Z"
  ])(
    "never treats an Active Attention dueAt as launcher expiry: %s",
    (dueAt) => {
      const response = workBoardResponse();
      if (response.base.status !== "ready") {
        throw new Error("ready fixture");
      }
      if (response.base.board.primary?.lane !== "attention") {
        throw new Error("attention fixture");
      }
      response.base.board.primary.item.expiresAt = dueAt;

      expect(buildLauncherWorkBoardProjection(response).items[0]).toMatchObject({
        lane: "attention",
        expiresAt: null
      });
    }
  );

  it("fails closed for unavailable, actionful, private, unknown, or non-canonical content", () => {
    const unavailable = workBoardResponse() as unknown as Record<
      string,
      unknown
    >;
    unavailable.base = {
      status: "unavailable",
      code: "WORK_BOARD_PREVIEW_FAILED",
      message: "bounded"
    };
    unavailable.semanticPresentation = null;
    expect(() =>
      buildLauncherWorkBoardProjection(
        unavailable as SemanticContinuationWorkBoardResponse
      )
    ).toThrow();

    for (const mutate of [
      (value: Record<string, unknown>) => {
        value.action = { actionRef: `action_ref_${"a".repeat(32)}` };
        value.capability = "open_source";
      },
      (value: Record<string, unknown>) => {
        value.title = "/Users/private/work";
        value.summary = "/Users/private/work";
      },
      (value: Record<string, unknown>) => {
        value.caveatCodes = ["PRIVATE_INTERNAL_REASON"];
      },
      (value: Record<string, unknown>) => {
        value.privateTarget = `private_target_${"p".repeat(32)}`;
      }
    ]) {
      const hostile = structuredClone(workBoardResponse()) as unknown as Record<
        string,
        unknown
      >;
      const base = hostile.base as Record<string, unknown>;
      const board = base.board as Record<string, unknown>;
      const primary = board.primary as Record<string, unknown>;
      mutate(primary.item as Record<string, unknown>);
      expect(() =>
        buildLauncherWorkBoardProjection(
          hostile as SemanticContinuationWorkBoardResponse
        )
      ).toThrow();
    }

    expect(
      launcherWorkBoardProjectionSchema.safeParse({
        ...buildLauncherWorkBoardProjection(workBoardResponse()),
        itemRef: `item_ref_${"x".repeat(32)}`
      }).success
    ).toBe(false);
  });

  it("rejects standalone locator text, reversed lanes, stale expiry, and mixed active fallback", () => {
    const projection = buildLauncherWorkBoardProjection(workBoardResponse());
    for (const mutate of [
      (value: typeof projection) => {
        value.items[0]!.title = "https://private.example/work";
      },
      (value: typeof projection) => {
        value.items.reverse();
        value.prominentLane = "setup";
      },
      (value: typeof projection) => {
        value.items[1]!.expiresAt = value.generatedAt;
      },
      (value: typeof projection) => {
        value.items[1]!.expiresAt = null;
      },
      (value: typeof projection) => {
        value.mode = "active_only_fallback";
        value.continuationStatus = "unavailable";
      }
    ]) {
      const hostile = structuredClone(projection);
      mutate(hostile);
      expect(launcherWorkBoardProjectionSchema.safeParse(hostile).success).toBe(
        false
      );
    }
  });

  it.each([
    "/Users/private/work",
    "C:\\private\\work",
    "https://private.example/work",
    "token=private-credential",
    `item_ref_${"a".repeat(32)}`,
    `private_target_${"b".repeat(32)}`,
    `result_${"d".repeat(32)}`,
    "c".repeat(40)
  ])("rejects private title text at the standalone launcher boundary: %s", (title) => {
    const projection = buildLauncherWorkBoardProjection(workBoardResponse());
    projection.items[0]!.title = title;
    expect(launcherWorkBoardProjectionSchema.safeParse(projection).success).toBe(
      false
    );
  });

  it("allows ordinary CI/CD copy without weakening locator rejection", () => {
    const projection = buildLauncherWorkBoardProjection(workBoardResponse());
    projection.items[0]!.title = "CI/CD 결과 확인";
    expect(launcherWorkBoardProjectionSchema.safeParse(projection).success).toBe(
      true
    );
  });

  it("allows an Attention-only top three when Continuation remains available but displaced", () => {
    const projection = buildLauncherWorkBoardProjection(workBoardResponse());
    const attention = projection.items[0]!;
    projection.items = [
      structuredClone(attention),
      structuredClone(attention),
      structuredClone(attention)
    ];
    projection.continuationStatus = "available";
    expect(launcherWorkBoardProjectionSchema.parse(projection).items).toHaveLength(
      3
    );
  });
});
