import { NextResponse } from "next/server";

import { hasSafeReadOrigin, isLocalAttentionRequest } from "../../../src/attention/access";
import { evaluateLiveWorkSuggestionBoard } from "../../../src/suggestionBoard/liveShadow";
import {
  workBoardApiResponseSchema,
  type WorkBoardApiResponse
} from "../../../src/suggestionBoard/monitoringSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return json(
      {
        status: "unavailable",
        code: "WORK_BOARD_LOCAL_ONLY",
        message:
          "Work Board preview는 로컬 개발 환경에서만 확인할 수 있습니다."
      },
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return json(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }
  if (process.env.BLABASE_WORK_BOARD_SHADOW_READ_ENABLED !== "true") {
    return json(
      {
        status: "unavailable",
        code: "WORK_BOARD_SHADOW_DISABLED",
        message: "Work Board shadow preview가 비활성화되어 있습니다."
      },
      404
    );
  }
  try {
    const response = workBoardApiResponseSchema.parse(
      await evaluateLiveWorkSuggestionBoard()
    );
    return json(response);
  } catch {
    return json(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board preview를 만들지 못했습니다."
      },
      500
    );
  }
}

function json(body: WorkBoardApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}
