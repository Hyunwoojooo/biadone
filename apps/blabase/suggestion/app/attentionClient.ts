import type {
  AttentionApiResponse,
  AttentionFeedbackRecord,
  AttentionFeedbackType,
  AttentionHistoryResponse
} from "../src/attention/monitoringSchema";
import type { WorkBoardApiResponse } from "../src/suggestionBoard/monitoringSchema";

export async function fetchAttention(
  refreshSources = false
): Promise<AttentionApiResponse> {
  const response = await fetch("/api/attention", {
    method: refreshSources ? "POST" : "GET",
    cache: "no-store"
  });
  return (await response.json()) as AttentionApiResponse;
}

export async function fetchAttentionHistory(): Promise<AttentionHistoryResponse> {
  const response = await fetch("/api/attention/history", {
    cache: "no-store"
  });
  return (await response.json()) as AttentionHistoryResponse;
}

export async function fetchWorkBoard(): Promise<WorkBoardApiResponse> {
  const response = await fetch("/api/work-board", { cache: "no-store" });
  return parseWorkBoardResponse(await response.json());
}

const WORK_BOARD_FALLBACK_REASONS = new Set([
  "CONTINUATION_PREREQUISITES_UNAVAILABLE",
  "CONTINUATION_IDENTITY_REJECTED",
  "CONTINUATION_DERIVATION_REJECTED",
  "CONTINUATION_RESOLUTION_REJECTED",
  "BOARD_COMPOSITION_REJECTED",
  "BOARD_PUBLIC_PROJECTION_REJECTED"
]);

const WORK_BOARD_RESPONSE_CODES = new Set([
  "WORK_BOARD_SHADOW_DISABLED",
  "WORK_BOARD_LOCAL_ONLY",
  "WORK_BOARD_PROJECTION_KEY_UNAVAILABLE",
  "WORK_BOARD_PREVIEW_FAILED"
]);

const PUBLIC_TEXT_FORBIDDEN_PATTERNS = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:session_|run_|analysis_|evidence_|source_ref_|managed_run_|continuation_observation_|continuation_candidate_)[A-Za-z0-9_-]*/u
];

function parseWorkBoardResponse(value: unknown): WorkBoardApiResponse {
  if (!isRecord(value) || typeof value.status !== "string") {
    return invalidWorkBoardResponse();
  }
  if (
    value.status === "ready" &&
    hasExactKeys(value, ["board", "mode", "reasonCode", "status"]) &&
    isReadyModeAndReason(value.mode, value.reasonCode) &&
    isPublicWorkBoard(value.board)
  ) {
    return value as WorkBoardApiResponse;
  }
  if (
    (value.status === "unavailable" || value.status === "error") &&
    hasExactKeys(value, ["code", "message", "status"]) &&
    WORK_BOARD_RESPONSE_CODES.has(String(value.code)) &&
    isBoundedString(value.message, 160)
  ) {
    return value as WorkBoardApiResponse;
  }
  return invalidWorkBoardResponse();
}

function isReadyModeAndReason(mode: unknown, reasonCode: unknown): boolean {
  return (
    (mode === "full" && reasonCode === null) ||
    (mode === "active_only_fallback" &&
      typeof reasonCode === "string" &&
      WORK_BOARD_FALLBACK_REASONS.has(reasonCode))
  );
}

function isPublicWorkBoard(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "alternatives",
      "continuationStatus",
      "contract",
      "executionPolicy",
      "generatedAt",
      "primary",
      "prominentLane",
      "schemaVersion"
    ]) ||
    value.contract !== "work-suggestion-board-public-v0.1" ||
    value.schemaVersion !== "work-suggestion-board-schema-v0.1" ||
    !isCanonicalTimestamp(value.generatedAt) ||
    !["attention", "continuation", "setup", "none"].includes(
      String(value.prominentLane)
    ) ||
    !["available", "empty", "unavailable"].includes(
      String(value.continuationStatus)
    ) ||
    !isExecutionPolicy(value.executionPolicy) ||
    (value.primary !== null && !isPublicBoardItem(value.primary)) ||
    !Array.isArray(value.alternatives) ||
    value.alternatives.length > 2 ||
    !value.alternatives.every(isPublicBoardItem)
  ) {
    return false;
  }

  const primary = value.primary as PublicBoardItem | null;
  const alternatives = value.alternatives as PublicBoardItem[];
  const prominentLane = value.prominentLane as PublicBoardLane | "none";
  const items = primary === null ? alternatives : [primary, ...alternatives];
  const hasAttention = items.some((item) => item.lane === "attention");
  const hasContinuation = items.some((item) => item.lane !== "attention");

  if (
    (prominentLane === "none"
      ? primary !== null || alternatives.length > 0
      : primary === null || primary.lane !== prominentLane) ||
    (prominentLane === "none" && value.continuationStatus === "available") ||
    (hasAttention && prominentLane !== "attention") ||
    (hasContinuation && value.continuationStatus !== "available")
  ) {
    return false;
  }

  if (
    items.some((entry) => {
      const item = entry.item as Record<string, unknown>;
      if (entry.lane === "attention") {
        return (
          (item.observedAt !== null &&
            Date.parse(item.observedAt as string) >
              Date.parse(value.generatedAt as string)) ||
          (item.expiresAt !== null &&
            Date.parse(item.expiresAt as string) <=
              Date.parse(value.generatedAt as string))
        );
      }
      if (
        Date.parse(item.observedAt as string) >
          Date.parse(value.generatedAt as string) ||
        Date.parse(item.expiresAt as string) <=
          Date.parse(value.generatedAt as string)
      ) {
        return true;
      }
      const action = item.action;
      return (
        isRecord(action) &&
        (Date.parse(action.expiresAt as string) <=
          Date.parse(value.generatedAt as string) ||
          Date.parse(action.expiresAt as string) >
            Date.parse(item.expiresAt as string))
      );
    })
  ) {
    return false;
  }

  const itemRefs = items.map((entry) => entry.item.itemRef);
  const laneRanks = items.map((entry) => laneRank(entry.lane));
  return (
    new Set(itemRefs).size === itemRefs.length &&
    laneRanks.every(
      (rank, index) => index === 0 || laneRanks[index - 1]! <= rank
    )
  );
}

type PublicBoardLane = "attention" | "continuation" | "setup";
type PublicBoardItem = {
  lane: PublicBoardLane;
  item: { itemRef: string };
};

function isPublicBoardItem(value: unknown): value is PublicBoardItem {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["item", "lane"]) ||
    !["attention", "continuation", "setup"].includes(String(value.lane))
  ) {
    return false;
  }
  if (value.lane === "attention") return isPublicAttentionItem(value.item);
  return (
    isPublicContinuationItem(value.item) &&
    ((value.lane === "setup") === (value.item.evidenceBand === "setup"))
  );
}

function isPublicAttentionItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "action",
      "capability",
      "caveatCodes",
      "evidenceBand",
      "expiresAt",
      "itemRef",
      "kind",
      "observedAt",
      "summary",
      "title",
      "workContextRef"
    ]) &&
    isItemRef(value.itemRef) &&
    isNullableWorkContextRef(value.workContextRef) &&
    ["active_attention", "attention_clarification"].includes(
      String(value.kind)
    ) &&
    isPublicText(value.title, 120) &&
    value.summary === value.title &&
    (value.observedAt === null || isCanonicalTimestamp(value.observedAt)) &&
    (value.expiresAt === null || isCanonicalTimestamp(value.expiresAt)) &&
    value.evidenceBand === "verified_attention" &&
    value.capability === "display" &&
    value.action === null &&
    isCanonicalReasonCodes(value.caveatCodes)
  );
}

function isPublicContinuationItem(
  value: unknown
): value is Record<string, unknown> & { itemRef: string; evidenceBand: string } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "action",
      "capability",
      "caveatCodes",
      "evidenceBand",
      "expiresAt",
      "itemRef",
      "kind",
      "observedAt",
      "summary",
      "title",
      "workContextRef"
    ]) ||
    !isItemRef(value.itemRef) ||
    !isNullableWorkContextRef(value.workContextRef) ||
    ![
      "recent_github_push",
      "recent_codex_session",
      "local_worktree",
      "linked_workstream",
      "workspace_mapping"
    ].includes(String(value.kind)) ||
    !isPublicText(value.title, 120) ||
    value.summary !== value.title ||
    !isCanonicalTimestamp(value.observedAt) ||
    !isCanonicalTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt as string) <=
      Date.parse(value.observedAt as string) ||
    !["exact", "corroborated", "single_source", "setup"].includes(
      String(value.evidenceBand)
    ) ||
    !["display", "open_source", "open_setup_surface"].includes(
      String(value.capability)
    ) ||
    !isCanonicalReasonCodes(value.caveatCodes)
  ) {
    return false;
  }
  if (value.capability === "display") return value.action === null;
  return (
    isPublicAction(value.action) &&
    value.action.capability === value.capability
  );
}

function isPublicAction(
  value: unknown
): value is Record<string, unknown> & { capability: string } {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "actionRef",
      "capability",
      "contract",
      "expiresAt",
      "explicitUserActionRequired"
    ]) &&
    value.contract === "continuation-public-action-ref-v0.1" &&
    typeof value.actionRef === "string" &&
    /^action_ref_[A-Za-z0-9_-]{22,128}$/u.test(value.actionRef) &&
    ["open_source", "open_setup_surface"].includes(
      String(value.capability)
    ) &&
    isCanonicalTimestamp(value.expiresAt) &&
    value.explicitUserActionRequired === true
  );
}

function isExecutionPolicy(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "automaticExecutionAllowed",
      "explicitUserActionRequired",
      "externalMutationAllowed"
    ]) &&
    value.automaticExecutionAllowed === false &&
    value.explicitUserActionRequired === true &&
    value.externalMutationAllowed === false
  );
}

function isCanonicalReasonCodes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (item) => typeof item === "string" && /^[A-Z0-9_]{1,80}$/u.test(item)
    ) &&
    value.every(
      (item, index) => index === 0 || String(value[index - 1]) < String(item)
    )
  );
}

function isPublicText(value: unknown, maxLength: number): value is string {
  return (
    isBoundedString(value, maxLength) &&
    value === value.trim() &&
    PUBLIC_TEXT_FORBIDDEN_PATTERNS.every((pattern) => !pattern.test(value))
  );
}

function isItemRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^item_ref_[A-Za-z0-9_-]{22,128}$/u.test(value)
  );
}

function isNullableWorkContextRef(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      /^context_ref_[A-Za-z0-9_-]{22,128}$/u.test(value))
  );
}

function laneRank(lane: PublicBoardLane): number {
  return lane === "attention" ? 0 : lane === "continuation" ? 1 : 2;
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: string[]
): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function invalidWorkBoardResponse(): WorkBoardApiResponse {
  return {
    status: "error",
    code: "WORK_BOARD_PREVIEW_FAILED",
    message: "Continuation shadow 응답을 검증하지 못했습니다."
  };
}

export async function submitAttentionFeedback(input: {
  runId: string;
  feedbackType: AttentionFeedbackType;
}): Promise<
  | { status: "recorded"; feedback: AttentionFeedbackRecord }
  | { status: "error"; code: string; message: string }
> {
  const response = await fetch("/api/attention/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return (await response.json()) as
    | { status: "recorded"; feedback: AttentionFeedbackRecord }
    | { status: "error"; code: string; message: string };
}
