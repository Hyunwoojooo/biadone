import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/connectors/github/localStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/github/localStore")
    >();
  return {
    ...actual,
    readStoredGitHubSnapshot: vi.fn()
  };
});

vi.mock("../src/connectors/github/toWorkSignals", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/github/toWorkSignals")
    >();
  return {
    ...actual,
    normalizeGitHubSnapshotToWorkSignals: vi.fn()
  };
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
  const actual =
    await importOriginal<typeof import("../src/managedCodex")>();
  return {
    ...actual,
    readManagedCodexObservability: vi.fn()
  };
});

vi.mock("../src/artifacts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/artifacts")
  >();
  return {
    ...actual,
    readWorkArtifactAttributionStore: vi.fn(),
    resolveManagedCodexArtifactRelations: vi.fn()
  };
});

vi.mock("../src/claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/claims")>();
  return {
    ...actual,
    resolveCurrentClaimAuthority: vi.fn()
  };
});

vi.mock("../src/relations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/relations")>();
  return {
    ...actual,
    resolveManagedCodexWorkRelations: vi.fn()
  };
});

vi.mock("../src/resumption", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/resumption")>();
  return {
    ...actual,
    readWorkSessionBindingStore: vi.fn(),
    withManagedCodexAuthorityLease: vi.fn()
  };
});

import { GET } from "../app/api/work-relations/route";
import {
  readWorkArtifactAttributionStore,
  resolveManagedCodexArtifactRelations,
  sealManagedCodexArtifactRelationProjection
} from "../src/artifacts";
import {
  canonicalClaimCoverage,
  resolveClaimAuthority,
  resolveCurrentClaimAuthority
} from "../src/claims";
import { readStoredGitHubSnapshot } from "../src/connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import {
  lookupProjectId,
  readWorkContextRegistry
} from "../src/context";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  buildManagedCodexSemanticProjection,
  readManagedCodexObservability
} from "../src/managedCodex";
import {
  resolveManagedCodexWorkRelations,
  sealManagedCodexWorkRelationProjection
} from "../src/relations";
import {
  readWorkSessionBindingStore,
  withManagedCodexAuthorityLease
} from "../src/resumption";

const AS_OF = "2026-08-01T03:00:00.000Z";
const RAW_SENTINEL = "PRIVATE_RELATION_ROUTE_SENTINEL";
const githubSnapshot = { schemaVersion: "github-snapshot-v2" } as never;
const githubBatch = { source: "github" } as RuntimeWorkSignalBatch;
const contextRegistry = {
  registrySha256: "c".repeat(64)
} as never;
const managedProjection = {
  contract: "codex-managed-public-projection-v1",
  revision: 4,
  generatedAt: AS_OF,
  runs: []
} as never;
const managedSemantics = buildManagedCodexSemanticProjection({
  sourceRevision: 4,
  generatedAt: AS_OF,
  runs: []
});
const bindingStore = {
  revision: 2,
  storeSha256: "b".repeat(64)
} as never;
const artifactAttributionStore = {
  revision: 3,
  storeSha256: "a".repeat(64)
} as never;
const projection = sealManagedCodexWorkRelationProjection({
  contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  schemaVersion: WORK_RELATION_SCHEMA_VERSION,
  resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
  asOf: AS_OF,
  managedSourceRevision: 4,
  managedGeneratedAt: AS_OF,
  bindingStoreRevision: 2,
  bindingStoreSha256: "b".repeat(64),
  contextRegistrySha256: "c".repeat(64),
  githubBatchSha256: "d".repeat(64),
  githubSourceSnapshotSha256: "e".repeat(64),
  totalManagedRunCount: 0,
  omittedManagedRunCount: 0,
  relations: [],
  runResolutions: [],
  inputSha256: "f".repeat(64),
  attentionDisposition: "not_connected",
  forbiddenAsAttentionCandidate: true
});
const artifactProjection = sealManagedCodexArtifactRelationProjection({
  contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
  resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  asOf: AS_OF,
  workRelationProjectionSha256: projection.projectionSha256,
  attributionStoreRevision: 3,
  attributionStoreSha256: "a".repeat(64),
  githubBatchSha256: "d".repeat(64),
  githubSourceSnapshotSha256: "e".repeat(64),
  totalAttachDecisionCount: 0,
  unresolvedAttributionCount: 0,
  relations: [],
  inputSha256: "9".repeat(64),
  attentionDisposition: "not_connected",
  forbiddenAsAttentionCandidate: true
});
const claimProjection = resolveClaimAuthority({
  asOf: AS_OF,
  dependencies: {
    workRelationProjectionSha256: projection.projectionSha256,
    artifactRelationProjectionSha256:
      artifactProjection.projectionSha256,
    githubBatchSha256: "d".repeat(64),
    githubSourceSnapshotSha256: "e".repeat(64),
    managedSourceRevision: 4,
    managedGeneratedAt: AS_OF,
    managedSemanticProjectionSha256:
      managedSemantics.projectionSha256,
    contextRegistrySha256: "c".repeat(64)
  },
  sourceCoverage: canonicalClaimCoverage({ github: "evaluated" }),
  claims: []
});

let authorityLeaseActive = false;

beforeEach(() => {
  authorityLeaseActive = false;
  vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AS_OF));
  vi.mocked(readStoredGitHubSnapshot).mockResolvedValue(githubSnapshot);
  vi.mocked(readWorkContextRegistry).mockResolvedValue({
    status: "available",
    value: contextRegistry
  });
  vi.mocked(normalizeGitHubSnapshotToWorkSignals).mockReturnValue({
    status: "normalized",
    batch: githubBatch
  });
  vi.mocked(readManagedCodexObservability).mockResolvedValue({
    projection: managedProjection,
    semantics: managedSemantics
  });
  vi.mocked(readWorkSessionBindingStore).mockResolvedValue(bindingStore);
  vi.mocked(readWorkArtifactAttributionStore).mockImplementation(
    async () => {
      expect(authorityLeaseActive).toBe(true);
      return artifactAttributionStore;
    }
  );
  vi.mocked(resolveManagedCodexWorkRelations).mockReturnValue(projection);
  vi.mocked(resolveManagedCodexArtifactRelations).mockReturnValue(
    artifactProjection
  );
  vi.mocked(resolveCurrentClaimAuthority).mockReturnValue(
    claimProjection
  );
  vi.mocked(withManagedCodexAuthorityLease).mockImplementation(
    async (_cwd, leaseTime, read) => {
      const now =
        typeof leaseTime === "function" ? leaseTime() : leaseTime;
      authorityLeaseActive = true;
      try {
        return await read(
          {
            activeOwnerInstanceId: null,
            activeOwnerships: []
          },
          now
        );
      } finally {
        authorityLeaseActive = false;
      }
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  authorityLeaseActive = false;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("work relations route", () => {
  it("returns a separate local no-store relation projection", async () => {
    vi.mocked(lookupProjectId).mockReturnValue(
      `project_${"1".repeat(32)}`
    );

    const response = await GET(
      new Request("http://localhost:3102/api/work-relations")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "ready",
      ...projection,
      artifacts: artifactProjection,
      claims: claimProjection
    });
    expect(withManagedCodexAuthorityLease).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(Function),
      expect.any(Function)
    );
    expect(readManagedCodexObservability).toHaveBeenCalledWith(
      {
        activeOwnerInstanceId: null,
        activeOwnerships: [],
        now: new Date(AS_OF)
      },
      process.cwd()
    );
    expect(readWorkSessionBindingStore).toHaveBeenCalledWith(
      process.cwd(),
      AS_OF
    );
    expect(readWorkArtifactAttributionStore).toHaveBeenCalledWith(
      process.cwd(),
      new Date(AS_OF)
    );
    expect(resolveManagedCodexWorkRelations).toHaveBeenCalledWith({
      asOf: AS_OF,
      managedProjection,
      bindingStore,
      githubBatch,
      contextRegistry
    });
    expect(resolveManagedCodexArtifactRelations).toHaveBeenCalledWith({
      asOf: AS_OF,
      workRelationProjection: projection,
      attributionStore: artifactAttributionStore,
      githubBatch
    });
    expect(resolveCurrentClaimAuthority).toHaveBeenCalledWith({
      asOf: AS_OF,
      managedProjection,
      managedSemantics,
      workRelationProjection: projection,
      artifactRelationProjection: artifactProjection,
      githubBatch,
      contextRegistry
    });

    const normalizationOptions = vi.mocked(
      normalizeGitHubSnapshotToWorkSignals
    ).mock.calls[0]?.[1];
    expect(normalizationOptions?.contextRegistrySha256).toBe(
      "c".repeat(64)
    );
    expect(
      normalizationOptions?.resolveProjectId?.("repository:101")
    ).toBe(`project_${"1".repeat(32)}`);
    expect(lookupProjectId).toHaveBeenCalledWith(contextRegistry, {
      source: "github",
      resourceType: "repository",
      opaqueId: "101"
    });
    expect(
      normalizationOptions?.resolveProjectId?.("unsafe:101")
    ).toBeNull();
  });

  it("passes an unavailable GitHub batch without inventing an observation", async () => {
    vi.mocked(readStoredGitHubSnapshot).mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost:3102/api/work-relations")
    );

    expect(response.status).toBe(200);
    expect(normalizeGitHubSnapshotToWorkSignals).not.toHaveBeenCalled();
    expect(resolveManagedCodexWorkRelations).toHaveBeenCalledWith(
      expect.objectContaining({ githubBatch: null })
    );
    expect(resolveManagedCodexArtifactRelations).toHaveBeenCalledWith(
      expect.objectContaining({ githubBatch: null })
    );
    expect(resolveCurrentClaimAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ githubBatch: null })
    );
  });

  it("rejects remote and cross-origin reads before touching private state", async () => {
    const crossOrigin = await GET(
      new Request("http://localhost:3102/api/work-relations", {
        headers: { origin: "https://evil.example" }
      })
    );
    const remote = await GET(
      new Request("https://blabase.example/api/work-relations")
    );

    expect(crossOrigin.status).toBe(403);
    expect(remote.status).toBe(404);
    expect(readStoredGitHubSnapshot).not.toHaveBeenCalled();
    expect(readWorkContextRegistry).not.toHaveBeenCalled();
    expect(withManagedCodexAuthorityLease).not.toHaveBeenCalled();
    expect(readWorkArtifactAttributionStore).not.toHaveBeenCalled();
  });

  it("sanitizes resolver failures and never exposes private source details", async () => {
    vi.mocked(resolveManagedCodexWorkRelations).mockImplementationOnce(
      () => {
        throw new Error(`${RAW_SENTINEL}: /private/codex/scope`);
      }
    );

    const response = await GET(
      new Request("http://localhost:3102/api/work-relations")
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "error",
      code: "WORK_RELATIONS_READ_FAILED",
      message: "작업 연결 근거를 확인하지 못했습니다."
    });
    expect(serialized).not.toContain(RAW_SENTINEL);
    expect(serialized).not.toContain("/private/codex/scope");
  });

  it("fails closed when the nested artifact projection does not pass its authoritative schema", async () => {
    vi.mocked(resolveManagedCodexArtifactRelations).mockReturnValueOnce({
      ...artifactProjection,
      projectionSha256: "0".repeat(64)
    });

    const response = await GET(
      new Request("http://localhost:3102/api/work-relations")
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "WORK_RELATIONS_READ_FAILED",
      message: "작업 연결 근거를 확인하지 못했습니다."
    });
  });

  it("fails closed when the nested claim projection does not pass its authoritative schema", async () => {
    vi.mocked(resolveCurrentClaimAuthority).mockReturnValueOnce({
      ...claimProjection,
      projectionSha256: "0".repeat(64)
    });

    const response = await GET(
      new Request("http://localhost:3102/api/work-relations")
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "WORK_RELATIONS_READ_FAILED",
      message: "작업 연결 근거를 확인하지 못했습니다."
    });
  });
});
