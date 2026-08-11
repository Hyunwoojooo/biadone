import {
  attachWorkArtifactAttribution,
  createGitHubArtifactId,
  createEmptyWorkArtifactAttributionStore,
  resolveManagedCodexArtifactRelations,
  type ManagedCodexArtifactRelationProjection
} from "../../src/artifacts";
import { sealActiveAttentionInput } from "../../src/attentionDecision";
import { resolveCurrentClaimAuthority } from "../../src/claims";
import {
  observeCodexManagedNotification,
  type CodexManagedNotification
} from "../../src/connectors/codex/observationContract";
import { normalizeGitHubSnapshotToWorkSignals } from "../../src/connectors/github/toWorkSignals";
import type {
  GitHubPullRequestActionabilitySignal,
  GitHubSnapshot,
  GitHubTaskSignal,
  GitHubUserActivitySignal
} from "../../src/connectors/github/types";
import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  hashWorkContextRegistryContent,
  workContextRegistrySchema
} from "../../src/context";
import {
  phase2AttentionInput,
  phase2AvailableSource,
  phase2UnavailableSource
} from "../../src/crossSource/runAttentionRouter";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../../src/crossSource/versions";
import { resolveAttentionEligibilityShadow } from "../../src/eligibility";
import {
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
  buildManagedCodexSemanticProjection,
  createManagedCodexEvent,
  managedCodexPublicSourceEventSchema,
  sealManagedCodexHistory,
  type ManagedCodexEvent,
  type ManagedCodexEventHistory,
  type ManagedCodexPublicProjection,
  type ManagedCodexPublicRunProjection
} from "../../src/managedCodex";
import {
  bindWorkSessionDecision,
  createEmptyWorkSessionBindingStore
} from "../../src/resumption";
import { resolveManagedCodexWorkRelations } from "../../src/relations";
import {
  PROJECT_WORKFLOW_GRACE_PERIOD_MS,
  PROJECT_WORKFLOW_POLICY_VERSION,
  PROJECT_WORKFLOW_SCHEMA_VERSION,
  PROJECT_WORKFLOW_STORE_CONTRACT,
  projectWorkflowClosure,
  projectWorkflowDecision,
  resolveProjectWorkflowProjection,
  sealProjectWorkflowStore,
  type ProjectWorkflowActionKind
} from "../../src/workflows/contracts";

export const ACTIVE_FIXTURE_AS_OF = "2026-08-02T03:00:00.000Z";
export const ACTIVE_FIXTURE_PROJECT_ID = `project_${"1".repeat(32)}`;
export const ACTIVE_FIXTURE_CONFLICT_PROJECT_ID = `project_${"8".repeat(32)}`;
export const ACTIVE_FIXTURE_MANAGED_RUN_ID = `managed_run_${"2".repeat(32)}`;
export const ACTIVE_FIXTURE_EXECUTION_ID = `codex:execution:${"3".repeat(24)}`;

const FETCHED_AT = "2026-08-02T02:59:00.000Z";
const MANAGED_STARTED_AT = "2026-08-02T02:50:00.000Z";
const WORKFLOW_CONFIGURED_AT = "2026-08-02T02:45:00.000Z";
const SCOPE_ID = "4".repeat(24);
const OPAQUE_EXECUTION_ID = "3".repeat(24);
const OWNER_ID = `instance_${"5".repeat(32)}`;
const STREAM_ID = `stream_${"6".repeat(32)}`;
const THREAD_ID = "PRIVATE_CODEX_THREAD_SENTINEL";
const SECOND_MANAGED_IDENTITY = {
  managedRunId: `managed_run_${"a".repeat(32)}`,
  executionId: `codex:execution:${"b".repeat(24)}`,
  opaqueExecutionId: "b".repeat(24),
  scopeId: "c".repeat(24),
  ownerId: `instance_${"d".repeat(32)}`,
  streamId: `stream_${"e".repeat(32)}`,
  threadId: "PRIVATE_SECOND_CODEX_THREAD_SENTINEL",
  startedAt: "2026-08-02T02:51:00.000Z"
} as const;

const PRIMARY_MANAGED_IDENTITY = {
  managedRunId: ACTIVE_FIXTURE_MANAGED_RUN_ID,
  executionId: ACTIVE_FIXTURE_EXECUTION_ID,
  opaqueExecutionId: OPAQUE_EXECUTION_ID,
  scopeId: SCOPE_ID,
  ownerId: OWNER_ID,
  streamId: STREAM_ID,
  threadId: THREAD_ID,
  startedAt: MANAGED_STARTED_AT
} as const;

const SECOND_SAME_BINDING_IDENTITY = {
  ...SECOND_MANAGED_IDENTITY,
  executionId: ACTIVE_FIXTURE_EXECUTION_ID,
  opaqueExecutionId: OPAQUE_EXECUTION_ID,
  scopeId: SCOPE_ID
} as const;

type ManagedFixtureIdentity = {
  managedRunId: string;
  executionId: string;
  opaqueExecutionId: string;
  scopeId: string;
  ownerId: string;
  streamId: string;
  threadId: string;
  startedAt: string;
};

export type ActiveAttentionFixtureOptions = {
  githubKind?: GitHubTaskSignal["kind"] | "none";
  githubAvailability?: "available" | "unavailable";
  githubApiVersion?: string;
  githubFreshnessPolicyVersion?: string;
  githubObjectId?: number;
  githubTitle?: string;
  bindingGitHubObjectId?: number;
  bindManagedRun?: boolean;
  githubProjectMismatch?: boolean;
  deadlineAt?: string | null;
  githubActionability?: GitHubPullRequestActionabilitySignal;
  additionalGitHubTasks?: Array<{
    id: number;
    kind: GitHubTaskSignal["kind"];
    number: number;
    title?: string;
    repositoryId?: number;
    repositoryFullName?: string;
    deadlineAt?: string | null;
  }>;
  managedScenario?:
    | "none"
    | "running"
    | "failed"
    | "repeated_failed"
    | "failed_gap"
    | "run_failed"
    | "completed"
    | "recovered"
    | "gap"
    | "offline"
    | "ended_unknown"
    | "pruned";
  workflowAction?: ProjectWorkflowActionKind | null;
  workflowConfiguredAt?: string;
  workflowClosure?: "completed" | "skipped" | null;
  projectArchived?: boolean;
  artifactKind?: "github_commit" | "github_pull_request" | null;
  githubPushOccurredAt?: string | null;
  managedCompletedAt?: string;
  managedFailureAt?: string;
  primaryOutcome?: string | null;
  secondManagedFailure?: boolean;
  newerSameTargetScenario?: "running" | "completed";
};

export function activeAttentionFixture(
  options: ActiveAttentionFixtureOptions = {}
) {
  const githubKind = options.githubKind ?? "assigned_issue";
  const managedScenario = options.managedScenario ?? "none";
  const githubBatch =
    (options.githubAvailability ?? "available") === "unavailable"
      ? null
      : normalizeGitHub(
          [
            ...(githubKind === "none"
              ? []
              : [
                  githubTask({
                    id: options.githubObjectId ?? 501,
                    kind: githubKind,
                    number: 42,
                    title: options.githubTitle ?? "Synthetic linked task",
                    repositoryId: 101,
                    repositoryFullName: "synthetic/private",
                    deadlineAt: options.deadlineAt ?? null,
                    actionability: options.githubActionability
                  })
                ]),
            ...(options.additionalGitHubTasks ?? []).map((task) =>
              githubTask({
                id: task.id,
                kind: task.kind,
                number: task.number,
                title: task.title ?? "Synthetic linked task",
                repositoryId: task.repositoryId ?? 101,
                repositoryFullName:
                  task.repositoryFullName ?? "synthetic/private",
                deadlineAt: task.deadlineAt ?? null
              })
            )
          ],
          options.projectArchived ? null : ACTIVE_FIXTURE_PROJECT_ID,
          options.githubPushOccurredAt
            ? [githubPushActivity(options.githubPushOccurredAt)]
            : [],
          options.githubApiVersion,
          options.githubFreshnessPolicyVersion
        );
  const contextRegistry = mappedContextRegistry(
    options.githubProjectMismatch ?? false,
    options.projectArchived ?? false
  );
  const emptyBindings = createEmptyWorkSessionBindingStore(
    "2026-08-02T02:40:00.000Z"
  );
  const bindingResult =
    managedScenario === "none" ||
      githubKind === "none" ||
      options.bindManagedRun === false
      ? null
      : bindWorkSessionDecision(emptyBindings, {
          taskRef: {
            kind: "attention_subject",
            source: "github",
            subjectId: `github:object:${
              options.bindingGitHubObjectId ??
              options.githubObjectId ??
              501
            }`,
            displayTitle: "Synthetic linked work"
          },
          executionId: ACTIVE_FIXTURE_EXECUTION_ID,
          scopeId: SCOPE_ID,
          boundAt: "2026-08-02T02:48:00.000Z",
          explicitUserConfirmation: true
        });
  const primaryBindingStore = bindingResult?.store ?? emptyBindings;
  const secondBindingResult =
    options.secondManagedFailure && githubBatch !== null
      ? bindWorkSessionDecision(primaryBindingStore, {
          taskRef: {
            kind: "attention_subject",
            source: "github",
            subjectId: "github:object:502",
            displayTitle: "Synthetic second managed work"
          },
          executionId: SECOND_MANAGED_IDENTITY.executionId,
          scopeId: SECOND_MANAGED_IDENTITY.scopeId,
          boundAt: "2026-08-02T02:49:00.000Z",
          explicitUserConfirmation: true
        })
      : null;
  const bindingStore = secondBindingResult?.store ?? primaryBindingStore;

  const secondManagedAttempt = secondBindingResult
    ? {
        bindingId: secondBindingResult.binding.bindingId,
        identity: SECOND_MANAGED_IDENTITY,
        scenario: "failed" as const,
        eventAt: "2026-08-02T02:59:00.000Z"
      }
    : options.newerSameTargetScenario && bindingResult
      ? {
          bindingId: bindingResult.binding.bindingId,
          identity: SECOND_SAME_BINDING_IDENTITY,
          scenario: options.newerSameTargetScenario,
          eventAt: "2026-08-02T02:59:00.000Z"
        }
      : null;
  const managedData = buildManagedData(
    managedScenario,
    bindingResult?.binding.bindingId ?? `binding_${"7".repeat(32)}`,
    options.managedCompletedAt ?? "2026-08-02T02:57:00.000Z",
    options.managedFailureAt ?? "2026-08-02T02:58:00.000Z",
    secondManagedAttempt
  );
  const workRelations = resolveManagedCodexWorkRelations({
    asOf: ACTIVE_FIXTURE_AS_OF,
    managedProjection: managedData.publicProjection,
    bindingStore,
    githubBatch,
    contextRegistry
  });
  const artifactStore = buildArtifactStore({
    artifactKind: options.artifactKind ?? null,
    workRelations,
    bindingId: bindingResult?.binding.bindingId ?? null,
    enabled: managedScenario !== "none"
  });
  const artifacts = resolveManagedCodexArtifactRelations({
    asOf: ACTIVE_FIXTURE_AS_OF,
    workRelationProjection: workRelations,
    attributionStore: artifactStore,
    githubBatch
  });
  const claims = resolveCurrentClaimAuthority({
    asOf: ACTIVE_FIXTURE_AS_OF,
    managedProjection: managedData.publicProjection,
    managedSemantics: managedData.semanticProjection,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    githubBatch,
    contextRegistry
  });
  const eligibilityProjection = resolveAttentionEligibilityShadow({
    asOf: ACTIVE_FIXTURE_AS_OF,
    githubBatch,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    claimAuthorityProjection: claims
  });
  const workflowProjection = buildWorkflowProjection({
    action: options.workflowAction ?? null,
    configuredAt:
      options.workflowConfiguredAt ?? WORKFLOW_CONFIGURED_AT,
    closure: options.workflowClosure ?? null,
    bindingId: bindingResult?.binding.bindingId ?? null,
    enabled: managedScenario !== "none"
  });
  const baseAttentionInput = phase2AttentionInput({
    asOf: ACTIVE_FIXTURE_AS_OF,
    github:
      githubBatch === null
        ? phase2UnavailableSource("SNAPSHOT_MISSING")
        : phase2AvailableSource(githubBatch),
    codex: phase2UnavailableSource("SNAPSHOT_MISSING"),
    ...(options.primaryOutcome
      ? {
          focus: {
            primaryOutcome: options.primaryOutcome,
            capturedAt: "2026-08-02T02:00:00.000Z",
            validUntil: "2026-08-09T02:00:00.000Z"
          }
        }
      : {})
  });
  const input = sealActiveAttentionInput({
    contract: "cross-source-active-attention-input-v0.4",
    asOf: ACTIVE_FIXTURE_AS_OF,
    baseAttentionInput,
    githubBatch,
    eligibilityProjection,
    managedPublicProjection: managedData.publicProjection,
    managedSemanticProjection: managedData.semanticProjection,
    managedRunStartedAtById:
      managedScenario === "none"
        ? {}
        : {
            [ACTIVE_FIXTURE_MANAGED_RUN_ID]: MANAGED_STARTED_AT,
            ...(secondManagedAttempt
              ? {
                  [secondManagedAttempt.identity.managedRunId]:
                    secondManagedAttempt.identity.startedAt
                }
              : {})
          },
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    claimAuthorityProjection: claims,
    workflowProjection
  });

  return {
    input,
    githubBatch,
    managedPublicProjection: managedData.publicProjection,
    managedSemanticProjection: managedData.semanticProjection,
    workRelations,
    artifacts,
    claims,
    eligibilityProjection,
    workflowProjection,
    bindingStore,
    artifactStore,
    contextRegistry,
    bindingId: bindingResult?.binding.bindingId ?? null,
    privateCodexThreadSentinel: THREAD_ID
  };
}

type EventSpec =
  | { kind: "stream"; sourceEvent: "stream_connected" | "stream_disconnected" | "stream_reconnected" | "run_failed" | "run_closed"; at: string }
  | { kind: "turn_started"; at: string }
  | { kind: "turn_completed"; state: "completed" | "failed"; at: string };

function buildManagedData(
  scenario: NonNullable<ActiveAttentionFixtureOptions["managedScenario"]>,
  bindingId: string,
  managedCompletedAt: string,
  managedFailureAt: string,
  secondFailure: {
    bindingId: string;
    identity: ManagedFixtureIdentity;
    scenario: "failed" | "running" | "completed";
    eventAt: string;
  } | null
) {
  if (scenario === "none") {
    const publicProjection: ManagedCodexPublicProjection = {
      contract: "codex-managed-public-projection-v1",
      revision: 0,
      generatedAt: ACTIVE_FIXTURE_AS_OF,
      runs: []
    };
    return {
      publicProjection,
      semanticProjection: buildManagedCodexSemanticProjection({
        sourceRevision: 0,
        generatedAt: ACTIVE_FIXTURE_AS_OF,
        runs: []
      })
    };
  }
  const specs: EventSpec[] =
    scenario === "failed" ||
    scenario === "repeated_failed" ||
    scenario === "failed_gap"
      ? [
          { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:55:00.000Z" },
          { kind: "turn_started", at: "2026-08-02T02:56:00.000Z" },
          { kind: "turn_completed", state: "failed", at: managedFailureAt },
          ...(scenario === "repeated_failed"
            ? [
                {
                  kind: "turn_completed" as const,
                  state: "failed" as const,
                  at: new Date(
                    Date.parse(managedFailureAt) + 30_000
                  ).toISOString()
                }
              ]
            : [])
        ]
      : scenario === "run_failed"
        ? [
            { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:55:00.000Z" },
            { kind: "stream", sourceEvent: "run_failed", at: "2026-08-02T02:58:00.000Z" }
          ]
        : scenario === "completed" || scenario === "pruned"
          ? [
              { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:54:00.000Z" },
              { kind: "turn_started", at: "2026-08-02T02:55:00.000Z" },
              { kind: "turn_completed", state: "completed", at: managedCompletedAt }
            ]
          : scenario === "recovered"
            ? [
                { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:52:00.000Z" },
                { kind: "turn_started", at: "2026-08-02T02:53:00.000Z" },
                { kind: "turn_completed", state: "failed", at: "2026-08-02T02:54:00.000Z" },
                { kind: "turn_started", at: "2026-08-02T02:58:00.000Z" }
              ]
            : scenario === "gap"
              ? [
                  { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:54:00.000Z" },
                  { kind: "stream", sourceEvent: "stream_disconnected", at: "2026-08-02T02:55:00.000Z" },
                  { kind: "stream", sourceEvent: "stream_reconnected", at: "2026-08-02T02:56:00.000Z" }
                ]
              : scenario === "ended_unknown"
                ? [
                    { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:54:00.000Z" },
                    { kind: "turn_started", at: "2026-08-02T02:55:00.000Z" },
                    { kind: "stream", sourceEvent: "run_closed", at: "2026-08-02T02:58:00.000Z" }
                  ]
              : [
                  { kind: "stream", sourceEvent: "stream_connected", at: "2026-08-02T02:55:00.000Z" },
                  { kind: "turn_started", at: "2026-08-02T02:58:00.000Z" }
                ];
  const history = makeHistory(specs, {
    anchored: scenario === "pruned",
    identity: PRIMARY_MANAGED_IDENTITY
  });
  const run = publicRun(history, bindingId, PRIMARY_MANAGED_IDENTITY, {
    continuity:
      scenario === "gap" || scenario === "failed_gap"
        ? "gap_detected"
        : "continuous",
    ...(scenario === "offline"
      ? {
          streamState: "disconnected" as const,
          effectiveExecutionState: "unknown" as const,
          liveObservationAvailable: false
        }
      : scenario === "ended_unknown"
        ? {
            lifecycle: "ended" as const,
            streamState: "closed" as const,
            effectiveExecutionState: "unknown" as const,
            lastVerifiedExecutionState: "running" as const,
            liveObservationAvailable: false
          }
      : {})
  });
  const secondHistory = secondFailure
    ? makeHistory(
        [
          {
            kind: "stream",
            sourceEvent: "stream_connected",
            at: "2026-08-02T02:56:30.000Z"
          },
          { kind: "turn_started", at: "2026-08-02T02:57:00.000Z" },
          ...(secondFailure.scenario === "running"
            ? []
            : [
                {
                  kind: "turn_completed" as const,
                  state:
                    secondFailure.scenario === "failed"
                      ? ("failed" as const)
                      : ("completed" as const),
                  at: secondFailure.eventAt
                }
              ])
        ],
        { anchored: false, identity: secondFailure.identity }
      )
    : null;
  const secondRun =
    secondFailure && secondHistory
      ? publicRun(
          secondHistory,
          secondFailure.bindingId,
          secondFailure.identity,
          { continuity: "continuous" }
        )
      : null;
  const revision = secondRun ? 2 : 1;
  const publicProjection: ManagedCodexPublicProjection = {
    contract: "codex-managed-public-projection-v1",
    revision,
    generatedAt: ACTIVE_FIXTURE_AS_OF,
    runs: [run, ...(secondRun ? [secondRun] : [])]
  };
  return {
    publicProjection,
    semanticProjection: buildManagedCodexSemanticProjection({
      sourceRevision: revision,
      generatedAt: ACTIVE_FIXTURE_AS_OF,
      runs: [
        { run, history },
        ...(secondRun && secondHistory
          ? [{ run: secondRun, history: secondHistory }]
          : [])
      ]
    })
  };
}

function publicRun(
  history: ManagedCodexEventHistory,
  bindingId: string,
  identity: ManagedFixtureIdentity,
  overrides: Partial<ManagedCodexPublicRunProjection>
): ManagedCodexPublicRunProjection {
  const last = history.events.at(-1);
  const sourceEvent = managedCodexPublicSourceEventSchema.parse(
    last?.observation?.sourceEvent ?? last?.streamKind ?? "run_started"
  );
  const executionState = last?.observation?.executionState ?? "unknown";
  const failed = sourceEvent === "run_failed";
  return {
    managedRunId: identity.managedRunId,
    bindingId,
    executionId: identity.executionId,
    lifecycle: failed ? "failed" : "observing",
    streamState: failed
      ? "closed"
      : sourceEvent === "stream_disconnected"
        ? "disconnected"
        : "connected",
    continuity: "continuous",
    effectiveExecutionState: executionState,
    lastVerifiedExecutionState: executionState,
    waitingState: last?.observation?.waitingState ?? null,
    sourceEvent,
    itemType: last?.itemType ?? null,
    lastObservedAt: last?.observedAt ?? identity.startedAt,
    liveObservationAvailable:
      !failed && sourceEvent !== "stream_disconnected",
    forbiddenAsAttentionCandidate: true,
    ...overrides
  };
}

function makeHistory(
  specs: EventSpec[],
  options: {
    anchored: boolean;
    identity: ManagedFixtureIdentity;
  }
): ManagedCodexEventHistory {
  const startSequence = options.anchored ? 4 : 0;
  let previousEventSha256: string | null = options.anchored
    ? "9".repeat(64)
    : null;
  const events: ManagedCodexEvent[] = specs.map((spec, index) => {
    const sequence = startSequence + index;
    const observation = nativeObservation(
      spec,
      sequence,
      options.identity
    );
    const event = createManagedCodexEvent({
      managedRunId: options.identity.managedRunId,
      sequence,
      ownerInstanceId: options.identity.ownerId,
      streamGeneration: options.identity.streamId,
      observedAt: spec.at,
      retentionAt: new Date(
        Date.parse("2026-08-02T02:40:00.000Z") + index * 1_000
      ).toISOString(),
      kind: spec.kind === "stream" ? "stream_lifecycle" : "native_notification",
      streamKind: spec.kind === "stream" ? spec.sourceEvent : null,
      observation,
      itemType: null,
      previousEventSha256
    });
    previousEventSha256 = event.eventSha256;
    return event;
  });
  return sealManagedCodexHistory({
    contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    managedRunId: options.identity.managedRunId,
    updatedAt: specs.at(-1)?.at ?? options.identity.startedAt,
    anchor: options.anchored
      ? {
          prunedThroughSequence: startSequence - 1,
          prunedThroughEventSha256: "9".repeat(64),
          anchoredAt: options.identity.startedAt
        }
      : null,
    events
  });
}

function nativeObservation(
  spec: EventSpec,
  sequence: number,
  identity: ManagedFixtureIdentity
) {
  if (spec.kind === "stream") return null;
  const notification: CodexManagedNotification =
    spec.kind === "turn_started"
      ? {
          method: "turn/started",
          params: {
            threadId: identity.threadId,
            turn: { id: `turn-${sequence}`, status: "inProgress" }
          }
        }
      : {
          method: "turn/completed",
          params: {
          threadId: identity.threadId,
            turn: { id: `turn-${sequence}`, status: spec.state }
          }
        };
  return observeCodexManagedNotification({
    notification,
    executionId: identity.opaqueExecutionId,
    expectedThreadId: identity.threadId,
    observedAt: spec.at,
    sequence
  });
}

function normalizeGitHub(
  tasks: GitHubTaskSignal[],
  projectId: string | null,
  activities: GitHubUserActivitySignal[] = [],
  apiVersion?: string,
  freshnessPolicyVersion: string = SNAPSHOT_VALIDITY_POLICY_VERSION
) {
  const result = normalizeGitHubSnapshotToWorkSignals(
    githubSnapshot(tasks, activities, apiVersion),
    {
    asOf: ACTIVE_FIXTURE_AS_OF,
    freshnessPolicy: {
      version: freshnessPolicyVersion,
      maxAgeMsBySource: {
        github: 10 * 60 * 1_000,
        codex: 10 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60_000
    },
    contextRegistrySha256: null,
    resolveProjectId: (sourceScopeId) =>
      sourceScopeId === "repository:101" ? projectId : null
    }
  );
  if (result.status !== "normalized") {
    throw new TypeError("Synthetic GitHub batch did not normalize.");
  }
  return result.batch;
}

function githubSnapshot(
  tasks: GitHubTaskSignal[],
  activities: GitHubUserActivitySignal[],
  apiVersion = "2022-11-28"
): GitHubSnapshot {
  const authored = tasks.filter(
    (task) => task.kind === "authored_pull_request"
  );
  const actionabilityCollected = authored.filter(
    (task) => task.actionability !== undefined
  );
  const usesActionabilityV3 = actionabilityCollected.length > 0;
  const usesPushArtifactV4 = activities.some(
    (activity) => activity.artifactId !== undefined
  );
  return {
    schemaVersion: usesPushArtifactV4
      ? "github-snapshot-v4"
      : usesActionabilityV3
        ? "github-snapshot-v3"
        : "github-snapshot-v2",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion,
    fetchedAt: FETCHED_AT,
    user: { id: 1, login: "synthetic" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    ...(usesActionabilityV3 || usesPushArtifactV4
      ? {
          actionabilityCoverage: {
            state:
              actionabilityCollected.length === authored.length &&
              actionabilityCollected.every(
                (task) =>
                  task.actionability?.collectionState === "complete"
              )
                ? ("complete" as const)
                : ("partial" as const),
            authoredPullRequestCount: authored.length,
            attemptedCount: authored.length,
            collectedCount: actionabilityCollected.length,
            truncated: false
          }
        }
      : {}),
    installations: [
      {
        id: 1,
        accountLogin: "synthetic",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      ...new Map(
        [
          {
            id: 101,
            fullName: "synthetic/private"
          },
          ...tasks.map((task) => ({
            id: task.repositoryId,
            fullName: task.repositoryFullName
          }))
        ].map((repository) => [repository.id, repository])
      ).values()
    ].map((repository) => ({
      id: repository.id,
      source: "github" as const,
      kind: "repository" as const,
      installationId: 1,
      fullName: repository.fullName,
      private: true,
      archived: false,
      updatedAt: FETCHED_AT
    })),
    tasks,
    activities
  };
}

function githubPushActivity(
  occurredAt: string
): GitHubUserActivitySignal {
  return {
    id: "synthetic-push-event",
    source: "github",
    kind: "user_activity",
    activityKind: "push",
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    occurredAt,
    subjectType: "branch",
    subjectNumber: null,
    subjectTitle: null,
    refName: "main",
    reviewState: null,
    artifactId: createGitHubArtifactId({
      kind: "github_commit",
      repositoryId: 101,
      oid: "a".repeat(40)
    })
  };
}

function githubTask(input: {
  id: number;
  kind: GitHubTaskSignal["kind"];
  number: number;
  title: string;
  repositoryId: number;
  repositoryFullName: string;
  deadlineAt: string | null;
  actionability?: GitHubPullRequestActionabilitySignal;
}): GitHubTaskSignal {
  const pullRequest = input.kind !== "assigned_issue";
  return {
    id: input.id,
    source: "github",
    kind: input.kind,
    repositoryId: input.repositoryId,
    repositoryFullName: input.repositoryFullName,
    number: input.number,
    title: input.title,
    htmlUrl: pullRequest
      ? `https://github.com/${input.repositoryFullName}/pull/${input.number}`
      : `https://github.com/${input.repositoryFullName}/issues/${input.number}`,
    labelNames: [],
    milestoneDueAt: input.deadlineAt,
    state: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: FETCHED_AT,
    ...(input.actionability
      ? { actionability: input.actionability }
      : {})
  };
}

function mappedContextRegistry(
  githubProjectMismatch: boolean,
  projectArchived: boolean
) {
  let registry = createProjectIdentity(
    createEmptyWorkContextRegistry("2026-08-02T02:30:00.000Z"),
    {
      projectId: ACTIVE_FIXTURE_PROJECT_ID,
      createdAt: "2026-08-02T02:31:00.000Z"
    }
  ).registry;
  registry = confirmProjectMapping(registry, {
    scope: {
      source: "codex",
      resourceType: "scope",
      opaqueId: SCOPE_ID
    },
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    confirmedAt: "2026-08-02T02:32:00.000Z",
    explicitUserConfirmation: true
  }).registry;
  registry = confirmProjectMapping(registry, {
    scope: {
      source: "codex",
      resourceType: "scope",
      opaqueId: SECOND_MANAGED_IDENTITY.scopeId
    },
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    confirmedAt: "2026-08-02T02:32:15.000Z",
    explicitUserConfirmation: true
  }).registry;
  if (githubProjectMismatch) {
    registry = createProjectIdentity(registry, {
      projectId: ACTIVE_FIXTURE_CONFLICT_PROJECT_ID,
      createdAt: "2026-08-02T02:32:30.000Z"
    }).registry;
  }
  registry = confirmProjectMapping(registry, {
    scope: {
      source: "github",
      resourceType: "repository",
      opaqueId: "101"
    },
    projectId: githubProjectMismatch
      ? ACTIVE_FIXTURE_CONFLICT_PROJECT_ID
      : ACTIVE_FIXTURE_PROJECT_ID,
    confirmedAt: "2026-08-02T02:33:00.000Z",
    explicitUserConfirmation: true
  }).registry;
  if (!projectArchived) return registry;

  const { registrySha256: _registrySha256, ...content } = registry;
  const archivedContent = {
    ...content,
    revision: content.revision + 1,
    updatedAt: "2026-08-02T02:44:00.000Z",
    projects: content.projects.map((project) =>
      project.projectId === ACTIVE_FIXTURE_PROJECT_ID
        ? {
            ...project,
            archivedAt: "2026-08-02T02:44:00.000Z"
          }
        : project
    )
  };
  return workContextRegistrySchema.parse({
    ...archivedContent,
    registrySha256: hashWorkContextRegistryContent(archivedContent)
  });
}

function buildArtifactStore(input: {
  artifactKind: ActiveAttentionFixtureOptions["artifactKind"];
  workRelations: ReturnType<typeof resolveManagedCodexWorkRelations>;
  bindingId: string | null;
  enabled: boolean;
}) {
  const empty = createEmptyWorkArtifactAttributionStore(
    "2026-08-02T02:40:00.000Z"
  );
  const relation = input.workRelations.relations[0];
  if (!input.artifactKind || !input.enabled || !relation || !input.bindingId) {
    return empty;
  }
  return attachWorkArtifactAttribution(empty, {
    managedRunId: ACTIVE_FIXTURE_MANAGED_RUN_ID,
    bindingId: input.bindingId,
    executionId: ACTIVE_FIXTURE_EXECUTION_ID,
    executesRelationId: relation.relationId,
    artifact:
      input.artifactKind === "github_commit"
        ? {
            kind: "github_commit",
            repositoryId: 101,
            oid: "a".repeat(40)
          }
        : {
            kind: "github_pull_request",
            repositoryId: 101,
            objectId: 501,
            number: 42
          },
    attachedAt: "2026-08-02T02:58:00.000Z",
    explicitUserConfirmation: true
  }).store;
}

function buildWorkflowProjection(input: {
  action: ProjectWorkflowActionKind | null;
  configuredAt: string;
  closure: "completed" | "skipped" | null;
  bindingId: string | null;
  enabled: boolean;
}) {
  if (!input.action || !input.enabled || !input.bindingId) {
    return resolveProjectWorkflowProjection({
      store: sealProjectWorkflowStore({
        contract: PROJECT_WORKFLOW_STORE_CONTRACT,
        schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
        policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
        revision: 0,
        updatedAt: "2026-08-02T02:40:00.000Z",
        decisions: [],
        closures: []
      }),
      asOf: ACTIVE_FIXTURE_AS_OF
    });
  }
  const decision = projectWorkflowDecision({
    sequence: 1,
    operation: "configure",
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    actionKind: input.action,
    configuredAt: input.configuredAt,
    decidedAt: input.configuredAt,
    decisionSource: "explicit_user",
    supersedesWorkflowDecisionId: null,
    gracePeriodMs: PROJECT_WORKFLOW_GRACE_PERIOD_MS
  });
  const closure = input.closure
    ? projectWorkflowClosure({
        sequence: 2,
        managedRunId: ACTIVE_FIXTURE_MANAGED_RUN_ID,
        bindingId: input.bindingId,
        executionId: ACTIVE_FIXTURE_EXECUTION_ID,
        workflowDecisionId: decision.workflowDecisionId,
        actionKind: input.action,
        outcome: input.closure,
        decidedAt: "2026-08-02T02:59:00.000Z",
        decisionSource: "explicit_user"
      })
    : null;
  return resolveProjectWorkflowProjection({
    store: sealProjectWorkflowStore({
      contract: PROJECT_WORKFLOW_STORE_CONTRACT,
      schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
      policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
      revision: closure ? 2 : 1,
      updatedAt: closure?.decidedAt ?? decision.decidedAt,
      decisions: [decision],
      closures: closure ? [closure] : []
    }),
    asOf: ACTIVE_FIXTURE_AS_OF
  });
}

export type ActiveAttentionFixtureArtifactProjection =
  ManagedCodexArtifactRelationProjection;
