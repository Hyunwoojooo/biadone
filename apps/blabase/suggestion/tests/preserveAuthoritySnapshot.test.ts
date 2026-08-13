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
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StoredCodexConfig } from "../src/connectors/codex/types";
import {
  bindWorkSessionDecision,
  createEmptyWorkSessionBindingStore,
  createWorkResumptionHeartbeat,
  withManagedCodexAuthoritySnapshotPreservingState,
  workResumptionCodexConnectionGeneration,
  workResumptionLocalDirectory
} from "../src/resumption";
import {
  resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot,
  resolveCurrentWorkEvidenceFromInputs,
  resolveCurrentWorkEvidenceFromPreservedSnapshot
} from "../src/workEvidence/currentWorkEvidence";

const AS_OF = "2026-08-13T12:00:00.000Z";
const INSTANCE_ID = `instance_${"1".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"2".repeat(24)}`;
const SCOPE_ID = "3".repeat(24);
const CONFIG: StoredCodexConfig = {
  schemaVersion: "codex-connector-config-v3",
  installationSecret: "4".repeat(64),
  selectedScopeIds: [],
  scopes: [],
  contentMode: "metadata_only",
  contentConsentAt: null,
  conversationConsentContract: null,
  conversationConsentAt: null,
  conversationRetentionDays: null,
  discoveredAt: "2026-08-13T11:00:00.000Z"
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("preserve Work Resumption authority snapshot", () => {
  it("reuses supplied config, returns exact binding authority, and creates no lease", async () => {
    const cwd = await authorityFixture();
    const before = await wholeTree(cwd);
    const requestedNow = new Date(AS_OF);
    let callbackCount = 0;

    const captured = await withManagedCodexAuthoritySnapshotPreservingState(
      cwd,
      requestedNow,
      CONFIG,
      async (snapshot) => {
        callbackCount += 1;
        expect(snapshot.now).not.toBe(requestedNow);
        return snapshot;
      }
    );

    expect(callbackCount).toBe(1);
    expect(captured.asOf).toBe(AS_OF);
    expect(captured.now.toISOString()).toBe(AS_OF);
    expect(captured.codexConfig).toBe(CONFIG);
    expect(captured.bindingStore.revision).toBe(1);
    expect(captured.authority).toEqual({
      activeOwnerInstanceId: INSTANCE_ID,
      activeOwnerships: [
        {
          bindingId: expect.stringMatching(/^binding_[a-f0-9]{32}$/u),
          executionId: EXECUTION_ID,
          scopeId: SCOPE_ID,
          connectionGeneration: workResumptionCodexConnectionGeneration({
            installationSecret: CONFIG.installationSecret,
            discoveredAt: CONFIG.discoveredAt
          })
        }
      ]
    });
    expect(await wholeTree(cwd)).toEqual(before);
    expect(
      (await readdir(workResumptionLocalDirectory(cwd))).includes("locks")
    ).toBe(false);
  });

  it("fails closed when a binding is replaced during the callback", async () => {
    const cwd = await authorityFixture();
    const target = join(workResumptionLocalDirectory(cwd), "bindings.json");
    const replacement = `${target}.replacement`;

    await expect(
      withManagedCodexAuthoritySnapshotPreservingState(
        cwd,
        new Date(AS_OF),
        CONFIG,
        async () => {
          await writeFile(replacement, await readFile(target), { mode: 0o600 });
          await rename(replacement, target);
          return null;
        }
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
  });

  it("rejects corrupt state and critical locks without cleanup", async () => {
    const corruptCwd = await authorityFixture();
    const bindings = join(workResumptionLocalDirectory(corruptCwd), "bindings.json");
    await writeFile(bindings, "{corrupt\n", { mode: 0o600 });
    const corruptBefore = await wholeTree(corruptCwd);
    await expect(
      withManagedCodexAuthoritySnapshotPreservingState(
        corruptCwd,
        new Date(AS_OF),
        CONFIG,
        async () => null
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await wholeTree(corruptCwd)).toEqual(corruptBefore);

    const lockedCwd = await authorityFixture();
    const lockDirectory = join(workResumptionLocalDirectory(lockedCwd), "locks");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(lockDirectory, "heartbeat.lock"), "sentinel\n", {
      mode: 0o600
    });
    const lockedBefore = await wholeTree(lockedCwd);
    await expect(
      withManagedCodexAuthoritySnapshotPreservingState(
        lockedCwd,
        new Date(AS_OF),
        CONFIG,
        async () => null
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
    expect(await wholeTree(lockedCwd)).toEqual(lockedBefore);
  });

  it("uses one exact asOf through authority, empty managed, relations, artifacts, and claims", async () => {
    const cwd = await temporaryCwd();
    let normalizedAt: string | null = null;

    const evidence = await resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot({
      cwd,
      now: new Date(AS_OF),
      codexConfig: null,
      contextRegistry: null,
      resolveGithubBatch: (asOf) => {
        normalizedAt = asOf;
        return null;
      }
    });

    expect(normalizedAt).toBe(AS_OF);
    expect(evidence.asOf).toBe(AS_OF);
    expect(evidence.managedProjection.generatedAt).toBe(AS_OF);
    expect(evidence.managedSemantics.generatedAt).toBe(AS_OF);
    expect(evidence.workRelations.asOf).toBe(AS_OF);
    expect(evidence.artifacts.asOf).toBe(AS_OF);
    expect(evidence.claims.asOf).toBe(AS_OF);
    await expect(lstat(join(cwd, ".local"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("keeps stable empty evidence equivalent across preserve entry points and maintain mode", async () => {
    const firstCwd = await temporaryCwd();
    const secondCwd = await temporaryCwd();
    const maintainCwd = await temporaryCwd();
    const direct = await resolveCurrentWorkEvidenceAtPreservedAuthoritySnapshot({
      cwd: firstCwd,
      now: new Date(AS_OF),
      codexConfig: null,
      contextRegistry: null,
      resolveGithubBatch: () => null
    });
    const supplied = await withManagedCodexAuthoritySnapshotPreservingState(
      secondCwd,
      new Date(AS_OF),
      null,
      (snapshot) =>
        resolveCurrentWorkEvidenceFromPreservedSnapshot({
          cwd: secondCwd,
          snapshot,
          githubBatch: null,
          contextRegistry: null
        })
    );
    const maintained = await resolveCurrentWorkEvidenceFromInputs({
      cwd: maintainCwd,
      now: new Date(AS_OF),
      githubBatch: null,
      contextRegistry: null
    });

    expect(supplied).toEqual(direct);
    expect(maintained).toEqual(direct);
  });
});

async function authorityFixture(): Promise<string> {
  const cwd = await temporaryCwd();
  const directory = workResumptionLocalDirectory(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(join(cwd, ".local"), 0o700);
  await chmod(directory, 0o700);
  const bound = bindWorkSessionDecision(
    createEmptyWorkSessionBindingStore("2026-08-13T11:30:00.000Z"),
    {
      taskRef: {
        kind: "attention_subject",
        source: "codex",
        subjectId: "preserve-authority-fixture",
        displayTitle: "Synthetic fixture"
      },
      executionId: EXECUTION_ID,
      scopeId: SCOPE_ID,
      boundAt: "2026-08-13T11:30:00.000Z",
      explicitUserConfirmation: true
    }
  );
  await Promise.all([
    writeFile(
      join(directory, "bindings.json"),
      `${JSON.stringify(bound.store)}\n`,
      { mode: 0o600 }
    ),
    writeFile(
      join(directory, "heartbeat.json"),
      `${JSON.stringify(
        createWorkResumptionHeartbeat(AS_OF, INSTANCE_ID)
      )}\n`,
      { mode: 0o600 }
    )
  ]);
  return cwd;
}

type TreeEntry = {
  path: string;
  type: "directory" | "file" | "other";
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

async function temporaryCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "blabase-pr002-authority-"));
  temporaryDirectories.push(cwd);
  return cwd;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
