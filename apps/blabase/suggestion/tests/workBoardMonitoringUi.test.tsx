import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import TodayPage from "../app/page";
import { WorkBoardMonitoringControls } from "../app/WorkBoardMonitoringControls";
import type { BrowserWorkBoardMonitoringReceipt } from "../app/workBoardMonitoringClient";
import {
  monitoringPresentationKey,
  WorkSuggestionBoardPanel
} from "../app/WorkSuggestionBoardPanel";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  createWorkBoardMonitoringReceipt,
  type WorkBoardMonitoringQuality
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Work Board monitoring UI", () => {
  it("is absent by default and visible only behind the exact server flag", () => {
    vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "false");
    expect(renderToStaticMarkup(createElement(TodayPage))).not.toContain(
      "Work Board 피드백"
    );
    vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "true");
    expect(renderToStaticMarkup(createElement(TodayPage))).toContain(
      "Work Board 피드백"
    );
  });

  it("shows only redacted aggregate/history and explicit consent/purge controls", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkBoardMonitoringControls, {
        enabled: true,
        state: {
          contract: WORK_BOARD_MONITORING_API_CONTRACT,
          status: "ready",
          consent: true,
          aggregate: emptyAggregate(),
          history: [
            {
              occurredAt: MONITORING_NOW.toISOString(),
              eventType: "feedback_recorded",
              lane: "continuation",
              position: "alternative_1",
              mode: "full",
              evidenceBand: "corroborated",
              feedback: "useful",
              reason: null,
              reviewState: "candidate",
              appliedToRanking: false,
              goldEligible: false,
              releaseGateEligible: false
            }
          ]
        },
        error: null,
        pending: false,
        onConsent: vi.fn(),
        onPurge: vi.fn()
      })
    );
    expect(markup).toContain("피드백 사용 동의");
    expect(markup).toContain("동의 철회");
    expect(markup).toContain("모니터링 데이터 모두 삭제");
    expect(markup).toContain("유용함");
    expect(markup).not.toMatch(
      /(?:wbm1\.|work_board_monitor_|item_ref_|context_ref_|candidate_|run_)/u
    );
  });

  it("keeps explicit all-data purge available when the current key is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkBoardMonitoringControls, {
        enabled: true,
        state: null,
        error: "로컬 피드백 상태를 확인하지 못했습니다.",
        pending: false,
        onConsent: vi.fn(),
        onPurge: vi.fn()
      })
    );
    expect(markup).toContain("모니터링 데이터 모두 삭제");
    expect(markup).toContain("로컬 모니터링 상태를 확인할 수 없습니다.");
    expect(markup).not.toContain("피드백 사용 동의");
  });

  it("does not POST or expose feedback controls before a rendered receipt is acknowledged", () => {
    const authority = monitoringAuthority();
    const receipt = createWorkBoardMonitoringReceipt({
      authority,
      issuedAt: MONITORING_NOW
    })!;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const markup = renderToStaticMarkup(
      createElement(WorkSuggestionBoardPanel, {
        response: authority.response,
        now: MONITORING_NOW,
        monitoringConsent: true,
        monitoringReceipt: {
          receipt: receipt.headerValue,
          payload: receipt.payload
        }
      })
    );

    expect(markup).not.toContain("유용하지 않음");
    expect(markup).not.toContain("피드백 초기화");
    expect(markup).not.toContain("wbm1.");
    expect(markup).not.toContain("work_board_monitor_");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps logical presentation acknowledgement stable across poll receipts", () => {
    const authority = monitoringAuthority();
    const first = createWorkBoardMonitoringReceipt({
      authority,
      issuedAt: MONITORING_NOW
    })!;
    const second = createWorkBoardMonitoringReceipt({
      authority: {
        ...authority,
        sources: [
          {
            ...authority.sources[0],
            batchSha256: "9".repeat(64),
            snapshotFetchedAt: "2026-08-13T09:00:30.000Z"
          },
          {
            ...authority.sources[1],
            batchSha256: "8".repeat(64),
            snapshotFetchedAt: "2026-08-13T09:00:30.000Z"
          }
        ]
      },
      issuedAt: new Date(MONITORING_NOW.getTime() + 30_000)
    })!;

    expect(second.payload.captureId).not.toBe(first.payload.captureId);
    expect(
      monitoringPresentationKey({
        receipt: first.headerValue,
        payload: first.payload
      })
    ).toBe(
      monitoringPresentationKey({
        receipt: second.headerValue,
        payload: second.payload
      })
    );
    expect(second.payload.sources).not.toEqual(first.payload.sources);

    const changedTarget = {
      receipt: second.headerValue,
      payload: {
        ...second.payload,
        items: second.payload.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                presentationTargetHmac: `work_board_monitor_${"f".repeat(64)}`
              }
            : item
        )
      }
    } as BrowserWorkBoardMonitoringReceipt;
    expect(monitoringPresentationKey(changedTarget)).not.toBe(
      monitoringPresentationKey({
        receipt: second.headerValue,
        payload: second.payload
      })
    );
  });
});

function emptyAggregate(): WorkBoardMonitoringQuality {
  return {
    contract: WORK_BOARD_MONITORING_QUALITY_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    asOf: MONITORING_NOW.toISOString(),
    eventCount: 0,
    eligibleDistinct: 0,
    ratedDistinct: 0,
    usefulDistinct: 0,
    coverage: { numerator: 0, denominator: 0, value: null },
    usefulShare: { numerator: 0, denominator: 0, value: null },
    strata: [],
    reviewState: "candidate",
    appliedToRanking: false,
    goldEligible: false,
    releaseGateEligible: false
  };
}
