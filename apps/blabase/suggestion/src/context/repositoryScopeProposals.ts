import {
  createCodexLocalGitGitHubRepositoryKey,
  type CodexLocalGitSnapshot
} from "../connectors/codex/localGitContracts";
import {
  readStoredCodexConfig,
  readStoredCodexLocalGitSnapshot
} from "../connectors/codex/localStore";
import type { StoredCodexConfig } from "../connectors/codex/types";
import { readStoredGitHubSnapshot } from "../connectors/github/localStore";
import type { GitHubSnapshot } from "../connectors/github/types";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import {
  lookupProjectId,
  sourceScopeFingerprint,
  type SourceScopeRef,
  type WorkContextRegistry
} from "./contracts";

export const REPOSITORY_SCOPE_PROPOSAL_CONTRACT =
  "repository-scope-proposal-v1" as const;
export const REPOSITORY_SCOPE_PROPOSAL_MAX_AGE_MS =
  24 * 60 * 60 * 1_000;
const CONFIRMED_LINK_LOCAL_GIT_MAX_AGE_MS = 5 * 60 * 1_000;
const CONFIRMED_LINK_MAX_FUTURE_SKEW_MS = 60 * 1_000;

type GitHubRepositoryScope = Extract<
  SourceScopeRef,
  { source: "github"; resourceType: "repository" }
>;
type CodexScope = Extract<
  SourceScopeRef,
  { source: "codex"; resourceType: "scope" }
>;

export type ConfirmedRepositoryScopeLink = {
  linkId: string;
  projectId: string;
  scopes: {
    github: GitHubRepositoryScope;
    codex: CodexScope;
  };
  registrySha256: string;
  githubFetchedAt: string;
  localGitSnapshotSha256: string;
  correlation: "repository_scope_only";
};

export type ConfirmedRepositoryScopeLinkResolution = {
  status: "ready" | "unavailable" | "conflict";
  registrySha256: string | null;
  links: ConfirmedRepositoryScopeLink[];
};

export type RepositoryScopeProposalReason =
  | "EXISTING_PROJECT_MAPPING"
  | "SOLE_ACTIVE_PROJECT"
  | "USER_SELECTION_REQUIRED";

/**
 * Safe public view. Repository names, paths, remotes, HMAC match keys, and
 * local Git object identities are deliberately absent.
 */
export type RepositoryScopeProposalGroup = {
  proposalGroupId: string;
  scopes: {
    github: GitHubRepositoryScope;
    codex: CodexScope;
  };
  suggestedProjectId: string | null;
  reason: RepositoryScopeProposalReason;
};

export type RepositoryScopeProposalResolution = {
  status: "ready" | "unavailable" | "conflict";
  groups: RepositoryScopeProposalGroup[];
};

export type RepositoryScopeProposalInput = {
  asOf: string;
  registry: WorkContextRegistry | null;
  githubSnapshot: GitHubSnapshot | null;
  codexConfig: StoredCodexConfig | null;
  localGitSnapshot: CodexLocalGitSnapshot | null;
};

export async function readStoredRepositoryScopeProposals(input: {
  asOf: string;
  registry: WorkContextRegistry | null;
  cwd?: string;
}): Promise<RepositoryScopeProposalResolution> {
  const cwd = input.cwd ?? process.cwd();
  const [githubSnapshot, codexConfig, localGitSnapshot] =
    await Promise.all([
      readStoredGitHubSnapshot(cwd),
      readStoredCodexConfig(cwd),
      readStoredCodexLocalGitSnapshot(cwd)
    ]);
  return resolveRepositoryScopeProposals({
    asOf: input.asOf,
    registry: input.registry,
    githubSnapshot,
    codexConfig,
    localGitSnapshot
  });
}

export function resolveRepositoryScopeProposals(
  input: RepositoryScopeProposalInput
): RepositoryScopeProposalResolution {
  const {
    asOf,
    registry,
    githubSnapshot,
    codexConfig,
    localGitSnapshot
  } = input;
  if (
    githubSnapshot === null ||
    codexConfig === null ||
    localGitSnapshot === null ||
    githubSnapshot.truncated ||
    localGitSnapshot.truncated ||
    !isCurrentSnapshot(githubSnapshot.fetchedAt, asOf) ||
    !isCurrentSnapshot(localGitSnapshot.fetchedAt, asOf)
  ) {
    return unavailable();
  }

  const selectedScopeIds = [...new Set(codexConfig.selectedScopeIds)].sort();
  if (
    selectedScopeIds.length !== codexConfig.selectedScopeIds.length ||
    !sameStringSet(selectedScopeIds, localGitSnapshot.scopeIds)
  ) {
    return unavailable();
  }

  const configuredScopes = new Map<string, number>();
  for (const scope of codexConfig.scopes) {
    if (!selectedScopeIds.includes(scope.id)) continue;
    configuredScopes.set(scope.id, (configuredScopes.get(scope.id) ?? 0) + 1);
  }
  if (
    selectedScopeIds.some((scopeId) => configuredScopes.get(scopeId) !== 1)
  ) {
    return unavailable();
  }

  const rowsByScope = new Map<
    string,
    CodexLocalGitSnapshot["repositories"]
  >();
  for (const repository of localGitSnapshot.repositories) {
    if (!selectedScopeIds.includes(repository.scopeId)) return unavailable();
    const current = rowsByScope.get(repository.scopeId) ?? [];
    rowsByScope.set(repository.scopeId, [...current, repository]);
  }
  if (
    selectedScopeIds.some(
      (scopeId) => (rowsByScope.get(scopeId)?.length ?? 0) !== 1
    )
  ) {
    return unavailable();
  }

  const selectedRows = selectedScopeIds.map(
    (scopeId) => rowsByScope.get(scopeId)![0]
  );
  if (
    selectedRows.some(
      (repository) => repository.mappingEligibility === "conflict"
    )
  ) {
    return conflict();
  }
  const exactRows = selectedRows.filter(
    (repository) => repository.mappingEligibility === "exact"
  );
  if (
    exactRows.some(
      (repository) =>
        repository.githubRepositoryKey === null ||
        repository.trackingState === "unavailable"
    )
  ) {
    return unavailable();
  }

  const githubByKey = new Map<
    string,
    GitHubSnapshot["repositories"]
  >();
  try {
    for (const repository of githubSnapshot.repositories) {
      const key = createCodexLocalGitGitHubRepositoryKey(
        codexConfig.installationSecret,
        repository.fullName
      );
      if (key === null) return unavailable();
      githubByKey.set(key, [
        ...(githubByKey.get(key) ?? []),
        repository
      ]);
    }
  } catch {
    return unavailable();
  }

  const localByKey = new Map<
    string,
    CodexLocalGitSnapshot["repositories"]
  >();
  for (const repository of exactRows) {
    const key = repository.githubRepositoryKey!;
    localByKey.set(key, [...(localByKey.get(key) ?? []), repository]);
  }
  if ([...localByKey.values()].some((rows) => rows.length !== 1)) {
    return conflict();
  }

  const activeProjects =
    registry?.projects.filter((project) => project.archivedAt === null) ?? [];
  const groups: RepositoryScopeProposalGroup[] = [];
  for (const [repositoryKey, rows] of [...localByKey.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const githubRepositories = githubByKey.get(repositoryKey) ?? [];
    if (githubRepositories.length === 0) return unavailable();
    if (githubRepositories.length !== 1) return conflict();
    const githubRepository = githubRepositories[0];
    if (githubRepository.archived) return conflict();

    const githubScope: GitHubRepositoryScope = {
      source: "github",
      resourceType: "repository",
      opaqueId: String(githubRepository.id)
    };
    const codexScope: CodexScope = {
      source: "codex",
      resourceType: "scope",
      opaqueId: rows[0].scopeId
    };
    const githubMapping = currentProjectMapping(registry, githubScope);
    const codexMapping = currentProjectMapping(registry, codexScope);
    if (githubMapping.status === "invalid" || codexMapping.status === "invalid") {
      return conflict();
    }
    if (
      githubMapping.status === "mapped" &&
      codexMapping.status === "mapped"
    ) {
      if (githubMapping.projectId !== codexMapping.projectId) {
        return conflict();
      }
      continue;
    }

    let suggestedProjectId: string | null = null;
    let reason: RepositoryScopeProposalReason = "USER_SELECTION_REQUIRED";
    if (githubMapping.status === "mapped") {
      suggestedProjectId = githubMapping.projectId;
      reason = "EXISTING_PROJECT_MAPPING";
    } else if (codexMapping.status === "mapped") {
      suggestedProjectId = codexMapping.projectId;
      reason = "EXISTING_PROJECT_MAPPING";
    } else if (activeProjects.length === 1) {
      suggestedProjectId = activeProjects[0].projectId;
      reason = "SOLE_ACTIVE_PROJECT";
    }

    groups.push({
      proposalGroupId: createProposalGroupId({
        githubScope,
        codexScope,
        githubFetchedAt: githubSnapshot.fetchedAt,
        localGitSnapshotSha256: localGitSnapshot.snapshotSha256
      }),
      scopes: { github: githubScope, codex: codexScope },
      suggestedProjectId,
      reason
    });
  }

  return {
    status: "ready",
    groups: groups.sort((left, right) =>
      left.proposalGroupId.localeCompare(right.proposalGroupId)
    )
  };
}

/**
 * Revalidates private repository evidence against the captured current
 * registry. Mapping proposals are intentionally never consulted: both scope
 * lookups must resolve through terminal explicit decisions to the same active
 * project.
 */
export function resolveConfirmedRepositoryScopeLinks(
  input: RepositoryScopeProposalInput
): ConfirmedRepositoryScopeLinkResolution {
  const {
    asOf,
    registry,
    githubSnapshot,
    codexConfig,
    localGitSnapshot
  } = input;
  if (
    registry === null ||
    githubSnapshot === null ||
    codexConfig === null ||
    localGitSnapshot === null ||
    githubSnapshot.truncated ||
    localGitSnapshot.truncated ||
    !isConfirmedLinkEvidenceCurrent(
      githubSnapshot.fetchedAt,
      asOf,
      REPOSITORY_SCOPE_PROPOSAL_MAX_AGE_MS
    ) ||
    !isConfirmedLinkEvidenceCurrent(
      localGitSnapshot.fetchedAt,
      asOf,
      CONFIRMED_LINK_LOCAL_GIT_MAX_AGE_MS
    )
  ) {
    return confirmedLinksUnavailable(registry?.registrySha256 ?? null);
  }

  const selectedScopeIds = [...new Set(codexConfig.selectedScopeIds)].sort();
  if (
    selectedScopeIds.length !== codexConfig.selectedScopeIds.length ||
    !sameStringSet(selectedScopeIds, localGitSnapshot.scopeIds)
  ) {
    return confirmedLinksUnavailable(registry.registrySha256);
  }
  const configuredScopeCounts = new Map<string, number>();
  for (const scope of codexConfig.scopes) {
    if (!selectedScopeIds.includes(scope.id)) continue;
    configuredScopeCounts.set(
      scope.id,
      (configuredScopeCounts.get(scope.id) ?? 0) + 1
    );
  }
  if (
    selectedScopeIds.some(
      (scopeId) => configuredScopeCounts.get(scopeId) !== 1
    )
  ) {
    return confirmedLinksUnavailable(registry.registrySha256);
  }

  const rowsByScope = new Map<
    string,
    CodexLocalGitSnapshot["repositories"]
  >();
  for (const repository of localGitSnapshot.repositories) {
    if (!selectedScopeIds.includes(repository.scopeId)) {
      return confirmedLinksUnavailable(registry.registrySha256);
    }
    rowsByScope.set(repository.scopeId, [
      ...(rowsByScope.get(repository.scopeId) ?? []),
      repository
    ]);
  }
  if (
    selectedScopeIds.some(
      (scopeId) => (rowsByScope.get(scopeId)?.length ?? 0) !== 1
    )
  ) {
    return confirmedLinksUnavailable(registry.registrySha256);
  }
  const selectedRows = selectedScopeIds.map(
    (scopeId) => rowsByScope.get(scopeId)![0]
  );
  if (
    selectedRows.some(
      (repository) => repository.mappingEligibility === "conflict"
    )
  ) {
    return confirmedLinksConflict(registry.registrySha256);
  }
  const exactRows = selectedRows.filter(
    (repository) => repository.mappingEligibility === "exact"
  );
  if (
    exactRows.some(
      (repository) =>
        repository.githubRepositoryKey === null ||
        repository.trackingState === "unavailable"
    )
  ) {
    return confirmedLinksUnavailable(registry.registrySha256);
  }

  const githubByKey = new Map<
    string,
    GitHubSnapshot["repositories"]
  >();
  try {
    for (const repository of githubSnapshot.repositories) {
      const key = createCodexLocalGitGitHubRepositoryKey(
        codexConfig.installationSecret,
        repository.fullName
      );
      if (key === null) {
        return confirmedLinksUnavailable(registry.registrySha256);
      }
      githubByKey.set(key, [
        ...(githubByKey.get(key) ?? []),
        repository
      ]);
    }
  } catch {
    return confirmedLinksUnavailable(registry.registrySha256);
  }

  const localByKey = new Map<
    string,
    CodexLocalGitSnapshot["repositories"]
  >();
  for (const repository of exactRows) {
    const key = repository.githubRepositoryKey!;
    localByKey.set(key, [...(localByKey.get(key) ?? []), repository]);
  }
  if ([...localByKey.values()].some((rows) => rows.length !== 1)) {
    return confirmedLinksConflict(registry.registrySha256);
  }

  const links: ConfirmedRepositoryScopeLink[] = [];
  for (const [repositoryKey, rows] of [...localByKey.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const githubRepositories = githubByKey.get(repositoryKey) ?? [];
    if (githubRepositories.length === 0) {
      return confirmedLinksUnavailable(registry.registrySha256);
    }
    if (githubRepositories.length !== 1) {
      return confirmedLinksConflict(registry.registrySha256);
    }
    const githubRepository = githubRepositories[0];
    if (githubRepository.archived) {
      return confirmedLinksConflict(registry.registrySha256);
    }
    const githubScope: GitHubRepositoryScope = {
      source: "github",
      resourceType: "repository",
      opaqueId: String(githubRepository.id)
    };
    const codexScope: CodexScope = {
      source: "codex",
      resourceType: "scope",
      opaqueId: rows[0].scopeId
    };
    const githubMapping = currentProjectMapping(registry, githubScope);
    const codexMapping = currentProjectMapping(registry, codexScope);
    if (githubMapping.status === "invalid" || codexMapping.status === "invalid") {
      return confirmedLinksConflict(registry.registrySha256);
    }
    if (
      githubMapping.status !== "mapped" ||
      codexMapping.status !== "mapped"
    ) {
      continue;
    }
    if (githubMapping.projectId !== codexMapping.projectId) {
      return confirmedLinksConflict(registry.registrySha256);
    }
    const linkContent = {
      projectId: githubMapping.projectId,
      scopes: { github: githubScope, codex: codexScope },
      registrySha256: registry.registrySha256,
      githubFetchedAt: githubSnapshot.fetchedAt,
      localGitSnapshotSha256: localGitSnapshot.snapshotSha256,
      correlation: "repository_scope_only" as const
    };
    links.push({
      linkId: `repository_scope_link_${runtimeSha256({
        domain: "confirmed-repository-scope-link-v1",
        link: linkContent
      }).slice(0, 32)}`,
      ...linkContent
    });
  }
  return {
    status: "ready",
    registrySha256: registry.registrySha256,
    links: links.sort((left, right) => left.linkId.localeCompare(right.linkId))
  };
}

function currentProjectMapping(
  registry: WorkContextRegistry | null,
  scope: SourceScopeRef
):
  | { status: "unmapped" }
  | { status: "mapped"; projectId: string }
  | { status: "invalid" } {
  if (registry === null) return { status: "unmapped" };
  const projectId = lookupProjectId(registry, scope);
  if (projectId !== null) return { status: "mapped", projectId };

  const fingerprint = sourceScopeFingerprint(scope);
  const supersededIds = new Set(
    registry.mappingDecisions
      .map((decision) => decision.supersedesDecisionId)
      .filter((decisionId): decisionId is string => decisionId !== null)
  );
  const terminal = registry.mappingDecisions.filter(
    (decision) =>
      sourceScopeFingerprint(decision.scope) === fingerprint &&
      !supersededIds.has(decision.decisionId)
  );
  if (terminal.length > 1) return { status: "invalid" };
  return terminal[0]?.action === "confirm"
    ? { status: "invalid" }
    : { status: "unmapped" };
}

function createProposalGroupId(input: {
  githubScope: GitHubRepositoryScope;
  codexScope: CodexScope;
  githubFetchedAt: string;
  localGitSnapshotSha256: string;
}): string {
  return `repository_scope_group_${runtimeSha256({
    contract: REPOSITORY_SCOPE_PROPOSAL_CONTRACT,
    ...input
  }).slice(0, 32)}`;
}

function isCurrentSnapshot(fetchedAt: string, asOf: string): boolean {
  const fetched = Date.parse(fetchedAt);
  const current = Date.parse(asOf);
  if (!Number.isFinite(fetched) || !Number.isFinite(current)) return false;
  const age = current - fetched;
  return age >= 0 && age <= REPOSITORY_SCOPE_PROPOSAL_MAX_AGE_MS;
}

function isConfirmedLinkEvidenceCurrent(
  fetchedAt: string,
  asOf: string,
  maxAgeMs: number
): boolean {
  const fetched = Date.parse(fetchedAt);
  const current = Date.parse(asOf);
  if (!Number.isFinite(fetched) || !Number.isFinite(current)) return false;
  const age = current - fetched;
  return (
    age >= -CONFIRMED_LINK_MAX_FUTURE_SKEW_MS && age <= maxAgeMs
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return left.every((value, index) => value === sortedRight[index]);
}

function unavailable(): RepositoryScopeProposalResolution {
  return { status: "unavailable", groups: [] };
}

function conflict(): RepositoryScopeProposalResolution {
  return { status: "conflict", groups: [] };
}

function confirmedLinksUnavailable(
  registrySha256: string | null
): ConfirmedRepositoryScopeLinkResolution {
  return { status: "unavailable", registrySha256, links: [] };
}

function confirmedLinksConflict(
  registrySha256: string
): ConfirmedRepositoryScopeLinkResolution {
  return { status: "conflict", registrySha256, links: [] };
}
