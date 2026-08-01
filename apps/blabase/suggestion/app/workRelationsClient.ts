import type { ManagedCodexArtifactRelationProjection } from "../src/artifacts/contracts";
import type { ManagedCodexWorkRelationProjection } from "../src/relations";

export type WorkRelationsReadyResponse =
  ManagedCodexWorkRelationProjection & {
    status: "ready";
    artifacts: ManagedCodexArtifactRelationProjection;
  };

export type WorkRelationsUnavailableResponse = {
  status: "error" | "unavailable";
  code?: string;
  message?: string;
};

export type WorkRelationsApiResponse =
  | WorkRelationsReadyResponse
  | WorkRelationsUnavailableResponse;

export async function fetchWorkRelations(): Promise<WorkRelationsApiResponse> {
  const response = await fetch("/api/work-relations", {
    cache: "no-store"
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    return invalidProjectionResponse();
  }
  if (payload.status !== "ready") {
    return payload as WorkRelationsUnavailableResponse;
  }
  if (!isManagedArtifactProjection(payload.artifacts)) {
    return invalidProjectionResponse();
  }
  if (
    typeof payload.projectionSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.projectionSha256) ||
    payload.artifacts.workRelationProjectionSha256 !==
      payload.projectionSha256
  ) {
    return invalidProjectionResponse();
  }
  return {
    ...payload,
    artifacts: payload.artifacts
  } as WorkRelationsReadyResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidProjectionResponse(): WorkRelationsUnavailableResponse {
  return {
    status: "error",
    code: "INVALID_WORK_ARTIFACT_PROJECTION",
    message: "생성된 결과 연결 근거를 검증하지 못했습니다."
  };
}

// The authoritative Zod contract also seals hashes with node:crypto and is
// therefore server-only. The API validates that full contract before sending
// it; this client-safe guard validates every field that can reach the UI.
function isManagedArtifactProjection(
  value: unknown
): value is ManagedCodexArtifactRelationProjection {
  if (
    !isRecord(value) ||
    value.contract !==
      "managed-codex-artifact-relation-projection-v0.1" ||
    typeof value.workRelationProjectionSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.workRelationProjectionSha256) ||
    !Array.isArray(value.relations) ||
    value.relations.length > 1_000 ||
    value.attentionDisposition !== "not_connected" ||
    value.forbiddenAsAttentionCandidate !== true
  ) {
    return false;
  }
  return value.relations.every(isManagedArtifactRelation);
}

function isManagedArtifactRelation(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.attributionLifecycle)) {
    return false;
  }
  const lifecycle = value.attributionLifecycle;
  const lifecycleState = String(lifecycle.state);
  const hasValidSuccessor = isNullablePattern(
    lifecycle.supersededByAttributionId,
    /^attribution_[a-f0-9]{32}$/
  );
  if (
    ![
      "active",
      "superseded_by_detach",
      "superseded_by_reattribution"
    ].includes(lifecycleState) ||
    !hasValidSuccessor ||
    ((lifecycleState === "active") !==
      (lifecycle.supersededByAttributionId === null)) ||
    !isRecord(value.artifact) ||
    !isRecord(value.githubObservation)
  ) {
    return false;
  }
  const artifact = value.artifact;
  const validArtifact =
    (artifact.kind === "github_commit" &&
      isPositiveSafeInteger(artifact.repositoryId) &&
      typeof artifact.oid === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(artifact.oid)) ||
    (artifact.kind === "github_pull_request" &&
      isPositiveSafeInteger(artifact.repositoryId) &&
      isPositiveSafeInteger(artifact.objectId) &&
      isPositiveSafeInteger(artifact.number));
  return (
    validArtifact &&
    typeof value.relationId === "string" &&
    /^artifact_relation_[a-f0-9]{32}$/.test(value.relationId) &&
    typeof value.managedRunId === "string" &&
    /^managed_run_[a-f0-9]{32}$/.test(value.managedRunId) &&
    typeof value.bindingId === "string" &&
    /^binding_[a-f0-9]{32}$/.test(value.bindingId) &&
    typeof value.executionId === "string" &&
    /^codex:execution:[a-f0-9]{24}$/.test(value.executionId) &&
    typeof value.executesRelationId === "string" &&
    /^relation_[a-f0-9]{32}$/.test(value.executesRelationId) &&
    typeof value.attributionId === "string" &&
    /^attribution_[a-f0-9]{32}$/.test(value.attributionId) &&
    value.type === "produces" &&
    value.authority === "user_configured" &&
    [
      "current",
      "stale",
      "not_observed",
      "unavailable",
      "conflict"
    ].includes(String(value.githubObservation.status)) &&
    value.attentionDisposition === "not_connected" &&
    value.forbiddenAsAttentionCandidate === true
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNullablePattern(
  value: unknown,
  pattern: RegExp
): value is string | null {
  return value === null || (typeof value === "string" && pattern.test(value));
}
