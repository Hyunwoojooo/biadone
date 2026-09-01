import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LIVE_ATTENTION_FRESHNESS_POLICY } from "../../attention/liveAttention";
import { readStoredCodexConfig } from "../../connectors/codex/localStore";
import { loadGitHubConfig } from "../../connectors/github/config";
import {
  readStoredGitHubSnapshotPreservingStatusV1,
  readStoredGitHubTokensPreservingStatusV1
} from "../../connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../../connectors/github/toWorkSignals";
import { lookupProjectId, type WorkContextRegistry } from "../../context/contracts";
import { readWorkContextRegistry } from "../../context/localStore";
import {
  captureStructuredCurrentWorkEvidenceV1,
  type StructuredCurrentWorkEvidenceDescriptorV1
} from "./captureStructuredCurrentWorkEvidenceV1";
import type { BuiltTask1PrivatePilotAuthorizationV1 } from "./task1PrivatePilotAuthorizationV1";

export const TASK1_PRIVATE_PILOT_WORKSPACE_IDENTITY_HASH_DOMAIN_V1 =
  "blabase.dayflow-ablation.task1-private-pilot-workspace.v0.1";

export type Task1PrivatePilotTrustedSourcesFailureCodeV1 =
  | "AUTHORIZATION_INVALID"
  | "CLOCK_INVALID"
  | "WORKSPACE_IDENTITY_MISMATCH"
  | "MANAGED_CODEX_MISSING_OR_INVALID"
  | "CONTEXT_REGISTRY_INVALID"
  | "GITHUB_CONFIGURATION_INVALID"
  | "GITHUB_NORMALIZATION_REJECTED"
  | "STRUCTURED_CAPTURE_REJECTED";

export type Task1PrivatePilotTrustedSourcesResultV1 =
  | Readonly<{
      ok: true;
      descriptor: StructuredCurrentWorkEvidenceDescriptorV1;
    }>
  | Readonly<{
      ok: false;
      failure: Readonly<{
        code: Task1PrivatePilotTrustedSourcesFailureCodeV1;
      }>;
    }>;

const FAILURE_RESULTS = Object.freeze(
  Object.fromEntries(
    [
      "AUTHORIZATION_INVALID",
      "CLOCK_INVALID",
      "WORKSPACE_IDENTITY_MISMATCH",
      "MANAGED_CODEX_MISSING_OR_INVALID",
      "CONTEXT_REGISTRY_INVALID",
      "GITHUB_CONFIGURATION_INVALID",
      "GITHUB_NORMALIZATION_REJECTED",
      "STRUCTURED_CAPTURE_REJECTED"
    ].map((code) => [
      code,
      Object.freeze({
        ok: false as const,
        failure: Object.freeze({
          code: code as Task1PrivatePilotTrustedSourcesFailureCodeV1
        })
      })
    ])
  )
) as Readonly<
  Record<
    Task1PrivatePilotTrustedSourcesFailureCodeV1,
    Extract<Task1PrivatePilotTrustedSourcesResultV1, { ok: false }>
  >
>;

function fail(
  code: Task1PrivatePilotTrustedSourcesFailureCodeV1
): Task1PrivatePilotTrustedSourcesResultV1 {
  return FAILURE_RESULTS[code];
}

export function task1PrivatePilotWorkspaceIdentitySha256V1(
  cwd = process.cwd()
): string {
  const hash = createHash("sha256");
  hash.update(TASK1_PRIVATE_PILOT_WORKSPACE_IDENTITY_HASH_DOMAIN_V1, "utf8");
  hash.update(Buffer.from([0]));
  hash.update(resolve(cwd), "utf8");
  return hash.digest("hex");
}

function authorizationState(
  built: BuiltTask1PrivatePilotAuthorizationV1
):
  | Readonly<{
      ok: true;
      startEpochSecond: number;
      endEpochSecond: number;
      asOf: string;
      workspaceIdentitySha256: string;
    }>
  | Readonly<{ ok: false }> {
  try {
    const descriptor = built.descriptor;
    const authorization = built.authorization.authorization;
    const window = built.authorization.window;

    if (
      descriptor.sourceMode !== "real-private-pilot" ||
      authorization.authorizedBy !== "colin" ||
      authorization.decision !== "authorized" ||
      authorization.sourceMode !== "real-private-pilot" ||
      descriptor.episodeId !== authorization.episodeId ||
      descriptor.expectedExportRunId !== authorization.expectedExportRunId ||
      descriptor.startEpochSecond !== window.startEpochSecond ||
      descriptor.endEpochSecond !== window.endEpochSecond ||
      descriptor.asOf !== window.asOf ||
      window.durationSeconds !== 600 ||
      window.semantics !== "inclusive" ||
      !Number.isSafeInteger(window.startEpochSecond) ||
      !Number.isSafeInteger(window.endEpochSecond) ||
      window.endEpochSecond - window.startEpochSecond !== 599 ||
      new Date(window.endEpochSecond * 1_000).toISOString() !== window.asOf ||
      !/^[a-f0-9]{64}$/.test(authorization.workspaceIdentitySha256)
    ) {
      return Object.freeze({ ok: false as const });
    }

    return Object.freeze({
      ok: true as const,
      startEpochSecond: window.startEpochSecond,
      endEpochSecond: window.endEpochSecond,
      asOf: window.asOf,
      workspaceIdentitySha256: authorization.workspaceIdentitySha256
    });
  } catch {
    return Object.freeze({ ok: false as const });
  }
}

function hasValidSelectedManagedCodexScope(config: {
  selectedScopeIds: readonly string[];
  scopes: readonly Readonly<{ id: string }>[];
}): boolean {
  if (config.selectedScopeIds.length === 0) {
    return false;
  }

  const knownScopeIds = new Set(config.scopes.map((scope) => scope.id));
  return config.selectedScopeIds.every((scopeId) => knownScopeIds.has(scopeId));
}

function contextRegistrySha256(registry: WorkContextRegistry | null): string | null {
  if (registry === null) {
    return null;
  }

  return createHash("sha256").update(JSON.stringify(registry), "utf8").digest("hex");
}

function resolveGitHubProjectId(
  registry: WorkContextRegistry | null,
  sourceScopeId: string
): string | null {
  if (registry === null) {
    return null;
  }

  const match = /^repository:([1-9][0-9]*)$/.exec(sourceScopeId);
  if (match?.[1] === undefined) {
    return null;
  }

  return lookupProjectId(registry, {
    source: "github",
    resourceType: "repository",
    opaqueId: match[1]
  });
}

export async function acquireTask1PrivatePilotTrustedSourcesV1(input: Readonly<{
  authorization: BuiltTask1PrivatePilotAuthorizationV1;
}>): Promise<Task1PrivatePilotTrustedSourcesResultV1> {
  const cwd = process.cwd();
  const nowEpochMillisecond = Date.now();
  const nowEpochSecond = Math.floor(nowEpochMillisecond / 1_000);
  const state = authorizationState(input.authorization);

  if (!state.ok) {
    return fail("AUTHORIZATION_INVALID");
  }
  if (nowEpochSecond !== state.endEpochSecond) {
    return fail("CLOCK_INVALID");
  }
  if (task1PrivatePilotWorkspaceIdentitySha256V1(cwd) !== state.workspaceIdentitySha256) {
    return fail("WORKSPACE_IDENTITY_MISMATCH");
  }

  const [codexConfig, contextResult, githubTokensResult, githubSnapshotResult] =
    await Promise.all([
      readStoredCodexConfig(cwd, "preserve"),
      readWorkContextRegistry(cwd, "preserve"),
      readStoredGitHubTokensPreservingStatusV1(cwd),
      readStoredGitHubSnapshotPreservingStatusV1(cwd)
    ]);

  if (codexConfig === null || !hasValidSelectedManagedCodexScope(codexConfig)) {
    return fail("MANAGED_CODEX_MISSING_OR_INVALID");
  }

  if (contextResult.status === "invalid") {
    return fail("CONTEXT_REGISTRY_INVALID");
  }
  const contextRegistry =
    contextResult.status === "available" ? contextResult.value : null;

  let githubSource:
    | Readonly<{ mode: "unconfigured" }>
    | Readonly<{
        mode: "configured";
        resolveBatch: (asOf: string) => unknown;
      }>;

  if (githubTokensResult.status === "missing" && githubSnapshotResult.status === "missing") {
    githubSource = Object.freeze({ mode: "unconfigured" as const });
  } else {
    if (
      githubTokensResult.status !== "available" ||
      githubSnapshotResult.status !== "available"
    ) {
      return fail("GITHUB_CONFIGURATION_INVALID");
    }

    const configured = loadGitHubConfig(process.env);
    const tokens = githubTokensResult.value;
    const snapshot = githubSnapshotResult.value;
    const refreshTokenExpiresAt = Date.parse(tokens.refreshTokenExpiresAt);

    if (
      !configured.ok ||
      configured.config.clientId !== tokens.appClientId ||
      configured.config.appSlug !== tokens.appSlug ||
      snapshot.appClientId !== tokens.appClientId ||
      snapshot.appSlug !== tokens.appSlug ||
      !Number.isFinite(refreshTokenExpiresAt) ||
      refreshTokenExpiresAt <= nowEpochMillisecond
    ) {
      return fail("GITHUB_CONFIGURATION_INVALID");
    }

    const normalized = normalizeGitHubSnapshotToWorkSignals(
      snapshot,
      {
        asOf: state.asOf,
        freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
        contextRegistrySha256: contextRegistrySha256(contextRegistry),
        resolveProjectId: (sourceScopeId: string) =>
          resolveGitHubProjectId(contextRegistry, sourceScopeId)
      } as never
    );
    if (normalized.status !== "normalized") {
      return fail("GITHUB_NORMALIZATION_REJECTED");
    }

    const batch = normalized.batch;
    githubSource = Object.freeze({
      mode: "configured" as const,
      resolveBatch: (asOf: string) => (asOf === state.asOf ? batch : null)
    });
  }

  try {
    const captured = await captureStructuredCurrentWorkEvidenceV1({
      window: {
        startEpochSecond: state.startEpochSecond,
        endEpochSecond: state.endEpochSecond
      },
      codexConfig,
      contextRegistry,
      githubSource
    } as never);

    if (!captured.ok) {
      return fail("STRUCTURED_CAPTURE_REJECTED");
    }

    return Object.freeze({
      ok: true as const,
      descriptor: captured.descriptor
    });
  } catch {
    return fail("STRUCTURED_CAPTURE_REJECTED");
  }
}
