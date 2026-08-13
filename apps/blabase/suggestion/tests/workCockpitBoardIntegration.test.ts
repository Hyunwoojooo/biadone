import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createMonotonicRequestGate,
  displayBoardStateFromResult,
  loadWorkCockpitRequest
} from "../app/WorkCockpit";
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
  });

  it("reports Board failure before a slower Attention request completes", async () => {
    let finishAttention!: (value: AttentionApiResponse) => void;
    const attention = new Promise<AttentionApiResponse>((resolve) => {
      finishAttention = resolve;
    });
    const boardStates: Array<{ response: unknown; error: string | null }> = [];
    const request = loadWorkCockpitRequest({
      refreshSources: false,
      loadAttention: vi.fn(() => attention),
      loadWorkBoard: vi.fn().mockRejectedValue(new Error("auth detail")),
      onBoardSettled: (result) => {
        boardStates.push(displayBoardStateFromResult(result));
      }
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(boardStates).toEqual([
      { response: null, error: "작업 제안을 불러오지 못했습니다." }
    ]);
    finishAttention({
      status: "error",
      code: "TEST",
      message: "test"
    });
    await request;
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

  it("keeps initial Board and Attention reads independent without merging feeds", async () => {
    const attention = vi.fn(async () => ({ status: "error" }) as never);
    const board = vi.fn(async () => ({ contract: "board" }) as never);
    const result = await loadWorkCockpitRequest({
      refreshSources: false,
      loadAttention: attention,
      loadWorkBoard: board
    });

    expect(result.attention.status).toBe("fulfilled");
    expect(result.board.status).toBe("fulfilled");
    expect(attention).toHaveBeenCalledOnce();
    expect(board).toHaveBeenCalledOnce();
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
    expect(panelSource).not.toMatch(
      /window\.location|document\.activeElement/u
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
