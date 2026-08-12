import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  type WorkContextRegistry
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
  adaptGitHubContinuationObservations,
  type ContinuationSourceAdapterBatch
} from "../../src/continuation/adapters";
import {
  CONTINUATION_CANDIDATE_DERIVATION_CONFIG,
  deriveContinuationCandidates,
  type ContinuationCandidateDerivationResult
} from "../../src/continuation/deriveCandidates";
import {
  createContinuationIdentityInput,
  resolveContinuationIdentity,
  type ContinuationIdentityInput,
  type ContinuationIdentityResult
} from "../../src/continuation/resolveIdentity";
import {
  CONTINUATION_RESOLUTION_CONFIG,
  continuationResolvedDecisionSchema,
  continuationResolutionEnvelopeSchema,
  resolveContinuation,
  verifyContinuationDecisionAgainstInput,
  type ContinuationResolutionEnvelope,
  type ContinuationResolvedDecision
} from "../../src/continuation/resolveContinuation";
import {
  continuationContractOracleSummarySchema,
  type ContinuationContractOracleCode,
  type ContinuationContractOracleSummary,
  type ContinuationCriticalErrorCode,
  type ContinuationOracleInvariantCode,
  type ContinuationResolverBehaviorScenario
} from "../../src/evaluation/continuation/contracts";
import { sha256Canonical } from "../../src/evaluation/crossSourceIntegrity";

const AS_OF = "2026-08-13T12:00:00.000Z";
const FRESHNESS_CUTOFF = "2026-08-13T10:00:00.000Z";
const SECRET = "synthetic-e001-installation-secret";
const CODE_COMMIT_SHA = "d".repeat(40);
const PROJECTS = [1, 2, 3, 4].map(
  (marker) => `project_${marker.toString(16).padStart(32, "0")}`
);
const PRIVATE_SENTINELS = [
  "private-sentinel-user-client-app",
  "private-sentinel-session-scope",
  "https://private.example/repository",
  "/Users/private/worktree",
  "f".repeat(40),
  "private-sentinel-prompt"
] as const;

type OracleCheck = {
  invariantCode: ContinuationOracleInvariantCode;
  passed: boolean;
  criticalOnFailure: ContinuationCriticalErrorCode[];
};

type Chain = {
  identityInput: ContinuationIdentityInput;
  identityResult: ContinuationIdentityResult;
  derivationEnvelope: ReturnType<typeof derivationEnvelope>;
  derivationResult: ContinuationCandidateDerivationResult;
  resolutionEnvelope: ContinuationResolutionEnvelope;
  resolutionOptions: ReturnType<typeof executionResolutionOptions>;
  resolved: ContinuationResolvedDecision;
  adapterBatches: ContinuationSourceAdapterBatch[];
};

export type ContinuationResolverEvaluationFixture = {
  scenario: ContinuationResolverBehaviorScenario;
  materializedInput: unknown;
  execute: () => ContinuationContractOracleSummary;
};

export type ContinuationResolverEvaluationInputDescriptor = {
  contract: "continuation-resolver-evaluation-input-v0.1";
  scenario: ContinuationResolverBehaviorScenario;
  reversePermutation: boolean;
  adapter: {
    asOf: typeof AS_OF;
    snapshotFreshnessCutoff: typeof FRESHNESS_CUTOFF;
    githubSourceSchemaVersion: "github-snapshot-v6";
    codexSourceSchemaVersion: "codex-snapshot-v3";
  };
  sourceSnapshots: ReturnType<typeof rawScenario>;
  sourceSnapshotSha256: {
    github: string;
    codex: string;
  };
  mappingConfig: ReturnType<typeof mappingConfigFor>;
  registry: WorkContextRegistry;
  registrySha256: string;
  registryContentSha256: string;
  derivationEnvelope: ReturnType<typeof derivationEnvelope>;
  resolutionEnvelope: ContinuationResolutionEnvelope;
  trustedExpectations: {
    expectedRegistrySha256: string;
    expectedCodeCommitSha: string;
    expectedDatasetVersion: null;
    expectedDatasetSha256: null;
  };
};

export type ContinuationResolverEvaluationMaterializedInput = {
  contract: "continuation-resolver-evaluation-materialized-input-v0.1";
  primary: ContinuationResolverEvaluationInputDescriptor;
  permutation: ContinuationResolverEvaluationInputDescriptor | null;
};

export function buildContinuationResolverEvaluationFixture(
  scenario: ContinuationResolverBehaviorScenario
): ContinuationResolverEvaluationFixture {
  const descriptor = buildInputDescriptor(scenario, false);
  const replayDescriptor = scenario === "resolver_tie_determinism"
    ? buildInputDescriptor(scenario, true)
    : null;
  const materializedInput: ContinuationResolverEvaluationMaterializedInput = {
    contract: "continuation-resolver-evaluation-materialized-input-v0.1",
    primary: descriptor,
    permutation: replayDescriptor
  };
  return {
    scenario,
    materializedInput,
    execute: () => executeMaterializedInput(materializedInput)
  };
}

function executeMaterializedInput(
  input: ContinuationResolverEvaluationMaterializedInput
): ContinuationContractOracleSummary {
  return summarizeScenario(
    input.primary.scenario,
    executeDescriptor(input.primary),
    input.permutation === null ? null : executeDescriptor(input.permutation)
  );
}

function buildInputDescriptor(
  scenario: ContinuationResolverBehaviorScenario,
  reversePermutation: boolean
): ContinuationResolverEvaluationInputDescriptor {
  const sourceSnapshots = rawScenario(scenario, reversePermutation);
  const mappingConfig = mappingConfigFor(scenario);
  const registry = registryFor(scenario);
  return {
    contract: "continuation-resolver-evaluation-input-v0.1",
    scenario,
    reversePermutation,
    adapter: {
      asOf: AS_OF,
      snapshotFreshnessCutoff: FRESHNESS_CUTOFF,
      githubSourceSchemaVersion: "github-snapshot-v6",
      codexSourceSchemaVersion: "codex-snapshot-v3"
    },
    sourceSnapshots,
    sourceSnapshotSha256: {
      github: sha256Canonical(sourceSnapshots.github),
      codex: sha256Canonical(sourceSnapshots.codex)
    },
    mappingConfig,
    registry,
    registrySha256: registry.registrySha256,
    registryContentSha256: sha256Canonical(registry),
    derivationEnvelope: derivationEnvelope(),
    resolutionEnvelope: resolutionEnvelope(),
    trustedExpectations: trustedExpectations(registry.registrySha256)
  };
}

function executeDescriptor(
  descriptor: ContinuationResolverEvaluationInputDescriptor
): Chain {
  assertDescriptorIntegrity(descriptor);
  const raw = descriptor.sourceSnapshots;
  const adapterBatches = [
    adaptCodexContinuationObservations(raw.codex, adapterOptions(descriptor)),
    adaptGitHubContinuationObservations(raw.github, adapterOptions(descriptor))
  ].sort((left, right) => compareRuntimeStrings(left.source, right.source));
  const identityOptions = {
    installationSecret: SECRET,
    expectedRegistrySha256: descriptor.trustedExpectations.expectedRegistrySha256
  };
  const identityInput = createContinuationIdentityInput(
    { registry: descriptor.registry, adapterBatches },
    identityOptions
  );
  const identity = resolveContinuationIdentity(identityInput, identityOptions);
  if (!identity.ok) {
    throw new TypeError(`Synthetic R-001 input rejected for ${descriptor.scenario}.`);
  }
  const candidateEnvelope = descriptor.derivationEnvelope;
  const derivation = deriveContinuationCandidates(
    identity.result,
    candidateEnvelope
  );
  if (!derivation.ok) {
    throw new TypeError(`Synthetic R-002 input rejected for ${descriptor.scenario}.`);
  }
  const resolverEnvelope = descriptor.resolutionEnvelope;
  const trustedOptions = executionResolutionOptions(descriptor.trustedExpectations);
  const resolution = resolveContinuation(
    identityInput,
    identity.result,
    candidateEnvelope,
    derivation.result,
    resolverEnvelope,
    trustedOptions
  );
  if (!resolution.ok) {
    throw new TypeError(`Synthetic R-003 input rejected for ${descriptor.scenario}.`);
  }
  return {
    identityInput,
    identityResult: identity.result,
    derivationEnvelope: candidateEnvelope,
    derivationResult: derivation.result,
    resolutionEnvelope: resolverEnvelope,
    resolutionOptions: trustedOptions,
    resolved: resolution.result,
    adapterBatches
  };
}

function assertDescriptorIntegrity(
  descriptor: ContinuationResolverEvaluationInputDescriptor
): void {
  if (
    sha256Canonical(descriptor.sourceSnapshots.github) !==
      descriptor.sourceSnapshotSha256.github ||
    sha256Canonical(descriptor.sourceSnapshots.codex) !==
      descriptor.sourceSnapshotSha256.codex ||
    descriptor.registry.registrySha256 !== descriptor.registrySha256 ||
    sha256Canonical(descriptor.registry) !== descriptor.registryContentSha256 ||
    descriptor.trustedExpectations.expectedRegistrySha256 !==
      descriptor.registrySha256
  ) {
    throw new TypeError("Synthetic resolver input descriptor integrity check failed.");
  }
}

function summarizeScenario(
  scenario: ContinuationResolverBehaviorScenario,
  chain: Chain,
  permutation: Chain | null
): ContinuationContractOracleSummary {
  const artifactAccepted =
    continuationResolvedDecisionSchema.safeParse(chain.resolved).success;
  const inputBound = verifyChain(chain);
  const decision = chain.resolved.decision;
  const common = [
    check("R003_ARTIFACT_SCHEMA_ACCEPTED", artifactAccepted, "CONTRACT_INTEGRITY_FAILURE"),
    check("R003_INPUT_BOUND_VERIFIED", inputBound, "CONTRACT_INTEGRITY_FAILURE")
  ];
  switch (scenario) {
    case "resolver_github_recent":
      return summary("RECENT_GITHUB_ACTIVITY_BOUNDED", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "MAPPING_MISSING_ROUTES_TO_SETUP",
          chain.derivationResult.setupCandidateCount === 1 &&
            decision.status === "offers_available",
          "WRONG_IDENTITY"
        ),
        check(
          "RECENT_GITHUB_BOUNDED",
          decision.primary?.candidateKind === "recent_github_push" &&
            decision.primary.localDisplayLabel === "Recent GitHub activity",
          "WRONG_IDENTITY"
        )
      ]);
    case "resolver_github_stale":
      return summary("STALE_GITHUB_ACTIVITY_EXCLUDED", chain, [
        ...common,
        check(
          "STALE_ACTIVITY_EXCLUDED",
          decision.status === "insufficient_evidence" &&
            decision.primary === null &&
            chain.derivationResult.exclusions.some(
              (item) => item.reasonCode === "SNAPSHOT_STALE"
            ),
          "STALE_CURRENT_CLAIM"
        )
      ]);
    case "resolver_codex_metadata":
      return summary("CODEX_METADATA_ONLY_BOUNDED", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "CODEX_METADATA_ONLY_BOUNDED",
          decision.primary?.candidateKind === "recent_codex_session" &&
            decision.primary.caveatCodes.includes("SOURCE_METADATA_ONLY"),
          "CONTRACT_INTEGRITY_FAILURE"
        ),
        terminalUnknownCheck(chain)
      ]);
    case "resolver_codex_historical_completion":
      return summary("CODEX_HISTORICAL_COMPLETION_BOUNDED", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "CODEX_HISTORICAL_STATUS_BOUNDED",
          decision.primary?.candidateKind === "recent_codex_session" &&
            sourceObservation(chain, "codex")?.terminalState === "unknown",
          "STALE_CURRENT_CLAIM"
        ),
        check(
          "NO_FALSE_STATUS_CLAIM",
          !JSON.stringify(decision.reasonCodes).match(/COMPLET|CURRENT|TERMINAL|URGENT/u),
          "STALE_CURRENT_CLAIM"
        ),
        terminalUnknownCheck(chain)
      ]);
    case "resolver_future_activity":
      return summary("FUTURE_ACTIVITY_REJECTED", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "FUTURE_ACTIVITY_BLOCKED",
          sourceBatch(chain, "github").exclusions.some(
            (item) => item.reasonCode === "ACTIVITY_FROM_FUTURE"
          ),
          "STALE_CURRENT_CLAIM"
        ),
        check(
          "SEVEN_DAY_WINDOW_BOUNDARY_ENFORCED",
          sourceBatch(chain, "github").exclusions.some(
            (item) => item.reasonCode === "OUTSIDE_ACTIVITY_WINDOW"
          ) && decision.status === "offers_available",
          "STALE_CURRENT_CLAIM"
        )
      ]);
    case "resolver_partial_coverage":
      return summary("PARTIAL_COVERAGE_CAVEATED", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "PARTIAL_COVERAGE_PRESERVED",
          decision.coverageCode === "SOURCE_LOCAL_PARTIAL" &&
            decision.primary?.caveatCodes.includes("SOURCE_COVERAGE_PARTIAL") === true,
          "CONTRACT_INTEGRITY_FAILURE"
        )
      ]);
    case "resolver_privacy_boundary":
      return summary("PRIVATE_VALUES_REMAIN_LOCAL", chain, [
        ...common,
        displayOnlyCheck(chain),
        check(
          "PRIVATE_VALUES_REMAIN_LOCAL",
          PRIVATE_SENTINELS.every(
            (sentinel) => !JSON.stringify(chain.resolved).includes(sentinel)
          ) && !JSON.stringify(chain.resolved).includes(SECRET),
          "PRIVACY_LEAK"
        )
      ]);
    case "resolver_same_name_identities":
      return summary("SAME_NAME_IDENTITIES_NOT_AUTO_MERGED", chain, [
        ...common,
        check(
          "SAME_NAME_IDENTITIES_NOT_AUTO_MERGED",
          chain.identityResult.conflictCount === 0 &&
            selectedCandidates(chain).every(
            (candidate) => candidate.candidateKind === "workspace_mapping"
          ),
          "WRONG_IDENTITY"
        ),
        check(
          "MAPPING_MISSING_ROUTES_TO_SETUP",
          decision.status === "setup_required" &&
            chain.identityResult.setupNeededCount === 2,
          "WRONG_IDENTITY"
        ),
        check(
          "SAME_NAME_NOT_LINKED",
          !chain.derivationResult.candidates.some(
            (candidate) => candidate.candidateKind === "linked_workstream"
          ),
          "WRONG_IDENTITY"
        ),
        check(
          "SETUP_CAPABILITY_BOUNDED",
          selectedCandidates(chain).every(
            (candidate) =>
              candidate.capability === "open_setup_surface" &&
              candidate.availability === "setup_required"
          ),
          "UNSAFE_ACTION_TARGET"
        )
      ]);
    case "resolver_tie_determinism": {
      const selected = selectedCandidates(chain);
      const replaySelected = permutation === null
        ? []
        : selectedCandidates(permutation);
      const ids = selected.map((candidate) => candidate.candidateId);
      return summary("DETERMINISTIC_TIEBREAK_PRESERVED", chain, [
        ...common,
        check(
          "DETERMINISTIC_TIEBREAK_PRESERVED",
          ids.join("|") === [...ids].sort(compareRuntimeStrings).join("|"),
          "DETERMINISTIC_REPLAY_MISMATCH"
        ),
        check(
          "PERMUTATION_STABLE",
          permutation !== null &&
            verifyChain(permutation) &&
            ids.join("|") === replaySelected.map((candidate) => candidate.candidateId).join("|"),
          "DETERMINISTIC_REPLAY_MISMATCH"
        ),
        check("TOP_THREE_BOUNDED", selected.length === 3, "CONTRACT_INTEGRITY_FAILURE")
      ]);
  }
}
}

function summary(
  oracleCode: ContinuationContractOracleCode,
  chain: Chain,
  checks: OracleCheck[]
): ContinuationContractOracleSummary {
  const allPassed = checks.every((item) => item.passed);
  return continuationContractOracleSummarySchema.parse({
    oracleCode: allPassed ? oracleCode : "CONTRACT_ORACLE_FAILED",
    contractOutcome: "accepted",
    decisionStatus: chain.resolved.decision.status,
    coverageCode: chain.resolved.decision.coverageCode,
    prominentLane: null,
    invariantCodes: checks
      .filter((item) => item.passed)
      .map((item) => item.invariantCode)
      .sort(compareRuntimeStrings),
    criticalErrorCodes: [...new Set(checks.flatMap((item) =>
      item.passed ? [] : item.criticalOnFailure
    ))].sort(compareRuntimeStrings)
  });
}

function check(
  invariantCode: ContinuationOracleInvariantCode,
  passed: boolean,
  ...criticalOnFailure: ContinuationCriticalErrorCode[]
): OracleCheck {
  return { invariantCode, passed, criticalOnFailure };
}

function displayOnlyCheck(chain: Chain): OracleCheck {
  const primary = chain.resolved.decision.primary;
  return check(
    "DISPLAY_ONLY_AUTHORITY",
    primary?.capability === "display" && primary.privateActionTarget === null,
    "AUTOMATIC_EXECUTION_OR_MUTATION"
  );
}

function terminalUnknownCheck(chain: Chain): OracleCheck {
  return check(
    "TERMINAL_STATE_UNKNOWN",
    sourceObservation(chain, "codex")?.terminalState === "unknown" &&
      chain.resolved.decision.primary?.caveatCodes.includes("TERMINAL_STATE_UNKNOWN") === true,
    "STALE_CURRENT_CLAIM"
  );
}

function verifyChain(chain: Chain): boolean {
  return verifyContinuationDecisionAgainstInput(
    chain.identityInput,
    chain.identityResult,
    chain.derivationEnvelope,
    chain.derivationResult,
    chain.resolutionEnvelope,
    chain.resolutionOptions,
    chain.resolved
  );
}

function selectedCandidates(chain: Chain) {
  const { primary, alternatives } = chain.resolved.decision;
  return primary === null ? [] : [primary, ...alternatives];
}

function sourceBatch(chain: Chain, source: "github" | "codex") {
  const batch = chain.adapterBatches.find((item) => item.source === source);
  if (batch === undefined) throw new TypeError(`Missing ${source} batch.`);
  return batch;
}

function sourceObservation(chain: Chain, source: "github" | "codex") {
  return sourceBatch(chain, source).observations[0];
}

function adapterOptions(
  descriptor: ContinuationResolverEvaluationInputDescriptor
) {
  return {
    installationSecret: SECRET,
    asOf: descriptor.adapter.asOf,
    snapshotFreshnessCutoff: descriptor.adapter.snapshotFreshnessCutoff
  };
}

function derivationEnvelope() {
  return {
    contract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    asOf: AS_OF,
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  };
}

function resolutionEnvelope(): ContinuationResolutionEnvelope {
  return continuationResolutionEnvelopeSchema.parse({
    contract: CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
    schemaVersion: CONTINUATION_RESOLUTION_SCHEMA_VERSION,
    asOf: AS_OF,
    config: CONTINUATION_RESOLUTION_CONFIG,
    run: {
      runId: `continuation_run_${"5".repeat(32)}`,
      analysisId: `analysis_${"6".repeat(32)}`,
      startedAt: AS_OF,
      completedAt: "2026-08-13T12:00:00.010Z",
      codeCommitSha: CODE_COMMIT_SHA,
      datasetVersion: null,
      datasetSha256: null
    }
  });
}

function trustedExpectations(expectedRegistrySha256: string) {
  return {
    expectedRegistrySha256,
    expectedCodeCommitSha: CODE_COMMIT_SHA,
    expectedDatasetVersion: null,
    expectedDatasetSha256: null
  };
}

function executionResolutionOptions(
  expectations: ContinuationResolverEvaluationInputDescriptor["trustedExpectations"]
) {
  return {
    installationSecret: SECRET,
    ...expectations
  };
}

function mappingConfigFor(
  scenario: ContinuationResolverBehaviorScenario
) {
  const projectCount = scenario === "resolver_tie_determinism" ? 4 : 1;
  const githubRepositoryIds = scenario === "resolver_tie_determinism"
    ? [10, 11, 12, 13]
    : [
        "resolver_github_recent",
        "resolver_github_stale",
        "resolver_future_activity",
        "resolver_partial_coverage",
        "resolver_privacy_boundary"
      ].includes(scenario)
      ? [10]
      : [];
  const codexScopeIds = [
    "resolver_codex_metadata",
    "resolver_codex_historical_completion"
  ].includes(scenario)
    ? ["a".repeat(24)]
    : [];
  return {
    projectIds: PROJECTS.slice(0, projectCount),
    githubRepositoryIds,
    codexScopeIds,
    explicitUserConfirmation: true as const
  };
}

function registryFor(
  scenario: ContinuationResolverBehaviorScenario
): WorkContextRegistry {
  const mappingConfig = mappingConfigFor(scenario);
  let registry = mappingConfig.projectIds.reduce(
    (current, projectId, index) =>
      createProjectIdentity(current, {
        projectId,
        createdAt: `2026-08-13T00:00:${String(index + 1).padStart(2, "0")}.000Z`
      }).registry,
    createEmptyWorkContextRegistry("2026-08-13T00:00:00.000Z")
  );
  for (const [index, repositoryId] of mappingConfig.githubRepositoryIds.entries()) {
    registry = confirmProjectMapping(registry, {
      scope: {
        source: "github",
        resourceType: "repository",
        opaqueId: String(repositoryId)
      },
      projectId: PROJECTS[index]!,
      confirmedAt: `2026-08-13T00:01:${String(index).padStart(2, "0")}.000Z`,
      explicitUserConfirmation: true
    }).registry;
  }
  for (const scopeId of mappingConfig.codexScopeIds) {
    registry = confirmProjectMapping(registry, {
      scope: {
        source: "codex",
        resourceType: "scope",
        opaqueId: scopeId
      },
      projectId: PROJECTS[0]!,
      confirmedAt: "2026-08-13T00:02:00.000Z",
      explicitUserConfirmation: true
    }).registry;
  }
  return registry;
}

function rawScenario(
  scenario: ContinuationResolverBehaviorScenario,
  reversePermutation: boolean
) {
  const emptyGitHub = githubSnapshot(0);
  const emptyCodex = codexSnapshot(0);
  switch (scenario) {
    case "resolver_github_recent":
      return { github: githubSnapshot(2), codex: emptyCodex };
    case "resolver_github_stale": {
      const github = githubSnapshot(1);
      github.fetchedAt = "2026-08-13T09:00:00.000Z";
      github.repositories[0]!.updatedAt = "2026-08-13T08:30:00.000Z";
      github.activities[0]!.occurredAt = "2026-08-13T08:30:00.000Z";
      return { github, codex: emptyCodex };
    }
    case "resolver_codex_metadata":
      return { github: emptyGitHub, codex: codexSnapshot(1) };
    case "resolver_codex_historical_completion":
      return { github: emptyGitHub, codex: historicalCodexSnapshot() };
    case "resolver_future_activity": {
      const github = githubSnapshot(1);
      github.fetchedAt = AS_OF;
      github.repositories[0]!.updatedAt = AS_OF;
      github.activities = [
        { ...github.activities[0]!, id: "inside", occurredAt: "2026-08-06T12:00:00.001Z" },
        { ...github.activities[0]!, id: "boundary", occurredAt: "2026-08-06T12:00:00.000Z" },
        { ...github.activities[0]!, id: "future", occurredAt: "2026-08-13T12:00:00.001Z" }
      ];
      return { github, codex: emptyCodex };
    }
    case "resolver_partial_coverage": {
      const github = githubSnapshot(1);
      github.truncated = true;
      return { github, codex: emptyCodex };
    }
    case "resolver_privacy_boundary": {
      const github = githubSnapshot(1);
      github.appClientId = PRIVATE_SENTINELS[0];
      github.appSlug = PRIVATE_SENTINELS[0];
      github.user.login = PRIVATE_SENTINELS[0];
      github.repositories[0]!.fullName = PRIVATE_SENTINELS[2];
      github.activities[0]!.repositoryFullName = PRIVATE_SENTINELS[2];
      github.activities[0]!.subjectTitle = `${PRIVATE_SENTINELS[3]} ${PRIVATE_SENTINELS[4]} ${PRIVATE_SENTINELS[5]}`;
      return { github, codex: emptyCodex };
    }
    case "resolver_same_name_identities": {
      const github = githubSnapshot(1);
      github.repositories[0]!.fullName = "same-private-project-name";
      github.activities[0]!.repositoryFullName = "same-private-project-name";
      const codex = codexSnapshot(1);
      codex.sessions[0]!.projectLabel = "same-private-project-name";
      return { github, codex };
    }
    case "resolver_tie_determinism": {
      const github = githubSnapshot(4);
      if (reversePermutation) {
        github.repositories.reverse();
        github.activities.reverse();
      }
      return { github, codex: emptyCodex };
    }
  }
}

function githubSnapshot(count: number) {
  const repositories = Array.from({ length: count }, (_, index) => ({
    id: 10 + index,
    source: "github" as const,
    kind: "repository" as const,
    installationId: 1,
    fullName: `synthetic/repository-${index}`,
    private: true,
    archived: false,
    updatedAt: "2026-08-13T11:30:00.000Z"
  }));
  return {
    schemaVersion: "github-snapshot-v6" as const,
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-13T11:40:00.000Z",
    user: { id: 1, login: "synthetic-user" },
    truncated: false,
    activityWindowStart: "2026-08-06T12:00:00.000Z",
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
      occurredAt: "2026-08-13T11:30:00.000Z",
      subjectType: "repository" as const,
      subjectNumber: null,
      subjectObjectId: null,
      subjectTitle: null as string | null,
      refName: "refs/heads/main",
      reviewState: null,
      artifactId: `artifact_${String(index + 1).repeat(32).slice(0, 32)}`
    }))
  };
}

function codexSnapshot(count: number) {
  return {
    schemaVersion: "codex-snapshot-v3" as const,
    collectorVersion: "codex-app-server-metadata-v1" as const,
    contentMode: "metadata_only" as const,
    codexVersion: "synthetic-codex",
    fetchedAt: "2026-08-13T11:40:00.000Z",
    lookbackStart: "2026-08-06T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["a".repeat(24)],
    sessions: Array.from({ length: count }, (_, index) => ({
      id: (index + 11).toString(16).padStart(24, "0"),
      source: "codex" as const,
      kind: "coding_session" as const,
      scopeId: "a".repeat(24),
      projectLabel: "synthetic-project",
      taskSummary: null,
      taskSummarySource: null,
      createdAt: "2026-08-13T11:00:00.000Z",
      updatedAt: "2026-08-13T11:30:00.000Z",
      activityState: "idle" as const,
      attentionState: null,
      content: disabledContent()
    }))
  };
}

function disabledContent() {
  return {
    state: "not_collected" as const,
    contentSha256: null,
    contentSourceUpdatedAt: null,
    collectedAt: null,
    expiresAt: null,
    historicalTurnStatus: "unknown" as const,
    latestTurnCompletedAt: null,
    turnCount: 0,
    userPromptCount: 0,
    agentResponseCount: 0,
    commandExecutionCount: 0,
    failedCommandCount: 0,
    fileChangeCount: 0,
    toolCallCount: 0,
    omittedReasoningItemCount: 0,
    omittedUnsupportedItemCount: 0,
    truncated: false,
    reasonCodes: ["CONTENT_MODE_DISABLED" as const],
    latestUserPromptExcerpt: null,
    latestAgentResponseExcerpt: null,
    latestExecutionSummary: null
  };
}

function historicalCodexSnapshot() {
  const snapshot = codexSnapshot(1);
  return {
    ...snapshot,
    collectorVersion: "codex-app-server-conversation-and-execution-v1" as const,
    contentMode: "conversation_and_execution" as const,
    conversationStoreSha256: "b".repeat(64),
    conversationRetentionDays: 7 as const,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      taskSummary: "Bounded historical context",
      taskSummarySource: "thread_name" as const,
      content: {
        state: "complete" as const,
        contentSha256: "c".repeat(64),
        contentSourceUpdatedAt: "2026-08-13T11:30:00.000Z",
        collectedAt: "2026-08-13T11:40:00.000Z",
        expiresAt: "2026-08-20T11:40:00.000Z",
        historicalTurnStatus: "completed" as const,
        latestTurnCompletedAt: "2026-08-13T11:29:00.000Z",
        turnCount: 2,
        userPromptCount: 1,
        agentResponseCount: 1,
        commandExecutionCount: 0,
        failedCommandCount: 0,
        fileChangeCount: 0,
        toolCallCount: 0,
        omittedReasoningItemCount: 0,
        omittedUnsupportedItemCount: 0,
        truncated: false,
        reasonCodes: [],
        latestUserPromptExcerpt: null,
        latestAgentResponseExcerpt: null,
        latestExecutionSummary: null
      }
    }))
  };
}
