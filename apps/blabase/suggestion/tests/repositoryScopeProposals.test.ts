import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCodexLocalGitGitHubRepositoryKey,
  sealCodexLocalGitSnapshot
} from "../src/connectors/codex/localGitContracts";
import type { StoredCodexConfig } from "../src/connectors/codex/types";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import {
  confirmProjectMapping,
  confirmStoredRepositoryScopeProposal,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  createStoredProjectIdentity,
  lookupProjectId,
  proposeProjectMapping,
  readWorkContextRegistry,
  resolveConfirmedRepositoryScopeLinks,
  resolveRepositoryScopeProposals,
  type SourceScopeRef,
  type WorkContextRegistry
} from "../src/context";

const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;
const SCOPE_A = "b".repeat(24);
const SCOPE_B = "c".repeat(24);
const SECRET = "a".repeat(64);
const RAW_REPOSITORY = "private-owner/private-repository";
const RAW_PATH = "/Users/private/work/private-repository";
const T0 = "2026-08-09T00:00:00.000Z";
const T1 = "2026-08-09T01:00:00.000Z";
const AS_OF = "2026-08-09T02:00:00.000Z";
const temporaryDirectories: string[] = [];

const githubScope = {
  source: "github",
  resourceType: "repository",
  opaqueId: "101"
} as const satisfies SourceScopeRef;
const codexScope = {
  source: "codex",
  resourceType: "scope",
  opaqueId: SCOPE_A
} as const satisfies SourceScopeRef;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("repository scope proposals", () => {
it("creates confirmed links only from both current explicit decisions", () => {
  const base = {
    ...evidence(registryWithProjects(1)),
    localGitSnapshot: localGitSnapshot({ fetchedAt: AS_OF })
  };
    let proposed = proposeProjectMapping(base.registry, {
      scope: githubScope,
      suggestedProjectId: PROJECT_A,
      proposedAt: T1,
      basis: "shared_opaque_identifier"
    }).registry;
    proposed = proposeProjectMapping(proposed, {
      scope: codexScope,
      suggestedProjectId: PROJECT_A,
      proposedAt: T1,
      basis: "shared_opaque_identifier"
    }).registry;
    expect(
      resolveConfirmedRepositoryScopeLinks({ ...base, registry: proposed })
    ).toMatchObject({ status: "ready", links: [] });

    let confirmed = confirmProjectMapping(proposed, {
      scope: githubScope,
      projectId: PROJECT_A,
      confirmedAt: AS_OF,
      explicitUserConfirmation: true
    }).registry;
    confirmed = confirmProjectMapping(confirmed, {
      scope: codexScope,
      projectId: PROJECT_A,
      confirmedAt: AS_OF,
      explicitUserConfirmation: true
    }).registry;
    expect(
      resolveConfirmedRepositoryScopeLinks({ ...base, registry: confirmed })
    ).toMatchObject({
      status: "ready",
      registrySha256: confirmed.registrySha256,
      links: [
        {
          projectId: PROJECT_A,
          scopes: { github: githubScope, codex: codexScope },
          registrySha256: confirmed.registrySha256,
          correlation: "repository_scope_only"
        }
      ]
    });

    expect(
      resolveConfirmedRepositoryScopeLinks({
        ...base,
        registry: confirmed,
        githubSnapshot: {
          ...base.githubSnapshot,
          fetchedAt: "2026-08-09T02:01:00.000Z"
        },
        localGitSnapshot: localGitSnapshot({
          fetchedAt: "2026-08-09T02:01:00.000Z"
        })
      }).status
    ).toBe("ready");
    expect(
      resolveConfirmedRepositoryScopeLinks({
        ...base,
        registry: confirmed,
        githubSnapshot: {
          ...base.githubSnapshot,
          fetchedAt: "2026-08-09T02:01:00.001Z"
        }
      }).status
    ).toBe("unavailable");
    expect(
      resolveConfirmedRepositoryScopeLinks({
        ...base,
        registry: confirmed,
        localGitSnapshot: localGitSnapshot({
          fetchedAt: "2026-08-09T01:54:59.999Z"
        })
      }).status
    ).toBe("unavailable");
  });

  it("projects only an exact 1:1 opaque match and keeps private evidence out", () => {
    const registry = registryWithProjects(1);
    const input = evidence(registry);
    const result = resolveRepositoryScopeProposals(input);

    expect(result).toMatchObject({
      status: "ready",
      groups: [
        {
          scopes: { github: githubScope, codex: codexScope },
          suggestedProjectId: PROJECT_A,
          reason: "SOLE_ACTIVE_PROJECT"
        }
      ]
    });
    expect(result.groups[0].proposalGroupId).toMatch(
      /^repository_scope_group_[a-f0-9]{32}$/
    );
    expect(lookupProjectId(registry, githubScope)).toBeNull();
    expect(lookupProjectId(registry, codexScope)).toBeNull();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(RAW_REPOSITORY);
    expect(serialized).not.toContain(RAW_PATH);
    expect(serialized).not.toContain(
      input.localGitSnapshot!.repositories[0].githubRepositoryKey!
    );
    expect(serialized).not.toContain("local_repo_");
    expect(serialized).not.toContain("local_commit_");
  });

  it("requires user selection with zero or multiple active projects", () => {
    for (const projectCount of [0, 2]) {
      const result = resolveRepositoryScopeProposals(
        evidence(registryWithProjects(projectCount))
      );
      expect(result).toMatchObject({
        status: "ready",
        groups: [
          {
            suggestedProjectId: null,
            reason: "USER_SELECTION_REQUIRED"
          }
        ]
      });
    }
  });

  it("uses one existing mapping, treats the same mapping as noop, and rejects different mappings", () => {
    let oneMapped = registryWithProjects(2);
    oneMapped = confirmProjectMapping(oneMapped, {
      scope: githubScope,
      projectId: PROJECT_A,
      confirmedAt: T1,
      explicitUserConfirmation: true
    }).registry;
    expect(
      resolveRepositoryScopeProposals(evidence(oneMapped))
    ).toMatchObject({
      status: "ready",
      groups: [
        {
          suggestedProjectId: PROJECT_A,
          reason: "EXISTING_PROJECT_MAPPING"
        }
      ]
    });

    const same = confirmProjectMapping(oneMapped, {
      scope: codexScope,
      projectId: PROJECT_A,
      confirmedAt: AS_OF,
      explicitUserConfirmation: true
    }).registry;
    expect(resolveRepositoryScopeProposals(evidence(same))).toEqual({
      status: "ready",
      groups: []
    });

    const different = confirmProjectMapping(oneMapped, {
      scope: codexScope,
      projectId: PROJECT_B,
      confirmedAt: AS_OF,
      explicitUserConfirmation: true
    }).registry;
    expect(resolveRepositoryScopeProposals(evidence(different))).toEqual({
      status: "conflict",
      groups: []
    });
  });

  it("fails closed for missing, stale, archived, duplicate, and multi-remote evidence", () => {
    const base = evidence(registryWithProjects(1));
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        localGitSnapshot: null
      }).status
    ).toBe("unavailable");
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        localGitSnapshot: localGitSnapshot({
          fetchedAt: "2026-08-07T00:00:00.000Z"
        })
      }).status
    ).toBe("unavailable");
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        githubSnapshot: {
          ...base.githubSnapshot!,
          repositories: [
            { ...base.githubSnapshot!.repositories[0], archived: true }
          ]
        }
      }).status
    ).toBe("conflict");
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        githubSnapshot: {
          ...base.githubSnapshot!,
          repositories: [
            base.githubSnapshot!.repositories[0],
            { ...base.githubSnapshot!.repositories[0], id: 102 }
          ]
        }
      }).status
    ).toBe("conflict");
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        localGitSnapshot: localGitSnapshot({
          mappingEligibility: "conflict"
        })
      }).status
    ).toBe("conflict");
  });

  it("rejects two selected Codex scopes that resolve to the same repository key", () => {
    const base = evidence(registryWithProjects(1));
    const key = createCodexLocalGitGitHubRepositoryKey(
      SECRET,
      RAW_REPOSITORY
    )!;
    const secondConfigScope = {
      ...base.codexConfig!.scopes[0],
      id: SCOPE_B,
      queryPath: "/Users/private/work/duplicate"
    };
    const duplicate = sealCodexLocalGitSnapshot({
      schemaVersion: "codex-local-git-snapshot-v1",
      collectorVersion: "codex-local-git-metadata-v1",
      upstreamBasis: "local_tracking_ref_without_network_refresh",
      fetchedAt: T1,
      scopeIds: [SCOPE_A, SCOPE_B],
      repositories: [
        localGitRepository(SCOPE_A, key, "1"),
        localGitRepository(SCOPE_B, key, "2")
      ],
      truncated: false
    });
    expect(
      resolveRepositoryScopeProposals({
        ...base,
        codexConfig: {
          ...base.codexConfig!,
          selectedScopeIds: [SCOPE_A, SCOPE_B],
          scopes: [...base.codexConfig!.scopes, secondConfigScope]
        },
        localGitSnapshot: duplicate
      })
    ).toEqual({ status: "conflict", groups: [] });
  });
});

describe("stored repository scope confirmation", () => {
  it("proposes and confirms both scopes atomically and idempotently", async () => {
    const cwd = await temporaryDirectory();
    const created = await createStoredProjectIdentity(
      { projectId: PROJECT_A, createdAt: T0 },
      cwd
    );
    const input = {
      githubScope,
      codexScope,
      projectId: PROJECT_A,
      confirmedAt: T1,
      expectedRegistrySha256: created.registry.registrySha256,
      explicitUserConfirmation: true as const
    };
    const first = await confirmStoredRepositoryScopeProposal(input, cwd);
    expect(first.registry.revision).toBe(created.registry.revision + 4);
    expect(first.proposals).toHaveLength(2);
    expect(
      first.proposals.every(
        (proposal) => proposal.basis === "shared_opaque_identifier"
      )
    ).toBe(true);
    expect(first.decisions).toHaveLength(2);
    expect(lookupProjectId(first.registry, githubScope)).toBe(PROJECT_A);
    expect(lookupProjectId(first.registry, codexScope)).toBe(PROJECT_A);

    const repeated = await confirmStoredRepositoryScopeProposal(
      {
        ...input,
        expectedRegistrySha256: first.registry.registrySha256
      },
      cwd
    );
    expect(repeated.registry).toEqual(first.registry);

    await expect(
      confirmStoredRepositoryScopeProposal(
        {
          ...input,
          expectedRegistrySha256: created.registry.registrySha256
        },
        cwd
      )
    ).rejects.toMatchObject({ code: "STALE_REGISTRY" });
    expect(await readWorkContextRegistry(cwd)).toEqual({
      status: "available",
      value: first.registry
    });
  });

  it("requires the explicit confirmation literal before entering the mutation", async () => {
    const cwd = await temporaryDirectory();
    const created = await createStoredProjectIdentity(
      { projectId: PROJECT_A, createdAt: T0 },
      cwd
    );
    await expect(
      confirmStoredRepositoryScopeProposal(
        {
          githubScope,
          codexScope,
          projectId: PROJECT_A,
          confirmedAt: T1,
          expectedRegistrySha256: created.registry.registrySha256,
          explicitUserConfirmation: false as true
        },
        cwd
      )
    ).rejects.toMatchObject({
      code: "EXPLICIT_USER_CONFIRMATION_REQUIRED"
    });
    expect(await readWorkContextRegistry(cwd)).toEqual({
      status: "available",
      value: created.registry
    });
  });
});

function evidence(registry: WorkContextRegistry) {
  const githubSnapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v2",
    appClientId: "client",
    appSlug: "app",
    apiVersion: "2022-11-28",
    fetchedAt: T1,
    user: { id: 1, login: "private-owner" },
    truncated: false,
    activityWindowStart: T0,
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 11,
        fullName: RAW_REPOSITORY,
        private: true,
        archived: false,
        updatedAt: T1
      }
    ],
    tasks: [],
    activities: []
  };
  const codexConfig: StoredCodexConfig = {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: SECRET,
    selectedScopeIds: [SCOPE_A],
    scopes: [
      {
        id: SCOPE_A,
        queryPath: RAW_PATH,
        label: "Private repository",
        sessionCount: 1,
        lastActivityAt: T1
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: T1
  };
  return {
    asOf: AS_OF,
    registry,
    githubSnapshot,
    codexConfig,
    localGitSnapshot: localGitSnapshot()
  };
}

function localGitSnapshot(input?: {
  fetchedAt?: string;
  mappingEligibility?: "exact" | "none" | "conflict";
}) {
  const eligibility = input?.mappingEligibility ?? "exact";
  const fetchedAt = input?.fetchedAt ?? T1;
  const key = createCodexLocalGitGitHubRepositoryKey(
    SECRET,
    RAW_REPOSITORY
  )!;
  return sealCodexLocalGitSnapshot({
    schemaVersion: "codex-local-git-snapshot-v1",
    collectorVersion: "codex-local-git-metadata-v1",
    upstreamBasis: "local_tracking_ref_without_network_refresh",
    fetchedAt,
    scopeIds: [SCOPE_A],
    repositories: [
      {
        ...localGitRepository(
          SCOPE_A,
          eligibility === "exact" ? key : null,
          "1"
        ),
        mappingEligibility: eligibility,
        headCommittedAt: fetchedAt
      }
    ],
    truncated: false
  });
}

function localGitRepository(
  scopeId: string,
  githubRepositoryKey: string | null,
  discriminator: string
) {
  return {
    scopeId,
    repositoryId: `local_repo_${discriminator.repeat(64)}`,
    headCommitId: `local_commit_${discriminator.repeat(64)}`,
    githubRepositoryKey,
    mappingEligibility: githubRepositoryKey === null ? "none" as const : "exact" as const,
    trackingState: "in_sync" as const,
    aheadCount: 0,
    behindCount: 0,
    headCommittedAt: T1,
    unavailableReason: null
  };
}

function registryWithProjects(count: number): WorkContextRegistry {
  let registry = createEmptyWorkContextRegistry(T0);
  for (const projectId of [PROJECT_A, PROJECT_B].slice(0, count)) {
    registry = createProjectIdentity(registry, {
      projectId,
      createdAt: T0
    }).registry;
  }
  return registry;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-repository-scope-proposal-")
  );
  temporaryDirectories.push(directory);
  return directory;
}
