import { NextResponse } from "next/server";

import {
  ATTENTION_LOCAL_URL,
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import { readAttentionHistory } from "../../../../src/attention/localMonitorStore";
import type { AttentionHistoryResponse } from "../../../../src/attention/monitoringSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: `Attention Lab은 ${ATTENTION_LOCAL_URL}에서 확인해주세요.`,
        localUrl: ATTENTION_LOCAL_URL
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return noStoreJson(
      {
        status: "error",
        code: "INVALID_ORIGIN",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }
  try {
    return noStoreJson(await readAttentionHistory());
  } catch {
    return noStoreJson(
      {
        status: "error",
        code: "ATTENTION_HISTORY_READ_FAILED",
        message: "최근 Attention 실행 기록을 읽지 못했습니다."
      },
      500
    );
  }
}

function noStoreJson(body: AttentionHistoryResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
