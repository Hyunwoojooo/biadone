import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDisplayOnlyWorkBoard,
  parseDisplayOnlyWorkBoard,
  WorkBoardDisplayRequestError
} from "../app/attentionClient";
import { workSuggestionBoardPublicSchema } from "../src/suggestionBoard/contracts";

const ready = {
  contract: "semantic-continuation-work-board-response-v0.2",
  schemaVersion: "semantic-continuation-presentation-schema-v0.2",
  base: {
    status: "ready",
    mode: "full",
    reasonCode: null,
    board: {
      contract: "work-suggestion-board-public-v0.1",
      schemaVersion: "work-suggestion-board-schema-v0.1",
      generatedAt: "2026-08-13T09:00:00.000Z",
      prominentLane: "continuation",
      continuationStatus: "available",
      primary: {
        lane: "continuation",
        item: {
          itemRef: `item_ref_${"a".repeat(32)}`,
          workContextRef: `context_ref_${"b".repeat(32)}`,
          kind: "recent_codex_session",
          title: "최근 작업 이어가기",
          summary: "최근 작업 이어가기",
          observedAt: "2026-08-13T08:00:00.000Z",
          expiresAt: "2026-08-14T08:00:00.000Z",
          evidenceBand: "single_source",
          capability: "display",
          action: null,
          caveatCodes: ["SOURCE_METADATA_ONLY"]
        }
      },
      alternatives: [],
      executionPolicy: {
        automaticExecutionAllowed: false,
        explicitUserActionRequired: true,
        externalMutationAllowed: false
      }
    }
  },
  semanticPresentation: null
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("display-only Work Board client", () => {
  it("fetches only the canonical wrapper with no cache after checking HTTP JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(ready, 200, "application/json; charset=utf-8")
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDisplayOnlyWorkBoard()).resolves.toEqual(ready);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/work-board", {
      cache: "no-store"
    });
  });

  it.each([
    response("Unauthorized", 401, "text/plain"),
    response("<html>auth</html>", 503, "text/html"),
    {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => {
        throw new SyntaxError("not JSON");
      }
    }
  ])("fails bounded on non-JSON/auth/error transport", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
    await expect(fetchDisplayOnlyWorkBoard()).rejects.toBeInstanceOf(
      WorkBoardDisplayRequestError
    );
  });

  it("does not attempt JSON parsing before status and content-type pass", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "text/html" }),
        json
      })
    );
    await expect(fetchDisplayOnlyWorkBoard()).rejects.toBeInstanceOf(
      WorkBoardDisplayRequestError
    );
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects the whole feed for actionful content, unknown caveats, or private text", () => {
    for (const mutate of [
      (item: Record<string, unknown>) => {
        item.capability = "open_source";
        item.action = { actionRef: `action_ref_${"x".repeat(32)}` };
      },
      (item: Record<string, unknown>) => {
        item.caveatCodes = ["PRIVATE_INTERNAL_REASON"];
      },
      (item: Record<string, unknown>) => {
        item.title = "/Users/private/work";
        item.summary = "/Users/private/work";
      },
      (item: Record<string, unknown>) => {
        item.privateTarget = `private_target_${"z".repeat(32)}`;
      }
    ]) {
      const hostile = structuredClone(ready) as unknown as Record<
        string,
        unknown
      >;
      const item = (
        ((hostile.base as Record<string, unknown>).board as Record<
          string,
          unknown
        >).primary as Record<string, unknown>
      ).item as Record<string, unknown>;
      mutate(item);
      expect(parseDisplayOnlyWorkBoard(hostile)).toBeNull();
    }
  });

  it("shares precise public text safety without rejecting ordinary CI/CD copy", () => {
    const allowed = withTitle("CI/CD 결과 확인");
    const allowedBase = allowed.base as Record<string, unknown>;
    expect(
      workSuggestionBoardPublicSchema.safeParse(allowedBase.board).success
    ).toBe(true);
    expect(parseDisplayOnlyWorkBoard(allowed)).not.toBeNull();

    for (const text of [
      "/Users/private/work",
      "C:\\private\\work",
      "https://private.example/work",
      "token=private-credential",
      `private_target_${"z".repeat(32)}`
    ]) {
      expect(parseDisplayOnlyWorkBoard(withTitle(text))).toBeNull();
    }
  });

  it("preserves server order and rejects duplicate public items", () => {
    const duplicate = structuredClone(ready) as unknown as Record<
      string,
      unknown
    >;
    const board = (duplicate.base as Record<string, unknown>).board as Record<
      string,
      unknown
    >;
    board.alternatives = [structuredClone(board.primary)];
    expect(parseDisplayOnlyWorkBoard(duplicate)).toBeNull();
    expect(parseDisplayOnlyWorkBoard(ready)).toEqual(ready);
  });

  it("accepts only ready display feeds across the wrapper status table", () => {
    const fallback = structuredClone(ready) as unknown as Record<
      string,
      unknown
    >;
    const fallbackBase = fallback.base as Record<string, unknown>;
    fallbackBase.mode = "active_only_fallback";
    fallbackBase.reasonCode = "CONTINUATION_PREREQUISITES_UNAVAILABLE";
    expect(parseDisplayOnlyWorkBoard(fallback)).not.toBeNull();

    for (const status of ["unavailable", "error"] as const) {
      expect(
        parseDisplayOnlyWorkBoard({
          contract: "semantic-continuation-work-board-response-v0.2",
          schemaVersion: "semantic-continuation-presentation-schema-v0.2",
          base: {
            status,
            code: "WORK_BOARD_PREVIEW_FAILED",
            message: "bounded"
          },
          semanticPresentation: null
        })
      ).toBeNull();
    }
  });
});

function withTitle(title: string): Record<string, unknown> {
  const value = structuredClone(ready) as unknown as Record<string, unknown>;
  const item = (
    (((value.base as Record<string, unknown>).board as Record<
      string,
      unknown
    >).primary as Record<string, unknown>).item as Record<string, unknown>
  );
  item.title = title;
  item.summary = title;
  return value;
}

function response(body: unknown, status: number, contentType: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    json: async () => body
  };
}
