import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NOTION_REDIRECT_URI,
  loadNotionConfig,
  NOTION_API_VERSION,
  type NotionConfig
} from "../src/connectors/notion/config";
import {
  deleteStoredNotionConnection,
  notionStoreGeneration,
  notionSnapshotMatchesTokens,
  readStoredNotionSnapshot,
  readStoredNotionTokens,
  replaceStoredNotionConnection,
  writeStoredNotionSnapshot,
  writeStoredNotionTokens
} from "../src/connectors/notion/localStore";
import {
  fetchAndStoreNotionSnapshot,
  MAX_NOTION_PAGES,
  normalizeNotionResource
} from "../src/connectors/notion/notionApi";
import {
  createNotionAuthorizationUrl,
  createNotionOAuthState,
  exchangeNotionAuthorizationCode,
  notionOAuthStatesMatch,
  revokeNotionToken
} from "../src/connectors/notion/oauth";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
});

describe("Notion local connector", () => {
  it("loads Public connection OAuth credentials from private environment values", () => {
    expect(
      loadNotionConfig({
        NODE_ENV: "test",
        NOTION_OAUTH_CLIENT_ID: "notion-client",
        NOTION_OAUTH_CLIENT_SECRET: "notion-secret",
        NOTION_OAUTH_REDIRECT_URI: DEFAULT_NOTION_REDIRECT_URI
      } as NodeJS.ProcessEnv)
    ).toMatchObject({
      ok: true,
      config: {
        clientId: "notion-client",
        clientSecret: "notion-secret",
        redirectUri: DEFAULT_NOTION_REDIRECT_URI,
        apiVersion: NOTION_API_VERSION
      }
    });

    expect(
      loadNotionConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)
    ).toMatchObject({
      ok: false,
      reason: "missing"
    });
  });

  it("creates a user-level authorization request with state", () => {
    const state = createNotionOAuthState();
    const authorizationUrl = new URL(
      createNotionAuthorizationUrl(testConfig(), state)
    );

    expect(authorizationUrl.origin).toBe("https://api.notion.com");
    expect(authorizationUrl.pathname).toBe("/v1/oauth/authorize");
    expect(authorizationUrl.searchParams.get("owner")).toBe("user");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      DEFAULT_NOTION_REDIRECT_URI
    );
    expect(authorizationUrl.searchParams.get("state")).toBe(state);
    expect(notionOAuthStatesMatch(state, state)).toBe(true);
    expect(notionOAuthStatesMatch(state, `${state}x`)).toBe(false);
  });

  it("exchanges an authorization code with Basic auth and the pinned API version", async () => {
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(input.toString()).toBe(
          "https://api.notion.com/v1/oauth/token"
        );
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from(
            "notion-client:notion-secret"
          ).toString("base64")}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_API_VERSION
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          grant_type: "authorization_code",
          code: "temporary-code",
          redirect_uri: DEFAULT_NOTION_REDIRECT_URI
        });
        return notionTokenResponse();
      }
    ) as unknown as typeof fetch;

    await expect(
      exchangeNotionAuthorizationCode(
        testConfig(),
        "temporary-code",
        fetchImpl
      )
    ).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "bearer",
      botId: "bot-id",
      workspaceId: "workspace-id",
      workspaceName: "blabase 테스트"
    });
  });

  it("paginates Search and stores only minimal page and data-source metadata", async () => {
    const cwd = await createTempDirectory();
    await writeStoredNotionTokens(storedTokens(), cwd);

    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer access-token",
          "Notion-Version": NOTION_API_VERSION
        });
        const body = JSON.parse(String(init?.body)) as {
          start_cursor?: string;
        };
        if (!body.start_cursor) {
          return searchResponse({
            has_more: true,
            next_cursor: "next-page",
            results: [
              {
                object: "page",
                id: "page-1",
                created_time: "2026-07-20T00:00:00.000Z",
                last_edited_time: "2026-07-25T02:00:00.000Z",
                in_trash: false,
                properties: {
                  Name: {
                    type: "title",
                    title: [{ plain_text: "주간 계획" }]
                  },
                  PrivateNotes: {
                    type: "rich_text",
                    rich_text: [{ plain_text: "저장되면 안 되는 본문" }]
                  }
                }
              }
            ]
          });
        }
        expect(body.start_cursor).toBe("next-page");
        return searchResponse({
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "data_source",
              id: "data-source-1",
              created_time: "2026-07-19T00:00:00.000Z",
              last_edited_time: "2026-07-24T03:00:00.000Z",
              in_trash: false,
              title: [{ plain_text: "할 일 데이터베이스" }],
              properties: {
                Owner: { type: "people" }
              }
            }
          ]
        });
      }
    ) as unknown as typeof fetch;

    const snapshot = await fetchAndStoreNotionSnapshot(testConfig(), {
      now: new Date("2026-07-25T04:00:00.000Z"),
      fetchImpl,
      cwd
    });

    expect(snapshot.resources).toEqual([
      {
        id: "page-1",
        source: "notion",
        kind: "page",
        title: "주간 계획",
        createdAt: "2026-07-20T00:00:00.000Z",
        lastEditedAt: "2026-07-25T02:00:00.000Z"
      },
      {
        id: "data-source-1",
        source: "notion",
        kind: "data_source",
        title: "할 일 데이터베이스",
        createdAt: "2026-07-19T00:00:00.000Z",
        lastEditedAt: "2026-07-24T03:00:00.000Z"
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const storedText = await readFile(
      join(cwd, ".local", "connectors", "notion", "snapshot.json"),
      "utf8"
    );
    expect(storedText).not.toContain("저장되면 안 되는 본문");
    expect(storedText).not.toContain("PrivateNotes");
    expect(storedText).not.toContain("Owner");
  });

  it("caps pagination even when every page contains only unsupported records", async () => {
    const cwd = await createTempDirectory();
    await writeStoredNotionTokens(storedTokens(), cwd);
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      return searchResponse({
        has_more: true,
        next_cursor: `cursor-${page}`,
        results: [
          {
            object: "unsupported",
            id: `unsupported-${page}`
          }
        ]
      });
    }) as unknown as typeof fetch;

    const snapshot = await fetchAndStoreNotionSnapshot(testConfig(), {
      fetchImpl,
      cwd
    });

    expect(fetchImpl).toHaveBeenCalledTimes(MAX_NOTION_PAGES);
    expect(snapshot.resources).toEqual([]);
    expect(snapshot.truncated).toBe(true);
  });

  it("refreshes and atomically replaces both tokens after a 401", async () => {
    const cwd = await createTempDirectory();
    await writeStoredNotionTokens(storedTokens(), cwd);
    let requestNumber = 0;

    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        requestNumber += 1;
        const url = input.toString();
        if (url.endsWith("/v1/search") && requestNumber === 1) {
          return new Response(
            JSON.stringify({ code: "unauthorized" }),
            { status: 401 }
          );
        }
        if (url.endsWith("/v1/oauth/token")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            grant_type: "refresh_token",
            refresh_token: "refresh-token"
          });
          return notionTokenResponse({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token"
          });
        }
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer new-access-token"
        });
        return searchResponse({
          has_more: false,
          next_cursor: null,
          results: []
        });
      }
    ) as unknown as typeof fetch;

    await fetchAndStoreNotionSnapshot(testConfig(), {
      fetchImpl,
      cwd
    });

    expect(await readStoredNotionTokens(cwd)).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("ignores trashed resources and revokes only the access token", async () => {
    expect(
      normalizeNotionResource({
        object: "page",
        id: "trashed-page",
        created_time: "2026-07-20T00:00:00.000Z",
        last_edited_time: "2026-07-25T02:00:00.000Z",
        in_trash: true,
        properties: {}
      })
    ).toBeNull();

    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "access-token"
        });
        return new Response(
          JSON.stringify({
            request_id: "request-id"
          }),
          { status: 200 }
        );
      }
    ) as unknown as typeof fetch;

    await revokeNotionToken(testConfig(), "access-token", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not recreate connector state when disconnect wins an in-flight sync", async () => {
    const cwd = await createTempDirectory();
    await writeStoredNotionTokens(storedTokens(), cwd);

    let releaseResponse!: () => void;
    let markRequestStarted!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      markRequestStarted();
      await responseGate;
      return searchResponse({
        has_more: false,
        next_cursor: null,
        results: []
      });
    }) as unknown as typeof fetch;

    const refresh = fetchAndStoreNotionSnapshot(testConfig(), {
      now: new Date("2026-07-25T00:00:00.000Z"),
      fetchImpl,
      cwd
    });
    await requestStarted;

    await deleteStoredNotionConnection(cwd);
    releaseResponse();

    await expect(refresh).rejects.toThrow(
      "Notion connector state changed during operation."
    );
    await expect(readStoredNotionTokens(cwd)).resolves.toBeNull();
    await expect(readStoredNotionSnapshot(cwd)).resolves.toBeNull();
  });

  it("clears the old workspace snapshot and rejects its in-flight generation on OAuth replacement", async () => {
    const cwd = await createTempDirectory();
    const oldTokens = storedTokens();
    await writeStoredNotionTokens(oldTokens, cwd);
    await writeStoredNotionSnapshot(notionSnapshot(), cwd);
    const previousGeneration = notionStoreGeneration(cwd);
    const replacementTokens = {
      ...oldTokens,
      accessToken: "replacement-access-token",
      refreshToken: "replacement-refresh-token",
      workspaceId: "replacement-workspace",
      workspaceName: "replacement"
    };

    await replaceStoredNotionConnection(replacementTokens, cwd);

    expect(notionStoreGeneration(cwd)).toBe(previousGeneration + 1);
    await expect(readStoredNotionTokens(cwd)).resolves.toEqual(
      replacementTokens
    );
    await expect(readStoredNotionSnapshot(cwd)).resolves.toBeNull();
    await expect(
      writeStoredNotionSnapshot(
        {
          ...notionSnapshot(),
          fetchedAt: "2026-07-25T02:00:00.000Z"
        },
        cwd,
        previousGeneration
      )
    ).rejects.toThrow(
      "Notion connector state changed during operation."
    );
  });

  it("does not accept a snapshot from a different Notion workspace", () => {
    expect(
      notionSnapshotMatchesTokens(notionSnapshot(), {
        ...storedTokens(),
        workspaceId: "different-workspace"
      })
    ).toBe(false);
    expect(
      notionSnapshotMatchesTokens(notionSnapshot(), storedTokens())
    ).toBe(true);
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blabase-notion-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(): NotionConfig {
  return {
    clientId: "notion-client",
    clientSecret: "notion-secret",
    authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
    tokenEndpoint: "https://api.notion.com/v1/oauth/token",
    revokeEndpoint: "https://api.notion.com/v1/oauth/revoke",
    redirectUri: DEFAULT_NOTION_REDIRECT_URI,
    apiVersion: NOTION_API_VERSION
  };
}

function storedTokens() {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "bearer",
    botId: "bot-id",
    workspaceId: "workspace-id",
    workspaceName: "blabase 테스트"
  };
}

function notionSnapshot() {
  return {
    schemaVersion: "notion-snapshot-v1" as const,
    apiVersion: NOTION_API_VERSION,
    fetchedAt: "2026-07-25T01:00:00.000Z",
    workspaceId: "workspace-id",
    workspaceName: "blabase 테스트",
    truncated: false,
    resources: []
  };
}

function notionTokenResponse(
  overrides: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      bot_id: "bot-id",
      workspace_id: "workspace-id",
      workspace_name: "blabase 테스트",
      ...overrides
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}

function searchResponse(body: {
  results: unknown[];
  has_more: boolean;
  next_cursor: string | null;
}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
