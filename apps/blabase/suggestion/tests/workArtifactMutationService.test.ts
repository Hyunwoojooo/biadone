import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/connectors/github/localStore", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/connectors/github/localStore")
  >();
  return { ...actual, readStoredGitHubSnapshot: vi.fn() };
});

vi.mock("../src/connectors/github/toWorkSignals", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/connectors/github/toWorkSignals")
  >();
  return { ...actual, normalizeGitHubSnapshotToWorkSignals: vi.fn() };
});

vi.mock("../src/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/context")>();
  return {
    ...actual,
    lookupProjectId: vi.fn(),
    readWorkContextRegistry: vi.fn()
  };
});

vi.mock("../src/managedCodex", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/managedCodex")
  >();
  return { ...actual, readManagedCodexPublicProjection: vi.fn() };
});

vi.mock("../src/relations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/relations")>();
  return { ...actual, resolveManagedCodexWorkRelations: vi.fn() };
});

vi.mock("../src/resumption", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/resumption")
  >();
  return {
    ...actual,
    readWorkSessionBindingStore: vi.fn(),
    withManagedCodexAuthorityLease: vi.fn(),
    withWorkResumptionStateLease: vi.fn()
  };
});

vi.mock("../src/artifacts/attributionStore", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/artifacts/attributionStore")
  >();
  return {
    ...actual,
    readWorkArtifactAttributionStore: vi.fn(),
    writeWorkArtifactAttributionStore: vi.fn()
  };
});

import {
  createEmptyWorkArtifactAttributionStore,
  attachStoredWorkArtifact,
  attachWorkArtifactAttribution,
  detachStoredWorkArtifact,
  readWorkArtifactAttributionStore,
  writeWorkArtifactAttributionStore
} from "../src/artifacts";
import { readStoredGitHubSnapshot } from "../src/connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import { readWorkContextRegistry } from "../src/context";
import {
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import { readManagedCodexPublicProjection } from "../src/managedCodex";
import {
  resolveManagedCodexWorkRelations,
  sealManagedCodexWorkRelationProjection
} from "../src/relations";
import {
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease,
  withWorkResumptionStateLease
} from "../src/resumption";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const RUN = `managed_run_${"1".repeat(32)}`;
const BINDING = `binding_${"2".repeat(32)}`;
const EXECUTION = `codex:execution:${"3".repeat(24)}`;
const RELATION = `relation_${"4".repeat(32)}`;
const RAW_URL =
  `https://github.com/private-owner/private-repository/commit/${"a".repeat(40)}`;

beforeEach(() => {
  vi.mocked(readStoredGitHubSnapshot).mockResolvedValue(githubSnapshot());
  vi.mocked(readWorkContextRegistry).mockResolvedValue({
    status: "missing"
  });
  vi.mocked(normalizeGitHubSnapshotToWorkSignals).mockReturnValue({
    status: "normalized",
    batch: { source: "github" } as never
  });
  vi.mocked(readManagedCodexPublicProjection).mockResolvedValue({
    runs: []
  } as never);
  vi.mocked(readWorkSessionBindingStore).mockResolvedValue({
    decisions: []
  } as never);
  vi.mocked(resolveManagedCodexWorkRelations).mockReturnValue(
    workProjection()
  );
  vi.mocked(readWorkArtifactAttributionStore).mockResolvedValue(
    createEmptyWorkArtifactAttributionStore(NOW.toISOString())
  );
  vi.mocked(writeWorkArtifactAttributionStore).mockResolvedValue();
  vi.mocked(withManagedCodexAuthorityLease).mockImplementation(
    async (_cwd, leaseTime, callback) => {
      const now =
        typeof leaseTime === "function" ? leaseTime() : leaseTime;
      return callback(
        { activeOwnerInstanceId: null, activeOwnerships: [] },
        now
      );
    }
  );
  vi.mocked(withWorkResumptionStateLease).mockImplementation(
    async (_cwd, callback) => callback()
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("work artifact mutation service", () => {
  it("validates transient URL identity and persists only a native tuple under the authority lease", async () => {
    const decision = await attachStoredWorkArtifact(
      {
        managedRunId: RUN,
        bindingId: BINDING,
        executionId: EXECUTION,
        artifactUrl: RAW_URL,
        explicitUserConfirmation: true
      },
      process.cwd(),
      () => NOW
    );

    expect(decision).toMatchObject({
      action: "attach",
      managedRunId: RUN,
      bindingId: BINDING,
      executionId: EXECUTION,
      executesRelationId: RELATION,
      artifact: {
        kind: "github_commit",
        repositoryId: 101,
        oid: "a".repeat(40)
      },
      decisionSource: "explicit_user"
    });
    expect(withManagedCodexAuthorityLease).toHaveBeenCalledOnce();
    expect(
      vi.mocked(withManagedCodexAuthorityLease).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(readStoredGitHubSnapshot).mock
        .invocationCallOrder[0]!
    );
    expect(writeWorkArtifactAttributionStore).toHaveBeenCalledOnce();
    const persisted = vi.mocked(writeWorkArtifactAttributionStore).mock
      .calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain(RAW_URL);
    expect(JSON.stringify(persisted)).not.toContain("private-owner");
    expect(JSON.stringify(persisted)).not.toContain(
      "private-repository"
    );
  });

  it("rejects a stale UI identity before writing the append-only store", async () => {
    await expect(
      attachStoredWorkArtifact(
        {
          managedRunId: RUN,
          bindingId: `binding_${"9".repeat(32)}`,
          executionId: EXECUTION,
          artifactUrl: RAW_URL,
          explicitUserConfirmation: true
        },
        process.cwd(),
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "MANAGED_RUN_RELATION_MISMATCH"
    });
    expect(writeWorkArtifactAttributionStore).not.toHaveBeenCalled();
  });

  it("serializes detach with disconnect and preserves the historical attach", async () => {
    const attached = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(NOW.toISOString()),
      {
        managedRunId: RUN,
        bindingId: BINDING,
        executionId: EXECUTION,
        executesRelationId: RELATION,
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "a".repeat(40)
        },
        attachedAt: NOW.toISOString(),
        explicitUserConfirmation: true
      }
    );
    vi.mocked(readWorkArtifactAttributionStore).mockResolvedValueOnce(
      attached.store
    );

    const detached = await detachStoredWorkArtifact(
      {
        attributionId: attached.decision.attributionId,
        explicitUserConfirmation: true
      },
      process.cwd(),
      () => new Date(NOW.getTime() + 1_000)
    );

    expect(withWorkResumptionStateLease).toHaveBeenCalledOnce();
    expect(detached).toMatchObject({
      action: "detach",
      supersedesAttributionId: attached.decision.attributionId
    });
    const persisted = vi.mocked(writeWorkArtifactAttributionStore).mock
      .calls[0]?.[0];
    expect(persisted?.decisions).toHaveLength(2);
  });

  it("rejects unavailable GitHub identity inside the managed authority lease", async () => {
    vi.mocked(readStoredGitHubSnapshot).mockResolvedValueOnce(null);

    await expect(
      attachStoredWorkArtifact(
        {
          managedRunId: RUN,
          bindingId: BINDING,
          executionId: EXECUTION,
          artifactUrl: RAW_URL,
          explicitUserConfirmation: true
        },
        process.cwd(),
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "GITHUB_ARTIFACT_SOURCE_UNAVAILABLE"
    });
    expect(withManagedCodexAuthorityLease).toHaveBeenCalledOnce();
    expect(writeWorkArtifactAttributionStore).not.toHaveBeenCalled();
  });
});

function workProjection() {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion:
      MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: NOW.toISOString(),
    managedSourceRevision: 1,
    managedGeneratedAt: NOW.toISOString(),
    bindingStoreRevision: 1,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalManagedRunCount: 1,
    omittedManagedRunCount: 0,
    relations: [
      {
        relationId: RELATION,
        managedRunIds: [RUN],
        bindingId: BINDING,
        type: "executes",
        authority: "user_configured",
        from: {
          kind: "execution",
          source: "codex",
          subjectId: EXECUTION
        },
        to: {
          kind: "work_item",
          source: "github",
          subjectId: "github:object:9001"
        },
        bindingEvidence: {
          bindingId: BINDING,
          boundAt: NOW.toISOString(),
          decisionSource: "explicit_user",
          bindingState: "active",
          supersededByBindingId: null
        },
        githubObservation: {
          status: "unavailable",
          sourceSnapshotSha256: null,
          signalIds: [],
          objectType: null,
          taskKind: null,
          number: null,
          destinationUrl: null,
          sourceUpdatedAt: null,
          completeness: null
        },
        projectAlignment: {
          status: "unavailable",
          projectId: null,
          codexMappingDecisionId: null,
          githubMappingDecisionId: null
        },
        identityStatus: "resolved",
        conflictCodes: [],
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      }
    ],
    runResolutions: [
      {
        managedRunId: RUN,
        bindingId: BINDING,
        executionId: EXECUTION,
        status: "resolved",
        relationId: RELATION
      }
    ],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function githubSnapshot(): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "client",
    appSlug: "test",
    apiVersion: "2026-03-10",
    fetchedAt: NOW.toISOString(),
    user: { id: 1, login: "maker" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 10,
        fullName: "private-owner/private-repository",
        private: true,
        archived: false,
        updatedAt: NOW.toISOString()
      }
    ],
    tasks: [],
    activities: []
  };
}
