import { describe, expect, it } from "vitest";

import {
  WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES,
  WORK_BOARD_MONITORING_RECEIPT_TTL_MS,
  createWorkBoardMonitoringReceipt,
  verifyWorkBoardMonitoringReceipt,
  workBoardMonitoringAuthKeyId
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  MONITORING_SECRET,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

describe("Work Board monitoring receipt", () => {
  it("seals a strict redacted receipt with bounded capture-local handles", () => {
    const created = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    });
    expect(created).not.toBeNull();
    expect(Buffer.byteLength(created!.headerValue, "ascii")).toBeLessThanOrEqual(
      WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES
    );
    expect(created!.payload.authKeyId).toBe(
      workBoardMonitoringAuthKeyId(MONITORING_SECRET)
    );
    expect(created!.payload.items.map((item) => item.ordinal)).toEqual([
      0, 1, 2
    ]);
    expect(created!.payload.items[0]?.expiresAt).toBeNull();
    expect(created!.payload.expiresAt).toBe(
      new Date(
        MONITORING_NOW.getTime() + WORK_BOARD_MONITORING_RECEIPT_TTL_MS
      ).toISOString()
    );
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: created!.headerValue,
        installationSecret: MONITORING_SECRET,
        now: new Date("2026-08-13T09:05:59.999Z")
      })
    ).toEqual(created!.payload);

    const decoded = JSON.stringify(created!.payload);
    for (const forbidden of [
      "현재 확인할 Attention",
      "QA 진행 상태 확인하기",
      `item_ref_${"a".repeat(32)}`,
      `context_ref_${"b".repeat(32)}`,
      "candidate_",
      "continuation_run_",
      "/Users/private",
      "https://private.example",
      MONITORING_SECRET
    ]) {
      expect(decoded).not.toContain(forbidden);
    }
  });

  it("rejects tamper, key rotation, future issuance and the exact TTL boundary", () => {
    const created = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    const tampered = `${created.headerValue.slice(0, -1)}${
      created.headerValue.endsWith("A") ? "B" : "A"
    }`;
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: tampered,
        installationSecret: MONITORING_SECRET,
        now: MONITORING_NOW
      })
    ).toBeNull();
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: created.headerValue,
        installationSecret: "f".repeat(64),
        now: MONITORING_NOW
      })
    ).toBeNull();
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: created.headerValue,
        installationSecret: MONITORING_SECRET,
        now: new Date("2026-08-13T09:00:59.999Z")
      })
    ).toBeNull();
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: created.headerValue,
        installationSecret: MONITORING_SECRET,
        now: new Date(created.payload.expiresAt)
      })
    ).toBeNull();
  });

  it("uses the earlier continuation visibility expiry and omits stale receipts", () => {
    const authority = monitoringAuthority();
    if (authority.response.base.status !== "ready") throw new Error("fixture");
    authority.response.base.board.alternatives[0]!.item.expiresAt =
      "2026-08-13T09:02:00.000Z";
    authority.response.base.board.alternatives[1]!.item.expiresAt =
      "2026-08-13T09:03:00.000Z";
    expect(
      createWorkBoardMonitoringReceipt({
        authority,
        issuedAt: MONITORING_NOW
      })?.payload.expiresAt
    ).toBe("2026-08-13T09:02:00.000Z");
    expect(
      createWorkBoardMonitoringReceipt({
        authority,
        issuedAt: new Date("2026-08-13T09:02:00.000Z")
      })
    ).toBeNull();
  });

  it("keeps a logical presentation stable across polling but changes it with visible semantics", () => {
    const first = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    const second = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: new Date(MONITORING_NOW.getTime() + 30_000)
    })!;
    expect(second.payload.captureId).not.toBe(first.payload.captureId);
    expect(
      second.payload.items.map((item) => item.presentationTargetHmac)
    ).toEqual(
      first.payload.items.map((item) => item.presentationTargetHmac)
    );
    expect(
      second.payload.items.map((item) => item.ordinalHandleHmac)
    ).not.toEqual(
      first.payload.items.map((item) => item.ordinalHandleHmac)
    );

    const changedAuthority = monitoringAuthority();
    if (changedAuthority.response.semanticPresentation === null) {
      throw new Error("fixture");
    }
    changedAuthority.response.semanticPresentation.overlays[0]!.displayTitle =
      "다른 안전한 표시 제목";
    const changed = createWorkBoardMonitoringReceipt({
      authority: changedAuthority,
      issuedAt: MONITORING_NOW
    })!;
    expect(changed.payload.items[1]!.copyDigestHmac).not.toBe(
      first.payload.items[1]!.copyDigestHmac
    );
    expect(changed.payload.items[1]!.presentationTargetHmac).not.toBe(
      first.payload.items[1]!.presentationTargetHmac
    );
  });
});
