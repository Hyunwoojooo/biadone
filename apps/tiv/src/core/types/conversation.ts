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
  };
};

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
  totalChars: number;
};

export type ImportWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};
