import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkSuggestionSetupActionActivation,
  runWorkSuggestionSetupAction,
  scheduleWorkBoardExpiryTicks,
  WorkSuggestionBoardPanel,
  WORK_BOARD_EXPIRY_TIMER_CHUNK_MS
} from "../app/WorkSuggestionBoardPanel";
import type { SemanticContinuationWorkBoardResponse } from "../src/semanticContinuation/contracts";

const ITEM_REF = `item_ref_${"a".repeat(32)}`;
const CONTINUATION_REF = `item_ref_${"b".repeat(32)}`;
const SETUP_REF = `item_ref_${"c".repeat(32)}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkSuggestionBoardPanel", () => {
  it("renders fixed lanes in order and preserves item order with an exact overlay title", () => {
    const response = readyFeed();
    const before = JSON.stringify(response.base);
    const markup = render(response);

    expect(markup.indexOf("지금 처리할 일")).toBeLessThan(
      markup.indexOf("이어서 할 일")
    );
    expect(markup.indexOf("이어서 할 일")).toBeLessThan(
      markup.indexOf("연결할 일")
    );
    expect(markup.indexOf("지금 확인할 작업")).toBeLessThan(
      markup.indexOf("QA 진행 상태 확인하기")
    );
    expect(markup).toContain("QA 진행 상태 확인하기");
    expect(markup).not.toContain("최근 작업 이어가기</h4>");
    expect(markup).toContain("소스 범위 일부");
    expect(JSON.stringify(response.base)).toBe(before);
  });

  it("renders no_action with continuation and exact empty wording without inferring status", () => {
    const response = readyFeed();
    if (response.base.status !== "ready") throw new TypeError("fixture");
    response.base.board.primary = response.base.board.alternatives[0]!;
    response.base.board.alternatives = [];
    response.base.board.prominentLane = "continuation";
    response.semanticPresentation = null;

    const markup = render(response);
    expect(markup).toContain("최근 작업 이어가기");
    expect(markup.match(/표시할 제안 없음/gu)).toHaveLength(2);
    expect(markup).not.toMatch(/완료|통과|실패|긴급/u);
  });

  it("hides items when current wall clock reaches expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-14T08:00:00.000Z");
    const markup = render(readyFeed(), new Date());
    expect(markup).not.toContain("최근 작업 이어가기");
    expect(markup).not.toContain("작업공간 연결하기");
    expect(markup).toContain("지금 확인할 작업");
  });

  it("ticks a 30-day expiry in bounded chunks and removes it after expiry", () => {
    vi.useFakeTimers();
    const start = Date.parse("2026-08-13T08:00:00.000Z");
    const expiresAt = start + 30 * 24 * 60 * 60 * 1_000;
    vi.setSystemTime(start);
    const response = readyFeed();
    if (response.base.status !== "ready") throw new TypeError("fixture");
    response.semanticPresentation = null;
    for (const entry of response.base.board.alternatives) {
      entry.item.expiresAt = new Date(expiresAt).toISOString();
    }
    const ticks: number[] = [];
    const cancel = scheduleWorkBoardExpiryTicks(
      expiresAt,
      (nowMs) => {
        ticks.push(nowMs);
      },
      {
        now: () => Date.now(),
        schedule: (callback, delayMs) => setTimeout(callback, delayMs),
        cancel: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>)
      }
    );

    expect(render(response, new Date(start))).toContain("최근 작업 이어가기");
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(WORK_BOARD_EXPIRY_TIMER_CHUNK_MS - 1);
    expect(ticks).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ticks).toEqual([start + WORK_BOARD_EXPIRY_TIMER_CHUNK_MS]);
    expect(vi.getTimerCount()).toBe(1);
    expect(render(response, new Date(ticks[0]!))).toContain(
      "최근 작업 이어가기"
    );

    vi.setSystemTime(expiresAt);
    vi.advanceTimersByTime(WORK_BOARD_EXPIRY_TIMER_CHUNK_MS);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(expiresAt);
    expect(vi.getTimerCount()).toBe(0);
    expect(render(response, new Date(ticks.at(-1)!))).not.toContain(
      "최근 작업 이어가기"
    );
    cancel();
  });

  it("does not client-dedupe equal titles with distinct public refs", () => {
    const response = readyFeed();
    if (response.base.status !== "ready") throw new TypeError("fixture");
    response.semanticPresentation = null;
    response.base.board.primary!.item.title = "같은 표시 제목";
    response.base.board.primary!.item.summary = "같은 표시 제목";
    response.base.board.alternatives[0]!.item.title = "같은 표시 제목";
    response.base.board.alternatives[0]!.item.summary = "같은 표시 제목";

    const markup = render(response);
    expect(markup.match(/같은 표시 제목/gu)).toHaveLength(2);
  });

  it("uses exact empty copy even when summarized status cannot explain visibility", () => {
    const availableButAttentionOnly = readyFeed();
    if (availableButAttentionOnly.base.status !== "ready") {
      throw new TypeError("fixture");
    }
    availableButAttentionOnly.semanticPresentation = null;
    availableButAttentionOnly.base.board.alternatives = [];
    availableButAttentionOnly.base.board.continuationStatus = "available";
    expect(
      render(availableButAttentionOnly).match(/표시할 제안 없음/gu)
    ).toHaveLength(2);

    const empty = readyFeed();
    if (empty.base.status !== "ready") throw new TypeError("fixture");
    empty.semanticPresentation = null;
    empty.base.board.primary = null;
    empty.base.board.alternatives = [];
    empty.base.board.prominentLane = "none";
    empty.base.board.continuationStatus = "empty";
    expect(render(empty).match(/표시할 제안 없음/gu)).toHaveLength(3);

    const fallback = readyFeed();
    if (fallback.base.status !== "ready") throw new TypeError("fixture");
    fallback.base.mode = "active_only_fallback";
    fallback.base.reasonCode = "CONTINUATION_PREREQUISITES_UNAVAILABLE";
    fallback.semanticPresentation = null;
    fallback.base.board.alternatives = [];
    fallback.base.board.continuationStatus = "unavailable";
    expect(render(fallback).match(/표시할 제안 없음/gu)).toHaveLength(2);
  });

  it("fails the whole feed closed for an actionful or private hostile item", () => {
    const actionful = readyFeed() as unknown as Record<string, unknown>;
    const base = actionful.base as Record<string, unknown>;
    const board = base.board as Record<string, unknown>;
    const primary = board.primary as Record<string, unknown>;
    const item = primary.item as Record<string, unknown>;
    item.capability = "open_source";
    item.action = {
      actionRef: `action_ref_${"p".repeat(32)}`,
      target: "/private/path"
    };

    const markup = render(actionful as never);
    expect(markup).toContain("작업 제안을 표시하지 못했습니다.");
    expect(markup).not.toContain("지금 확인할 작업");
    expect(markup).not.toMatch(/action_ref_|private\/path/u);
  });

  it("uses accessible non-interactive list markup without public refs in DOM", () => {
    const markup = render(readyFeed());
    expect(markup).toContain("<section");
    expect(markup).toContain("<h3>지금 처리할 일</h3>");
    expect(markup).toContain("<h4>지금 확인할 작업</h4>");
    expect(markup).toContain("<ol>");
    expect(markup).toContain("<li>");
    expect(markup).not.toMatch(/<(?:button|a|form|input|select|textarea)\b/u);
    expect(markup).not.toMatch(/role="button"|on(?:click|key)/iu);
    expect(markup).not.toMatch(/(?:item_ref_|context_ref_|action_ref_)/u);
    expect(markup).not.toMatch(/(?:data-|href=|onclick=)/iu);
    expect(markup).not.toContain('aria-live="assertive"');
  });

  it("renders exactly one Setup CTA only behind the explicit capability prop", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const disabled = render(readyFeed());
    expect(disabled).not.toContain("설정 화면 열기");
    expect(disabled).not.toMatch(/<(?:button|a|form)\b/u);

    const enabled = render(readyFeed(), undefined, true);
    expect(enabled.match(/<button\b/gu)).toHaveLength(1);
    expect(enabled).toContain("설정 화면 열기");
    expect(enabled.indexOf("설정 화면 열기")).toBeGreaterThan(
      enabled.indexOf("작업공간 연결하기")
    );
    expect(enabled.indexOf("설정 화면 열기")).toBeGreaterThan(
      enabled.indexOf("연결할 일")
    );
    expect(enabled).not.toMatch(/(?:item_ref_|offer_|action_ref_)/u);
    expect(enabled).not.toMatch(/(?:href|data-[^=]+)=/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hardcodes navigation only after an exact opened response", async () => {
    const navigate = vi.fn();
    const request = vi.fn().mockResolvedValue({
      contract: "continuation-setup-action-api-v0.1",
      status: "opened",
      destination: "project_mappings",
      navigateTo: "/projects"
    });
    await runWorkSuggestionSetupAction(SETUP_REF, request, navigate);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      itemRef: SETUP_REF,
      explicitUserAction: true
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/projects");

    for (const hostile of [
      {
        contract: "continuation-setup-action-api-v0.1",
        status: "opened",
        destination: "project_mappings",
        navigateTo: "https://hostile.example"
      },
      {
        contract: "continuation-setup-action-api-v0.1",
        status: "opened",
        destination: "native_app",
        navigateTo: "/projects"
      }
    ]) {
      const rejectedNavigate = vi.fn();
      await expect(
        runWorkSuggestionSetupAction(
          SETUP_REF,
          vi.fn().mockResolvedValue(hostile),
          rejectedNavigate
        )
      ).rejects.toThrow("Invalid setup action response.");
      expect(rejectedNavigate).not.toHaveBeenCalled();
    }
  });

  it("coalesces pending activations, does not retry, and exposes bounded states", async () => {
    let resolveRun!: () => void;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        })
    );
    const states: string[] = [];
    const activate = createWorkSuggestionSetupActionActivation(
      SETUP_REF,
      (state) => states.push(state),
      run
    );
    const first = activate();
    const second = activate();
    expect(run).toHaveBeenCalledOnce();
    expect(states).toEqual(["pending"]);
    resolveRun();
    await Promise.all([first, second]);
    expect(states).toEqual(["pending", "opened"]);
    await activate();
    expect(run).toHaveBeenCalledOnce();

    const failedRun = vi.fn().mockRejectedValue(new Error("private detail"));
    const failedStates: string[] = [];
    const fail = createWorkSuggestionSetupActionActivation(
      SETUP_REF,
      (state) => failedStates.push(state),
      failedRun
    );
    await fail();
    expect(failedRun).toHaveBeenCalledOnce();
    expect(failedStates).toEqual(["pending", "error"]);
    await fail();
    expect(failedRun).toHaveBeenCalledOnce();
  });
});

function render(
  response: SemanticContinuationWorkBoardResponse,
  now?: Date,
  setupActionEnabled = false
) {
  return renderToStaticMarkup(
    createElement(WorkSuggestionBoardPanel, {
      response,
      now: now ?? new Date("2026-08-13T09:30:00.000Z"),
      setupActionEnabled
    })
  );
}

function readyFeed(): SemanticContinuationWorkBoardResponse {
  return {
    contract: "semantic-continuation-work-board-response-v0.2",
    schemaVersion: "semantic-continuation-presentation-schema-v0.2",
    base: {
      status: "ready",
      mode: "full",
      reasonCode: null,
      board: {
        contract: "work-suggestion-board-public-v0.1",
        schemaVersion: "work-suggestion-board-schema-v0.1",
        generatedAt: "2026-08-13T09:00:00.000Z",
        prominentLane: "attention",
        continuationStatus: "available",
        primary: {
          lane: "attention",
          item: {
            itemRef: ITEM_REF,
            workContextRef: null,
            kind: "active_attention",
            title: "지금 확인할 작업",
            summary: "지금 확인할 작업",
            observedAt: "2026-08-13T08:00:00.000Z",
            expiresAt: null,
            evidenceBand: "verified_attention",
            capability: "display",
            action: null,
            caveatCodes: []
          }
        },
        alternatives: [
          {
            lane: "continuation",
            item: {
              itemRef: CONTINUATION_REF,
              workContextRef: `context_ref_${"d".repeat(32)}`,
              kind: "linked_workstream",
              title: "최근 작업 이어가기",
              summary: "최근 작업 이어가기",
              observedAt: "2026-08-13T08:00:00.000Z",
              expiresAt: "2026-08-14T08:00:00.000Z",
              evidenceBand: "corroborated",
              capability: "display",
              action: null,
              caveatCodes: ["SOURCE_COVERAGE_PARTIAL"]
            }
          },
          {
            lane: "setup",
            item: {
              itemRef: SETUP_REF,
              workContextRef: null,
              kind: "workspace_mapping",
              title: "작업공간 연결하기",
              summary: "작업공간 연결하기",
              observedAt: "2026-08-13T08:00:00.000Z",
              expiresAt: "2026-08-14T08:00:00.000Z",
              evidenceBand: "setup",
              capability: "display",
              action: null,
              caveatCodes: ["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"]
            }
          }
        ],
        executionPolicy: {
          automaticExecutionAllowed: false,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      }
    },
    semanticPresentation: {
      contract: "semantic-continuation-presentation-v0.2",
      schemaVersion: "semantic-continuation-presentation-schema-v0.2",
      baseGeneratedAt: "2026-08-13T09:00:00.000Z",
      overlays: [
        {
          itemRef: CONTINUATION_REF,
          displayTitle: "QA 진행 상태 확인하기"
        }
      ]
    }
  };
}
