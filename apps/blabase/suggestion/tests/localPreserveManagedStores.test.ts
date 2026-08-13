import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const stableReadRace = vi.hoisted(() => ({
  targetPath: null as string | null,
  afterRead: null as (() => Promise<void>) | null
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== stableReadRace.targetPath) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "readFile") {
            return async (
              ...readArgs: Parameters<typeof target.readFile>
            ) => {
              const value = await target.readFile(...readArgs);
              const afterRead = stableReadRace.afterRead;
              stableReadRace.targetPath = null;
              stableReadRace.afterRead = null;
              await afterRead?.();
              return value;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };
});

import {
  attachWorkArtifactAttribution,
  createEmptyWorkArtifactAttributionStore,
  readWorkArtifactAttributionStore,
  readWorkArtifactAttributionStorePreservingState,
  workArtifactAttributionPath,
  writeWorkArtifactAttributionStore
} from "../src/artifacts";
import {
  appendManagedCodexStreamEvent,
  beginManagedCodexRun,
  managedCodexLocalDirectory,
  readManagedCodexObservability,
  readManagedCodexObservabilityPreservingState
} from "../src/managedCodex";
import { readLocalPrivateText } from "../src/localReadMode";

const T0 = new Date("2026-08-01T00:00:00.000Z");
const OWNER_ID = `instance_${"e".repeat(32)}`;
const STREAM_ID = `stream_${"f".repeat(32)}`;
const ACTIVE_OWNERSHIP = {
  bindingId: `binding_${"a".repeat(32)}`,
  executionId: `codex:execution:${"b".repeat(24)}`,
  scopeId: "c".repeat(24),
  connectionGeneration: `connection_${"d".repeat(32)}`
};
const tempDirectories: string[] = [];

afterEach(async () => {
  stableReadRace.targetPath = null;
  stableReadRace.afterRead = null;
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("managed Codex preserve-only reads", () => {
  it("treats a wholly missing store as empty without creating directories", async () => {
    const cwd = await testDirectory();
    const root = managedCodexLocalDirectory(cwd);
    const local = join(cwd, ".local");
    await expect(lstat(local)).rejects.toMatchObject({ code: "ENOENT" });

    const observed = await readManagedCodexObservabilityPreservingState(
      managedInput(T0),
      cwd
    );

    expect(observed.projection.runs).toEqual([]);
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(local)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads stable state without changing content, mode, mtime, inode, or listings", async () => {
    const cwd = await testDirectory();
    const run = await beginManaged(cwd);
    const root = managedCodexLocalDirectory(cwd);
    const before = await snapshotTree(root);

    const observed = await readManagedCodexObservabilityPreservingState(
      managedInput(T0),
      cwd
    );

    expect(observed.projection.runs[0]?.managedRunId).toBe(
      run.managedRunId
    );
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("applies expired-run retention in memory but leaves files intact", async () => {
    const cwd = await testDirectory();
    const run = await beginManaged(cwd);
    await appendManagedCodexStreamEvent(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        streamGeneration: STREAM_ID,
        kind: "run_closed",
        observedAt: plusMs(T0, 1_000).toISOString()
      },
      cwd
    );
    const root = managedCodexLocalDirectory(cwd);
    const before = await snapshotTree(root);

    const observed = await readManagedCodexObservabilityPreservingState(
      managedInput(plusMs(T0, 31 * 24 * 60 * 60 * 1_000)),
      cwd
    );

    expect(observed.projection.runs).toEqual([]);
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("rejects a settlement-only state without recovery", async () => {
    const cwd = await testDirectory();
    await beginManaged(cwd);
    const root = managedCodexLocalDirectory(cwd);
    const settlement = join(root, "settlement.json");
    await writeFile(settlement, "{}\n", { mode: 0o600 });
    const before = await snapshotTree(root);

    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("rejects a recognized managed temp without cleanup", async () => {
    const cwd = await testDirectory();
    await beginManaged(cwd);
    const root = managedCodexLocalDirectory(cwd);
    const temporary = join(
      root,
      `latest.json.123.${"1".repeat(8)}-${"2".repeat(4)}-${"3".repeat(4)}-${"4".repeat(4)}-${"5".repeat(12)}.tmp`
    );
    await writeFile(temporary, "pending\n", { mode: 0o600 });
    const before = await snapshotTree(root);

    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("rejects a managed state lock without removing it", async () => {
    const cwd = await testDirectory();
    await beginManaged(cwd);
    const root = managedCodexLocalDirectory(cwd);
    const lockDirectory = join(root, "locks");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    const lock = join(lockDirectory, "state.lock");
    await writeFile(lock, "pending\n", { mode: 0o600 });
    const before = await snapshotTree(root);

    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("rejects corrupt paired stores and orphan history instead of returning empty", async () => {
    const cwd = await testDirectory();
    const root = managedCodexLocalDirectory(cwd);
    await mkdir(join(root, "events"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(join(root, "registry.json"), "{}\n", { mode: 0o600 }),
      writeFile(join(root, "latest.json"), "{}\n", { mode: 0o600 })
    ]);
    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });

    await Promise.all([
      rm(join(root, "registry.json")),
      rm(join(root, "latest.json"))
    ]);
    await writeFile(
      join(
        root,
        "events",
        `managed_run_${"9".repeat(32)}.json`
      ),
      "{}\n",
      { mode: 0o600 }
    );
    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
  });

  it("rejects unsafe file modes and symlinks without repairing them", async () => {
    const cwd = await testDirectory();
    await beginManaged(cwd);
    const latest = join(managedCodexLocalDirectory(cwd), "latest.json");
    await chmod(latest, 0o644);
    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await stat(latest)).mode & 0o777).toBe(0o644);

    await chmod(latest, 0o600);
    const registry = join(managedCodexLocalDirectory(cwd), "registry.json");
    const realRegistry = `${registry}.real`;
    await rm(realRegistry, { force: true });
    await writeFile(realRegistry, await readFile(registry), { mode: 0o600 });
    await rm(registry);
    await symlink(realRegistry, registry);
    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(registry)).isSymbolicLink()).toBe(true);
  });

  it("rejects existing and dangling symlinked .local ancestors", async () => {
    const sourceCwd = await testDirectory();
    const victimCwd = await testDirectory();
    await beginManaged(sourceCwd);
    const victimLocal = join(victimCwd, ".local");

    await symlink(join(sourceCwd, ".local"), victimLocal);
    await expect(
      readManagedCodexObservabilityPreservingState(
        managedInput(T0),
        victimCwd
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    await expect(
      readWorkArtifactAttributionStorePreservingState(victimCwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(victimLocal)).isSymbolicLink()).toBe(true);

    await rm(victimLocal);
    await symlink(join(sourceCwd, "missing-local"), victimLocal);
    await expect(
      readManagedCodexObservabilityPreservingState(
        managedInput(T0),
        victimCwd
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    await expect(
      readWorkArtifactAttributionStorePreservingState(victimCwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(victimLocal)).isSymbolicLink()).toBe(true);
  });

  it("rejects a deterministic managed file inode replacement mid-read", async () => {
    const cwd = await testDirectory();
    await beginManaged(cwd);
    const latest = join(managedCodexLocalDirectory(cwd), "latest.json");
    const displaced = `${latest}.displaced`;
    const original = await readFile(latest);
    const inodeBefore = (await lstat(latest)).ino;
    stableReadRace.targetPath = latest;
    stableReadRace.afterRead = async () => {
      await rename(latest, displaced);
      await writeFile(latest, original, { mode: 0o600 });
    };

    await expect(
      readManagedCodexObservabilityPreservingState(managedInput(T0), cwd)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(latest)).ino).not.toBe(inodeBefore);
    await expect(readFile(displaced)).resolves.toEqual(original);
  });
});

describe("artifact-attribution preserve-only reads", () => {
  it("returns the stable empty ledger without creating .local", async () => {
    const cwd = await testDirectory();
    const local = join(cwd, ".local");
    await expect(lstat(local)).rejects.toMatchObject({ code: "ENOENT" });

    const store = await readWorkArtifactAttributionStorePreservingState(
      cwd,
      T0
    );

    expect(store).toMatchObject({
      revision: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
      decisions: []
    });
    await expect(lstat(local)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns an in-memory retained view while preserving the old ledger", async () => {
    const cwd = await testDirectory();
    const attached = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      {
        managedRunId: `managed_run_${"1".repeat(32)}`,
        bindingId: `binding_${"2".repeat(32)}`,
        executionId: `codex:execution:${"3".repeat(24)}`,
        executesRelationId: `relation_${"4".repeat(32)}`,
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "5".repeat(40)
        },
        attachedAt: T0.toISOString(),
        explicitUserConfirmation: true
      }
    );
    await writeWorkArtifactAttributionStore(attached.store, cwd);
    const directory = dirname(workArtifactAttributionPath(cwd));
    const before = await snapshotTree(directory);

    const preserved =
      await readWorkArtifactAttributionStorePreservingState(
        cwd,
        plusMs(T0, 31 * 24 * 60 * 60 * 1_000)
      );

    expect(preserved.decisions).toEqual([]);
    expect(preserved.prunedDecisionCount).toBe(1);
    expect(await snapshotTree(directory)).toEqual(before);
  });

  it("rejects temp, corrupt, mode, and symlink state without cleanup or repair", async () => {
    const cwd = await testDirectory();
    const target = workArtifactAttributionPath(cwd);
    await writeWorkArtifactAttributionStore(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      cwd
    );
    const temporary = `${target}.123.${"a".repeat(16)}.tmp`;
    await writeFile(temporary, "pending\n", { mode: 0o600 });
    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    await expect(readFile(temporary, "utf8")).resolves.toBe("pending\n");
    await rm(temporary);

    await writeFile(target, "{}\n", { mode: 0o600 });
    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    await expect(readFile(target, "utf8")).resolves.toBe("{}\n");

    await chmod(target, 0o644);
    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await stat(target)).mode & 0o777).toBe(0o644);

    await chmod(target, 0o600);
    const realTarget = `${target}.real`;
    await writeFile(realTarget, "{}\n", { mode: 0o600 });
    await rm(target);
    await symlink(realTarget, target);
    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
  });

  it("rejects an attribution state lock without removing it", async () => {
    const cwd = await testDirectory();
    await writeWorkArtifactAttributionStore(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      cwd
    );
    const directory = dirname(workArtifactAttributionPath(cwd));
    const lockDirectory = join(directory, "locks");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    const lock = join(lockDirectory, "state.lock");
    await writeFile(lock, "pending\n", { mode: 0o600 });
    const before = await snapshotTree(directory);

    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await snapshotTree(directory)).toEqual(before);
  });

  it("rejects a deterministic attribution file inode replacement mid-read", async () => {
    const cwd = await testDirectory();
    await writeWorkArtifactAttributionStore(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      cwd
    );
    const target = workArtifactAttributionPath(cwd);
    const displaced = `${target}.displaced`;
    const original = await readFile(target);
    const inodeBefore = (await lstat(target)).ino;
    stableReadRace.targetPath = target;
    stableReadRace.afterRead = async () => {
      await rename(target, displaced);
      await writeFile(target, original, { mode: 0o600 });
    };

    await expect(
      readWorkArtifactAttributionStorePreservingState(cwd, T0)
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect((await lstat(target)).ino).not.toBe(inodeBefore);
    await expect(readFile(displaced)).resolves.toEqual(original);
  });

  it("leaves legacy maintenance behavior available", async () => {
    const cwd = await testDirectory();
    await writeWorkArtifactAttributionStore(
      createEmptyWorkArtifactAttributionStore(T0.toISOString()),
      cwd
    );
    const target = workArtifactAttributionPath(cwd);
    const temporary = `${target}.123.${"b".repeat(16)}.tmp`;
    await writeFile(temporary, "pending\n", { mode: 0o600 });

    await expect(readWorkArtifactAttributionStore(cwd, T0)).resolves.toBeDefined();
    await expect(readFile(temporary, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("shared preserve-read stability", () => {
  it("rejects a deterministic private-file inode replacement mid-read", async () => {
    const cwd = await testDirectory();
    const directory = join(cwd, ".local", "read-test");
    const target = join(directory, "state.json");
    const displaced = `${target}.displaced`;
    const original = Buffer.from('{"state":"current"}\n');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(join(cwd, ".local"), 0o700);
    await chmod(directory, 0o700);
    await writeFile(target, original, { mode: 0o600 });
    const inodeBefore = (await lstat(target)).ino;
    stableReadRace.targetPath = target;
    stableReadRace.afterRead = async () => {
      await rename(target, displaced);
      await writeFile(target, original, { mode: 0o600 });
    };

    await expect(
      readLocalPrivateText(target, "preserve", cwd)
    ).rejects.toThrow("changing file");
    expect((await lstat(target)).ino).not.toBe(inodeBefore);
    await expect(readFile(displaced)).resolves.toEqual(original);
  });

  it("rejects a deterministic controlled-directory identity change mid-read", async () => {
    const cwd = await testDirectory();
    const local = join(cwd, ".local");
    const displacedLocal = join(cwd, ".local.displaced");
    const directory = join(local, "read-test");
    const target = join(directory, "state.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(local, 0o700);
    await chmod(directory, 0o700);
    await writeFile(target, '{"state":"current"}\n', { mode: 0o600 });
    stableReadRace.targetPath = target;
    stableReadRace.afterRead = async () => {
      await rename(local, displacedLocal);
      await symlink(displacedLocal, local);
    };

    await expect(
      readLocalPrivateText(target, "preserve", cwd)
    ).rejects.toThrow("private directory chain");
    expect((await lstat(local)).isSymbolicLink()).toBe(true);
  });

  it("rejects an unsafe ancestor mode without repairing it", async () => {
    const cwd = await testDirectory();
    const local = join(cwd, ".local");
    const directory = join(local, "read-test");
    const target = join(directory, "state.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(local, 0o755);
    await chmod(directory, 0o700);
    await writeFile(target, '{"state":"current"}\n', { mode: 0o600 });

    await expect(
      readLocalPrivateText(target, "preserve", cwd)
    ).rejects.toThrow("private directory chain");
    expect((await lstat(local)).mode & 0o777).toBe(0o755);
  });
});

async function beginManaged(cwd: string) {
  return beginManagedCodexRun(
    {
      ...ACTIVE_OWNERSHIP,
      ownerInstanceId: OWNER_ID,
      streamGeneration: STREAM_ID,
      startedAt: T0.toISOString(),
      startedBy: "explicit_user",
      ownership: "blabase_app_server"
    },
    cwd
  );
}

function managedInput(now: Date) {
  return {
    activeOwnerInstanceId: OWNER_ID,
    activeOwnerships: [ACTIVE_OWNERSHIP],
    now
  };
}

function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blabase-preserve-store-"));
  tempDirectories.push(directory);
  return directory;
}

type TreeEntry = {
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  mode: number;
  inode: number;
  mtimeMs: number;
  content: string | null;
};

async function snapshotTree(root: string): Promise<TreeEntry[]> {
  // atime is deliberately excluded because successful read/readdir syscalls
  // can update OS access accounting without a code-controlled mutation.
  const rootMetadata = await lstat(root);
  const entries: TreeEntry[] = [];
  await visit(root, root, rootMetadata, entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function visit(
  root: string,
  path: string,
  metadata: Stats,
  entries: TreeEntry[]
): Promise<void> {
  const kind = metadata.isDirectory()
    ? "directory"
    : metadata.isFile()
      ? "file"
      : metadata.isSymbolicLink()
        ? "symlink"
        : "other";
  entries.push({
    path: relative(root, path) || ".",
    kind,
    mode: metadata.mode & 0o777,
    inode: metadata.ino,
    mtimeMs: metadata.mtimeMs,
    content: kind === "file" ? await readFile(path, "utf8") : null
  });
  if (kind !== "directory") return;
  for (const filename of (await readdir(path)).sort()) {
    const child = join(path, filename);
    await visit(root, child, await lstat(child), entries);
  }
}
