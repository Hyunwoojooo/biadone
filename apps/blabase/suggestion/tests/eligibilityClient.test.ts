import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAttentionEligibility } from "../app/eligibilityClient";
import {
  attentionEligibilityInputSha256,
  sealAttentionEligibilityShadowProjection,
  type AttentionEligibilityDependencies,
  type AttentionEligibilityShadowProjection
} from "../src/eligibility";

const AS_OF = "2026-08-02T03:00:00.000Z";
const INVALID_RESPONSE = {
  status: "error",
  code: "INVALID_ATTENTION_ELIGIBILITY_PROJECTION",
  message: "Eligibility shadow 결과를 검증하지 못했습니다."
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attention eligibility client", () => {
  it("reads a sealed shadow projection without caching", async () => {
    const projection = emptyProjection();
    const fetchMock = stubJsonResponse({ status: "ready", projection });

    await expect(fetchAttentionEligibility()).resolves.toEqual({
      status: "ready",
      projection
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/attention/eligibility",
      { cache: "no-store" }
    );
  });

  it("fails closed for a malformed projection", async () => {
    const projection = {
      ...emptyProjection(),
      projectionSha256: "not-a-sha"
    };
    stubJsonResponse({ status: "ready", projection });

    await expect(fetchAttentionEligibility()).resolves.toEqual(
      INVALID_RESPONSE
    );
  });

  it("rejects raw private fields injected into the projection", async () => {
    const projection = {
      ...emptyProjection(),
      rawPrompt: "PRIVATE RAW PROMPT"
    };
    stubJsonResponse({ status: "ready", projection });

    await expect(fetchAttentionEligibility()).resolves.toEqual(
      INVALID_RESPONSE
    );
  });

  it("rejects count tampering even when the field shape is valid", async () => {
    const sealed = emptyProjection();
    const projection = {
      ...sealed,
      counts: { ...sealed.counts, eligible: 1 }
    };
    stubJsonResponse({ status: "ready", projection });

    await expect(fetchAttentionEligibility()).resolves.toEqual(
      INVALID_RESPONSE
    );
  });
});

function emptyProjection(): AttentionEligibilityShadowProjection {
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

function stubJsonResponse(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
