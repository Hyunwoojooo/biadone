import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const localEnvMocks = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  loadShared: vi.fn()
}));
const syncMocks = vi.hoisted(() => ({ sync: vi.fn() }));
const workEvidenceMocks = vi.hoisted(() => ({
  preserveError: undefined as unknown
}));

vi.mock("../src/localEnv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/localEnv")>();
  return {
    ...actual,
    createSharedLocalEnvSnapshot: (
      ...args: Parameters<typeof actual.createSharedLocalEnvSnapshot>
    ) => {
      localEnvMocks.createSnapshot(...args);
      return actual.createSharedLocalEnvSnapshot(...args);
    },
    loadSharedLocalEnv: (
      ...args: Parameters<typeof actual.loadSharedLocalEnv>
    ) => {
      localEnvMocks.loadShared(...args);
      return actual.loadSharedLocalEnv(...args);
    }
  };
});

vi.mock("../src/sync/runtime", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/sync/runtime")
  >();
  return {
    ...actual,
    syncRuntimeSources: (
      ...args: Parameters<typeof actual.syncRuntimeSources>
    ) => {
      syncMocks.sync(...args);
      return actual.syncRuntimeSources(...args);
    }
  };
});

vi.mock("../src/workEvidence/currentWorkEvidence", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/workEvidence/currentWorkEvidence")
  >();
  return {
    ...actual,
    resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot: (
      ...args: Parameters<
        typeof actual.resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot
      >
    ) => {
      if (workEvidenceMocks.preserveError !== undefined) {
        throw workEvidenceMocks.preserveError;
      }
      return actual.resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot(
        ...args
      );
    }
  };
});

import { evaluateCurrentAttentionWithLiveInputs } from "../src/attention/liveAttention";
import { WorkResumptionStoreError } from "../src/resumption/store";

const AS_OF = "2026-08-13T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  localEnvMocks.createSnapshot.mockClear();
  localEnvMocks.loadShared.mockClear();
  syncMocks.sync.mockClear();
  workEvidenceMocks.preserveError = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("live Attention preserve capture", () => {
  it("rejects refresh before inspecting env or entering source sync", async () => {
    let descriptorReads = 0;
    const env = new Proxy(Object.create(null) as NodeJS.ProcessEnv, {
      ownKeys() {
        descriptorReads += 1;
        return [];
      }
    });

    await expect(
      evaluateCurrentAttentionWithLiveInputs({
        readMode: "preserve",
        refreshSources: true,
        env
      })
    ).rejects.toThrow("cannot refresh sources");

    expect(descriptorReads).toBe(0);
    expect(localEnvMocks.createSnapshot).not.toHaveBeenCalled();
    expect(localEnvMocks.loadShared).not.toHaveBeenCalled();
    expect(syncMocks.sync).not.toHaveBeenCalled();
  });

  it("uses one fixed request clock and leaves missing local state absent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "blabase-live-preserve-"));
    temporaryDirectories.push(cwd);
    const env = {
      NODE_ENV: "test",
      BLABASE_CODE_COMMIT_SHA: "a".repeat(40)
    } as NodeJS.ProcessEnv;
    const beforeEnv = { ...env };

    const captured = await evaluateCurrentAttentionWithLiveInputs({
      cwd,
      now: new Date(AS_OF),
      env,
      readMode: "preserve",
      refreshSources: false
    });

    expect(captured.asOf).toBe(AS_OF);
    expect(captured.evaluated.result.asOf).toBe(AS_OF);
    expect(captured.evaluated.run).toMatchObject({
      asOf: AS_OF,
      startedAt: AS_OF,
      completedAt: AS_OF,
      latencyMs: 0
    });
    expect(captured.evaluated.replayArtifact.capturedAt).toBe(AS_OF);
    expect(env).toEqual(beforeEnv);
    expect(localEnvMocks.createSnapshot).toHaveBeenNthCalledWith(1, env, {
      cwd,
      mode: "preserve"
    });
    expect(localEnvMocks.loadShared).not.toHaveBeenCalled();
    expect(syncMocks.sync).not.toHaveBeenCalled();
    await expect(lstat(join(cwd, ".local"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("maps known preserve-store failures without hiding programming errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "blabase-live-errors-"));
    temporaryDirectories.push(cwd);
    const input = {
      cwd,
      now: new Date(AS_OF),
      env: { NODE_ENV: "test" as const },
      readMode: "preserve" as const
    };

    workEvidenceMocks.preserveError = new WorkResumptionStoreError(
      "STORE_INVALID"
    );
    await expect(
      evaluateCurrentAttentionWithLiveInputs(input)
    ).rejects.toMatchObject({
      name: "PreserveCaptureError",
      code: "PRESERVE_CAPTURE_READ_FAILED"
    });

    const programmingError = new TypeError("synthetic evaluator failure");
    workEvidenceMocks.preserveError = programmingError;
    await expect(
      evaluateCurrentAttentionWithLiveInputs(input)
    ).rejects.toBe(programmingError);
  });
});
