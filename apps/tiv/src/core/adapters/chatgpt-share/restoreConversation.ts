import { adapterError } from "./errors";

export type RawChatGPTMessage = {
  id?: string;
  role?: string;
  authorRole?: string;
  content?: unknown;
  createTime?: number | null;
  updateTime?: number | null;
  metadata?: Record<string, unknown>;
  parentId?: string | null;
  childrenIds?: string[];
};

export function restoreConversation(root: unknown): RawChatGPTMessage[] {
  const linearConversation = findByKey(root, "linear_conversation");
  if (!Array.isArray(linearConversation)) {
    throw adapterError(
      "LINEAR_CONVERSATION_NOT_FOUND",
      "Could not find linear_conversation in share payload"
    );
  }

  const messages = linearConversation
    .map((item) => toRawMessage(item))
    .filter((message): message is RawChatGPTMessage => message !== null);

  if (messages.length === 0) {
    throw adapterError("NO_MESSAGES_FOUND", "No messages found in linear_conversation");
  }

  return messages;
}

function findByKey(root: unknown, targetKey: string): unknown {
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== "object") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (!Array.isArray(value) && targetKey in value) {
      return (value as Record<string, unknown>)[targetKey];
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    queue.push(...children);
  }

  return null;
}

function toRawMessage(value: unknown): RawChatGPTMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const message = pickMessageObject(record);
  if (!message) {
    return null;
  }

  const content = message.content;
  const author = asRecord(message.author);
  const metadata = asRecord(message.metadata);

  return {
    id: stringOrUndefined(message.id),
    role:
      stringOrUndefined(message.role) ??
      stringOrUndefined(author?.role) ??
      stringOrUndefined(message.authorRole),
    authorRole: stringOrUndefined(author?.role),
    content,
    createTime: numberOrNull(message.create_time ?? message.createTime),
    updateTime: numberOrNull(message.update_time ?? message.updateTime),
    metadata: metadata ?? undefined,
    parentId: stringOrNull(message.parent ?? message.parentId),
    childrenIds: arrayOfStrings(message.children ?? message.childrenIds)
  };
}

function pickMessageObject(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  if (record.message && typeof record.message === "object") {
    return record.message as Record<string, unknown>;
  }
  if ("content" in record || "author" in record || "role" in record) {
    return record;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}
