import { afterEach, describe, expect, it, vi } from "vitest";

import { invalidateAttentionAfterArtifactMutation } from "../app/ManagedCodexArtifacts";
import { syncInvalidationBus } from "../app/sync/invalidationBus";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("managed Codex artifact Attention invalidation", () => {
  it("invalidates the active recommendation immediately after an artifact mutation", () => {
    const invalidate = vi.spyOn(syncInvalidationBus, "invalidate");

    invalidateAttentionAfterArtifactMutation();

    expect(invalidate).toHaveBeenCalledWith({
      reason: "context_changed",
      targets: ["attention"]
    });
  });
});
