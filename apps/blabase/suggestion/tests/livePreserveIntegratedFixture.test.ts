import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  attachWorkArtifactAttribution,
  createEmptyWorkArtifactAttributionStore,
  writeWorkArtifactAttributionStore
} from "../src/artifacts";
import {
  emptyCodexContentManifest
} from "../src/connectors/codex/conversationContract";
import {
  writeStoredCodexConfig,
  writeStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import type {
  CodexSnapshot,
  StoredCodexConfig
} from "../src/connectors/codex/types";
import {
  captureStoredWeeklyOutcome,
  confirmStoredProjectMapping,
  createStoredProjectIdentity,
  readWorkContextRegistry
} from "../src/context";
import {
  beginManagedCodexRun,
  readManagedCodexObservability
} from "../src/managedCodex";
import { resolveManagedCodexWorkRelations } from "../src/relations";
import {
  bindWorkSession,
  readWorkSessionBindingStore,
  workResumptionCodexConnectionGeneration,
  writeCompanionHeartbeat
} from "../src/resumption";
import {
  evaluateLiveContinuationRead,
  evaluateLiveWorkSuggestionBoardBase
} from "../src/suggestionBoard/liveShadow";
import {
  configureProjectWorkflow,
  createEmptyProjectWorkflowStore,
  writeProjectWorkflowStore
} from "../src/workflows";

const AS_OF = "2026-08-13T12:00:00.000Z";
const SCOPE_ID = "1".repeat(24);
const SESSION_ID = "2".repeat(24);
const EXECUTION_ID = `codex:execution:${SESSION_ID}`;
const OWNER_ID = `instance_${"3".repeat(32)}`;
const STREAM_ID = `stream_${"4".repeat(32)}`;
const INSTALLATION_SECRET = "5".repeat(64);
const CODE_COMMIT_SHA = "6".repeat(40);
const PRIVATE_PATH_SENTINEL = "/private/integrated-fixture";
const CONFIG: StoredCodexConfig = {
  schemaVersion: "codex-connector-config-v3",
  installationSecret: INSTALLATION_SECRET,
  selectedScopeIds: [SCOPE_ID],
  scopes: [
    {
      id: SCOPE_ID,
      queryPath: PRIVATE_PATH_SENTINEL,
      label: "Integrated fixture",
      sessionCount: 1,
      lastActivityAt: "2026-08-13T11:58:00.000Z"
    }
  ],
  contentMode: "activity_summary",
  contentConsentAt: "2026-08-13T11:40:00.000Z",
  conversationConsentContract: null,
  conversationConsentAt: null,
  conversationRetentionDays: null,
  discoveredAt: "2026-08-13T11:40:00.000Z"
};
const SNAPSHOT: CodexSnapshot = {
  schemaVersion: "codex-snapshot-v3",
  collectorVersion: "codex-app-server-activity-summary-v1",
  contentMode: "activity_summary",
  codexVersion: "synthetic-test",
  fetchedAt: "2026-08-13T11:58:30.000Z",
  lookbackStart: "2026-08-06T11:58:30.000Z",
  truncated: false,
  conversationStoreSha256: null,
  conversationRetentionDays: null,
  scopeIds: [SCOPE_ID],
  sessions: [
    {
      id: SESSION_ID,
      source: "codex",
      kind: "coding_session",
      scopeId: SCOPE_ID,
      projectLabel: "Integrated fixture",
      taskSummary: "Continue the integrated fixture",
      taskSummarySource: "thread_name",
      createdAt: "2026-08-13T11:50:00.000Z",
      updatedAt: "2026-08-13T11:58:00.000Z",
      activityState: "idle",
      attentionState: null,
      content: emptyCodexContentManifest()
    }
  ]
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("live Work Board preserve integration", () => {
  it("reuses one non-empty authority generation without changing local bytes or metadata", async () => {
    const cwd = await integratedFixture();
    const before = await wholeTree(cwd);
    const env = Object.assign(Object.create(null), {
      NODE_ENV: "test",
      BLABASE_CODE_COMMIT_SHA: CODE_COMMIT_SHA
    }) as NodeJS.ProcessEnv;

    const result = await evaluateLiveWorkSuggestionBoardBase({
      cwd,
      now: new Date(AS_OF),
      env
    });

    expect(result.response.status).toBe("ready");
    if (result.response.status !== "ready") return;
    expect(result.response.mode).toBe("full");
    expect(result.response.board.generatedAt).toBe(AS_OF);
    const publicItems = [
      ...(result.response.board.primary === null
        ? []
        : [result.response.board.primary]),
      ...result.response.board.alternatives
    ];
    expect(
      publicItems.some(
        (item) => item.lane === "continuation"
      )
    ).toBe(true);
    expect(result.codeProvenance).toEqual({
      codeCommitSha: CODE_COMMIT_SHA,
      codeState: "declared_commit",
      codeFingerprintSha256: null
    });
    expect(result.installationSecret).toBe(INSTALLATION_SECRET);
    expect(result.registrySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await wholeTree(cwd)).toEqual(before);

    const serializedPublicResponse = JSON.stringify(result.response);
    for (const privateValue of [
      INSTALLATION_SECRET,
      PRIVATE_PATH_SENTINEL,
      SCOPE_ID,
      SESSION_ID,
      EXECUTION_ID,
      OWNER_ID,
      STREAM_ID,
      CODE_COMMIT_SHA
    ]) {
      expect(serializedPublicResponse).not.toContain(privateValue);
    }
  });

  it("serves the formal Continuation projection from one unchanged preserve capture", async () => {
    const cwd = await integratedFixture();
    const before = await wholeTree(cwd);
    const env = Object.assign(Object.create(null), {
      NODE_ENV: "test",
      BLABASE_CODE_COMMIT_SHA: CODE_COMMIT_SHA
    }) as NodeJS.ProcessEnv;

    const result = await evaluateLiveContinuationRead({
      cwd,
      now: new Date(AS_OF),
      env
    });

    expect(result).toMatchObject({
      contract: "continuation-read-api-v0.1",
      generatedAt: AS_OF,
      status: "offers_available"
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every(
        (item) => item.capability === "display" && item.action === null
      )
    ).toBe(true);
    expect(await wholeTree(cwd)).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(
      /(?:privateActionTarget|candidateId|workContext|sourceRef|Sha256|runId|analysisId)/u
    );
  });
});

async function integratedFixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "blabase-live-integrated-"));
  temporaryDirectories.push(cwd);

  const project = await createStoredProjectIdentity(
    { createdAt: "2026-08-13T11:41:00.000Z" },
    cwd
  );
  await confirmStoredProjectMapping(
    {
      scope: {
        source: "codex",
        resourceType: "scope",
        opaqueId: SCOPE_ID
      },
      projectId: project.project.projectId,
      confirmedAt: "2026-08-13T11:42:00.000Z",
      explicitUserConfirmation: true
    },
    cwd
  );
  await captureStoredWeeklyOutcome(
    {
      projectId: project.project.projectId,
      primaryOutcome: "Keep preserve capture coherent",
      capturedAt: "2026-08-13T11:43:00.000Z",
      validUntil: "2026-08-20T11:43:00.000Z",
      recordedAt: "2026-08-13T11:43:00.000Z"
    },
    cwd
  );
  const workflow = configureProjectWorkflow(
    createEmptyProjectWorkflowStore("2026-08-13T11:44:00.000Z"),
    {
      projectId: project.project.projectId,
      actionKind: "review_changes",
      configuredAt: "2026-08-13T11:45:00.000Z",
      explicitUserConfirmation: true
    }
  );
  await writeProjectWorkflowStore(workflow.store, cwd);

  await writeStoredCodexConfig(CONFIG, cwd);
  await writeStoredCodexSnapshot(SNAPSHOT, CONFIG, cwd);
  const binding = await bindWorkSession(
    {
      taskRef: {
        kind: "attention_subject",
        source: "github",
        subjectId: "github:object:101",
        displayTitle: "Integrated fixture task"
      },
      executionId: EXECUTION_ID,
      explicitUserConfirmation: true,
      boundAt: "2026-08-13T11:58:40.000Z"
    },
    cwd,
    new Date("2026-08-13T11:58:40.000Z")
  );
  await writeCompanionHeartbeat(cwd, new Date(AS_OF), OWNER_ID);

  const ownership = {
    bindingId: binding.bindingId,
    executionId: EXECUTION_ID,
    scopeId: SCOPE_ID,
    connectionGeneration: workResumptionCodexConnectionGeneration(CONFIG)
  };
  const managedRun = await beginManagedCodexRun(
    {
      ...ownership,
      ownerInstanceId: OWNER_ID,
      streamGeneration: STREAM_ID,
      startedAt: "2026-08-13T11:58:50.000Z",
      startedBy: "explicit_user",
      ownership: "blabase_app_server"
    },
    cwd
  );

  const [managed, bindingStore, registryRead] = await Promise.all([
    readManagedCodexObservability(
      {
        activeOwnerInstanceId: OWNER_ID,
        activeOwnerships: [ownership],
        now: new Date(AS_OF)
      },
      cwd
    ),
    readWorkSessionBindingStore(cwd, AS_OF),
    readWorkContextRegistry(cwd)
  ]);
  if (registryRead.status !== "available") {
    throw new Error("Expected the integrated context registry fixture.");
  }
  const workRelations = resolveManagedCodexWorkRelations({
    asOf: AS_OF,
    managedProjection: managed.projection,
    bindingStore,
    githubBatch: null,
    contextRegistry: registryRead.value
  });
  const relation = workRelations.relations[0];
  if (!relation) {
    throw new Error("Expected the integrated work relation fixture.");
  }
  const attribution = attachWorkArtifactAttribution(
    createEmptyWorkArtifactAttributionStore(
      "2026-08-13T11:59:00.000Z"
    ),
    {
      managedRunId: managedRun.managedRunId,
      bindingId: binding.bindingId,
      executionId: EXECUTION_ID,
      executesRelationId: relation.relationId,
      artifact: {
        kind: "github_commit",
        repositoryId: 101,
        oid: "7".repeat(40)
      },
      attachedAt: "2026-08-13T11:59:10.000Z",
      explicitUserConfirmation: true
    }
  );
  await writeWorkArtifactAttributionStore(attribution.store, cwd);
  return cwd;
}

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

async function wholeTree(root: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  await visitTree(root, root, await lstat(root), entries);
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
  const names =
    type === "directory"
      ? (await readdir(path)).sort(compareCodeUnits)
      : [];
  const content =
    type === "file" ? await readFile(path) : Buffer.from(JSON.stringify(names));
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
    sha256: createHash("sha256").update(content).digest("hex")
  });
  if (type !== "directory") return;
  for (const name of names) {
    const child = join(path, name);
    await visitTree(root, child, await lstat(child), entries);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
