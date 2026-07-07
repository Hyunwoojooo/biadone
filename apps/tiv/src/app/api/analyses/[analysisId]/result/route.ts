import { NextResponse } from "next/server";

import { extractMockStructure } from "@/core/extractors/mockStructureExtractor";
import { getAnalysisStore } from "@/core/storage/analysisStore";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    analysisId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

  if (record.status === "failed") {
    return NextResponse.json(
      {
        analysisId: record.id,
        status: record.status,
        error: record.error
      },
      { status: 400 }
    );
  }

  if (!record.conversation) {
    return NextResponse.json(
      {
        analysisId: record.id,
        status: record.status,
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "복원된 대화가 없습니다."
        }
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    analysisId: record.id,
    status: record.status,
    result: extractMockStructure(record.conversation)
  });
}
