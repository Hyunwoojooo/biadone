import { NextResponse } from "next/server";

import { hasValidBasicAuthorization } from "../../../src/accessControl";
import {
  hasSafeReadOrigin,
  isLocalAttentionRequest
} from "../../../src/attention/access";
import { isPreserveCaptureError } from "../../../src/attention/preserveCapture";
import {
  CONTINUATION_READ_API_CONTRACT,
  continuationReadApiResponseSchema,
  continuationReadDecisionSchema,
  continuationReadErrorSchema,
  type ContinuationReadApiResponse,
  type ContinuationReadError
} from "../../../src/continuation/readApi";
import { evaluateLiveContinuationRead } from "../../../src/suggestionBoard/liveShadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return errorJson(
      "CONTINUATION_READ_LOCAL_ONLY",
      "Continuation 조회는 로컬 개발 환경에서만 사용할 수 있습니다.",
      404
    );
  }
  if (!hasSafeReadOrigin(request)) {
    return errorJson(
      "CONTINUATION_READ_INVALID_ORIGIN",
      "허용되지 않은 출처의 요청입니다.",
      403
    );
  }
  if (process.env.BLABASE_CONTINUATION_READ_ENABLED !== "true") {
    return errorJson(
      "CONTINUATION_READ_DISABLED",
      "Continuation 조회가 비활성화되어 있습니다.",
      404
    );
  }
  const password = process.env.SUGGESTION_ACCESS_PASSWORD;
  if (!password) {
    return errorJson(
      "CONTINUATION_READ_AUTH_UNAVAILABLE",
      "Continuation 조회 인증을 사용할 수 없습니다.",
      503
    );
  }
  if (
    !hasValidBasicAuthorization(
      request.headers.get("authorization"),
      password
    )
  ) {
    return errorJson(
      "CONTINUATION_READ_UNAUTHORIZED",
      "Continuation 조회 인증이 필요합니다.",
      401,
      { "WWW-Authenticate": 'Basic realm="blabase suggestion"' }
    );
  }

  try {
    const response = continuationReadDecisionSchema.parse(
      await evaluateLiveContinuationRead()
    );
    return json(response);
  } catch (error) {
    return errorJson(
      "CONTINUATION_READ_FAILED",
      "Continuation 조회를 만들지 못했습니다.",
      isPreserveCaptureError(error) ? 503 : 500
    );
  }
}

function errorJson(
  code: ContinuationReadError["code"],
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {}
) {
  return json(
    continuationReadErrorSchema.parse({
      contract: CONTINUATION_READ_API_CONTRACT,
      status: "error",
      code,
      message
    }),
    status,
    extraHeaders
  );
}

function json(
  body: ContinuationReadApiResponse,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(
    continuationReadApiResponseSchema.parse(body),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        ...extraHeaders
      }
    }
  );
}
