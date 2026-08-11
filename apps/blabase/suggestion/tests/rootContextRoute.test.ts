import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/rootContext", () => ({
  resolveDashboardRootContext: vi.fn()
}));

import { GET } from "../app/api/system/root-context/route";
import { resolveDashboardRootContext } from "../src/rootContext";

const CONTEXT = {
  contract: "blabase-root-context-v1" as const,
  rootId: `root_${"a".repeat(32)}`,
  mutationAuthority: "dashboard" as const,
  syncRevision: "pipeline:0123456789abcdef0123456789abcdef"
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("root context route", () => {
  it("serves the same private no-store contract on both loopback hosts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(resolveDashboardRootContext).mockResolvedValue(CONTEXT);

    for (const host of ["localhost", "127.0.0.1"]) {
      const response = await GET(
        new Request(`http://${host}:3102/api/system/root-context`)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual(CONTEXT);
    }

    expect(resolveDashboardRootContext).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(CONTEXT)).not.toContain("/Users/");
    expect(JSON.stringify(CONTEXT)).not.toContain("secret");
  });

  it("rejects remote and cross-origin reads before resolving a root", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const remote = await GET(
      new Request("https://app.example/api/system/root-context")
    );
    const crossOrigin = await GET(
      new Request("http://localhost:3102/api/system/root-context", {
        headers: { origin: "https://evil.example" }
      })
    );

    expect(remote.status).toBe(404);
    expect(crossOrigin.status).toBe(403);
    expect(resolveDashboardRootContext).not.toHaveBeenCalled();
  });

  it("sanitizes owner resolution failures", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(resolveDashboardRootContext).mockRejectedValue(
      new Error("private-root-path:/secret")
    );

    const response = await GET(
      new Request("http://localhost:3102/api/system/root-context")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "error",
      code: "ROOT_CONTEXT_FAILED"
    });
    expect(JSON.stringify(body)).not.toContain("private-root-path");
  });
});
