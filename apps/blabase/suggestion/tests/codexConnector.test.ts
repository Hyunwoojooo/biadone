import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discoverAndStoreCodexScopes,
  fetchAndStoreCodexSnapshot,
  queryCodexThreadsViaAppServer,
  selectStoredCodexScopes
} from "../src/connectors/codex/appServer";
import {
  codexLocalDirectory,
  deleteStoredCodexConnection,
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../src/connectors/codex/localStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
});

describe("Codex local connector", () => {
  it("discovers only recent absolute project scopes and stores them privately", async () => {
    const cwd = await createTempDirectory();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const queryThreads = vi.fn(async () => ({
      codexVersion: "codex-cli 0.145.0",
      result: {
        data: [
          thread({
            id: "recent-a",
            cwd: "/Users/example/work/alpha",
            updatedAt: "2026-07-25T10:00:00.000Z"
          }),
          thread({
            id: "recent-b",
            cwd: "/Volumes/team/alpha",
            updatedAt: "2026-07-24T10:00:00.000Z"
          }),
          thread({
            id: "old",
            cwd: "/Users/example/work/old-project",
            updatedAt: "2026-06-01T10:00:00.000Z"
          }),
          thread({
            id: "relative",
            cwd: "../relative-project",
            updatedAt: "2026-07-25T10:00:00.000Z"
          })
        ],
        nextCursor: null
      }
    }));

    const config = await discoverAndStoreCodexScopes({
      cwd,
      now,
      queryThreads
    });

    expect(queryThreads).toHaveBeenCalledOnce();
    expect(queryThreads).toHaveBeenCalledWith({
      cursor: null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "appServer", "exec"],
      useStateDbOnly: true
    });
    expect(config.scopes).toHaveLength(2);
    expect(config.scopes.map((scope) => scope.queryPath)).toEqual([
      "/Users/example/work/alpha",
      "/Volumes/team/alpha"
    ]);
    expect(config.scopes.every((scope) =>
      /^alpha · [a-f0-9]{4}$/.test(scope.label)
    )).toBe(true);
    expect(config.selectedScopeIds).toEqual([]);
    expect(config.installationSecret).toMatch(/^[a-f0-9]{64}$/);

    const directory = codexLocalDirectory(cwd);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(directory, "config.json"))).mode & 0o777
    ).toBe(0o600);
    await expect(readStoredCodexConfig(cwd)).resolves.toEqual(config);
  });

  it("keeps thread content out of the default metadata-only snapshot", async () => {
    const cwd = await createTempDirectory();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const privatePath = "/Users/private/customer-workspace";
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      now,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "raw-thread-private-id",
              cwd: privatePath,
              updatedAt: "2026-07-25T10:00:00.000Z"
            })
          ],
          nextCursor: null
        }
      })
    });
    const selected = await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd
    );
    const queryThreads = vi.fn(async () => ({
      codexVersion: "codex-cli 0.145.0",
      result: {
        data: [
          thread({
            id: "raw-thread-private-id",
            cwd: privatePath,
            createdAt: "2026-07-24T08:00:00.000Z",
            updatedAt: "2026-07-25T10:00:00.000Z",
            status: {
              type: "active",
              activeFlags: ["waitingOnApproval"]
            },
            extra: {
              name: "SECRET TASK TITLE",
              preview: "SECRET PROMPT PREVIEW",
              turns: [{ text: "SECRET SOURCE CODE" }],
              commandOutput: "SECRET COMMAND OUTPUT",
              gitInfo: {
                branch: "secret-customer-branch",
                remote: "private-repository"
              }
            }
          }),
          thread({
            id: "not-loaded-thread",
            cwd: privatePath,
            createdAt: "2026-07-23T08:00:00.000Z",
            updatedAt: "2026-07-24T09:00:00.000Z",
            status: { type: "notLoaded" }
          }),
          thread({
            id: "outside-selected-scope",
            cwd: "/Users/private/not-selected",
            updatedAt: "2026-07-25T11:00:00.000Z"
          })
        ],
        nextCursor: "more-private-results"
      }
    }));

    const snapshot = await fetchAndStoreCodexSnapshot(selected, {
      cwd,
      now,
      queryThreads
    });

    expect(queryThreads).toHaveBeenCalledWith({
      cursor: null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "appServer", "exec"],
      useStateDbOnly: true,
      cwd: [privatePath]
    });
    expect(snapshot).toMatchObject({
      schemaVersion: "codex-snapshot-v2",
      collectorVersion: "codex-app-server-activity-summary-v1",
      contentMode: "metadata_only",
      codexVersion: "codex-cli 0.145.0",
      scopeIds: [discovery.scopes[0].id],
      truncated: true
    });
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions[0]).toMatchObject({
      projectLabel: "customer-workspace",
      activityState: "active",
      attentionState: "waiting_on_approval"
    });
    expect(snapshot.sessions[1]).toMatchObject({
      activityState: "not_loaded",
      attentionState: null
    });
    expect(
      snapshot.sessions.every((session) =>
        /^[a-f0-9]{24}$/.test(session.id)
      )
    ).toBe(true);
    expect(snapshot.sessions[0].id).not.toBe("raw-thread-private-id");

    const serialized = JSON.stringify(snapshot);
    for (const sensitiveValue of [
      privatePath,
      "raw-thread-private-id",
      "SECRET TASK TITLE",
      "SECRET PROMPT PREVIEW",
      "SECRET SOURCE CODE",
      "SECRET COMMAND OUTPUT",
      "secret-customer-branch",
      "private-repository",
      "more-private-results"
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }

    const storedSnapshotText = await readFile(
      join(codexLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    expect(storedSnapshotText).toBe(`${JSON.stringify(snapshot, null, 2)}\n`);
    expect(
      (await stat(join(codexLocalDirectory(cwd), "snapshot.json")))
        .mode & 0o777
    ).toBe(0o600);
    await expect(readStoredCodexSnapshot(cwd)).resolves.toEqual(snapshot);
  });

  it("stores a redacted task clue only after explicit local opt-in and purges it on opt-out", async () => {
    const cwd = await createTempDirectory();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const privatePath = "/Users/private/customer-workspace";
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      now,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "summary-thread",
              cwd: privatePath,
              updatedAt: "2026-07-25T10:00:00.000Z"
            })
          ],
          nextCursor: null
        }
      })
    });
    const selected = await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd,
      "activity_summary",
      now
    );
    expect(selected).toMatchObject({
      schemaVersion: "codex-connector-config-v2",
      contentMode: "activity_summary",
      contentConsentAt: now.toISOString()
    });

    const snapshot = await fetchAndStoreCodexSnapshot(selected, {
      cwd,
      now,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "named-thread",
              cwd: privatePath,
              updatedAt: "2026-07-25T11:00:00.000Z",
              extra: {
                name: "Google OAuth\u202e 연결 정리",
                preview: "SHOULD NOT WIN OVER THE THREAD NAME",
                turns: [{ text: "SECRET TURN" }]
              }
            }),
            thread({
              id: "preview-thread",
              cwd: privatePath,
              updatedAt: "2026-07-25T10:00:00.000Z",
              extra: {
                name: null,
                preview:
                  "Fix /Volumes/private/customer/file.ts and /private/tmp/run.log and C:\\secret\\file.ts using sk-secretvalue123 and https://private.example/path for owner@example.com",
                commandOutput: "SECRET COMMAND OUTPUT"
              }
            })
          ],
          nextCursor: null
        }
      })
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "codex-snapshot-v2",
      collectorVersion: "codex-app-server-activity-summary-v1",
      contentMode: "activity_summary",
      sessions: [
        {
          taskSummary: "Google OAuth 연결 정리",
          taskSummarySource: "thread_name"
        },
        {
          taskSummary:
            "Fix [로컬 경로] and [로컬 경로] and [로컬 경로] using [비밀값] and [링크] for [이메일]",
          taskSummarySource: "first_user_request"
        }
      ]
    });
    const serialized = JSON.stringify(snapshot);
    for (const sensitiveValue of [
      "/Volumes/private/customer/file.ts",
      "/private/tmp/run.log",
      "C:\\secret\\file.ts",
      "sk-secretvalue123",
      "https://private.example/path",
      "owner@example.com",
      "SHOULD NOT WIN OVER THE THREAD NAME",
      "SECRET TURN",
      "SECRET COMMAND OUTPUT"
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }

    const optedOut = await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd,
      "metadata_only",
      new Date("2026-07-25T12:05:00.000Z")
    );
    expect(optedOut).toMatchObject({
      contentMode: "metadata_only",
      contentConsentAt: null
    });
    const purged = await readStoredCodexSnapshot(cwd);
    expect(purged?.contentMode).toBe("metadata_only");
    expect(
      purged?.sessions.every(
        (session) =>
          session.taskSummary === null &&
          session.taskSummarySource === null
      )
    ).toBe(true);
  });

  it("deletes an unreadable snapshot before recording task-summary opt-out", async () => {
    const cwd = await createTempDirectory();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      now,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "summary-thread",
              cwd: "/private/customer-workspace",
              updatedAt: "2026-07-25T10:00:00.000Z"
            })
          ],
          nextCursor: null
        }
      })
    });
    await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd,
      "activity_summary",
      now
    );
    const snapshotPath = join(
      codexLocalDirectory(cwd),
      "snapshot.json"
    );
    await writeFile(
      snapshotPath,
      '{"taskSummary":"SHOULD_BE_DELETED"',
      { encoding: "utf8", mode: 0o600 }
    );

    await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd,
      "metadata_only",
      new Date("2026-07-25T12:05:00.000Z")
    );

    await expect(readStoredCodexSnapshot(cwd)).resolves.toBeNull();
    await expect(readStoredCodexConfig(cwd)).resolves.toMatchObject({
      contentMode: "metadata_only",
      contentConsentAt: null
    });
    await expect(readFile(snapshotPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reads legacy v1 connector files as metadata-only v2 state", async () => {
    const cwd = await createTempDirectory();
    const directory = codexLocalDirectory(cwd);
    const scopeId = "a".repeat(24);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(directory, "config.json"),
      `${JSON.stringify({
        schemaVersion: "codex-connector-config-v1",
        installationSecret: "f".repeat(64),
        selectedScopeIds: [scopeId],
        scopes: [
          {
            id: scopeId,
            queryPath: "/Users/example/blabase",
            label: "blabase",
            sessionCount: 1,
            lastActivityAt: "2026-07-25T09:00:00.000Z"
          }
        ],
        discoveredAt: "2026-07-25T09:30:00.000Z"
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await writeFile(
      join(directory, "snapshot.json"),
      `${JSON.stringify({
        schemaVersion: "codex-snapshot-v1",
        collectorVersion: "codex-app-server-metadata-v1",
        contentMode: "metadata_only",
        codexVersion: "codex-cli 0.145.0",
        fetchedAt: "2026-07-25T10:00:00.000Z",
        lookbackStart: "2026-06-25T10:00:00.000Z",
        truncated: false,
        scopeIds: [scopeId],
        sessions: [
          {
            id: "b".repeat(24),
            source: "codex",
            kind: "coding_session",
            scopeId,
            projectLabel: "blabase",
            createdAt: "2026-07-25T08:00:00.000Z",
            updatedAt: "2026-07-25T09:00:00.000Z",
            activityState: "idle",
            attentionState: null
          }
        ]
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    await expect(readStoredCodexConfig(cwd)).resolves.toMatchObject({
      schemaVersion: "codex-connector-config-v2",
      contentMode: "metadata_only",
      contentConsentAt: null
    });
    await expect(readStoredCodexSnapshot(cwd)).resolves.toMatchObject({
      schemaVersion: "codex-snapshot-v2",
      collectorVersion: "codex-app-server-metadata-v1",
      contentMode: "metadata_only",
      sessions: [
        {
          taskSummary: null,
          taskSummarySource: null
        }
      ]
    });
    expect(
      await readFile(join(directory, "config.json"), "utf8")
    ).toContain("codex-connector-config-v1");
  });

  it("keeps duplicate long project labels bounded and strips bidi controls", async () => {
    const cwd = await createTempDirectory();
    const projectName = `${"a".repeat(125)}\u202e`;
    const config = await discoverAndStoreCodexScopes({
      cwd,
      now: new Date("2026-07-25T12:00:00.000Z"),
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "long-a",
              cwd: `/Users/one/${projectName}`,
              updatedAt: "2026-07-25T10:00:00.000Z"
            }),
            thread({
              id: "long-b",
              cwd: `/Users/two/${projectName}`,
              updatedAt: "2026-07-25T09:00:00.000Z"
            })
          ],
          nextCursor: null
        }
      })
    });

    expect(config.scopes).toHaveLength(2);
    expect(
      config.scopes.every(
        (scope) =>
          scope.label.length <= 120 &&
          !scope.label.includes("\u202e") &&
          / · [a-f0-9]{4}$/.test(scope.label)
      )
    ).toBe(true);
  });

  it("deduplicates simultaneous discovery and removes local connector state", async () => {
    const cwd = await createTempDirectory();
    let releaseQuery: (() => void) | undefined;
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const queryThreads = vi.fn(async () => {
      await queryGate;
      return {
        codexVersion: "codex-cli 0.145.0",
        result: { data: [], nextCursor: null }
      };
    });

    const first = discoverAndStoreCodexScopes({
      cwd,
      queryThreads
    });
    const second = discoverAndStoreCodexScopes({
      cwd,
      queryThreads
    });
    releaseQuery?.();
    await Promise.all([first, second]);

    expect(queryThreads).toHaveBeenCalledOnce();
    await deleteStoredCodexConnection(cwd);
    await expect(readStoredCodexConfig(cwd)).resolves.toBeNull();
    await expect(readStoredCodexSnapshot(cwd)).resolves.toBeNull();
  });

  it("does not recreate config after disconnect during discovery", async () => {
    const cwd = await createTempDirectory();
    let releaseQuery: (() => void) | undefined;
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const discovery = discoverAndStoreCodexScopes({
      cwd,
      queryThreads: async () => {
        await queryGate;
        return {
          codexVersion: "codex-cli 0.145.0",
          result: { data: [], nextCursor: null }
        };
      }
    });

    await deleteStoredCodexConnection(cwd);
    releaseQuery?.();

    await expect(discovery).rejects.toThrow(
      "Codex connector state changed during operation."
    );
    await expect(readStoredCodexConfig(cwd)).resolves.toBeNull();
  });

  it("deduplicates snapshot refreshes only when scopes and content mode match", async () => {
    const cwd = await createTempDirectory();
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "scope-a-thread",
              cwd: "/Users/example/a",
              updatedAt: new Date().toISOString()
            }),
            thread({
              id: "scope-b-thread",
              cwd: "/Users/example/b",
              updatedAt: new Date().toISOString()
            })
          ],
          nextCursor: null
        }
      })
    });
    const scopeA = discovery.scopes.find((scope) => scope.label === "a");
    const scopeB = discovery.scopes.find((scope) => scope.label === "b");
    if (!scopeA || !scopeB) throw new Error("expected two scopes");
    const configA = {
      ...discovery,
      selectedScopeIds: [scopeA.id]
    };
    const configB = {
      ...discovery,
      selectedScopeIds: [scopeB.id]
    };
    const summaryConfigA = {
      ...configA,
      contentMode: "activity_summary" as const,
      contentConsentAt: new Date().toISOString()
    };
    let releaseQueries: (() => void) | undefined;
    const queryGate = new Promise<void>((resolve) => {
      releaseQueries = resolve;
    });
    const queryThreads = vi.fn(async () => {
      await queryGate;
      return {
        codexVersion: "codex-cli 0.145.0",
        result: { data: [], nextCursor: null }
      };
    });

    const firstA = fetchAndStoreCodexSnapshot(configA, {
      cwd,
      queryThreads
    });
    const duplicateA = fetchAndStoreCodexSnapshot(configA, {
      cwd,
      queryThreads
    });
    const summaryA = fetchAndStoreCodexSnapshot(summaryConfigA, {
      cwd,
      queryThreads
    });
    const firstB = fetchAndStoreCodexSnapshot(configB, {
      cwd,
      queryThreads
    });
    await selectStoredCodexScopes([scopeB.id], cwd);
    releaseQueries?.();
    const [snapshotA, duplicateSnapshotA, summarySnapshotA, snapshotB] =
      await Promise.allSettled([
        firstA,
        duplicateA,
        summaryA,
        firstB
      ]);

    expect(firstA).toBe(duplicateA);
    expect(firstA).not.toBe(summaryA);
    expect(queryThreads).toHaveBeenCalledTimes(3);
    expect(snapshotA.status).toBe("rejected");
    expect(duplicateSnapshotA.status).toBe("rejected");
    expect(summarySnapshotA.status).toBe("rejected");
    expect(snapshotB).toMatchObject({
      status: "fulfilled",
      value: { scopeIds: [scopeB.id] }
    });
  });

  it("does not recreate snapshot state after disconnect during a refresh", async () => {
    const cwd = await createTempDirectory();
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [
            thread({
              id: "disconnect-thread",
              cwd: "/Users/example/disconnect-scope",
              updatedAt: new Date().toISOString()
            })
          ],
          nextCursor: null
        }
      })
    });
    const selected = await selectStoredCodexScopes(
      [discovery.scopes[0].id],
      cwd
    );
    let releaseQuery: (() => void) | undefined;
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const refresh = fetchAndStoreCodexSnapshot(selected, {
      cwd,
      queryThreads: async () => {
        await queryGate;
        return {
          codexVersion: "codex-cli 0.145.0",
          result: { data: [], nextCursor: null }
        };
      }
    });

    await deleteStoredCodexConnection(cwd);
    releaseQuery?.();

    await expect(refresh).rejects.toThrow(
      "Codex connector state changed during operation."
    );
    await expect(readStoredCodexConfig(cwd)).resolves.toBeNull();
    await expect(readStoredCodexSnapshot(cwd)).resolves.toBeNull();
  });

  it("uses the fixed initialize and thread/list App Server protocol only", async () => {
    const cwd = await createTempDirectory();
    const binaryPath = join(cwd, "fake-codex");
    const requestLogPath = join(cwd, "requests.jsonl");
    await writeFile(
      binaryPath,
      fakeCodexAppServerSource(requestLogPath),
      { encoding: "utf8", mode: 0o700 }
    );
    await chmod(binaryPath, 0o700);
    vi.stubEnv("BLABASE_CODEX_BINARY_PATH", binaryPath);

    const params = {
      cursor: null,
      limit: 100,
      sortKey: "updated_at" as const,
      sortDirection: "desc" as const,
      sourceKinds: ["cli" as const],
      useStateDbOnly: true as const,
      cwd: ["/Users/example/selected"]
    };
    const response = await queryCodexThreadsViaAppServer(params);

    expect(response).toEqual({
      codexVersion: "codex-cli 0.145.0",
      result: { data: [], nextCursor: null }
    });
    const requests = (await readFile(requestLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        method: string;
        params?: unknown;
      });
    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "thread/list"
    ]);
    expect(requests[2].params).toEqual(params);
    expect(
      requests.some((request) => request.method === "thread/read")
    ).toBe(false);
  });

  it("handles a closed App Server stdin pipe without crashing", async () => {
    const cwd = await createTempDirectory();
    const binaryPath = join(cwd, "closed-stdin-codex");
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
let buffer = "";
let initialized = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (initialized) return;
  buffer += chunk;
  const newline = buffer.indexOf("\\n");
  if (newline < 0) return;
  const request = JSON.parse(buffer.slice(0, newline));
  initialized = true;
  fs.closeSync(0);
  setTimeout(() => {
    process.stdout.write(
      JSON.stringify({
        id: request.id,
        result: { userAgent: "codex_app_server/0.145.0" }
      }) + "\\n"
    );
  }, 100);
});
setInterval(() => {}, 1000);
`,
      { encoding: "utf8", mode: 0o700 }
    );
    await chmod(binaryPath, 0o700);
    vi.stubEnv("BLABASE_CODEX_BINARY_PATH", binaryPath);

    await expect(
      queryCodexThreadsViaAppServer({
        cursor: null,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli"],
        useStateDbOnly: true
      })
    ).rejects.toMatchObject({
      code: "APP_SERVER_PROTOCOL_ERROR"
    });
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blabase-codex-"));
  temporaryDirectories.push(directory);
  return directory;
}

function thread({
  id,
  cwd,
  createdAt,
  updatedAt,
  status,
  extra
}: {
  id: string;
  cwd: string;
  createdAt?: string;
  updatedAt: string;
  status?: unknown;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id,
    cwd,
    createdAt: epochSeconds(createdAt ?? updatedAt),
    updatedAt: epochSeconds(updatedAt),
    status: status ?? { type: "idle" },
    ...extra
  };
}

function epochSeconds(value: string): number {
  return Date.parse(value) / 1000;
}

function fakeCodexAppServerSource(requestLogPath: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const logPath = ${JSON.stringify(requestLogPath)};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      const request = JSON.parse(line);
      fs.appendFileSync(
        logPath,
        JSON.stringify({ method: request.method, params: request.params }) + "\\n"
      );
      if (request.method === "initialize") {
        process.stdout.write(
          JSON.stringify({
            id: request.id,
            result: { userAgent: "codex_app_server/0.145.0" }
          }) + "\\n"
        );
      }
      if (request.method === "thread/list") {
        process.stdout.write(
          JSON.stringify({
            id: request.id,
            result: { data: [], nextCursor: null }
          }) + "\\n"
        );
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;
}
