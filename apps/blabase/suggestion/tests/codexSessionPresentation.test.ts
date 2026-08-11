import { describe, expect, it } from "vitest";

import {
  buildCodexSessionPresentation,
  hasCurrentCodexConversationContent
} from "../app/codexSessionPresentation";

describe("Codex session presentation", () => {
  it("pairs the latest activity with the latest request and labels the first request separately", () => {
    expect(
      buildCodexSessionPresentation(
        {
          projectLabel: "blabase",
          taskSummary: "GitHub 연결을 고쳐줘",
          taskSummarySource: "first_user_request",
          contentState: "complete",
          latestUserPromptExcerpt: "테스트까지 확인해줘"
        },
        "conversation_and_execution"
      )
    ).toEqual({
      activityText: "blabase · 최근 요청: 테스트까지 확인해줘",
      originText: "첫 요청: GitHub 연결을 고쳐줘"
    });
  });

  it("does not present a first request as the latest activity when conversation content is unavailable", () => {
    expect(
      buildCodexSessionPresentation(
        {
          projectLabel: "blabase",
          taskSummary: "연결 개선",
          taskSummarySource: "thread_name",
          contentState: "complete",
          latestUserPromptExcerpt: "이 값은 표시하면 안 돼"
        },
        "activity_summary"
      )
    ).toEqual({
      activityText: "blabase · Codex 세션 활동",
      originText: "작업 제목: 연결 개선"
    });
  });

  it("does not pair a stale request excerpt with the latest activity", () => {
    expect(
      buildCodexSessionPresentation(
        {
          projectLabel: "blabase",
          taskSummary: "연결 개선",
          taskSummarySource: "first_user_request",
          contentState: "stale",
          latestUserPromptExcerpt: "이전 요청"
        },
        "conversation_and_execution"
      )
    ).toEqual({
      activityText: "blabase · Codex 세션 활동",
      originText: "첫 요청: 연결 개선"
    });
  });

  it("does not present a partial collection as the latest request", () => {
    expect(
      buildCodexSessionPresentation(
        {
          projectLabel: "blabase",
          taskSummary: "연결 개선",
          taskSummarySource: "first_user_request",
          contentState: "partial",
          latestUserPromptExcerpt: "수집된 일부 요청"
        },
        "conversation_and_execution"
      )
    ).toEqual({
      activityText: "blabase · Codex 세션 활동",
      originText: "첫 요청: 연결 개선"
    });
  });

  it("only treats a complete conversation collection as current", () => {
    expect(
      hasCurrentCodexConversationContent(
        "conversation_and_execution",
        "complete"
      )
    ).toBe(true);
    expect(
      hasCurrentCodexConversationContent(
        "conversation_and_execution",
        "partial"
      )
    ).toBe(false);
    expect(
      hasCurrentCodexConversationContent(
        "conversation_and_execution",
        "stale"
      )
    ).toBe(false);
    expect(
      hasCurrentCodexConversationContent(
        "activity_summary",
        "complete"
      )
    ).toBe(false);
  });
});
