import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../crossSource/versions";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";
import {
  sourceScopeFingerprint,
  sourceScopeRefSchema,
  workContextRegistrySchema,
  type MappingDecision,
  type SourceScopeRef,
  type WorkContextRegistry
} from "../context/contracts";
import {
  managedCodexPublicProjectionSchema,
  type ManagedCodexPublicProjection
} from "../managedCodex/contracts";
import {
  workSessionBindingStoreSchema,
  type WorkSessionBindingDecision,
  type WorkSessionBindingStore
} from "../resumption/contracts";
import {
  MAX_MANAGED_CODEX_WORK_RELATION_RUNS,
  managedCodexWorkRelationSchema,
  sealManagedCodexWorkRelationProjection,
  type ManagedCodexWorkRelation,
  type ManagedCodexWorkRelationProjection,
  type ManagedCodexWorkRelationRunResolution
} from "./contracts";

type GitHubWorkSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;

type ResolvedGitHubObservation = {
  public: ManagedCodexWorkRelation["githubObservation"];
  sourceScopeId: string | null;
};

export function resolveManagedCodexWorkRelations(input: {
  asOf: string;
  managedProjection: ManagedCodexPublicProjection;
  bindingStore: WorkSessionBindingStore;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): ManagedCodexWorkRelationProjection {
  const asOf = new Date(input.asOf).toISOString();
  const managedProjection = managedCodexPublicProjectionSchema.parse(
    input.managedProjection
  );
  const bindingStore = workSessionBindingStoreSchema.parse(
    input.bindingStore
  );
  const githubBatch = parseGitHubBatch(input.githubBatch, asOf);
  const contextRegistry =
    input.contextRegistry === null
      ? null
      : workContextRegistrySchema.parse(input.contextRegistry);

  const retainedRuns = [...managedProjection.runs]
    .sort(
      (left, right) =>
        Date.parse(right.lastObservedAt) -
          Date.parse(left.lastObservedAt) ||
        compareRuntimeStrings(left.managedRunId, right.managedRunId)
    )
    .slice(0, MAX_MANAGED_CODEX_WORK_RELATION_RUNS);
  const relationsByBinding = new Map<
    string,
    ManagedCodexWorkRelation
  >();
  const runResolutions: ManagedCodexWorkRelationRunResolution[] = [];

  for (const run of retainedRuns) {
    const decision = bindingStore.decisions.find(
      (candidate) => candidate.bindingId === run.bindingId
    );
    if (!decision) {
      runResolutions.push(runResolution(run, "binding_not_found"));
      continue;
    }
    if (!isBindDecision(decision)) {
      runResolutions.push(runResolution(run, "binding_not_bind"));
      continue;
    }
    if (decision.executionId !== run.executionId) {
      runResolutions.push(runResolution(run, "execution_mismatch"));
      continue;
    }
    if (decision.taskRef.source !== "github") {
      runResolutions.push(
        runResolution(run, "unsupported_task_source")
      );
      continue;
    }
    if (!/^github:object:[1-9][0-9]*$/.test(decision.taskRef.subjectId)) {
      runResolutions.push(
        runResolution(run, "invalid_github_subject")
      );
      continue;
    }

    let relation = relationsByBinding.get(decision.bindingId);
    if (!relation) {
      relation = buildRelation({
        decision,
        bindingStore,
        githubBatch,
        contextRegistry,
        managedRunIds: [run.managedRunId]
      });
    } else {
      relation = managedCodexWorkRelationSchema.parse({
        ...relation,
        managedRunIds: [...relation.managedRunIds, run.managedRunId].sort(
          compareRuntimeStrings
        )
      });
    }
    relationsByBinding.set(decision.bindingId, relation);
    runResolutions.push(
      runResolution(run, "resolved", relation.relationId)
    );
  }

  const relations = [...relationsByBinding.values()].sort((left, right) =>
    compareRuntimeStrings(left.relationId, right.relationId)
  );
  const sortedRunResolutions = runResolutions.sort((left, right) =>
    compareRuntimeStrings(left.managedRunId, right.managedRunId)
  );
  const inputSha256 = runtimeSha256({
    domain: "managed-codex-work-relation-input-v0.1",
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf,
    managed: {
      revision: managedProjection.revision,
      generatedAt: managedProjection.generatedAt,
      totalRunCount: managedProjection.runs.length,
      retainedRuns: retainedRuns.map((run) => ({
        managedRunId: run.managedRunId,
        bindingId: run.bindingId,
        executionId: run.executionId,
        lastObservedAt: run.lastObservedAt
      }))
    },
    bindingStore: {
      revision: bindingStore.revision,
      sha256: bindingStore.storeSha256
    },
    github: githubBatch
      ? {
          batchSha256: githubBatch.batchSha256,
          sourceSnapshotSha256: githubBatch.sourceSnapshotSha256
        }
      : null,
    context: contextRegistry
      ? {
          revision: contextRegistry.revision,
          sha256: contextRegistry.registrySha256
        }
      : null
  });

  return sealManagedCodexWorkRelationProjection({
    contract: "managed-codex-work-relation-projection-v0.1",
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf,
    managedSourceRevision: managedProjection.revision,
    managedGeneratedAt: managedProjection.generatedAt,
    bindingStoreRevision: bindingStore.revision,
    bindingStoreSha256: bindingStore.storeSha256,
    contextRegistrySha256:
      contextRegistry?.registrySha256 ?? null,
    githubBatchSha256: githubBatch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      githubBatch?.sourceSnapshotSha256 ?? null,
    totalManagedRunCount: managedProjection.runs.length,
    omittedManagedRunCount:
      managedProjection.runs.length - retainedRuns.length,
    relations,
    runResolutions: sortedRunResolutions,
    inputSha256,
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function parseGitHubBatch(
  input: RuntimeWorkSignalBatch | null,
  asOf: string
): RuntimeWorkSignalBatch | null {
  if (input === null) return null;
  const parsed = runtimeWorkSignalBatchSchema.parse(input);
  if (
    parsed.source !== "github" ||
    parsed.assessment.asOf !== asOf ||
    !verifyRuntimeWorkSignalBatchIntegrity(parsed).ok
  ) {
    throw new TypeError("GitHub work relation input is invalid.");
  }
  return parsed;
}

function buildRelation(input: {
  decision: WorkSessionBindingDecision & { action: "bind" };
  bindingStore: WorkSessionBindingStore;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
  managedRunIds: string[];
}): ManagedCodexWorkRelation {
  const githubObservation = resolveGitHubObservation(
    input.decision.taskRef.subjectId,
    input.githubBatch
  );
  const bindingLifecycle = bindingLifecycleFor(
    input.decision,
    input.bindingStore
  );
  const projectAlignment = resolveProjectAlignment({
    binding: input.decision,
    githubSourceScopeId: githubObservation.sourceScopeId,
    contextRegistry: input.contextRegistry
  });
  const conflictCodes: ManagedCodexWorkRelation["conflictCodes"] = [];
  if (githubObservation.public.status === "conflict") {
    conflictCodes.push("GITHUB_IDENTITY_CONFLICT");
  }
  if (projectAlignment.status === "conflict") {
    conflictCodes.push("PROJECT_MISMATCH");
  }
  const from = {
    kind: "execution" as const,
    source: "codex" as const,
    subjectId: input.decision.executionId
  };
  const to = {
    kind: "work_item" as const,
    source: "github" as const,
    subjectId: input.decision.taskRef.subjectId
  };

  return managedCodexWorkRelationSchema.parse({
    relationId: runtimeStableId(
      "relation",
      MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
      {
        bindingId: input.decision.bindingId,
        type: "executes",
        from,
        to
      }
    ),
    managedRunIds: [...input.managedRunIds].sort(
      compareRuntimeStrings
    ),
    bindingId: input.decision.bindingId,
    type: "executes",
    authority: "user_configured",
    from,
    to,
    bindingEvidence: {
      bindingId: input.decision.bindingId,
      boundAt: input.decision.decidedAt,
      decisionSource: "explicit_user",
      ...bindingLifecycle
    },
    githubObservation: githubObservation.public,
    projectAlignment,
    identityStatus: conflictCodes.includes(
      "GITHUB_IDENTITY_CONFLICT"
    )
      ? "conflict"
      : "resolved",
    conflictCodes: conflictCodes.sort(compareRuntimeStrings),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function runResolution(
  run: ManagedCodexPublicProjection["runs"][number],
  status: ManagedCodexWorkRelationRunResolution["status"],
  relationId: string | null = null
): ManagedCodexWorkRelationRunResolution {
  return {
    managedRunId: run.managedRunId,
    bindingId: run.bindingId,
    executionId: run.executionId,
    status,
    relationId
  };
}

function bindingLifecycleFor(
  decision: WorkSessionBindingDecision & { action: "bind" },
  store: WorkSessionBindingStore
): Pick<
  ManagedCodexWorkRelation["bindingEvidence"],
  "bindingState" | "supersededByBindingId"
> {
  const successor = store.decisions.find(
    (candidate) =>
      candidate.supersedesBindingId === decision.bindingId
  );
  if (!successor) {
    return {
      bindingState: "active",
      supersededByBindingId: null
    };
  }
  return {
    bindingState:
      successor.action === "unbind"
        ? "superseded_by_unbind"
        : "superseded_by_rebind",
    supersededByBindingId: successor.bindingId
  };
}

function resolveGitHubObservation(
  subjectId: string,
  batch: RuntimeWorkSignalBatch | null
): ResolvedGitHubObservation {
  if (batch === null) {
    return {
      public: emptyGitHubObservation("unavailable"),
      sourceScopeId: null
    };
  }
  const signals = batch.signals
    .filter(
      (signal): signal is GitHubWorkSignal =>
        signal.kind === "work_item_observation" &&
        signal.subjectId === subjectId
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    );
  if (signals.length === 0) {
    if (batch.assessment.freshness === "invalid") {
      return {
        public: emptyGitHubObservation("unavailable"),
        sourceScopeId: null
      };
    }
    return {
      public: {
        ...emptyGitHubObservation("not_observed"),
        sourceSnapshotSha256: batch.sourceSnapshotSha256,
        completeness: publicCompleteness(
          batch.assessment.completeness
        )
      },
      sourceScopeId: null
    };
  }

  const first = signals[0];
  if (!first || signals.some((signal) => !sameNativeObject(first, signal))) {
    return {
      public: {
        ...emptyGitHubObservation("conflict"),
        sourceSnapshotSha256: batch.sourceSnapshotSha256,
        signalIds: signals.map((signal) => signal.signalId),
        completeness: publicCompleteness(
          batch.assessment.completeness
        )
      },
      sourceScopeId: null
    };
  }
  const taskKind = [...signals]
    .sort(
      (left, right) =>
        taskKindPriority(left.facts.taskKind) -
          taskKindPriority(right.facts.taskKind) ||
        compareRuntimeStrings(left.signalId, right.signalId)
    )[0]?.facts.taskKind;
  if (!taskKind) {
    throw new TypeError("GitHub task kind resolution failed.");
  }
  const sourceUpdatedAt = signals
    .map((signal) => signal.sourceUpdatedAt)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  return {
    public: {
      status:
        batch.assessment.freshness === "fresh"
          ? "current"
          : "stale",
      sourceSnapshotSha256: batch.sourceSnapshotSha256,
      signalIds: signals.map((signal) => signal.signalId),
      objectType: first.facts.objectType,
      taskKind,
      number: first.facts.number,
      destinationUrl: first.facts.destinationUrl,
      sourceUpdatedAt,
      completeness: publicCompleteness(
        batch.assessment.completeness
      )
    },
    sourceScopeId: first.sourceScopeId
  };
}

function emptyGitHubObservation(
  status: "not_observed" | "unavailable" | "conflict"
): ManagedCodexWorkRelation["githubObservation"] {
  return {
    status,
    sourceSnapshotSha256: null,
    signalIds: [],
    objectType: null,
    taskKind: null,
    number: null,
    destinationUrl: null,
    sourceUpdatedAt: null,
    completeness: null
  };
}

function sameNativeObject(
  left: GitHubWorkSignal,
  right: GitHubWorkSignal
): boolean {
  return (
    left.facts.objectType === right.facts.objectType &&
    left.facts.number === right.facts.number &&
    left.sourceScopeId === right.sourceScopeId &&
    left.projectId === right.projectId &&
    left.facts.destinationUrl === right.facts.destinationUrl
  );
}

function taskKindPriority(
  taskKind: GitHubWorkSignal["facts"]["taskKind"]
): number {
  switch (taskKind) {
    case "assigned_issue":
      return 0;
    case "review_requested_pull_request":
      return 1;
    case "authored_pull_request":
      return 2;
  }
}

function publicCompleteness(
  value: RuntimeWorkSignalBatch["assessment"]["completeness"]
): "complete" | "truncated" {
  return value === "complete" ? "complete" : "truncated";
}

function isBindDecision(
  decision: WorkSessionBindingDecision
): decision is WorkSessionBindingDecision & { action: "bind" } {
  return decision.action === "bind";
}

function resolveProjectAlignment(input: {
  binding: WorkSessionBindingDecision & { action: "bind" };
  githubSourceScopeId: string | null;
  contextRegistry: WorkContextRegistry | null;
}): ManagedCodexWorkRelation["projectAlignment"] {
  if (
    input.contextRegistry === null ||
    input.githubSourceScopeId === null ||
    !input.githubSourceScopeId.startsWith("repository:")
  ) {
    return unavailableProjectAlignment();
  }
  const githubOpaqueId = input.githubSourceScopeId.slice(
    "repository:".length
  );
  if (!githubOpaqueId) return unavailableProjectAlignment();
  const codexScope = sourceScopeRefSchema.parse({
    source: "codex",
    resourceType: "scope",
    opaqueId: input.binding.scopeId
  });
  const githubScope = sourceScopeRefSchema.parse({
    source: "github",
    resourceType: "repository",
    opaqueId: githubOpaqueId
  });
  const codexDecision = currentMappingDecision(
    input.contextRegistry,
    codexScope
  );
  const githubDecision = currentMappingDecision(
    input.contextRegistry,
    githubScope
  );
  const codexProject =
    codexDecision?.action === "confirm"
      ? codexDecision.projectId
      : null;
  const githubProject =
    githubDecision?.action === "confirm"
      ? githubDecision.projectId
      : null;

  if (
    codexProject !== null &&
    githubProject !== null &&
    codexProject === githubProject
  ) {
    return {
      status: "aligned",
      projectId: codexProject,
      codexMappingDecisionId: codexDecision?.decisionId ?? null,
      githubMappingDecisionId: githubDecision?.decisionId ?? null
    };
  }
  if (
    codexProject !== null &&
    githubProject !== null &&
    codexProject !== githubProject
  ) {
    return {
      status: "conflict",
      projectId: null,
      codexMappingDecisionId: codexDecision?.decisionId ?? null,
      githubMappingDecisionId: githubDecision?.decisionId ?? null
    };
  }
  return {
    status: "unmapped",
    projectId: null,
    codexMappingDecisionId: codexDecision?.decisionId ?? null,
    githubMappingDecisionId: githubDecision?.decisionId ?? null
  };
}

function unavailableProjectAlignment(): ManagedCodexWorkRelation["projectAlignment"] {
  return {
    status: "unavailable",
    projectId: null,
    codexMappingDecisionId: null,
    githubMappingDecisionId: null
  };
}

function currentMappingDecision(
  registry: WorkContextRegistry,
  scope: SourceScopeRef
): MappingDecision | null {
  const fingerprint = sourceScopeFingerprint(scope);
  const candidates = registry.mappingDecisions.filter(
    (decision) =>
      sourceScopeFingerprint(decision.scope) === fingerprint
  );
  const superseded = new Set(
    candidates
      .map((decision) => decision.supersedesDecisionId)
      .filter((value): value is string => value !== null)
  );
  return (
    candidates.find(
      (decision) => !superseded.has(decision.decisionId)
    ) ?? null
  );
}
