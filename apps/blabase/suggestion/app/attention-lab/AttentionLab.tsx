"use client";

import Link from "next/link";
import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  AttentionApiResponse,
  AttentionHistoryEntry,
  AttentionHistoryResponse
} from "../../src/attention/monitoringSchema";
import type {
  AttentionEligibilityAssessment,
  AttentionEligibilityShadowProjection
} from "../../src/eligibility/contracts";
import type {
  WorkBoardApiResponse,
  WorkBoardReadyResponse
} from "../../src/suggestionBoard/monitoringSchema";
import type {
  SemanticContinuationTitlePresentation,
  SemanticContinuationWorkBoardResponse
} from "../../src/semanticContinuation/contracts";
import {
  confirmWorkBoardIntent,
  fetchAttention,
  fetchAttentionHistory,
  fetchWorkBoard,
  semanticContinuationTitlePreview
} from "../attentionClient";
import { syncInvalidationBus } from "../sync/invalidationBus";
import {
  useSourceSyncRuntime,
  useSyncInvalidation,
  useVisiblePolling,
  wakeSourceSyncStatus
} from "../sync/useSourceSync";

export function AttentionLab({
  semanticWriteEnabled = false
}: {
  semanticWriteEnabled?: boolean;
}) {
  const [current, setCurrent] = useState<AttentionApiResponse | null>(
    null
  );
  const [history, setHistory] =
    useState<AttentionHistoryResponse | null>(null);
  const [workBoard, setWorkBoard] =
    useState<SemanticContinuationWorkBoardResponse | null>(null);
  const [workBoardLoadFailed, setWorkBoardLoadFailed] =
    useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const interactiveSequenceRef = useRef<number | null>(null);
  const continuationSuggestionRef = useRef<HTMLElement>(null);
  const didRevealContinuationRef = useRef(false);
  useSourceSyncRuntime();

  const loadPreview = useCallback(async (silent = false) => {
    if (silent && interactiveSequenceRef.current !== null) return;
    const sequence = ++sequenceRef.current;
    if (!silent) {
      interactiveSequenceRef.current = sequence;
      setIsLoading(true);
      setLoadError(null);
      setWorkBoardLoadFailed(false);
    }
    try {
      const [nextCurrent, nextHistory, nextWorkBoard] = await Promise.all([
        fetchAttention(false),
        fetchAttentionHistory(),
        fetchWorkBoard().catch(() => null)
      ]);
      if (sequence !== sequenceRef.current) return;
      setCurrent(nextCurrent);
      setHistory(nextHistory);
      setWorkBoard(nextWorkBoard);
      setWorkBoardLoadFailed(nextWorkBoard === null);
      if (
        nextHistory.status === "ready" &&
        nextHistory.entries.length > 0
      ) {
        setSelectedRunId((selected) =>
          selected &&
          nextHistory.entries.some((entry) => entry.runId === selected)
            ? selected
            : nextHistory.entries[0].runId
        );
      }
    } catch {
      if (sequence !== sequenceRef.current) return;
      if (!silent) {
        setWorkBoard(null);
        setWorkBoardLoadFailed(true);
        setLoadError(
          "Attention 실행 기록을 불러오지 못했습니다. 로컬 서버 상태를 확인해주세요."
        );
      }
    } finally {
      if (
        !silent &&
        interactiveSequenceRef.current === sequence
      ) {
        interactiveSequenceRef.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  const runAttention = useCallback(async (): Promise<boolean> => {
    const sequence = ++sequenceRef.current;
    interactiveSequenceRef.current = sequence;
    setIsRefreshing(true);
    setLoadError(null);
    setWorkBoardLoadFailed(false);
    try {
      const attention = await fetchAttention(true);
      if (sequence !== sequenceRef.current) return false;
      setCurrent(attention);

      const [nextHistory, nextWorkBoard] = await Promise.all([
        fetchAttentionHistory(),
        fetchWorkBoard().catch(() => null)
      ]);
      if (sequence !== sequenceRef.current) return false;
      setHistory(nextHistory);
      setWorkBoard(nextWorkBoard);
      setWorkBoardLoadFailed(nextWorkBoard === null);
      if (
        nextHistory.status === "ready" &&
        nextHistory.entries.length > 0
      ) {
        setSelectedRunId(nextHistory.entries[0].runId);
      }
      return attention.status !== "error";
    } catch {
      if (sequence !== sequenceRef.current) return false;
      setWorkBoard(null);
      setWorkBoardLoadFailed(true);
      setLoadError(
        "새 평가 또는 실행 기록을 갱신하지 못했습니다. 로컬 서버 상태를 확인해주세요."
      );
      return false;
    } finally {
      if (interactiveSequenceRef.current === sequence) {
        interactiveSequenceRef.current = null;
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }, []);

  const refreshSources = useCallback(async () => {
    const updated = await runAttention();
    if (!updated) return;
    syncInvalidationBus.invalidate({
      reason: "manual_refresh",
      targets: ["github", "codex", "attention", "timeline"]
    });
    wakeSourceSyncStatus();
  }, [runAttention]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useSyncInvalidation(["attention"], () => {
    void loadPreview(true);
  });

  useVisiblePolling(() => loadPreview(true), {
    intervalMs: 30_000,
    maxBackoffMs: 120_000,
    runImmediately: false
  });

  useEffect(() => {
    if (
      didRevealContinuationRef.current ||
      !hasReadyContinuationPrimary(workBoard?.base ?? null)
    ) {
      return;
    }
    didRevealContinuationRef.current = true;

    const panel = continuationSuggestionRef.current;
    const activeElement = document.activeElement;
    const anotherAnchorWasRequested =
      window.location.hash !== "" &&
      window.location.hash !== "#continuation-suggestion";
    if (
      panel === null ||
      anotherAnchorWasRequested ||
      (activeElement !== null && activeElement !== document.body)
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
        block: "start"
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [workBoard]);

  const selectedEntry = useMemo(() => {
    if (history?.status !== "ready") return null;
    return (
      history.entries.find((entry) => entry.runId === selectedRunId) ??
      history.entries[0] ??
      null
    );
  }, [history, selectedRunId]);

  return (
    <main className="labShell" id="main-content">
      <header className="labIntro">
        <div>
          <p className="eyebrow">Engine observability</p>
          <h1>Attention Lab</h1>
          <p>
            추천 결과가 만들어진 범위, 후보 funnel, reason code와 명시적
            피드백을 확인합니다. 원문과 private URL은 history에 저장하지
            않습니다.
          </p>
        </div>
        <div className="labIntroActions">
          <button
            type="button"
            onClick={() => void refreshSources()}
            disabled={isLoading || isRefreshing}
          >
            {isRefreshing
              ? "연결된 소스 갱신 중"
              : "연결된 소스 새로고침 후 평가"}
          </button>
          <Link href="/">Work Cockpit으로 돌아가기</Link>
        </div>
      </header>

      {isLoading && history === null ? (
        <div className="labLoading" role="status">
          최근 Attention 실행을 불러오고 있습니다.
        </div>
      ) : null}

      {loadError ? (
        <div className="labError" role="alert">
          {loadError}
        </div>
      ) : null}

      {current?.status === "error" ? (
        <div className="labError" role="alert">
          현재 실행 실패 · {current.code}
        </div>
      ) : null}

      {current?.status === "unavailable" ? (
        <div className="labNotice">
          {current.message} <a href={current.localUrl}>로컬 주소 열기</a>
        </div>
      ) : null}

      {history?.status === "error" ? (
        <div className="labError" role="alert">
          {history.message}
        </div>
      ) : null}

      {history?.status === "unavailable" ? (
        <div className="labNotice">{history.message}</div>
      ) : null}

      <ContinuationShadowPanel
        response={workBoard?.base ?? null}
        semanticPresentation={workBoard?.semanticPresentation ?? null}
        loadFailed={workBoardLoadFailed}
        activeDecisionStatus={
          current?.status === "ready"
            ? current.result.decision.status
            : null
        }
        panelRef={continuationSuggestionRef}
        onIntentConfirmed={() => loadPreview(true)}
        semanticWriteEnabled={semanticWriteEnabled}
      />
      <CurrentFocusDiagnosticsPanel response={current} />
      <EligibilityShadowPanel
        projection={
          current?.status === "ready"
            ? current.eligibilityProjection
            : null
        }
      />
      <DeveloperSignalPanel response={current} />
      <ActiveDecisionPanel response={current} />

      {history?.status === "ready" ? (
        <>
          <LabSummary history={history} current={current} />
          <section className="labWorkspace" aria-label="Attention 실행 기록">
            <RecentRuns
              entries={history.entries}
              selectedRunId={selectedEntry?.runId ?? null}
              onSelect={setSelectedRunId}
            />
            <RunInspector entry={selectedEntry} current={current} />
          </section>
          <p className="labRetentionNote">
            최근 {history.retentionDays}일의 metadata-only 기록입니다. 사용자
            피드백은 평가 후보이며 자동으로 Golden Dataset에 반영되지
            않습니다.
          </p>
        </>
      ) : null}
    </main>
  );
}

type WorkBoardDisplayItem = NonNullable<
  WorkBoardReadyResponse["board"]["primary"]
>;

export function ContinuationShadowPanel({
  response,
  loadFailed,
  activeDecisionStatus,
  panelRef,
  onIntentConfirmed,
  semanticPresentation = null,
  semanticWriteEnabled = false
}: {
  response: WorkBoardApiResponse | null;
  loadFailed: boolean;
  activeDecisionStatus: AttentionHistoryEntry["decisionStatus"] | null;
  panelRef?: RefObject<HTMLElement | null>;
  onIntentConfirmed?: () => Promise<void> | void;
  semanticPresentation?: SemanticContinuationTitlePresentation | null;
  semanticWriteEnabled?: boolean;
}) {
  const state = continuationShadowState(response, loadFailed);
  const suggestionLabel = continuationSuggestionLabel(response, state.label);

  return (
    <section
      className="labEligibilityPanel labContinuationDecisionPanel"
      id="continuation-suggestion"
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="continuation-shadow-title"
      aria-live="polite"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Read-only preview</p>
          <h2 id="continuation-shadow-title">Continuation shadow</h2>
        </div>
        <span>{suggestionLabel}</span>
      </div>
      <p className="labEligibilityBoundary">
        Continuation Board와 기존 Active Attention은 서로 다른 평가
        경로입니다. 명시적으로 확인한 QA 제목만 로컬에 최대 24시간
        저장할 수 있으며, 항목 실행·결과 반영·외부 변경은 하지 않습니다.
      </p>

      <div
        className="labFocusComparison"
        aria-label="Continuation과 Active Attention 상태 비교"
      >
        <div>
          <span>우선 표시 · Read-only</span>
          <strong>{suggestionLabel}</strong>
        </div>
        <div>
          <span>기존 판정 · 유지</span>
          <strong>
            {activeAttentionStatusLabel(activeDecisionStatus)}
          </strong>
        </div>
        <div>
          <span>Board mode</span>
          <strong>{state.label}</strong>
        </div>
      </div>

      {response?.status === "ready" ? (
        <WorkBoardPreview
          response={response}
          semanticPresentation={semanticPresentation}
          onIntentConfirmed={onIntentConfirmed}
          semanticWriteEnabled={semanticWriteEnabled}
        />
      ) : (
        <p className="labEmpty" role={loadFailed ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </section>
  );
}

function WorkBoardPreview({
  response,
  semanticPresentation,
  onIntentConfirmed,
  semanticWriteEnabled
}: {
  response: WorkBoardReadyResponse;
  semanticPresentation: SemanticContinuationTitlePresentation | null;
  onIntentConfirmed?: () => Promise<void> | void;
  semanticWriteEnabled: boolean;
}) {
  const { board } = response;
  const primaryDisplayTitle =
    board.primary === null
      ? null
      : semanticDisplayTitle(board.primary, semanticPresentation);
  return (
    <>
      {response.mode === "active_only_fallback" ? (
        <p className="labEligibilityCoverage">
          Continuation 결과를 사용할 수 없어 검증된 Attention 항목만
          표시합니다.
        </p>
      ) : null}

      <div
        className="labFocusComparison"
        aria-label="Continuation shadow 상태"
      >
        <div>
          <span>generatedAt</span>
          <strong>{formatTimestamp(board.generatedAt)}</strong>
        </div>
        <div>
          <span>prominent lane</span>
          <strong>{workBoardLaneLabel(board.prominentLane)}</strong>
        </div>
        <div>
          <span>continuation status</span>
          <strong>
            {continuationAvailabilityLabel(board.continuationStatus)}
          </strong>
        </div>
      </div>

      {board.primary ? (
        <article className="labFocusSelection">
          <div>
            <span>Primary · {workBoardLaneLabel(board.primary.lane)}</span>
            <strong>{primaryDisplayTitle}</strong>
          </div>
          <dl>
            <div>
              <dt>lane</dt>
              <dd>{workBoardLaneLabel(board.primary.lane)}</dd>
            </div>
            <div>
              <dt>position</dt>
              <dd>Board primary</dd>
            </div>
            {board.primary.item.summary !== primaryDisplayTitle ? (
              <div>
                <dt>summary</dt>
                <dd>{board.primary.item.summary}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      ) : (
        <p className="labEmpty">현재 Board에 표시할 primary가 없습니다.</p>
      )}

      {semanticWriteEnabled && semanticIntentEligiblePrimary(response) ? (
        <SemanticContinuationIntentForm
          key={`${response.board.primary.item.itemRef}:${response.board.primary.item.workContextRef}:${board.generatedAt}`}
          item={response.board.primary}
          baseGeneratedAt={board.generatedAt}
          onConfirmed={onIntentConfirmed}
        />
      ) : null}

      {board.alternatives.length > 0 ? (
        <ol className="labActiveRanking" aria-label="Board alternatives">
          {board.alternatives.map((alternative, index) => (
            <li key={`${alternative.lane}-${index}`}>
              <span>대안 {index + 1}</span>
              <div>
                <strong>
                  {semanticDisplayTitle(
                    alternative,
                    semanticPresentation
                  )}
                </strong>
                <small>
                  {workBoardLaneLabel(alternative.lane)}
                  {alternative.item.summary !==
                  semanticDisplayTitle(alternative, semanticPresentation)
                    ? ` · ${alternative.item.summary}`
                    : ""}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="labEligibilityCoverage">
          표시할 alternative가 없습니다.
        </p>
      )}
    </>
  );
}

function SemanticContinuationIntentForm({
  item,
  baseGeneratedAt,
  onConfirmed
}: {
  item: WorkBoardDisplayItem;
  baseGeneratedAt: string;
  onConfirmed?: () => Promise<void> | void;
}) {
  const [subjectLabel, setSubjectLabel] = useState("");
  const [state, setState] = useState<
    "idle" | "saving" | "confirmed" | "error"
  >("idle");
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const previewTitle = semanticContinuationTitlePreview(subjectLabel);
  const workContextRef = item.item.workContextRef;
  const targetGeneration = `${item.item.itemRef}:${workContextRef ?? "none"}:${baseGeneratedAt}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [targetGeneration]);
  if (
    item.lane !== "continuation" ||
    workContextRef === null
  ) {
    return null;
  }
  const confirmedWorkContextRef: string = workContextRef;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestGeneration = ++requestGenerationRef.current;
    setState("saving");
    try {
      const response = await confirmWorkBoardIntent({
        intent: "QA_RUN",
        subjectLabel,
        itemRef: item.item.itemRef,
        workContextRef: confirmedWorkContextRef,
        explicitUserConfirmation: true
      });
      if (
        !mountedRef.current ||
        requestGenerationRef.current !== requestGeneration
      ) {
        return;
      }
      if (response.status !== "confirmed") {
        setState("error");
        return;
      }
      setState("confirmed");
      await onConfirmed?.();
    } catch {
      if (
        !mountedRef.current ||
        requestGenerationRef.current !== requestGeneration
      ) {
        return;
      }
      setState("error");
    }
  }

  return (
    <form className="labSemanticIntent" onSubmit={submit}>
      <label htmlFor="semantic-continuation-subject">
        QA 대상 이름
      </label>
      <div>
        <input
          id="semantic-continuation-subject"
          name="subjectLabel"
          value={subjectLabel}
          onChange={(event) => {
            requestGenerationRef.current += 1;
            setSubjectLabel(event.target.value);
            setState("idle");
          }}
          minLength={1}
          maxLength={80}
          autoComplete="off"
          placeholder="예: blabase"
          disabled={state === "saving"}
          required
        />
        <button
          type="submit"
          disabled={state === "saving" || previewTitle === null}
        >
          {state === "saving" ? "확인 저장 중" : "QA 진행 제목으로 확인"}
        </button>
      </div>
      <output htmlFor="semantic-continuation-subject" aria-live="polite">
        {previewTitle === null
          ? "제목 미리보기 · 안전한 QA 대상 이름을 입력하세요."
          : `제목 미리보기 · ${previewTitle}`}
      </output>
      <p role={state === "error" ? "alert" : "status"}>
        {state === "confirmed"
          ? "명시적으로 확인했습니다. 실행이나 QA 결과 기록은 만들지 않습니다."
          : state === "error"
            ? "현재 후보가 바뀌었거나 확인을 저장하지 못했습니다."
            : "확인하면 이 로컬 Board 제목에만 반영됩니다."}
      </p>
    </form>
  );
}

function semanticDisplayTitle(
  item: WorkBoardDisplayItem,
  presentation: SemanticContinuationTitlePresentation | null
): string {
  return (
    presentation?.overlays.find(
      (overlay) => overlay.itemRef === item.item.itemRef
    )?.displayTitle ?? item.item.title
  );
}

function semanticIntentEligiblePrimary(
  response: WorkBoardReadyResponse
): response is WorkBoardReadyResponse & {
  board: WorkBoardReadyResponse["board"] & {
    primary: WorkBoardDisplayItem;
  };
} {
  const primary = response.board.primary;
  return (
    response.mode === "full" &&
    response.board.continuationStatus === "available" &&
    primary?.lane === "continuation" &&
    primary.item.workContextRef !== null &&
    primary.item.capability === "display" &&
    primary.item.action === null
  );
}

function continuationShadowState(
  response: WorkBoardApiResponse | null,
  loadFailed: boolean
): { label: string; message: string } {
  if (loadFailed) {
    return {
      label: "사용 불가",
      message:
        "Continuation shadow를 불러오지 못했습니다. Attention 결과는 계속 확인할 수 있습니다."
    };
  }
  if (response === null) {
    return {
      label: "불러오는 중",
      message: "Continuation shadow를 불러오고 있습니다."
    };
  }
  if (response.status === "ready") {
    return response.mode === "full"
      ? { label: "Full shadow", message: "" }
      : { label: "Active-only fallback", message: "" };
  }
  if (
    response.status === "unavailable" &&
    response.code === "WORK_BOARD_SHADOW_DISABLED"
  ) {
    return { label: "비활성화", message: response.message };
  }
  return { label: "사용 불가", message: response.message };
}

function continuationSuggestionLabel(
  response: WorkBoardApiResponse | null,
  fallbackLabel: string
): string {
  if (response?.status !== "ready") {
    return `Continuation 제안 ${fallbackLabel}`;
  }
  switch (response.board.continuationStatus) {
    case "available":
      return "Continuation 제안 사용 가능";
    case "empty":
      return "Continuation 제안 없음";
    case "unavailable":
      return "Continuation 제안 사용 불가";
  }
}

function hasReadyContinuationPrimary(
  response: WorkBoardApiResponse | null
): boolean {
  return (
    response?.status === "ready" &&
    response.board.continuationStatus === "available" &&
    response.board.prominentLane === "continuation" &&
    response.board.primary?.lane === "continuation"
  );
}

function activeAttentionStatusLabel(
  status: AttentionHistoryEntry["decisionStatus"] | null
): string {
  return status === null
    ? "Active Attention 확인 중"
    : `Active Attention ${decisionLabel(status)}`;
}

function workBoardLaneLabel(
  lane: WorkBoardReadyResponse["board"]["prominentLane"] |
    WorkBoardDisplayItem["lane"]
): string {
  switch (lane) {
    case "attention":
      return "Attention · 지금 처리할 일";
    case "continuation":
      return "Continuation · 이어서 할 일";
    case "setup":
      return "Setup · 연결할 일";
    case "none":
      return "표시 항목 없음";
  }
}

function continuationAvailabilityLabel(
  status: WorkBoardReadyResponse["board"]["continuationStatus"]
): string {
  switch (status) {
    case "available":
      return "후보 있음";
    case "empty":
      return "최근 후보 없음";
    case "unavailable":
      return "사용 불가";
  }
}

function CurrentFocusDiagnosticsPanel({
  response
}: {
  response: AttentionApiResponse | null;
}) {
  if (response?.status !== "ready") return null;
  const {
    currentFocus,
    currentWorkstreams,
    recentMeaningfulEvents,
    focusAwareAttentionShadow,
    result
  } = response;
  const selected = currentFocus.selectedFocus;
  const eventById = new Map(
    (recentMeaningfulEvents?.events ?? []).map((event) => [
      event.eventId,
      event
    ])
  );
  const titleByCandidateId = new Map(
    result.rankedCandidates.map((candidate) => [
      candidate.candidateId,
      candidate.title
    ])
  );
  const existingTop = focusAwareAttentionShadow.existingTopCandidateId;
  const counterfactualTop =
    focusAwareAttentionShadow.counterfactualTopCandidateId;
  return (
    <section
      className="labEligibilityPanel labFocusPanel"
      aria-labelledby="current-focus-diagnostics-title"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Current WorkStream · Shadow v0.1</p>
          <h2 id="current-focus-diagnostics-title">
            Current Focus 복원 진단
          </h2>
        </div>
        <span>
          {currentFocus.status === "selected"
            ? "Focus 선택됨"
            : currentFocus.status === "unresolved"
              ? "선택 보류"
              : "Projection 불가"}
        </span>
      </div>
      <p className="labEligibilityBoundary">
        같은 asOf와 evidence lineage를 가진 GitHub·managed Codex 이벤트만
        사용합니다. Focus는 후보를 만들거나 eligibility를 바꾸지 않으며,
        현재는 실제 선택에 적용하지 않는 shadow 결과입니다.
      </p>
      <div className="labFunnel labEligibilityFunnel">
        <div>
          <strong>{recentMeaningfulEvents?.counts.included ?? 0}</strong>
          <span>Focus 가능 이벤트</span>
        </div>
        <div>
          <strong>{recentMeaningfulEvents?.counts.contextOnly ?? 0}</strong>
          <span>과거 맥락</span>
        </div>
        <div>
          <strong>{currentWorkstreams?.workstreams.length ?? 0}</strong>
          <span>복원 WorkStream</span>
        </div>
      </div>

      {selected ? (
        <article className="labFocusSelection">
          <div>
            <span>선택된 Current Focus</span>
            <strong>{selected.displayLabel}</strong>
          </div>
          <dl>
            <div>
              <dt>latest event</dt>
              <dd>{focusEventDiagnosticLabel(selected.latestMeaningfulEvent.kind)}</dd>
            </div>
            <div>
              <dt>occurredAt</dt>
              <dd>{formatTimestamp(selected.latestMeaningfulEvent.occurredAt)}</dd>
            </div>
            <div>
              <dt>source</dt>
              <dd>{focusSourceDiagnosticLabel(selected.latestMeaningfulEvent.source)}</dd>
            </div>
            <div>
              <dt>quality</dt>
              <dd>
                {selected.currentness} · {selected.completeness} · {selected.reconstructionConfidence}
              </dd>
            </div>
            <div>
              <dt>state / blocker</dt>
              <dd>{selected.authoritativeState} · {selected.activeBlocker}</dd>
            </div>
          </dl>
        </article>
      ) : (
        <p className="labEmpty">
          선택하지 않은 이유: {currentFocus.reasonCodes.join(" · ")}
        </p>
      )}

      <div className="labFocusComparison" aria-label="Focus shadow 선택 비교">
        <div>
          <span>기존 top</span>
          <strong>
            {existingTop
              ? titleByCandidateId.get(existingTop) ?? "비공개 후보"
              : "후보 없음"}
          </strong>
        </div>
        <div>
          <span>counterfactual top</span>
          <strong>
            {counterfactualTop
              ? titleByCandidateId.get(counterfactualTop) ?? "비공개 후보"
              : "후보 없음"}
          </strong>
        </div>
        <div>
          <span>실제 영향</span>
          <strong>
            {focusAwareAttentionShadow.attentionSelectionEffect === "none"
              ? focusAwareAttentionShadow.wouldSwitch
                ? "변경 가능성만 기록 · 적용 안 함"
                : "변경 없음"
              : focusAwareAttentionShadow.attentionSelectionEffect}
          </strong>
        </div>
      </div>

      <details className="labTechnical">
        <summary>이벤트 포함·제외와 WorkStream grouping 근거</summary>
        <div className="labFocusDiagnosticColumns">
          <div>
            <h3>Meaningful event 판정</h3>
            {recentMeaningfulEvents?.diagnostics.length ? (
              <ol className="labFocusDiagnosticList">
                {recentMeaningfulEvents.diagnostics.map((diagnostic) => {
                  const event = diagnostic.eventId
                    ? eventById.get(diagnostic.eventId)
                    : null;
                  return (
                    <li key={diagnostic.diagnosticId}>
                      <span className={`is-${diagnostic.disposition}`}>
                        {diagnostic.disposition}
                      </span>
                      <div>
                        <strong>
                          {event?.displayLabel ??
                            focusSourceDiagnosticLabel(diagnostic.source)}
                        </strong>
                        <code>{diagnostic.reasonCode}</code>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="labEmpty">기록된 event 진단이 없습니다.</p>
            )}
          </div>
          <div>
            <h3>WorkStream grouping</h3>
            {currentWorkstreams?.workstreams.length ? (
              <ol className="labFocusDiagnosticList">
                {currentWorkstreams.workstreams.map((workstream) => (
                  <li key={workstream.workstreamId}>
                    <span>{workstream.level}</span>
                    <div>
                      <strong>{workstream.displayLabel}</strong>
                      <code>{workstream.reasonCodes.join(" · ")}</code>
                      <small>
                        {workstream.currentness} · {workstream.completeness} · {workstream.reconstructionConfidence}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="labEmpty">복원된 WorkStream이 없습니다.</p>
            )}
          </div>
        </div>
        <dl>
          <TechnicalValue
            label="Focus reason"
            value={currentFocus.reasonCodes.join(" · ")}
          />
          <TechnicalValue
            label="Shadow reason"
            value={focusAwareAttentionShadow.reasonCodes.join(" · ")}
          />
          <TechnicalValue
            label="Eligibility diff"
            value={String(focusAwareAttentionShadow.eligibilityDiffCount)}
          />
          <TechnicalValue
            label="Shadow match coverage"
            value={`${focusAwareAttentionShadow.matches.length} / ${focusAwareAttentionShadow.totalMatchCount} retained · ${focusAwareAttentionShadow.omittedMatchCount} omitted`}
          />
          <TechnicalValue
            label="Recent event retention"
            value={`${recentMeaningfulEvents?.events.length ?? 0} retained · ${recentMeaningfulEvents?.counts.omittedMeaningfulEventCount ?? 0} events omitted · ${recentMeaningfulEvents?.counts.omittedDiagnosticCount ?? 0} diagnostics omitted`}
          />
          <TechnicalValue
            label="Focus projection"
            value={currentFocus.projectionSha256}
          />
          <TechnicalValue
            label="Shadow projection"
            value={focusAwareAttentionShadow.projectionSha256}
          />
        </dl>
      </details>
    </section>
  );
}

function focusSourceDiagnosticLabel(source: string): string {
  return source === "github"
    ? "GitHub"
    : source === "codex_managed"
      ? "Managed Codex"
      : "Codex inventory (context-only)";
}

function focusEventDiagnosticLabel(kind: string): string {
  return kind.replace(/^github_/, "GitHub ").replace(/^codex_/, "Codex ");
}

function DeveloperSignalPanel({
  response
}: {
  response: AttentionApiResponse | null;
}) {
  if (response?.status !== "ready") return null;
  const summary = response.developerSignals;
  return (
    <section
      className="labEligibilityPanel"
      aria-labelledby="developer-signal-title"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Developer Signal Intelligence · v0.1</p>
          <h2 id="developer-signal-title">작업 장부와 후보 funnel</h2>
        </div>
        <span>원문 없는 집계</span>
      </div>
      <p className="labEligibilityBoundary">
        GitHub와 Codex 관찰을 먼저 작업 장부로 합치고, 수집·정규화·해석·
        검증·자격 판정·선택 단계를 모두 기록합니다. Codex 과거 대화의
        열린 고리는 현재성 검증 전에는 추천 후보가 되지 않습니다.
      </p>
      <div className="labFunnel labEligibilityFunnel">
        <div>
          <strong>{summary.entityCounts.workItems}</strong>
          <span>작업 항목</span>
        </div>
        <div>
          <strong>{summary.entityCounts.blockers}</strong>
          <span>확인된 blocker</span>
        </div>
        <div>
          <strong>{summary.claimCounts.open}</strong>
          <span>Codex 열린 고리</span>
        </div>
      </div>
      <ol className="labActiveRanking">
        {summary.stageSummaries.map((stage) => (
          <li key={stage.stage}>
            <span>{developerStageLabel(stage.stage)}</span>
            <div>
              <strong>{stage.enteredCount}개 진입</strong>
              <small>
                제외 {stage.outcomeCounts.rejected} · 미도달{" "}
                {stage.outcomeCounts.notReached}
              </small>
            </div>
            <code>
              {stage.outcomeCounts.selected > 0
                ? `selected ${stage.outcomeCounts.selected}`
                : `traces ${stage.totalTraceCount}`}
            </code>
          </li>
        ))}
      </ol>
      <details className="labTechnical">
        <summary>장부·funnel integrity 정보</summary>
        <dl>
          <TechnicalValue label="Ledger" value={summary.ledgerSha256} />
          <TechnicalValue label="Funnel" value={summary.funnelSha256} />
          <TechnicalValue label="Summary" value={summary.summarySha256} />
        </dl>
      </details>
    </section>
  );
}

function developerStageLabel(
  stage:
    | "collected"
    | "normalized"
    | "interpreted"
    | "verified"
    | "eligibility"
    | "selected"
): string {
  switch (stage) {
    case "collected":
      return "수집";
    case "normalized":
      return "정규화";
    case "interpreted":
      return "해석";
    case "verified":
      return "검증";
    case "eligibility":
      return "자격";
    case "selected":
      return "선택";
  }
}

function ActiveDecisionPanel({
  response
}: {
  response: AttentionApiResponse | null;
}) {
  if (response?.status !== "ready") return null;
  const { result } = response;
  return (
    <section
      className="labEligibilityPanel labActiveDecisionPanel"
      aria-labelledby="active-decision-title"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Phase 4B · Active</p>
          <h2 id="active-decision-title">실제 추천 결정</h2>
        </div>
        <span>{activeAttentionStatusLabel(result.decision.status)}</span>
      </div>
      <p className="labEligibilityBoundary">
        GitHub 작업과 Blabase가 직접 관찰한 managed Codex 실패·설정된 완료
        후속 작업을 같은 순위표에서 평가합니다.
      </p>
      <div className="labFunnel labEligibilityFunnel">
        <div>
          <strong>{result.counts.eligible}</strong>
          <span>추천 가능</span>
        </div>
        <div>
          <strong>{result.counts.reviewRequired}</strong>
          <span>검토 필요</span>
        </div>
        <div>
          <strong>{result.counts.ineligible}</strong>
          <span>제외</span>
        </div>
      </div>
      {result.rankedCandidates.length > 0 ? (
        <ol className="labActiveRanking">
          {result.rankedCandidates.slice(0, 8).map((candidate, index) => (
            <li key={candidate.candidateId}>
              <span>#{index + 1}</span>
              <div>
                <strong>{candidate.title}</strong>
                <small>
                  {activeTriggerLabel(candidate.triggerKind)} · {candidate.lane}
                </small>
              </div>
              <code>{candidate.candidateId}</code>
            </li>
          ))}
        </ol>
      ) : (
        <p className="labEmpty">현재 순위표에 들어온 후보가 없습니다.</p>
      )}
      <p className="labEligibilityCoverage">
        GitHub {result.coverage.githubCandidateCoverage} · managed Codex{" "}
        {result.coverage.managedCodexCoverage} · negative coverage{" "}
        {result.coverage.negativeCandidateCoverageComplete
          ? "complete"
          : "limited"}
      </p>
      <details className="labTechnical">
        <summary>Active 버전과 integrity 정보</summary>
        <dl>
          <TechnicalValue label="Result" value={result.resultId} />
          <TechnicalValue label="Policy" value={result.policyVersion} />
          <TechnicalValue label="Resolver" value={result.resolverVersion} />
          <TechnicalValue
            label="Eligibility projection"
            value={result.dependencies.eligibilityProjectionSha256}
          />
          <TechnicalValue
            label="Managed projection"
            value={result.dependencies.managedPublicProjectionSha256}
          />
          <TechnicalValue
            label="Workflow projection"
            value={result.dependencies.workflowProjectionSha256}
          />
        </dl>
      </details>
    </section>
  );
}

function EligibilityShadowPanel({
  projection
}: {
  projection: AttentionEligibilityShadowProjection | null;
}) {
  if (projection === null) return null;
  return (
    <section
      className="labEligibilityPanel"
      aria-labelledby="eligibility-shadow-title"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Phase 4A · Shadow</p>
          <h2 id="eligibility-shadow-title">후보 안전성 판정</h2>
        </div>
        <span>단독 선택 없음 · Phase 4B 입력</span>
      </div>
      <p className="labEligibilityBoundary">
        이 projection 자체는 후보를 선택하지 않습니다. Phase 4B가 같은
        근거와 이 gate 결과를 입력으로 받아 실제 추천 순서를 만듭니다.
      </p>
      <div className="labFunnel labEligibilityFunnel">
        <div>
          <strong>{projection.counts.eligible}</strong>
          <span>통과</span>
        </div>
        <div>
          <strong>{projection.counts.reviewRequired}</strong>
          <span>검토 필요</span>
        </div>
        <div>
          <strong>{projection.counts.ineligible}</strong>
          <span>제외</span>
        </div>
      </div>
      {projection.assessments.length > 0 ? (
        <ul className="labAssessmentList labEligibilityList">
          {projection.assessments.slice(0, 12).map((item) => (
            <li key={item.assessmentId}>
              <div>
                <strong>{eligibilityTaskLabel(item)}</strong>
                <span>{eligibilityStatusLabel(item.status)}</span>
              </div>
              <div>
                <small>{eligibilityRouteLabel(item)}</small>
                <code>{item.reasonCodes.join(" · ")}</code>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="labEmpty">
          현재 평가 범위에서 GitHub 작업 후보가 없습니다.
        </p>
      )}
      <p className="labEligibilityCoverage">
        GitHub 후보 범위 {projection.coverage.githubCandidateCoverage} ·
        Codex managed 후보는 아래 Phase 4B active panel에서 별도 평가 · 관련
        없는 미해결 충돌{" "}
        {projection.coverage.unrelatedUnresolvedCriticalConflictCount}건은 후보를
        막지 않음
      </p>
      <details className="labTechnical">
        <summary>Shadow 버전과 integrity 정보</summary>
        <dl>
          <TechnicalValue label="As of" value={projection.asOf} />
          <TechnicalValue label="Policy" value={projection.policyVersion} />
          <TechnicalValue
            label="Resolver"
            value={projection.resolverVersion}
          />
          <TechnicalValue
            label="Claim projection"
            value={projection.dependencies.claimAuthorityProjectionSha256}
          />
          <TechnicalValue
            label="Projection SHA-256"
            value={projection.projectionSha256}
          />
        </dl>
      </details>
    </section>
  );
}

function LabSummary({
  history,
  current
}: {
  history: Extract<AttentionHistoryResponse, { status: "ready" }>;
  current: AttentionApiResponse | null;
}) {
  const latest = history.entries[0] ?? null;
  const latestFailure = history.failures[0] ?? null;
  const currentStatus =
    current?.status === "ready"
      ? decisionLabel(current.result.decision.status)
      : current?.status === "error"
        ? "실행 오류"
        : current?.status === "unavailable"
          ? "로컬에서 사용 불가"
          : latest
            ? decisionLabel(latest.decisionStatus)
            : "아직 실행 없음";
  return (
    <section className="labSummaryGrid" aria-label="최근 요약">
      <SummaryCard
        label="현재 결과"
        value={currentStatus}
        detail={
          current?.status === "ready"
            ? formatTimestamp(current.result.asOf)
            : latest
              ? `${formatTimestamp(latest.asOf)} 기록 기준`
              : "새 평가를 실행해주세요"
        }
      />
      <SummaryCard
        label="최근 실행"
        value={`${history.runCount}회`}
        detail={`추천 ${history.decisionCounts.suggested} · 근거 부족 ${history.decisionCounts.insufficient_evidence}`}
      />
      <SummaryCard
        label="명시적 피드백"
        value={`${history.feedbackCount}건`}
        detail={`현재 평가 ${history.feedbackCount} · 변경 기록 ${history.feedbackEventCount}`}
      />
      <SummaryCard
        label="실패한 평가"
        value={`${history.failureCount}회`}
        detail={
          latestFailure
            ? `${latestFailure.stage === "source_sync" ? "소스 동기화" : "Attention 해석"} · ${latestFailure.errorCode}`
            : "기록된 실패 없음"
        }
      />
      <SummaryCard
        label="보관 범위"
        value={`${history.retentionDays}일`}
        detail="private local metadata"
      />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="labSummaryCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RecentRuns({
  entries,
  selectedRunId,
  onSelect
}: {
  entries: AttentionHistoryEntry[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <aside className="labRunList" aria-labelledby="recent-run-title">
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">History</p>
          <h2 id="recent-run-title">최근 실행</h2>
        </div>
        <span>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="labEmpty">
          아직 기록이 없습니다. 새 평가를 실행해주세요.
        </p>
      ) : (
        <ol>
          {entries.map((entry) => {
            const reviewCount =
              "reviewRequired" in entry.candidateCounts
                ? entry.candidateCounts.reviewRequired
                : entry.candidateCounts.provisional;
            return (
              <li key={entry.runId}>
              <button
                type="button"
                className={
                  entry.runId === selectedRunId ? "isSelected" : ""
                }
                aria-pressed={entry.runId === selectedRunId}
                aria-controls="attention-run-inspector"
                onClick={() => onSelect(entry.runId)}
              >
                <span
                  className={`labRunStatus labRunStatus-${entry.decisionStatus}`}
                >
                  {decisionLabel(entry.decisionStatus)}
                </span>
                <strong>{formatTimestamp(entry.asOf)}</strong>
                <small>
                  통과 {entry.candidateCounts.eligible} · 검토 {reviewCount} ·{" "}
                  {entry.latencyMs.toLocaleString("ko-KR")}ms
                </small>
                {entry.feedback.length > 0 ? (
                  <em>피드백 {entry.feedback.length}</em>
                ) : null}
              </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function RunInspector({
  entry,
  current
}: {
  entry: AttentionHistoryEntry | null;
  current: AttentionApiResponse | null;
}) {
  if (!entry) {
    return (
      <section className="labInspector" id="attention-run-inspector">
        <p className="labEmpty">
          확인할 실행 기록을 선택해주세요.
        </p>
      </section>
    );
  }
  const currentTitle =
    current?.status === "ready" &&
    current.run.runId === entry.runId &&
    current.result.decision.topSuggestion
      ? current.result.decision.topSuggestion.title
      : null;

  return (
    <section
      className="labInspector"
      id="attention-run-inspector"
      aria-labelledby="run-inspector-title"
      aria-live="polite"
    >
      <div className="labPanelHeader">
        <div>
          <p className="eyebrow">Run inspector</p>
          <h2 id="run-inspector-title">
            {decisionLabel(entry.decisionStatus)}
          </h2>
        </div>
        <span>{entry.certainty ?? "미확정"}</span>
      </div>

      {currentTitle ? (
        <div className="labCurrentCandidate">
          <span>현재 사용자 화면의 top candidate</span>
          <strong>{currentTitle}</strong>
        </div>
      ) : null}

      <section className="labInspectorSection">
        <h3>Candidate funnel</h3>
        <div className="labFunnel">
          <div>
            <strong>{entry.candidateCounts.eligible}</strong>
            <span>확정</span>
          </div>
          <div>
            <strong>
              {"reviewRequired" in entry.candidateCounts
                ? entry.candidateCounts.reviewRequired
                : entry.candidateCounts.provisional}
            </strong>
            <span>
              {"reviewRequired" in entry.candidateCounts
                ? "검토 필요"
                : "임시"}
            </span>
          </div>
          <div>
            <strong>{entry.candidateCounts.ineligible}</strong>
            <span>제외</span>
          </div>
        </div>
        <p className="labCodexMetric">
          Codex 과거 세션 맥락{" "}
          <strong>{entry.codexExecutionCount}개</strong> · 추천 후보에는
          포함하지 않음 · 원문과 짧은 발췌는 history에 저장하지 않음
        </p>
      </section>

      <section className="labInspectorSection">
        <h3>Candidate assessments</h3>
        {entry.candidateAssessmentDetailState === "not_recorded" ? (
          <p className="labEmpty">
            이 실행은 후보별 상세 기록을 추가하기 전에 생성됐습니다.
          </p>
        ) : entry.candidateAssessments.length > 0 ? (
          <ul className="labAssessmentList">
            {entry.candidateAssessments.map((assessment) => {
              const active = "triggerKind" in assessment;
              const label = active
                ? activeTriggerLabel(assessment.triggerKind)
                : assessment.taskKind;
              const status = active
                ? assessment.status
                : assessment.disposition;
              const reasons = active
                ? assessment.reasonCodes
                : assessment.gateReasonCodes;
              return (
                <li key={assessment.assessmentId}>
                  <div>
                    <strong>{label}</strong>
                    <span>{status}</span>
                  </div>
                  <div>
                    <code>{assessment.candidateId ?? "candidate 없음"}</code>
                    <small>
                      {reasons.length > 0
                        ? reasons.join(" · ")
                        : "gate 통과"}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="labEmpty">평가된 GitHub 후보가 없습니다.</p>
        )}
      </section>

      <section className="labInspectorSection">
        <h3>Source coverage</h3>
        <ul className="labSourceList">
          {entry.sources.map((source) => (
            <li key={source.source}>
              <div>
                <strong>
                  {source.source === "github" ? "GitHub" : "Codex"}
                </strong>
                <span>
                  {source.inputState === "available"
                    ? `${source.freshness} · ${source.completeness}`
                    : source.inputState}
                </span>
              </div>
              <div>
                <span>signals {source.signalCount}</span>
                <small>
                  {source.snapshotFetchedAt
                    ? formatTimestamp(source.snapshotFetchedAt)
                    : source.unavailableReason}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <CodeSection
        title="Decision reasons"
        values={entry.decisionReasonCodes}
      />
      <CodeSection title="Caveats" values={entry.caveatCodes} />
      {entry.errors.length > 0 ? (
        <CodeSection
          title="Sanitized errors"
          values={entry.errors.map(
            (error) => `${error.source}:${error.code}`
          )}
        />
      ) : null}

      <details className="labTechnical">
        <summary>버전과 integrity 정보</summary>
        <dl>
          <TechnicalValue label="Run ID" value={entry.runId} />
          <TechnicalValue label="Result ID" value={entry.resultId} />
          <TechnicalValue
            label="Top candidate ID"
            value={entry.topCandidateId ?? "none"}
          />
          <TechnicalValue
            label="Input SHA-256"
            value={entry.inputSha256}
          />
          <TechnicalValue
            label="Result SHA-256"
            value={entry.resultSha256}
          />
          <TechnicalValue
            label="Orchestrator"
            value={entry.orchestratorVersion}
          />
          <TechnicalValue
            label="Freshness policy"
            value={entry.freshnessPolicyVersion}
          />
          <TechnicalValue
            label="Effective TTL"
            value={`GitHub ${entry.freshnessPolicy.githubMaxAgeMs}ms · Codex ${entry.freshnessPolicy.codexMaxAgeMs}ms · skew ${entry.freshnessPolicy.maxFutureClockSkewMs}ms`}
          />
          <TechnicalValue label="Policy" value={entry.policyVersion} />
          <TechnicalValue
            label={
              entry.candidateRuleVersion
                ? "Active candidate rule"
                : "GitHub rule"
            }
            value={
              entry.candidateRuleVersion ??
              entry.githubCandidateRuleVersion ??
              "not-recorded"
            }
          />
          <TechnicalValue
            label={entry.resolverVersion ? "Active resolver" : "Codex rule"}
            value={
              entry.resolverVersion ??
              entry.codexOverviewRuleVersion ??
              "not-recorded"
            }
          />
          <TechnicalValue
            label="Base commit"
            value={entry.codeCommitSha ?? "local-unrecorded"}
          />
        </dl>
      </details>

      {entry.feedback.length > 0 ? (
        <section className="labInspectorSection">
          <h3>명시적 피드백</h3>
          <ul className="labFeedbackList">
            {entry.feedback.map((feedback) => (
              <li key={feedback.feedbackId}>
                <strong>
                  {feedbackLabel(feedback.feedbackType)}
                  {feedback.supersedesFeedbackId ? " · 수정" : ""}
                </strong>
                <time dateTime={feedback.createdAt}>
                  {formatTimestamp(feedback.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function CodeSection({
  title,
  values
}: {
  title: string;
  values: string[];
}) {
  return (
    <section className="labInspectorSection">
      <h3>{title}</h3>
      {values.length > 0 ? (
        <ul className="labCodeList">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="labEmpty">기록 없음</p>
      )}
    </section>
  );
}

function TechnicalValue({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function decisionLabel(
  status: AttentionHistoryEntry["decisionStatus"]
): string {
  switch (status) {
    case "suggested":
      return "추천 생성";
    case "needs_clarification":
      return "확인 필요";
    case "no_action":
      return "개입 없음";
    case "insufficient_evidence":
      return "근거 부족";
  }
}

function activeTriggerLabel(
  trigger:
    | "github_work_item"
    | "managed_failure"
    | "configured_follow_through"
): string {
  switch (trigger) {
    case "github_work_item":
      return "GitHub 작업";
    case "managed_failure":
      return "Codex 실행 실패";
    case "configured_follow_through":
      return "설정된 완료 후속 작업";
  }
}

function feedbackLabel(
  type: AttentionHistoryEntry["feedback"][number]["feedbackType"]
): string {
  switch (type) {
    case "helpful":
      return "적절함";
    case "wrong_priority":
      return "우선순위 아님";
    case "already_done":
      return "이미 끝남";
    case "not_mine":
      return "내 일이 아님";
    case "insufficient_context":
      return "근거 부족";
  }
}

function eligibilityTaskLabel(
  assessment: AttentionEligibilityAssessment
): string {
  switch (assessment.taskKind) {
    case "assigned_issue":
      return "GitHub 할당 이슈";
    case "review_requested_pull_request":
      return "GitHub 리뷰 상태 확인";
    case "authored_pull_request":
      return "내가 작성한 GitHub PR";
  }
}

function eligibilityStatusLabel(
  status: AttentionEligibilityAssessment["status"]
): string {
  switch (status) {
    case "eligible":
      return "통과";
    case "review_required":
      return "검토 필요";
    case "ineligible":
      return "제외";
  }
}

function eligibilityRouteLabel(
  assessment: AttentionEligibilityAssessment
): string {
  switch (assessment.reviewRoute) {
    case "user_review":
      return "사용자 판단이 있어야 다시 후보가 됩니다.";
    case "refresh_sources":
      return "소스를 갱신한 뒤 자동으로 다시 평가합니다.";
    case "none":
      return assessment.status === "eligible"
        ? "안전성 gate를 통과했습니다."
        : "현재 후보 범위에서 제외합니다.";
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
