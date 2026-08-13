import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchContinuationRead,
  parseContinuationReadResponse
} from "../app/continuationClient";

const valid = {
  contract: "continuation-read-api-v0.1",
  generatedAt: "2026-08-13T12:00:00.000Z",
  status: "setup_required",
  coverageCode: "SOURCE_LOCAL_PARTIAL",
  items: [
    {
      title: "작업공간 연결하기",
      summary: "작업공간 연결하기",
      caveats: ["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"],
      capability: "display",
      action: null
    }
  ]
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Continuation read client", () => {
  it("fetches without caching and accepts the exact display-only response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => valid
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchContinuationRead()).resolves.toEqual(valid);
    expect(fetchMock).toHaveBeenCalledWith("/api/continuation", {
      cache: "no-store"
    });
  });

  it("fails closed on extra refs, active actions, bad tuples, and unsafe text", () => {
    for (const hostile of [
      { ...valid, itemRef: `item_ref_${"a".repeat(32)}` },
      {
        ...valid,
        items: [
          {
            ...valid.items[0],
            capability: "open_setup_surface",
            action: { actionRef: `action_ref_${"b".repeat(32)}` }
          }
        ]
      },
      { ...valid, coverageCode: "COMPLETE" },
      {
        ...valid,
        items: [{ ...valid.items[0], caveats: ["PRIVATE_RUN_DETAIL"] }]
      },
      {
        ...valid,
        items: [
          {
            ...valid.items[0],
            title: "/private/project",
            summary: "/private/project"
          }
        ]
      },
      {
        ...valid,
        items: [
          {
            ...valid.items[0],
            title: "git@private.example:repository",
            summary: "git@private.example:repository"
          }
        ]
      },
      {
        ...valid,
        items: [
          {
            ...valid.items[0],
            title: "managed_run_private123 확인하기",
            summary: "managed_run_private123 확인하기"
          }
        ]
      }
    ]) {
      expect(parseContinuationReadResponse(hostile)).toMatchObject({
        status: "error",
        code: "CONTINUATION_READ_FAILED"
      });
    }
  });
});
