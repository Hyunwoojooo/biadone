import type {
  CanonicalConversation,
  CanonicalMessage,
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
      hasUnsupportedContent: content.hasUnsupportedContent
    }
  };
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
