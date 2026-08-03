import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/workEvidence", () => ({
  readCurrentWorkEvidence: vi.fn()
}));

vi.mock("../src/eligibility", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/eligibility")>();
  return {
    ...actual,
    resolveAttentionEligibilityShadow: vi.fn()
  };
});

import { GET } from "../app/api/attention/eligibility/route";
import {
  attentionEligibilityInputSha256,
  resolveAttentionEligibilityShadow,
  sealAttentionEligibilityShadowProjection,
  type AttentionEligibilityDependencies
} from "../src/eligibility";
import {
  readCurrentWorkEvidence,
  type CurrentWorkEvidence
} from "../src/workEvidence";

const AS_OF = "2026-08-02T03:00:00.000Z";
const RAW_SENTINEL = "PRIVATE_ELIGIBILITY_ROUTE_SENTINEL";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AS_OF));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("attention eligibility route", () => {
  it("returns a local no-store shadow projection", async () => {
    const evidence = currentEvidenceFixture();
    const projection = emptyProjection();
    vi.mocked(readCurrentWorkEvidence).mockResolvedValue(evidence);
    vi.mocked(resolveAttentionEligibilityShadow).mockReturnValue(
      projection
    );

    const response = await GET(
      new Request("http://localhost:3102/api/attention/eligibility")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      projection
    });
    expect(readCurrentWorkEvidence).toHaveBeenCalledWith({
      now: new Date(AS_OF)
    });
    expect(resolveAttentionEligibilityShadow).toHaveBeenCalledWith({
      asOf: AS_OF,
      githubBatch: evidence.githubBatch,
      workRelationProjection: evidence.workRelations,
      artifactRelationProjection: evidence.artifacts,
      claimAuthorityProjection: evidence.claims
    });
  });

  it("rejects remote and cross-origin reads before loading evidence", async () => {
    const remote = await GET(
      new Request("https://app.example/api/attention/eligibility")
    );
    const crossOrigin = await GET(
      new Request("http://localhost:3102/api/attention/eligibility", {
        headers: { origin: "https://attacker.example" }
      })
    );

    expect(remote.status).toBe(404);
    expect(crossOrigin.status).toBe(403);
    expect(remote.headers.get("cache-control")).toBe("no-store");
    expect(crossOrigin.headers.get("cache-control")).toBe("no-store");
    expect(readCurrentWorkEvidence).not.toHaveBeenCalled();
    expect(resolveAttentionEligibilityShadow).not.toHaveBeenCalled();
  });

  it("sanitizes evidence failures without exposing private details", async () => {
    vi.mocked(readCurrentWorkEvidence).mockRejectedValueOnce(
      new Error(`${RAW_SENTINEL}: /private/local/evidence.json`)
    );

    const response = await GET(
      new Request("http://127.0.0.1:3102/api/attention/eligibility")
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "error",
      code: "ATTENTION_ELIGIBILITY_READ_FAILED",
      message: "후보 eligibility 근거를 확인하지 못했습니다."
    });
    expect(JSON.stringify(body)).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(body)).not.toContain("/private/local");
    expect(resolveAttentionEligibilityShadow).not.toHaveBeenCalled();
  });
});

function currentEvidenceFixture(): CurrentWorkEvidence {
  return {
    asOf: AS_OF,
    githubBatch: null,
    managedProjection: {} as never,
    managedSemantics: {} as never,
    managedRunStartedAtById: {},
    workRelations: { projectionSha256: "1".repeat(64) } as never,
    artifacts: { projectionSha256: "2".repeat(64) } as never,
    claims: { projectionSha256: "3".repeat(64) } as never,
    contextRegistry: null
  };
}

function emptyProjection() {
  const dependencies = dependenciesFixture();
  return sealAttentionEligibilityShadowProjection({
    contract: "attention-eligibility-shadow-projection-v0.1",
    candidateSeedSchemaVersion: "attention-candidate-seed-v0.1",
    policyVersion: "hard-attention-eligibility-policy-v0.1",
    evidencePolicyVersion: "attention-eligibility-evidence-v0.1",
    resolverVersion: "attention-eligibility-resolver-v0.1",
    idPolicyVersion: "attention-eligibility-id-v0.1",
    mode: "shadow",
    asOf: AS_OF,
    dependencies,
    coverage: {
      candidateUniverse: "github_work_items_only",
      githubCandidateCoverage: "unavailable",
      codexManagedEligibility: "not_evaluated_phase_4a",
      totalGitHubWorkItemSignalCount: 0,
      candidateSeedCount: 0,
      unrelatedUnresolvedCriticalConflictCount: 0
    },
    counts: { eligible: 0, reviewRequired: 0, ineligible: 0 },
    assessments: [],
    inputSha256: attentionEligibilityInputSha256({
      asOf: AS_OF,
      dependencies,
      candidateSeedIds: []
    }),
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

function dependenciesFixture(): AttentionEligibilityDependencies {
  return {
    workRelationProjectionSha256: "1".repeat(64),
    artifactRelationProjectionSha256: "2".repeat(64),
    claimAuthorityProjectionSha256: "3".repeat(64),
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    managedSourceRevision: 0,
    managedGeneratedAt: AS_OF,
    managedSemanticProjectionSha256: "4".repeat(64),
    contextRegistrySha256: null
  };
}
