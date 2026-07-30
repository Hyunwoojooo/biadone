import { describe, expect, it, vi } from "vitest";

import {
  SourceSyncAdapterError,
  createBoundedSourceSyncFetch
} from "../src/sync";

describe("runtime source sync transport", () => {
  it("rejects a hung provider request within the configured bound", async () => {
    const neverSettles = vi.fn(
      () => new Promise<Response>(() => undefined)
    ) as unknown as typeof fetch;
    const boundedFetch = createBoundedSourceSyncFetch(
      neverSettles,
      5
    );

    await expect(
      boundedFetch("https://provider.example/source")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncAdapterError>>({
        code: "SOURCE_REQUEST_TIMEOUT"
      })
    );
    expect(neverSettles).toHaveBeenCalledOnce();
    const init = vi.mocked(neverSettles).mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(true);
  });
});
