import {
  CodexConnectorError,
  type CodexConnectorErrorCode
} from "./appServer";
import type {
  CodexConnectionState,
  CodexSnapshot,
  StoredCodexConfig
} from "./types";

const LOCAL_URL = "http://localhost:3102";

export function codexScopeSelectionState(
  config: StoredCodexConfig
): CodexConnectionState {
  return {
    status: "scope_selection",
    message:
      config.scopes.length === 0
        ? "최근 30일 동안 연결할 수 있는 Codex 프로젝트를 찾지 못했습니다."
        : "제안에 사용할 Codex 프로젝트를 선택해주세요.",
    contentMode: config.contentMode,
    scopes: config.scopes.map((scope) => ({
      id: scope.id,
      label: scope.label,
      sessionCount: scope.sessionCount,
      lastActivityAt: scope.lastActivityAt,
      selected: config.selectedScopeIds.includes(scope.id)
    }))
  };
}

export function connectedCodexState(
  snapshot: CodexSnapshot,
  config: StoredCodexConfig
): CodexConnectionState {
  const selectedScopeIds = new Set(config.selectedScopeIds);
  const canShowTaskSummaries =
    config.contentMode !== "metadata_only" &&
    config.contentConsentAt !== null &&
    snapshot.contentMode === config.contentMode;
  const conversationEnabled =
    config.contentMode === "conversation_and_execution" &&
    config.conversationConsentContract ===
      "codex-conversation-content-consent-v1" &&
    config.conversationConsentAt !== null &&
    config.conversationRetentionDays === 7 &&
    snapshot.contentMode === "conversation_and_execution" &&
    snapshot.conversationRetentionDays === 7 &&
    snapshot.conversationStoreSha256 !== null;
  const contentManifests = snapshot.sessions.map(
    (session) => session.content
  );

  return {
    status: "connected",
    codexVersion: snapshot.codexVersion,
    lastSyncedAt: snapshot.fetchedAt,
    lookbackStart: snapshot.lookbackStart,
    sessionCount: snapshot.sessions.length,
    projectCount: config.scopes.filter((scope) =>
      selectedScopeIds.has(scope.id)
    ).length,
    truncated: snapshot.truncated,
    contentMode: config.contentMode,
    conversationCollection: {
      enabled: conversationEnabled,
      retentionDays: conversationEnabled ? 7 : null,
      consentedAt: conversationEnabled
        ? config.conversationConsentAt
        : null,
      completeSessionCount: contentManifests.filter(
        (content) => content.state === "complete"
      ).length,
      partialSessionCount: contentManifests.filter((content) =>
        ["partial", "stale", "expired"].includes(content.state)
      ).length,
      failedSessionCount: contentManifests.filter(
        (content) => content.state === "failed"
      ).length,
      storedSessionCount: contentManifests.filter(
        (content) => content.contentSha256 !== null
      ).length,
      turnCount: sumContentCount(
        contentManifests,
        "turnCount"
      ),
      userPromptCount: sumContentCount(
        contentManifests,
        "userPromptCount"
      ),
      agentResponseCount: sumContentCount(
        contentManifests,
        "agentResponseCount"
      ),
      commandExecutionCount: sumContentCount(
        contentManifests,
        "commandExecutionCount"
      ),
      failedCommandCount: sumContentCount(
        contentManifests,
        "failedCommandCount"
      ),
      fileChangeCount: sumContentCount(
        contentManifests,
        "fileChangeCount"
      ),
      toolCallCount: sumContentCount(
        contentManifests,
        "toolCallCount"
      ),
      truncated:
        snapshot.truncated ||
        contentManifests.some((content) => content.truncated)
    },
    sessions: snapshot.sessions.slice(0, 3).map((session) => ({
      id: session.id,
      projectLabel: session.projectLabel,
      taskSummary: canShowTaskSummaries
        ? session.taskSummary
        : null,
      taskSummarySource: canShowTaskSummaries
        ? session.taskSummarySource
        : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      contentState: session.content.state,
      historicalTurnStatus:
        session.content.historicalTurnStatus,
      userPromptCount: session.content.userPromptCount,
      agentResponseCount: session.content.agentResponseCount,
      commandExecutionCount:
        session.content.commandExecutionCount,
      failedCommandCount: session.content.failedCommandCount,
      fileChangeCount: session.content.fileChangeCount,
      toolCallCount: session.content.toolCallCount,
      latestUserPromptExcerpt:
        session.content.latestUserPromptExcerpt,
      latestAgentResponseExcerpt:
        session.content.latestAgentResponseExcerpt,
      latestExecutionSummary:
        session.content.latestExecutionSummary
    }))
  };
}

export function codexSnapshotMatchesConfig(
  snapshot: CodexSnapshot,
  config: StoredCodexConfig,
  now = new Date()
): boolean {
  const selectedIds = [...new Set(config.selectedScopeIds)].sort();
  const conversationContentNotExpired = snapshot.sessions.every(
    (session) =>
      session.content.contentSha256 === null ||
      (session.content.expiresAt !== null &&
        Date.parse(session.content.expiresAt) > now.getTime())
  );
  const conversationSnapshotNotExpired =
    Number.isFinite(Date.parse(snapshot.fetchedAt)) &&
    Date.parse(snapshot.fetchedAt) +
      7 * 24 * 60 * 60 * 1_000 >
      now.getTime();
  const contentModeMatches =
    snapshot.contentMode === config.contentMode &&
    (config.contentMode === "metadata_only" ||
      (config.contentConsentAt !== null &&
        (config.contentMode === "activity_summary" ||
          (config.conversationConsentAt !== null &&
            config.conversationConsentContract ===
              "codex-conversation-content-consent-v1" &&
            config.conversationRetentionDays === 7 &&
            snapshot.conversationRetentionDays === 7 &&
            snapshot.conversationStoreSha256 !== null &&
            conversationSnapshotNotExpired &&
            conversationContentNotExpired))));
  return (
    contentModeMatches &&
    selectedIds.length === snapshot.scopeIds.length &&
    selectedIds.every(
      (scopeId, index) => scopeId === snapshot.scopeIds[index]
    )
  );
}

function sumContentCount(
  manifests: CodexSnapshot["sessions"][number]["content"][],
  field:
    | "turnCount"
    | "userPromptCount"
    | "agentResponseCount"
    | "commandExecutionCount"
    | "failedCommandCount"
    | "fileChangeCount"
    | "toolCallCount"
): number {
  return manifests.reduce(
    (total, manifest) => total + manifest[field],
    0
  );
}

export function codexUnavailableState(): CodexConnectionState {
  return {
    status: "unavailable",
    message: `Codex 연결은 ${LOCAL_URL}에서 확인해주세요.`,
    localUrl: LOCAL_URL
  };
}

export function codexErrorState(
  error: unknown,
  lastSyncedAt: string | null
): CodexConnectionState {
  const code =
    error instanceof CodexConnectorError ? error.code : null;

  if (code && unavailableErrorCodes.has(code)) {
    return {
      status: "unavailable",
      message: unavailableErrorMessage(code)
    };
  }

  return {
    status: "sync_error",
    message:
      code === "APP_SERVER_TIMEOUT"
        ? "Codex 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
        : "Codex 작업 메타데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    lastSyncedAt
  };
}

const unavailableErrorCodes = new Set<CodexConnectorErrorCode>([
  "CODEX_NOT_INSTALLED",
  "INVALID_BINARY_OVERRIDE",
  "APP_SERVER_START_FAILED"
]);

function unavailableErrorMessage(
  code: CodexConnectorErrorCode
): string {
  switch (code) {
    case "CODEX_NOT_INSTALLED":
      return "이 컴퓨터에서 Codex를 찾지 못했습니다. Codex를 설치한 뒤 다시 시도해주세요.";
    case "INVALID_BINARY_OVERRIDE":
      return "설정된 Codex 실행 파일을 사용할 수 없습니다. BLABASE_CODEX_BINARY_PATH를 확인해주세요.";
    case "APP_SERVER_START_FAILED":
      return "Codex App Server를 시작할 수 없습니다. Codex를 최신 버전으로 업데이트한 뒤 다시 시도해주세요.";
    default:
      return "Codex를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }
}
