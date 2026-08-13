import type {
  AttentionApiResponse,
  AttentionFeedbackRecord,
  AttentionFeedbackType,
  AttentionHistoryResponse
} from "../src/attention/monitoringSchema";
import type { WorkBoardApiResponse } from "../src/suggestionBoard/monitoringSchema";
import { isWorkSuggestionBoardPublicOutputTextSafe } from "../src/suggestionBoard/publicTextSafety";
import type { SemanticContinuationWorkBoardResponse } from "../src/semanticContinuation/contracts";

export type WorkBoardIntentConfirmationResponse =
  | {
      status: "confirmed";
      intent: "QA_RUN";
      title: string;
      expiresAt: string;
    }
  | {
      status: "error";
      code: string;
    };

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

export async function fetchWorkBoard(): Promise<SemanticContinuationWorkBoardResponse> {
  const response = await fetch("/api/work-board", { cache: "no-store" });
  return parseWorkBoardResponse(await response.json());
}

export class WorkBoardDisplayRequestError extends Error {
  constructor() {
    super("WORK_BOARD_DISPLAY_UNAVAILABLE");
    this.name = "WorkBoardDisplayRequestError";
  }
}

export async function fetchDisplayOnlyWorkBoard(): Promise<SemanticContinuationWorkBoardResponse> {
  const response = await fetch("/api/work-board", { cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new WorkBoardDisplayRequestError();
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new WorkBoardDisplayRequestError();
  }
  const parsed = parseWorkBoardResponse(value);
  if (
    parsed.base.status !== "ready" ||
    !isDisplayOnlyWorkBoardFeed(parsed)
  ) {
    throw new WorkBoardDisplayRequestError();
  }
  return parsed;
}

export function parseDisplayOnlyWorkBoard(
  value: unknown
): SemanticContinuationWorkBoardResponse | null {
  const parsed = parseWorkBoardResponse(value);
  return parsed.base.status === "ready" && isDisplayOnlyWorkBoardFeed(parsed)
    ? parsed
    : null;
}

export async function confirmWorkBoardIntent(input: {
  intent: "QA_RUN";
  subjectLabel: string;
  itemRef: string;
  workContextRef: string;
  explicitUserConfirmation: true;
}): Promise<WorkBoardIntentConfirmationResponse> {
  const response = await fetch("/api/work-board/intent", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const value: unknown = await response.json();
  if (
    isRecord(value) &&
    value.status === "confirmed" &&
    hasExactKeys(value, ["expiresAt", "intent", "status", "title"]) &&
    value.intent === "QA_RUN" &&
    isSafeSemanticContinuationPublicTitle(value.title) &&
    isCanonicalTimestamp(value.expiresAt)
  ) {
    return value as WorkBoardIntentConfirmationResponse;
  }
  if (
    isRecord(value) &&
    value.status === "error" &&
    hasExactKeys(value, ["code", "status"]) &&
    typeof value.code === "string" &&
    /^WORK_BOARD_INTENT_[A-Z_]+$/u.test(value.code)
  ) {
    return value as WorkBoardIntentConfirmationResponse;
  }
  return { status: "error", code: "WORK_BOARD_INTENT_INVALID_RESPONSE" };
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

const DISPLAY_EVIDENCE_BANDS = new Set([
  "verified_attention",
  "exact",
  "corroborated",
  "single_source",
  "setup"
]);

const DISPLAY_CAVEAT_CODES = new Set([
  "CAVEAT_CANDIDATE_SET_INCOMPLETE",
  "CAVEAT_DEFAULT_TIE_BREAK_USED",
  "CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL",
  "CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY",
  "CAVEAT_REVIEW_DRAFT_UNKNOWN",
  "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES",
  "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED",
  "IDENTITY_CLARIFICATION_REQUIRED",
  "SOURCE_COVERAGE_PARTIAL",
  "SOURCE_COVERAGE_UNKNOWN",
  "SOURCE_METADATA_ONLY",
  "TERMINAL_STATE_UNKNOWN"
]);

const PUBLIC_BOARD_PRIVATE_REF_PATTERN =
  /(?:action_ref|analysis|artifact|attention|binding|board_item|board_source|candidate|claim|command|connection|context_ref|continuation_context_link|continuation_offer|continuation_run|execution|focus|github_repo|input_sha|instance|item_ref|managed_event|mapping|observation_sha|private_target|project|proof|repository|result_sha|root|scope|settlement|source_record_ref|stream|sync|thread|user|work_board|work_context|work_item|workstream)_[A-Za-z0-9_-]+/iu;
const SEMANTIC_SUBJECT_FORBIDDEN_PATTERNS = [
  /[\p{Cc}\p{Cf}\p{Cs}]/u,
  /[\\/]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:action_ref|analysis|artifact|artifact_relation|attention|attention_assessment|attention_clarification|attention_result|attribution|binding|blocker|board_item|board_source|candidate_funnel|claim|claim_conflict|claim_evidence|claim_key|claim_lineage|claim_resolution|claim_subject|command|connection|context_ref|continuation_candidate|continuation_context_link|continuation_observation|continuation_offer|continuation_run|elig|evidence|execution|focus|focus_evidence|focus_identity|focus_subject|github_repo|installation_key|instance|item_ref|ledger_evidence|local_commit|local_repo|managed_event|managed_run|managed_settlement|mapping|next_action|open_loop|outcome|private_target|project|proposal|recent_event|relation|repository_scope_link|root|run|scope_binding_ref|seed|semantic_entry|semantic_evidence|semantic_intent|session|settlement|sig|source_record_ref|source_ref|stream|sync|thread|transition|user|client|app|work_board|work_item|work_ledger|workflow_closure|workflow_decision|workstream)_[A-Za-z0-9_-]+/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/u,
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/u,
  /\b(?:token|api[ _-]?key|access[ _-]?(?:key|token)|password|secret)\s*[:=]\s*["']?[^\s,;"']+/iu
];
const SEMANTIC_SUBJECT_FORBIDDEN_MEANING_FRAGMENTS = [
  "결과",
  "반영",
  "통과",
  "실패",
  "완료",
  "성공",
  "종료",
  "실행",
  "순위",
  "텔레메트리",
  "pass",
  "fail",
  "failure",
  "complete",
  "completion",
  "done",
  "finish",
  "success",
  "succeed",
  "result",
  "apply",
  "execute",
  "execution",
  "rank",
  "action",
  "telemetry"
] as const;

function parseWorkBoardResponse(
  value: unknown
): SemanticContinuationWorkBoardResponse {
  if (
    isRecord(value) &&
    hasExactKeys(value, [
      "base",
      "contract",
      "schemaVersion",
      "semanticPresentation"
    ])
  ) {
    const base = parseBaseWorkBoardResponse(value.base);
    if (
      base === value.base &&
      value.contract ===
        "semantic-continuation-work-board-response-v0.2" &&
      value.schemaVersion ===
        "semantic-continuation-presentation-schema-v0.2" &&
      isSemanticPresentation(value.semanticPresentation, base)
    ) {
      return value as SemanticContinuationWorkBoardResponse;
    }
  }
  return invalidWorkBoardResponse();
}

function isSemanticPresentation(
  value: unknown,
  base: WorkBoardApiResponse
): boolean {
  if (value === null) return true;
  if (
    base.status !== "ready" ||
    base.mode !== "full" ||
    !isRecord(value) ||
    !hasExactKeys(value, [
      "baseGeneratedAt",
      "contract",
      "overlays",
      "schemaVersion"
    ]) ||
    value.contract !== "semantic-continuation-presentation-v0.2" ||
    value.schemaVersion !==
      "semantic-continuation-presentation-schema-v0.2" ||
    value.baseGeneratedAt !== base.board.generatedAt ||
    !Array.isArray(value.overlays) ||
    value.overlays.length < 1 ||
    value.overlays.length > 3
  ) {
    return false;
  }
  const items = [
    ...(base.board.primary === null ? [] : [base.board.primary]),
    ...base.board.alternatives
  ];
  const positions = value.overlays.map((overlay) => {
    if (
      !isRecord(overlay) ||
      !hasExactKeys(overlay, ["displayTitle", "itemRef"]) ||
      !isItemRef(overlay.itemRef) ||
      !isSafeSemanticContinuationPublicTitle(overlay.displayTitle)
    ) {
      return -1;
    }
    return items.findIndex((entry) => {
      const item = entry.item as Record<string, unknown>;
      return (
        entry.lane === "continuation" &&
        item.itemRef === overlay.itemRef &&
        item.workContextRef !== null &&
        item.capability === "display" &&
        item.action === null
      );
    });
  });
  return positions.every(
    (position, index) =>
      position >= 0 && (index === 0 || positions[index - 1]! < position)
  );
}

function isDisplayOnlyWorkBoardFeed(
  response: SemanticContinuationWorkBoardResponse
): boolean {
  if (response.base.status !== "ready") return false;
  const board = response.base.board;
  const items = [
    ...(board.primary === null ? [] : [board.primary]),
    ...board.alternatives
  ];
  if (
    board.executionPolicy.automaticExecutionAllowed !== false ||
    board.executionPolicy.externalMutationAllowed !== false ||
    board.executionPolicy.explicitUserActionRequired !== true ||
    items.some(
      (entry) =>
        entry.item.capability !== "display" ||
        entry.item.action !== null ||
        !DISPLAY_EVIDENCE_BANDS.has(entry.item.evidenceBand) ||
        entry.item.caveatCodes.some(
          (code) => !DISPLAY_CAVEAT_CODES.has(code)
        )
    )
  ) {
    return false;
  }
  if (response.semanticPresentation === null) return true;
  const overlayRefs = response.semanticPresentation.overlays.map(
    (overlay) => overlay.itemRef
  );
  return (
    new Set(overlayRefs).size === overlayRefs.length &&
    overlayRefs.every((itemRef) =>
      items.some(
        (entry) =>
          entry.lane === "continuation" &&
          entry.item.itemRef === itemRef &&
          entry.item.capability === "display" &&
          entry.item.action === null
      )
    )
  );
}

export function semanticContinuationTitlePreview(
  subjectLabel: string
): string | null {
  if (
    subjectLabel.length < 1 ||
    subjectLabel.length > 80 ||
    subjectLabel !== subjectLabel.trim() ||
    SEMANTIC_SUBJECT_FORBIDDEN_PATTERNS.some((pattern) =>
      pattern.test(subjectLabel)
    ) ||
    containsForbiddenSemanticSubjectMeaning(subjectLabel)
  ) {
    return null;
  }
  const title = `${subjectLabel} QA 진행하기`;
  return title.length <= 120 ? title : null;
}

function containsForbiddenSemanticSubjectMeaning(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
  return SEMANTIC_SUBJECT_FORBIDDEN_MEANING_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment)
  );
}

function isSafeSemanticContinuationPublicTitle(
  value: unknown
): value is string {
  if (
    value === "QA 진행 상태 확인하기" ||
    value === "QA 실패 항목 검토하기" ||
    value === "QA 통과 결과 확인하기"
  ) {
    return true;
  }
  if (typeof value !== "string" || !value.endsWith(" QA 진행하기")) {
    return false;
  }
  const label = value.slice(0, -" QA 진행하기".length);
  return semanticContinuationTitlePreview(label) === value;
}

function parseBaseWorkBoardResponse(value: unknown): WorkBoardApiResponse {
  if (!isRecord(value) || typeof value.status !== "string") {
    return invalidBaseWorkBoardResponse();
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
  return invalidBaseWorkBoardResponse();
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
    isWorkSuggestionBoardPublicOutputTextSafe(value) &&
    !PUBLIC_BOARD_PRIVATE_REF_PATTERN.test(value)
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

function invalidBaseWorkBoardResponse(): WorkBoardApiResponse {
  return {
    status: "error",
    code: "WORK_BOARD_PREVIEW_FAILED",
    message: "Continuation shadow 응답을 검증하지 못했습니다."
  };
}

function invalidWorkBoardResponse(): SemanticContinuationWorkBoardResponse {
  return {
    contract: "semantic-continuation-work-board-response-v0.2",
    schemaVersion: "semantic-continuation-presentation-schema-v0.2",
    base: invalidBaseWorkBoardResponse(),
    semanticPresentation: null
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
