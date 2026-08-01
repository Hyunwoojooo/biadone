import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/connectors/codex/localStore", () => ({
  readStoredCodexSnapshot: vi.fn()
}));

import { readStoredCodexSnapshot } from "../src/connectors/codex/localStore";
import {
  resolveStoredCodexExecutionScopeId
} from "../src/resumption/store";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Codex resume scope resolution", () => {
  it("derives scope only from the server-side opaque snapshot", async () => {
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue({
      sessions: [
        {
          id: "1".repeat(24),
          scopeId: "a".repeat(24)
        }
      ]
    } as never);

    await expect(
      resolveStoredCodexExecutionScopeId(
        `codex:execution:${"1".repeat(24)}`,
        "/private/test-root"
      )
    ).resolves.toBe("a".repeat(24));
    expect(readStoredCodexSnapshot).toHaveBeenCalledWith(
      "/private/test-root"
    );
  });

  it("fails closed for bare or unknown execution IDs", async () => {
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue({
      sessions: []
    } as never);

    await expect(
      resolveStoredCodexExecutionScopeId("1".repeat(24))
    ).rejects.toBeDefined();
    await expect(
      resolveStoredCodexExecutionScopeId(
        `codex:execution:${"2".repeat(24)}`
      )
    ).rejects.toMatchObject({
      code: "CODEX_EXECUTION_NOT_FOUND"
    });
  });
});
