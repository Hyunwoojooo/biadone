import type {
  ContinuationReadApiResponse,
  ContinuationReadDecision,
  ContinuationReadError
} from "../src/continuation/readApi";

const CONTRACT = "continuation-read-api-v0.1";
const STATUSES = new Set([
  "offers_available",
  "setup_required",
  "no_recent_context",
  "insufficient_evidence",
  "unavailable"
]);
const COVERAGE = new Set([
  "COMPLETE",
  "SOURCE_LOCAL_PARTIAL",
  "INSUFFICIENT",
  "UNAVAILABLE"
]);
const ERROR_CODES = new Set([
  "CONTINUATION_READ_LOCAL_ONLY",
  "CONTINUATION_READ_INVALID_ORIGIN",
  "CONTINUATION_READ_DISABLED",
  "CONTINUATION_READ_AUTH_UNAVAILABLE",
  "CONTINUATION_READ_UNAUTHORIZED",
  "CONTINUATION_READ_FAILED"
]);
const CAVEAT_CODES = new Set([
  "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED",
  "IDENTITY_CLARIFICATION_REQUIRED",
  "SOURCE_COVERAGE_PARTIAL",
  "SOURCE_COVERAGE_UNKNOWN",
  "SOURCE_METADATA_ONLY",
  "TERMINAL_STATE_UNKNOWN"
]);
const PUBLIC_TEXT_FORBIDDEN_PATTERNS = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /[\\/]/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:action_ref|analysis|artifact|binding|candidate|candidate_sha|context_ref|continuation_candidate|continuation_observation|continuation_offer|continuation_run|evidence|execution|input_sha|item_ref|managed_run|observation_sha|private_target|project|proof|repository|result_sha|run|scope|session|source_record_ref|source_ref|stream|work_context)_[A-Za-z0-9_-]+/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/u,
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/u,
  /\b(?:token|api[ _-]?key|access[ _-]?(?:key|token)|password|secret)\s*[:=]\s*["']?[^\s,;"']+/iu
];

export async function fetchContinuationRead(): Promise<ContinuationReadApiResponse> {
  const response = await fetch("/api/continuation", {
    cache: "no-store"
  });
  return parseContinuationReadResponse(await response.json());
}

export function parseContinuationReadResponse(
  value: unknown
): ContinuationReadApiResponse {
  if (!isRecord(value) || value.contract !== CONTRACT) {
    return invalidResponse();
  }
  if (value.status === "error") {
    if (
      hasExactKeys(value, ["code", "contract", "message", "status"]) &&
      typeof value.code === "string" &&
      ERROR_CODES.has(value.code) &&
      isSafeText(value.message, 160)
    ) {
      return value as ContinuationReadError;
    }
    return invalidResponse();
  }
  if (
    !hasExactKeys(value, [
      "contract",
      "coverageCode",
      "generatedAt",
      "items",
      "status"
    ]) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status) ||
    typeof value.coverageCode !== "string" ||
    !COVERAGE.has(value.coverageCode) ||
    !isCanonicalTimestamp(value.generatedAt) ||
    !Array.isArray(value.items) ||
    value.items.length > 3 ||
    !value.items.every(isReadItem)
  ) {
    return invalidResponse();
  }
  const carriesItems =
    value.status === "offers_available" || value.status === "setup_required";
  if (carriesItems !== (value.items.length > 0)) return invalidResponse();
  const expectedCoverage: Record<string, Set<string>> = {
    offers_available: new Set(["COMPLETE", "SOURCE_LOCAL_PARTIAL"]),
    setup_required: new Set(["SOURCE_LOCAL_PARTIAL"]),
    no_recent_context: new Set(["COMPLETE"]),
    insufficient_evidence: new Set(["INSUFFICIENT"]),
    unavailable: new Set(["UNAVAILABLE"])
  };
  if (!expectedCoverage[value.status]?.has(value.coverageCode)) {
    return invalidResponse();
  }
  return value as ContinuationReadDecision;
}

function isReadItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const caveats = value.caveats;
  return (
    hasExactKeys(value, [
      "action",
      "capability",
      "caveats",
      "summary",
      "title"
    ]) &&
    isSafeText(value.title, 120) &&
    value.summary === value.title &&
    value.capability === "display" &&
    value.action === null &&
    Array.isArray(caveats) &&
    caveats.length <= 8 &&
    caveats.every(
      (code) => typeof code === "string" && CAVEAT_CODES.has(code)
    ) &&
    caveats.every(
      (code, index) => index === 0 || caveats[index - 1] < code
    )
  );
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maxLength &&
    !PUBLIC_TEXT_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function invalidResponse(): ContinuationReadError {
  return {
    contract: CONTRACT,
    status: "error",
    code: "CONTINUATION_READ_FAILED",
    message: "Continuation 응답을 검증하지 못했습니다."
  };
}
