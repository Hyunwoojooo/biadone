import type {
  CodexConversationCollectionState,
  CodexContentMode,
  CodexPreviewSession,
  CodexTaskSummarySource
} from "../src/connectors/codex/types";

type CodexSessionPresentationInput = Pick<
  CodexPreviewSession,
  | "projectLabel"
  | "taskSummary"
  | "taskSummarySource"
  | "contentState"
  | "latestUserPromptExcerpt"
>;

export type CodexSessionPresentation = {
  activityText: string;
  originText: string;
};

export function buildCodexSessionPresentation(
  session: CodexSessionPresentationInput,
  contentMode: CodexContentMode
): CodexSessionPresentation {
  const latestRequest =
    hasCurrentCodexConversationContent(
      contentMode,
      session.contentState
    )
      ? session.latestUserPromptExcerpt
      : null;

  return {
    activityText: latestRequest
      ? `${session.projectLabel} · 최근 요청: ${latestRequest}`
      : `${session.projectLabel} · Codex 세션 활동`,
    originText: session.taskSummary
      ? `${codexTaskSummaryLabel(session.taskSummarySource)}: ${session.taskSummary}`
      : "작업 설명 없음"
  };
}

export function hasCurrentCodexConversationContent(
  contentMode: CodexContentMode,
  contentState: CodexConversationCollectionState
): boolean {
  return (
    contentMode === "conversation_and_execution" &&
    contentState === "complete"
  );
}

export function codexTaskSummaryLabel(
  source: CodexTaskSummarySource
): "작업 제목" | "첫 요청" | "작업 설명" {
  switch (source) {
    case "thread_name":
      return "작업 제목";
    case "first_user_request":
      return "첫 요청";
    default:
      return "작업 설명";
  }
}
