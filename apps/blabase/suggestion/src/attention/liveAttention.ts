import { randomBytes } from "node:crypto";

import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../connectors/codex/localStore";
import { codexSnapshotMatchesConfig } from "../connectors/codex/connectionState";
import { normalizeCodexSnapshotToWorkSignals } from "../connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../connectors/codex/types";
import {
  googleCalendarSnapshotMatchesTokens,
  googleCalendarSnapshotScopeId,
  readStoredSnapshot as readStoredCalendarSnapshot,
  readStoredTokens as readStoredCalendarTokens
} from "../connectors/googleCalendar/localStore";
import type { GoogleCalendarSnapshot } from "../connectors/googleCalendar/types";
import { loadGitHubConfig } from "../connectors/github/config";
import {
  readStoredGitHubSnapshot,
  readStoredGitHubTokens
} from "../connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../connectors/github/toWorkSignals";
import type { GitHubSnapshot } from "../connectors/github/types";
import {
  notionSnapshotMatchesTokens,
  readStoredNotionSnapshot,
  readStoredNotionTokens
} from "../connectors/notion/localStore";
import type { NotionSnapshot } from "../connectors/notion/types";
import type { Phase2SourceInput } from "../crossSource/attentionSchema";
import type {
  FreshnessPolicy,
  RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  phase2AttentionInput,
  phase2AvailableSource,
  phase2UnavailableSource,
  runPhase2AttentionRouter
} from "../crossSource/runAttentionRouter";
import {
  resolveActiveAttention,
  sealActiveAttentionInput,
  type ActiveAttentionResult
} from "../attentionDecision";
import {
  lookupProjectId,
  readWorkContextRegistry,
  readWeeklyOutcomeStore,
  resolveAttentionWorkContext,
  resolveStoredAttentionWorkContext,
  type SourceScopeRef,
  type WorkContextRegistry
} from "../context";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import { ACTIVE_ATTENTION_INPUT_CONTRACT } from "../crossSource/versions";
import { resolveAttentionEligibilityShadow } from "../eligibility";
import type { AttentionEligibilityShadowProjection } from "../eligibility";
import { loadSharedLocalEnv } from "../localEnv";
import { syncRuntimeSources } from "../sync/runtime";
import {
  resolveCurrentWorkEvidenceAtAuthoritySnapshot,
  resolveEmptyManagedWorkEvidence,
  type CurrentWorkEvidence
} from "../workEvidence/currentWorkEvidence";
import {
  createEmptyProjectWorkflowStore,
  readProjectWorkflowStore,
  resolveProjectWorkflowProjection,
  type ProjectWorkflowProjection
} from "../workflows";
import {
  adaptCalendarSnapshotForAttention,
  adaptNotionSnapshotForAttention,
  unavailableCalendarAttentionSource,
  unavailableNotionAttentionSource,
  type CalendarAttentionSource,
  type NotionAttentionSource
} from "./supportingSourceAdapters";
import type { AttentionExecutionIds } from "./execution";
import {
  ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
  ATTENTION_LIVE_ORCHESTRATOR_VERSION,
  ATTENTION_MONITOR_PREVIEW_CONTRACT,
  ATTENTION_MONITOR_RETENTION_DAYS,
  ATTENTION_MONITOR_RUN_CONTRACT,
  ATTENTION_REPLAY_INPUT_CONTRACT
} from "./versions";
import {
  attentionMonitorRunSchema,
  currentAttentionReplayInputArtifactSchema,
  type AttentionMonitorRun,
  type AttentionReplayInputArtifact,
  type AttentionSupportingSourceMonitor,
  type AttentionSourceMonitor,
  type AttentionWorkContextMonitor
} from "./monitoringSchema";
import {
  resolveAttentionCodeProvenance,
  type AttentionCodeProvenance
} from "./codeProvenance";

export const LIVE_ATTENTION_FRESHNESS_POLICY: FreshnessPolicy = {
  version: ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
  maxAgeMsBySource: {
    github: 30 * 60 * 1_000,
    codex: 5 * 60 * 1_000
  },
  maxFutureClockSkewMs: 60 * 1_000
};

type LiveUnavailableReason =
  | "CONNECTOR_DISCONNECTED"
  | "COLLECTION_FAILED"
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_PARSE_FAILED"
  | "SNAPSHOT_SCHEMA_UNSUPPORTED";

export type LiveSourceSnapshot<T> =
  | { status: "available"; snapshot: T }
  | { status: "unavailable"; reason: LiveUnavailableReason };

type AttentionSnapshots = {
  github: LiveSourceSnapshot<GitHubSnapshot>;
  codex: LiveSourceSnapshot<CodexSnapshot>;
  googleCalendar?: LiveSourceSnapshot<GoogleCalendarSnapshot>;
  notion?: LiveSourceSnapshot<NotionSnapshot>;
  registry?: WorkContextRegistry | null;
  focus?: {
    primaryOutcome: string | null;
    capturedAt: string | null;
    validUntil: string | null;
  };
  contextProvenance?: AttentionWorkContextMonitor;
  currentWorkEvidence?: CurrentWorkEvidence;
  workflowProjection?: ProjectWorkflowProjection;
};

type EvaluatedAttention = {
  result: ActiveAttentionResult;
  baseResult: ReturnType<typeof runPhase2AttentionRouter>;
  eligibilityProjection: AttentionEligibilityShadowProjection;
  run: AttentionMonitorRun;
  replayArtifact: AttentionReplayInputArtifact;
};

export function asEphemeralAttentionPreview(
  runInput: AttentionMonitorRun
): AttentionMonitorRun {
  const run = attentionMonitorRunSchema.parse(runInput);
  return attentionMonitorRunSchema.parse({
    ...run,
    contract: ATTENTION_MONITOR_PREVIEW_CONTRACT,
    analysisId: null,
    sessionId: null,
    replayArtifactState: "not_recorded",
    replayArtifactSha256: null
  });
}

export async function evaluateCurrentAttention(input?: {
  cwd?: string;
  now?: Date;
  startedAt?: Date;
  env?: NodeJS.ProcessEnv;
  refreshSources?: boolean;
  executionIds?: AttentionExecutionIds;
  codeProvenance?: AttentionCodeProvenance;
}): Promise<EvaluatedAttention> {
  const cwd = input?.cwd ?? process.cwd();
  const startedAtMs =
    input?.startedAt?.getTime() ?? input?.now?.getTime() ?? Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const env = input?.env ?? process.env;
  loadSharedLocalEnv(env);
  if (input?.refreshSources) {
    await syncRuntimeSources({
      cwd,
      env
    });
  }
  const [github, codex, googleCalendar, notion, codeProvenance] =
    await Promise.all([
    readGitHubSource(cwd, new Date(startedAtMs), env),
    readCodexSource(cwd),
    readCalendarSource(cwd),
    readNotionSource(cwd),
    input?.codeProvenance ??
      resolveAttentionCodeProvenance(cwd, env)
  ]);
  const sourceScopes = attentionSourceScopes({
    github,
    codex,
    googleCalendar,
    notion
  });
  const [registryRead, outcomeRead, workflowStore] = await Promise.all([
    readWorkContextRegistry(cwd),
    readWeeklyOutcomeStore(cwd),
    readProjectWorkflowStore(cwd)
  ]);
  const registry =
    registryRead.status === "available" ? registryRead.value : null;
  const currentWorkEvidence =
    await resolveCurrentWorkEvidenceAtAuthoritySnapshot({
      cwd,
      ...(input?.now ? { now: input.now } : {}),
      contextRegistry: registry,
      resolveGithubBatch: (asOf) => {
        const normalized = normalizeGitHubSource(github, asOf, registry);
        return normalized.sourceInput.status === "available"
          ? normalized.sourceInput.batch
          : null;
      }
    });
  const asOf = currentWorkEvidence.asOf;
  const context =
    registryRead.status === "available" &&
    outcomeRead.status !== "invalid"
      ? resolveAttentionWorkContext({
          registry: registryRead.value,
          weeklyOutcomes:
            outcomeRead.status === "available"
              ? outcomeRead.value
              : null,
          sourceScopes,
          asOf
        })
      : await resolveStoredAttentionWorkContext({
          sourceScopes,
          asOf,
          cwd
        });
  const workflowProjection = resolveProjectWorkflowProjection({
    store: workflowStore,
    asOf
  });
  return evaluateAttentionSnapshots({
    github,
    codex,
    googleCalendar,
    notion,
    registry,
    focus: context.focus,
    contextProvenance: {
      contract: context.contract,
      registrySha256:
        registryRead.status === "available"
          ? registryRead.value.registrySha256
          : null,
      resolutionSha256: context.resolutionSha256,
      weeklyOutcomeStoreSha256:
        outcomeRead.status === "available"
          ? outcomeRead.value.storeSha256
          : null,
      weeklyOutcomeStatus: context.weeklyOutcomeStatus,
      projectResolution: context.projectResolution,
      focusState:
        context.focus.primaryOutcome === null ? "none" : "active"
    },
    currentWorkEvidence,
    workflowProjection,
    asOf,
    startedAt,
    completionClock: input?.now
      ? () => startedAtMs
      : () => Date.now(),
    executionIds: input?.executionIds,
    ...codeProvenance
  });
}

export function evaluateAttentionSnapshots(input: AttentionSnapshots & {
  asOf: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  /** Internal wall clock sampled after normalization and decision resolution. */
  completionClock?: () => number;
  codeCommitSha?: string | null;
  codeState?: AttentionCodeProvenance["codeState"];
  codeFingerprintSha256?: string | null;
  executionIds?: AttentionExecutionIds;
}): EvaluatedAttention {
  const github = normalizeGitHubSource(
    input.github,
    input.asOf,
    input.registry ?? null
  );
  const codex = normalizeCodexSource(
    input.codex,
    input.asOf,
    input.registry ?? null
  );
  const googleCalendar =
    input.googleCalendar?.status === "available"
      ? adaptCalendarSnapshotForAttention({
          snapshot: input.googleCalendar.snapshot,
          asOf: input.asOf,
          registry: input.registry ?? null
        })
      : unavailableCalendarAttentionSource(
          input.googleCalendar?.reason ?? "SNAPSHOT_MISSING"
        );
  const notion =
    input.notion?.status === "available"
      ? adaptNotionSnapshotForAttention({
          snapshot: input.notion.snapshot,
          asOf: input.asOf,
          registry: input.registry ?? null
        })
      : unavailableNotionAttentionSource(
          input.notion?.reason ?? "SNAPSHOT_MISSING"
        );
  const supportingSources = [
    supportingCalendarMonitor(
      input.googleCalendar,
      googleCalendar
    ),
    supportingNotionMonitor(input.notion, notion)
  ] satisfies [
    AttentionSupportingSourceMonitor,
    AttentionSupportingSourceMonitor
  ];
  const attentionInput = phase2AttentionInput({
    asOf: input.asOf,
    github: github.sourceInput,
    codex: codex.sourceInput,
    googleCalendar,
    notion,
    focus: input.focus
  });
  const baseResult = runPhase2AttentionRouter(attentionInput);
  const githubBatch =
    github.sourceInput.status === "available"
      ? github.sourceInput.batch
      : null;
  const currentWorkEvidence =
    input.currentWorkEvidence ??
    resolveEmptyManagedWorkEvidence({
      asOf: input.asOf,
      githubBatch,
      contextRegistry: input.registry ?? null
    });
  const workflowProjection =
    input.workflowProjection ??
    resolveProjectWorkflowProjection({
      store: createEmptyProjectWorkflowStore(input.asOf),
      asOf: input.asOf
    });
  const eligibilityProjection = resolveAttentionEligibilityShadow({
    asOf: input.asOf,
    githubBatch,
    workRelationProjection: currentWorkEvidence.workRelations,
    artifactRelationProjection: currentWorkEvidence.artifacts,
    claimAuthorityProjection: currentWorkEvidence.claims
  });
  const activeInput = sealActiveAttentionInput({
    contract: ACTIVE_ATTENTION_INPUT_CONTRACT,
    asOf: input.asOf,
    baseAttentionInput: attentionInput,
    githubBatch,
    eligibilityProjection,
    managedPublicProjection: currentWorkEvidence.managedProjection,
    managedSemanticProjection: currentWorkEvidence.managedSemantics,
    managedRunStartedAtById:
      currentWorkEvidence.managedRunStartedAtById,
    workRelationProjection: currentWorkEvidence.workRelations,
    artifactRelationProjection: currentWorkEvidence.artifacts,
    claimAuthorityProjection: currentWorkEvidence.claims,
    workflowProjection
  });
  const result = resolveActiveAttention(activeInput);
  const candidateCounts = {
    eligible: 0,
    reviewRequired: 0,
    ineligible: 0
  };
  for (const assessment of result.assessments) {
    candidateCounts[
      assessment.status === "review_required"
        ? "reviewRequired"
        : assessment.status
    ] += 1;
  }
  const errors = [github.monitor, codex.monitor].flatMap(
    (source) =>
      source.unavailableReason === null
        ? []
        : [
            {
              source: source.source,
              code: source.unavailableReason
            }
          ]
  );
  const startedAt = input.startedAt ?? input.asOf;
  const startedAtMs = Date.parse(startedAt);
  const suppliedLatencyMs =
    input.latencyMs === undefined
      ? undefined
      : Math.max(0, Math.round(input.latencyMs));
  const completedAtMs = input.completedAt
    ? Date.parse(input.completedAt)
    : input.completionClock
      ? Math.max(startedAtMs, input.completionClock())
      : suppliedLatencyMs === undefined
        ? Date.parse(input.asOf)
        : startedAtMs + suppliedLatencyMs;
  const completedAt = new Date(completedAtMs).toISOString();
  const latencyMs =
    suppliedLatencyMs ?? completedAtMs - startedAtMs;
  const runId =
    input.executionIds?.runId ??
    `run_${randomBytes(16).toString("hex")}`;
  const analysisId =
    input.executionIds?.analysisId ??
    `analysis_${randomBytes(16).toString("hex")}`;
  const sessionId =
    input.executionIds?.sessionId ??
    `session_${result.inputSha256.slice(0, 32)}`;
  const replayArtifact =
    currentAttentionReplayInputArtifactSchema.parse({
      contract: ATTENTION_REPLAY_INPUT_CONTRACT,
      runId,
      analysisId,
      sessionId,
      capturedAt: completedAt,
      inputSha256: result.inputSha256,
      privacyClass: "private_local_engine_input",
      retentionDays: ATTENTION_MONITOR_RETENTION_DAYS,
      input: activeInput
    });
  const replayArtifactSha256 = runtimeSha256({
    domain: "attention-private-replay-artifact-v2",
    artifact: replayArtifact
  });
  const codeState =
    input.codeState ??
    (input.codeCommitSha ? "declared_commit" : "unavailable");

  return {
    result,
    baseResult,
    eligibilityProjection,
    run: attentionMonitorRunSchema.parse({
      contract: ATTENTION_MONITOR_RUN_CONTRACT,
      runId,
      analysisId,
      sessionId,
      resultId: result.resultId,
      status: "completed",
      asOf: result.asOf,
      startedAt,
      completedAt,
      codeCommitSha: input.codeCommitSha ?? null,
      codeState,
      codeFingerprintSha256:
        input.codeFingerprintSha256 ?? null,
      inputSha256: result.inputSha256,
      resultSha256: result.resultSha256,
      replayArtifactState: "available",
      replayArtifactSha256,
      orchestratorVersion: ATTENTION_LIVE_ORCHESTRATOR_VERSION,
      freshnessPolicyVersion:
        ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
      freshnessPolicy: {
        githubMaxAgeMs:
          LIVE_ATTENTION_FRESHNESS_POLICY.maxAgeMsBySource.github,
        codexMaxAgeMs:
          LIVE_ATTENTION_FRESHNESS_POLICY.maxAgeMsBySource.codex,
        maxFutureClockSkewMs:
          LIVE_ATTENTION_FRESHNESS_POLICY.maxFutureClockSkewMs
      },
      resultContract: result.contract,
      policyVersion: result.policyVersion,
      githubCandidateRuleVersion: null,
      codexOverviewRuleVersion: null,
      candidateRuleVersion: result.candidateRuleVersion,
      lanePolicyVersion: result.lanePolicyVersion,
      rankingPolicyVersion: result.rankingPolicyVersion,
      resolverVersion: result.resolverVersion,
      idPolicyVersion: result.idPolicyVersion,
      decisionStatus: result.decision.status,
      certainty: result.decision.certainty,
      topCandidateId:
        result.decision.topSuggestion?.candidateId ?? null,
      alternativeCount: result.decision.alternatives.length,
      candidateCounts,
      candidateAssessmentDetailState: "available",
      candidateAssessments: result.assessments.map(
        (assessment) => ({
          assessmentId: assessment.assessmentId,
          candidateId: assessment.candidateId,
          triggerSource: assessment.triggerSource,
          triggerKind: assessment.triggerKind,
          status: assessment.status,
          reviewRoute: assessment.reviewRoute,
          reasonCodes: assessment.reasonCodes
        })
      ),
      codexExecutionCount:
        baseResult.workCockpit.codexExecutions.length,
      coverageDisposition: activeCoverageDisposition(result),
      decisionReasonCodes: result.decision.reasonCodes,
      caveatCodes: result.decision.caveatCodes,
      sources: [github.monitor, codex.monitor],
      supportingSources,
      ...(input.contextProvenance
        ? { workContext: input.contextProvenance }
        : {}),
      latencyMs,
      errors
    }),
    replayArtifact
  };
}

function activeCoverageDisposition(
  result: ActiveAttentionResult
): "scoped_complete" | "limited_but_sufficient" | "insufficient" {
  if (result.coverage.negativeCandidateCoverageComplete) {
    return "scoped_complete";
  }
  return result.decision.status === "suggested"
    ? "limited_but_sufficient"
    : "insufficient";
}

function normalizeGitHubSource(
  source: LiveSourceSnapshot<GitHubSnapshot>,
  asOf: string,
  registry: WorkContextRegistry | null
): {
  sourceInput: Phase2SourceInput;
  monitor: AttentionSourceMonitor;
} {
  if (source.status === "unavailable") {
    return unavailableSource("github", source.reason);
  }
  if (!hasConfiguredGitHubScope(source.snapshot)) {
    return unavailableSource("github", "CONNECTOR_DISCONNECTED");
  }
  const normalized = normalizeGitHubSnapshotToWorkSignals(
    source.snapshot,
    {
      asOf,
      freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
      contextRegistrySha256: registry?.registrySha256 ?? null,
      resolveProjectId: (sourceScopeId) =>
        resolveRegistryProjectId(
          registry,
          "github",
          sourceScopeId
        )
    }
  );
  if (normalized.status === "rejected") {
    return rejectedSource("github", normalized.failure.code);
  }
  return availableSource(normalized.batch);
}

function hasConfiguredGitHubScope(snapshot: GitHubSnapshot): boolean {
  const activeInstallationIds = new Set(
    snapshot.installations
      .filter((installation) => !installation.suspended)
      .map((installation) => installation.id)
  );
  return snapshot.repositories.some(
    (repository) =>
      !repository.archived &&
      activeInstallationIds.has(repository.installationId)
  );
}

function normalizeCodexSource(
  source: LiveSourceSnapshot<CodexSnapshot>,
  asOf: string,
  registry: WorkContextRegistry | null
): {
  sourceInput: Phase2SourceInput;
  monitor: AttentionSourceMonitor;
} {
  if (source.status === "unavailable") {
    return unavailableSource("codex", source.reason);
  }
  const normalized = normalizeCodexSnapshotToWorkSignals(
    source.snapshot,
    {
      asOf,
      freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
      contextRegistrySha256: registry?.registrySha256 ?? null,
      resolveProjectId: (sourceScopeId) =>
        resolveRegistryProjectId(
          registry,
          "codex",
          sourceScopeId
        )
    }
  );
  if (normalized.status === "rejected") {
    return rejectedSource("codex", normalized.failure.code);
  }
  return availableSource(normalized.batch);
}

function resolveRegistryProjectId(
  registry: WorkContextRegistry | null,
  source: "github" | "codex",
  sourceScopeId: string
): string | null {
  if (!registry) return null;
  const prefix = source === "github" ? "repository:" : "scope:";
  if (!sourceScopeId.startsWith(prefix)) return null;
  const opaqueId = sourceScopeId.slice(prefix.length);
  return source === "github"
    ? lookupProjectId(registry, {
        source: "github",
        resourceType: "repository",
        opaqueId
      })
    : lookupProjectId(registry, {
        source: "codex",
        resourceType: "scope",
        opaqueId
      });
}

function availableSource(batch: RuntimeWorkSignalBatch): {
  sourceInput: Phase2SourceInput;
  monitor: AttentionSourceMonitor;
} {
  return {
    sourceInput: phase2AvailableSource(batch),
    monitor: {
      source: batch.source,
      inputState: "available",
      unavailableReason: null,
      freshness: batch.assessment.freshness,
      completeness: batch.assessment.completeness,
      snapshotFetchedAt: batch.assessment.fetchedAt,
      sourceSnapshotSha256: batch.sourceSnapshotSha256,
      batchSha256: batch.batchSha256,
      normalizerVersion: batch.normalizerVersion,
      candidateSetComplete: batch.assessment.candidateSetComplete,
      signalCount: batch.signalCount,
      skippedRecordCount: batch.skippedRecordCount,
      issueCodes: [
        ...new Set(batch.issues.map((issue) => issue.code))
      ].sort()
    }
  };
}

function rejectedSource(
  source: "github" | "codex",
  reason:
    | "SNAPSHOT_MISSING"
    | "SNAPSHOT_PARSE_FAILED"
    | "SNAPSHOT_SCHEMA_UNSUPPORTED"
): {
  sourceInput: Phase2SourceInput;
  monitor: AttentionSourceMonitor;
} {
  return unavailableSource(source, reason, "rejected");
}

function unavailableSource(
  source: "github" | "codex",
  reason: LiveUnavailableReason,
  inputState:
    | "missing"
    | "rejected"
    | "disconnected"
    | "collection_failed" = inputStateFor(reason)
): {
  sourceInput: Phase2SourceInput;
  monitor: AttentionSourceMonitor;
} {
  return {
    sourceInput: phase2UnavailableSource(reason),
    monitor: {
      source,
      inputState,
      unavailableReason: reason,
      freshness: null,
      completeness: null,
      snapshotFetchedAt: null,
      sourceSnapshotSha256: null,
      batchSha256: null,
      normalizerVersion: null,
      candidateSetComplete: false,
      signalCount: 0,
      skippedRecordCount: 0,
      issueCodes: []
    }
  };
}

function supportingCalendarMonitor(
  snapshot:
    | LiveSourceSnapshot<GoogleCalendarSnapshot>
    | undefined,
  source: CalendarAttentionSource
): AttentionSupportingSourceMonitor {
  if (
    !snapshot ||
    snapshot.status === "unavailable" ||
    source.status === "unavailable"
  ) {
    return {
      source: "google_calendar",
      inputState: "unavailable",
      unavailableReason:
        snapshot?.status === "unavailable"
          ? snapshot.reason
          : source.status === "unavailable"
            ? source.reason
            : "SNAPSHOT_MISSING",
      freshness: null,
      snapshotFetchedAt: null,
      sourceSnapshotSha256: null,
      adapterVersion: null,
      itemCount: 0,
      mappedItemCount: 0,
      truncated: null
    };
  }
  return {
    source: "google_calendar",
    inputState: "available",
    unavailableReason: null,
    freshness: source.freshness,
    snapshotFetchedAt: source.fetchedAt,
    sourceSnapshotSha256: runtimeSha256({
      domain: "blabase-google-calendar-snapshot-provenance-v0.1",
      snapshot: snapshot.snapshot
    }),
    adapterVersion: source.adapterVersion,
    itemCount: source.constraints.length,
    mappedItemCount:
      source.projectId === null ? 0 : source.constraints.length,
    truncated: source.truncated
  };
}

function supportingNotionMonitor(
  snapshot: LiveSourceSnapshot<NotionSnapshot> | undefined,
  source: NotionAttentionSource
): AttentionSupportingSourceMonitor {
  if (
    !snapshot ||
    snapshot.status === "unavailable" ||
    source.status === "unavailable"
  ) {
    return {
      source: "notion",
      inputState: "unavailable",
      unavailableReason:
        snapshot?.status === "unavailable"
          ? snapshot.reason
          : source.status === "unavailable"
            ? source.reason
            : "SNAPSHOT_MISSING",
      freshness: null,
      snapshotFetchedAt: null,
      sourceSnapshotSha256: null,
      adapterVersion: null,
      itemCount: 0,
      mappedItemCount: 0,
      truncated: null
    };
  }
  return {
    source: "notion",
    inputState: "available",
    unavailableReason: null,
    freshness: source.freshness,
    snapshotFetchedAt: source.fetchedAt,
    sourceSnapshotSha256: runtimeSha256({
      domain: "blabase-notion-snapshot-provenance-v0.1",
      snapshot: snapshot.snapshot
    }),
    adapterVersion: source.adapterVersion,
    itemCount: source.resources.length,
    mappedItemCount: source.resources.filter(
      (resource) => resource.projectId !== null
    ).length,
    truncated: source.truncated
  };
}

async function readGitHubSource(
  cwd: string,
  now: Date,
  env: NodeJS.ProcessEnv
): Promise<LiveSourceSnapshot<GitHubSnapshot>> {
  const configResult = loadGitHubConfig(env);
  const [tokens, snapshot] = await Promise.all([
    readStoredGitHubTokens(cwd),
    readStoredGitHubSnapshot(cwd)
  ]);
  if (
    !configResult.ok ||
    !tokens ||
    tokens.appClientId !== configResult.config.clientId ||
    tokens.appSlug !== configResult.config.appSlug ||
    Date.parse(tokens.refreshTokenExpiresAt) <= now.getTime()
  ) {
    return {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    };
  }
  if (
    !snapshot ||
    snapshot.appClientId !== configResult.config.clientId ||
    snapshot.appSlug !== configResult.config.appSlug
  ) {
    return { status: "unavailable", reason: "COLLECTION_FAILED" };
  }
  return { status: "available", snapshot };
}

async function readCodexSource(
  cwd: string
): Promise<LiveSourceSnapshot<CodexSnapshot>> {
  const [config, snapshot] = await Promise.all([
    readStoredCodexConfig(cwd),
    readStoredCodexSnapshot(cwd)
  ]);
  if (
    !config ||
    config.selectedScopeIds.length === 0 ||
    !config.selectedScopeIds.some((scopeId) =>
      config.scopes.some((scope) => scope.id === scopeId)
    )
  ) {
    return {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    };
  }
  if (!snapshot || !codexSnapshotMatchesConfig(snapshot, config)) {
    return { status: "unavailable", reason: "COLLECTION_FAILED" };
  }
  return { status: "available", snapshot };
}

async function readCalendarSource(
  cwd: string
): Promise<LiveSourceSnapshot<GoogleCalendarSnapshot>> {
  const [tokens, snapshot] = await Promise.all([
    readStoredCalendarTokens(cwd),
    readStoredCalendarSnapshot(cwd)
  ]);
  if (!tokens) {
    return {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    };
  }
  return snapshot &&
    googleCalendarSnapshotMatchesTokens(snapshot, tokens)
    ? { status: "available", snapshot }
    : { status: "unavailable", reason: "COLLECTION_FAILED" };
}

async function readNotionSource(
  cwd: string
): Promise<LiveSourceSnapshot<NotionSnapshot>> {
  const [tokens, snapshot] = await Promise.all([
    readStoredNotionTokens(cwd),
    readStoredNotionSnapshot(cwd)
  ]);
  if (!tokens) {
    return {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    };
  }
  return snapshot && notionSnapshotMatchesTokens(snapshot, tokens)
    ? { status: "available", snapshot }
    : { status: "unavailable", reason: "COLLECTION_FAILED" };
}

function attentionSourceScopes(
  snapshots: Required<
    Pick<
      AttentionSnapshots,
      "github" | "codex" | "googleCalendar" | "notion"
    >
  >
): SourceScopeRef[] {
  const scopes: SourceScopeRef[] = [];
  if (snapshots.github.status === "available") {
    scopes.push(
      ...snapshots.github.snapshot.repositories.map((repository) => ({
        source: "github" as const,
        resourceType: "repository" as const,
        opaqueId: String(repository.id)
      }))
    );
  }
  if (snapshots.codex.status === "available") {
    scopes.push(
      ...snapshots.codex.snapshot.scopeIds.map((scopeId) => ({
        source: "codex" as const,
        resourceType: "scope" as const,
        opaqueId: scopeId
      }))
    );
  }
  if (snapshots.googleCalendar.status === "available") {
    scopes.push({
      source: "google_calendar",
      resourceType: "scope",
      opaqueId: googleCalendarSnapshotScopeId(
        snapshots.googleCalendar.snapshot
      )
    });
  }
  if (snapshots.notion.status === "available") {
    scopes.push(
      ...snapshots.notion.snapshot.resources.map((resource) => ({
        source: "notion" as const,
        resourceType: "resource" as const,
        opaqueId: resource.id
      }))
    );
  }
  return scopes;
}

function inputStateFor(
  reason: LiveUnavailableReason
):
  | "missing"
  | "rejected"
  | "disconnected"
  | "collection_failed" {
  switch (reason) {
    case "CONNECTOR_DISCONNECTED":
      return "disconnected";
    case "COLLECTION_FAILED":
      return "collection_failed";
    case "SNAPSHOT_MISSING":
      return "missing";
    case "SNAPSHOT_PARSE_FAILED":
    case "SNAPSHOT_SCHEMA_UNSUPPORTED":
      return "rejected";
  }
}
