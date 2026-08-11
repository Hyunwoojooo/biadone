import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const readGate = vi.hoisted(() => ({
  enabled: false,
  registryReadCount: 0,
  wait: null as Promise<void> | null,
  release: null as (() => void) | null,
  firstReadStarted: null as Promise<void> | null,
  signalFirstRead: null as (() => void) | null
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const value = await actual.readFile(...args);
      if (
        readGate.enabled &&
        String(args[0]).endsWith("project-registry.json") &&
        readGate.registryReadCount < 2
      ) {
        readGate.registryReadCount += 1;
        if (readGate.registryReadCount === 1) {
          readGate.signalFirstRead?.();
        }
        await readGate.wait;
      }
      return value;
    }
  };
});

const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;
const T0 = "2026-08-09T00:00:00.000Z";
const T1 = "2026-08-09T00:01:00.000Z";
const githubScope = {
  source: "github" as const,
  resourceType: "repository" as const,
  opaqueId: "101"
};
const codexScope = {
  source: "codex" as const,
  resourceType: "scope" as const,
  opaqueId: "b".repeat(24)
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  readGate.enabled = false;
  readGate.registryReadCount = 0;
  readGate.wait = null;
  readGate.release = null;
  readGate.firstReadStarted = null;
  readGate.signalFirstRead = null;
  vi.resetModules();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("work context mutation coordination across module reloads", () => {
  it("preserves an atomic pair confirmation during a concurrent project mutation", async () => {
    const cwd = await temporaryDirectory();
    const first = await import("../src/context/localStore");
    const created = await first.createStoredProjectIdentity(
      { projectId: PROJECT_A, createdAt: T0 },
      cwd
    );

    vi.resetModules();
    const second = await import("../src/context/localStore");

    readGate.wait = new Promise<void>((resolve) => {
      readGate.release = resolve;
    });
    readGate.firstReadStarted = new Promise<void>((resolve) => {
      readGate.signalFirstRead = resolve;
    });
    readGate.enabled = true;

    const pairMutation = first.confirmStoredRepositoryScopeProposal(
      {
        githubScope,
        codexScope,
        projectId: PROJECT_A,
        confirmedAt: T1,
        expectedRegistrySha256: created.registry.registrySha256,
        explicitUserConfirmation: true
      },
      cwd
    );
    await readGate.firstReadStarted;

    const concurrentProject = second.createStoredProjectIdentity(
      { projectId: PROJECT_B, createdAt: T1 },
      join(cwd, ".")
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    readGate.release?.();

    await Promise.all([pairMutation, concurrentProject]);
    readGate.enabled = false;
    const stored = await second.readWorkContextRegistry(cwd);

    expect(stored.status).toBe("available");
    if (stored.status !== "available") return;
    expect(stored.value.projects.map((project) => project.projectId)).toEqual([
      PROJECT_A,
      PROJECT_B
    ]);
    expect(stored.value.mappingProposals).toHaveLength(2);
    expect(stored.value.mappingDecisions).toHaveLength(2);
    expect(
      stored.value.mappingDecisions
        .map((decision) => decision.scope.source)
        .sort()
    ).toEqual(["codex", "github"]);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-work-context-module-reload-")
  );
  temporaryDirectories.push(directory);
  return directory;
}
