export const CHATGPT_SHARE_ADAPTER_VERSION = "gptmemory-chatgpt-share.v4";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_PARSE_NODES = 100_000;
const MAX_FLIGHT_ROWS = 10_000;

export type ChatGPTImportErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SHARE_URL"
  | "SHARE_LINK_NOT_ACCESSIBLE"
  | "SHARE_LINK_DELETED"
  | "SHARE_FETCH_TIMEOUT"
  | "SHARE_RESPONSE_TOO_LARGE"
  | "SHARE_RESPONSE_NOT_HTML"
  | "SHARE_FETCH_MISCONFIGURED"
  | "RATE_LIMITED"
  | "CHATGPT_PAYLOAD_CHANGED"
  | "CONVERSATION_NOT_FOUND"
  | "NO_VISIBLE_MESSAGES"
  | "IMPORT_FAILED";

export class ChatGPTImportError extends Error {
  readonly code: ChatGPTImportErrorCode;
  readonly httpStatus: number;
  readonly causeValue?: unknown;

  constructor(
    code: ChatGPTImportErrorCode,
    message: string,
    httpStatus: number,
    causeValue?: unknown,
  ) {
    super(message);
    this.name = "ChatGPTImportError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.causeValue = causeValue;
  }
}

export type ShareUrlValidationResult =
  | {
      valid: true;
      originalUrl: string;
      normalizedUrl: string;
      shareId: string;
    }
  | {
      valid: false;
      errorCode:
        | "INVALID_URL"
        | "UNSUPPORTED_DOMAIN"
        | "UNSUPPORTED_PATH"
        | "MISSING_SHARE_ID";
    };

export type ChatGPTMessage = {
  id: string;
  index: number;
  sourceIndex: number | null;
  role: "user" | "assistant";
  kind: "text" | "event";
  eventType?: "image_generated" | "file_created";
  text: string;
  createdAt: string | null;
};

export type ChatGPTConversation = {
  title: string | null;
  messages: ChatGPTMessage[];
};

export type ChatGPTShareSource = {
  type: "chatgpt_share_link";
  originalUrl: string;
  normalizedUrl: string;
  shareId: string;
  fetchedAt: string;
  adapterVersion: string;
};

export type ChatGPTShareImportResult = {
  conversation: ChatGPTConversation;
  source: ChatGPTShareSource;
  warnings: Array<{
    code: string;
    message: string;
  }>;
  diagnostics: {
    payloadCount: number;
    sourceMessageCount: number;
    noteMessageCount: number;
    omittedInternalCount: number;
    preservedEventCount: number;
    unsupportedContentCount: number;
    privateArtifactReferenceRedactedCount: number;
    richReferenceMarkerOmittedCount: number;
    titleSource: "payload" | "html" | "first_user_message" | "none";
  };
};

export type FetchShareHtmlInput = {
  url: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
};

export type FetchShareHtmlOutput = {
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
  contentLength: number;
};

export type ImportChatGPTShareUrlInput = {
  url: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
  fetchHtml?: (normalizedUrl: string) => Promise<string>;
};

type RawEnqueuePayload = {
  order: number;
  rawArgument: string;
};

type RawChatGPTMessage = {
  id?: string;
  role?: string;
  authorRole?: string;
  authorName?: string;
  recipient?: string;
  channel?: string;
  isVisuallyHidden?: boolean;
  metadata?: Record<string, unknown>;
  content?: unknown;
  contentType?: string;
  createTime?: number | null;
};

type NormalizedMessageResult = {
  messages: ChatGPTMessage[];
  sourceMessageCount: number;
  omittedInternalCount: number;
  preservedEventCount: number;
  unsupportedContentCount: number;
  privateArtifactReferenceRedactedCount: number;
  richReferenceMarkerOmittedCount: number;
};

type ArtifactEvent = {
  type: "image_generated" | "file_created";
  key: string;
  text: string;
};

type TitleExtractionResult = {
  title: string | null;
  source: "payload" | "html" | "first_user_message" | "none";
};

type ReactFlightRow = {
  id: string;
  tag: string | null;
  body: unknown;
};

type ReactFlightExpansion = {
  decodedPayloads: unknown;
  reactFlightRows: ReactFlightRow[];
  reactFlightTables: unknown[];
};

type DereferenceContext = {
  refTable: Map<string, unknown>;
  visiting: Set<string>;
  visitedNodes: number;
  maxDepth: number;
  maxNodes: number;
};

const ENQUEUE_PATTERN = "streamController.enqueue";
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MATERIALIZED_TOP_LEVEL_KEYS = new Set([
  "linear_conversation",
  "title",
  "conversation_title",
]);
const MATERIALIZED_OBJECT_KEYS = new Set([
  "linear_conversation",
  "id",
  "message",
  "parent",
  "children",
  "author",
  "name",
  "role",
  "recipient",
  "channel",
  "metadata",
  "message_type",
  "is_visually_hidden_from_conversation",
  "image_gen_title",
  "tool_calls",
  "tool_call_id",
  "attachments",
  "content",
  "content_type",
  "parts",
  "text",
  "asset_pointer",
  "image_url",
  "file_id",
  "file_name",
  "filename",
  "sandbox_path",
  "download_url",
  "mime_type",
  "create_time",
  "createTime",
  "update_time",
  "updateTime",
  "title",
  "conversation_title",
]);
const VISIBLE_ASSISTANT_RECIPIENTS = new Set(["all"]);
const INTERNAL_CONTENT_TYPES = new Set([
  "computer_initialize_state",
  "computer_output",
  "execution_output",
  "model_editable_context",
  "reasoning_recap",
  "thoughts",
  "tool_result",
]);
const TITLE_SCHEMA_TOKENS = new Set(
  [
    ...MATERIALIZED_TOP_LEVEL_KEYS,
    ...MATERIALIZED_OBJECT_KEYS,
    "current_node",
    "mapping",
    "conversation_id",
  ].map((key) => key.toLowerCase()),
);

export function validateShareUrl(input: string): ShareUrlValidationResult {
  if (typeof input !== "string" || input.trim().length === 0 || input.length > 2_048) {
    return { valid: false, errorCode: "INVALID_URL" };
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { valid: false, errorCode: "INVALID_URL" };
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    return { valid: false, errorCode: "INVALID_URL" };
  }

  if (url.hostname !== "chatgpt.com") {
    return { valid: false, errorCode: "UNSUPPORTED_DOMAIN" };
  }

  const pathMatch = /^\/share\/([^/]+)\/?$/.exec(url.pathname);
  if (!pathMatch) {
    return {
      valid: false,
      errorCode:
        url.pathname === "/share" || url.pathname === "/share/"
          ? "MISSING_SHARE_ID"
          : "UNSUPPORTED_PATH",
    };
  }

  const shareId = pathMatch[1] ?? "";
  if (!SHARE_ID_PATTERN.test(shareId)) {
    return { valid: false, errorCode: "UNSUPPORTED_PATH" };
  }

  return {
    valid: true,
    originalUrl: input.trim(),
    normalizedUrl: `https://chatgpt.com/share/${shareId}`,
    shareId,
  };
}

export async function fetchShareHtml(
  input: FetchShareHtmlInput,
): Promise<FetchShareHtmlOutput> {
  if (process.env.CHATGPT_SHARE_FETCHER_URL) {
    return fetchShareHtmlViaFetcher(input);
  }
  return fetchShareHtmlDirect(input);
}

export async function importChatGPTShareUrl(
  input: ImportChatGPTShareUrlInput,
): Promise<ChatGPTShareImportResult> {
  const validation = validateShareUrl(input.url);
  if (!validation.valid) {
    throw importError(
      "INVALID_SHARE_URL",
      `Invalid public ChatGPT share URL (${validation.errorCode})`,
    );
  }

  const maxBodyBytes = positiveInteger(
    input.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
  );
  let html: string;
  let fetchedAt: string;

  if (input.fetchHtml) {
    try {
      html = await input.fetchHtml(validation.normalizedUrl);
    } catch (error) {
      if (error instanceof ChatGPTImportError) throw error;
      throw importError(
        "SHARE_LINK_NOT_ACCESSIBLE",
        "Unable to fetch the ChatGPT share page",
        error,
      );
    }
    fetchedAt = new Date().toISOString();
    assertHtmlSize(html, maxBodyBytes);
  } else {
    const fetched = await fetchShareHtml({
      url: validation.normalizedUrl,
      timeoutMs: input.timeoutMs,
      maxBodyBytes,
      fetchImpl: input.fetchImpl,
    });
    html = fetched.html;
    fetchedAt = fetched.fetchedAt;
  }

  try {
    const payloads = extractEnqueuePayloads(html);
    const decodedPayloads = payloads.map((payload) =>
      decodePayload(payload.rawArgument, payload.order),
    );
    const decodedRoot =
      decodedPayloads.length === 1 ? decodedPayloads[0] : decodedPayloads;
    const expanded = expandReactFlightPayloads(decodedRoot);
    const dereferenced = dereference(expanded);
    const rawMessages = restoreConversation(dereferenced);
    const normalized = normalizeMessages(rawMessages);
    const messages = normalized.messages;

    if (messages.length === 0) {
      throw importError(
        "NO_VISIBLE_MESSAGES",
        "The shared conversation has no visible user or assistant messages",
      );
    }

    const title = extractConversationTitle(dereferenced, html, messages);
    const warnings = buildImportWarnings(normalized, title);

    return {
      conversation: {
        title: title.title,
        messages,
      },
      source: {
        type: "chatgpt_share_link",
        originalUrl: validation.originalUrl,
        normalizedUrl: validation.normalizedUrl,
        shareId: validation.shareId,
        fetchedAt,
        adapterVersion: CHATGPT_SHARE_ADAPTER_VERSION,
      },
      warnings,
      diagnostics: {
        payloadCount: payloads.length,
        sourceMessageCount: normalized.sourceMessageCount,
        noteMessageCount: messages.length,
        omittedInternalCount: normalized.omittedInternalCount,
        preservedEventCount: normalized.preservedEventCount,
        unsupportedContentCount: normalized.unsupportedContentCount,
        privateArtifactReferenceRedactedCount:
          normalized.privateArtifactReferenceRedactedCount,
        richReferenceMarkerOmittedCount:
          normalized.richReferenceMarkerOmittedCount,
        titleSource: title.source,
      },
    };
  } catch (error) {
    if (error instanceof ChatGPTImportError) throw error;
    throw importError(
      "CHATGPT_PAYLOAD_CHANGED",
      "The ChatGPT share page format could not be restored",
      error,
    );
  }
}

async function fetchShareHtmlDirect(
  input: FetchShareHtmlInput,
): Promise<FetchShareHtmlOutput> {
  const validation = validateShareUrl(input.url);
  if (!validation.valid) {
    throw importError("INVALID_SHARE_URL", "Invalid public ChatGPT share URL");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = positiveInteger(input.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const maxBodyBytes = positiveInteger(
    input.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(validation.normalizedUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "accept-language": "ko,en-US;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "user-agent":
          input.userAgent ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    throwForUpstreamStatus(response.status);
    assertFinalShareUrl(response.url || validation.normalizedUrl, validation.shareId);
    assertHtmlContentType(response.headers.get("content-type"));
    const html = await readResponseText(response, maxBodyBytes);

    if (!html.trim()) {
      throw importError(
        "SHARE_LINK_NOT_ACCESSIBLE",
        "The ChatGPT share page was empty",
      );
    }

    return {
      finalUrl: response.url || validation.normalizedUrl,
      statusCode: response.status,
      html,
      fetchedAt: new Date().toISOString(),
      contentLength: byteLength(html),
    };
  } catch (error) {
    if (error instanceof ChatGPTImportError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      throw importError(
        "SHARE_FETCH_TIMEOUT",
        "Timed out while fetching the ChatGPT share page",
        error,
      );
    }
    throw importError(
      "SHARE_LINK_NOT_ACCESSIBLE",
      "Unable to fetch the ChatGPT share page",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchShareHtmlViaFetcher(
  input: FetchShareHtmlInput,
): Promise<FetchShareHtmlOutput> {
  const validation = validateShareUrl(input.url);
  if (!validation.valid) {
    throw importError("INVALID_SHARE_URL", "Invalid public ChatGPT share URL");
  }

  const fetcherUrl = process.env.CHATGPT_SHARE_FETCHER_URL;
  const fetcherSecret = process.env.CHATGPT_SHARE_FETCHER_SECRET;
  if (!fetcherUrl || !fetcherSecret) {
    throw importError(
      "SHARE_FETCH_MISCONFIGURED",
      "The ChatGPT share fetcher is not configured",
    );
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = positiveInteger(input.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const maxBodyBytes = positiveInteger(
    input.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(fetcherUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fetcherSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: validation.normalizedUrl }),
      redirect: "follow",
      signal: controller.signal,
    });

    const jsonBodyLimit = maxBodyBytes * 2 + 64 * 1024;
    const responseText = await readResponseText(response, jsonBodyLimit);
    let payload: {
      ok?: boolean;
      status?: number;
      finalUrl?: string;
      contentType?: string | null;
      html?: string;
    };

    try {
      payload = JSON.parse(responseText) as typeof payload;
    } catch (error) {
      throw importError(
        "SHARE_LINK_NOT_ACCESSIBLE",
        "The ChatGPT share fetcher returned an invalid response",
        error,
      );
    }

    const upstreamStatus = payload.status ?? response.status;
    if (!response.ok || payload.ok === false) {
      throwForUpstreamStatus(upstreamStatus);
      throw importError(
        "SHARE_LINK_NOT_ACCESSIBLE",
        "The ChatGPT share fetcher could not access the page",
      );
    }

    if (typeof payload.html !== "string") {
      throw importError(
        "SHARE_LINK_NOT_ACCESSIBLE",
        "The ChatGPT share fetcher returned no HTML",
      );
    }

    assertFinalShareUrl(
      payload.finalUrl ?? validation.normalizedUrl,
      validation.shareId,
    );
    assertHtmlContentType(payload.contentType ?? "");
    assertHtmlSize(payload.html, maxBodyBytes);

    return {
      finalUrl: payload.finalUrl ?? validation.normalizedUrl,
      statusCode: upstreamStatus,
      html: payload.html,
      fetchedAt: new Date().toISOString(),
      contentLength: byteLength(payload.html),
    };
  } catch (error) {
    if (error instanceof ChatGPTImportError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      throw importError(
        "SHARE_FETCH_TIMEOUT",
        "Timed out while fetching the ChatGPT share page",
        error,
      );
    }
    throw importError(
      "SHARE_LINK_NOT_ACCESSIBLE",
      "Unable to use the ChatGPT share fetcher",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function throwForUpstreamStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 404 || status === 410) {
    throw importError("SHARE_LINK_DELETED", "The ChatGPT share link was deleted");
  }
  if (status === 429) {
    throw importError("RATE_LIMITED", "ChatGPT temporarily rate-limited the import");
  }
  throw importError(
    "SHARE_LINK_NOT_ACCESSIBLE",
    "The ChatGPT share link is not accessible",
  );
}

function assertFinalShareUrl(finalUrl: string, expectedShareId: string): void {
  const finalValidation = validateShareUrl(finalUrl);
  if (!finalValidation.valid || finalValidation.shareId !== expectedShareId) {
    throw importError(
      "SHARE_LINK_NOT_ACCESSIBLE",
      "The ChatGPT share link redirected to an unsupported location",
    );
  }
}

function assertHtmlContentType(contentType: string | null): void {
  if (
    contentType &&
    !contentType.toLowerCase().includes("text/html") &&
    !contentType.toLowerCase().includes("application/xhtml+xml")
  ) {
    throw importError(
      "SHARE_RESPONSE_NOT_HTML",
      "The ChatGPT share link did not return HTML",
    );
  }
}

function assertHtmlSize(html: string, maxBodyBytes: number): void {
  if (byteLength(html) > maxBodyBytes) {
    throw importError(
      "SHARE_RESPONSE_TOO_LARGE",
      "The ChatGPT share page exceeded the import size limit",
    );
  }
}

async function readResponseText(
  response: Response,
  maxBodyBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      throw importError(
        "SHARE_RESPONSE_TOO_LARGE",
        "The ChatGPT share page exceeded the import size limit",
      );
    }
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBodyBytes) {
      throw importError(
        "SHARE_RESPONSE_TOO_LARGE",
        "The ChatGPT share page exceeded the import size limit",
      );
    }
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let output = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        throw importError(
          "SHARE_RESPONSE_TOO_LARGE",
          "The ChatGPT share page exceeded the import size limit",
        );
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function extractEnqueuePayloads(html: string): RawEnqueuePayload[] {
  const payloads: RawEnqueuePayload[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const patternIndex = html.indexOf(ENQUEUE_PATTERN, cursor);
    if (patternIndex === -1) break;

    const openParen = html.indexOf("(", patternIndex + ENQUEUE_PATTERN.length);
    if (openParen === -1) {
      throw importError(
        "CHATGPT_PAYLOAD_CHANGED",
        "Found an incomplete ChatGPT payload",
      );
    }

    const parsed = scanFirstArgument(html, openParen);
    payloads.push({
      order: payloads.length,
      rawArgument: parsed.argument,
    });
    cursor = parsed.endOffset + 1;
  }

  if (payloads.length === 0) {
    throw importError(
      "CHATGPT_PAYLOAD_CHANGED",
      "No ChatGPT conversation payload was found",
    );
  }

  return payloads;
}

function scanFirstArgument(
  source: string,
  openParen: number,
): { argument: string; endOffset: number } {
  let index = openParen + 1;
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  const start = index;

  for (; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth === 0) {
      return {
        argument: source.slice(start, index).trim(),
        endOffset: index,
      };
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }
    if (char === "," && depth === 0) {
      return {
        argument: source.slice(start, index).trim(),
        endOffset: index,
      };
    }
  }

  throw importError(
    "CHATGPT_PAYLOAD_CHANGED",
    "Found an unterminated ChatGPT payload",
  );
}

function decodePayload(rawArgument: string, order: number): unknown {
  try {
    const firstPass = parseJavaScriptStringLiteral(rawArgument);
    if (typeof firstPass !== "string") return firstPass;
    const trimmed = firstPass.trim();
    return looksLikeJson(trimmed) ? JSON.parse(trimmed) : firstPass;
  } catch (error) {
    throw importError(
      "CHATGPT_PAYLOAD_CHANGED",
      `Could not decode ChatGPT payload ${order}`,
      error,
    );
  }
}

function parseJavaScriptStringLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const inner = trimmed.slice(1, -1);
    return JSON.parse(`"${inner.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
  }
  return JSON.parse(trimmed);
}

function looksLikeJson(value: string): boolean {
  return (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  );
}

function expandReactFlightPayloads(decodedPayloads: unknown): ReactFlightExpansion {
  return {
    decodedPayloads,
    reactFlightRows: collectReactFlightRows(decodedPayloads),
    reactFlightTables: collectReactFlightTables(decodedPayloads),
  };
}

function collectReactFlightRows(root: unknown): ReactFlightRow[] {
  const rows: ReactFlightRow[] = [];
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (
    queue.length > 0 &&
    visited < MAX_PARSE_NODES &&
    rows.length < MAX_FLIGHT_ROWS
  ) {
    const value = queue.shift();
    visited += 1;

    if (typeof value === "string") {
      const row = parseReactFlightRow(value);
      if (row) {
        rows.push(row);
        queue.push(row.body);
      }
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    queue.push(...(Array.isArray(value) ? value : Object.values(value)));
  }

  return rows;
}

function parseReactFlightRow(value: string): ReactFlightRow | null {
  const match = /^(?:([A-Z])(?=\d))?(\d+):([\s\S]*)$/.exec(value.trim());
  const id = match?.[2];
  const body = match?.[3]?.trim();
  if (!id || !body || !looksJsonValue(body)) return null;

  try {
    return {
      id,
      tag: match?.[1] ?? null,
      body: JSON.parse(body),
    };
  } catch {
    return null;
  }
}

function collectReactFlightTables(root: unknown): unknown[] {
  const tables: unknown[] = [];
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (
    queue.length > 0 &&
    visited < MAX_PARSE_NODES &&
    tables.length < MAX_FLIGHT_ROWS
  ) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.includes("linear_conversation")) {
        tables.push(materializeFlightTable(value));
      }
      queue.push(...value);
    } else {
      queue.push(...Object.values(value));
    }
  }

  return tables;
}

function materializeFlightTable(table: unknown[]): unknown {
  for (const candidate of table) {
    if (!hasIndexedMaterializedKey(candidate, table, "linear_conversation")) {
      continue;
    }

    const materialized = materializeFlightValue(candidate, {
      table,
      visiting: new Set(),
      visited: 0,
    });
    const record = asRecord(materialized);
    if (record && Array.isArray(record.linear_conversation)) {
      return record;
    }
  }

  // Older fixtures expose top-level key/value pairs directly. Keep this as a
  // compatibility fallback, but prefer the indexed conversation object above:
  // live Flight tables may place the schema key after a real title value.
  const output: Record<string, unknown> = {};

  for (let index = 0; index < table.length - 1; index += 1) {
    const key = table[index];
    if (typeof key !== "string" || !MATERIALIZED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }
    output[key] = materializeFlightValue(table[index + 1], {
      table,
      visiting: new Set(),
      visited: 0,
    });
  }

  return output;
}

function hasIndexedMaterializedKey(
  value: unknown,
  table: unknown[],
  targetKey: string,
): boolean {
  const record = asRecord(value);
  if (!record) return false;

  return Object.keys(record).some((rawKey) => {
    const match = /^_(\d+)$/.exec(rawKey);
    if (!match) return rawKey === targetKey;
    const keyIndex = Number.parseInt(match[1] ?? "", 10);
    return table[keyIndex] === targetKey;
  });
}

function materializeFlightValue(
  value: unknown,
  context: {
    table: unknown[];
    visiting: Set<number>;
    visited: number;
  },
): unknown {
  context.visited += 1;
  if (context.visited > MAX_PARSE_NODES) return value;

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    if (value >= context.table.length || context.visiting.has(value)) return value;
    context.visiting.add(value);
    const output = materializeFlightValue(context.table[value], context);
    context.visiting.delete(value);
    return output;
  }

  if (Array.isArray(value)) {
    return value.map((item) => materializeFlightValue(item, context));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawChild] of Object.entries(value)) {
      const keyIndexMatch = /^_(\d+)$/.exec(rawKey);
      const materializedKey = keyIndexMatch
        ? materializeFlightValue(Number.parseInt(keyIndexMatch[1] ?? "", 10), context)
        : rawKey;
      const outputKey =
        typeof materializedKey === "string" ? materializedKey : rawKey;
      if (!MATERIALIZED_OBJECT_KEYS.has(outputKey)) continue;
      output[outputKey] = materializeFlightValue(rawChild, context);
    }
    return output;
  }

  return value;
}

function looksJsonValue(value: string): boolean {
  return (
    value.startsWith("{") ||
    value.startsWith("[") ||
    value.startsWith('"') ||
    value === "null" ||
    value === "true" ||
    value === "false" ||
    /^-?\d/.test(value)
  );
}

function dereference(root: unknown): unknown {
  const context: DereferenceContext = {
    refTable: buildReferenceTable(root),
    visiting: new Set(),
    visitedNodes: 0,
    maxDepth: 100,
    maxNodes: MAX_PARSE_NODES,
  };
  return dereferenceValue(root, context, 0);
}

function buildReferenceTable(root: unknown): Map<string, unknown> {
  const table = new Map<string, unknown>();
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      if (/^_\d+$/.test(key)) table.set(key, child);
      queue.push(child);
    }
  }

  return table;
}

function dereferenceValue(
  value: unknown,
  context: DereferenceContext,
  depth: number,
): unknown {
  context.visitedNodes += 1;
  if (context.visitedNodes > context.maxNodes || depth > context.maxDepth) {
    return value;
  }

  if (typeof value === "string" && /^_\d+$/.test(value)) {
    const resolved = context.refTable.get(value);
    if (resolved === undefined) return value;
    if (context.visiting.has(value)) return null;
    context.visiting.add(value);
    const output = dereferenceValue(resolved, context, depth + 1);
    context.visiting.delete(value);
    return output;
  }

  if (Array.isArray(value)) {
    return value.map((item) => dereferenceValue(item, context, depth + 1));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = dereferenceValue(child, context, depth + 1);
    }
    return output;
  }

  return value;
}

function restoreConversation(root: unknown): RawChatGPTMessage[] {
  const candidates = findAllByKey(root, "linear_conversation").filter(
    Array.isArray,
  );
  if (candidates.length === 0) {
    throw importError(
      "CONVERSATION_NOT_FOUND",
      "No linear ChatGPT conversation was found",
    );
  }

  const restoredCandidates = candidates
    .map((candidate) =>
      candidate
        .map((item) => toRawMessage(item))
        .filter((message): message is RawChatGPTMessage => message !== null),
    )
    .filter((candidate) => candidate.length > 0)
    .sort((left, right) => scoreRawMessages(right) - scoreRawMessages(left));

  const best = restoredCandidates[0];
  if (!best) {
    throw importError(
      "CONVERSATION_NOT_FOUND",
      "The ChatGPT conversation contained no message records",
    );
  }
  return best;
}

function scoreRawMessages(messages: RawChatGPTMessage[]): number {
  return messages.reduce((score, message) => {
    const role = message.role ?? message.authorRole;
    const roleScore = role === "user" || role === "assistant" ? 10_000 : 0;
    return score + roleScore + extractContentText(message.content).length;
  }, 0);
}

function findAllByKey(root: unknown, targetKey: string): unknown[] {
  const matches: unknown[] = [];
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_PARSE_NODES) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (!Array.isArray(value) && targetKey in value) {
      matches.push((value as Record<string, unknown>)[targetKey]);
    }
    queue.push(...(Array.isArray(value) ? value : Object.values(value)));
  }

  return matches;
}

function toRawMessage(value: unknown): RawChatGPTMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : "content" in record || "author" in record || "role" in record
        ? record
        : null;
  if (!message) return null;

  const author = asRecord(message.author);
  const metadata = asRecord(message.metadata);
  const content = asRecord(message.content);
  return {
    id: nonEmptyString(message.id),
    role:
      nonEmptyString(message.role) ??
      nonEmptyString(author?.role) ??
      nonEmptyString(message.authorRole),
    authorRole: nonEmptyString(author?.role),
    authorName: nonEmptyString(author?.name),
    recipient: nonEmptyString(message.recipient),
    channel: nonEmptyString(message.channel),
    isVisuallyHidden:
      message.is_visually_hidden_from_conversation === true ||
      metadata?.is_visually_hidden_from_conversation === true,
    metadata: metadata ?? undefined,
    content: message.content,
    contentType: nonEmptyString(content?.content_type),
    createTime: finiteNumberOrNull(message.create_time ?? message.createTime),
  };
}

function normalizeMessages(rawMessages: RawChatGPTMessage[]): NormalizedMessageResult {
  const messages: ChatGPTMessage[] = [];
  const emittedArtifacts = new Set<string>();
  let sourceMessageCount = 0;
  let omittedInternalCount = 0;
  let preservedEventCount = 0;
  let unsupportedContentCount = 0;
  let privateArtifactReferenceRedactedCount = 0;
  let richReferenceMarkerOmittedCount = 0;

  for (const [rawIndex, rawMessage] of rawMessages.entries()) {
    const role = rawMessage.role ?? rawMessage.authorRole;
    const extractedText = extractContentText(rawMessage.content)
      .replace(/\r\n?/g, "\n")
      .trim();
    const richReferenceSanitized = sanitizeRichReferenceMarkers(extractedText);
    const sanitizedText = sanitizePrivateArtifactReferences(
      richReferenceSanitized.text,
    );
    const text = sanitizedText.text;
    richReferenceMarkerOmittedCount += richReferenceSanitized.omittedCount;
    privateArtifactReferenceRedactedCount += sanitizedText.redactedCount;
    let sourceIndex: number | null = null;
    const internalAssistantMessage =
      role === "assistant" && isInternalAssistantMessage(rawMessage);
    let internalMessageOmitted = false;

    // sourceIndex intentionally matches the v1 adapter's user/assistant +
    // nonblank index space. Golden cutoffs can therefore be applied before
    // semantic sanitization without being invalidated by omitted tool calls.
    if ((role === "user" || role === "assistant") && extractedText) {
      sourceMessageCount += 1;
      sourceIndex = sourceMessageCount;

      if (internalAssistantMessage) {
        omittedInternalCount += 1;
        internalMessageOmitted = true;
      } else if (text) {
        messages.push({
          id: rawMessage.id ?? `message-${sourceIndex}`,
          index: messages.length + 1,
          sourceIndex,
          role,
          kind: "text",
          text,
          createdAt: epochSecondsToIso(rawMessage.createTime),
        });
      }
    } else if (internalAssistantMessage) {
      omittedInternalCount += 1;
      internalMessageOmitted = true;
    } else if (text && role !== "user") {
      omittedInternalCount += 1;
    }

    const artifactEvents =
      (role === "assistant" || role === "tool") &&
      !rawMessage.isVisuallyHidden
        ? extractConfirmedArtifactEvents(rawMessage)
        : [];
    let eventOrdinal = 0;
    for (const event of artifactEvents) {
      if (emittedArtifacts.has(event.key)) continue;
      emittedArtifacts.add(event.key);
      eventOrdinal += 1;
      messages.push({
        id:
          `${rawMessage.id ?? "message"}-${rawIndex + 1}-` +
          `${event.type}-${eventOrdinal}`,
        index: messages.length + 1,
        sourceIndex: sourceMessageCount > 0 ? sourceMessageCount : null,
        role: "assistant",
        kind: "event",
        eventType: event.type,
        text: event.text,
        createdAt: epochSecondsToIso(rawMessage.createTime),
      });
      preservedEventCount += 1;
    }

    const unsupportedVisibleContent =
      (role === "user" || role === "assistant") &&
      !internalMessageOmitted &&
      ((!text && hasNonTextContent(rawMessage.content)) ||
        hasArtifactPointer(rawMessage.content));
    const unsupportedToolArtifact =
      role === "tool" &&
      !rawMessage.isVisuallyHidden &&
      hasArtifactPointer(rawMessage.content);
    if (
      artifactEvents.length === 0 &&
      (unsupportedVisibleContent || unsupportedToolArtifact)
    ) {
      unsupportedContentCount += 1;
    }
  }

  return {
    messages,
    sourceMessageCount,
    omittedInternalCount,
    preservedEventCount,
    unsupportedContentCount,
    privateArtifactReferenceRedactedCount,
    richReferenceMarkerOmittedCount,
  };
}

function sanitizeRichReferenceMarkers(value: string): {
  text: string;
  omittedCount: number;
} {
  let omittedCount = 0;
  const marker = /\uE200[a-z][a-z0-9_-]{0,63}\uE202[^\uE201]{0,10000}\uE201/giu;
  const text = value.replace(marker, () => {
    omittedCount += 1;
    return "";
  });
  return { text: text.trim(), omittedCount };
}

function sanitizePrivateArtifactReferences(value: string): {
  text: string;
  redactedCount: number;
} {
  let redactedCount = 0;
  const markdownTarget =
    /\[([^\]\n]{1,500})\]\(\s*(?:sandbox:[^\s)]*|file-service:\/\/[^\s)]+|\/mnt\/data\/[^\s)]+|\/home\/oai\/share\/[^\s)]+)\s*\)/gi;
  const rawTarget =
    /(?:sandbox:[^\s)>\]]*|file-service:\/\/[^\s)>\]]+|\/mnt\/data\/[^\s)>\]]+|\/home\/oai\/share\/[^\s)>\]]+)/gi;
  const withoutMarkdownTargets = value.replace(
    markdownTarget,
    (_match, label: string) => {
      redactedCount += 1;
      return `${label.trim()} [private artifact link removed]`;
    },
  );
  const text = withoutMarkdownTargets.replace(rawTarget, () => {
    redactedCount += 1;
    return "[private artifact link removed]";
  });
  return { text: text.trim(), redactedCount };
}

function isInternalAssistantMessage(message: RawChatGPTMessage): boolean {
  if (message.isVisuallyHidden) return true;

  const recipient = message.recipient?.trim().toLowerCase();
  if (recipient && !VISIBLE_ASSISTANT_RECIPIENTS.has(recipient)) return true;

  const contentType = message.contentType?.trim().toLowerCase();
  if (contentType && INTERNAL_CONTENT_TYPES.has(contentType)) return true;

  const metadata = message.metadata;
  if (
    metadata &&
    (hasMeaningfulValue(metadata.tool_calls) ||
      hasMeaningfulValue(metadata.tool_call_id))
  ) {
    return true;
  }

  return false;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function extractConfirmedArtifactEvents(
  message: RawChatGPTMessage,
): ArtifactEvent[] {
  const events: ArtifactEvent[] = [];
  const messageRole = message.role ?? message.authorRole;
  const imageTitle = cleanTitle(message.metadata?.image_gen_title);
  const queue: unknown[] = [message.content, message.metadata];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < 512) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    const contentType = nonEmptyString(record.content_type)?.toLowerCase();
    const mimeType = nonEmptyString(record.mime_type)?.toLowerCase();
    const assetPointer = nonEmptyString(record.asset_pointer);
    const isImage =
      contentType === "image_asset_pointer" ||
      mimeType?.startsWith("image/") === true;

    if (assetPointer && isImage && imageTitle) {
      events.push({
        type: "image_generated",
        key: `image:${assetPointer}`,
        text: `[생성된 이미지: ${imageTitle}]`,
      });
    } else {
      const fileKey =
        nonEmptyString(record.file_id) ??
        nonEmptyString(record.download_url) ??
        nonEmptyString(record.sandbox_path) ??
        (assetPointer && !isImage ? assetPointer : undefined);
      const isFile =
        messageRole === "tool" &&
        (contentType === "file" ||
          contentType === "file_asset_pointer" ||
          contentType === "tether_file");

      if (fileKey && isFile) {
        const fileName = safeFileName(record.file_name ?? record.filename);
        events.push({
          type: "file_created",
          key: `file:${fileKey}`,
          text: fileName
            ? `[생성된 파일: ${fileName}]`
            : "[생성된 파일이 대화에 포함됨]",
        });
      }
    }

    queue.push(...Object.values(record));
  }

  return events;
}

function safeFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const baseName = value.split(/[\\/]/).at(-1) ?? "";
  const normalized = baseName
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, 120).join("");
}

function hasNonTextContent(content: unknown): boolean {
  const queue: unknown[] = [content];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < 256) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    const contentType = nonEmptyString(record.content_type)?.toLowerCase();
    if (
      (contentType && contentType !== "text" && contentType !== "multimodal_text") ||
      typeof record.asset_pointer === "string" ||
      typeof record.file_id === "string"
    ) {
      return true;
    }
    queue.push(...Object.values(record));
  }

  return false;
}

function hasArtifactPointer(content: unknown): boolean {
  const queue: unknown[] = [content];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < 256) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    if (
      typeof record.asset_pointer === "string" ||
      typeof record.file_id === "string"
    ) {
      return true;
    }
    queue.push(...Object.values(record));
  }

  return false;
}

function extractContentText(content: unknown): string {
  return extractTextValue(content, 0)
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function extractTextValue(value: unknown, depth: number): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.parts)) {
    const parts = record.parts.flatMap((part) =>
      extractTextValue(part, depth + 1),
    );
    if (parts.length > 0) return parts;
  }
  if (typeof record.text === "string") return [record.text];
  return [];
}

function extractConversationTitle(
  root: unknown,
  html: string,
  messages: ChatGPTMessage[],
): TitleExtractionResult {
  const payloadTitle = findTitleInPayload(root);
  if (payloadTitle) return { title: payloadTitle, source: "payload" };

  const htmlTitleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  const htmlTitle = cleanHtmlDocumentTitle(htmlTitleMatch?.[1] ?? "");
  if (htmlTitle && !isGenericTitle(htmlTitle)) {
    return { title: htmlTitle, source: "html" };
  }

  const firstUserMessage = messages.find((message) => message.role === "user");
  const firstUserTitle = cleanTitle(firstUserMessage?.text.split("\n")[0] ?? "");
  return firstUserTitle
    ? { title: firstUserTitle, source: "first_user_message" }
    : { title: null, source: "none" };
}

function findTitleInPayload(root: unknown): string | null {
  return findTitleInConversationRecord(root);
}

function findTitleInConversationRecord(root: unknown): string | null {
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_PARSE_NODES) {
    const value = queue.shift();
    visited += 1;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const ownsConversation = Array.isArray(record.linear_conversation);
      const wrapsConversation = Object.values(record).some((child) => {
        const childRecord = asRecord(child);
        return Boolean(
          childRecord && Array.isArray(childRecord.linear_conversation),
        );
      });
      if (ownsConversation || wrapsConversation) {
        for (const key of ["conversation_title", "title"]) {
          const title = cleanTitle(record[key]);
          if (title && !isGenericTitle(title)) return title;
        }
      }
    }

    queue.push(...(Array.isArray(value) ? value : Object.values(value)));
  }

  return null;
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = decodeBasicHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const characters = Array.from(normalized);
  return characters.length > 120
    ? `${characters.slice(0, 117).join("")}…`
    : normalized;
}

function cleanHtmlDocumentTitle(value: unknown): string | null {
  const title = cleanTitle(value);
  if (!title) return null;
  return cleanTitle(title.replace(/^ChatGPT\s*[-|:]\s*/i, ""));
}

function isGenericTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    /^(chatgpt|chatgpt shared link|shared chat|openai|new chat)$/i.test(
      normalized,
    ) ||
    TITLE_SCHEMA_TOKENS.has(normalized)
  );
}

function buildImportWarnings(
  normalized: NormalizedMessageResult,
  title: TitleExtractionResult,
): ChatGPTShareImportResult["warnings"] {
  const warnings: ChatGPTShareImportResult["warnings"] = [];

  if (normalized.omittedInternalCount > 0) {
    warnings.push({
      code: "INTERNAL_MESSAGES_OMITTED",
      message: `${normalized.omittedInternalCount}개의 내부 도구·실행 메시지를 노트 입력에서 제외했습니다.`,
    });
  }
  if (normalized.preservedEventCount > 0) {
    warnings.push({
      code: "NON_TEXT_EVENTS_PRESERVED",
      message: `${normalized.preservedEventCount}개의 확인된 이미지·파일 결과를 간단한 이벤트로 보존했습니다.`,
    });
  }
  if (normalized.unsupportedContentCount > 0) {
    warnings.push({
      code: "UNSUPPORTED_CONTENT_OMITTED",
      message: `${normalized.unsupportedContentCount}개의 지원하지 않는 비텍스트 내용을 제외했습니다.`,
    });
  }
  if (normalized.privateArtifactReferenceRedactedCount > 0) {
    warnings.push({
      code: "PRIVATE_ARTIFACT_REFERENCES_REDACTED",
      message: `${normalized.privateArtifactReferenceRedactedCount}개의 비공개 로컬 artifact 경로를 안전한 표시로 대체했습니다.`,
    });
  }
  if (normalized.richReferenceMarkerOmittedCount > 0) {
    warnings.push({
      code: "RICH_REFERENCE_MARKERS_OMITTED",
      message: `${normalized.richReferenceMarkerOmittedCount}개의 ChatGPT 내부 인용·참조 마커를 표시 텍스트에서 제거했습니다.`,
    });
  }
  if (title.source !== "payload") {
    warnings.push({
      code: "TITLE_FALLBACK_USED",
      message: "공유 payload의 제목을 사용할 수 없어 안전한 대체 제목을 사용했습니다.",
    });
  }

  return warnings;
}

function decodeBasicHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      const lower = token.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      const radix = lower.startsWith("#x") ? 16 : 10;
      const digits = lower.replace(/^#x?/, "");
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function epochSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function importError(
  code: ChatGPTImportErrorCode,
  message: string,
  causeValue?: unknown,
): ChatGPTImportError {
  return new ChatGPTImportError(code, message, statusForErrorCode(code), causeValue);
}

function statusForErrorCode(code: ChatGPTImportErrorCode): number {
  switch (code) {
    case "INVALID_REQUEST":
    case "INVALID_SHARE_URL":
      return 400;
    case "SHARE_LINK_DELETED":
      return 404;
    case "SHARE_FETCH_TIMEOUT":
      return 504;
    case "SHARE_RESPONSE_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
      return 429;
    case "SHARE_FETCH_MISCONFIGURED":
    case "IMPORT_FAILED":
      return 500;
    case "SHARE_LINK_NOT_ACCESSIBLE":
    case "SHARE_RESPONSE_NOT_HTML":
    case "CHATGPT_PAYLOAD_CHANGED":
    case "CONVERSATION_NOT_FOUND":
      return 502;
    case "NO_VISIBLE_MESSAGES":
      return 422;
  }
}
