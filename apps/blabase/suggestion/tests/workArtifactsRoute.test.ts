import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/artifacts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/artifacts")
  >();
  return {
    ...actual,
    attachStoredWorkArtifact: vi.fn(),
    detachStoredWorkArtifact: vi.fn()
  };
});

import { POST } from "../app/api/work-artifacts/route";
import {
  GitHubArtifactTargetError,
  WorkArtifactAttributionError,
  WorkArtifactMutationError,
  attachStoredWorkArtifact,
  detachStoredWorkArtifact
} from "../src/artifacts";

const RAW_URL_SENTINEL = "PRIVATE_RAW_ARTIFACT_URL_SENTINEL";
const MANAGED_RUN_ID = `managed_run_${"1".repeat(32)}`;
const BINDING_ID = `binding_${"2".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"3".repeat(24)}`;
const ATTRIBUTION_ID = `attribution_${"4".repeat(32)}`;
const ARTIFACT_URL =
  `https://github.com/${RAW_URL_SENTINEL}/private-repository/pull/17`;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.mocked(attachStoredWorkArtifact).mockResolvedValue({
    attributionId: ATTRIBUTION_ID
  } as never);
  vi.mocked(detachStoredWorkArtifact).mockResolvedValue({
    attributionId: `attribution_${"5".repeat(32)}`
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("work artifacts route", () => {
  it("accepts only explicit attach and returns no-store metadata without the raw URL", async () => {
    const input = {
      action: "attach" as const,
      managedRunId: MANAGED_RUN_ID,
      bindingId: BINDING_ID,
      executionId: EXECUTION_ID,
      artifactUrl: ARTIFACT_URL,
      explicitUserConfirmation: true as const
    };

    const response = await POST(mutationRequest(input));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(attachStoredWorkArtifact).toHaveBeenCalledWith(input);
    expect(detachStoredWorkArtifact).not.toHaveBeenCalled();
    expect(body).toEqual({
      status: "ready",
      attributionId: ATTRIBUTION_ID
    });
    expect(JSON.stringify(body)).not.toContain(RAW_URL_SENTINEL);
    expect(JSON.stringify(body)).not.toContain("private-repository");
  });

  it("accepts only the selected explicit attribution when detaching", async () => {
    const input = {
      action: "detach" as const,
      attributionId: ATTRIBUTION_ID,
      explicitUserConfirmation: true as const
    };

    const response = await POST(mutationRequest(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(detachStoredWorkArtifact).toHaveBeenCalledWith(input);
    expect(attachStoredWorkArtifact).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("rejects non-local and non-same-origin mutations before reading the body", async () => {
    const missingOrigin = await POST(
      new Request("http://localhost:3102/api/work-artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validAttachInput())
      })
    );
    const crossOrigin = await POST(
      mutationRequest(validAttachInput(), "https://evil.example")
    );
    const remote = await POST(
      new Request("https://blabase.example/api/work-artifacts", {
        method: "POST",
        headers: {
          origin: "https://blabase.example",
          "content-type": "application/json"
        },
        body: JSON.stringify(validAttachInput())
      })
    );

    expect(missingOrigin.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
    expect(remote.status).toBe(404);
    expect(missingOrigin.headers.get("cache-control")).toBe("no-store");
    expect(crossOrigin.headers.get("cache-control")).toBe("no-store");
    expect(remote.headers.get("cache-control")).toBe("no-store");
    expect(attachStoredWorkArtifact).not.toHaveBeenCalled();
    expect(detachStoredWorkArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ["missing confirmation", { ...validAttachInput(), explicitUserConfirmation: undefined }],
    ["false confirmation", { ...validAttachInput(), explicitUserConfirmation: false }],
    ["injected artifact identity", { ...validAttachInput(), repositoryId: 101 }],
    ["bare execution ID", { ...validAttachInput(), executionId: "3".repeat(24) }],
    [
      "detach payload injection",
      {
        action: "detach",
        attributionId: ATTRIBUTION_ID,
        artifactUrl: ARTIFACT_URL,
        explicitUserConfirmation: true
      }
    ],
    [
      "invalid attribution ID",
      {
        action: "detach",
        attributionId: "../../private-store",
        explicitUserConfirmation: true
      }
    ]
  ])("rejects the %s request shape", async (_name, input) => {
    const response = await POST(mutationRequest(input));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "INVALID_WORK_ARTIFACT_MUTATION",
      message: "결과 연결 요청 형식을 확인해주세요."
    });
    expect(attachStoredWorkArtifact).not.toHaveBeenCalled();
    expect(detachStoredWorkArtifact).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "invalid GitHub URL",
      error: new GitHubArtifactTargetError(
        "GITHUB_ARTIFACT_URL_INVALID"
      ),
      status: 400,
      code: "GITHUB_ARTIFACT_URL_INVALID"
    },
    {
      name: "missing GitHub repository",
      error: new GitHubArtifactTargetError(
        "GITHUB_ARTIFACT_REPOSITORY_NOT_FOUND"
      ),
      status: 404,
      code: "GITHUB_ARTIFACT_REPOSITORY_NOT_FOUND"
    },
    {
      name: "unavailable GitHub source",
      error: new GitHubArtifactTargetError(
        "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
      ),
      status: 409,
      code: "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
    },
    {
      name: "missing managed relation",
      error: new WorkArtifactMutationError(
        "MANAGED_RUN_RELATION_NOT_FOUND"
      ),
      status: 404,
      code: "MANAGED_RUN_RELATION_NOT_FOUND"
    },
    {
      name: "mismatched managed relation",
      error: new WorkArtifactMutationError(
        "MANAGED_RUN_RELATION_MISMATCH"
      ),
      status: 409,
      code: "MANAGED_RUN_RELATION_MISMATCH"
    },
    {
      name: "inactive attribution",
      error: new WorkArtifactAttributionError(
        "ATTRIBUTION_NOT_ACTIVE"
      ),
      status: 409,
      code: "ATTRIBUTION_NOT_ACTIVE"
    },
    {
      name: "private store failure",
      error: new WorkArtifactAttributionError("STORE_READ_FAILED"),
      status: 500,
      code: "WORK_ARTIFACT_MUTATION_FAILED"
    }
  ])("maps $name to a sanitized $status response", async (scenario) => {
    vi.mocked(attachStoredWorkArtifact).mockRejectedValueOnce(
      scenario.error
    );

    const response = await POST(mutationRequest(validAttachInput()));
    const body = await response.json();

    expect(response.status).toBe(scenario.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "error",
      code: scenario.code
    });
    expect(JSON.stringify(body)).not.toContain(RAW_URL_SENTINEL);
    expect(JSON.stringify(body)).not.toContain("private-repository");
  });

  it("sanitizes unexpected service errors without echoing raw URL details", async () => {
    vi.mocked(attachStoredWorkArtifact).mockRejectedValueOnce(
      new Error(`${RAW_URL_SENTINEL}: ${ARTIFACT_URL}`)
    );

    const response = await POST(mutationRequest(validAttachInput()));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "error",
      code: "WORK_ARTIFACT_MUTATION_FAILED",
      message: "결과 연결을 변경하지 못했습니다."
    });
    expect(serialized).not.toContain(RAW_URL_SENTINEL);
    expect(serialized).not.toContain(ARTIFACT_URL);
  });
});

function validAttachInput() {
  return {
    action: "attach",
    managedRunId: MANAGED_RUN_ID,
    bindingId: BINDING_ID,
    executionId: EXECUTION_ID,
    artifactUrl: ARTIFACT_URL,
    explicitUserConfirmation: true
  };
}

function mutationRequest(
  body: unknown,
  origin = "http://localhost:3102"
): Request {
  return new Request("http://localhost:3102/api/work-artifacts", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}
