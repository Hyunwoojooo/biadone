"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { CodexConnectionState } from "../src/connectors/codex/types";

type CodexNotice = {
  tone: "success" | "neutral" | "error";
  message: string;
};

type CodexAction =
  | "discovering"
  | "connecting"
  | "updating_content"
  | "disconnecting"
  | null;

export function CodexConnector() {
  const [connection, setConnection] =
    useState<CodexConnectionState | null>(null);
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([]);
  const [includeTaskSummaries, setIncludeTaskSummaries] =
    useState(false);
  const [notice, setNotice] = useState<CodexNotice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [action, setAction] = useState<CodexAction>(null);
  const actionRef = useRef<CodexAction>(null);
  const connectionEpochRef = useRef(0);
  const refreshSequenceRef = useRef(0);

  const refreshConnection = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (actionRef.current !== null) return;
      const connectionEpoch = connectionEpochRef.current;
      const refreshSequence = ++refreshSequenceRef.current;
      if (!silent) setIsRefreshing(true);
      try {
        const response = forceRefresh
          ? await fetch("/api/connectors/codex/connect", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "refresh" })
            })
          : await fetch("/api/connectors/codex/status", {
              cache: "no-store"
            });
        if (!response.ok) throw new Error("status request failed");
        const payload = (await response.json()) as CodexConnectionState;
        if (
          connectionEpoch !== connectionEpochRef.current ||
          refreshSequence !== refreshSequenceRef.current
        ) {
          return;
        }
        setConnection(payload);
      } catch {
        if (
          connectionEpoch !== connectionEpochRef.current ||
          refreshSequence !== refreshSequenceRef.current
        ) {
          return;
        }
        setConnection((current) => ({
          status: "sync_error",
          message:
            "Codex 연결 상태를 확인하지 못했습니다. 로컬 서버를 확인해주세요.",
          lastSyncedAt:
            current?.status === "connected"
              ? current.lastSyncedAt
              : current?.status === "sync_error"
                ? current.lastSyncedAt
                : null
        }));
      } finally {
        if (
          !silent &&
          connectionEpoch === connectionEpochRef.current
        ) {
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    if (connection?.status !== "scope_selection") return;
    setSelectedScopeIds(
      connection.scopes.filter((scope) => scope.selected).map((scope) => scope.id)
    );
    setIncludeTaskSummaries(
      connection.contentMode === "activity_summary"
    );
  }, [connection]);

  useEffect(() => {
    if (connection?.status !== "connected") return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshConnection(true, true);
      }
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [connection?.status, refreshConnection]);

  async function discoverScopes() {
    const actionEpoch = beginAction("discovering");
    setNotice(null);
    try {
      const response = await fetch("/api/connectors/codex/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discover" })
      });
      const payload = (await response.json()) as CodexConnectionState;
      if (!response.ok) throw new Error("discover failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection(payload);
      if (payload.status === "scope_selection" && payload.scopes.length > 0) {
        setNotice({
          tone: "neutral",
          message:
            "최근 Codex 활동이 있는 프로젝트를 찾았습니다. blabase가 확인할 프로젝트를 선택해주세요."
        });
      }
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message:
          "Codex 프로젝트를 찾지 못했습니다. Codex 설치와 로컬 서버 상태를 확인해주세요."
      });
    } finally {
      finishAction(actionEpoch);
    }
  }

  async function connectSelectedScopes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedScopeIds.length === 0) return;

    const actionEpoch = beginAction("connecting");
    setNotice(null);
    try {
      const response = await fetch("/api/connectors/codex/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          scopeIds: selectedScopeIds,
          contentMode: includeTaskSummaries
            ? "activity_summary"
            : "metadata_only"
        })
      });
      const payload = (await response.json()) as CodexConnectionState;
      if (!response.ok) throw new Error("connect failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection(payload);
      if (payload.status === "connected") {
        setNotice({
          tone: "success",
          message: "선택한 Codex 프로젝트가 연결되었습니다."
        });
      }
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message:
          "선택한 Codex 프로젝트를 연결하지 못했습니다. 잠시 후 다시 시도해주세요."
      });
    } finally {
      finishAction(actionEpoch);
    }
  }

  async function disconnect() {
    const actionEpoch = beginAction("disconnecting");
    setNotice(null);
    try {
      const response = await fetch("/api/connectors/codex/disconnect", {
        method: "POST"
      });
      if (!response.ok) throw new Error("disconnect failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection({ status: "disconnected" });
      setSelectedScopeIds([]);
      setIncludeTaskSummaries(false);
      setNotice({
        tone: "neutral",
        message: "Codex 연결과 로컬 미리보기 데이터를 삭제했습니다."
      });
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message: "Codex 연결을 해제하지 못했습니다. 다시 시도해주세요."
      });
    } finally {
      finishAction(actionEpoch);
    }
  }

  async function updateConnectedContentMode(enabled: boolean) {
    const actionEpoch = beginAction("updating_content");
    setNotice(null);
    try {
      const response = await fetch("/api/connectors/codex/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_content_mode",
          contentMode: enabled
            ? "activity_summary"
            : "metadata_only"
        })
      });
      const payload = (await response.json()) as CodexConnectionState;
      if (!response.ok) throw new Error("content mode update failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection(payload);
      if (payload.status === "connected") {
        setNotice({
          tone: "success",
          message: enabled
            ? "Codex 작업 설명 표시를 켰습니다."
            : "Codex 작업 설명을 로컬 저장본에서 제거했습니다."
        });
      }
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message: "Codex 작업 설명 설정을 바꾸지 못했습니다."
      });
    } finally {
      finishAction(actionEpoch);
    }
  }

  function beginAction(nextAction: Exclude<CodexAction, null>): number {
    const actionEpoch = ++connectionEpochRef.current;
    actionRef.current = nextAction;
    setAction(nextAction);
    setIsRefreshing(false);
    return actionEpoch;
  }

  function finishAction(actionEpoch: number): void {
    if (actionEpoch !== connectionEpochRef.current) return;
    actionRef.current = null;
    setAction(null);
  }

  function toggleScope(scopeId: string, selected: boolean) {
    setSelectedScopeIds((current) =>
      selected
        ? Array.from(new Set([...current, scopeId]))
        : current.filter((id) => id !== scopeId)
    );
  }

  const isBusy = isRefreshing || action !== null;

  return (
    <section
      className="calendarSection"
      aria-labelledby="codex-title"
      aria-busy={isBusy}
    >
      <div className="calendarHeader">
        <div>
          <p className="calendarKicker">데이터 연결</p>
          <h2 id="codex-title">Codex</h2>
        </div>
        <CodexStatusBadge connection={connection} />
      </div>

      <p className="calendarDescription">
        이 컴퓨터의 Codex에서 선택한 프로젝트와 최근 세션 활동을
        확인합니다. 사용자가 작업 설명 표시를 켜면 Codex 작업 제목을,
        제목이 없으면 첫 요청의 앞부분을 로컬 snapshot과 타임라인에만
        저장합니다. 프로젝트 전체 경로는 비공개 로컬 연결 설정에만
        저장하고 화면과 snapshot에는 표시하지 않습니다. 세션 응답, 코드,
        명령과 출력은 읽거나 저장하지 않습니다. 다른 Codex 프로세스의
        실시간 실행·승인 대기 상태는 아직 판별하지 않습니다. OAuth나 API
        key 없이 로컬에서만 동작합니다.
      </p>

      {notice ? (
        <p
          className={`calendarNotice calendarNotice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <CodexConnectionBody
        connection={connection}
        selectedScopeIds={selectedScopeIds}
        includeTaskSummaries={includeTaskSummaries}
        isRefreshing={isRefreshing}
        action={action}
        onDiscover={() => void discoverScopes()}
        onConnect={connectSelectedScopes}
        onToggleScope={toggleScope}
        onToggleTaskSummaries={setIncludeTaskSummaries}
        onToggleConnectedTaskSummaries={(enabled) =>
          void updateConnectedContentMode(enabled)
        }
        onRefresh={() => void refreshConnection(true)}
        onDisconnect={() => void disconnect()}
      />
    </section>
  );
}

function CodexStatusBadge({
  connection
}: {
  connection: CodexConnectionState | null;
}) {
  const connected = connection?.status === "connected";

  return (
    <span
      className={`calendarStatus ${connected ? "isConnected" : ""}`}
      aria-live="polite"
    >
      {connection === null
        ? "확인 중"
        : connected
          ? "연결됨"
          : connection.status === "scope_selection"
            ? "프로젝트 선택 필요"
            : connection.status === "unavailable"
              ? "로컬 설정 필요"
              : connection.status === "sync_error"
                ? "확인 필요"
                : "연결 안 됨"}
    </span>
  );
}

function CodexConnectionBody({
  connection,
  selectedScopeIds,
  includeTaskSummaries,
  isRefreshing,
  action,
  onDiscover,
  onConnect,
  onToggleScope,
  onToggleTaskSummaries,
  onToggleConnectedTaskSummaries,
  onRefresh,
  onDisconnect
}: {
  connection: CodexConnectionState | null;
  selectedScopeIds: string[];
  includeTaskSummaries: boolean;
  isRefreshing: boolean;
  action: CodexAction;
  onDiscover: () => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onToggleScope: (scopeId: string, selected: boolean) => void;
  onToggleTaskSummaries: (selected: boolean) => void;
  onToggleConnectedTaskSummaries: (selected: boolean) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  if (connection === null) {
    return (
      <button className="calendarPrimaryButton" type="button" disabled>
        연결 상태 확인 중
      </button>
    );
  }

  if (connection.status === "unavailable") {
    return (
      <div className="calendarActionBlock">
        <p>{connection.message}</p>
        {connection.localUrl ? (
          <a className="calendarPrimaryButton" href={connection.localUrl}>
            로컬 주소로 열기
          </a>
        ) : (
          <>
            <button
              className="calendarPrimaryButton"
              type="button"
              onClick={onDiscover}
              disabled={action !== null}
            >
              {action === "discovering" ? "다시 찾는 중" : "Codex 다시 찾기"}
            </button>
            <div className="calendarSecondaryActions">
              <button
                type="button"
                onClick={onDisconnect}
                disabled={action !== null}
              >
                연결 초기화
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (connection.status === "disconnected") {
    return (
      <div className="calendarActionBlock">
        <button
          className="calendarPrimaryButton"
          type="button"
          onClick={onDiscover}
          disabled={action !== null}
        >
          {action === "discovering" ? "프로젝트 찾는 중" : "Codex 프로젝트 찾기"}
        </button>
        <p>
          설치된 Codex의 최근 30일 활동에서 프로젝트 후보를 찾은 뒤 확인할
          범위를 직접 선택합니다.
        </p>
      </div>
    );
  }

  if (connection.status === "sync_error") {
    return (
      <div className="calendarActionBlock">
        <p role="alert">{connection.message}</p>
        {connection.lastSyncedAt ? (
          <p className="calendarMeta">
            마지막 확인 {formatCodexTimestamp(connection.lastSyncedAt)}
          </p>
        ) : null}
        <button
          className="calendarPrimaryButton"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? "다시 확인 중" : "다시 확인"}
        </button>
        <div className="calendarSecondaryActions">
          <button
            type="button"
            onClick={onDiscover}
            disabled={isRefreshing || action !== null}
          >
            프로젝트 다시 선택
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={isRefreshing || action !== null}
          >
            연결 해제
          </button>
        </div>
      </div>
    );
  }

  if (connection.status === "scope_selection") {
    if (connection.scopes.length === 0) {
      return (
        <div className="calendarActionBlock">
          <p>{connection.message}</p>
          <button
            className="calendarPrimaryButton"
            type="button"
            onClick={onDiscover}
            disabled={action !== null}
          >
            {action === "discovering" ? "다시 찾는 중" : "프로젝트 다시 찾기"}
          </button>
          <div className="calendarSecondaryActions">
            <button
              type="button"
              onClick={onDisconnect}
              disabled={action !== null}
            >
              {action === "disconnecting" ? "연결 해제 중" : "연결 취소"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <form className="codexScopeForm" onSubmit={onConnect}>
        <p>{connection.message}</p>
        <fieldset className="codexScopeList">
          <legend>확인할 프로젝트</legend>
          {connection.scopes.map((scope) => (
            <label key={scope.id}>
              <input
                type="checkbox"
                checked={selectedScopeIds.includes(scope.id)}
                onChange={(event) =>
                  onToggleScope(scope.id, event.target.checked)
                }
                disabled={action !== null}
              />
              <span>
                <strong>{scope.label}</strong>
                <small>
                  최근 활동 {formatCodexTimestamp(scope.lastActivityAt)} · 세션{" "}
                  {scope.sessionCount}개
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="codexSummaryConsent">
          <input
            type="checkbox"
            checked={includeTaskSummaries}
            onChange={(event) =>
              onToggleTaskSummaries(event.target.checked)
            }
            disabled={action !== null}
          />
          <span>
            <strong>Codex 작업 설명 표시</strong>
            <small>
              작업 제목 또는 첫 요청의 앞부분이 민감정보 필터를 거쳐
              로컬에 저장됩니다. 응답·코드·명령·출력은 읽지 않습니다.
            </small>
          </span>
        </label>
        <button
          className="calendarPrimaryButton"
          type="submit"
          disabled={selectedScopeIds.length === 0 || action !== null}
        >
          {action === "connecting"
            ? "선택한 프로젝트 연결 중"
            : `선택한 프로젝트 ${selectedScopeIds.length}개 연결`}
        </button>
        <div className="calendarSecondaryActions">
          <button
            type="button"
            onClick={onDiscover}
            disabled={action !== null}
          >
            프로젝트 목록 다시 찾기
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={action !== null}
          >
            {action === "disconnecting" ? "연결 해제 중" : "연결 취소"}
          </button>
        </div>
      </form>
    );
  }

  const previewSessions = connection.sessions.slice(0, 3);
  const hiddenSessionCount = Math.max(
    0,
    connection.sessionCount - previewSessions.length
  );

  return (
    <div className="calendarConnectedBody">
      <div className="calendarSyncSummary">
        <p>
          프로젝트 {connection.projectCount}개에서 최근 Codex 세션{" "}
          {connection.sessionCount}개를 확인했습니다.
        </p>
        <span>
          마지막 확인 {formatCodexTimestamp(connection.lastSyncedAt)}
        </span>
      </div>

      <p className="calendarMeta">
        최근 활동 기록 기준 · 작업 설명{" "}
        {connection.contentMode === "activity_summary"
          ? "표시 중"
          : "표시 안 함"}
        {connection.truncated ? " · 최대 수집 범위까지만 표시" : ""}
      </p>

      {previewSessions.length > 0 ? (
        <ol className="calendarEventList">
          {previewSessions.map((session) => (
            <li key={session.id}>
              <time dateTime={session.updatedAt}>
                {formatCodexTimestamp(session.updatedAt)} 활동
              </time>
              <span>
                {session.taskSummary
                  ? `${session.projectLabel} · ${session.taskSummary}`
                  : `${session.projectLabel} · 작업 설명 없음`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="calendarEmpty">
          선택한 프로젝트에서 최근 30일 내 Codex 세션을 찾지 못했습니다.
        </p>
      )}

      {hiddenSessionCount > 0 ? (
        <p className="calendarMore">
          이외에 {hiddenSessionCount}개 세션이 더 있습니다.
        </p>
      ) : null}

      <div className="calendarSecondaryActions">
        <button
          type="button"
          onClick={() =>
            onToggleConnectedTaskSummaries(
              connection.contentMode !== "activity_summary"
            )
          }
          disabled={isRefreshing || action !== null}
        >
          {action === "updating_content"
            ? "작업 설명 설정 변경 중"
            : connection.contentMode === "activity_summary"
              ? "작업 설명 표시 끄기"
              : "작업 설명 표시 켜기"}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing || action !== null}
        >
          {isRefreshing ? "새로고침 중" : "Codex 새로고침"}
        </button>
        <button
          type="button"
          onClick={onDiscover}
          disabled={isRefreshing || action !== null}
        >
          프로젝트 다시 선택
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={isRefreshing || action !== null}
        >
          {action === "disconnecting" ? "연결 해제 중" : "연결 해제"}
        </button>
      </div>
    </div>
  );
}

function formatCodexTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
