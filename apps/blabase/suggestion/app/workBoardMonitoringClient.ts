"use client";

import type { SemanticContinuationWorkBoardResponse } from "../src/semanticContinuation/contracts";
import {
  workBoardMonitoringMutationResponseSchema,
  workBoardMonitoringReceiptPayloadSchema,
  workBoardMonitoringStateResponseSchema,
  type WorkBoardMonitoringMutationInput,
  type WorkBoardMonitoringReceiptPayload,
  type WorkBoardMonitoringStateResponse
} from "../src/suggestionBoard/monitoring/contracts";
import {
  WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES,
  WORK_BOARD_MONITORING_RECEIPT_HEADER
} from "../src/suggestionBoard/monitoring/versions";
import { parseDisplayOnlyWorkBoard } from "./attentionClient";

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/iu;
const RECEIPT_PATTERN = /^wbm1\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{43}$/u;

export class WorkBoardMonitoringRequestError extends Error {
  constructor() {
    super("WORK_BOARD_MONITORING_UNAVAILABLE");
    this.name = "WorkBoardMonitoringRequestError";
  }
}

export type BrowserWorkBoardMonitoringReceipt = {
  receipt: string;
  payload: WorkBoardMonitoringReceiptPayload;
};

export type WorkBoardDisplayLoad = {
  response: SemanticContinuationWorkBoardResponse;
  monitoringReceipt: BrowserWorkBoardMonitoringReceipt | null;
};

export async function fetchDisplayOnlyWorkBoardWithMonitoring(): Promise<WorkBoardDisplayLoad> {
  const response = await boundedFetch("/api/work-board", {
    cache: "no-store"
  });
  if (!response.ok || !isJson(response)) {
    throw new WorkBoardMonitoringRequestError();
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new WorkBoardMonitoringRequestError();
  }
  const board = parseDisplayOnlyWorkBoard(raw);
  if (board === null) throw new WorkBoardMonitoringRequestError();
  const receipt = parseBrowserMonitoringReceipt(
    response.headers.get(WORK_BOARD_MONITORING_RECEIPT_HEADER),
    board,
    new Date()
  );
  return { response: board, monitoringReceipt: receipt };
}

export async function fetchWorkBoardMonitoringState(): Promise<WorkBoardMonitoringStateResponse> {
  const response = await boundedFetch("/api/work-board/monitoring", {
    cache: "no-store"
  });
  if (!response.ok || !isJson(response)) {
    throw new WorkBoardMonitoringRequestError();
  }
  try {
    return workBoardMonitoringStateResponseSchema.parse(
      await response.json()
    );
  } catch {
    throw new WorkBoardMonitoringRequestError();
  }
}

export async function submitWorkBoardMonitoringMutation(
  input: WorkBoardMonitoringMutationInput
) {
  const body = JSON.stringify(input);
  const response = await boundedFetch("/api/work-board/monitoring", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body
  });
  if (!response.ok || !isJson(response)) {
    throw new WorkBoardMonitoringRequestError();
  }
  try {
    return workBoardMonitoringMutationResponseSchema.parse(
      await response.json()
    );
  } catch {
    throw new WorkBoardMonitoringRequestError();
  }
}

export function parseBrowserMonitoringReceipt(
  receipt: string | null,
  response: SemanticContinuationWorkBoardResponse,
  now: Date
): BrowserWorkBoardMonitoringReceipt | null {
  try {
    if (
      receipt === null ||
      new TextEncoder().encode(receipt).byteLength >
        WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES
    ) {
      return null;
    }
    const match = RECEIPT_PATTERN.exec(receipt);
    if (match === null) return null;
    const payload = workBoardMonitoringReceiptPayloadSchema.parse(
      JSON.parse(decodeBase64Url(match[1]!))
    );
    if (
      response.base.status !== "ready" ||
      payload.generatedAt !== response.base.board.generatedAt ||
      payload.mode !== response.base.mode ||
      payload.fallbackReasonCode !== response.base.reasonCode ||
      payload.continuationStatus !==
        response.base.board.continuationStatus ||
      now.getTime() < Date.parse(payload.issuedAt) ||
      now.getTime() >= Date.parse(payload.expiresAt)
    ) {
      return null;
    }
    const items = [
      ...(response.base.board.primary === null
        ? []
        : [response.base.board.primary]),
      ...response.base.board.alternatives
    ];
    if (
      items.length !== payload.items.length ||
      items.some((entry, ordinal) => {
        const item = payload.items[ordinal];
        return (
          item === undefined ||
          item.ordinal !== ordinal ||
          item.lane !== entry.lane ||
          item.kind !== entry.item.kind ||
          item.evidenceBand !== entry.item.evidenceBand ||
          JSON.stringify(item.caveatCodes) !==
            JSON.stringify(entry.item.caveatCodes) ||
          item.expiresAt !==
            (entry.lane === "attention" ? null : entry.item.expiresAt)
        );
      })
    ) {
      return null;
    }
    return { receipt, payload };
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value.replace(/-/gu, "+").replace(/_/gu, "/")}${padding}`;
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isJson(response: Response): boolean {
  return JSON_CONTENT_TYPE.test(
    response.headers.get("content-type") ?? ""
  );
}

async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new WorkBoardMonitoringRequestError();
  }
}
