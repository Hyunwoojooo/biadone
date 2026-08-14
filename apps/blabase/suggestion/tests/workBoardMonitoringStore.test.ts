import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WORK_BOARD_MONITORING_EVENT_RESERVE,
  WORK_BOARD_MONITORING_MAX_EVENTS,
  createWorkBoardMonitoringReceipt,
  readWorkBoardMonitoringState,
  readWorkBoardMonitoringStore,
  recordWorkBoardMonitoringMutation,
  replayWorkBoardMonitoringStore,
  workBoardMonitoringEventCapacity,
  workBoardMonitoringLocalDirectory
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  MONITORING_SECRET,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

const roots: string[] = [];
const POLL_NOW = new Date(MONITORING_NOW.getTime() + 30_000);

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Work Board monitoring store", () => {
  it("returns an empty pure state without creating local storage", async () => {
    const cwd = await temporaryRoot();
    const state = await readWorkBoardMonitoringState({
      cwd,
      installationSecret: MONITORING_SECRET,
      now: MONITORING_NOW
    });
    expect(state).toMatchObject({
      status: "ready",
      consent: false,
      aggregate: {
        eligibleDistinct: 0,
        ratedDistinct: 0,
        coverage: { denominator: 0, value: null }
      },
      history: []
    });
    expect(await stat(join(cwd, ".local")).catch(() => null)).toBeNull();
  });

  it("requires consent and render acknowledgement, then supports idempotent correction/reset", async () => {
    const cwd = await temporaryRoot();
    const receipt = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    await expect(
      mutate(cwd, { operation: "render_confirmed", receipt: receipt.headerValue })
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await mutate(cwd, {
      operation: "consent",
      consent: true,
      explicitUserAction: true
    });
    await mutate(cwd, {
      operation: "render_confirmed",
      receipt: receipt.headerValue
    });
    await Promise.all([
      mutate(cwd, {
        operation: "render_confirmed",
        receipt: receipt.headerValue
      }),
      mutate(cwd, {
        operation: "render_confirmed",
        receipt: receipt.headerValue
      })
    ]);
    const polledReceipt = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: POLL_NOW
    })!;
    await mutate(
      cwd,
      {
        operation: "render_confirmed",
        receipt: polledReceipt.headerValue
      },
      POLL_NOW
    );
    await expect(
      mutate(cwd, {
        operation: "feedback",
        receipt: polledReceipt.headerValue,
        ordinal: 0,
        feedback: "useful",
        explicitUserAction: true
      }, POLL_NOW)
    ).rejects.toMatchObject({ code: "RECEIPT_NOT_CURRENT" });
    await mutate(cwd, {
      operation: "feedback",
      receipt: polledReceipt.headerValue,
      ordinal: 1,
      feedback: "useful",
      explicitUserAction: true
    }, POLL_NOW);
    await mutate(cwd, {
      operation: "feedback",
      receipt: polledReceipt.headerValue,
      ordinal: 1,
      feedback: "useful",
      explicitUserAction: true
    }, POLL_NOW);
    let state = await readWorkBoardMonitoringState({
      cwd,
      installationSecret: MONITORING_SECRET,
      now: POLL_NOW
    });
    expect(state.aggregate).toMatchObject({
      eligibleDistinct: 2,
      ratedDistinct: 1,
      usefulDistinct: 1,
      coverage: { numerator: 1, denominator: 2, value: 0.5 },
      usefulShare: { numerator: 1, denominator: 1, value: 1 },
      appliedToRanking: false,
      goldEligible: false,
      releaseGateEligible: false
    });
    expect(state.aggregate.eventCount).toBe(3);
    await mutate(cwd, {
      operation: "feedback",
      receipt: polledReceipt.headerValue,
      ordinal: 1,
      feedback: "not_useful",
      reason: "wrong_context",
      explicitUserAction: true
    }, POLL_NOW);
    await mutate(cwd, {
      operation: "reset",
      receipt: polledReceipt.headerValue,
      ordinal: 1,
      explicitUserAction: true
    }, POLL_NOW);
    state = await readWorkBoardMonitoringState({
      cwd,
      installationSecret: MONITORING_SECRET,
      now: POLL_NOW
    });
    expect(state.aggregate.ratedDistinct).toBe(0);
    expect(JSON.stringify(state.history)).not.toContain("item_ref_");
  });

  it("persists only private HMAC metadata, verifies replay and rejects tamper/wrong key", async () => {
    const cwd = await temporaryRoot();
    const receipt = createWorkBoardMonitoringReceipt({
      authority: monitoringAuthority(),
      issuedAt: MONITORING_NOW
    })!;
    await mutate(cwd, {
      operation: "consent",
      consent: true,
      explicitUserAction: true
    });
    await mutate(cwd, {
      operation: "render_confirmed",
      receipt: receipt.headerValue
    });
    const directory = workBoardMonitoringLocalDirectory(
      cwd,
      MONITORING_SECRET
    );
    expect((await stat(join(cwd, ".local"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "events.json"))).mode & 0o777).toBe(0o600);
    const text = await readFile(join(directory, "events.json"), "utf8");
    for (const forbidden of [
      receipt.headerValue,
      "현재 확인할 Attention",
      "QA 진행 상태 확인하기",
      "item_ref_",
      "context_ref_",
      MONITORING_SECRET
    ]) {
      expect(text).not.toContain(forbidden);
    }
    const read = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: MONITORING_SECRET
    });
    expect(read.status).toBe("available");
    if (read.status !== "available") throw new Error("fixture");
    expect(replayWorkBoardMonitoringStore(read.value).status).toBe("matched");
    expect(
      await readWorkBoardMonitoringStore({
        cwd,
        installationSecret: "f".repeat(64)
      })
    ).toEqual({ status: "missing" });
    const parsed = JSON.parse(text) as { events: Array<{ eventHmac: string }> };
    parsed.events[0]!.eventHmac = "0".repeat(64);
    await writeFile(join(directory, "events.json"), JSON.stringify(parsed), {
      mode: 0o600
    });
    expect(
      await readWorkBoardMonitoringStore({
        cwd,
        installationSecret: MONITORING_SECRET
      })
    ).toEqual({ status: "invalid" });
  });

  it("lazily removes the expired prefix and purges all current-key data", async () => {
    const cwd = await temporaryRoot();
    await mutate(cwd, {
      operation: "consent",
      consent: true,
      explicitUserAction: true
    });
    const afterRetention = new Date("2026-09-13T09:01:00.001Z");
    await recordWorkBoardMonitoringMutation({
      cwd,
      installationSecret: MONITORING_SECRET,
      mutation: {
        operation: "consent",
        consent: true,
        explicitUserAction: true
      },
      clock: () => afterRetention
    });
    let read = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: MONITORING_SECRET
    });
    expect(read.status).toBe("available");
    if (read.status === "available") expect(read.value.events).toHaveLength(1);
    await recordWorkBoardMonitoringMutation({
      cwd,
      installationSecret: MONITORING_SECRET,
      mutation: { operation: "purge", explicitUserAction: true },
      clock: () => afterRetention
    });
    read = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: MONITORING_SECRET
    });
    expect(read).toEqual({ status: "missing" });
  });

  it("fails closed on an unsafe namespace symlink without touching its target", async () => {
    const cwd = await temporaryRoot();
    const outside = await temporaryRoot();
    const directory = workBoardMonitoringLocalDirectory(cwd, MONITORING_SECRET);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(cwd, ".local", "work-board-monitoring"), {
      recursive: true,
      mode: 0o700
    });
    await symlink(outside, directory);
    await expect(
      mutate(cwd, {
        operation: "consent",
        consent: true,
        explicitUserAction: true
      })
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });
    expect(await readFile(join(outside, "sentinel"), "utf8").catch(() => null)).toBeNull();
  });

  it("reserves capacity for feedback/reset and always leaves the final revoke slot", () => {
    expect(workBoardMonitoringEventCapacity("render_confirmed")).toBe(
      WORK_BOARD_MONITORING_MAX_EVENTS - WORK_BOARD_MONITORING_EVENT_RESERVE
    );
    expect(workBoardMonitoringEventCapacity("consent_granted")).toBe(
      WORK_BOARD_MONITORING_MAX_EVENTS - WORK_BOARD_MONITORING_EVENT_RESERVE
    );
    expect(workBoardMonitoringEventCapacity("feedback_recorded")).toBe(
      WORK_BOARD_MONITORING_MAX_EVENTS - 1
    );
    expect(workBoardMonitoringEventCapacity("feedback_reset")).toBe(
      WORK_BOARD_MONITORING_MAX_EVENTS - 1
    );
    expect(workBoardMonitoringEventCapacity("consent_revoked")).toBe(
      WORK_BOARD_MONITORING_MAX_EVENTS
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "work-board-monitoring-"));
  roots.push(root);
  return root;
}

function mutate(
  cwd: string,
  mutation: Parameters<typeof recordWorkBoardMonitoringMutation>[0]["mutation"],
  now = MONITORING_NOW
) {
  return recordWorkBoardMonitoringMutation({
    cwd,
    installationSecret: MONITORING_SECRET,
    mutation,
    clock: () => new Date(now.getTime())
  });
}
