import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCodexConfig: vi.fn(),
  readContextRegistry: vi.fn(),
  readGitHubTokens: vi.fn(),
  readGitHubSnapshot: vi.fn(),
  loadGitHubConfig: vi.fn(),
  normalizeGitHub: vi.fn(),
  captureStructured: vi.fn()
}));

vi.mock("../src/connectors/codex/localStore", async (importActual) => ({
  ...(await importActual<typeof import("../src/connectors/codex/localStore")>()),
  readStoredCodexConfig: mocks.readCodexConfig
}));

vi.mock("../src/context/localStore", async (importActual) => ({
  ...(await importActual<typeof import("../src/context/localStore")>()),
  readWorkContextRegistry: mocks.readContextRegistry
}));

vi.mock("../src/connectors/github/localStore", async (importActual) => ({
  ...(await importActual<typeof import("../src/connectors/github/localStore")>()),
  readStoredGitHubTokensPreservingStatusV1: mocks.readGitHubTokens,
  readStoredGitHubSnapshotPreservingStatusV1: mocks.readGitHubSnapshot
}));

vi.mock("../src/connectors/github/config", async (importActual) => ({
  ...(await importActual<typeof import("../src/connectors/github/config")>()),
  loadGitHubConfig: mocks.loadGitHubConfig
}));

vi.mock("../src/connectors/github/toWorkSignals", async (importActual) => ({
  ...(await importActual<typeof import("../src/connectors/github/toWorkSignals")>()),
  normalizeGitHubSnapshotToWorkSignals: mocks.normalizeGitHub
}));

vi.mock(
  "../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1",
  async (importActual) => ({
    ...(await importActual<
      typeof import("../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1")
    >()),
    captureStructuredCurrentWorkEvidenceV1: mocks.captureStructured
  })
);

import type { BuiltTask1PrivatePilotAuthorizationV1 } from "../src/evaluation/dayflowAblation/task1PrivatePilotAuthorizationV1";
import {
  acquireTask1PrivatePilotTrustedSourcesV1,
  task1PrivatePilotWorkspaceIdentitySha256V1
} from "../src/evaluation/dayflowAblation/task1PrivatePilotTrustedSourcesV1";

const START_EPOCH_SECOND = 1_787_680_000;
const END_EPOCH_SECOND = START_EPOCH_SECOND + 599;
const AS_OF = new Date(END_EPOCH_SECOND * 1_000).toISOString();

function authorizationFixture(
  workspaceIdentitySha256 = task1PrivatePilotWorkspaceIdentitySha256V1()
): BuiltTask1PrivatePilotAuthorizationV1 {
  return {
    descriptor: {
      sourceMode: "real-private-pilot",
      episodeId: "pilot-episode-1",
      expectedExportRunId: "pilot-export-1",
      startEpochSecond: START_EPOCH_SECOND,
      endEpochSecond: END_EPOCH_SECOND,
      asOf: AS_OF
    },
    authorization: {
      authorization: {
        authorizedBy: "colin",
        decision: "authorized",
        sourceMode: "real-private-pilot",
        episodeId: "pilot-episode-1",
        expectedExportRunId: "pilot-export-1",
        workspaceIdentitySha256
      },
      window: {
        startEpochSecond: START_EPOCH_SECOND,
        endEpochSecond: END_EPOCH_SECOND,
        durationSeconds: 600,
        semantics: "inclusive",
        asOf: AS_OF
      }
    }
  } as unknown as BuiltTask1PrivatePilotAuthorizationV1;
}

function managedCodexConfigFixture() {
  return {
    selectedScopeIds: ["scope-1"],
    scopes: [{ id: "scope-1" }]
  };
}

const descriptorFixture = Object.freeze({
  schemaVersion: "blabase.dayflow-ablation.structured-current-work-evidence.v1",
  asOf: AS_OF,
  githubMode: "unconfigured" as const,
  canonicalJson: "{}",
  canonicalJsonByteLength: 2,
  sha256: "a".repeat(64)
});

describe("Task 1 private-pilot trusted-source acquisition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(END_EPOCH_SECOND * 1_000));
    vi.clearAllMocks();

    mocks.readCodexConfig.mockResolvedValue(managedCodexConfigFixture());
    mocks.readContextRegistry.mockResolvedValue({ status: "missing" });
    mocks.readGitHubTokens.mockResolvedValue({ status: "missing" });
    mocks.readGitHubSnapshot.mockResolvedValue({ status: "missing" });
    mocks.captureStructured.mockResolvedValue({
      ok: true,
      descriptor: descriptorFixture
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("owns cwd, clock, and preserve-mode reads for an unconfigured GitHub source", async () => {
    const result = await acquireTask1PrivatePilotTrustedSourcesV1({
      authorization: authorizationFixture()
    });

    expect(result).toEqual({ ok: true, descriptor: descriptorFixture });
    expect(mocks.readCodexConfig).toHaveBeenCalledWith(process.cwd(), "preserve");
    expect(mocks.readContextRegistry).toHaveBeenCalledWith(process.cwd(), "preserve");
    expect(mocks.readGitHubTokens).toHaveBeenCalledWith(process.cwd());
    expect(mocks.readGitHubSnapshot).toHaveBeenCalledWith(process.cwd());
    expect(mocks.captureStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        contextRegistry: null,
        githubSource: { mode: "unconfigured" }
      })
    );
  });

  it("normalizes matching configured GitHub state and exposes only the exact as-of batch", async () => {
    const batch = Object.freeze({ assessment: { asOf: AS_OF } });
    mocks.readGitHubTokens.mockResolvedValue({
      status: "available",
      value: {
        appClientId: "client-1",
        appSlug: "pilot-app",
        refreshTokenExpiresAt: new Date((END_EPOCH_SECOND + 60) * 1_000).toISOString()
      }
    });
    mocks.readGitHubSnapshot.mockResolvedValue({
      status: "available",
      value: { appClientId: "client-1", appSlug: "pilot-app" }
    });
    mocks.loadGitHubConfig.mockReturnValue({
      ok: true,
      config: { clientId: "client-1", appSlug: "pilot-app" }
    });
    mocks.normalizeGitHub.mockReturnValue({ status: "normalized", batch });
    mocks.captureStructured.mockImplementationOnce(async (input) => {
      expect(input.githubSource.mode).toBe("configured");
      if (input.githubSource.mode !== "configured") {
        throw new Error("expected configured source");
      }
      expect(input.githubSource.resolveBatch(AS_OF)).toBe(batch);
      expect(input.githubSource.resolveBatch("2026-01-01T00:00:00.000Z")).toBeNull();
      return { ok: true, descriptor: descriptorFixture };
    });

    await expect(
      acquireTask1PrivatePilotTrustedSourcesV1({ authorization: authorizationFixture() })
    ).resolves.toEqual({ ok: true, descriptor: descriptorFixture });
  });

  it.each([
    {
      name: "missing managed Codex state",
      arrange: () => mocks.readCodexConfig.mockResolvedValueOnce(null),
      code: "MANAGED_CODEX_MISSING_OR_INVALID"
    },
    {
      name: "an empty managed Codex selection",
      arrange: () =>
        mocks.readCodexConfig.mockResolvedValueOnce({ selectedScopeIds: [], scopes: [] }),
      code: "MANAGED_CODEX_MISSING_OR_INVALID"
    },
    {
      name: "an unknown managed Codex selection",
      arrange: () =>
        mocks.readCodexConfig.mockResolvedValueOnce({
          selectedScopeIds: ["missing"],
          scopes: [{ id: "known" }]
        }),
      code: "MANAGED_CODEX_MISSING_OR_INVALID"
    },
    {
      name: "an invalid context registry",
      arrange: () =>
        mocks.readContextRegistry.mockResolvedValueOnce({
          status: "invalid",
          reason: "SCHEMA_INVALID"
        }),
      code: "CONTEXT_REGISTRY_INVALID"
    },
    {
      name: "asymmetric GitHub state",
      arrange: () =>
        mocks.readGitHubTokens.mockResolvedValueOnce({ status: "available", value: {} }),
      code: "GITHUB_CONFIGURATION_INVALID"
    },
    {
      name: "an invalid GitHub store read",
      arrange: () =>
        mocks.readGitHubSnapshot.mockResolvedValueOnce({
          status: "invalid",
          reason: "READ_FAILED"
        }),
      code: "GITHUB_CONFIGURATION_INVALID"
    },
    {
      name: "structured capture rejection",
      arrange: () => mocks.captureStructured.mockResolvedValueOnce({ ok: false }),
      code: "STRUCTURED_CAPTURE_REJECTED"
    }
  ])("rejects $name", async ({ arrange, code }) => {
    arrange();
    await expect(
      acquireTask1PrivatePilotTrustedSourcesV1({ authorization: authorizationFixture() })
    ).resolves.toEqual({ ok: false, failure: { code } });
  });

  it("rejects a mismatched workspace and a non-end clock before connector reads", async () => {
    await expect(
      acquireTask1PrivatePilotTrustedSourcesV1({
        authorization: authorizationFixture("b".repeat(64))
      })
    ).resolves.toEqual({
      ok: false,
      failure: { code: "WORKSPACE_IDENTITY_MISMATCH" }
    });

    vi.setSystemTime(new Date((END_EPOCH_SECOND + 1) * 1_000));
    await expect(
      acquireTask1PrivatePilotTrustedSourcesV1({ authorization: authorizationFixture() })
    ).resolves.toEqual({ ok: false, failure: { code: "CLOCK_INVALID" } });
  });
});
