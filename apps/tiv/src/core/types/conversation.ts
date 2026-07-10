export type CanonicalConversation = {
  id: string;
  source: ConversationSource;
  title: string | null;
  language: string | null;
  importedAt: string;
  messages: CanonicalMessage[];
  stats: ConversationStats;
  warnings: ImportWarning[];
};

export type ConversationSource = {
  type: "chatgpt_share_link";
  originalUrl: string;
  normalizedUrl: string;
  shareId: string;
  adapterName: "ChatGPTShareAdapter";
  adapterVersion: string;
  fetchedAt: string;
};

export type CanonicalMessage = {
  id: string;
  index: number;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  blocks: ContentBlock[];
  sourceRef: SourceRef;
  metadata: {
    rawMessageId?: string;
    modelSlug?: string | null;
    hasUnsupportedContent?: boolean;
    messageCategory: MessageCategory;
    visibility?: "user_visible" | "not_user_visible" | "unknown";
    contentType?:
      | "plain_text"
      | "markdown"
      | "json_tool_call"
      | "bash"
      | "python"
      | "html_code"
      | "artifact_delivery"
      | "plugin_result"
      | "redacted_plugin_result"
      | "internal";
    semanticAnalyzable?: boolean;
    assistantMessageType?:
      | "final_answer"
      | "transition"
      | "partial_answer"
      | "final_answer_with_artifact"
      | "tool_operation"
      | "tool_result";
    contextSignalType?: ContextSignalType;
    internalContentType?: string;
  };
};

export type MessageCategory =
  | "clean_conversation"
  | "context_signal"
  | "excluded_internal";

export type ContextSignalType =
  | "search_query"
  | "opened_source"
  | "clicked_source"
  | "find_pattern"
  | "search_result"
  | "citation_or_ref"
  | "pointer_reference"
  | "bash_execution"
  | "python_execution"
  | "file_write_operation"
  | "artifact_generation_code"
  | "connector_tool_call"
  | "connector_tool_result"
  | "redacted_tool_result"
  | "skill_read"
  | "artifact_delivery_candidate"
  | "other_tool_call";

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string | null; text: string }
  | { type: "quote"; text: string }
  | { type: "table_markdown"; text: string }
  | { type: "unsupported"; label: string; text: string };

export type SourceRef = {
  type: "chatgpt_share_payload";
  messageId: string | null;
  messageIndex: number;
  role: string;
};

export type ConversationStats = {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  unsupportedMessages: number;
  cleanConversationMessages: number;
  contextSignalMessages: number;
  excludedInternalMessages: number;
  totalChars: number;
};

export type ImportWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};
