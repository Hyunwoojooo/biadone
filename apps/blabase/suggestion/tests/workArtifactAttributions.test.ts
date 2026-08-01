import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WorkArtifactAttributionError,
  attachWorkArtifactAttribution,
  clearWorkArtifactAttributionStore,
  createEmptyWorkArtifactAttributionStore,
  createWorkArtifactAttributionId,
  currentWorkArtifactAttributions,
  detachWorkArtifactAttribution,
  pruneWorkArtifactAttributionStore,
  readWorkArtifactAttributionStore,
  sealWorkArtifactAttributionStore,
  workArtifactAttributionPath,
  workArtifactAttributionStoreSchema,
  writeWorkArtifactAttributionStore
} from "../src/artifacts";

const T0 = new Date("2026-08-01T00:00:00.000Z");
const RUN_1 = `managed_run_${"1".repeat(32)}`;
const RUN_2 = `managed_run_${"2".repeat(32)}`;
const BINDING_1 = `binding_${"3".repeat(32)}`;
const BINDING_2 = `binding_${"4".repeat(32)}`;
const EXECUTION_1 = `codex:execution:${"5".repeat(24)}`;
const EXECUTION_2 = `codex:execution:${"6".repeat(24)}`;
const RELATION_1 = `relation_${"7".repeat(32)}`;
const RELATION_2 = `relation_${"8".repeat(32)}`;
const COMMIT = {
  kind: "github_commit" as const,
  repositoryId: 101,
  oid: "a".repeat(40)
};
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("work artifact attribution ledger", () => {
  it("keeps an append-only explicit attach, reattribution, and detach lineage", () => {
    const empty = createEmptyWorkArtifactAttributionStore(
      T0.toISOString()
    );
    const first = attachWorkArtifactAttribution(empty, {
      ...producer1(),
      artifact: COMMIT,
      attachedAt: T0.toISOString(),
      explicitUserConfirmation: true
    });
    const repeated = attachWorkArtifactAttribution(first.store, {
      ...producer1(),
      artifact: COMMIT,
      attachedAt: plusMs(500),
      explicitUserConfirmation: true
    });
    const moved = attachWorkArtifactAttribution(first.store, {
      ...producer2(),
      artifact: COMMIT,
      attachedAt: plusMs(1_000),
      explicitUserConfirmation: true
    });
    const detached = detachWorkArtifactAttribution(moved.store, {
      attributionId: moved.decision.attributionId,
      detachedAt: plusMs(2_000),
      explicitUserConfirmation: true
    });

    expect(repeated.changed).toBe(false);
    expect(repeated.decision.attributionId).toBe(
      first.decision.attributionId
    );
    expect(moved.decision.supersedesAttributionId).toBe(
      first.decision.attributionId
    );
    expect(detached.decision).toMatchObject({
      action: "detach",
      managedRunId: RUN_2,
      supersedesAttributionId: moved.decision.attributionId
    });
    expect(detached.store).toMatchObject({
      revision: 3,
      prunedDecisionCount: 0
    });
    expect(detached.store.decisions).toHaveLength(3);
    expect(currentWorkArtifactAttributions(detached.store)).toEqual([]);
    expect(
      workArtifactAttributionStoreSchema.parse(detached.store)
    ).toEqual(detached.store);
  });

  it("rejects tampering, short identities, stale detach, and private raw fields", () => {
    const first = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      {
        ...producer1(),
        artifact: COMMIT,
        attachedAt: T0.toISOString(),
        explicitUserConfirmation: true
      }
    );
    const moved = attachWorkArtifactAttribution(first.store, {
      ...producer2(),
      artifact: COMMIT,
      attachedAt: plusMs(1_000),
      explicitUserConfirmation: true
    });

    expect(
      workArtifactAttributionStoreSchema.safeParse({
        ...first.store,
        updatedAt: plusMs(10_000)
      }).success
    ).toBe(false);
    expect(
      workArtifactAttributionStoreSchema.safeParse({
        ...first.store,
        decisions: [
          {
            ...first.store.decisions[0],
            artifact: { ...COMMIT, oid: "abc1234" }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      workArtifactAttributionStoreSchema.safeParse({
        ...first.store,
        rawUrl: "https://github.com/private/repository/commit/private",
        prompt: "PRIVATE_PROMPT_SENTINEL",
        commandOutput: "PRIVATE_OUTPUT_SENTINEL"
      }).success
    ).toBe(false);
    expect(() =>
      detachWorkArtifactAttribution(moved.store, {
        attributionId: first.decision.attributionId,
        detachedAt: plusMs(2_000),
        explicitUserConfirmation: true
      })
    ).toThrowError(
      expect.objectContaining<Partial<WorkArtifactAttributionError>>({
        code: "ATTRIBUTION_NOT_ACTIVE"
      })
    );
  });

  it("prunes private metadata after 30 days without resetting lifetime revision", () => {
    const attached = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      {
        ...producer1(),
        artifact: COMMIT,
        attachedAt: T0.toISOString(),
        explicitUserConfirmation: true
      }
    );
    const result = pruneWorkArtifactAttributionStore(
      attached.store,
      new Date(Date.parse(T0.toISOString()) + 31 * 24 * 60 * 60 * 1_000)
    );

    expect(result.changed).toBe(true);
    expect(result.store).toMatchObject({
      revision: 1,
      prunedDecisionCount: 1,
      decisions: []
    });
    expect(() =>
      attachWorkArtifactAttribution(result.store, {
        ...producer1(),
        artifact: COMMIT,
        attachedAt: new Date(
          Date.parse(result.store.updatedAt) - 1
        ).toISOString(),
        explicitUserConfirmation: true
      })
    ).toThrowError(
      expect.objectContaining<Partial<WorkArtifactAttributionError>>({
        code: "DECISION_TIME_REGRESSION"
      })
    );
  });

  it("rejects a retained forward reference disguised as a pruned predecessor", () => {
    const oldTimestamp = new Date(
      T0.getTime() - 31 * 24 * 60 * 60 * 1_000
    ).toISOString();
    const old = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(oldTimestamp),
      {
        ...producer1(),
        artifact: COMMIT,
        attachedAt: oldTimestamp,
        explicitUserConfirmation: true
      }
    );
    const firstRetained = attachWorkArtifactAttribution(old.store, {
      ...producer1(),
      artifact: { ...COMMIT, oid: "b".repeat(40) },
      attachedAt: T0.toISOString(),
      explicitUserConfirmation: true
    });
    const secondRetained = attachWorkArtifactAttribution(
      firstRetained.store,
      {
        ...producer2(),
        artifact: { ...COMMIT, oid: "c".repeat(40) },
        attachedAt: plusMs(1_000),
        explicitUserConfirmation: true
      }
    );
    const pruned = pruneWorkArtifactAttributionStore(
      secondRetained.store,
      new Date(T0.getTime() + 2_000)
    ).store;
    const first = pruned.decisions[0]!;
    const future = pruned.decisions[1]!;
    const { attributionId: _attributionId, ...firstCore } = first;
    const forgedCore = {
      ...firstCore,
      supersedesAttributionId: future.attributionId
    };
    const { storeSha256: _storeSha256, ...content } = pruned;

    expect(() =>
      sealWorkArtifactAttributionStore({
        ...content,
        decisions: [
          {
            ...forgedCore,
            attributionId: createWorkArtifactAttributionId(forgedCore)
          },
          future
        ]
      })
    ).toThrow();
  });

  it("writes a private atomic local file and clears it on request", async () => {
    const cwd = await testDirectory();
    const attached = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      {
        ...producer1(),
        artifact: COMMIT,
        attachedAt: T0.toISOString(),
        explicitUserConfirmation: true
      }
    );

    await writeWorkArtifactAttributionStore(attached.store, cwd);
    const path = workArtifactAttributionPath(cwd);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(
      readWorkArtifactAttributionStore(cwd, T0)
    ).resolves.toEqual(attached.store);
    expect(await readFile(path, "utf8")).not.toContain("github.com");

    await clearWorkArtifactAttributionStore(cwd);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("uses a stable empty ledger identity before the first attachment", async () => {
    const cwd = await testDirectory();
    const first = await readWorkArtifactAttributionStore(cwd, T0);
    const later = await readWorkArtifactAttributionStore(
      cwd,
      new Date(T0.getTime() + 60_000)
    );

    expect(first).toEqual(later);
    expect(first).toMatchObject({
      revision: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
      decisions: []
    });
  });

  it("removes only recognized crash-temporary files on the next access", async () => {
    const cwd = await testDirectory();
    const empty = createEmptyWorkArtifactAttributionStore(
      T0.toISOString()
    );
    await writeWorkArtifactAttributionStore(empty, cwd);
    const target = workArtifactAttributionPath(cwd);
    const recognized = `${target}.1234.${"b".repeat(16)}.tmp`;
    const unrelated = `${target}.backup.tmp`;
    await Promise.all([
      writeFile(recognized, "crash temporary\n", { mode: 0o600 }),
      writeFile(unrelated, "user-owned sibling\n", { mode: 0o600 })
    ]);

    await expect(
      readWorkArtifactAttributionStore(cwd, T0)
    ).resolves.toEqual(empty);
    await expect(readFile(recognized, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(unrelated, "utf8")).resolves.toBe(
      "user-owned sibling\n"
    );
  });

  it("fails closed when the private store hash is invalid", async () => {
    const cwd = await testDirectory();
    const path = workArtifactAttributionPath(cwd);
    await writeFile(path, '{"contract":"tampered"}\n', {
      mode: 0o600
    }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const empty = createEmptyWorkArtifactAttributionStore(
        T0.toISOString()
      );
      await writeWorkArtifactAttributionStore(empty, cwd);
      await writeFile(path, '{"contract":"tampered"}\n', {
        mode: 0o600
      });
    });

    await expect(
      readWorkArtifactAttributionStore(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
  });

  it("deletes an expired invalid private store while still failing the read closed", async () => {
    const cwd = await testDirectory();
    const path = workArtifactAttributionPath(cwd);
    await writeWorkArtifactAttributionStore(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      cwd
    );
    await writeFile(path, '{"contract":"tampered"}\n', {
      mode: 0o600
    });
    const expiredAt = new Date(
      T0.getTime() - 31 * 24 * 60 * 60 * 1_000
    );
    await utimes(path, expiredAt, expiredAt);

    await expect(
      readWorkArtifactAttributionStore(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

function producer1() {
  return {
    managedRunId: RUN_1,
    bindingId: BINDING_1,
    executionId: EXECUTION_1,
    executesRelationId: RELATION_1
  };
}

function producer2() {
  return {
    managedRunId: RUN_2,
    bindingId: BINDING_2,
    executionId: EXECUTION_2,
    executesRelationId: RELATION_2
  };
}

function plusMs(milliseconds: number): string {
  return new Date(T0.getTime() + milliseconds).toISOString();
}

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-artifact-attribution-")
  );
  tempDirectories.push(directory);
  return directory;
}
