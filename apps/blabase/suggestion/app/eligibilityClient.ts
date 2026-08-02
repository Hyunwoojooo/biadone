import type {
  AttentionEligibilityApiResponse,
  AttentionEligibilityAssessment,
  AttentionEligibilityShadowProjection
} from "../src/eligibility/contracts";

const REASON_CODES = new Set([
  "ELIGIBLE_DIRECT_ASSIGNED_ISSUE",
  "ELIGIBLE_REVIEW_STATUS_INSPECTION",
  "ELIGIBLE_RELEVANT_CONFLICT_RESOLVED",
  "ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH",
  "REVIEW_SOURCE_STALE",
  "REVIEW_MATERIAL_CLAIM_MISSING",
  "REVIEW_MATERIAL_CLAIM_UNRESOLVED",
  "REVIEW_MATERIAL_EVIDENCE_PARTIAL",
  "INELIGIBLE_CONTEXT_ONLY",
  "INELIGIBLE_UNSUPPORTED_TASK_KIND",
  "INELIGIBLE_NATIVE_DESTINATION_MISSING",
  "INELIGIBLE_NOT_CANDIDATE_INPUT",
  "INELIGIBLE_CURRENT_STATE_NOT_OPEN",
  "INELIGIBLE_USER_RELATIONSHIP_MISMATCH"
]);

export async function fetchAttentionEligibility(): Promise<AttentionEligibilityApiResponse> {
  const response = await fetch("/api/attention/eligibility", {
    cache: "no-store"
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload)) return invalidResponse();
  if (payload.status === "ready") {
    if (
      !hasExactKeys(payload, ["projection", "status"]) ||
      !isEligibilityProjection(payload.projection)
    ) {
      return invalidResponse();
    }
    return {
      status: "ready",
      projection: payload.projection
    };
  }
  if (
    payload.status === "unavailable" &&
    hasExactKeys(payload, ["localUrl", "message", "status"]) &&
    typeof payload.message === "string" &&
    payload.message.length <= 500 &&
    payload.localUrl === "http://localhost:3102/attention-lab"
  ) {
    return payload as AttentionEligibilityApiResponse;
  }
  if (
    payload.status === "error" &&
    hasExactKeys(payload, ["code", "message", "status"]) &&
    typeof payload.code === "string" &&
    payload.code.length <= 120 &&
    typeof payload.message === "string" &&
    payload.message.length <= 500
  ) {
    return payload as AttentionEligibilityApiResponse;
  }
  return invalidResponse();
}

function isEligibilityProjection(
  value: unknown
): value is AttentionEligibilityShadowProjection {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "asOf",
      "assessments",
      "attentionDisposition",
      "attentionSelectionEffect",
      "candidateSeedSchemaVersion",
      "contract",
      "counts",
      "coverage",
      "dependencies",
      "evidencePolicyVersion",
      "forbiddenAsAttentionCandidate",
      "idPolicyVersion",
      "inputSha256",
      "mode",
      "policyVersion",
      "projectionSha256",
      "resolverVersion"
    ]) ||
    value.contract !== "attention-eligibility-shadow-projection-v0.1" ||
    value.candidateSeedSchemaVersion !== "attention-candidate-seed-v0.1" ||
    value.policyVersion !== "hard-attention-eligibility-policy-v0.1" ||
    value.evidencePolicyVersion !== "attention-eligibility-evidence-v0.1" ||
    value.resolverVersion !== "attention-eligibility-resolver-v0.1" ||
    value.idPolicyVersion !== "attention-eligibility-id-v0.1" ||
    value.mode !== "shadow" ||
    !isTimestamp(value.asOf) ||
    !isSha256(value.inputSha256) ||
    !isSha256(value.projectionSha256) ||
    value.attentionSelectionEffect !== "none" ||
    value.attentionDisposition !== "shadow_only" ||
    value.forbiddenAsAttentionCandidate !== true ||
    !isDependencies(value.dependencies) ||
    !isCoverage(value.coverage) ||
    !isCounts(value.counts) ||
    !Array.isArray(value.assessments) ||
    value.assessments.length > 12_000 ||
    !value.assessments.every(isAssessment)
  ) {
    return false;
  }
  const assessments = value.assessments as AttentionEligibilityAssessment[];
  return (
    value.coverage.candidateSeedCount === assessments.length &&
    value.counts.eligible ===
      assessments.filter((item) => item.status === "eligible").length &&
    value.counts.reviewRequired ===
      assessments.filter((item) => item.status === "review_required").length &&
    value.counts.ineligible ===
      assessments.filter((item) => item.status === "ineligible").length &&
    isCanonicalUnique(assessments.map((item) => item.assessmentId)) &&
    new Set(assessments.map((item) => item.candidateSeedId)).size ===
      assessments.length
  );
}

function isDependencies(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "artifactRelationProjectionSha256",
      "claimAuthorityProjectionSha256",
      "contextRegistrySha256",
      "githubBatchSha256",
      "githubSourceSnapshotSha256",
      "managedGeneratedAt",
      "managedSemanticProjectionSha256",
      "managedSourceRevision",
      "workRelationProjectionSha256"
    ]) &&
    isSha256(value.workRelationProjectionSha256) &&
    isSha256(value.artifactRelationProjectionSha256) &&
    isSha256(value.claimAuthorityProjectionSha256) &&
    isNullableSha256(value.githubBatchSha256) &&
    isNullableSha256(value.githubSourceSnapshotSha256) &&
    Number.isSafeInteger(value.managedSourceRevision) &&
    Number(value.managedSourceRevision) >= 0 &&
    isTimestamp(value.managedGeneratedAt) &&
    isSha256(value.managedSemanticProjectionSha256) &&
    isNullableSha256(value.contextRegistrySha256)
  );
}

function isCoverage(value: unknown): value is AttentionEligibilityShadowProjection["coverage"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "candidateSeedCount",
      "candidateUniverse",
      "codexManagedEligibility",
      "githubCandidateCoverage",
      "totalGitHubWorkItemSignalCount",
      "unrelatedUnresolvedCriticalConflictCount"
    ]) &&
    value.candidateUniverse === "github_work_items_only" &&
    ["complete", "partial", "stale", "unavailable"].includes(
      String(value.githubCandidateCoverage)
    ) &&
    value.codexManagedEligibility === "not_evaluated_phase_4a" &&
    isNonnegativeInteger(value.totalGitHubWorkItemSignalCount) &&
    isNonnegativeInteger(value.candidateSeedCount) &&
    isNonnegativeInteger(value.unrelatedUnresolvedCriticalConflictCount)
  );
}

function isCounts(value: unknown): value is AttentionEligibilityShadowProjection["counts"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["eligible", "ineligible", "reviewRequired"]) &&
    isNonnegativeInteger(value.eligible) &&
    isNonnegativeInteger(value.reviewRequired) &&
    isNonnegativeInteger(value.ineligible)
  );
}

function isAssessment(value: unknown): value is AttentionEligibilityAssessment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "actionKind",
      "assessmentId",
      "attentionDisposition",
      "candidateSeedId",
      "forbiddenAsAttentionCandidate",
      "reasonCodes",
      "relatedConflictIds",
      "relationRefs",
      "reviewRoute",
      "source",
      "sourceSignalId",
      "status",
      "targetRef",
      "taskKind"
    ]) ||
    typeof value.assessmentId !== "string" ||
    !/^elig_[a-f0-9]{32}$/.test(value.assessmentId) ||
    typeof value.candidateSeedId !== "string" ||
    !/^seed_[a-f0-9]{32}$/.test(value.candidateSeedId) ||
    value.source !== "github" ||
    typeof value.sourceSignalId !== "string" ||
    !/^sig_[a-f0-9]{32}$/.test(value.sourceSignalId) ||
    typeof value.targetRef !== "string" ||
    !/^claim_subject_[a-f0-9]{32}$/.test(value.targetRef) ||
    ![
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ].includes(String(value.taskKind)) ||
    ![null, "do", "inspect"].includes(value.actionKind as never) ||
    !["eligible", "review_required", "ineligible"].includes(
      String(value.status)
    ) ||
    !["none", "user_review", "refresh_sources"].includes(
      String(value.reviewRoute)
    ) ||
    !Array.isArray(value.reasonCodes) ||
    value.reasonCodes.length < 1 ||
    value.reasonCodes.length > 12 ||
    !value.reasonCodes.every(
      (reason) => typeof reason === "string" && REASON_CODES.has(reason)
    ) ||
    !isCanonicalUnique(value.reasonCodes as string[]) ||
    !isPatternArray(value.relationRefs, /^relation_[a-f0-9]{32}$/, 100) ||
    !isPatternArray(
      value.relatedConflictIds,
      /^claim_conflict_[a-f0-9]{32}$/,
      100
    ) ||
    value.attentionDisposition !== "shadow_only" ||
    value.forbiddenAsAttentionCandidate !== true
  ) {
    return false;
  }
  return (
    (value.status === "review_required") ===
    (value.reviewRoute !== "none")
  );
}

function invalidResponse(): AttentionEligibilityApiResponse {
  return {
    status: "error",
    code: "INVALID_ATTENTION_ELIGIBILITY_PROJECTION",
    message: "Eligibility shadow 결과를 검증하지 못했습니다."
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: string[]
): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNullableSha256(value: unknown): boolean {
  return value === null || isSha256(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isNonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPatternArray(
  value: unknown,
  pattern: RegExp,
  max: number
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && pattern.test(item)) &&
    isCanonicalUnique(value as string[])
  );
}

function isCanonicalUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.join("|") === [...values].sort().join("|")
  );
}
