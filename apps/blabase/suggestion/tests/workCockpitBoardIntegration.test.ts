import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createMonotonicRequestGate,
  displayBoardStateFromResult,
  loadWorkCockpitRequest,
  monitoringReceiptFromResult
} from "../app/WorkCockpit";
import type { WorkBoardDisplayLoad } from "../app/workBoardMonitoringClient";
import type { AttentionApiResponse } from "../src/attention/monitoringSchema";

describe("WorkCockpit canonical Work Board integration", () => {
  it("prevents an older request from overwriting a newer response", () => {
    const gate = createMonotonicRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    const applied: string[] = [];

    if (gate.isCurrent(second)) applied.push("newer");
    if (gate.isCurrent(first)) applied.push("older");

    expect(applied).toEqual(["newer"]);
  });

  it("uses the same monotonic rule for overlapping monitoring-state reads", async () => {
    const gate = createMonotonicRequestGate();
    const applied: string[] = [];
    let finishOld!: () => void;
    const old = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const oldSequence = gate.begin();
    const oldApply = old.then(() => {
      if (gate.isCurrent(oldSequence)) applied.push("stale-consent");
    });
    const currentSequence = gate.begin();
    if (gate.isCurrent(currentSequence)) applied.push("purged");
    finishOld();
    await oldApply;

    expect(applied).toEqual(["purged"]);
  });

  it("clears the previous Board and overlay on the current request failure", () => {
    const state = displayBoardStateFromResult({
      status: "rejected",
      reason: new Error("private network detail")
    });
    expect(state).toEqual({
      response: null,
      error: "작업 제안을 불러오지 못했습니다."
    });
    expect(JSON.stringify(state)).not.toContain("private network detail");
    expect(monitoringReceiptFromResult({
      status: "rejected",
      reason: new Error("private receipt")
    })).toBeNull();
  });

  it("publishes a receipt only from the current fulfilled Board generation", () => {
    const gate = createMonotonicRequestGate();
    const older = gate.begin();
    const current = gate.begin();
    const receipt = {
      receipt: "wbm1.payload.signature",
      payload: { captureId: `work_board_capture_${"a".repeat(32)}` }
    } as WorkBoardDisplayLoad["monitoringReceipt"];
    const fulfilled = {
      status: "fulfilled" as const,
      value: {
        response: {} as WorkBoardDisplayLoad["response"],
        monitoringReceipt: receipt
      }
    };

    expect(gate.isCurrent(older)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
    expect(monitoringReceiptFromResult(fulfilled)).toBe(receipt);
  });

  it("waits for Attention to release its authority lease before loading Board", async () => {
    let finishAttention!: (value: AttentionApiResponse) => void;
    const attention = new Promise<AttentionApiResponse>((resolve) => {
      finishAttention = resolve;
    });
    const loadWorkBoard = vi
      .fn()
      .mockRejectedValue(new Error("auth detail"));
    const boardStates: Array<{ response: unknown; error: string | null }> = [];
    const request = loadWorkCockpitRequest({
      refreshSources: false,
      loadAttention: vi.fn(() => attention),
      loadWorkBoard,
      onBoardSettled: (result) => {
        boardStates.push(displayBoardStateFromResult(result));
      }
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(loadWorkBoard).not.toHaveBeenCalled();
    expect(boardStates).toEqual([]);
    finishAttention({
      status: "error",
      code: "TEST",
      message: "test"
    });
    await request;
    expect(loadWorkBoard).toHaveBeenCalledOnce();
    expect(boardStates).toEqual([
      { response: null, error: "작업 제안을 불러오지 못했습니다." }
    ]);
  });

  it("fetches Work Board once and waits for a manual source refresh evaluation", async () => {
    const events: string[] = [];
    const attention = vi.fn(async (refreshSources = false) => {
      events.push(`attention:${refreshSources}:start`);
      await Promise.resolve();
      events.push(`attention:${refreshSources}:end`);
      return { status: "error", code: "TEST", message: "test" } as never;
    });
    const board = vi.fn(async () => {
      events.push("board");
      return {} as never;
    });

    await loadWorkCockpitRequest({
      refreshSources: true,
      loadAttention: attention,
      loadWorkBoard: board
    });

    expect(attention).toHaveBeenCalledOnce();
    expect(board).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "attention:true:start",
      "attention:true:end",
      "board"
    ]);
  });

  it("sequences initial reads without merging their independent results", async () => {
    const events: string[] = [];
    const attention = vi.fn(async () => {
      events.push("attention:start");
      await Promise.resolve();
      events.push("attention:end");
      return { status: "error" } as never;
    });
    const board = vi.fn(async () => {
      events.push("board");
      return { contract: "board" } as never;
    });
    const result = await loadWorkCockpitRequest({
      refreshSources: false,
      loadAttention: attention,
      loadWorkBoard: board
    });

    expect(result.attention.status).toBe("fulfilled");
    expect(result.board.status).toBe("fulfilled");
    expect(attention).toHaveBeenCalledOnce();
    expect(board).toHaveBeenCalledOnce();
    expect(events).toEqual(["attention:start", "attention:end", "board"]);
  });

  it("contains no focus or scroll mutation in the canonical panel", async () => {
    const panelSource = await readFile(
      join(process.cwd(), "app", "WorkSuggestionBoardPanel.tsx"),
      "utf8"
    );
    const cockpitSource = await readFile(
      join(process.cwd(), "app", "WorkCockpit.tsx"),
      "utf8"
    );
    expect(panelSource).not.toMatch(/\.focus\s*\(|scrollIntoView|autoFocus/u);
    expect(panelSource).not.toMatch(/document\.activeElement/u);
    expect(panelSource.match(/window\.location\.assign\(path\)/gu)).toHaveLength(
      1
    );
    expect(cockpitSource).not.toMatch(/\.focus\s*\(|scrollIntoView|autoFocus/u);
    expect(`${panelSource}\n${cockpitSource}`).not.toContain(
      "/api/continuation"
    );
    expect(cockpitSource).toContain("기존 Active Attention 판정");
    expect(cockpitSource.indexOf("<WorkSuggestionBoardPanel")).toBeLessThan(
      cockpitSource.indexOf("<CurrentFocusCard payload")
    );
  });
});
