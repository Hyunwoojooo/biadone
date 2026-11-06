import { describe, expect, it } from "vitest";

import {
  WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES,
  createWorkBoardMonitoringReceipt,
  workBoardMonitoringMutationInputSchema,
  workBoardMonitoringReceiptPayloadSchema
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

describe("Work Board monitoring contracts", () => {
  it("accepts only strict redacted receipt fields", () => {
    const payload = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!.payload;
    expect(workBoardMonitoringReceiptPayloadSchema.parse(payload)).toEqual(
      payload
    );

    for (const mutation of [
      { ...payload, title: "private title" },
      {
        ...payload,
        items: [
          { ...payload.items[0], itemRef: `item_ref_${"a".repeat(32)}` },
          ...payload.items.slice(1)
        ]
      },
      { ...payload, surface: "launcher" },
      { ...payload, expiresAt: payload.issuedAt }
    ]) {
      expect(
        workBoardMonitoringReceiptPayloadSchema.safeParse(mutation).success
      ).toBe(false);
    }
  });

  it("requires explicit feedback/reset/purge and an allowlisted reason", () => {
    expect(
      workBoardMonitoringMutationInputSchema.safeParse({
        operation: "feedback",
        receipt: "receipt",
        ordinal: 1,
        feedback: "useful",
        reason: "private_reason",
        explicitUserAction: true
      }).success
    ).toBe(false);
    expect(
      workBoardMonitoringMutationInputSchema.safeParse({
        operation: "reset",
        receipt: "receipt",
        ordinal: 1,
        explicitUserAction: false
      }).success
    ).toBe(false);
    expect(
      workBoardMonitoringMutationInputSchema.safeParse({
        operation: "purge",
        explicitUserAction: true,
        path: "/private"
      }).success
    ).toBe(false);
  });

  it("keeps the browser/header boundary deliberately bounded", () => {
    const receipt = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    expect(new TextEncoder().encode(receipt.headerValue).byteLength).toBeLessThan(
      WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES
    );
  });
});
