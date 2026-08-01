import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWorkRelations } from "../app/workRelationsClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work relations client", () => {
  it("reads the relation inspection projection without caching", async () => {
    const projection = {
      status: "ready",
      contract: "managed-codex-work-relation-projection-v0.1",
      asOf: "2026-08-01T00:00:00.000Z",
      relations: [],
      runResolutions: []
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(projection), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWorkRelations()).resolves.toEqual(projection);
    expect(fetchMock).toHaveBeenCalledWith("/api/work-relations", {
      cache: "no-store"
    });
  });

  it("preserves a sanitized unavailable response for the UI", async () => {
    const unavailable = {
      status: "unavailable" as const,
      message: "Relation inspection is local-only."
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(unavailable), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(fetchWorkRelations()).resolves.toEqual(unavailable);
  });
});
