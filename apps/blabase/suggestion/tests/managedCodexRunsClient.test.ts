import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchManagedCodexRuns } from "../app/managedCodexRunsClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("managed Codex runs client", () => {
  it("reads the observational projection without caching", async () => {
    const projection = {
      status: "ready" as const,
      contract: "codex-managed-public-projection-v1" as const,
      revision: 3,
      generatedAt: "2026-08-01T00:00:00.000Z",
      runs: []
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(projection), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchManagedCodexRuns()).resolves.toEqual(projection);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/managed-codex-runs",
      { cache: "no-store" }
    );
  });

  it("preserves a sanitized unavailable response for the UI", async () => {
    const unavailable = {
      status: "unavailable" as const,
      message: "Managed observation is local-only."
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

    await expect(fetchManagedCodexRuns()).resolves.toEqual(unavailable);
  });
});
