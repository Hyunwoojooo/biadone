import {
  managedCodexArtifactRelationProjectionSchema,
  readWorkArtifactAttributionStore,
  resolveManagedCodexArtifactRelations,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts";
import {
  claimAuthorityProjectionSchema,
  resolveCurrentClaimAuthority,
  type ClaimAuthorityProjection
} from "../claims";
import { LIVE_ATTENTION_FRESHNESS_POLICY } from "../attention/liveAttention";
import { readStoredGitHubSnapshot } from "../connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../connectors/github/toWorkSignals";
import {
  lookupProjectId,
  readWorkContextRegistry,
  type WorkContextRegistry
} from "../context";
import type { RuntimeWorkSignalBatch } from "../crossSource/schema";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  readManagedCodexObservability
} from "../managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease
} from "../resumption";

export type CurrentWorkEvidence = {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  workRelations: ManagedCodexWorkRelationProjection;
  artifacts: ManagedCodexArtifactRelationProjection;
  claims: ClaimAuthorityProjection;
};

export async function readCurrentWorkEvidence(input?: {
  cwd?: string;
  now?: Date;
}): Promise<CurrentWorkEvidence> {
  const cwd = input?.cwd ?? process.cwd();
  const [githubSnapshot, registryRead] = await Promise.all([
    readStoredGitHubSnapshot(cwd),
    readWorkContextRegistry(cwd)
  ]);
  const contextRegistry =
    registryRead.status === "available" ? registryRead.value : null;
  const leaseTime = input?.now
    ? new Date(input.now.getTime())
    : () => new Date();

  return withManagedCodexAuthorityLease(
    cwd,
    leaseTime,
    async (authority, now) => {
      const asOf = now.toISOString();
      const githubBatch = normalizeGitHubBatch({
        snapshot: githubSnapshot,
        contextRegistry,
        asOf
      });
      const [managedObservability, bindingStore, artifactAttributionStore] =
        await Promise.all([
          readManagedCodexObservability(
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
      const managedProjection = managedCodexPublicProjectionSchema.parse(
        managedObservability.projection
      );
      const managedSemantics = managedCodexSemanticProjectionSchema.parse(
        managedObservability.semantics
      );
      const workRelations = managedCodexWorkRelationProjectionSchema.parse(
        resolveManagedCodexWorkRelations({
          asOf,
          managedProjection,
          bindingStore,
          githubBatch,
          contextRegistry
        })
      );
      const artifacts = managedCodexArtifactRelationProjectionSchema.parse(
        resolveManagedCodexArtifactRelations({
          asOf,
          workRelationProjection: workRelations,
          attributionStore: artifactAttributionStore,
          githubBatch
        })
      );
      const claims = claimAuthorityProjectionSchema.parse(
        resolveCurrentClaimAuthority({
          asOf,
          managedProjection,
          managedSemantics,
          workRelationProjection: workRelations,
          artifactRelationProjection: artifacts,
          githubBatch,
          contextRegistry
        })
      );
      return { asOf, githubBatch, workRelations, artifacts, claims };
    }
  );
}

function normalizeGitHubBatch(input: {
  snapshot: Awaited<ReturnType<typeof readStoredGitHubSnapshot>>;
  contextRegistry: WorkContextRegistry | null;
  asOf: string;
}): RuntimeWorkSignalBatch | null {
  if (input.snapshot === null) return null;
  const normalized = normalizeGitHubSnapshotToWorkSignals(input.snapshot, {
    asOf: input.asOf,
    freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
    contextRegistrySha256:
      input.contextRegistry?.registrySha256 ?? null,
    resolveProjectId: (sourceScopeId) =>
      resolveGitHubProjectId(input.contextRegistry, sourceScopeId)
  });
  return normalized.status === "normalized" ? normalized.batch : null;
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
