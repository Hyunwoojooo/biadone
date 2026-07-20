import { NextResponse } from "next/server";

import { getAnalysisStore } from "@/core/storage/analysisStore";
import type { CanonicalMessage } from "@/core/types/conversation";

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

  const messages =
    record.conversation?.messages.map((message) => serializeMessage(message)) ??
    [];

  return NextResponse.json({
    analysisId: record.id,
    status: record.status,
    conversation: {
      title: record.conversation?.title,
      stats: record.conversation?.stats,
      source: record.conversation?.source,
      warnings: record.conversation?.warnings ?? []
    },
    messages,
    groups: {
      cleanConversation: messages.filter(
        (message) => message.metadata.messageCategory === "clean_conversation"
      ),
      contextSignals: messages.filter(
        (message) => message.metadata.messageCategory === "context_signal"
      ),
      excludedInternal: messages.filter(
        (message) => message.metadata.messageCategory === "excluded_internal"
      )
    }
  });
}

function serializeMessage(
  message: CanonicalMessage
): Pick<
  CanonicalMessage,
  | "id"
  | "index"
  | "role"
  | "createdAt"
  | "updatedAt"
  | "text"
  | "blocks"
  | "sourceRef"
  | "metadata"
> {
  return {
    id: message.id,
    index: message.index,
    role: message.role,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    text: message.text,
    blocks: message.blocks,
    sourceRef: message.sourceRef,
    metadata: message.metadata
  };
}
