import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
const runtimeRoot = "/tmp/blabase-phase2a1-e2e-app";
const serverPort = "3199";

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });

for (const directory of ["app", "src"]) {
  await cp(join(sourceRoot, directory), join(runtimeRoot, directory), {
    recursive: true
  });
}
for (const filename of [
  "middleware.ts",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "tsconfig.json"
]) {
  await cp(join(sourceRoot, filename), join(runtimeRoot, filename));
}
await symlink(
  join(sourceRoot, "node_modules"),
  join(runtimeRoot, "node_modules"),
  "dir"
);
await seedCodexFixture(runtimeRoot);

const nextBinary = join(sourceRoot, "node_modules", ".bin", "next");
const child = spawn(
  nextBinary,
  ["dev", "--hostname", "127.0.0.1", "--port", serverPort],
  {
    cwd: runtimeRoot,
    env: isolatedEnvironment(),
    stdio: "inherit"
  }
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", async (code, signal) => {
  await rm(runtimeRoot, { recursive: true, force: true });
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function isolatedEnvironment() {
  const environment = {
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SOURCE_SYNC_POLL_INTERVAL_MS: "750"
  };
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM"
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  if (process.env.BLABASE_WORK_BOARD_MONITORING_ENABLED === "true") {
    environment.BLABASE_WORK_BOARD_MONITORING_ENABLED = "true";
  }
  return environment;
}

async function seedCodexFixture(cwd) {
  const now = new Date();
  const fetchedAt = now.toISOString();
  const lookbackStart = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1_000
  ).toISOString();
  const nextDueAt = new Date(
    now.getTime() + 60 * 60 * 1_000
  ).toISOString();
  const scopeId = "a".repeat(24);
  const attemptId = `sync_${"1".repeat(32)}`;
  const snapshotHash = "b".repeat(64);
  const revision = "codex:e2e-seed";
  const attempt = {
    contract: "source-sync-attempt-v1",
    attemptId,
    source: "codex",
    trigger: "manual",
    startedAt: fetchedAt,
    completedAt: fetchedAt,
    outcome: "success",
    retryCount: 0,
    latencyMs: 0,
    snapshotRevision: revision,
    snapshotHash,
    itemCount: 1,
    errorCode: null
  };
  const disabledState = (source) => ({
    contract: "source-sync-state-v1",
    source,
    status: "disabled",
    updatedAt: fetchedAt,
    retryCount: 0,
    nextDueAt: null,
    lastAttempt: null,
    lastSuccess: null,
    lastFailure: null,
    latestSnapshot: null
  });
  const codexDirectory = join(
    cwd,
    ".local",
    "connectors",
    "codex"
  );
  const syncDirectory = join(cwd, ".local", "sync");
  await Promise.all([
    mkdir(codexDirectory, { recursive: true, mode: 0o700 }),
    mkdir(syncDirectory, { recursive: true, mode: 0o700 })
  ]);

  await Promise.all([
    privateJson(
      join(codexDirectory, "config.json"),
      {
        schemaVersion: "codex-connector-config-v3",
        installationSecret: "c".repeat(64),
        selectedScopeIds: [scopeId],
        scopes: [
          {
            id: scopeId,
            queryPath: "/tmp/blabase-e2e-project",
            label: "E2E project",
            sessionCount: 1,
            lastActivityAt: fetchedAt
          }
        ],
        contentMode: "metadata_only",
        contentConsentAt: null,
        conversationConsentAt: null,
        conversationRetentionDays: null,
        discoveredAt: fetchedAt
      }
    ),
    privateJson(
      join(codexDirectory, "snapshot.json"),
      {
        schemaVersion: "codex-snapshot-v3",
        collectorVersion: "codex-app-server-metadata-v1",
        contentMode: "metadata_only",
        codexVersion: "codex-e2e",
        fetchedAt,
        lookbackStart,
        truncated: false,
        conversationStoreSha256: null,
        conversationRetentionDays: null,
        scopeIds: [scopeId],
        sessions: [
          {
            id: "d".repeat(24),
            source: "codex",
            kind: "coding_session",
            scopeId,
            projectLabel: "E2E project",
            taskSummary: null,
            taskSummarySource: null,
            createdAt: fetchedAt,
            updatedAt: fetchedAt,
            activityState: "idle",
            attentionState: null,
            content: emptyCodexContentManifest()
          }
        ]
      }
    ),
    privateJson(join(syncDirectory, "latest.json"), {
      contract: "source-sync-latest-store-v1",
      updatedAt: fetchedAt,
      sources: {
        github: disabledState("github"),
        codex: {
          contract: "source-sync-state-v1",
          source: "codex",
          status: "ready",
          updatedAt: fetchedAt,
          retryCount: 0,
          nextDueAt,
          lastAttempt: attempt,
          lastSuccess: attempt,
          lastFailure: null,
          latestSnapshot: {
            revision,
            hash: snapshotHash,
            itemCount: 1,
            syncedAt: fetchedAt,
            attemptId
          }
        },
        notion: disabledState("notion"),
        google_calendar: disabledState("google_calendar")
      }
    }),
    privateJson(join(syncDirectory, "history.json"), {
      contract: "source-sync-history-store-v1",
      updatedAt: fetchedAt,
      attempts: [attempt]
    })
  ]);
}

function emptyCodexContentManifest() {
  return {
    state: "not_collected",
    contentSha256: null,
    contentSourceUpdatedAt: null,
    collectedAt: null,
    expiresAt: null,
    historicalTurnStatus: "unknown",
    latestTurnCompletedAt: null,
    turnCount: 0,
    userPromptCount: 0,
    agentResponseCount: 0,
    commandExecutionCount: 0,
    failedCommandCount: 0,
    fileChangeCount: 0,
    toolCallCount: 0,
    omittedReasoningItemCount: 0,
    omittedUnsupportedItemCount: 0,
    truncated: false,
    reasonCodes: ["CONTENT_MODE_DISABLED"],
    latestUserPromptExcerpt: null,
    latestAgentResponseExcerpt: null,
    latestExecutionSummary: null
  };
}

async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}
