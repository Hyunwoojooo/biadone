import { z } from "zod";

import type { NotionConfig } from "./config";
import {
  readStoredNotionTokens,
  writeStoredNotionSnapshot,
  writeStoredNotionTokens
} from "./localStore";
import { refreshNotionAccessToken } from "./oauth";
import type {
  NotionResourceSignal,
  NotionSnapshot,
  StoredNotionTokens
} from "./types";

const MAX_NOTION_RESOURCES = 200;
const NOTION_PAGE_SIZE = 100;

const pageSearchResultSchema = z.object({
  object: z.literal("page"),
  id: z.string().min(1),
  created_time: z.string().datetime(),
  last_edited_time: z.string().datetime(),
  in_trash: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  properties: z.record(z.unknown()).optional().default({})
});

const dataSourceSearchResultSchema = z.object({
  object: z.literal("data_source"),
  id: z.string().min(1),
  created_time: z.string().datetime(),
  last_edited_time: z.string().datetime(),
  in_trash: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  title: z.array(z.unknown()).optional().default([])
});

const searchResponseSchema = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
  request_status: z
    .object({
      incomplete_reason: z.string().nullable().optional()
    })
    .optional()
});

export async function fetchAndStoreNotionSnapshot(
  config: NotionConfig,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    cwd?: string;
    maxResources?: number;
  } = {}
): Promise<NotionSnapshot> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const maxResources = Math.max(
    1,
    Math.min(options.maxResources ?? MAX_NOTION_RESOURCES, 1_000)
  );
  const storedTokens = await readStoredNotionTokens(cwd);
  if (!storedTokens) {
    throw new NotionApiError("NOT_CONNECTED");
  }

  let tokens = storedTokens;
  let cursor: string | undefined;
  let truncated = false;
  const seenCursors = new Set<string>();
  const resources: NotionResourceSignal[] = [];

  while (resources.length < maxResources) {
    let response = await fetchSearchPage({
      accessToken: tokens.accessToken,
      apiVersion: config.apiVersion,
      startCursor: cursor,
      fetchImpl
    });

    if (response.status === 401) {
      tokens = await refreshTokensOrThrow(
        config,
        tokens,
        fetchImpl,
        cwd
      );
      response = await fetchSearchPage({
        accessToken: tokens.accessToken,
        apiVersion: config.apiVersion,
        startCursor: cursor,
        fetchImpl
      });
    }

    if (response.status === 401) {
      throw new NotionApiError("REAUTHORIZATION_REQUIRED");
    }
    if (!response.ok) {
      throw new NotionApiError("SEARCH_REQUEST_FAILED");
    }

    const page = await parseSearchPage(response);
    for (const result of page.results) {
      const normalized = normalizeNotionResource(result);
      if (!normalized) continue;
      resources.push(normalized);
      if (resources.length >= maxResources) break;
    }

    if (page.request_status?.incomplete_reason) {
      truncated = true;
    }
    if (!page.has_more) break;
    if (resources.length >= maxResources) {
      truncated = true;
      break;
    }
    if (!page.next_cursor || seenCursors.has(page.next_cursor)) {
      throw new NotionApiError("SEARCH_RESPONSE_INVALID");
    }
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }

  const snapshot: NotionSnapshot = {
    schemaVersion: "notion-snapshot-v1",
    apiVersion: config.apiVersion,
    fetchedAt: now.toISOString(),
    workspaceId: tokens.workspaceId,
    workspaceName: tokens.workspaceName,
    truncated,
    resources: resources.sort(compareNotionResources)
  };
  await writeStoredNotionSnapshot(snapshot, cwd);
  return snapshot;
}

export function normalizeNotionResource(
  value: unknown
): NotionResourceSignal | null {
  const page = pageSearchResultSchema.safeParse(value);
  if (page.success) {
    if (page.data.in_trash || page.data.archived) return null;
    return {
      id: page.data.id,
      source: "notion",
      kind: "page",
      title: extractPageTitle(page.data.properties) || "제목 없는 페이지",
      createdAt: page.data.created_time,
      lastEditedAt: page.data.last_edited_time
    };
  }

  const dataSource = dataSourceSearchResultSchema.safeParse(value);
  if (dataSource.success) {
    if (dataSource.data.in_trash || dataSource.data.archived) return null;
    return {
      id: dataSource.data.id,
      source: "notion",
      kind: "data_source",
      title:
        extractPlainText(dataSource.data.title) ||
        "이름 없는 데이터 소스",
      createdAt: dataSource.data.created_time,
      lastEditedAt: dataSource.data.last_edited_time
    };
  }

  return null;
}

export function compareNotionResources(
  left: NotionResourceSignal,
  right: NotionResourceSignal
): number {
  return (
    Date.parse(right.lastEditedAt) - Date.parse(left.lastEditedAt) ||
    left.id.localeCompare(right.id)
  );
}

export class NotionApiError extends Error {
  constructor(
    readonly code:
      | "NOT_CONNECTED"
      | "REAUTHORIZATION_REQUIRED"
      | "SEARCH_REQUEST_FAILED"
      | "SEARCH_RESPONSE_INVALID"
  ) {
    super(code);
    this.name = "NotionApiError";
  }
}

async function fetchSearchPage({
  accessToken,
  apiVersion,
  startCursor,
  fetchImpl
}: {
  accessToken: string;
  apiVersion: string;
  startCursor?: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  return fetchImpl("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": apiVersion
    },
    body: JSON.stringify({
      page_size: NOTION_PAGE_SIZE,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      },
      ...(startCursor ? { start_cursor: startCursor } : {})
    }),
    cache: "no-store"
  });
}

async function parseSearchPage(
  response: Response
): Promise<z.infer<typeof searchResponseSchema>> {
  try {
    return searchResponseSchema.parse(await response.json());
  } catch {
    throw new NotionApiError("SEARCH_RESPONSE_INVALID");
  }
}

async function refreshTokensOrThrow(
  config: NotionConfig,
  tokens: StoredNotionTokens,
  fetchImpl: typeof fetch,
  cwd: string
): Promise<StoredNotionTokens> {
  try {
    const refreshed = await refreshNotionAccessToken(
      config,
      tokens,
      fetchImpl
    );
    await writeStoredNotionTokens(refreshed, cwd);
    return refreshed;
  } catch {
    throw new NotionApiError("REAUTHORIZATION_REQUIRED");
  }
}

function extractPageTitle(properties: Record<string, unknown>): string {
  for (const property of Object.values(properties)) {
    if (!property || typeof property !== "object") continue;
    const candidate = property as {
      type?: unknown;
      title?: unknown;
    };
    if (candidate.type !== "title" || !Array.isArray(candidate.title)) {
      continue;
    }
    return extractPlainText(candidate.title);
  }
  return "";
}

function extractPlainText(items: unknown[]): string {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const plainText = (item as { plain_text?: unknown }).plain_text;
      return typeof plainText === "string" ? plainText : "";
    })
    .join("")
    .trim();
}
