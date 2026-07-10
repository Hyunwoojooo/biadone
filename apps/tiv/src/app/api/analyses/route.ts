import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ChatGPTShareAdapterError,
  importChatGPTShareUrl
} from "@/core/adapters/chatgpt-share";
import { getAnalysisStore } from "@/core/storage/analysisStore";
import { extractMockStructure } from "@/core/extractors/mockStructureExtractor";
import { runShadowExtraction } from "@/core/extractors/runShadowExtraction";

const createAnalysisRequestSchema = z.object({
  shareUrl: z.string().min(1)
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = createAnalysisRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "shareUrl is required."
        }
      },
      { status: 400 }
    );
  }

  const store = getAnalysisStore();

  try {
    const result = await importChatGPTShareUrl({ url: parsed.data.shareUrl });
    const structureResult = extractMockStructure(result.conversation);
    const hybridExtraction = await runShadowExtraction({
      conversation: result.conversation,
      ruleResult: structureResult
    });
    const record = store.createCompleted({
      shareUrl: parsed.data.shareUrl,
      conversation: result.conversation,
      structureResult,
      hybridExtraction
    });

    return NextResponse.json({
      analysisId: record.id,
      status: record.status,
      shadowStatus: record.hybridExtraction?.llmResult.status
    });
  } catch (error) {
    const normalizedError = normalizeAnalysisError(error);
    console.error("ChatGPT share analysis failed", {
      code: normalizedError.code,
      detail: normalizedError.detail
    });
    const record = store.createFailed({
      shareUrl: parsed.data.shareUrl,
      error: normalizedError
    });

    return NextResponse.json(
      {
        analysisId: record.id,
        status: record.status,
        error: normalizedError
      },
      { status: 400 }
    );
  }
}

function normalizeAnalysisError(error: unknown): {
  code: string;
  message: string;
  detail?: string;
} {
  if (error instanceof ChatGPTShareAdapterError) {
    return {
      code: error.code,
      message: userMessageForCode(error.code),
      detail: error.message
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "대화 내용을 가져오지 못했습니다."
  };
}

function userMessageForCode(code: string): string {
  switch (code) {
    case "INVALID_SHARE_URL":
      return "지원되는 링크 형식은 https://chatgpt.com/share/... 입니다.";
    case "PAYLOAD_NOT_FOUND":
      return "ChatGPT 공유 페이지의 내부 대화 데이터를 찾지 못했습니다.";
    case "LINEAR_CONVERSATION_NOT_FOUND":
      return "대화 메시지 배열을 복원하지 못했습니다.";
    case "NO_MESSAGES_FOUND":
      return "복원 가능한 메시지를 찾지 못했습니다.";
    case "SHARE_LINK_DELETED":
    case "SHARE_LINK_NOT_ACCESSIBLE":
    case "HTML_FETCH_FAILED":
      return "공유 링크에 접근하지 못했습니다.";
    default:
      return "대화 내용을 가져오지 못했습니다.";
  }
}
