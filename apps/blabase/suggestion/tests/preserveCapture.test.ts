import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildPreserveCaptureManifest,
  capturePreservingLocalState,
  PreserveCaptureError
} from "../src/attention/preserveCapture";
import {
  createStoredProjectIdentity,
  readWeeklyOutcomeStore,
  readWorkContextRegistry
} from "../src/context";
import {
  configureProjectWorkflow,
  createEmptyProjectWorkflowStore,
  readProjectWorkflowStore,
  writeProjectWorkflowStore
} from "../src/workflows";

const AS_OF = "2026-08-13T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("attention preserve capture v0.1", () => {
  it("returns a descriptor-safe sorted manifest and preserves the full tree", async () => {
    const cwd = await temporaryCwd();
    const contextDirectory = join(cwd, ".local", "context");
    const connectorDirectory = join(cwd, ".local", "connectors", "github");
    const resumptionDirectory = join(cwd, ".local", "work-resumption");
    for (const directory of [
      contextDirectory,
      connectorDirectory,
      resumptionDirectory
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmodPrivateChain(cwd, directory);
    }
    await Promise.all([
      writeFile(join(contextDirectory, "z.json"), "z\n", { mode: 0o600 }),
      writeFile(join(connectorDirectory, "a.json"), "a\n", { mode: 0o600 }),
      writeFile(join(resumptionDirectory, "bindings.json"), "b\n", {
        mode: 0o600
      })
    ]);
    const before = await wholeTree(cwd);

    const manifest = await buildPreserveCaptureManifest(cwd, "base");
    const captured = await capturePreservingLocalState({
      cwd,
      read: async () => "stable"
    });

    expect(captured).toBe("stable");
    expect(manifest).toMatchObject({
      contract: "attention-preserve-capture-v0.1",
      scope: "base",
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(manifest.entries.map((entry) => entry.path)).toEqual(
      [...manifest.entries.map((entry) => entry.path)].sort(compareCodeUnits)
    );
    for (const entry of manifest.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          "changedAtMs",
          "device",
          "gid",
          "inode",
          "linkCount",
          "mode",
          "modifiedAtMs",
          "path",
          "sha256",
          "size",
          "type",
          "uid"
        ].sort()
      );
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(await wholeTree(cwd)).toEqual(before);
  });

  it("retries exactly once after an inode replacement and returns the stable attempt", async () => {
    const cwd = await temporaryCwd();
    const directory = join(cwd, ".local", "context");
    const target = join(directory, "project-registry.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmodPrivateChain(cwd, directory);
    await writeFile(target, "first\n", { mode: 0o600 });
    let calls = 0;

    const result = await capturePreservingLocalState({
      cwd,
      read: async () => {
        calls += 1;
        if (calls === 1) {
          const replacement = `${target}.replacement`;
          await writeFile(replacement, "second\n", { mode: 0o600 });
          await rename(replacement, target);
        }
        return calls;
      }
    });

    expect(result).toBe(2);
    expect(calls).toBe(2);
  });

  it("fails typed after a second unstable attempt and does not retry callback errors", async () => {
    const cwd = await temporaryCwd();
    const directory = join(cwd, ".local", "context");
    const target = join(directory, "project-registry.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmodPrivateChain(cwd, directory);
    await writeFile(target, "0\n", { mode: 0o600 });
    let calls = 0;

    await expect(
      capturePreservingLocalState({
        cwd,
        read: async () => {
          calls += 1;
          const replacement = `${target}.${calls}`;
          await writeFile(replacement, `${calls}\n`, { mode: 0o600 });
          await rename(replacement, target);
          return calls;
        }
      })
    ).rejects.toMatchObject({ code: "PRESERVE_CAPTURE_UNSTABLE" });
    expect(calls).toBe(2);

    const callbackError = new TypeError("domain failure");
    calls = 0;
    await expect(
      capturePreservingLocalState({
        cwd,
        read: async () => {
          calls += 1;
          throw callbackError;
        }
      })
    ).rejects.toBe(callbackError);
    expect(calls).toBe(1);
  });

  it("rejects symlink, unsafe path, temp, settlement, and every base lock sentinel", async () => {
    const unsafeCases: Array<{
      name: string;
      arrange: (cwd: string) => Promise<string>;
    }> = [
      {
        name: "ancestor symlink",
        arrange: async (cwd) => {
          const external = await temporaryCwd();
          await mkdir(join(external, "connectors"), { recursive: true, mode: 0o700 });
          await symlink(external, join(cwd, ".local"));
          return cwd;
        }
      },
      {
        name: "final symlink",
        arrange: async (cwd) => {
          const directory = join(cwd, ".local", "context");
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await chmodPrivateChain(cwd, directory);
          const external = join(cwd, "external.json");
          await writeFile(external, "{}", { mode: 0o600 });
          await symlink(external, join(directory, "project-registry.json"));
          return cwd;
        }
      },
      {
        name: "unsafe file mode",
        arrange: async (cwd) =>
          arrangeSentinel(cwd, ".local/context/project-registry.json", 0o644)
      },
      {
        name: "unsafe directory mode",
        arrange: async (cwd) => {
          const path = join(cwd, ".local", "context");
          await mkdir(path, { recursive: true, mode: 0o700 });
          await chmodPrivateChain(cwd, path);
          await chmod(path, 0o755);
          return cwd;
        }
      },
      {
        name: "recognized temp",
        arrange: async (cwd) =>
          arrangeSentinel(cwd, ".local/context/pending.json.tmp")
      },
      {
        name: "managed settlement",
        arrange: async (cwd) =>
          arrangeSentinel(
            cwd,
            ".local/connectors/codex/managed/settlement.json"
          )
      },
      {
        name: "work resumption state lock",
        arrange: async (cwd) =>
          arrangeSentinel(cwd, ".local/work-resumption/locks/state.lock")
      },
      {
        name: "work resumption heartbeat lock",
        arrange: async (cwd) =>
          arrangeSentinel(cwd, ".local/work-resumption/locks/heartbeat.lock")
      },
      {
        name: "managed lock",
        arrange: async (cwd) =>
          arrangeSentinel(
            cwd,
            ".local/connectors/codex/managed/locks/state.lock"
          )
      },
      {
        name: "artifact lock",
        arrange: async (cwd) =>
          arrangeSentinel(
            cwd,
            ".local/work-resumption/artifact-attributions/locks/state.lock"
          )
      }
    ];

    for (const fixture of unsafeCases) {
      const cwd = await temporaryCwd();
      await fixture.arrange(cwd);
      const before = await wholeTree(cwd);
      await expect(buildPreserveCaptureManifest(cwd, "base"), fixture.name)
        .rejects.toBeInstanceOf(PreserveCaptureError);
      expect(await wholeTree(cwd), fixture.name).toEqual(before);
    }
  });

  it("separates semantic instability from the base manifest", async () => {
    const cwd = await temporaryCwd();
    await arrangeSentinel(
      cwd,
      ".local/semantic-continuation/validation/run.lock"
    );

    await expect(buildPreserveCaptureManifest(cwd, "base")).resolves.toMatchObject({
      scope: "base"
    });
    await expect(
      buildPreserveCaptureManifest(cwd, "semantic")
    ).rejects.toMatchObject({ code: "PRESERVE_CAPTURE_INVALID" });
  });

  it("does not let semantic tree creation perturb an in-flight base capture", async () => {
    const cwd = await temporaryCwd();
    const local = join(cwd, ".local");
    await mkdir(join(local, "context"), { recursive: true, mode: 0o700 });
    await chmodPrivateChain(cwd, join(local, "context"));
    let calls = 0;

    await expect(
      capturePreservingLocalState({
        cwd,
        scope: "base",
        read: async () => {
          calls += 1;
          const semantic = join(local, "semantic-continuation");
          await mkdir(semantic, { recursive: true, mode: 0o700 });
          await chmod(semantic, 0o700);
          await writeFile(join(semantic, "intent-store.json"), "{}\n", {
            mode: 0o600
          });
          return "base";
        }
      })
    ).resolves.toBe("base");
    expect(calls).toBe(1);
  });

  it("does not let base-root creation perturb an in-flight semantic capture", async () => {
    const cwd = await temporaryCwd();
    const local = join(cwd, ".local");
    await mkdir(join(local, "semantic-continuation"), {
      recursive: true,
      mode: 0o700
    });
    await chmodPrivateChain(cwd, join(local, "semantic-continuation"));
    let calls = 0;

    await expect(
      capturePreservingLocalState({
        cwd,
        scope: "semantic",
        read: async () => {
          calls += 1;
          const context = join(local, "context");
          await mkdir(context, { recursive: true, mode: 0o700 });
          await chmod(context, 0o700);
          await writeFile(join(context, "project-registry.json"), "{}\n", {
            mode: 0o600
          });
          return "semantic";
        }
      })
    ).resolves.toBe("semantic");
    expect(calls).toBe(1);
  });

  it("ignores other-scope creation and removal when .local has no current-scope root", async () => {
    const cases = [
      {
        scope: "base" as const,
        otherRoot: "semantic-continuation"
      },
      {
        scope: "semantic" as const,
        otherRoot: "context"
      }
    ];

    for (const fixture of cases) {
      const createdCwd = await temporaryCwd();
      const createdLocal = join(createdCwd, ".local");
      let createCalls = 0;
      await expect(
        capturePreservingLocalState({
          cwd: createdCwd,
          scope: fixture.scope,
          read: async () => {
            createCalls += 1;
            const otherRoot = join(createdLocal, fixture.otherRoot);
            await mkdir(otherRoot, { recursive: true, mode: 0o700 });
            await chmod(createdLocal, 0o700);
            await chmod(otherRoot, 0o700);
            return fixture.scope;
          }
        })
      ).resolves.toBe(fixture.scope);
      expect(createCalls).toBe(1);

      const removedCwd = await temporaryCwd();
      const removedLocal = join(removedCwd, ".local");
      const otherRoot = join(removedLocal, fixture.otherRoot);
      await mkdir(otherRoot, { recursive: true, mode: 0o700 });
      await chmod(removedLocal, 0o700);
      await chmod(otherRoot, 0o700);
      let removeCalls = 0;
      await expect(
        capturePreservingLocalState({
          cwd: removedCwd,
          scope: fixture.scope,
          read: async () => {
            removeCalls += 1;
            await rm(otherRoot, { recursive: true });
            await rm(removedLocal, { recursive: true });
            return fixture.scope;
          }
        })
      ).resolves.toBe(fixture.scope);
      expect(removeCalls).toBe(1);
      await expect(lstat(removedLocal)).rejects.toMatchObject({
        code: "ENOENT"
      });
    }
  });

  it("keeps stable context/outcome/workflow semantics equal to maintain reads", async () => {
    const cwd = await temporaryCwd();
    const created = await createStoredProjectIdentity(
      { createdAt: AS_OF },
      cwd
    );
    const configured = configureProjectWorkflow(
      createEmptyProjectWorkflowStore(AS_OF),
      {
        projectId: created.project.projectId,
        actionKind: "request_review",
        configuredAt: AS_OF,
        explicitUserConfirmation: true
      }
    );
    await writeProjectWorkflowStore(configured.store, cwd);
    const contextDirectory = join(cwd, ".local", "context");
    await chmodPrivateChain(cwd, contextDirectory);
    const before = await wholeTree(cwd);

    const [maintainRegistry, preserveRegistry, maintainOutcome, preserveOutcome,
      maintainWorkflow, preserveWorkflow] = await Promise.all([
      readWorkContextRegistry(cwd),
      readWorkContextRegistry(cwd, "preserve"),
      readWeeklyOutcomeStore(cwd),
      readWeeklyOutcomeStore(cwd, "preserve"),
      readProjectWorkflowStore(cwd),
      readProjectWorkflowStore(cwd, "preserve")
    ]);

    expect(preserveRegistry).toEqual(maintainRegistry);
    expect(preserveOutcome).toEqual(maintainOutcome);
    expect(preserveWorkflow).toEqual(maintainWorkflow);
    expect(await wholeTree(cwd)).toEqual(before);
  });
});

type TreeEntry = {
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  mode: number;
  uid: number;
  gid: number;
  device: number;
  inode: number;
  linkCount: number;
  size: number;
  modifiedAtMs: number;
  changedAtMs: number;
  sha256: string;
};

async function wholeTree(cwd: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  await visitTree(cwd, cwd, await lstat(cwd), entries);
  return entries.sort((left, right) => compareCodeUnits(left.path, right.path));
}

async function visitTree(
  root: string,
  path: string,
  metadata: Stats,
  entries: TreeEntry[]
): Promise<void> {
  const type = metadata.isDirectory()
    ? "directory"
    : metadata.isFile()
      ? "file"
      : metadata.isSymbolicLink()
        ? "symlink"
        : "other";
  const names = type === "directory" ? (await readdir(path)).sort(compareCodeUnits) : [];
  const bytes = type === "file" ? await readFile(path) : Buffer.from(JSON.stringify(names));
  entries.push({
    path: relative(root, path) || ".",
    type,
    mode: metadata.mode & 0o777,
    uid: metadata.uid,
    gid: metadata.gid,
    device: metadata.dev,
    inode: metadata.ino,
    linkCount: metadata.nlink,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    changedAtMs: metadata.ctimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
  if (type !== "directory") return;
  for (const name of names) {
    const child = join(path, name);
    await visitTree(root, child, await lstat(child), entries);
  }
}

async function arrangeSentinel(
  cwd: string,
  relativePath: string,
  mode = 0o600
): Promise<string> {
  const target = join(cwd, relativePath);
  await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
  await chmodPrivateChain(cwd, join(target, ".."));
  await writeFile(target, "sentinel\n", { mode });
  return cwd;
}

async function chmodPrivateChain(cwd: string, directory: string): Promise<void> {
  let current = join(cwd, ".local");
  while (current === directory || directory.startsWith(`${current}/`)) {
    await chmod(current, 0o700);
    if (current === directory) return;
    const remainder = relative(current, directory).split("/")[0];
    if (!remainder) return;
    current = join(current, remainder);
  }
}

async function temporaryCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "blabase-pr002-capture-"));
  temporaryDirectories.push(cwd);
  return cwd;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
