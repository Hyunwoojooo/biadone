import { NextResponse } from "next/server";

import { buildGptAuditMarkdown } from "@/core/export/gptAuditExport";
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

  const result = record.structureResult ?? extractMockStructure(record.conversation);
  const markdown = buildGptAuditMarkdown({
    analysisId: record.id,
    shareUrl: record.shareUrl,
    conversation: record.conversation,
    result,
    hybridExtraction: record.hybridExtraction
  });

  return new NextResponse(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="tiv-gpt-audit-${record.id}.md"`
    }
  });
}
