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
      if (message.role === "system") {
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
  const temporalStats = conversationTemporalStats(messages);

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
      ...temporalStats,
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
    createdAt: epochSecondsToIso(rawMessage.createTime),
    updatedAt: epochSecondsToIso(rawMessage.updateTime),
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
      visibility: classification.visibility,
      contentType: classification.contentType,
      semanticAnalyzable: classification.semanticAnalyzable,
      assistantMessageType: classification.assistantMessageType,
      contextSignalType: classification.contextSignalType,
      internalContentType: classification.internalContentType
    }
  };
}

function epochSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function conversationTemporalStats(messages: CanonicalMessage[]): Pick<
  CanonicalConversation["stats"],
  "startedAt" | "endedAt" | "durationSeconds"
> {
  const timestamps = messages
    .map((message) => message.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const startedAtMs = timestamps[0];
  const endedAtMs = timestamps.at(-1);

  if (startedAtMs === undefined || endedAtMs === undefined) {
    return { startedAt: null, endedAt: null, durationSeconds: null };
  }

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationSeconds: Math.max(0, (endedAtMs - startedAtMs) / 1000)
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
  visibility?: CanonicalMessage["metadata"]["visibility"];
  contentType?: CanonicalMessage["metadata"]["contentType"];
  semanticAnalyzable?: boolean;
  assistantMessageType?: CanonicalMessage["metadata"]["assistantMessageType"];
} {
  const unsupportedLabel = input.blocks.find(
    (block): block is Extract<ContentBlock, { type: "unsupported" }> =>
      block.type === "unsupported"
  )?.label;

  if (unsupportedLabel && isExcludedInternalContentType(unsupportedLabel)) {
    return {
      messageCategory: "excluded_internal",
      internalContentType: unsupportedLabel,
      visibility: "not_user_visible",
      contentType: "internal",
      semanticAnalyzable: false
    };
  }

  if (input.role === "tool") {
    return {
      messageCategory: "context_signal",
      contextSignalType: detectContextSignalType(input.text) ?? "connector_tool_result",
      visibility: "not_user_visible",
      contentType: "plugin_result",
      semanticAnalyzable: false,
      assistantMessageType: "tool_result"
    };
  }

  if (isAssistantTransition(input.role, input.text)) {
    return {
      messageCategory: "clean_conversation",
      visibility: "user_visible",
      contentType: contentTypeForCleanText(input.text),
      semanticAnalyzable: true,
      assistantMessageType: "transition"
    };
  }

  if (isAssistantFinalAnswer(input.role, input.text)) {
    return {
      messageCategory: "clean_conversation",
      visibility: "user_visible",
      contentType: input.text.includes("sandbox:/mnt/data/")
        ? "artifact_delivery"
        : contentTypeForCleanText(input.text),
      semanticAnalyzable: true,
      assistantMessageType: input.text.includes("sandbox:/mnt/data/")
        ? "final_answer_with_artifact"
        : "final_answer"
    };
  }

  const contextSignalType = detectContextSignalType(input.text);
  if (contextSignalType) {
    return {
      messageCategory: "context_signal",
      contextSignalType,
      visibility: "not_user_visible",
      contentType: contentTypeForContextSignal(input.text, contextSignalType),
      semanticAnalyzable: false,
      assistantMessageType: "tool_operation"
    };
  }

  if (
    input.role === "assistant" &&
    input.hasUnsupportedContent &&
    unsupportedLabel
  ) {
    return {
      messageCategory: "excluded_internal",
      internalContentType: unsupportedLabel,
      visibility: "not_user_visible",
      contentType: "internal",
      semanticAnalyzable: false
    };
  }

  return {
    messageCategory: "clean_conversation",
    visibility: "user_visible",
    contentType: contentTypeForCleanText(input.text),
    semanticAnalyzable: true,
    assistantMessageType: input.role === "assistant" ? "final_answer" : undefined
  };
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

  const commandSignalType = detectCommandLikeContextSignal(trimmed);
  if (commandSignalType) {
    return commandSignalType;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return detectJsonContextSignalType(parsed as Record<string, unknown>);
  }

  return null;
}

function detectJsonContextSignalType(
  parsed: Record<string, unknown>
): ContextSignalType | null {
  const keys = new Set(Object.keys(parsed));
  if (keys.has("uri") && typeof parsed.uri === "string" && parsed.uri.startsWith("skill://")) {
    return "skill_read";
  }
  if (keys.has("paths") || keys.has("query")) {
    return "connector_tool_call";
  }
  if (
    keys.has("system1_search_query") ||
    keys.has("search_query") ||
    keys.has("queries")
  ) {
    return "search_query";
  }
  if (keys.has("open") || keys.has("pointers")) {
    return keys.has("pointers") ? "pointer_reference" : "opened_source";
  }
  if (keys.has("click")) {
    return "clicked_source";
  }
  if (keys.has("find")) {
    return "find_pattern";
  }
  if (
    keys.has("system1_search_result") ||
    keys.has("search_result") ||
    keys.has("results")
  ) {
    return "search_result";
  }
  if (
    keys.has("ref_id") ||
    keys.has("ref_ids") ||
    keys.has("citation") ||
    keys.has("citations")
  ) {
    return "citation_or_ref";
  }
  if (
    keys.has("bash") ||
    keys.has("python") ||
    keys.has("container") ||
    keys.has("file_search") ||
    keys.has("browser") ||
    keys.has("web.run") ||
    keys.has("tool")
  ) {
    if (keys.has("bash")) {
      return "bash_execution";
    }
    if (keys.has("python")) {
      return "python_execution";
    }
    return "connector_tool_call";
  }

  return null;
}

function detectCommandLikeContextSignal(trimmed: string): ContextSignalType | null {
  if (!trimmed) {
    return null;
  }

  if (
    /^bash\s+-lc/.test(trimmed) ||
    /^(sh|zsh|node)\s+(-lc|-c|-?\s*<<)/.test(trimmed)
  ) {
    return "bash_execution";
  }

  if (/^python3?\b/.test(trimmed) || /^from pathlib import Path\b/.test(trimmed)) {
    return "python_execution";
  }

  if (/^html\s*=\s*r?["']{3}/.test(trimmed) || /^<!doctype html/i.test(trimmed)) {
    return "artifact_generation_code";
  }

  if (
    /^cat\s*>\s*\/mnt\/data\//.test(trimmed) ||
    /^\/mnt\/data\//.test(trimmed) ||
    /^ls\s+-(la|r)\b/i.test(trimmed)
  ) {
    return "file_write_operation";
  }

  if (/^The output of this plugin was redacted\.?$/i.test(trimmed)) {
    return "redacted_tool_result";
  }

  if (/Code executed with no return value/i.test(trimmed)) {
    return "connector_tool_result";
  }

  if (/^(container|file_search|browser|web\.run|connector)\b/.test(trimmed)) {
    return "connector_tool_call";
  }

  if (isSandboxDownloadOnly(trimmed)) {
    return "artifact_delivery_candidate";
  }

  return null;
}

function isSandboxDownloadOnly(trimmed: string): boolean {
  if (!trimmed.includes("sandbox:/mnt/data/")) {
    return false;
  }

  const withoutLinks = trimmed
    .replace(/\[[^\]]+\]\(sandbox:\/mnt\/data\/[^)]+\)/g, "")
    .replace(/sandbox:\/mnt\/data\/\S+/g, "")
    .replace(/[\s\d.·\-_*()[\]]+/g, "")
    .trim();

  return (
    withoutLinks.length === 0 ||
    /^(다운로드|파일|완료|생성|첨부|링크|md|markdown)+$/i.test(withoutLinks)
  );
}

function isAssistantFinalAnswer(
  role: CanonicalMessage["role"],
  text: string
): boolean {
  if (role !== "assistant") {
    return false;
  }

  const trimmed = text.trim();
  if (
    !hasNaturalLanguage(trimmed) ||
    isPureToolOperation(trimmed) ||
    isSandboxDownloadOnly(trimmed)
  ) {
    return false;
  }

  return /(완료했습니다|완성했습니다|만들었습니다|만들었어|정리했습니다|아래처럼|시작은 가능합니다|맞아|좋아|파일 다운로드|zip 다운로드|다운로드|실행은|구성은|이번 버전|다음 작업은|수정 반영|반영해서|가능합니다|다만)/i.test(
    trimmed
  );
}

function isAssistantTransition(
  role: CanonicalMessage["role"],
  text: string
): boolean {
  if (role !== "assistant" || text.trim().length > 100) {
    return false;
  }
  return /^(좋습니다[.!]?\s*)?(이제 |다음 |먼저 |확인해 |나눠 |정리해 |살펴보겠습니다|진행하겠습니다)/i.test(
    text.trim()
  );
}

function hasNaturalLanguage(text: string): boolean {
  return /[가-힣a-zA-Z]/.test(text) && text.replace(/\s+/g, " ").length >= 12;
}

function isPureToolOperation(text: string): boolean {
  return Boolean(detectCommandLikeContextSignal(text)) && !isSandboxDownloadOnly(text);
}

function contentTypeForContextSignal(
  text: string,
  signalType: ContextSignalType
): CanonicalMessage["metadata"]["contentType"] {
  if (signalType === "bash_execution") {
    return "bash";
  }
  if (signalType === "python_execution") {
    return "python";
  }
  if (signalType === "artifact_generation_code") {
    return "html_code";
  }
  if (signalType === "redacted_tool_result") {
    return "redacted_plugin_result";
  }
  if (signalType === "connector_tool_result") {
    return "plugin_result";
  }
  if (text.trim().startsWith("{")) {
    return "json_tool_call";
  }
  return "plain_text";
}

function contentTypeForCleanText(
  text: string
): CanonicalMessage["metadata"]["contentType"] {
  if (text.includes("sandbox:/mnt/data/")) {
    return "artifact_delivery";
  }
  if (/^#|\n[-*]\s|\[[^\]]+\]\([^)]+\)/m.test(text)) {
    return "markdown";
  }
  return "plain_text";
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
