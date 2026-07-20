import type { AnalysisRecord } from "@/core/storage/analysisStore";
import type {
  CanonicalMessage,
  ConversationSource,
  ConversationStats,
  ImportWarning
} from "@/core/types/conversation";
import type { HybridExtractionResult } from "@/core/types/semantic";
import type { MockStructureResult } from "@/core/types/structures";

export type AnalysisMonitorMessage = Pick<
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
>;

export type AnalysisResultPayload = {
  analysisId: string;
  status: "completed" | "failed";
  result?: MockStructureResult;
  sprint5?: HybridExtractionResult | null;
  error?: { code?: string; message?: string };
};

export type AnalysisMessagesPayload = {
  analysisId: string;
  status: "completed" | "failed";
  conversation?: {
    title?: string | null;
    stats?: ConversationStats;
    source?: ConversationSource;
    warnings?: ImportWarning[];
  };
  messages?: AnalysisMonitorMessage[];
  error?: { code?: string; message?: string };
};

export type AnalysisMonitorPayload = {
  result: AnalysisResultPayload;
  messages: AnalysisMessagesPayload;
};

export function createAnalysisMonitorPayload(
  record: AnalysisRecord
): AnalysisMonitorPayload | null {
  if (
    record.status !== "completed" ||
    !record.conversation ||
    !record.structureResult
  ) {
    return null;
  }

  const messages = record.conversation.messages.map((message) => ({
    id: message.id,
    index: message.index,
    role: message.role,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    text: message.text,
    blocks: message.blocks,
    sourceRef: message.sourceRef,
    metadata: message.metadata
  }));

  return {
    result: {
      analysisId: record.id,
      status: record.status,
      result: record.structureResult,
      sprint5: record.hybridExtraction ?? null
    },
    messages: {
      analysisId: record.id,
      status: record.status,
      conversation: {
        title: record.conversation.title,
        stats: record.conversation.stats,
        source: record.conversation.source,
        warnings: record.conversation.warnings
      },
      messages
    }
  };
}
