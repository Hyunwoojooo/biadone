import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity
} from "../../src/context/contracts";
import { compareRuntimeStrings } from "../../src/crossSource/canonicalHash";
import {
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
  CONTINUATION_RESOLUTION_SCHEMA_VERSION
} from "../../src/crossSource/versions";
import {
  adaptCodexContinuationObservations,
  adaptGitHubContinuationObservations
} from "../../src/continuation/adapters";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  deriveContinuationCandidates
} from "../../src/continuation/deriveCandidates";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity
} from "../../src/continuation/resolveIdentity";
import {
  CONTINUATION_RESOLUTION_CONFIG,
  continuationResolutionEnvelopeSchema,
  resolveContinuation
} from "../../src/continuation/resolveContinuation";
import {
  composeWorkSuggestionBoard,
  type WorkSuggestionBoardCompositionBundle
} from "../../src/suggestionBoard";
import { resolveActiveAttention } from "../../src/attentionDecision";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_PROJECT_ID,
  activeAttentionFixture
} from "./activeAttentionFixture";

export const BOARD_FIXTURE_SECRET = "synthetic-b001-installation-secret";
export const BOARD_FIXTURE_CODE_SHA = "d".repeat(40);
const FRESHNESS_CUTOFF = "2026-08-02T01:00:00.000Z";

export type AuthenticBoardFixture = {
  bundle: WorkSuggestionBoardCompositionBundle;
  trustedOptions: {
    installationSecret: string;
    expectedRegistrySha256: string;
    expectedCodeCommitSha: string;
    expectedDatasetVersion: null;
    expectedDatasetSha256: null;
  };
};

export function authenticBoardFixture(
  options: {
    active?: "suggested" | "no_action" | "clarification";
    continuationCount?: number;
    continuationMappedToActive?: boolean;
    mapContinuation?: boolean;
    sourceIdOffset?: number;
    activityAt?: string;
  } = {}
): AuthenticBoardFixture {
  const activeMode = options.active ?? "suggested";
  const active = resolveActiveAttention(
    activeMode === "no_action"
      ? activeAttentionFixture({
          githubKind: "none",
          managedScenario: "none"
        }).input
      : activeMode === "clarification"
        ? activeAttentionFixture({
            githubKind: "authored_pull_request",
            managedScenario: "failed",
            githubProjectMismatch: true
          }).input
        : activeAttentionFixture().input
  );
  const count = options.continuationCount ?? 1;
  const sourceIdOffset = options.sourceIdOffset ?? 0;
  const activityAt = options.activityAt ?? "2026-08-02T02:30:00.000Z";
  const projectIds = Array.from({ length: count }, (_, index) =>
    options.continuationMappedToActive && index === 0
      ? ACTIVE_FIXTURE_PROJECT_ID
      : `project_${(index + 10).toString(16).padStart(32, "0")}`
  );
  let registry = projectIds.reduce(
    (current, projectId, index) =>
      createProjectIdentity(current, {
        projectId,
        createdAt: `2026-08-02T00:00:${String(index + 1).padStart(2, "0")}.000Z`
      }).registry,
    createEmptyWorkContextRegistry("2026-08-02T00:00:00.000Z")
  );
  if (options.mapContinuation !== false) {
    projectIds.forEach((projectId, index) => {
      registry = confirmProjectMapping(registry, {
        scope: {
          source: "github",
          resourceType: "repository",
          opaqueId: String(10 + sourceIdOffset + index)
        },
        projectId,
        confirmedAt: `2026-08-02T00:01:${String(index).padStart(2, "0")}.000Z`,
        explicitUserConfirmation: true
      }).registry;
    });
  }
  const adapterOptions = {
    installationSecret: BOARD_FIXTURE_SECRET,
    asOf: ACTIVE_FIXTURE_AS_OF,
    snapshotFreshnessCutoff: FRESHNESS_CUTOFF
  };
  const adapterBatches = [
    adaptCodexContinuationObservations(codexSnapshot(), adapterOptions),
    adaptGitHubContinuationObservations(
      githubSnapshot(count, sourceIdOffset, activityAt),
      adapterOptions
    )
  ].sort((left, right) => compareRuntimeStrings(left.source, right.source));
  const identityOptions = {
    installationSecret: BOARD_FIXTURE_SECRET,
    expectedRegistrySha256: registry.registrySha256
  };
  const identityInput = createContinuationIdentityInput(
    { registry, adapterBatches },
    identityOptions
  );
  const identity = resolveContinuationIdentity(identityInput, identityOptions);
  if (!identity.ok) throw new TypeError("Synthetic B-001 R-001 fixture rejected");
  const derivationEnvelope = {
    contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  } as const;
  const derivation = deriveContinuationCandidates(
    identity.result,
    derivationEnvelope
  );
  if (!derivation.ok) throw new TypeError("Synthetic B-001 R-002 fixture rejected");
  const resolutionEnvelope = continuationResolutionEnvelopeSchema.parse({
    contract: CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_RESOLUTION_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    config: CONTINUATION_RESOLUTION_CONFIG,
    run: {
      runId: `continuation_run_${"5".repeat(32)}`,
      analysisId: `analysis_${"6".repeat(32)}`,
      startedAt: ACTIVE_FIXTURE_AS_OF,
      completedAt: "2026-08-02T03:00:00.010Z",
      codeCommitSha: BOARD_FIXTURE_CODE_SHA,
      datasetVersion: null,
      datasetSha256: null
    }
  });
  const trustedOptions = {
    installationSecret: BOARD_FIXTURE_SECRET,
    expectedRegistrySha256: registry.registrySha256,
    expectedCodeCommitSha: BOARD_FIXTURE_CODE_SHA,
    expectedDatasetVersion: null,
    expectedDatasetSha256: null
  };
  const resolved = resolveContinuation(
    identityInput,
    identity.result,
    derivationEnvelope,
    derivation.result,
    resolutionEnvelope,
    trustedOptions
  );
  if (!resolved.ok) throw new TypeError("Synthetic B-001 R-003 fixture rejected");
  return {
    bundle: {
      active,
      continuationIdentityInput: identityInput,
      continuationIdentityResult: identity.result,
      continuationDerivationEnvelope: derivationEnvelope,
      continuationDerivationResult: derivation.result,
      continuationResolutionEnvelope: resolutionEnvelope,
      continuationResolvedDecision: resolved.result
    },
    trustedOptions
  };
}

export function composeAuthenticBoard(fixture: AuthenticBoardFixture) {
  return composeWorkSuggestionBoard(fixture.bundle, fixture.trustedOptions);
}

function githubSnapshot(
  count: number,
  sourceIdOffset: number,
  activityAt: string
) {
  const repositories = Array.from({ length: count }, (_, index) => ({
    id: 10 + sourceIdOffset + index,
    source: "github" as const,
    kind: "repository" as const,
    installationId: 1,
    fullName: `synthetic/repository-${index}`,
    private: true,
    archived: false,
    updatedAt: activityAt
  }));
  return {
    schemaVersion: "github-snapshot-v6" as const,
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-02T02:40:00.000Z",
    user: { id: 1, login: "synthetic-user" },
    truncated: false,
    activityWindowStart: "2026-07-26T03:00:00.000Z",
    activitiesState: "available" as const,
    activitiesTruncated: false,
    actionabilityCoverage: {
      state: "complete" as const,
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    installations: [{
      id: 1,
      accountLogin: "synthetic-user",
      accountType: "User" as const,
      repositorySelection: "selected" as const,
      suspended: false
    }],
    repositories,
    tasks: [],
    activities: repositories.map((repository, index) => ({
      id: `push-event-${index}`,
      source: "github" as const,
      kind: "user_activity" as const,
      activityKind: "push" as const,
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      occurredAt: activityAt,
      subjectType: "repository" as const,
      subjectNumber: null,
      subjectObjectId: null,
      subjectTitle: null,
      refName: "refs/heads/main",
      reviewState: null,
      artifactId: `artifact_${String(index + 1).repeat(32).slice(0, 32)}`
    }))
  };
}

function codexSnapshot() {
  return {
    schemaVersion: "codex-snapshot-v3" as const,
    collectorVersion: "codex-app-server-metadata-v1" as const,
    contentMode: "metadata_only" as const,
    codexVersion: "synthetic-codex",
    fetchedAt: "2026-08-02T02:40:00.000Z",
    lookbackStart: "2026-07-26T03:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: [],
    sessions: []
  };
}
