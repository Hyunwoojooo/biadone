import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachWorkArtifact,
  detachWorkArtifact,
  WorkArtifactRequestError
} from "../app/workArtifactsClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work artifacts client", () => {
  it("attaches an exact GitHub artifact with explicit confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ready",
          attributionId: `attribution_${"a".repeat(32)}`
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await attachWorkArtifact({
      managedRunId: `managed_run_${"b".repeat(32)}`,
      bindingId: `binding_${"c".repeat(32)}`,
      executionId: `codex:execution:${"d".repeat(24)}`,
      artifactUrl:
        "https://github.com/biadone/blabase/commit/0123456789abcdef0123456789abcdef01234567"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/work-artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "attach",
        managedRunId: `managed_run_${"b".repeat(32)}`,
        bindingId: `binding_${"c".repeat(32)}`,
        executionId: `codex:execution:${"d".repeat(24)}`,
        artifactUrl:
          "https://github.com/biadone/blabase/commit/0123456789abcdef0123456789abcdef01234567",
        explicitUserConfirmation: true
      }),
      cache: "no-store"
    });
  });

  it("detaches only the selected attribution with explicit confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const attributionId = `attribution_${"e".repeat(32)}`;

    await detachWorkArtifact({ attributionId });

    expect(fetchMock).toHaveBeenCalledWith("/api/work-artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "detach",
        attributionId,
        explicitUserConfirmation: true
      }),
      cache: "no-store"
    });
  });

  it("preserves a sanitized server error for the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "error",
            code: "ARTIFACT_NOT_FOUND",
            message: "GitHub 결과를 확인하지 못했습니다."
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(
      detachWorkArtifact({
        attributionId: `attribution_${"f".repeat(32)}`
      })
    ).rejects.toMatchObject({
      name: "WorkArtifactRequestError",
      code: "ARTIFACT_NOT_FOUND",
      message: "GitHub 결과를 확인하지 못했습니다."
    } satisfies Partial<WorkArtifactRequestError>);
  });
});
