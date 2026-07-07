import type {
  CanonicalConversation,
  CanonicalMessage,
  ContextSignalType,
  ContentBlock
} from "../../types/conversation";
import type { RawChatGPTMessage } from "./restoreConversation";

export type NormalizeConversationInput = {
  rawMessages: RawChatGPTMessage[];
  originalUrl: string;
  normalizedUrl: string;
  shareId: string;
  fetchedAt: string;
  title?: string | null;
  language?: string | null;
  adapterVersion: string;
};

export function normalizeConversation(
  input: NormalizeConversationInput
): CanonicalConversation {
  const messages = input.rawMessages
    .map((rawMessage, index) => normalizeMessage(rawMessage, index + 1))
    .filter((message): message is CanonicalMessage => {
      if (!message) {
        return false;
      }
      if (message.role === "system" || message.role === "tool") {
        return false;
      }
      return (
        message.text.trim().length > 0 ||
        message.metadata.hasUnsupportedContent === true
      );
    })
    .map((message, index) => ({
      ...message,
      index: index + 1,
      sourceRef: {
        ...message.sourceRef,
        messageIndex: index + 1
      }
    }));

  const unsupportedMessages = messages.filter(
    (message) => message.metadata.hasUnsupportedContent
  ).length;
  const cleanConversationMessages = messages.filter(
    (message) => message.metadata.messageCategory === "clean_conversation"
  ).length;
  const contextSignalMessages = messages.filter(
    (message) => message.metadata.messageCategory === "context_signal"
  ).length;
  const excludedInternalMessages = messages.filter(
    (message) => message.metadata.messageCategory === "excluded_internal"
  ).length;

  return {
    id: `conv_${input.shareId}`,
    source: {
      type: "chatgpt_share_link",
      originalUrl: input.originalUrl,
      normalizedUrl: input.normalizedUrl,
      shareId: input.shareId,
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: input.adapterVersion,
      fetchedAt: input.fetchedAt
    },
    title: input.title ?? null,
    language: input.language ?? null,
    importedAt: new Date().toISOString(),
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter((message) => message.role === "assistant")
        .length,
      unsupportedMessages,
      cleanConversationMessages,
      contextSignalMessages,
      excludedInternalMessages,
      totalChars: messages.reduce((sum, message) => sum + message.text.length, 0)
    },
    warnings: unsupportedMessages
      ? [
          {
            code: "UNSUPPORTED_CONTENT_PLACEHOLDER",
            message: "Some unsupported content was converted to placeholders.",
            severity: "warning"
          }
        ]
      : []
  };
}

function normalizeMessage(
  rawMessage: RawChatGPTMessage,
  index: number
): CanonicalMessage | null {
  const role = normalizeRole(rawMessage.role ?? rawMessage.authorRole);
  const content = extractContent(rawMessage.content);
  const rawId = rawMessage.id ?? `raw_${index}`;
  const classification = classifyMessage({
    role,
    text: content.text,
    blocks: content.blocks,
    hasUnsupportedContent: content.hasUnsupportedContent
  });

  if (!content.text.trim() && !content.hasUnsupportedContent) {
    return null;
  }

  return {
    id: `msg_${index}`,
    index,
    role,
    text: content.text,
    blocks: content.blocks,
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: rawMessage.id ?? null,
      messageIndex: index,
      role
    },
    metadata: {
      rawMessageId: rawId,
      modelSlug: extractModelSlug(rawMessage.metadata),
      hasUnsupportedContent: content.hasUnsupportedContent,
      messageCategory: classification.messageCategory,
      contextSignalType: classification.contextSignalType,
      internalContentType: classification.internalContentType
    }
  };
}

function classifyMessage(input: {
  role: CanonicalMessage["role"];
  text: string;
  blocks: ContentBlock[];
  hasUnsupportedContent: boolean;
}): {
  messageCategory: CanonicalMessage["metadata"]["messageCategory"];
  contextSignalType?: ContextSignalType;
  internalContentType?: string;
} {
  const unsupportedLabel = input.blocks.find(
    (block): block is Extract<ContentBlock, { type: "unsupported" }> =>
      block.type === "unsupported"
  )?.label;

  if (unsupportedLabel && isExcludedInternalContentType(unsupportedLabel)) {
    return {
      messageCategory: "excluded_internal",
      internalContentType: unsupportedLabel
    };
  }

  const contextSignalType = detectContextSignalType(input.text);
  if (contextSignalType) {
    return {
      messageCategory: "context_signal",
      contextSignalType
    };
  }

  if (
    input.role === "assistant" &&
    input.hasUnsupportedContent &&
    unsupportedLabel
  ) {
    return {
      messageCategory: "excluded_internal",
      internalContentType: unsupportedLabel
    };
  }

  return { messageCategory: "clean_conversation" };
}

function isExcludedInternalContentType(label: string): boolean {
  return [
    "thoughts",
    "reasoning_recap",
    "model_editable_context",
    "system_context"
  ].includes(label);
}

function detectContextSignalType(text: string): ContextSignalType | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const keys = new Set(Object.keys(parsed));
  if (keys.has("system1_search_query")) {
    return "search_query";
  }
  if (keys.has("open")) {
    return "opened_source";
  }
  if (keys.has("click")) {
    return "clicked_source";
  }
  if (keys.has("find")) {
    return "find_pattern";
  }
  if (keys.has("system1_search_result")) {
    return "search_result";
  }
  if (keys.has("ref_id") || keys.has("ref_ids")) {
    return "citation_or_ref";
  }

  return null;
}


function normalizeRole(value: string | undefined): CanonicalMessage["role"] {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") {
    return value;
  }
  return "unknown";
}

function extractContent(content: unknown): {
  text: string;
  blocks: ContentBlock[];
  hasUnsupportedContent: boolean;
} {
  if (typeof content === "string") {
    return textToBlocks(content);
  }

  if (Array.isArray(content)) {
    return textToBlocks(
      content
        .map((part) => extractPartText(part))
        .filter(Boolean)
        .join("\n\n")
    );
  }

  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    const contentType = typeof record.content_type === "string" ? record.content_type : "";

    if (Array.isArray(record.parts)) {
      const text = record.parts
        .map((part) => extractPartText(part))
        .filter(Boolean)
        .join("\n\n");
      if (text.trim()) {
        return textToBlocks(text);
      }
    }

    if (typeof record.text === "string") {
      return textToBlocks(record.text);
    }

    if (contentType && contentType !== "text") {
      const label = contentType.replace(/^multimodal_/, "");
      const text = `[${label} 첨부: v0.1에서는 분석 제외]`;
      return {
        text,
        blocks: [{ type: "unsupported", label, text }],
        hasUnsupportedContent: true
      };
    }
  }

  return { text: "", blocks: [], hasUnsupportedContent: false };
}

function extractPartText(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (part && typeof part === "object") {
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
  }
  return "";
}

function textToBlocks(text: string): {
  text: string;
  blocks: ContentBlock[];
  hasUnsupportedContent: boolean;
} {
  const blocks: ContentBlock[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) {
      blocks.push(...plainTextBlocks(before));
    }
    blocks.push({
      type: "code",
      language: match[1]?.trim() || null,
      text: match[2] ?? ""
    });
    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex).trim();
  if (rest) {
    blocks.push(...plainTextBlocks(rest));
  }

  return {
    text,
    blocks: blocks.length ? blocks : [{ type: "paragraph", text }],
    hasUnsupportedContent: false
  };
}

function plainTextBlocks(text: string): ContentBlock[] {
  return text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({ type: "paragraph", text: chunk }));
}

function extractModelSlug(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) {
    return null;
  }
  return typeof metadata.model_slug === "string" ? metadata.model_slug : null;
}
