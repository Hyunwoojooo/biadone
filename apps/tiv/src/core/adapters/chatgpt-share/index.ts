import { createHash } from "node:crypto";

import { adapterError } from "./errors";
import { decodePayloads } from "./decodePayloads";
import { dereference } from "./dereference";
import { extractEnqueuePayloads } from "./extractEnqueuePayloads";
import { fetchShareHtml } from "./fetchShareHtml";
import { normalizeConversation } from "./normalizeConversation";
import { restoreConversation } from "./restoreConversation";
import { validateShareUrl } from "./validateShareUrl";
import type { CanonicalConversation } from "../../types/conversation";

export const CHATGPT_SHARE_ADAPTER_VERSION = "0.1.0";

export type ChatGPTShareAdapterInput = {
  url: string;
  fetchHtml?: (url: string) => Promise<string>;
};

export type ChatGPTShareAdapterOutput = {
  conversation: CanonicalConversation;
  raw?: {
    htmlHash: string;
    payloadCount: number;
  };
};

export async function importChatGPTShareUrl(
  input: ChatGPTShareAdapterInput
): Promise<ChatGPTShareAdapterOutput> {
  const validation = validateShareUrl(input.url);
  if (!validation.valid || !validation.normalizedUrl || !validation.shareId) {
    throw adapterError(
      "INVALID_SHARE_URL",
      `Invalid ChatGPT share URL: ${validation.errorCode ?? "INVALID_URL"}`
    );
  }

  const fetchedAt = new Date().toISOString();
  const html =
    input.fetchHtml !== undefined
      ? await input.fetchHtml(validation.normalizedUrl)
      : (await fetchShareHtml({ url: validation.normalizedUrl })).html;

  const payloads = extractEnqueuePayloads(html);
  const decoded = decodePayloads(payloads);
  const root = decoded.length === 1 ? decoded[0] : decoded;
  const dereferenced = dereference(root, {
    maxDepth: 100,
    maxNodes: 100_000,
    preserveUnknownRefs: true
  });
  const rawMessages = restoreConversation(dereferenced.root);
  const conversation = normalizeConversation({
    rawMessages,
    originalUrl: input.url,
    normalizedUrl: validation.normalizedUrl,
    shareId: validation.shareId,
    fetchedAt,
    adapterVersion: CHATGPT_SHARE_ADAPTER_VERSION
  });

  return {
    conversation,
    raw: {
      htmlHash: createHash("sha256").update(html).digest("hex"),
      payloadCount: payloads.length
    }
  };
}

export { decodePayload, decodePayloads } from "./decodePayloads";
export { dereference } from "./dereference";
export { ChatGPTShareAdapterError } from "./errors";
export { extractEnqueuePayloads } from "./extractEnqueuePayloads";
export { fetchShareHtml } from "./fetchShareHtml";
export { normalizeConversation } from "./normalizeConversation";
export { restoreConversation } from "./restoreConversation";
export { validateShareUrl } from "./validateShareUrl";
export type { RawEnqueuePayload } from "./extractEnqueuePayloads";
export type { RawChatGPTMessage } from "./restoreConversation";
