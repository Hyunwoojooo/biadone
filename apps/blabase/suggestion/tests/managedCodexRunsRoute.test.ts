import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/managedCodex", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/managedCodex")>();
  return {
    ...actual,
    readManagedCodexObservability: vi.fn()
  };
});

vi.mock("../src/resumption", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/resumption")>();
  return {
    ...actual,
    withManagedCodexAuthorityLease: vi.fn()
  };
});

import { GET as getManagedCodexRuns } from "../app/api/managed-codex-runs/route";
import {
  buildManagedCodexSemanticProjection,
  createEmptyManagedCodexHistory,
  readManagedCodexObservability,
  type ManagedCodexPublicProjection,
  type ManagedCodexSemanticProjection
} from "../src/managedCodex";
import { withManagedCodexAuthorityLease } from "../src/resumption";

const OWNER_INSTANCE_ID = `instance_${"a".repeat(32)}`;
const ACTIVE_OWNERSHIP = {
  bindingId: `binding_${"2".repeat(32)}`,
  executionId: `codex:execution:${"3".repeat(24)}`,
  scopeId: "4".repeat(24),
  connectionGeneration: `connection_${"5".repeat(32)}`
};
const RAW_SENTINEL = "PRIVATE_NATIVE_THREAD_PROMPT_OUTPUT_SENTINEL";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.mocked(withManagedCodexAuthorityLease).mockImplementation(
    async (_cwd, leaseTime, read) => {
      const now =
        typeof leaseTime === "function" ? leaseTime() : leaseTime;
      return read(
        {
          activeOwnerInstanceId: OWNER_INSTANCE_ID,
          activeOwnerships: [ACTIVE_OWNERSHIP]
        },
        now
      );
    }
  );
  vi.mocked(readManagedCodexObservability).mockResolvedValue(
    observability()
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("managed Codex runs route", () => {
  it("serves a local safe-origin read without caching", async () => {
    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      ...publicProjection(),
      semantics: semanticProjection()
    });
  });

  it("rejects remote and cross-origin reads before touching private state", async () => {
    const crossOrigin = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs", {
        headers: { origin: "https://evil.example" }
      })
    );
    const remote = await getManagedCodexRuns(
      new Request("https://blabase.example/api/managed-codex-runs")
    );

    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("cache-control")).toBe("no-store");
    expect(remote.status).toBe(404);
    expect(remote.headers.get("cache-control")).toBe("no-store");
    expect(withManagedCodexAuthorityLease).not.toHaveBeenCalled();
    expect(readManagedCodexObservability).not.toHaveBeenCalled();
  });

  it("passes the same read time and fresh Companion owner into the projection", async () => {
    await getManagedCodexRuns(
      new Request("http://127.0.0.1:3102/api/managed-codex-runs", {
        headers: { origin: "http://127.0.0.1:3102" }
      })
    );

    expect(withManagedCodexAuthorityLease).toHaveBeenCalledOnce();
    const authorityCall = vi.mocked(withManagedCodexAuthorityLease)
      .mock.calls[0];
    expect(authorityCall?.[0]).toBe(process.cwd());
    expect(authorityCall?.[1]).toEqual(expect.any(Function));
    const readAt = vi.mocked(readManagedCodexObservability).mock
      .calls[0]?.[0].now;
    expect(readAt).toBeInstanceOf(Date);
    expect(readManagedCodexObservability).toHaveBeenCalledWith(
      {
        activeOwnerInstanceId: OWNER_INSTANCE_ID,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: readAt
      },
      process.cwd()
    );
  });

  it("returns only the strict public projection fields", async () => {
    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(Object.keys(payload).sort()).toEqual([
      "contract",
      "generatedAt",
      "revision",
      "runs",
      "semantics",
      "status"
    ]);
    expect(Object.keys(payload.runs[0]).sort()).toEqual([
      "bindingId",
      "continuity",
      "effectiveExecutionState",
      "executionId",
      "forbiddenAsAttentionCandidate",
      "itemType",
      "lastObservedAt",
      "lastVerifiedExecutionState",
      "lifecycle",
      "liveObservationAvailable",
      "managedRunId",
      "sourceEvent",
      "streamState",
      "waitingState"
    ]);
    for (const forbidden of [
      "nativeThreadId",
      "scopeId",
      "ownerInstanceId",
      "connectionGeneration",
      "cwd",
      "prompt",
      "answer",
      "output",
      "rawPayload"
    ]) {
      expect(payload.runs[0]).not.toHaveProperty(forbidden);
    }
    expect(serialized).not.toContain(RAW_SENTINEL);
    expect(Object.keys(payload.semantics).sort()).toEqual([
      "contract",
      "evidencePolicyVersion",
      "generatedAt",
      "projectionSha256",
      "ruleVersion",
      "runs",
      "schemaVersion",
      "sourceRevision"
    ]);
    expect(Object.keys(payload.semantics.runs[MANAGED_RUN_ID])).not.toContain(
      "ownerInstanceId"
    );
    for (const forbidden of [
      "ownerInstanceId",
      "scopeId",
      "connectionGeneration",
      "streamGeneration",
      "nativeThreadId",
      "previousEventSha256",
      "eventSha256",
      "rawPayload",
      "prompt",
      "answer",
      "output"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("sanitizes store failures without returning their original details", async () => {
    vi.mocked(readManagedCodexObservability).mockRejectedValueOnce(
      new Error(`${RAW_SENTINEL}: /private/path native-thread-id`)
    );

    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      status: "error",
      code: "MANAGED_CODEX_RUNS_READ_FAILED",
      message: "Codex 실시간 관찰 상태를 확인하지 못했습니다."
    });
    expect(JSON.stringify(payload)).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(payload)).not.toContain("/private/path");
  });

  it("fails closed when a projection attempts to add a private field", async () => {
    vi.mocked(readManagedCodexObservability).mockResolvedValueOnce({
      ...observability(),
      projection: {
        ...publicProjection(),
        nativeThreadId: RAW_SENTINEL
      }
    } as never);

    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(payload)).not.toContain(RAW_SENTINEL);
  });

  it("fails closed when the semantic source revision is from another snapshot", async () => {
    vi.mocked(readManagedCodexObservability).mockResolvedValueOnce({
      projection: publicProjection(),
      semantics: semanticProjection(2),
      managedRunStartedAtById: {
        [MANAGED_RUN_ID]: "2026-08-01T03:00:00.000Z"
      }
    });

    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.code).toBe("MANAGED_CODEX_RUNS_READ_FAILED");
  });

  it("fails closed when semantics attempt to add a private field", async () => {
    vi.mocked(readManagedCodexObservability).mockResolvedValueOnce({
      projection: publicProjection(),
      semantics: {
        ...semanticProjection(),
        ownerInstanceId: RAW_SENTINEL
      },
      managedRunStartedAtById: {
        [MANAGED_RUN_ID]: "2026-08-01T03:00:00.000Z"
      }
    } as never);

    const response = await getManagedCodexRuns(
      new Request("http://localhost:3102/api/managed-codex-runs")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(payload)).not.toContain(RAW_SENTINEL);
  });
});

const MANAGED_RUN_ID = `managed_run_${"1".repeat(32)}`;

function observability() {
  return {
    projection: publicProjection(),
    semantics: semanticProjection(),
    managedRunStartedAtById: {
      [MANAGED_RUN_ID]: "2026-08-01T03:00:00.000Z"
    }
  };
}

function publicProjection(): ManagedCodexPublicProjection {
  return {
    contract: "codex-managed-public-projection-v1",
    revision: 3,
    generatedAt: "2026-08-01T03:00:00.000Z",
    runs: [
      {
        managedRunId: MANAGED_RUN_ID,
        bindingId: `binding_${"2".repeat(32)}`,
        executionId: `codex:execution:${"3".repeat(24)}`,
        lifecycle: "observing",
        streamState: "connected",
        continuity: "continuous",
        effectiveExecutionState: "running",
        lastVerifiedExecutionState: "running",
        waitingState: null,
        sourceEvent: "item_started",
        itemType: "command_execution",
        lastObservedAt: "2026-08-01T03:00:00.000Z",
        liveObservationAvailable: true,
        forbiddenAsAttentionCandidate: true
      }
    ]
  };
}

function semanticProjection(
  sourceRevision = 3
): ManagedCodexSemanticProjection {
  const run = publicProjection().runs[0];
  if (!run) throw new Error("Managed Codex route fixture run is missing.");
  return buildManagedCodexSemanticProjection({
    sourceRevision,
    generatedAt: "2026-08-01T03:00:00.000Z",
    runs: [
      {
        run,
        history: createEmptyManagedCodexHistory({
          managedRunId: run.managedRunId,
          updatedAt: "2026-08-01T03:00:00.000Z"
        })
      }
    ]
  });
}
