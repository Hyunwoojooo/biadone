import type { ManagedCodexArtifactRelationProjection } from "../src/artifacts/contracts";
import type { ClaimAuthorityProjection } from "../src/claims/contracts";
import type { ManagedCodexWorkRelationProjection } from "../src/relations";

export type WorkRelationsReadyResponse =
  ManagedCodexWorkRelationProjection & {
    status: "ready";
    artifacts: ManagedCodexArtifactRelationProjection;
    claims: ClaimAuthorityProjection;
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
    if (
      !["error", "unavailable"].includes(String(payload.status)) ||
      (payload.code !== undefined &&
        (typeof payload.code !== "string" || payload.code.length > 120)) ||
      (payload.message !== undefined &&
        (typeof payload.message !== "string" ||
          payload.message.length > 500))
    ) {
      return invalidProjectionResponse();
    }
    return {
      status: payload.status as "error" | "unavailable",
      ...(typeof payload.code === "string" ? { code: payload.code } : {}),
      ...(typeof payload.message === "string"
        ? { message: payload.message }
        : {})
    };
  }
  if (!isManagedWorkRelationProjection(payload)) {
    return {
      status: "error",
      code: "INVALID_WORK_RELATION_PROJECTION",
      message: "작업 연결 근거를 검증하지 못했습니다."
    };
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
  if (!isClaimAuthorityProjection(payload.claims, payload)) {
    return {
      status: "error",
      code: "INVALID_CLAIM_AUTHORITY_PROJECTION",
      message: "상태 충돌 판정 근거를 검증하지 못했습니다."
    };
  }
  return {
    ...payload,
    artifacts: payload.artifacts,
    claims: payload.claims
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

function isManagedWorkRelationProjection(
  value: Record<string, unknown>
): value is Record<string, unknown> & ManagedCodexWorkRelationProjection {
  return (
    value.contract === "managed-codex-work-relation-projection-v0.1" &&
    value.schemaVersion === "work-relation-schema-v0.1" &&
    value.resolverVersion ===
      "managed-codex-explicit-binding-resolver-v0.1" &&
    value.evidencePolicyVersion ===
      "explicit-binding-native-id-evidence-v0.1" &&
    isTimestamp(value.asOf) &&
    Number.isSafeInteger(value.managedSourceRevision) &&
    Number(value.managedSourceRevision) >= 0 &&
    isTimestamp(value.managedGeneratedAt) &&
    Date.parse(value.managedGeneratedAt) <= Date.parse(value.asOf) &&
    isSha256(value.inputSha256) &&
    typeof value.projectionSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.projectionSha256) &&
    Array.isArray(value.relations) &&
    value.relations.length <= 100 &&
    value.relations.every(isManagedWorkRelation) &&
    Array.isArray(value.runResolutions) &&
    value.runResolutions.length <= 100 &&
    value.runResolutions.every(isManagedRunResolution) &&
    value.attentionDisposition === "not_connected" &&
    value.forbiddenAsAttentionCandidate === true
  );
}

function isManagedWorkRelation(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.relationId !== "string" ||
    !/^relation_[a-f0-9]{32}$/.test(value.relationId) ||
    typeof value.bindingId !== "string" ||
    !/^binding_[a-f0-9]{32}$/.test(value.bindingId) ||
    !isRecord(value.from) ||
    !isRecord(value.to) ||
    !isRecord(value.bindingEvidence) ||
    !isRecord(value.githubObservation) ||
    !isRecord(value.projectAlignment)
  ) {
    return false;
  }
  return (
    value.type === "executes" &&
    value.authority === "user_configured" &&
    value.from.kind === "execution" &&
    value.from.source === "codex" &&
    typeof value.from.subjectId === "string" &&
    /^codex:execution:[a-f0-9]{24}$/.test(value.from.subjectId) &&
    value.to.kind === "work_item" &&
    value.to.source === "github" &&
    typeof value.to.subjectId === "string" &&
    /^github:object:[1-9][0-9]*$/.test(value.to.subjectId) &&
    value.attentionDisposition === "not_connected" &&
    value.forbiddenAsAttentionCandidate === true
  );
}

function isManagedRunResolution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const status = String(value.status);
  return (
    typeof value.managedRunId === "string" &&
    /^managed_run_[a-f0-9]{32}$/.test(value.managedRunId) &&
    typeof value.bindingId === "string" &&
    /^binding_[a-f0-9]{32}$/.test(value.bindingId) &&
    typeof value.executionId === "string" &&
    /^codex:execution:[a-f0-9]{24}$/.test(value.executionId) &&
    [
      "resolved",
      "binding_not_found",
      "binding_not_bind",
      "execution_mismatch",
      "unsupported_task_source",
      "invalid_github_subject"
    ].includes(status) &&
    isNullablePattern(value.relationId, /^relation_[a-f0-9]{32}$/) &&
    ((status === "resolved") === (value.relationId !== null))
  );
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
    !isSha256(value.projectionSha256) ||
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

const CLAIM_FIELDS = new Set([
  "github_native_identity",
  "github_work_item_state",
  "github_user_relationship",
  "github_milestone_due_at",
  "managed_codex_execution_state",
  "project_alignment_identity",
  "notion_task_state",
  "notion_internal_priority",
  "calendar_event_state",
  "calendar_event_time",
  "user_disposition"
]);
const CLAIM_SOURCES = new Set([
  "github",
  "codex_managed",
  "codex_inventory",
  "notion",
  "google_calendar",
  "explicit_user"
]);
const CLAIM_TARGET_KINDS = new Set([
  "github_work_item",
  "codex_execution",
  "project_relation",
  "notion_task",
  "calendar_event",
  "user_work_item"
]);
const CLAIM_ENUM_VALUES = new Set([
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "assigned_to_user",
  "review_requested_from_user",
  "authored_by_user",
  "running",
  "idle",
  "failed",
  "interrupted",
  "low",
  "medium",
  "high",
  "urgent",
  "confirmed",
  "tentative",
  "active",
  "incorrect",
  "not_now"
]);
const CLAIM_COVERAGE_REASONS = new Set([
  "GITHUB_DIRECT_FIELDS_EVALUATED",
  "GITHUB_SNAPSHOT_STALE",
  "GITHUB_SNAPSHOT_PARTIAL",
  "GITHUB_SNAPSHOT_UNAVAILABLE",
  "MANAGED_CODEX_DIRECT_EVENTS_EVALUATED",
  "CODEX_INVENTORY_NOT_LIVE",
  "NOTION_TASK_PROPERTIES_UNAVAILABLE",
  "NOTION_CONFIGURED_TASK_FIELDS_EVALUATED",
  "CALENDAR_WORK_EQUIVALENCE_UNAVAILABLE",
  "CALENDAR_NATIVE_EVENT_FIELDS_EVALUATED",
  "EXPLICIT_PROJECT_MAPPING_EVALUATED",
  "EXPLICIT_USER_FEEDBACK_EVALUATED"
]);
const CLAIM_RESOLUTION_REASONS = new Set([
  "AUTHORITATIVE_CLAIM_SELECTED",
  "CONSISTENT_AUTHORITATIVE_CLAIMS",
  "NEWER_SAME_LINEAGE_SELECTED",
  "LOWER_AUTHORITY_DISAGREEMENT",
  "EQUAL_AUTHORITY_CONFLICT",
  "AUTHORITATIVE_CLAIM_STALE",
  "AUTHORITATIVE_CLAIM_MISSING",
  "MINIMUM_CORROBORATION_MISSING",
  "PARTIAL_EVIDENCE",
  "CONTEXT_ONLY_EVIDENCE"
]);
const CLAIM_CONFLICT_REASONS = new Set([
  "LOWER_AUTHORITY_VALUE_DISAGREEMENT",
  "OLDER_LINEAGE_VALUE_DISAGREEMENT",
  "EQUAL_AUTHORITY_VALUE_DISAGREEMENT",
  "STALE_AUTHORITY_VALUE_DISAGREEMENT"
]);

function isClaimAuthorityProjection(
  value: unknown,
  workProjection: Record<string, unknown>
): value is ClaimAuthorityProjection {
  const artifactProjection = isRecord(workProjection.artifacts)
    ? workProjection.artifacts
    : null;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "contract",
      "schemaVersion",
      "conflictSchemaVersion",
      "resolverVersion",
      "authorityPolicyVersion",
      "evidencePolicyVersion",
      "asOf",
      "inputs",
      "sourceCoverage",
      "totalInputClaimCount",
      "deduplicatedClaimCount",
      "claims",
      "fieldResolutions",
      "conflicts",
      "unresolvedCriticalConflictCount",
      "inputSha256",
      "attentionDisposition",
      "forbiddenAsAttentionCandidate",
      "projectionSha256"
    ]) ||
    value.contract !== "claim-authority-projection-v0.1" ||
    value.schemaVersion !== "work-claim-schema-v0.1" ||
    value.conflictSchemaVersion !== "claim-conflict-schema-v0.1" ||
    value.resolverVersion !== "cross-source-claim-resolver-v0.2" ||
    value.authorityPolicyVersion !==
      "field-claim-authority-policy-v0.1" ||
    value.evidencePolicyVersion !==
      "direct-source-claim-evidence-v0.1" ||
    !isTimestamp(value.asOf) ||
    value.asOf !== workProjection.asOf ||
    !isSha256(value.projectionSha256) ||
    !isSha256(value.inputSha256) ||
    !isRecord(value.inputs) ||
    !hasOnlyKeys(value.inputs, [
      "workRelationProjectionSha256",
      "artifactRelationProjectionSha256",
      "githubBatchSha256",
      "githubSourceSnapshotSha256",
      "managedSourceRevision",
      "managedGeneratedAt",
      "managedSemanticProjectionSha256",
      "contextRegistrySha256"
    ]) ||
    value.inputs.workRelationProjectionSha256 !==
      workProjection.projectionSha256 ||
    value.inputs.artifactRelationProjectionSha256 !==
      artifactProjection?.projectionSha256 ||
    value.inputs.githubBatchSha256 !== workProjection.githubBatchSha256 ||
    value.inputs.githubSourceSnapshotSha256 !==
      workProjection.githubSourceSnapshotSha256 ||
    value.inputs.contextRegistrySha256 !==
      workProjection.contextRegistrySha256 ||
    value.inputs.managedSourceRevision !==
      workProjection.managedSourceRevision ||
    value.inputs.managedGeneratedAt !== workProjection.managedGeneratedAt ||
    !isSha256(value.inputs.managedSemanticProjectionSha256) ||
    !Array.isArray(value.sourceCoverage) ||
    value.sourceCoverage.length !== CLAIM_SOURCES.size ||
    !Array.isArray(value.claims) ||
    value.claims.length > 12_000 ||
    !Array.isArray(value.fieldResolutions) ||
    value.fieldResolutions.length > 12_000 ||
    !Array.isArray(value.conflicts) ||
    value.conflicts.length > 12_000 ||
    !Number.isSafeInteger(value.totalInputClaimCount) ||
    Number(value.totalInputClaimCount) < 0 ||
    !Number.isSafeInteger(value.deduplicatedClaimCount) ||
    Number(value.deduplicatedClaimCount) < 0 ||
    value.deduplicatedClaimCount !== value.claims.length ||
    Number(value.totalInputClaimCount) < value.claims.length ||
    !Number.isSafeInteger(value.unresolvedCriticalConflictCount) ||
    Number(value.unresolvedCriticalConflictCount) < 0 ||
    value.attentionDisposition !== "not_connected" ||
    value.forbiddenAsAttentionCandidate !== true
  ) {
    return false;
  }
  const coverageSources = new Set<string>();
  const coverageBySource = new Map<string, Record<string, unknown>>();
  for (const coverage of value.sourceCoverage) {
    if (
      !isRecord(coverage) ||
      !hasOnlyKeys(coverage, [
        "source",
        "status",
        "claimFields",
        "reasonCodes"
      ]) ||
      typeof coverage.source !== "string" ||
      !CLAIM_SOURCES.has(coverage.source) ||
      coverageSources.has(coverage.source) ||
      ![
        "evaluated",
        "stale",
        "partial",
        "context_only",
        "unavailable",
        "unsupported"
      ].includes(String(coverage.status)) ||
      !Array.isArray(coverage.claimFields) ||
      !isCanonicalStringArray(coverage.claimFields) ||
      !coverage.claimFields.every(
        (field) => typeof field === "string" && CLAIM_FIELDS.has(field)
      ) ||
      !Array.isArray(coverage.reasonCodes) ||
      !isCanonicalStringArray(coverage.reasonCodes) ||
      !coverage.reasonCodes.every(
        (reason) =>
          typeof reason === "string" &&
          CLAIM_COVERAGE_REASONS.has(reason)
      ) ||
      !claimCoverageMatchesSource(coverage)
    ) {
      return false;
    }
    coverageSources.add(coverage.source);
    coverageBySource.set(coverage.source, coverage);
  }
  const relationIds = new Set<string>([
    ...(Array.isArray(workProjection.relations)
      ? workProjection.relations
          .filter(isRecord)
          .map((relation) => String(relation.relationId))
      : []),
    ...(artifactProjection && Array.isArray(artifactProjection.relations)
      ? artifactProjection.relations
          .filter(isRecord)
          .map((relation) => String(relation.relationId))
      : [])
  ]);
  const claimIds = new Set<string>();
  const claimKeys = new Set<string>();
  const claimsById = new Map<string, Record<string, unknown>>();
  const claimsByKey = new Map<string, Array<Record<string, unknown>>>();
  for (const claim of value.claims) {
    const coverage =
      isPublicClaim(claim) && typeof claim.source === "string"
        ? coverageBySource.get(claim.source)
        : undefined;
    if (
      !isPublicClaim(claim) ||
      !coverage ||
      !claimMatchesCoverage(claim, coverage) ||
      Date.parse(claim.observedAt) >
        Date.parse(String(value.asOf)) + 60_000 ||
      (claim.sourceUpdatedAt !== null &&
        Date.parse(String(claim.sourceUpdatedAt)) >
          Date.parse(String(value.asOf)) + 60_000) ||
      claimIds.has(claim.claimId) ||
      claim.relationRefs.some((ref) => !relationIds.has(ref))
    ) {
      return false;
    }
    claimIds.add(claim.claimId);
    claimKeys.add(claim.claimKey);
    claimsById.set(claim.claimId, claim);
    claimsByKey.set(claim.claimKey, [
      ...(claimsByKey.get(claim.claimKey) ?? []),
      claim
    ]);
  }
  const resolutionKeys = new Set<string>();
  const resolutionsByKey = new Map<string, Record<string, unknown>>();
  for (const resolution of value.fieldResolutions) {
    if (
      !isPublicClaimResolution(resolution, claimIds) ||
      resolutionKeys.has(resolution.claimKey)
    ) {
      return false;
    }
    const group = claimsByKey.get(resolution.claimKey) ?? [];
    const expectedIds = group.map((claim) => String(claim.claimId)).sort();
    if (
      !arraysEqual([...resolution.claimIds].sort(), expectedIds) ||
      group.some(
        (claim) =>
          claim.field !== resolution.field ||
          !sameClaimTarget(claim.target, resolution.target)
      )
    ) {
      return false;
    }
    resolutionKeys.add(resolution.claimKey);
    resolutionsByKey.set(resolution.claimKey, resolution);
  }
  if (
    resolutionKeys.size !== claimKeys.size ||
    [...claimKeys].some((key) => !resolutionKeys.has(key))
  ) {
    return false;
  }
  let unresolvedCount = 0;
  const conflictKeys = new Set<string>();
  for (const conflict of value.conflicts) {
    if (
      !isPublicClaimConflict(conflict, claimIds, relationIds) ||
      conflictKeys.has(conflict.claimKey)
    ) {
      return false;
    }
    const group = claimsByKey.get(conflict.claimKey) ?? [];
    const resolution = resolutionsByKey.get(conflict.claimKey);
    const expectedIds = group.map((claim) => String(claim.claimId)).sort();
    const expectedRelationRefs = [
      ...new Set(
        group.flatMap((claim) =>
          Array.isArray(claim.relationRefs)
            ? claim.relationRefs.map(String)
            : []
        )
      )
    ].sort();
    if (
      !resolution ||
      !arraysEqual([...conflict.claimIds].sort(), expectedIds) ||
      !arraysEqual([...conflict.relationRefs].sort(), expectedRelationRefs) ||
      new Set(group.map((claim) => String(claim.valueSha256))).size < 2 ||
      conflict.field !== resolution.field ||
      !sameClaimTarget(conflict.target, resolution.target) ||
      conflict.winningClaimId !== resolution.winningClaimId ||
      (conflict.status === "review_required"
        ? resolution.status === "resolved" ||
          !["refresh_sources", "user_review"].includes(
            String(conflict.nextAction)
          )
        : resolution.status !== "resolved" ||
          conflict.nextAction !== "none")
    ) {
      return false;
    }
    conflictKeys.add(conflict.claimKey);
    if (conflict.status === "review_required") unresolvedCount += 1;
  }
  if (
    [...claimsByKey.entries()].some(([claimKey, claims]) => {
      const hasDisagreement =
        new Set(claims.map((claim) => String(claim.valueSha256))).size > 1;
      return hasDisagreement !== conflictKeys.has(claimKey);
    })
  ) {
    return false;
  }
  return (
    unresolvedCount === value.unresolvedCriticalConflictCount &&
    claimsById.size === value.claims.length
  );
}

function isPublicClaim(value: unknown): value is Record<string, unknown> & {
  claimId: string;
  claimKey: string;
  field: string;
  target: Record<string, unknown>;
  valueSha256: string;
  source: string;
  observedAt: string;
  sourceUpdatedAt: string | null;
  relationRefs: string[];
} {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.value)) {
    return false;
  }
  return (
    hasOnlyKeys(value, [
      "claimId",
      "claimKey",
      "target",
      "lineageRef",
      "field",
      "value",
      "valueSha256",
      "source",
      "origin",
      "authority",
      "freshness",
      "completeness",
      "directness",
      "observedAt",
      "sourceUpdatedAt",
      "evidenceRefs",
      "relationRefs"
    ]) &&
    hasOnlyKeys(value.target, ["kind", "ref"]) &&
    typeof value.claimId === "string" &&
    /^claim_[a-f0-9]{32}$/.test(value.claimId) &&
    typeof value.claimKey === "string" &&
    /^claim_key_[a-f0-9]{32}$/.test(value.claimKey) &&
    typeof value.lineageRef === "string" &&
    /^claim_lineage_[a-f0-9]{32}$/.test(value.lineageRef) &&
    typeof value.target.ref === "string" &&
    /^claim_subject_[a-f0-9]{32}$/.test(value.target.ref) &&
    typeof value.target.kind === "string" &&
    CLAIM_TARGET_KINDS.has(value.target.kind) &&
    typeof value.field === "string" &&
    CLAIM_FIELDS.has(value.field) &&
    typeof value.source === "string" &&
    CLAIM_SOURCES.has(value.source) &&
    claimSourceFieldOriginMatches(value) &&
    ["current", "stale"].includes(String(value.freshness)) &&
    ["complete", "partial", "unknown"].includes(
      String(value.completeness)
    ) &&
    ["explicit", "derived"].includes(String(value.directness)) &&
    isTimestamp(value.observedAt) &&
    (value.sourceUpdatedAt === null || isTimestamp(value.sourceUpdatedAt)) &&
    isSha256(value.valueSha256) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.length > 0 &&
    value.evidenceRefs.length <= 20 &&
    isCanonicalStringArray(value.evidenceRefs) &&
    value.evidenceRefs.every((ref) =>
      /^claim_evidence_[a-f0-9]{32}$/.test(ref)
    ) &&
    Array.isArray(value.relationRefs) &&
    value.relationRefs.length <= 100 &&
    isCanonicalStringArray(value.relationRefs) &&
    value.relationRefs.every((ref) =>
      /^(?:relation|artifact_relation)_[a-f0-9]{32}$/.test(ref)
    ) &&
    isBoundedPublicClaimValue(value.value) &&
    valueMatchesClaimField(value.field, value.value) &&
    targetMatchesClaimField(value.target.kind, value.field)
  );
}

function isBoundedPublicClaimValue(value: Record<string, unknown>): boolean {
  if (value.type === "opaque_hash") {
    return (
      hasOnlyKeys(value, ["type", "valueSha256"]) &&
      typeof value.valueSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(value.valueSha256)
    );
  }
  if (value.type === "timestamp") {
    return (
      hasOnlyKeys(value, ["type", "value"]) &&
      isTimestamp(value.value)
    );
  }
  return (
    value.type === "enum" &&
    hasOnlyKeys(value, ["type", "value"]) &&
    typeof value.value === "string" &&
    CLAIM_ENUM_VALUES.has(value.value)
  );
}

function isPublicClaimResolution(
  value: unknown,
  claimIds: Set<string>
): value is Record<string, unknown> & {
  claimKey: string;
  claimIds: string[];
  field: string;
  target: Record<string, unknown>;
  winningClaimId: string | null;
  status: string;
} {
  if (
    !isRecord(value) ||
    !isRecord(value.target) ||
    !Array.isArray(value.claimIds) ||
    !Array.isArray(value.reasonCodes)
  ) {
    return false;
  }
  const status = String(value.status);
  return (
    hasOnlyKeys(value, [
      "resolutionId",
      "claimKey",
      "target",
      "field",
      "status",
      "winningClaimId",
      "claimIds",
      "reasonCodes",
      "attentionDisposition",
      "forbiddenAsAttentionCandidate"
    ]) &&
    hasOnlyKeys(value.target, ["kind", "ref"]) &&
    typeof value.target.kind === "string" &&
    CLAIM_TARGET_KINDS.has(value.target.kind) &&
    typeof value.target.ref === "string" &&
    /^claim_subject_[a-f0-9]{32}$/.test(value.target.ref) &&
    typeof value.resolutionId === "string" &&
    /^claim_resolution_[a-f0-9]{32}$/.test(value.resolutionId) &&
    typeof value.claimKey === "string" &&
    /^claim_key_[a-f0-9]{32}$/.test(value.claimKey) &&
    typeof value.field === "string" &&
    CLAIM_FIELDS.has(value.field) &&
    ["resolved", "review_required", "insufficient_evidence"].includes(status) &&
    value.claimIds.length > 0 &&
    value.claimIds.length <= 100 &&
    isCanonicalStringArray(value.claimIds) &&
    value.claimIds.every(
      (claimId) => typeof claimId === "string" && claimIds.has(claimId)
    ) &&
    isNullablePattern(value.winningClaimId, /^claim_[a-f0-9]{32}$/) &&
    (value.winningClaimId === null || claimIds.has(value.winningClaimId)) &&
    (value.winningClaimId === null ||
      value.claimIds.includes(value.winningClaimId)) &&
    ((status === "resolved") === (value.winningClaimId !== null)) &&
    value.reasonCodes.length > 0 &&
    isCanonicalStringArray(value.reasonCodes) &&
    value.reasonCodes.every(
      (reason) =>
        typeof reason === "string" && CLAIM_RESOLUTION_REASONS.has(reason)
    ) &&
    value.attentionDisposition === "not_connected" &&
    value.forbiddenAsAttentionCandidate === true
  );
}

function isPublicClaimConflict(
  value: unknown,
  claimIds: Set<string>,
  relationIds: Set<string>
): value is Record<string, unknown> & {
  status: string;
  claimKey: string;
  claimIds: string[];
  field: string;
  target: Record<string, unknown>;
  winningClaimId: string | null;
  nextAction: string;
  relationRefs: string[];
} {
  if (
    !isRecord(value) ||
    !isRecord(value.target) ||
    !Array.isArray(value.claimIds) ||
    !Array.isArray(value.relationRefs)
  ) {
    return false;
  }
  const status = String(value.status);
  return (
    hasOnlyKeys(value, [
      "conflictId",
      "conflictSchemaVersion",
      "claimKey",
      "target",
      "field",
      "status",
      "criticality",
      "reasonCode",
      "winningClaimId",
      "claimIds",
      "relationRefs",
      "nextAction",
      "attentionDisposition",
      "forbiddenAsAttentionCandidate"
    ]) &&
    value.conflictSchemaVersion === "claim-conflict-schema-v0.1" &&
    typeof value.claimKey === "string" &&
    /^claim_key_[a-f0-9]{32}$/.test(value.claimKey) &&
    hasOnlyKeys(value.target, ["kind", "ref"]) &&
    typeof value.target.kind === "string" &&
    CLAIM_TARGET_KINDS.has(value.target.kind) &&
    typeof value.target.ref === "string" &&
    /^claim_subject_[a-f0-9]{32}$/.test(value.target.ref) &&
    typeof value.conflictId === "string" &&
    /^claim_conflict_[a-f0-9]{32}$/.test(value.conflictId) &&
    typeof value.field === "string" &&
    CLAIM_FIELDS.has(value.field) &&
    [
      "resolved_by_authority",
      "resolved_by_freshness",
      "review_required"
    ].includes(status) &&
    value.criticality === "critical" &&
      typeof value.reasonCode === "string" &&
    CLAIM_CONFLICT_REASONS.has(value.reasonCode) &&
    ["none", "refresh_sources", "user_review"].includes(
      String(value.nextAction)
    ) &&
    value.claimIds.length >= 2 &&
    value.claimIds.length <= 100 &&
    isCanonicalStringArray(value.claimIds) &&
    value.claimIds.every(
      (claimId) => typeof claimId === "string" && claimIds.has(claimId)
    ) &&
    value.relationRefs.every(
      (relationId) =>
        typeof relationId === "string" && relationIds.has(relationId)
    ) &&
    isCanonicalStringArray(value.relationRefs) &&
    isNullablePattern(value.winningClaimId, /^claim_[a-f0-9]{32}$/) &&
    (value.winningClaimId === null ||
      (claimIds.has(value.winningClaimId) &&
        value.claimIds.includes(value.winningClaimId))) &&
    ((status === "review_required") === (value.winningClaimId === null)) &&
    value.attentionDisposition === "not_connected" &&
    value.forbiddenAsAttentionCandidate === true &&
    conflictReasonMatchesStatus(value)
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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isCanonicalStringArray(value: unknown[]): value is string[] {
  if (!value.every((item): item is string => typeof item === "string")) {
    return false;
  }
  return value.every(
    (item, index) =>
      index === 0 || compareClientStrings(value[index - 1]!, item) < 0
  );
}

function compareClientStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameClaimTarget(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.kind === right.kind &&
    left.ref === right.ref
  );
}

function targetMatchesClaimField(
  targetKind: string,
  field: string
): boolean {
  const expectedTargets: Record<string, string> = {
    github_native_identity: "github_work_item",
    github_work_item_state: "github_work_item",
    github_user_relationship: "github_work_item",
    github_milestone_due_at: "github_work_item",
    managed_codex_execution_state: "codex_execution",
    project_alignment_identity: "project_relation",
    notion_task_state: "notion_task",
    notion_internal_priority: "notion_task",
    calendar_event_state: "calendar_event",
    calendar_event_time: "calendar_event",
    user_disposition: "user_work_item"
  };
  return expectedTargets[field] === targetKind;
}

function claimSourceFieldOriginMatches(
  value: Record<string, unknown>
): boolean {
  const source = String(value.source);
  const field = String(value.field);
  const origin = String(value.origin);
  const authority = String(value.authority);
  const directness = String(value.directness);

  if (source === "github") {
    return (
      [
        "github_native_identity",
        "github_work_item_state",
        "github_user_relationship",
        "github_milestone_due_at"
      ].includes(field) &&
      origin === "github_normalized_snapshot" &&
      authority === "authoritative" &&
      directness === "explicit"
    );
  }
  if (source === "codex_managed") {
    return (
      field === "managed_codex_execution_state" &&
      origin === "managed_codex_event_stream" &&
      authority === "authoritative" &&
      directness === "explicit"
    );
  }
  if (source === "codex_inventory") {
    return (
      field === "managed_codex_execution_state" &&
      origin === "codex_inventory_snapshot" &&
      authority === "context_only" &&
      directness === "derived"
    );
  }
  if (source === "notion") {
    return (
      ["notion_task_state", "notion_internal_priority"].includes(field) &&
      origin === "notion_task_database" &&
      authority === "authoritative" &&
      directness === "explicit"
    );
  }
  if (source === "google_calendar") {
    return (
      ["calendar_event_state", "calendar_event_time"].includes(field) &&
      origin === "google_calendar_snapshot" &&
      authority === "authoritative" &&
      directness === "explicit"
    );
  }
  if (source !== "explicit_user") return false;
  const validOrigin =
    (field === "project_alignment_identity" &&
      origin === "explicit_user_mapping") ||
    (["notion_internal_priority", "user_disposition"].includes(field) &&
      origin === "explicit_user_feedback");
  return (
    validOrigin &&
    authority === "authoritative" &&
    directness === "explicit"
  );
}

function claimCoverageMatchesSource(
  coverage: Record<string, unknown>
): boolean {
  const source = String(coverage.source);
  const status = String(coverage.status);
  const fields = coverage.claimFields as string[];
  const reasons = coverage.reasonCodes as string[];
  const allowedFields: Record<string, readonly string[]> = {
    github: [
      "github_milestone_due_at",
      "github_native_identity",
      "github_user_relationship",
      "github_work_item_state"
    ],
    codex_managed: ["managed_codex_execution_state"],
    codex_inventory: ["managed_codex_execution_state"],
    notion: ["notion_internal_priority", "notion_task_state"],
    google_calendar: ["calendar_event_state", "calendar_event_time"],
    explicit_user: [
      "notion_internal_priority",
      "project_alignment_identity",
      "user_disposition"
    ]
  };
  if (!fields.every((field) => allowedFields[source]?.includes(field))) {
    return false;
  }
  const allowedReasons: Record<string, readonly string[]> = {
    github: [
      "GITHUB_DIRECT_FIELDS_EVALUATED",
      "GITHUB_SNAPSHOT_STALE",
      "GITHUB_SNAPSHOT_PARTIAL",
      "GITHUB_SNAPSHOT_UNAVAILABLE"
    ],
    codex_managed: ["MANAGED_CODEX_DIRECT_EVENTS_EVALUATED"],
    codex_inventory: ["CODEX_INVENTORY_NOT_LIVE"],
    notion: [
      "NOTION_TASK_PROPERTIES_UNAVAILABLE",
      "NOTION_CONFIGURED_TASK_FIELDS_EVALUATED"
    ],
    google_calendar: [
      "CALENDAR_WORK_EQUIVALENCE_UNAVAILABLE",
      "CALENDAR_NATIVE_EVENT_FIELDS_EVALUATED"
    ],
    explicit_user: [
      "EXPLICIT_PROJECT_MAPPING_EVALUATED",
      "EXPLICIT_USER_FEEDBACK_EVALUATED"
    ]
  };
  if (!reasons.every((reason) => allowedReasons[source]?.includes(reason))) {
    return false;
  }
  if (source === "github") {
    const expectedReason =
      status === "evaluated"
        ? "GITHUB_DIRECT_FIELDS_EVALUATED"
        : status === "stale"
          ? "GITHUB_SNAPSHOT_STALE"
          : status === "partial"
            ? "GITHUB_SNAPSHOT_PARTIAL"
            : status === "unavailable"
              ? "GITHUB_SNAPSHOT_UNAVAILABLE"
              : null;
    return expectedReason !== null && reasons.includes(expectedReason);
  }
  if (source === "codex_managed") {
    return status === "evaluated";
  }
  if (source === "codex_inventory") {
    return status === "context_only";
  }
  if (source === "notion") {
    return ["evaluated", "partial", "context_only", "unavailable"].includes(
      status
    );
  }
  if (source === "google_calendar") {
    return ["evaluated", "partial", "context_only", "unavailable"].includes(
      status
    );
  }
  return source === "explicit_user" && status === "evaluated";
}

function claimMatchesCoverage(
  claim: Record<string, unknown>,
  coverage: Record<string, unknown>
): boolean {
  const status = String(coverage.status);
  const fields = coverage.claimFields as string[];
  if (claim.authority === "context_only") {
    return status === "context_only";
  }
  return (
    ["evaluated", "partial", "stale"].includes(status) &&
    fields.includes(String(claim.field)) &&
    (status !== "stale" || claim.freshness === "stale")
  );
}

function valueMatchesClaimField(
  field: string,
  value: Record<string, unknown>
): boolean {
  if (
    field === "github_native_identity" ||
    field === "project_alignment_identity"
  ) {
    return value.type === "opaque_hash";
  }
  if (
    field === "github_milestone_due_at" ||
    field === "calendar_event_time"
  ) {
    return value.type === "timestamp";
  }
  if (value.type !== "enum" || typeof value.value !== "string") return false;
  const allowed: Record<string, readonly string[]> = {
    github_work_item_state: ["open", "completed", "cancelled"],
    github_user_relationship: [
      "assigned_to_user",
      "review_requested_from_user",
      "authored_by_user"
    ],
    managed_codex_execution_state: [
      "running",
      "idle",
      "completed",
      "failed",
      "interrupted"
    ],
    notion_task_state: ["open", "in_progress", "completed", "cancelled"],
    notion_internal_priority: ["low", "medium", "high", "urgent"],
    calendar_event_state: ["confirmed", "tentative", "cancelled"],
    user_disposition: ["active", "completed", "incorrect", "not_now"]
  };
  return allowed[field]?.includes(value.value) ?? false;
}

function conflictReasonMatchesStatus(
  conflict: Record<string, unknown>
): boolean {
  switch (conflict.reasonCode) {
    case "LOWER_AUTHORITY_VALUE_DISAGREEMENT":
      return (
        conflict.status === "resolved_by_authority" &&
        conflict.nextAction === "none"
      );
    case "OLDER_LINEAGE_VALUE_DISAGREEMENT":
      return (
        conflict.status === "resolved_by_freshness" &&
        conflict.nextAction === "none"
      );
    case "EQUAL_AUTHORITY_VALUE_DISAGREEMENT":
      return (
        conflict.status === "review_required" &&
        conflict.nextAction === "user_review"
      );
    case "STALE_AUTHORITY_VALUE_DISAGREEMENT":
      return (
        (conflict.status === "resolved_by_freshness" &&
          conflict.nextAction === "none") ||
        (conflict.status === "review_required" &&
          conflict.nextAction === "refresh_sources")
      );
    default:
      return false;
  }
}
