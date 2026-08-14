import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkBoardMonitoringReceipt,
  deriveWorkBoardMonitoringQuality,
  readWorkBoardMonitoringStore,
  recordWorkBoardMonitoringMutation,
  replayWorkBoardMonitoringStore
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  MONITORING_SECRET,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Work Board monitoring quality and replay", () => {
  it("uses null for zero denominators and never promotes monitoring data", () => {
    expect(
      deriveWorkBoardMonitoringQuality({
        events: [],
        asOf: MONITORING_NOW.toISOString()
      })
    ).toMatchObject({
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
    });
  });

  it("derives deterministic lane strata and detects replay mismatch", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "work-board-quality-"));
    roots.push(cwd);
    const receipt = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    for (const mutation of [
      {
        operation: "consent" as const,
        consent: true,
        explicitUserAction: true as const
      },
      {
        operation: "render_confirmed" as const,
        receipt: receipt.headerValue
      },
      {
        operation: "feedback" as const,
        receipt: receipt.headerValue,
        ordinal: 1,
        feedback: "useful" as const,
        explicitUserAction: true as const
      },
      {
        operation: "feedback" as const,
        receipt: receipt.headerValue,
        ordinal: 2,
        feedback: "not_useful" as const,
        reason: "not_now" as const,
        explicitUserAction: true as const
      }
    ]) {
      await recordWorkBoardMonitoringMutation({
        cwd,
        installationSecret: MONITORING_SECRET,
        mutation,
        clock: () => new Date(MONITORING_NOW)
      });
    }
    const read = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: MONITORING_SECRET
    });
    expect(read.status).toBe("available");
    if (read.status !== "available") return;

    const replay = replayWorkBoardMonitoringStore(read.value);
    expect(replay).toMatchObject({
      status: "matched",
      aggregate: {
        eligibleDistinct: 2,
        ratedDistinct: 2,
        usefulDistinct: 1,
        coverage: { numerator: 2, denominator: 2, value: 1 },
        usefulShare: { numerator: 1, denominator: 2, value: 0.5 }
      }
    });
    expect(
      replay.aggregate.strata.map((stratum) => ({
        lane: stratum.lane,
        position: stratum.position,
        eligible: stratum.eligibleDistinct,
        rated: stratum.ratedDistinct
      }))
    ).toEqual([
      {
        lane: "continuation",
        position: "alternative_1",
        eligible: 1,
        rated: 1
      },
      {
        lane: "setup",
        position: "alternative_2",
        eligible: 1,
        rated: 1
      }
    ]);

    const mismatched = structuredClone(read.value);
    mismatched.aggregateSha256 = "0".repeat(64);
    expect(replayWorkBoardMonitoringStore(mismatched)).toMatchObject({
      status: "mismatch",
      mismatchCodes: ["AGGREGATE_SHA_MISMATCH"]
    });
  });
});
