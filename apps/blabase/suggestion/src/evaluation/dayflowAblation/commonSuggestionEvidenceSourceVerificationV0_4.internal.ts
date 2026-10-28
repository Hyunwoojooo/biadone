const safeObjectFreeze = Object.freeze;
const safeObjectIs = Object.is;
const safeNumberIsFinite = Number.isFinite;
const safeNumberIsSafeInteger = Number.isSafeInteger;
const SafeDate = Date;
const safeReflectApply = Reflect.apply;
const safeRegExpExec = RegExp.prototype.exec;
const safeDateGetTime = Date.prototype.getTime;
const safeDateToISOString = Date.prototype.toISOString;

const CANONICAL_UTC_MILLIS_PATTERN =
  /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const SHA256_LOWER_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type SourceV0_4 =
  | "github"
  | "codex"
  | "google_calendar"
  | "notion"
  | "dayflow";

export type Sha256LowerHexV0_4 = string;
export type CanonicalUtcMillisV0_4 = string;
export type NonNegativeSafeIntegerV0_4 = number;
export type PositiveSafeIntegerV0_4 = number;

export type SourceCoverageStatusV0_4 = "unknown" | "partial" | "complete";
export type ProjectionCompletenessV0_4 =
  | "unknown"
  | "truncated"
  | "complete";

export type FrozenTextTruncationAssertionV0_4 = Readonly<{
  wasTruncated: boolean;
}>;

export type CompletenessConversionInputV0_4 = Readonly<{
  coverageStatus: SourceCoverageStatusV0_4;
  applicableAllowedTextSpans: readonly FrozenTextTruncationAssertionV0_4[];
}>;

export type PreClaimDispositionV0_4 =
  | Readonly<{
      disposition: "terminalize_invalid_interval";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "invalid";
      terminalReason: "proof_interval_invalid";
      deletionBoundaryAtSource: "winning_cas_decision_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_generation_stale";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "generation_stale";
      terminalReason: "proof_generation_stale";
      deletionBoundaryAtSource: "authoritative_generation_invalidated_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_revoked";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "revoked";
      terminalReason: "proof_revoked";
      deletionBoundaryAtSource: "proof_revoked_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "terminalize_expired";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: "expired";
      terminalReason: "proof_expired";
      deletionBoundaryAtSource: "proof_expires_at";
      normalClaimPermitted: false;
      disposalRequired: true;
    }>
  | Readonly<{
      disposition: "reject_future_issued";
      failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID";
      failureDetail: "context_binding_invalid";
      terminalState: null;
      terminalReason: null;
      deletionBoundaryAtSource: null;
      normalClaimPermitted: false;
      disposalRequired: false;
    }>
  | Readonly<{
      disposition: "eligible";
      failureCode: null;
      failureDetail: null;
      terminalState: null;
      terminalReason: null;
      deletionBoundaryAtSource: null;
      normalClaimPermitted: true;
      disposalRequired: false;
    }>;

export const COMMON_SOURCE_VERIFICATION_SOURCE_ORDER_V0_4 = safeObjectFreeze(
  ["github", "codex", "google_calendar", "notion", "dayflow"] as const,
);

export type PreClaimDispositionFactsInternalV0_4 = Readonly<{
  decisionAt: CanonicalUtcMillisV0_4;
  authoritativeCurrentGenerationId: string;
  generationFence: Readonly<{
    invalidatedGenerationId: string;
    successorGenerationId: string;
    invalidatedAt: CanonicalUtcMillisV0_4;
    fenceEpoch: PositiveSafeIntegerV0_4;
    state: "committed";
  }> | null;
  proofGenerationId: string;
  registeredAt: CanonicalUtcMillisV0_4;
  expiresAt: CanonicalUtcMillisV0_4;
  revokedAt: CanonicalUtcMillisV0_4 | null;
}>;

const INVALID_INTERVAL_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "terminalize_invalid_interval",
  failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
  failureDetail: "context_binding_invalid",
  terminalState: "invalid",
  terminalReason: "proof_interval_invalid",
  deletionBoundaryAtSource: "winning_cas_decision_at",
  normalClaimPermitted: false,
  disposalRequired: true,
} as const satisfies PreClaimDispositionV0_4);

const GENERATION_STALE_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "terminalize_generation_stale",
  failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
  failureDetail: "context_binding_invalid",
  terminalState: "generation_stale",
  terminalReason: "proof_generation_stale",
  deletionBoundaryAtSource: "authoritative_generation_invalidated_at",
  normalClaimPermitted: false,
  disposalRequired: true,
} as const satisfies PreClaimDispositionV0_4);

const REVOKED_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "terminalize_revoked",
  failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
  failureDetail: "context_binding_invalid",
  terminalState: "revoked",
  terminalReason: "proof_revoked",
  deletionBoundaryAtSource: "proof_revoked_at",
  normalClaimPermitted: false,
  disposalRequired: true,
} as const satisfies PreClaimDispositionV0_4);

const EXPIRED_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "terminalize_expired",
  failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
  failureDetail: "context_binding_invalid",
  terminalState: "expired",
  terminalReason: "proof_expired",
  deletionBoundaryAtSource: "proof_expires_at",
  normalClaimPermitted: false,
  disposalRequired: true,
} as const satisfies PreClaimDispositionV0_4);

const FUTURE_ISSUED_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "reject_future_issued",
  failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
  failureDetail: "context_binding_invalid",
  terminalState: null,
  terminalReason: null,
  deletionBoundaryAtSource: null,
  normalClaimPermitted: false,
  disposalRequired: false,
} as const satisfies PreClaimDispositionV0_4);

const ELIGIBLE_DISPOSITION_V0_4 = safeObjectFreeze({
  disposition: "eligible",
  failureCode: null,
  failureDetail: null,
  terminalState: null,
  terminalReason: null,
  deletionBoundaryAtSource: null,
  normalClaimPermitted: true,
  disposalRequired: false,
} as const satisfies PreClaimDispositionV0_4);

export function isCanonicalUtcMillisInternalV0_4(
  value: unknown,
): value is CanonicalUtcMillisV0_4 {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    safeReflectApply(safeRegExpExec, CANONICAL_UTC_MILLIS_PATTERN, [value]) ===
      null
  ) {
    return false;
  }

  const parsed = new SafeDate(value);
  const parsedTime = safeReflectApply(safeDateGetTime, parsed, []);
  return (
    safeNumberIsFinite(parsedTime) &&
    safeReflectApply(safeDateToISOString, parsed, []) === value
  );
}

export function isNonNegativeSafeIntegerInternalV0_4(
  value: unknown,
): value is NonNegativeSafeIntegerV0_4 {
  return (
    typeof value === "number" &&
    safeNumberIsFinite(value) &&
    safeNumberIsSafeInteger(value) &&
    value >= 0 &&
    !safeObjectIs(value, -0)
  );
}

export function isPositiveSafeIntegerInternalV0_4(
  value: unknown,
): value is PositiveSafeIntegerV0_4 {
  return isNonNegativeSafeIntegerInternalV0_4(value) && value > 0;
}

export function isSha256LowerHexInternalV0_4(
  value: unknown,
): value is Sha256LowerHexV0_4 {
  return (
    typeof value === "string" &&
    safeReflectApply(safeRegExpExec, SHA256_LOWER_HEX_PATTERN, [value]) !== null
  );
}

/**
 * Classifies an already validated, parent-owned runtime snapshot view.
 * Timestamp strings are safe to compare lexically only after canonical validation.
 */
export function classifyPreClaimDispositionInternalV0_4(
  facts: PreClaimDispositionFactsInternalV0_4,
): PreClaimDispositionV0_4 {
  if (
    facts.registeredAt >= facts.expiresAt ||
    (facts.revokedAt !== null && facts.registeredAt >= facts.revokedAt)
  ) {
    return INVALID_INTERVAL_DISPOSITION_V0_4;
  }

  if (
    facts.proofGenerationId !== facts.authoritativeCurrentGenerationId &&
    facts.generationFence !== null &&
    facts.generationFence.invalidatedGenerationId === facts.proofGenerationId
  ) {
    return GENERATION_STALE_DISPOSITION_V0_4;
  }

  if (facts.revokedAt !== null && facts.revokedAt <= facts.decisionAt) {
    return REVOKED_DISPOSITION_V0_4;
  }

  if (facts.expiresAt <= facts.decisionAt) {
    return EXPIRED_DISPOSITION_V0_4;
  }

  if (facts.decisionAt < facts.registeredAt) {
    return FUTURE_ISSUED_DISPOSITION_V0_4;
  }

  return ELIGIBLE_DISPOSITION_V0_4;
}

export function convertProjectionCompletenessInternalV0_4(
  input: CompletenessConversionInputV0_4,
): ProjectionCompletenessV0_4 {
  if (input.coverageStatus === "unknown") {
    return "unknown";
  }

  if (input.coverageStatus === "partial") {
    return "truncated";
  }

  const spans = input.applicableAllowedTextSpans;
  const spanCount = spans.length;
  for (let index = 0; index < spanCount; index += 1) {
    const span = spans[index];
    if (span.wasTruncated) {
      return "truncated";
    }
  }

  return "complete";
}
