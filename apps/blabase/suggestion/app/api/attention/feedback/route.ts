import { NextResponse } from "next/server";

import {
  hasSameAttentionOrigin,
  isLocalAttentionRequest
} from "../../../../src/attention/access";
import {
  AttentionMonitorStoreError,
  recordAttentionFeedback
} from "../../../../src/attention/localMonitorStore";
import { attentionFeedbackRequestSchema } from "../../../../src/attention/monitoringSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalAttentionRequest(request)) {
    return noStoreJson(
      {
        status: "error",
        code: "LOCAL_ONLY",
        message: "피드백 기록은 로컬 Work Cockpit에서만 사용할 수 있습니다."
      },
      404
    );
  }
  if (!hasSameAttentionOrigin(request)) {
    return noStoreJson(
      {
        status: "error",
        code: "INVALID_ORIGIN",
        message: "허용되지 않은 출처의 요청입니다."
      },
      403
    );
  }

  const input = await parseRequest(request);
  if (!input) {
    return noStoreJson(
      {
        status: "error",
        code: "INVALID_FEEDBACK",
        message: "피드백 형식을 확인해주세요."
      },
      400
    );
  }
  try {
    const feedback = await recordAttentionFeedback(input);
    return noStoreJson({ status: "recorded", feedback });
  } catch (error) {
    if (
      error instanceof AttentionMonitorStoreError &&
      error.code === "RUN_NOT_FOUND"
    ) {
      return noStoreJson(
        {
          status: "error",
          code: "RUN_NOT_FOUND",
          message: "평가할 Attention 실행 기록을 찾지 못했습니다."
        },
        404
      );
    }
    return noStoreJson(
      {
        status: "error",
        code: "FEEDBACK_WRITE_FAILED",
        message: "피드백을 기록하지 못했습니다."
      },
      500
    );
  }
}

async function parseRequest(request: Request) {
  try {
    const parsed = attentionFeedbackRequestSchema.safeParse(
      await request.json()
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
