"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CodexConnectionState,
  CodexContentMode
} from "../src/connectors/codex/types";
import {
  buildCodexSessionPresentation,
  hasCurrentCodexConversationContent
} from "./codexSessionPresentation";
import { SOURCE_CONNECTION_ANCHORS } from "./sourceNavigation";
import { SourceSyncMeta } from "./sync/SourceSyncMeta";
import { invalidateSourceConsumers } from "./sync/invalidationBus";
import { requestSourceSync } from "./sync/sourceSyncClient";
import {
  useSyncInvalidation,
  wakeSourceSyncStatus
} from "./sync/useSourceSync";

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

const CONVERSATION_CONSENT_CONTRACT =
  "codex-conversation-content-consent-v1";
const CONVERSATION_RETENTION_DAYS = 7;

export function CodexConnector() {
  const [connection, setConnection] =
    useState<CodexConnectionState | null>(null);
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([]);
  const [selectedContentMode, setSelectedContentMode] =
    useState<CodexContentMode>("metadata_only");
  const [
    conversationConsentConfirmed,
    setConversationConsentConfirmed
  ] = useState(false);
  const [notice, setNotice] = useState<CodexNotice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [action, setAction] = useState<CodexAction>(null);
  const actionRef = useRef<CodexAction>(null);
  const connectionEpochRef = useRef(0);
  const refreshSequenceRef = useRef(0);
  const interactiveRefreshSequenceRef = useRef<number | null>(null);

  const refreshConnection = useCallback(
    async (
      forceRefresh = false,
      silent = false
    ): Promise<boolean> => {
      if (actionRef.current !== null) return false;
      if (
        silent &&
        interactiveRefreshSequenceRef.current !== null
      ) {
        return false;
      }
      const connectionEpoch = connectionEpochRef.current;
      const refreshSequence = ++refreshSequenceRef.current;
      if (!silent) {
        interactiveRefreshSequenceRef.current = refreshSequence;
        setIsRefreshing(true);
      }
      try {
        if (forceRefresh) await requestSourceSync(["codex"]);
        const response = await fetch("/api/connectors/codex/status", {
          cache: "no-store"
        });
        if (!response.ok) throw new Error("status request failed");
        const payload = (await response.json()) as CodexConnectionState;
        if (
          connectionEpoch !== connectionEpochRef.current ||
          refreshSequence !== refreshSequenceRef.current
        ) {
          return false;
        }
        setConnection(payload);
        return true;
      } catch {
        if (
          connectionEpoch !== connectionEpochRef.current ||
          refreshSequence !== refreshSequenceRef.current
        ) {
          return false;
        }
        if (!silent) {
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
        }
        return false;
      } finally {
        if (
          !silent &&
          interactiveRefreshSequenceRef.current === refreshSequence
        ) {
          interactiveRefreshSequenceRef.current = null;
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
    setSelectedContentMode(connection.contentMode);
    setConversationConsentConfirmed(
      connection.contentMode === "conversation_and_execution"
    );
  }, [connection]);

  useEffect(() => {
    if (connection?.status !== "connected") return;
    setSelectedContentMode(connection.contentMode);
    setConversationConsentConfirmed(
      connection.contentMode === "conversation_and_execution"
    );
  }, [connection]);

  useSyncInvalidation(["codex"], () => {
    void refreshConnection(false, true);
  });

  const refreshAndInvalidate = useCallback(async () => {
    const updated = await refreshConnection(true);
    if (!updated) return;
    invalidateSourceConsumers("codex", "manual_refresh");
    wakeSourceSyncStatus();
  }, [refreshConnection]);

  async function discoverScopes() {
    const actionEpoch = beginAction("discovering");
    setNotice(null);
    let succeeded = false;
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
      succeeded = true;
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
    if (succeeded) notifyConnectionChanged();
  }

  async function connectSelectedScopes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedScopeIds.length === 0) return;
    if (
      selectedContentMode === "conversation_and_execution" &&
      !conversationConsentConfirmed
    ) {
      return;
    }

    const actionEpoch = beginAction("connecting");
    setNotice(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/connectors/codex/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          scopeIds: selectedScopeIds,
          contentMode: selectedContentMode,
          ...conversationConsentPayload(
            selectedContentMode,
            conversationConsentConfirmed
          )
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
      succeeded = true;
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
    if (succeeded) notifyConnectionChanged();
  }

  async function disconnect() {
    const actionEpoch = beginAction("disconnecting");
    setNotice(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/connectors/codex/disconnect", {
        method: "POST"
      });
      if (!response.ok) throw new Error("disconnect failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection({ status: "disconnected" });
      setSelectedScopeIds([]);
      setSelectedContentMode("metadata_only");
      setConversationConsentConfirmed(false);
      setNotice({
        tone: "neutral",
        message:
          "Codex 연결, 로컬 미리보기, 저장된 대화·실행 기록을 삭제했습니다."
      });
      succeeded = true;
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message: "Codex 연결을 해제하지 못했습니다. 다시 시도해주세요."
      });
    } finally {
      finishAction(actionEpoch);
    }
    if (succeeded) {
      invalidateSourceConsumers("codex", "disconnect");
      wakeSourceSyncStatus();
    }
  }

  async function updateConnectedContentMode(
    contentMode: CodexContentMode
  ) {
    if (
      contentMode === "conversation_and_execution" &&
      !conversationConsentConfirmed
    ) {
      return;
    }
    const actionEpoch = beginAction("updating_content");
    setNotice(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/connectors/codex/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_content_mode",
          contentMode,
          ...conversationConsentPayload(
            contentMode,
            conversationConsentConfirmed
          )
        })
      });
      const payload = (await response.json()) as CodexConnectionState;
      if (!response.ok) throw new Error("content mode update failed");
      if (actionEpoch !== connectionEpochRef.current) return;
      setConnection(payload);
      if (payload.status === "connected") {
        setNotice({
          tone: "success",
          message:
            contentMode === "conversation_and_execution"
              ? "Codex의 과거 대화·실행 기록 수집을 켰습니다. 원문은 로컬에 7일간 보관됩니다."
              : contentMode === "activity_summary"
                ? "대화·실행 원문을 삭제하고 작업 설명만 사용합니다."
                : "대화·실행 원문과 작업 설명을 삭제하고 메타데이터만 사용합니다."
        });
      }
      succeeded = true;
    } catch {
      if (actionEpoch !== connectionEpochRef.current) return;
      setNotice({
        tone: "error",
        message: "Codex 수집 범위 설정을 바꾸지 못했습니다."
      });
    } finally {
      finishAction(actionEpoch);
    }
    if (succeeded) notifyConnectionChanged();
  }

  function notifyConnectionChanged(): void {
    invalidateSourceConsumers("codex", "connection_changed");
    wakeSourceSyncStatus();
  }

  function beginAction(nextAction: Exclude<CodexAction, null>): number {
    const actionEpoch = ++connectionEpochRef.current;
    actionRef.current = nextAction;
    setAction(nextAction);
    interactiveRefreshSequenceRef.current = null;
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
      className="calendarSection sourceConnectorTarget"
      id={SOURCE_CONNECTION_ANCHORS.codex}
      tabIndex={-1}
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
        이 컴퓨터의 Codex에서 선택한 프로젝트와 과거 세션 snapshot을
        확인합니다. 대화·실행 기록을 명시적으로 허용하면 사용자 프롬프트,
        Codex 답변, 계획, 명령과 출력, 파일 변경, 도구 호출과 결과를
        로컬에 7일간 저장합니다. Codex의 내부 추론은 수집하지 않습니다.
        이 기록은 이미 저장된 과거 활동이며 다른 Codex 프로세스의 실시간
        실행·승인 대기 상태를 관찰하는 기능이 아닙니다. 프로젝트 전체
        경로와 원문은 외부 서비스로 전송하지 않습니다.
      </p>
      <SourceSyncMeta source="codex" />

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
        selectedContentMode={selectedContentMode}
        conversationConsentConfirmed={
          conversationConsentConfirmed
        }
        isRefreshing={isRefreshing}
        action={action}
        onDiscover={() => void discoverScopes()}
        onConnect={connectSelectedScopes}
        onToggleScope={toggleScope}
        onSelectContentMode={(contentMode) => {
          setSelectedContentMode(contentMode);
          setConversationConsentConfirmed(false);
        }}
        onConfirmConversationConsent={
          setConversationConsentConfirmed
        }
        onUpdateConnectedContentMode={(contentMode) =>
          void updateConnectedContentMode(contentMode)
        }
        onRefresh={() => void refreshAndInvalidate()}
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
  selectedContentMode,
  conversationConsentConfirmed,
  isRefreshing,
  action,
  onDiscover,
  onConnect,
  onToggleScope,
  onSelectContentMode,
  onConfirmConversationConsent,
  onUpdateConnectedContentMode,
  onRefresh,
  onDisconnect
}: {
  connection: CodexConnectionState | null;
  selectedScopeIds: string[];
  selectedContentMode: CodexContentMode;
  conversationConsentConfirmed: boolean;
  isRefreshing: boolean;
  action: CodexAction;
  onDiscover: () => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onToggleScope: (scopeId: string, selected: boolean) => void;
  onSelectContentMode: (contentMode: CodexContentMode) => void;
  onConfirmConversationConsent: (confirmed: boolean) => void;
  onUpdateConnectedContentMode: (
    contentMode: CodexContentMode
  ) => void;
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
        <CodexContentModeFields
          value={selectedContentMode}
          conversationConsentConfirmed={
            conversationConsentConfirmed
          }
          disabled={action !== null}
          onChange={onSelectContentMode}
          onConfirmConversationConsent={
            onConfirmConversationConsent
          }
        />
        <button
          className="calendarPrimaryButton"
          type="submit"
          disabled={
            selectedScopeIds.length === 0 ||
            action !== null ||
            (selectedContentMode ===
              "conversation_and_execution" &&
              !conversationConsentConfirmed)
          }
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
        과거 활동 snapshot 기준 ·{" "}
        {contentModeLabel(connection.contentMode)}
        {connection.truncated ? " · 최대 수집 범위까지만 표시" : ""}
      </p>

      {connection.contentMode ===
      "conversation_and_execution" ? (
        <div className="calendarActionBlock">
          <p>
            대화·실행 기록{" "}
            {connection.conversationCollection.enabled
              ? "수집 중"
              : "확인 필요"}{" "}
            · 로컬 {connection.conversationCollection.retentionDays ?? 7}
            일 보관 · 저장 세션{" "}
            {connection.conversationCollection.storedSessionCount}개
          </p>
          <p className="calendarMeta">
            완료{" "}
            {connection.conversationCollection.completeSessionCount} ·
            부분/만료{" "}
            {connection.conversationCollection.partialSessionCount} ·
            실패{" "}
            {connection.conversationCollection.failedSessionCount} · 턴{" "}
            {connection.conversationCollection.turnCount} · 프롬프트{" "}
            {connection.conversationCollection.userPromptCount} · 답변{" "}
            {connection.conversationCollection.agentResponseCount} · 명령{" "}
            {
              connection.conversationCollection
                .commandExecutionCount
            }{" "}
            (실패{" "}
            {connection.conversationCollection.failedCommandCount}){" "}
            · 파일 변경{" "}
            {connection.conversationCollection.fileChangeCount} · 도구 호출{" "}
            {connection.conversationCollection.toolCallCount}
          </p>
          {connection.conversationCollection.partialSessionCount > 0 ||
          connection.conversationCollection.failedSessionCount > 0 ||
          connection.conversationCollection.truncated ? (
            <p className="calendarMeta">
              부분 수집은 세션 변경 감지, 읽기 실패, 수집 한도,
              지원되지 않는 항목 또는 내부 추론 제외 정책 때문에 표시될
              수 있습니다. 내부 추론은 어떤 경우에도 저장하지 않습니다.
            </p>
          ) : null}
          <p className="calendarMeta">
            이 상태는 과거 세션을 읽은 결과입니다. 현재 실행 중인지,
            승인이나 사용자 답변을 기다리는지는 뜻하지 않습니다.
          </p>
        </div>
      ) : null}

      {previewSessions.length > 0 ? (
        <ol className="calendarEventList">
          {previewSessions.map((session) => {
            const presentation = buildCodexSessionPresentation(
              session,
              connection.contentMode
            );
            const hasCurrentConversationContent =
              hasCurrentCodexConversationContent(
                connection.contentMode,
                session.contentState
              );

            return (
              <li key={session.id}>
                <time dateTime={session.updatedAt}>
                  마지막 활동 {formatCodexTimestamp(session.updatedAt)}
                </time>
                <span className="codexSessionActivityText">
                  {presentation.activityText}
                </span>
                <time dateTime={session.createdAt}>
                  세션 시작 {formatCodexTimestamp(session.createdAt)}
                </time>
                <span>{presentation.originText}</span>
                {connection.contentMode ===
                "conversation_and_execution" ? (
                  <small>
                    기록 {contentStateLabel(session.contentState)} · 마지막
                    턴 {historicalTurnStatusLabel(
                      session.historicalTurnStatus
                    )}{" "}
                    · 프롬프트 {session.userPromptCount} · 답변{" "}
                    {session.agentResponseCount} · 명령{" "}
                    {session.commandExecutionCount}
                    {session.failedCommandCount > 0
                      ? ` (실패 ${session.failedCommandCount})`
                      : ""}
                    {" · "}파일 변경 {session.fileChangeCount} · 도구{" "}
                    {session.toolCallCount}
                  </small>
                ) : null}
                {hasCurrentConversationContent &&
                session.latestAgentResponseExcerpt ? (
                  <small>
                    최근 답변: {session.latestAgentResponseExcerpt}
                  </small>
                ) : null}
                {hasCurrentConversationContent &&
                session.latestExecutionSummary ? (
                  <small>
                    최근 실행: {session.latestExecutionSummary}
                  </small>
                ) : null}
              </li>
            );
          })}
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

      <div className="calendarActionBlock">
        <CodexContentModeFields
          value={selectedContentMode}
          conversationConsentConfirmed={
            conversationConsentConfirmed
          }
          disabled={isRefreshing || action !== null}
          onChange={onSelectContentMode}
          onConfirmConversationConsent={
            onConfirmConversationConsent
          }
        />
        <button
          className="calendarPrimaryButton"
          type="button"
          onClick={() =>
            onUpdateConnectedContentMode(selectedContentMode)
          }
          disabled={
            isRefreshing ||
            action !== null ||
            selectedContentMode === connection.contentMode ||
            (selectedContentMode ===
              "conversation_and_execution" &&
              !conversationConsentConfirmed)
          }
        >
          {action === "updating_content"
            ? "수집 범위 변경 중"
            : selectedContentMode === connection.contentMode
              ? "현재 수집 범위"
              : "수집 범위 변경"}
        </button>
        {connection.contentMode ===
          "conversation_and_execution" &&
        selectedContentMode !==
          "conversation_and_execution" ? (
          <p className="calendarMeta">
            범위를 낮추면 저장된 대화·실행 원문이 즉시 로컬에서
            삭제됩니다.
          </p>
        ) : null}
      </div>

      <div className="calendarSecondaryActions">
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
          {action === "disconnecting"
            ? "연결 해제 중"
            : connection.contentMode ===
                "conversation_and_execution"
              ? "연결 해제 및 원문 삭제"
              : "연결 해제"}
        </button>
      </div>
    </div>
  );
}

function CodexContentModeFields({
  value,
  conversationConsentConfirmed,
  disabled,
  onChange,
  onConfirmConversationConsent
}: {
  value: CodexContentMode;
  conversationConsentConfirmed: boolean;
  disabled: boolean;
  onChange: (contentMode: CodexContentMode) => void;
  onConfirmConversationConsent: (confirmed: boolean) => void;
}) {
  const options: {
    value: CodexContentMode;
    label: string;
    description: string;
  }[] = [
    {
      value: "metadata_only",
      label: "메타데이터만",
      description:
        "프로젝트, 세션 시각과 활동 여부만 사용합니다. 작업 내용 원문은 저장하지 않습니다."
    },
    {
      value: "activity_summary",
      label: "작업 설명 포함",
      description:
        "작업 제목 또는 첫 요청의 필터된 앞부분만 사용합니다. 전체 프롬프트·답변·실행 기록은 저장하지 않습니다."
    },
    {
      value: "conversation_and_execution",
      label: "대화·실행 기록 포함",
      description:
        "전체 사용자 프롬프트, Codex 답변, 계획, 명령·출력, 파일 변경, 도구 호출·결과를 로컬에 7일간 저장합니다."
    }
  ];

  return (
    <>
      <fieldset className="codexScopeList">
        <legend>Codex 수집 범위</legend>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="codex-content-mode"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {value === "conversation_and_execution" ? (
        <label className="codexSummaryConsent">
          <input
            type="checkbox"
            checked={conversationConsentConfirmed}
            onChange={(event) =>
              onConfirmConversationConsent(event.target.checked)
            }
            disabled={disabled}
          />
          <span>
            <strong>7일 로컬 보관에 명시적으로 동의합니다</strong>
            <small>
              선택한 프로젝트의 과거 세션 원문을 수집합니다. 내부 추론은
              제외하며, 범위를 낮추거나 연결을 해제하면 저장 원문을
              삭제합니다. 이 데이터는 실시간 Codex 실행 상태가 아닙니다.
            </small>
          </span>
        </label>
      ) : null}
    </>
  );
}

function conversationConsentPayload(
  contentMode: CodexContentMode,
  confirmed: boolean
):
  | Record<string, never>
  | {
      conversationConsentAccepted: true;
      conversationConsentContract: typeof CONVERSATION_CONSENT_CONTRACT;
      conversationRetentionDays: typeof CONVERSATION_RETENTION_DAYS;
    } {
  if (
    contentMode !== "conversation_and_execution" ||
    !confirmed
  ) {
    return {};
  }
  return {
    conversationConsentAccepted: true,
    conversationConsentContract: CONVERSATION_CONSENT_CONTRACT,
    conversationRetentionDays: CONVERSATION_RETENTION_DAYS
  };
}

function contentModeLabel(contentMode: CodexContentMode): string {
  switch (contentMode) {
    case "metadata_only":
      return "메타데이터만 사용";
    case "activity_summary":
      return "작업 설명 포함";
    case "conversation_and_execution":
      return "대화·실행 기록 포함";
  }
}

function contentStateLabel(
  state:
    | "not_collected"
    | "complete"
    | "partial"
    | "stale"
    | "failed"
    | "expired"
): string {
  switch (state) {
    case "not_collected":
      return "수집 안 함";
    case "complete":
      return "완료";
    case "partial":
      return "부분 수집";
    case "stale":
      return "이전 snapshot";
    case "failed":
      return "읽기 실패";
    case "expired":
      return "보관 만료";
  }
}

function historicalTurnStatusLabel(
  status:
    | "completed"
    | "failed"
    | "interrupted"
    | "in_progress"
    | "unknown"
): string {
  switch (status) {
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "interrupted":
      return "중단";
    case "in_progress":
      return "저장 당시 진행 중";
    case "unknown":
      return "알 수 없음";
  }
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
