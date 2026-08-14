import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDisplayOnlyWorkBoardWithMonitoring,
  fetchWorkBoardMonitoringState,
  parseBrowserMonitoringReceipt,
  submitWorkBoardMonitoringMutation
} from "../app/workBoardMonitoringClient";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_RECEIPT_HEADER,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  createWorkBoardMonitoringReceipt
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Work Board monitoring browser client", () => {
  it("accepts a correlated bounded receipt without changing the Board body", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONITORING_NOW);
    const authority = monitoringAuthority();
    const receipt = createWorkBoardMonitoringReceipt({
      authority,
      issuedAt: MONITORING_NOW
    })!;
    const body = JSON.stringify(authority.response);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            [WORK_BOARD_MONITORING_RECEIPT_HEADER]: receipt.headerValue
          }
        })
      )
    );

    const loaded = await fetchDisplayOnlyWorkBoardWithMonitoring();

    expect(JSON.stringify(loaded.response)).toBe(body);
    expect(loaded.monitoringReceipt).toEqual({
      receipt: receipt.headerValue,
      payload: receipt.payload
    });
    expect(fetch).toHaveBeenCalledWith("/api/work-board", {
      cache: "no-store"
    });
  });

  it("drops a tampered, expired, or response-mismatched receipt while preserving display", () => {
    const authority = monitoringAuthority();
    const receipt = createWorkBoardMonitoringReceipt({
      authority,
      issuedAt: MONITORING_NOW
    })!;
    const mismatched = structuredClone(authority.response);
    if (mismatched.base.status !== "ready") throw new Error("fixture");
    mismatched.base.board.generatedAt = "2026-08-13T09:00:01.000Z";

    expect(
      parseBrowserMonitoringReceipt(
        receipt.headerValue.slice(0, -1),
        authority.response,
        MONITORING_NOW
      )
    ).toBeNull();
    expect(
      parseBrowserMonitoringReceipt(
        receipt.headerValue,
        mismatched,
        MONITORING_NOW
      )
    ).toBeNull();
    expect(
      parseBrowserMonitoringReceipt(
        receipt.headerValue,
        authority.response,
        new Date(receipt.payload.expiresAt)
      )
    ).toBeNull();
  });

  it("rejects non-JSON auth and network failures with a bounded client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("<html>login</html>", {
            status: 401,
            headers: { "content-type": "text/html" }
          })
        )
        .mockRejectedValueOnce(new Error("private network detail"))
    );

    await expect(fetchDisplayOnlyWorkBoardWithMonitoring()).rejects.toThrow(
      "WORK_BOARD_MONITORING_UNAVAILABLE"
    );
    await expect(fetchDisplayOnlyWorkBoardWithMonitoring()).rejects.toThrow(
      "WORK_BOARD_MONITORING_UNAVAILABLE"
    );
  });

  it("strictly parses state and sends only the explicit mutation", async () => {
    const aggregate = {
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
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          contract: WORK_BOARD_MONITORING_API_CONTRACT,
          status: "ready",
          consent: false,
          aggregate,
          history: []
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          contract: WORK_BOARD_MONITORING_API_CONTRACT,
          status: "recorded",
          operation: "consent",
          consent: true,
          aggregate
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWorkBoardMonitoringState()).resolves.toMatchObject({
      status: "ready",
      consent: false
    });
    await expect(
      submitWorkBoardMonitoringMutation({
        operation: "consent",
        consent: true,
        explicitUserAction: true
      })
    ).resolves.toMatchObject({ status: "recorded", operation: "consent" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({
        operation: "consent",
        consent: true,
        explicitUserAction: true
      })
    });
  });
});
