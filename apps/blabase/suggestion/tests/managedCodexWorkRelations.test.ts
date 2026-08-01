import { describe, expect, it } from "vitest";

import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type {
  GitHubSnapshot,
  GitHubTaskSignal
} from "../src/connectors/github/types";
import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  type WorkContextRegistry
} from "../src/context/contracts";
import {
  bindWorkSessionDecision,
  createEmptyWorkSessionBindingStore,
  unbindWorkSessionDecision,
  type WorkSessionBindingStore
} from "../src/resumption/contracts";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  sealManagedCodexWorkRelationProjection
} from "../src/relations";
import type { ManagedCodexPublicProjection } from "../src/managedCodex/contracts";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../src/crossSource/versions";

const AS_OF = "2026-08-01T03:00:00.000Z";
const FETCHED_AT = "2026-08-01T02:59:00.000Z";
const EXECUTION_1 = `codex:execution:${"1".repeat(24)}`;
const EXECUTION_2 = `codex:execution:${"2".repeat(24)}`;
const SCOPE_1 = "a".repeat(24);
const SCOPE_2 = "b".repeat(24);
const PROJECT_1 = `project_${"1".repeat(32)}`;
const PROJECT_2 = `project_${"2".repeat(32)}`;

describe("managed Codex work relation resolver", () => {
  it("resolves an exact explicit GitHub binding without merging identities", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const managed = managedProjection([
      managedRun(binding.bindingId, EXECUTION_1, "1")
    ]);
    const result = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managed,
      bindingStore: binding.store,
      githubBatch: githubBatch([
        githubTask({ id: 501, number: 42 })
      ]),
      contextRegistry: createEmptyWorkContextRegistry(AS_OF)
    });

    expect(managedCodexWorkRelationProjectionSchema.parse(result)).toEqual(
      result
    );
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      bindingId: binding.bindingId,
      type: "executes",
      authority: "user_configured",
      from: {
        kind: "execution",
        source: "codex",
        subjectId: EXECUTION_1
      },
      to: {
        kind: "work_item",
        source: "github",
        subjectId: "github:object:501"
      },
      bindingEvidence: {
        decisionSource: "explicit_user",
        bindingState: "active",
        supersededByBindingId: null
      },
      githubObservation: {
        status: "current",
        objectType: "issue",
        taskKind: "assigned_issue",
        number: 42
      },
      projectAlignment: { status: "unmapped" },
      identityStatus: "resolved",
      conflictCodes: [],
      attentionDisposition: "not_connected",
      forbiddenAsAttentionCandidate: true
    });
    expect(result.runResolutions[0]).toMatchObject({
      status: "resolved",
      relationId: result.relations[0]?.relationId
    });
    expect(result.relations[0]?.from.subjectId).not.toBe(
      result.relations[0]?.to.subjectId
    );
  });

  it("preserves historical relation provenance after rebind and unbind", () => {
    const first = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const rebound = bindWorkSessionDecision(first.store, {
      taskRef: taskRef("github:object:501"),
      executionId: EXECUTION_2,
      scopeId: SCOPE_2,
      boundAt: "2026-08-01T02:50:00.000Z",
      explicitUserConfirmation: true
    });
    const reboundProjection = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(first.bindingId, EXECUTION_1, "1")
      ]),
      bindingStore: rebound.store,
      githubBatch: githubBatch([githubTask({ id: 501 })]),
      contextRegistry: createEmptyWorkContextRegistry(AS_OF)
    });
    expect(
      reboundProjection.relations[0]?.bindingEvidence
    ).toMatchObject({
      bindingState: "superseded_by_rebind",
      supersededByBindingId: rebound.binding.bindingId
    });

    const unbound = unbindWorkSessionDecision(first.store, {
      taskRef: taskRef("github:object:501"),
      unboundAt: "2026-08-01T02:50:00.000Z",
      explicitUserConfirmation: true
    });
    const unboundProjection = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(first.bindingId, EXECUTION_1, "1")
      ]),
      bindingStore: unbound.store,
      githubBatch: githubBatch([githubTask({ id: 501 })]),
      contextRegistry: createEmptyWorkContextRegistry(AS_OF)
    });
    expect(
      unboundProjection.relations[0]?.bindingEvidence
    ).toMatchObject({
      bindingState: "superseded_by_unbind",
      supersededByBindingId: unbound.decision?.bindingId
    });
  });

  it("records aligned and conflicting explicit project mappings without inventing a relation", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const managed = managedProjection([
      managedRun(binding.bindingId, EXECUTION_1, "1")
    ]);
    const batch = githubBatch([githubTask({ id: 501 })], (scopeId) =>
      scopeId === "repository:101" ? PROJECT_1 : null
    );
    const aligned = mappedRegistry(PROJECT_1, PROJECT_1);
    const alignedResult = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managed,
      bindingStore: binding.store,
      githubBatch: batch,
      contextRegistry: aligned
    });
    expect(alignedResult.relations[0]?.projectAlignment).toMatchObject({
      status: "aligned",
      projectId: PROJECT_1
    });
    expect(alignedResult.relations).toHaveLength(1);

    const conflictResult = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managed,
      bindingStore: binding.store,
      githubBatch: batch,
      contextRegistry: mappedRegistry(PROJECT_2, PROJECT_1)
    });
    expect(conflictResult.relations[0]).toMatchObject({
      projectAlignment: { status: "conflict", projectId: null },
      conflictCodes: ["PROJECT_MISMATCH"],
      forbiddenAsAttentionCandidate: true
    });
  });

  it("uses exact native identity, detects incompatible duplicates, and never links by title", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const base = {
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(binding.bindingId, EXECUTION_1, "1")
      ]),
      bindingStore: binding.store,
      contextRegistry: createEmptyWorkContextRegistry(AS_OF)
    };

    const titleOnly = resolveManagedCodexWorkRelations({
      ...base,
      githubBatch: githubBatch([
        githubTask({
          id: 999,
          title: "PRIVATE_TITLE_SENTINEL"
        })
      ])
    });
    expect(titleOnly.relations[0]?.githubObservation.status).toBe(
      "not_observed"
    );
    expect(JSON.stringify(titleOnly)).not.toContain(
      "PRIVATE_TITLE_SENTINEL"
    );

    const conflicting = resolveManagedCodexWorkRelations({
      ...base,
      githubBatch: githubBatch([
        githubTask({ id: 501, kind: "assigned_issue" }),
        githubTask({
          id: 501,
          kind: "review_requested_pull_request"
        })
      ])
    });
    expect(conflicting.relations[0]).toMatchObject({
      identityStatus: "conflict",
      conflictCodes: ["GITHUB_IDENTITY_CONFLICT"],
      githubObservation: { status: "conflict" }
    });
  });

  it("fails closed for missing authority, unsupported sources, and identity mismatches", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const missingBinding = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(`binding_${"f".repeat(32)}`, EXECUTION_1, "1")
      ]),
      bindingStore: binding.store,
      githubBatch: null,
      contextRegistry: null
    });
    expect(missingBinding.relations).toEqual([]);
    expect(missingBinding.runResolutions[0]?.status).toBe(
      "binding_not_found"
    );

    const mismatch = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(binding.bindingId, EXECUTION_2, "1")
      ]),
      bindingStore: binding.store,
      githubBatch: null,
      contextRegistry: null
    });
    expect(mismatch.relations).toEqual([]);
    expect(mismatch.runResolutions[0]?.status).toBe(
      "execution_mismatch"
    );

    const manual = bindStore({
      subjectId: "manual-task",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1,
      source: "manual"
    });
    const unsupported = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(manual.bindingId, EXECUTION_1, "2")
      ]),
      bindingStore: manual.store,
      githubBatch: null,
      contextRegistry: null
    });
    expect(unsupported.runResolutions[0]?.status).toBe(
      "unsupported_task_source"
    );
  });

  it("keeps stale and absent GitHub observations distinct from completion", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const managed = managedProjection([
      managedRun(binding.bindingId, EXECUTION_1, "1")
    ]);
    const stale = resolveManagedCodexWorkRelations({
      asOf: "2026-08-01T04:00:00.000Z",
      managedProjection: managed,
      bindingStore: binding.store,
      githubBatch: githubBatch(
        [githubTask({ id: 501 })],
        undefined,
        "2026-08-01T04:00:00.000Z"
      ),
      contextRegistry: null
    });
    expect(stale.relations[0]?.githubObservation.status).toBe("stale");

    const unavailable = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managed,
      bindingStore: binding.store,
      githubBatch: null,
      contextRegistry: null
    });
    expect(unavailable.relations[0]?.githubObservation).toMatchObject({
      status: "unavailable",
      objectType: null,
      sourceUpdatedAt: null
    });
    expect(JSON.stringify(unavailable)).not.toContain("completed");
  });

  it("is deterministic across managed run input ordering and rejects a tampered batch", () => {
    const first = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const second = bindWorkSessionDecision(first.store, {
      taskRef: taskRef("github:object:502"),
      executionId: EXECUTION_2,
      scopeId: SCOPE_2,
      boundAt: "2026-08-01T02:50:00.000Z",
      explicitUserConfirmation: true
    });
    const runs = [
      managedRun(first.bindingId, EXECUTION_1, "1"),
      managedRun(second.binding.bindingId, EXECUTION_2, "2")
    ];
    const batch = githubBatch([
      githubTask({ id: 501 }),
      githubTask({ id: 502, number: 43 })
    ]);
    const input = {
      asOf: AS_OF,
      bindingStore: second.store,
      githubBatch: batch,
      contextRegistry: createEmptyWorkContextRegistry(AS_OF)
    };
    const ordered = resolveManagedCodexWorkRelations({
      ...input,
      managedProjection: managedProjection(runs)
    });
    const reversed = resolveManagedCodexWorkRelations({
      ...input,
      managedProjection: managedProjection([...runs].reverse())
    });
    expect(reversed).toEqual(ordered);

    expect(() =>
      resolveManagedCodexWorkRelations({
        ...input,
        managedProjection: managedProjection(runs),
        githubBatch: { ...batch, batchSha256: "0".repeat(64) }
      })
    ).toThrow(/invalid/);
  });

  it("rejects a projection whose resolved run disagrees with its relation", () => {
    const binding = bindStore({
      subjectId: "github:object:501",
      executionId: EXECUTION_1,
      scopeId: SCOPE_1
    });
    const projection = resolveManagedCodexWorkRelations({
      asOf: AS_OF,
      managedProjection: managedProjection([
        managedRun(binding.bindingId, EXECUTION_1, "1")
      ]),
      bindingStore: binding.store,
      githubBatch: githubBatch([githubTask({ id: 501 })]),
      contextRegistry: null
    });
    const { projectionSha256: _projectionSha256, ...content } =
      projection;

    expect(() =>
      sealManagedCodexWorkRelationProjection({
        ...content,
        runResolutions: content.runResolutions.map((resolution) => ({
          ...resolution,
          executionId: EXECUTION_2
        }))
      })
    ).toThrow(/relation identity and evidence/);
  });
});

function bindStore(input: {
  subjectId: string;
  executionId: string;
  scopeId: string;
  source?: "github" | "manual";
}) {
  const result = bindWorkSessionDecision(
    createEmptyWorkSessionBindingStore("2026-08-01T02:40:00.000Z"),
    {
      taskRef: {
        ...taskRef(input.subjectId),
        source: input.source ?? "github"
      },
      executionId: input.executionId,
      scopeId: input.scopeId,
      boundAt: "2026-08-01T02:45:00.000Z",
      explicitUserConfirmation: true
    }
  );
  return {
    ...result,
    bindingId: result.binding.bindingId
  };
}

function taskRef(subjectId: string) {
  return {
    kind: "attention_subject" as const,
    source: "github" as const,
    subjectId,
    displayTitle: "Synthetic task"
  };
}

function managedProjection(
  runs: ManagedCodexPublicProjection["runs"]
): ManagedCodexPublicProjection {
  return {
    contract: "codex-managed-public-projection-v1",
    revision: 7,
    generatedAt: AS_OF,
    runs
  };
}

function managedRun(
  bindingId: string,
  executionId: string,
  suffix: string
): ManagedCodexPublicProjection["runs"][number] {
  return {
    managedRunId: `managed_run_${suffix.repeat(32)}`,
    bindingId,
    executionId,
    lifecycle: "observing",
    streamState: "connected",
    continuity: "continuous",
    effectiveExecutionState: "running",
    lastVerifiedExecutionState: "running",
    waitingState: null,
    sourceEvent: "turn_started",
    itemType: null,
    lastObservedAt: AS_OF,
    liveObservationAvailable: true,
    forbiddenAsAttentionCandidate: true
  };
}

function githubBatch(
  tasks: GitHubTaskSignal[],
  resolveProjectId?: (sourceScopeId: string) => string | null,
  asOf = AS_OF
): RuntimeWorkSignalBatch {
  const result = normalizeGitHubSnapshotToWorkSignals(
    githubSnapshot(tasks),
    {
      asOf,
      freshnessPolicy: {
        version: SNAPSHOT_VALIDITY_POLICY_VERSION,
        maxAgeMsBySource: {
          github: 10 * 60 * 1_000,
          codex: 10 * 60 * 1_000
        },
        maxFutureClockSkewMs: 60 * 1_000
      },
      resolveProjectId
    }
  );
  if (result.status !== "normalized") {
    throw new TypeError("Synthetic GitHub batch did not normalize.");
  }
  return result.batch;
}

function githubSnapshot(tasks: GitHubTaskSignal[]): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: FETCHED_AT,
    user: { id: 1, login: "synthetic" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 1,
        accountLogin: "synthetic",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 1,
        fullName: "synthetic/private",
        private: true,
        archived: false,
        updatedAt: FETCHED_AT
      }
    ],
    tasks,
    activities: []
  };
}

function githubTask(input: {
  id: number;
  number?: number;
  kind?: GitHubTaskSignal["kind"];
  title?: string;
}): GitHubTaskSignal {
  const kind = input.kind ?? "assigned_issue";
  const number = input.number ?? 42;
  return {
    id: input.id,
    source: "github",
    kind,
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    number,
    title: input.title ?? "Synthetic task",
    htmlUrl:
      kind === "assigned_issue"
        ? `https://github.com/synthetic/private/issues/${number}`
        : `https://github.com/synthetic/private/pull/${number}`,
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: FETCHED_AT
  };
}

function mappedRegistry(
  codexProjectId: string,
  githubProjectId: string
): WorkContextRegistry {
  let registry = createEmptyWorkContextRegistry(
    "2026-08-01T02:00:00.000Z"
  );
  for (const projectId of new Set([
    codexProjectId,
    githubProjectId
  ])) {
    registry = createProjectIdentity(registry, {
      projectId,
      createdAt: "2026-08-01T02:01:00.000Z"
    }).registry;
  }
  registry = confirmProjectMapping(registry, {
    scope: {
      source: "codex",
      resourceType: "scope",
      opaqueId: SCOPE_1
    },
    projectId: codexProjectId,
    confirmedAt: "2026-08-01T02:02:00.000Z",
    explicitUserConfirmation: true
  }).registry;
  return confirmProjectMapping(registry, {
    scope: {
      source: "github",
      resourceType: "repository",
      opaqueId: "101"
    },
    projectId: githubProjectId,
    confirmedAt: "2026-08-01T02:03:00.000Z",
    explicitUserConfirmation: true
  }).registry;
}
