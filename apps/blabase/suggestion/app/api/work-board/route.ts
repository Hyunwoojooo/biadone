import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../src/accessControl";
import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import { isPreserveCaptureError } from "../../../src/attention/preserveCapture";
import {
  createSemanticContinuationWorkBoardResponse,
  semanticContinuationWorkBoardResponseSchema,
  type SemanticContinuationWorkBoardResponse
} from "../../../src/semanticContinuation";
import {
  evaluateLiveSemanticWorkSuggestionBoard,
  evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority
} from "../../../src/suggestionBoard/liveShadow";
import {
  createWorkBoardMonitoringReceipt,
  WORK_BOARD_MONITORING_RECEIPT_HEADER
} from "../../../src/suggestionBoard/monitoring";
import type { WorkBoardApiResponse } from "../../../src/suggestionBoard/monitoringSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return baseJson(
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
    return baseJson(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }
  if (process.env.BLABASE_WORK_BOARD_SHADOW_READ_ENABLED !== "true") {
    return baseJson(
      {
        status: "unavailable",
        code: "WORK_BOARD_SHADOW_DISABLED",
        message: "Work Board shadow preview가 비활성화되어 있습니다."
      },
      404
    );
  }
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;
  if (!password) {
    return baseJson(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board 인증을 사용할 수 없습니다."
      },
      503
    );
  }
  if (
    !hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return baseJson(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board 인증이 필요합니다."
      },
      401,
      { "WWW-Authenticate": 'Basic realm="blabase suggestion"' }
    );
  }
  try {
    if (process.env.BLABASE_WORK_BOARD_MONITORING_ENABLED === "true") {
      const evaluated =
        await evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority();
      const response = semanticContinuationWorkBoardResponseSchema.parse(
        evaluated.response
      );
      const receipt = (() => {
        try {
          return evaluated.monitoringAuthority === null
            ? null
            : createWorkBoardMonitoringReceipt({
                authority: evaluated.monitoringAuthority
              });
        } catch {
          return null;
        }
      })();
      return json(
        response,
        200,
        receipt === null
          ? {}
          : {
              [WORK_BOARD_MONITORING_RECEIPT_HEADER]:
                receipt.headerValue
            }
      );
    }
    const response = semanticContinuationWorkBoardResponseSchema.parse(
      await evaluateLiveSemanticWorkSuggestionBoard()
    );
    return json(response);
  } catch (error) {
    return baseJson(
      {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board preview를 만들지 못했습니다."
      },
      isPreserveCaptureError(error) ? 503 : 500
    );
  }
}

function baseJson(
  base: WorkBoardApiResponse,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return json(
    createSemanticContinuationWorkBoardResponse(base, null),
    status,
    extraHeaders
  );
}

function json(
  body: SemanticContinuationWorkBoardResponse,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders
    }
  });
}
