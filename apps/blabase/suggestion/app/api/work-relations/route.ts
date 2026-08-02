import { NextResponse } from "next/server";

import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import { readCurrentWorkEvidence } from "../../../src/workEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "작업 연결 근거는 로컬 Work Cockpit에서 확인해주세요."
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }

  try {
    const projection = await readCurrentWorkEvidence();

    return noStoreJson({
      status: "ready",
      ...projection.workRelations,
      artifacts: projection.artifacts,
      claims: projection.claims
    });
  } catch {
    return errorResponse(
      "WORK_RELATIONS_READ_FAILED",
      "작업 연결 근거를 확인하지 못했습니다.",
      500
    );
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number
) {
  return noStoreJson(
    {
      status: "error",
      code,
      message
    },
    status
  );
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
