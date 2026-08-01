import { LIVE_ATTENTION_FRESHNESS_POLICY } from "../attention/liveAttention";
import { readStoredGitHubSnapshot } from "../connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../connectors/github/toWorkSignals";
import {
  lookupProjectId,
  readWorkContextRegistry,
  type WorkContextRegistry
} from "../context";
import { readManagedCodexPublicProjection } from "../managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease,
  withWorkResumptionStateLease
} from "../resumption";
import {
  attachWorkArtifactAttribution,
  detachWorkArtifactAttribution,
  readWorkArtifactAttributionStore,
  writeWorkArtifactAttributionStore
} from "./attributionStore";
import type { WorkArtifactAttributionDecision } from "./contracts";
import {
  GitHubArtifactTargetError,
  validateGitHubArtifactTarget
} from "./validateGitHubArtifactTarget";

export class WorkArtifactMutationError extends Error {
  constructor(
    public readonly code:
      | "MANAGED_RUN_RELATION_NOT_FOUND"
      | "MANAGED_RUN_RELATION_MISMATCH"
  ) {
    super(code);
    this.name = "WorkArtifactMutationError";
  }
}

export async function attachStoredWorkArtifact(
  input: {
    managedRunId: string;
    bindingId: string;
    executionId: string;
    artifactUrl: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd(),
  clock: () => Date = () => new Date()
): Promise<WorkArtifactAttributionDecision> {
  return withManagedCodexAuthorityLease(
    cwd,
    clock,
    async (authority, now) => {
      const asOf = now.toISOString();
      const [githubSnapshot, registryRead] = await Promise.all([
        readStoredGitHubSnapshot(cwd),
        readWorkContextRegistry(cwd)
      ]);
      if (githubSnapshot === null) {
        throw new GitHubArtifactTargetError(
          "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
        );
      }
      const artifact = validateGitHubArtifactTarget(
        input.artifactUrl,
        githubSnapshot
      );
      // Do not retain the raw URL beyond this transient native-identity
      // parser. Reading and validating under the shared state lease also
      // prevents a completed GitHub disconnect/replacement from being
      // followed by an attach based on its old snapshot.
      const contextRegistry =
        registryRead.status === "available"
          ? registryRead.value
          : null;
      const githubBatch = normalizeGitHubBatch({
        snapshot: githubSnapshot,
        contextRegistry,
        asOf
      });
      const [managedProjection, bindingStore, attributionStore] =
        await Promise.all([
          readManagedCodexPublicProjection(
            {
              activeOwnerInstanceId: authority.activeOwnerInstanceId,
              activeOwnerships: authority.activeOwnerships,
              now
            },
            cwd
          ),
          readWorkSessionBindingStore(cwd, asOf),
          readWorkArtifactAttributionStore(cwd, now)
        ]);
      const workRelations =
        managedCodexWorkRelationProjectionSchema.parse(
          resolveManagedCodexWorkRelations({
            asOf,
            managedProjection,
            bindingStore,
            githubBatch,
            contextRegistry
          })
        );
      const executesRelationId = exactExecutesRelationId(
        workRelations,
        input
      );
      const result = attachWorkArtifactAttribution(
        attributionStore,
        {
          managedRunId: input.managedRunId,
          bindingId: input.bindingId,
          executionId: input.executionId,
          executesRelationId,
          artifact,
          attachedAt: asOf,
          explicitUserConfirmation:
            input.explicitUserConfirmation
        }
      );
      if (result.changed) {
        await writeWorkArtifactAttributionStore(result.store, cwd);
      }
      return result.decision;
    }
  );
}

export async function detachStoredWorkArtifact(
  input: {
    attributionId: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd(),
  clock: () => Date = () => new Date()
): Promise<WorkArtifactAttributionDecision> {
  return withWorkResumptionStateLease(cwd, async () => {
    const now = clock();
    const store = await readWorkArtifactAttributionStore(cwd, now);
    const result = detachWorkArtifactAttribution(store, {
      attributionId: input.attributionId,
      detachedAt: now.toISOString(),
      explicitUserConfirmation: input.explicitUserConfirmation
    });
    await writeWorkArtifactAttributionStore(result.store, cwd);
    return result.decision;
  });
}

function exactExecutesRelationId(
  projection: ManagedCodexWorkRelationProjection,
  input: {
    managedRunId: string;
    bindingId: string;
    executionId: string;
  }
): string {
  const resolution = projection.runResolutions.find(
    (candidate) => candidate.managedRunId === input.managedRunId
  );
  if (!resolution || resolution.status !== "resolved") {
    throw new WorkArtifactMutationError(
      "MANAGED_RUN_RELATION_NOT_FOUND"
    );
  }
  if (
    resolution.bindingId !== input.bindingId ||
    resolution.executionId !== input.executionId ||
    resolution.relationId === null
  ) {
    throw new WorkArtifactMutationError(
      "MANAGED_RUN_RELATION_MISMATCH"
    );
  }
  const relation = projection.relations.find(
    (candidate) => candidate.relationId === resolution.relationId
  );
  if (
    !relation ||
    relation.bindingId !== input.bindingId ||
    relation.from.kind !== "execution" ||
    relation.from.source !== "codex" ||
    relation.from.subjectId !== input.executionId ||
    !relation.managedRunIds.includes(input.managedRunId)
  ) {
    throw new WorkArtifactMutationError(
      "MANAGED_RUN_RELATION_MISMATCH"
    );
  }
  return relation.relationId;
}

function normalizeGitHubBatch(input: {
  snapshot: NonNullable<
    Awaited<ReturnType<typeof readStoredGitHubSnapshot>>
  >;
  contextRegistry: WorkContextRegistry | null;
  asOf: string;
}) {
  const normalized = normalizeGitHubSnapshotToWorkSignals(
    input.snapshot,
    {
      asOf: input.asOf,
      freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
      contextRegistrySha256:
        input.contextRegistry?.registrySha256 ?? null,
      resolveProjectId: (sourceScopeId) =>
        resolveGitHubProjectId(
          input.contextRegistry,
          sourceScopeId
        )
    }
  );
  return normalized.status === "normalized"
    ? normalized.batch
    : null;
}

function resolveGitHubProjectId(
  registry: WorkContextRegistry | null,
  sourceScopeId: string
): string | null {
  if (registry === null) return null;
  const match = /^repository:([1-9][0-9]*)$/.exec(sourceScopeId);
  if (!match?.[1]) return null;
  return lookupProjectId(registry, {
    source: "github",
    resourceType: "repository",
    opaqueId: match[1]
  });
}
