import {
  createEmptyWorkArtifactAttributionStore,
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
  CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
  buildManagedCodexSemanticProjection,
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  readManagedCodexObservability,
  type ManagedCodexPublicProjection,
  type ManagedCodexSemanticProjection
} from "../managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  createEmptyWorkSessionBindingStore,
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease,
  type ManagedCodexAuthoritySnapshot
} from "../resumption";

export type CurrentWorkEvidence = {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  managedProjection: ManagedCodexPublicProjection;
  managedSemantics: ManagedCodexSemanticProjection;
  managedRunStartedAtById: Record<string, string>;
  workRelations: ManagedCodexWorkRelationProjection;
  artifacts: ManagedCodexArtifactRelationProjection;
  claims: ClaimAuthorityProjection;
  contextRegistry: WorkContextRegistry | null;
};

/**
 * Builds the exact empty-managed graph used by deterministic snapshot tests
 * and offline evaluation cases. It does not claim that a missing managed run
 * was observed in production; the live path always uses the authority lease.
 */
export function resolveEmptyManagedWorkEvidence(input: {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): CurrentWorkEvidence {
  const asOf = new Date(input.asOf).toISOString();
  if (
    input.githubBatch !== null &&
    input.githubBatch.assessment.asOf !== asOf
  ) {
    throw new TypeError(
      "Empty managed evidence requires one exact GitHub as-of time."
    );
  }
  const managedProjection = managedCodexPublicProjectionSchema.parse({
    contract: CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
    revision: 0,
    generatedAt: asOf,
    runs: []
  });
  const managedSemantics = buildManagedCodexSemanticProjection({
    sourceRevision: 0,
    generatedAt: asOf,
    runs: []
  });
  const workRelations = managedCodexWorkRelationProjectionSchema.parse(
    resolveManagedCodexWorkRelations({
      asOf,
      managedProjection,
      bindingStore: createEmptyWorkSessionBindingStore(asOf),
      githubBatch: input.githubBatch,
      contextRegistry: input.contextRegistry
    })
  );
  const artifacts = managedCodexArtifactRelationProjectionSchema.parse(
    resolveManagedCodexArtifactRelations({
      asOf,
      workRelationProjection: workRelations,
      attributionStore: createEmptyWorkArtifactAttributionStore(asOf),
      githubBatch: input.githubBatch
    })
  );
  const claims = claimAuthorityProjectionSchema.parse(
    resolveCurrentClaimAuthority({
      asOf,
      managedProjection,
      managedSemantics,
      workRelationProjection: workRelations,
      artifactRelationProjection: artifacts,
      githubBatch: input.githubBatch,
      contextRegistry: input.contextRegistry
    })
  );
  return {
    asOf,
    githubBatch: input.githubBatch,
    managedProjection,
    managedSemantics,
    managedRunStartedAtById: {},
    workRelations,
    artifacts,
    claims,
    contextRegistry: input.contextRegistry
  };
}

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
      return resolveEvidenceGraph({
        cwd,
        now,
        authority,
        githubBatch,
        contextRegistry
      });
    }
  );
}

/**
 * Resolves the Phase 3/4 evidence graph from an already-normalized GitHub
 * batch. Live Attention uses this boundary so the active decision and its
 * source monitor share one exact snapshot hash and as-of time.
 */
export async function resolveCurrentWorkEvidenceFromInputs(input: {
  cwd?: string;
  now: Date;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): Promise<CurrentWorkEvidence> {
  const cwd = input.cwd ?? process.cwd();
  return withManagedCodexAuthorityLease(
    cwd,
    input.now,
    (authority, now) =>
      resolveEvidenceGraph({
        cwd,
        now,
        authority,
        githubBatch: input.githubBatch,
        contextRegistry: input.contextRegistry
      })
  );
}

/**
 * Captures the evaluation time inside the managed authority lease, then lets
 * the caller normalize its already-read GitHub snapshot for that exact time.
 * Live Attention uses this form to avoid an event appended between an early
 * wall-clock read and acquisition of the managed store lock.
 */
export async function resolveCurrentWorkEvidenceAtAuthoritySnapshot(input: {
  cwd?: string;
  now?: Date;
  contextRegistry: WorkContextRegistry | null;
  resolveGithubBatch: (
    asOf: string
  ) => RuntimeWorkSignalBatch | null;
}): Promise<CurrentWorkEvidence> {
  const cwd = input.cwd ?? process.cwd();
  const leaseTime = input.now
    ? new Date(input.now.getTime())
    : () => new Date();
  return withManagedCodexAuthorityLease(
    cwd,
    leaseTime,
    (authority, now) =>
      resolveEvidenceGraph({
        cwd,
        now,
        authority,
        githubBatch: input.resolveGithubBatch(now.toISOString()),
        contextRegistry: input.contextRegistry
      })
  );
}

async function resolveEvidenceGraph(input: {
  cwd: string;
  now: Date;
  authority: ManagedCodexAuthoritySnapshot;
  githubBatch: RuntimeWorkSignalBatch | null;
  contextRegistry: WorkContextRegistry | null;
}): Promise<CurrentWorkEvidence> {
  const asOf = input.now.toISOString();
  if (
    input.githubBatch !== null &&
    input.githubBatch.assessment.asOf !== asOf
  ) {
    throw new TypeError(
      "Current work evidence requires one exact GitHub as-of time."
    );
  }
  const [managedObservability, bindingStore, artifactAttributionStore] =
    await Promise.all([
      readManagedCodexObservability(
        {
          activeOwnerInstanceId: input.authority.activeOwnerInstanceId,
          activeOwnerships: input.authority.activeOwnerships,
          now: input.now
        },
        input.cwd
      ),
      readWorkSessionBindingStore(input.cwd, asOf),
      readWorkArtifactAttributionStore(input.cwd, input.now)
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
      githubBatch: input.githubBatch,
      contextRegistry: input.contextRegistry
    })
  );
  const artifacts = managedCodexArtifactRelationProjectionSchema.parse(
    resolveManagedCodexArtifactRelations({
      asOf,
      workRelationProjection: workRelations,
      attributionStore: artifactAttributionStore,
      githubBatch: input.githubBatch
    })
  );
  const claims = claimAuthorityProjectionSchema.parse(
    resolveCurrentClaimAuthority({
      asOf,
      managedProjection,
      managedSemantics,
      workRelationProjection: workRelations,
      artifactRelationProjection: artifacts,
      githubBatch: input.githubBatch,
      contextRegistry: input.contextRegistry
    })
  );
  return {
    asOf,
    githubBatch: input.githubBatch,
    managedProjection,
    managedSemantics,
    managedRunStartedAtById:
      managedObservability.managedRunStartedAtById,
    workRelations,
    artifacts,
    claims,
    contextRegistry: input.contextRegistry
  };
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
