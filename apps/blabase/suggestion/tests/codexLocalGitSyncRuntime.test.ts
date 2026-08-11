import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/codex/appServer", () => ({
  fetchAndStoreCodexSnapshot: vi.fn()
}));

vi.mock("../src/connectors/codex/localGitCollector", () => ({
  collectCodexLocalGitSnapshot: vi.fn()
}));

vi.mock("../src/connectors/codex/localStore", () => ({
  codexStoreGeneration: vi.fn(() => 7),
  readStoredCodexConfig: vi.fn(),
  writeStoredCodexLocalGitSnapshot: vi.fn()
}));

import { fetchAndStoreCodexSnapshot } from "../src/connectors/codex/appServer";
import { collectCodexLocalGitSnapshot } from "../src/connectors/codex/localGitCollector";
import {
  codexStoreGeneration,
  readStoredCodexConfig,
  writeStoredCodexLocalGitSnapshot
} from "../src/connectors/codex/localStore";
import type { StoredCodexConfig } from "../src/connectors/codex/types";
import { createRuntimeSourceSyncAdapters } from "../src/sync/runtime";

const STARTED_AT = "2026-08-09T03:00:00.000Z";
const CWD = "/private/local/blabase";
const TEST_ENV: NodeJS.ProcessEnv = { NODE_ENV: "test" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("Codex runtime Local Git enrichment", () => {
  it("collects only selected scope paths after a successful Codex snapshot", async () => {
    const config = codexConfig();
    const codexSnapshot = {
      fetchedAt: STARTED_AT,
      sessions: []
    };
    const localGitSnapshot = {
      snapshotSha256: "a".repeat(64)
    };
    vi.mocked(readStoredCodexConfig).mockResolvedValue(config);
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(
      codexSnapshot as never
    );
    vi.mocked(collectCodexLocalGitSnapshot).mockResolvedValue(
      localGitSnapshot as never
    );
    vi.mocked(writeStoredCodexLocalGitSnapshot).mockResolvedValue();

    await createRuntimeSourceSyncAdapters(CWD, TEST_ENV).codex.sync({
      startedAt: STARTED_AT
    } as never);

    expect(collectCodexLocalGitSnapshot).toHaveBeenCalledWith({
      installationSecret: config.installationSecret,
      scopes: [config.scopes[0]],
      observedAt: STARTED_AT
    });
    expect(writeStoredCodexLocalGitSnapshot).toHaveBeenCalledWith(
      localGitSnapshot,
      config,
      CWD,
      7
    );
    expect(codexStoreGeneration).toHaveBeenCalledWith(CWD);
  });

  it("keeps Codex sync successful when private Local Git enrichment fails", async () => {
    vi.mocked(readStoredCodexConfig).mockResolvedValue(codexConfig());
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue({
      fetchedAt: STARTED_AT,
      sessions: []
    } as never);
    vi.mocked(collectCodexLocalGitSnapshot).mockRejectedValue(
      new Error("PRIVATE_LOCAL_GIT_FAILURE")
    );

    await expect(
      createRuntimeSourceSyncAdapters(CWD, TEST_ENV).codex.sync({
        startedAt: STARTED_AT
      } as never)
    ).resolves.toBeDefined();
    expect(writeStoredCodexLocalGitSnapshot).not.toHaveBeenCalled();
  });

  it("does not inspect Local Git when the primary Codex snapshot fails", async () => {
    vi.mocked(readStoredCodexConfig).mockResolvedValue(codexConfig());
    vi.mocked(fetchAndStoreCodexSnapshot).mockRejectedValue(
      new Error("CODEX_SNAPSHOT_FAILED")
    );

    await expect(
      createRuntimeSourceSyncAdapters(CWD, TEST_ENV).codex.sync({
        startedAt: STARTED_AT
      } as never)
    ).rejects.toBeDefined();
    expect(collectCodexLocalGitSnapshot).not.toHaveBeenCalled();
  });
});

function codexConfig(): StoredCodexConfig {
  return {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: "f".repeat(64),
    selectedScopeIds: ["a".repeat(24)],
    scopes: [
      {
        id: "a".repeat(24),
        queryPath: "/private/selected/project",
        label: "Selected",
        sessionCount: 1,
        lastActivityAt: STARTED_AT
      },
      {
        id: "b".repeat(24),
        queryPath: "/private/unselected/project",
        label: "Unselected",
        sessionCount: 1,
        lastActivityAt: STARTED_AT
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: STARTED_AT
  };
}
