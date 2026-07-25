import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { loadSharedLocalEnv } from "../../../src/localEnv";
import { normalizeSuggestionRequest } from "../../../src/requestSchema";
import { restoreConversations } from "../../../src/restoreConversations";
import {
  runSuggestionEngine,
  SuggestionEngineError
} from "../../../src/runSuggestionEngine";
import { suggestionRequestSchema } from "../../../src/schema";
import { SuggestionProviderError } from "../../../src/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    loadSharedLocalEnv();
    const body = await request.json();
    const parsed = suggestionRequestSchema.parse(body);
    const normalized = normalizeSuggestionRequest(parsed);
    const restored = await restoreConversations(normalized.shareUrls);

    if (restored.restored.length < 3) {
      return noStoreJson(
        {
          error: {
            code: "NOT_ENOUGH_RESTORED_CONVERSATIONS",
            message:
              "복원에 성공한 고유 대화가 3개 미만입니다. 다른 공유 URL을 추가해주세요."
          },
          sources: restored.sources
        },
        422
      );
    }

    const result = await runSuggestionEngine({
      restored: restored.restored,
      sources: restored.sources
    });
    return noStoreJson(result, 200);
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.code === "SUGGESTION_FAILED") {
      logUnexpectedError(error);
    }
    return noStoreJson(
      {
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details
        }
      },
      normalized.status
    );
  }
}

function logUnexpectedError(error: unknown) {
  if (error instanceof Error) {
    console.error("Unexpected suggestion route error", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    return;
  }
  console.error("Unexpected non-Error value in suggestion route");
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
  status: number;
  details?: Array<{ inputIndex: number; code: string }>;
} {
  if (error instanceof ZodError) {
    return {
      code: "INVALID_REQUEST",
      message:
        "ChatGPT 공유 URL 3~10개와 동일 사용자 확인이 필요합니다.",
      status: 400
    };
  }
  if (error instanceof SuggestionEngineError) {
    return {
      code: error.code,
      message: error.message,
      status:
        error.code === "NOT_ENOUGH_RESTORED_CONVERSATIONS" ? 422 : 502,
      details: error.diagnostics
    };
  }
  if (error instanceof SuggestionProviderError) {
    return {
      code: error.code,
      message: error.message,
      status: error.code === "PROVIDER_NOT_CONFIGURED" ? 503 : 502
    };
  }
  if (error instanceof SyntaxError) {
    return {
      code: "INVALID_JSON",
      message: "요청 내용을 읽지 못했습니다.",
      status: 400
    };
  }
  return {
    code: "SUGGESTION_FAILED",
    message: "제안을 만드는 중 문제가 발생했습니다.",
    status: 500
  };
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
