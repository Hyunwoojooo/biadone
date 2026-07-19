import { NextResponse } from "next/server";

import {
  GoldenSheetApiError,
  GoldenSheetCapacityError,
  GoldenSheetConfigError,
  syncAnalysisToGoldenSheet
} from "@/core/golden-sheet/googleSheetsClient";
import { getAnalysisStore } from "@/core/storage/analysisStore";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    analysisId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { analysisId } = await context.params;
  const record = getAnalysisStore().get(analysisId);

  if (!record) {
    return NextResponse.json(
      {
        error: {
          code: "ANALYSIS_NOT_FOUND",
          message: "분석 결과를 찾지 못했습니다."
        }
      },
      { status: 404 }
    );
  }

  if (record.status === "failed" || !record.conversation) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "완료된 대화 분석 결과가 없습니다."
        }
      },
      { status: 400 }
    );
  }

  try {
    const result = await syncAnalysisToGoldenSheet({
      analysisId: record.id,
      shareUrl: record.shareUrl,
      conversation: record.conversation
    });
    return NextResponse.json(result);
  } catch (error) {
    const normalized = normalizeGoldenSheetError(error);
    console.error("Golden Sheet sync failed", {
      analysisId,
      code: normalized.code,
      detail: normalized.detail
    });
    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message
        }
      },
      { status: normalized.status }
    );
  }
}

function normalizeGoldenSheetError(error: unknown): {
  code: string;
  message: string;
  status: number;
  detail?: string;
} {
  if (error instanceof GoldenSheetConfigError) {
    return {
      code: error.code,
      message: error.message,
      status: 503
    };
  }
  if (error instanceof GoldenSheetCapacityError) {
    return {
      code: error.code,
      message: error.message,
      status: 409
    };
  }
  if (error instanceof GoldenSheetApiError) {
    return {
      code: error.code,
      message: "Google Sheet에 데이터를 저장하지 못했습니다.",
      status: 502,
      detail: error.message
    };
  }
  return {
    code: "GOLDEN_SHEET_SYNC_FAILED",
    message: "Golden Dataset Sheet 동기화에 실패했습니다.",
    status: 500,
    detail: error instanceof Error ? error.message : undefined
  };
}
