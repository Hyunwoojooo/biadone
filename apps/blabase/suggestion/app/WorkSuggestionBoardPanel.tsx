"use client";

import { useEffect, useMemo, useState } from "react";

import type { WorkSuggestionBoardPublic } from "../src/suggestionBoard/contracts";
import type { WorkBoardReadyResponse } from "../src/suggestionBoard/monitoringSchema";
import type {
  SemanticContinuationTitlePresentation,
  SemanticContinuationWorkBoardResponse
} from "../src/semanticContinuation/contracts";
import { parseDisplayOnlyWorkBoard } from "./attentionClient";
import {
  isContinuationSetupOpenedResponse,
  requestContinuationSetupAction
} from "./continuationSetupActionClient";
import {
  submitWorkBoardMonitoringMutation,
  type BrowserWorkBoardMonitoringReceipt
} from "./workBoardMonitoringClient";

const LANE_ORDER = ["attention", "continuation", "setup"] as const;
export const WORK_BOARD_EXPIRY_TIMER_CHUNK_MS = 60_000;
export const WORK_BOARD_SETUP_ACTION_ERROR_COPY =
  "설정 화면을 열지 못했습니다. 제안을 새로 확인한 뒤 다시 시도해주세요.";

const LANE_COPY = {
  attention: {
    title: "지금 처리할 일",
    description: "기존 Active Attention이 확인한 항목"
  },
  continuation: {
    title: "이어서 할 일",
    description: "최근 작업 맥락에서 이어볼 항목"
  },
  setup: {
    title: "연결할 일",
    description: "작업공간 연결이 필요한 항목"
  }
} as const;

const EVIDENCE_COPY = {
  verified_attention: "검증된 Attention",
  exact: "정확한 작업 연결",
  corroborated: "여러 소스가 일치함",
  single_source: "단일 소스 근거",
  setup: "연결 필요"
} as const;

const CAVEAT_COPY = {
  CAVEAT_CANDIDATE_SET_INCOMPLETE: "후보 범위 일부",
  CAVEAT_DEFAULT_TIE_BREAK_USED: "동률 기준 적용",
  CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL: "GitHub 처리 가능성 일부",
  CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY: "실패 상태 확인 전용",
  CAVEAT_REVIEW_DRAFT_UNKNOWN: "초안 상태 확인 필요",
  CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES: "상위 객체는 후보에서 제외됨",
  EXPLICIT_MAPPING_CONFIRMATION_REQUIRED: "연결 확인 필요",
  IDENTITY_CLARIFICATION_REQUIRED: "작업 연결 확인 필요",
  SOURCE_COVERAGE_PARTIAL: "소스 범위 일부",
  SOURCE_COVERAGE_UNKNOWN: "소스 범위 확인 불가",
  SOURCE_METADATA_ONLY: "메타데이터만 확인됨",
  TERMINAL_STATE_UNKNOWN: "종료 상태 확인 불가"
} as const;

type Lane = (typeof LANE_ORDER)[number];
type BoardEntry = NonNullable<WorkSuggestionBoardPublic["primary"]>;

export function WorkSuggestionBoardPanel({
  response,
  loadError = null,
  loading = false,
  now,
  setupActionEnabled = false,
  monitoringReceipt = null,
  monitoringConsent = false,
  onMonitoringChanged
}: {
  response: SemanticContinuationWorkBoardResponse | null;
  loadError?: string | null;
  loading?: boolean;
  now?: Date;
  setupActionEnabled?: boolean;
  monitoringReceipt?: BrowserWorkBoardMonitoringReceipt | null;
  monitoringConsent?: boolean;
  onMonitoringChanged?: () => void;
}) {
  const [acknowledgedPresentationKey, setAcknowledgedPresentationKey] = useState<
    string | null
  >(null);
  const [clockMs, setClockMs] = useState<number | null>(() =>
    now === undefined ? null : now.getTime()
  );
  const parsed = useMemo(
    () => (response === null ? null : parseDisplayOnlyWorkBoard(response)),
    [response]
  );
  const monitoringReceiptCurrent =
    monitoringConsent &&
    monitoringReceipt !== null &&
    parsed !== null &&
    clockMs !== null &&
    clockMs >= Date.parse(monitoringReceipt.payload.issuedAt) &&
    clockMs < Date.parse(monitoringReceipt.payload.expiresAt);
  const expiryMs = useMemo(
    () =>
      clockMs === null
        ? null
        : nextExpiry(
            parsed,
            clockMs,
            monitoringConsent ? monitoringReceipt?.payload.expiresAt : undefined
          ),
    [parsed, clockMs, monitoringConsent, monitoringReceipt]
  );

  useEffect(() => {
    if (now !== undefined) {
      setClockMs(now.getTime());
      return;
    }
    setClockMs(Date.now());
  }, [now, response]);

  useEffect(() => {
    if (now !== undefined || expiryMs === null) return;
    return scheduleWorkBoardExpiryTicks(expiryMs, setClockMs);
  }, [expiryMs, now]);

  useEffect(() => {
    if (!monitoringReceiptCurrent || monitoringReceipt === null) {
      setAcknowledgedPresentationKey(null);
      return;
    }
    const presentationKey = monitoringPresentationKey(monitoringReceipt);
    if (acknowledgedPresentationKey === presentationKey) return;
    let current = true;
    void submitWorkBoardMonitoringMutation({
      operation: "render_confirmed",
      receipt: monitoringReceipt.receipt
    }).then(
      () => {
        if (!current) return;
        setAcknowledgedPresentationKey(presentationKey);
        onMonitoringChanged?.();
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [
    clockMs,
    acknowledgedPresentationKey,
    monitoringReceiptCurrent,
    monitoringReceipt,
    onMonitoringChanged,
    parsed
  ]);

  const feed =
    parsed === null || clockMs === null
      ? null
      : createDisplayFeed(parsed, clockMs);
  return (
    <section
      className="workSuggestionBoard"
      aria-labelledby="work-suggestion-board-title"
    >
      <header className="workSuggestionBoardHeader">
        <div>
          <p className="eyebrow">Work Board</p>
          <h2 id="work-suggestion-board-title">확인할 작업 제안</h2>
          <p>
            {setupActionEnabled
              ? "제안을 표시하며 연결 항목은 명시적으로 설정 화면만 엽니다."
              : "표시 전용이며 이 화면에서 실행하거나 변경하지 않습니다."}
          </p>
        </div>
        {feed === null ? null : (
          <time dateTime={feed.generatedAt}>
            제안 평가 {formatTimestamp(feed.generatedAt)}
          </time>
        )}
      </header>

      {(loading && response === null && loadError === null) ||
      (parsed !== null && clockMs === null) ? (
        <p className="workSuggestionEmpty" role="status">
          작업 제안을 불러오고 있습니다.
        </p>
      ) : loadError !== null || feed === null ? (
        <p className="workSuggestionBoardError" role="alert">
          {loadError ?? "작업 제안을 표시하지 못했습니다."}
        </p>
      ) : (
        <div className="workSuggestionBoardLanes">
          {LANE_ORDER.map((lane) => (
            <LaneColumn
              key={lane}
              lane={lane}
              items={feed.lanes[lane]}
              setupActionEnabled={setupActionEnabled}
              monitoringReceipt={monitoringReceipt}
              monitoringReady={
                monitoringReceiptCurrent &&
                monitoringReceipt !== null &&
                acknowledgedPresentationKey ===
                  monitoringPresentationKey(monitoringReceipt)
              }
              onMonitoringChanged={onMonitoringChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function monitoringPresentationKey(
  receipt: BrowserWorkBoardMonitoringReceipt
): string {
  return JSON.stringify({
    mode: receipt.payload.mode,
    fallbackReasonCode: receipt.payload.fallbackReasonCode,
    continuationStatus: receipt.payload.continuationStatus,
    items: receipt.payload.items.map((item) => item.presentationTargetHmac)
  });
}

export function scheduleWorkBoardExpiryTicks(
  expiresAtMs: number,
  onTick: (nowMs: number) => void,
  runtime: {
    now: () => number;
    schedule: (callback: () => void, delayMs: number) => unknown;
    cancel: (handle: unknown) => void;
  } = {
    now: () => Date.now(),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle as number)
  }
): () => void {
  let timer: unknown = null;
  let cancelled = false;
  const scheduleNext = () => {
    if (cancelled) return;
    const remainingMs = expiresAtMs - runtime.now();
    const delayMs = Math.min(
      WORK_BOARD_EXPIRY_TIMER_CHUNK_MS,
      Math.max(0, remainingMs) + 1
    );
    timer = runtime.schedule(() => {
      if (cancelled) return;
      const currentTime = runtime.now();
      onTick(currentTime);
      if (currentTime < expiresAtMs) scheduleNext();
    }, delayMs);
  };
  scheduleNext();
  return () => {
    cancelled = true;
    if (timer !== null) runtime.cancel(timer);
  };
}

function LaneColumn({
  lane,
  items,
  setupActionEnabled,
  monitoringReceipt,
  monitoringReady,
  onMonitoringChanged
}: {
  lane: Lane;
  items: DisplayItem[];
  setupActionEnabled: boolean;
  monitoringReceipt: BrowserWorkBoardMonitoringReceipt | null;
  monitoringReady: boolean;
  onMonitoringChanged?: () => void;
}) {
  const copy = LANE_COPY[lane];
  return (
    <section className={`workSuggestionLane workSuggestionLane-${lane}`}>
      <h3>{copy.title}</h3>
      <p>{copy.description}</p>
      {items.length === 0 ? (
        <p className="workSuggestionEmpty">표시할 제안 없음</p>
      ) : (
        <ol>
          {items.map((item, index) => (
            <li key={`${lane}-${index}`}>
              <h4>{item.title}</h4>
              <p>{EVIDENCE_COPY[item.evidenceBand]}</p>
              {item.caveatCodes.length === 0 ? null : (
                <ul aria-label="제안 주의사항">
                  {item.caveatCodes.map((code) => (
                    <li key={code}>{CAVEAT_COPY[code]}</li>
                  ))}
                </ul>
              )}
              {lane === "setup" && setupActionEnabled ? (
                <SetupSurfaceAction key={item.itemRef} itemRef={item.itemRef} />
              ) : null}
              {(lane === "continuation" || lane === "setup") &&
              monitoringReady &&
              monitoringReceipt !== null ? (
                <MonitoringFeedbackActions
                  receipt={monitoringReceipt.receipt}
                  ordinal={item.ordinal}
                  onChanged={onMonitoringChanged}
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type EvidenceBand = keyof typeof EVIDENCE_COPY;
type CaveatCode = keyof typeof CAVEAT_COPY;
type DisplayItem = {
  ordinal: number;
  itemRef: string;
  title: string;
  evidenceBand: EvidenceBand;
  caveatCodes: CaveatCode[];
};

function createDisplayFeed(
  response: SemanticContinuationWorkBoardResponse,
  nowMs: number
) {
  if (response.base.status !== "ready") return null;
  const entries = orderedEntries(response.base);
  const overlayByItemRef = overlayMap(response.semanticPresentation);
  const lanes: Record<Lane, DisplayItem[]> = {
    attention: [],
    continuation: [],
    setup: []
  };
  for (const [ordinal, entry] of entries.entries()) {
    if (isExpired(entry, nowMs)) continue;
    const title =
      entry.lane === "continuation"
        ? (overlayByItemRef.get(entry.item.itemRef) ?? entry.item.title)
        : entry.item.title;
    lanes[entry.lane].push({
      ordinal,
      itemRef: entry.item.itemRef,
      title,
      evidenceBand: entry.item.evidenceBand as EvidenceBand,
      caveatCodes: [...entry.item.caveatCodes] as CaveatCode[]
    });
  }
  return { generatedAt: response.base.board.generatedAt, lanes };
}

function MonitoringFeedbackActions({
  receipt,
  ordinal,
  onChanged
}: {
  receipt: string;
  ordinal: number;
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submit = async (
    operation: "useful" | "not_useful" | "reset"
  ) => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await submitWorkBoardMonitoringMutation(
        operation === "reset"
          ? {
              operation: "reset",
              receipt,
              ordinal,
              explicitUserAction: true
            }
          : {
              operation: "feedback",
              receipt,
              ordinal,
              feedback: operation,
              reason: null,
              explicitUserAction: true
            }
      );
      onChanged?.();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="workBoardMonitoringFeedback" aria-busy={pending}>
      <button type="button" disabled={pending} onClick={() => void submit("useful")}>
        유용함
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => void submit("not_useful")}
      >
        유용하지 않음
      </button>
      <button type="button" disabled={pending} onClick={() => void submit("reset")}>
        피드백 초기화
      </button>
      {error ? <p role="alert">피드백을 기록하지 못했습니다.</p> : null}
    </div>
  );
}

type SetupActionState = "idle" | "pending" | "opened" | "error";

function SetupSurfaceAction({ itemRef }: { itemRef: string }) {
  const [state, setState] = useState<SetupActionState>("idle");
  const openSetupSurface = useMemo(
    () => createWorkSuggestionSetupActionActivation(itemRef, setState),
    [itemRef]
  );

  const isDisabled = state !== "idle";
  return (
    <div className="workSuggestionSetupAction" aria-busy={state === "pending"}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => void openSetupSurface()}
      >
        {state === "pending" || state === "opened"
          ? "설정 화면 여는 중"
          : state === "error"
            ? "설정 화면 열기 실패"
            : "설정 화면 열기"}
      </button>
      {state === "error" ? (
        <p role="alert">{WORK_BOARD_SETUP_ACTION_ERROR_COPY}</p>
      ) : null}
    </div>
  );
}

export async function runWorkSuggestionSetupAction(
  itemRef: string,
  request: (input: {
    itemRef: string;
    explicitUserAction: true;
  }) => Promise<unknown> = requestContinuationSetupAction,
  navigate: (path: "/projects") => void = (path) => window.location.assign(path)
): Promise<void> {
  const opened = await request({ itemRef, explicitUserAction: true });
  if (!isContinuationSetupOpenedResponse(opened)) {
    throw new TypeError("Invalid setup action response.");
  }
  navigate("/projects");
}

export function createWorkSuggestionSetupActionActivation(
  itemRef: string,
  setState: (state: SetupActionState) => void,
  run: (itemRef: string) => Promise<void> = runWorkSuggestionSetupAction
): () => Promise<void> {
  let inFlight = false;
  let attempted = false;
  return async () => {
    if (inFlight || attempted) return;
    inFlight = true;
    attempted = true;
    setState("pending");
    try {
      await run(itemRef);
      setState("opened");
    } catch {
      setState("error");
    } finally {
      inFlight = false;
    }
  };
}

function orderedEntries(response: WorkBoardReadyResponse): BoardEntry[] {
  return [
    ...(response.board.primary === null ? [] : [response.board.primary]),
    ...response.board.alternatives
  ];
}

function overlayMap(
  presentation: SemanticContinuationTitlePresentation | null
): Map<string, string> {
  return new Map(
    (presentation?.overlays ?? []).map((overlay) => [
      overlay.itemRef,
      overlay.displayTitle
    ])
  );
}

function isExpired(entry: BoardEntry, nowMs: number): boolean {
  return (
    entry.item.expiresAt !== null && nowMs >= Date.parse(entry.item.expiresAt)
  );
}

function nextExpiry(
  response: SemanticContinuationWorkBoardResponse | null,
  nowMs: number,
  monitoringExpiresAt?: string
): number | null {
  if (response?.base.status !== "ready") return null;
  const future = orderedEntries(response.base)
    .map((entry) => entry.item.expiresAt)
    .filter((value): value is string => value !== null)
    .map(Date.parse)
    .filter((value) => value > nowMs);
  if (monitoringExpiresAt !== undefined) {
    const monitoringExpiry = Date.parse(monitoringExpiresAt);
    if (monitoringExpiry > nowMs) future.push(monitoringExpiry);
  }
  return future.length === 0 ? null : Math.min(...future);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
