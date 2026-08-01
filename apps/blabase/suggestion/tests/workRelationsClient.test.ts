import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWorkRelations } from "../app/workRelationsClient";
import { sealManagedCodexArtifactRelationProjection } from "../src/artifacts";
import {
  canonicalClaimCoverage,
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  resolveClaimAuthority
} from "../src/claims";
import type { NormalizedWorkClaim } from "../src/claims";
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
import { sealManagedCodexWorkRelationProjection } from "../src/relations";

const AS_OF = "2026-08-01T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work relations client", () => {
  it("reads the relation inspection projection without caching", async () => {
    const projection = readyProjection();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(projection), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWorkRelations()).resolves.toEqual(projection);
    expect(fetchMock).toHaveBeenCalledWith("/api/work-relations", {
      cache: "no-store"
    });
  });

  it("accepts a stale authoritative disagreement resolved by freshness", async () => {
    const projection = readyProjectionWithClaims([
      managedClaim(),
      managedStaleClaim()
    ]);
    expect(projection.claims.conflicts).toMatchObject([
      {
        status: "resolved_by_freshness",
        reasonCode: "STALE_AUTHORITY_VALUE_DISAGREEMENT",
        nextAction: "none"
      }
    ]);
    stubJsonResponse(projection);

    await expect(fetchWorkRelations()).resolves.toEqual(projection);
  });

  it("preserves a sanitized unavailable response for the UI", async () => {
    const unavailable = {
      status: "unavailable" as const,
      message: "Relation inspection is local-only."
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(unavailable), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(fetchWorkRelations()).resolves.toEqual(unavailable);
  });

  it.each([
    { status: "ready-ish" },
    { status: "unavailable", code: 42 },
    { status: "error", message: "x".repeat(501) }
  ])("fails closed for a malformed non-ready response", async (payload) => {
    stubJsonResponse(payload);

    await expect(fetchWorkRelations()).resolves.toEqual({
      status: "error",
      code: "INVALID_WORK_ARTIFACT_PROJECTION",
      message: "생성된 결과 연결 근거를 검증하지 못했습니다."
    });
  });

  it.each([
    ["absent", undefined],
    ["malformed", { relations: [] }]
  ])("fails closed when the nested artifact projection is %s", async (_name, artifacts) => {
    const ready = readyProjection();
    const { artifacts: _artifacts, ...withoutArtifacts } = ready;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...withoutArtifacts,
            ...(artifacts === undefined ? {} : { artifacts })
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    await expect(fetchWorkRelations()).resolves.toEqual({
      status: "error",
      code: "INVALID_WORK_ARTIFACT_PROJECTION",
      message: "생성된 결과 연결 근거를 검증하지 못했습니다."
    });
  });

  it("rejects an artifact projection from a different work-relation revision", async () => {
    const ready = readyProjection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...ready,
            projectionSha256: "9".repeat(64),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_WORK_ARTIFACT_PROJECTION"
    });
  });

  it.each([
    ["absent", undefined],
    ["malformed", { conflicts: [] }]
  ])("fails closed when the nested claim projection is %s", async (_name, claims) => {
    const ready = readyProjection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...ready,
            ...(claims === undefined ? { claims: undefined } : { claims })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(fetchWorkRelations()).resolves.toEqual({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION",
      message: "상태 충돌 판정 근거를 검증하지 못했습니다."
    });
  });

  it("rejects a claim projection from another relation or artifact revision", async () => {
    const ready = readyProjection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...ready,
            claims: {
              ...ready.claims,
              inputs: {
                ...ready.claims.inputs,
                artifactRelationProjectionSha256: "f".repeat(64)
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });

  it("rejects a malformed managed semantic dependency hash", async () => {
    const ready = structuredClone(readyProjection());
    const inputs = ready.claims.inputs as unknown as Record<string, unknown>;
    inputs.managedSemanticProjectionSha256 = "not-a-sha";
    stubJsonResponse(ready);

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });

  it("rejects raw private fields injected into a public claim", async () => {
    const ready = structuredClone(readyProjectionWithClaims([managedClaim()]));
    const claim = ready.claims.claims[0] as unknown as Record<string, unknown>;
    claim.rawPrompt = "private prompt";
    stubJsonResponse(ready);

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });

  it("rejects a claim whose target kind does not match its field", async () => {
    const ready = structuredClone(readyProjectionWithClaims([managedClaim()]));
    const claim = ready.claims.claims[0] as unknown as Record<string, unknown>;
    claim.target = {
      ...(claim.target as Record<string, unknown>),
      kind: "notion_task"
    };
    stubJsonResponse(ready);

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });

  it("rejects a coverage reason assigned to the wrong source", async () => {
    const ready = structuredClone(readyProjection());
    const managedCoverage = ready.claims.sourceCoverage.find(
      (coverage) => coverage.source === "codex_managed"
    );
    expect(managedCoverage).toBeDefined();
    Object.assign(managedCoverage!, {
      reasonCodes: ["GITHUB_DIRECT_FIELDS_EVALUATED"]
    });
    stubJsonResponse(ready);

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });

  it("rejects an incoherent conflict next action", async () => {
    const ready = structuredClone(
      readyProjectionWithClaims([
        managedClaim(),
        inventoryClaim()
      ])
    );
    expect(ready.claims.conflicts).toHaveLength(1);
    Object.assign(ready.claims.conflicts[0]!, {
      nextAction: "user_review"
    });
    stubJsonResponse(ready);

    await expect(fetchWorkRelations()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION"
    });
  });
});

function readyProjection() {
  return readyProjectionWithClaims([]);
}

function readyProjectionWithClaims(claimInputs: NormalizedWorkClaim[]) {
  const workRelations = emptyWorkRelationProjection();
  const artifacts = emptyArtifactProjection(workRelations.projectionSha256);
  const claims = resolveClaimAuthority({
    asOf: AS_OF,
    dependencies: {
      workRelationProjectionSha256: workRelations.projectionSha256,
      artifactRelationProjectionSha256: artifacts.projectionSha256,
      githubBatchSha256: null,
      githubSourceSnapshotSha256: null,
      managedSourceRevision: 0,
      managedGeneratedAt: AS_OF,
      managedSemanticProjectionSha256: "6".repeat(64),
      contextRegistrySha256: null
    },
    sourceCoverage: canonicalClaimCoverage({ github: "unavailable" }),
    claims: claimInputs
  });
  return {
    status: "ready" as const,
    ...workRelations,
    artifacts,
    claims
  };
}

function managedClaim(): NormalizedWorkClaim {
  const target = managedTarget();
  return createNormalizedWorkClaim({
    target,
    lineageRef: createClaimLineageRef({
      source: "codex_managed",
      executionId: "codex:execution:aaaaaaaaaaaaaaaaaaaaaaaa"
    }),
    field: "managed_codex_execution_state",
    value: { type: "enum", value: "running" },
    source: "codex_managed",
    origin: "managed_codex_event_stream",
    freshness: "current",
    completeness: "complete",
    directness: "explicit",
    observedAt: AS_OF,
    sourceUpdatedAt: AS_OF,
    evidenceRefs: [createClaimEvidenceRef({ eventId: "event-managed" })]
  });
}

function inventoryClaim(): NormalizedWorkClaim {
  const target = managedTarget();
  return createNormalizedWorkClaim({
    target,
    lineageRef: createClaimLineageRef({
      source: "codex_inventory",
      executionId: "codex:execution:aaaaaaaaaaaaaaaaaaaaaaaa"
    }),
    field: "managed_codex_execution_state",
    value: { type: "enum", value: "idle" },
    source: "codex_inventory",
    origin: "codex_inventory_snapshot",
    freshness: "current",
    completeness: "unknown",
    directness: "derived",
    observedAt: AS_OF,
    sourceUpdatedAt: AS_OF,
    evidenceRefs: [createClaimEvidenceRef({ eventId: "event-inventory" })]
  });
}

function managedStaleClaim(): NormalizedWorkClaim {
  const target = managedTarget();
  return createNormalizedWorkClaim({
    target,
    lineageRef: createClaimLineageRef({
      source: "codex_managed",
      executionId: "codex:execution:bbbbbbbbbbbbbbbbbbbbbbbb"
    }),
    field: "managed_codex_execution_state",
    value: { type: "enum", value: "idle" },
    source: "codex_managed",
    origin: "managed_codex_event_stream",
    freshness: "stale",
    completeness: "complete",
    directness: "explicit",
    observedAt: "2026-07-31T00:00:00.000Z",
    sourceUpdatedAt: "2026-07-31T00:00:00.000Z",
    evidenceRefs: [createClaimEvidenceRef({ eventId: "event-stale" })]
  });
}

function managedTarget(): NormalizedWorkClaim["target"] {
  return {
    kind: "codex_execution",
    ref: createClaimTargetRef({
      kind: "codex_execution",
      identity: {
        managedRunId: `managed_run_${"a".repeat(32)}`,
        bindingId: `binding_${"b".repeat(32)}`,
        executionId: "codex:execution:aaaaaaaaaaaaaaaaaaaaaaaa"
      }
    })
  };
}

function stubJsonResponse(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    )
  );
}

function emptyWorkRelationProjection() {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: AS_OF,
    managedSourceRevision: 0,
    managedGeneratedAt: AS_OF,
    bindingStoreRevision: 0,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalManagedRunCount: 0,
    omittedManagedRunCount: 0,
    relations: [],
    runResolutions: [],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function emptyArtifactProjection(workRelationProjectionSha256: string) {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: AS_OF,
    workRelationProjectionSha256,
    attributionStoreRevision: 0,
    attributionStoreSha256: "2".repeat(64),
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalAttachDecisionCount: 0,
    unresolvedAttributionCount: 0,
    relations: [],
    inputSha256: "3".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}
