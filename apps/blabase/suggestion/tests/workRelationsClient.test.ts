import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWorkRelations } from "../app/workRelationsClient";
import { sealManagedCodexArtifactRelationProjection } from "../src/artifacts";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION
} from "../src/crossSource/versions";

const AS_OF = "2026-08-01T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work relations client", () => {
  it("reads the relation inspection projection without caching", async () => {
    const projection = {
      status: "ready",
      contract: "managed-codex-work-relation-projection-v0.1",
      asOf: AS_OF,
      projectionSha256: "1".repeat(64),
      relations: [],
      runResolutions: [],
      artifacts: emptyArtifactProjection()
    };
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
    ["absent", undefined],
    ["malformed", { relations: [] }]
  ])("fails closed when the nested artifact projection is %s", async (_name, artifacts) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ready",
            contract: "managed-codex-work-relation-projection-v0.1",
            asOf: AS_OF,
            relations: [],
            runResolutions: [],
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
    const artifacts = emptyArtifactProjection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ready",
            contract: "managed-codex-work-relation-projection-v0.1",
            asOf: AS_OF,
            projectionSha256: "9".repeat(64),
            relations: [],
            runResolutions: [],
            artifacts
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
});

function emptyArtifactProjection() {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: AS_OF,
    workRelationProjectionSha256: "1".repeat(64),
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
