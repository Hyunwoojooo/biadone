import {
  managedCodexPublicProjectionDependencySha256,
  managedCodexRunStartTimesSha256
} from "../attentionDecision/contracts";
import {
  createGitHubArtifactId,
  managedCodexArtifactRelationProjectionSchema,
  type ManagedCodexArtifactRelation,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts/contracts";
import { ATTENTION_LIVE_FRESHNESS_POLICY_VERSION } from "../attention/versions";
import {
  claimAuthorityProjectionSchema,
  createClaimTargetRef,
  type ClaimAuthorityProjection
} from "../claims/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";
import {
  RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
  RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION,
  RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
  SNAPSHOT_VALIDITY_POLICY_VERSION
} from "../crossSource/versions";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema,
  type ManagedCodexPublicProjection,
  type ManagedCodexSemanticProjection
} from "../managedCodex";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelation,
  type ManagedCodexWorkRelationProjection
} from "../relations/contracts";
import {
  compareRecentMeaningfulEvents,
  createFocusEvidenceRef,
  createFocusIdentityRef,
  createFocusSubjectRef,
  createRecentEventDiagnosticId,
  createRecentMeaningfulEventId,
  MAX_RECENT_EVENT_DIAGNOSTICS,
  MAX_RECENT_MEANINGFUL_EVENTS,
  sealRecentMeaningfulEvent,
  sealRecentMeaningfulEventProjection,
  type RecentEventDiagnostic,
  type RecentMeaningfulEvent,
  type RecentMeaningfulEventContent,
  type RecentMeaningfulEventProjection
} from "./contracts";

const RECENT_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_EVENT_SKEW_MS = 60_000;
const REPEATED_MANAGED_FAILURE_WINDOW_MS = 60_000;
const REPEATED_MANAGED_FAILURE_MAX_SEQUENCE_GAP = 3;
const SUPPORTED_FRESHNESS_POLICY_VERSIONS = new Set<string>([
  SNAPSHOT_VALIDITY_POLICY_VERSION,
  ATTENTION_LIVE_FRESHNESS_POLICY_VERSION
]);

type GitHubWorkItemSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;

type GitHubActivitySignal = Extract<
  RuntimeWorkSignal,
  { kind: "activity_observation" }
>;

export type RecentMeaningfulEventProjectionInput = {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  codexInventoryBatch: RuntimeWorkSignalBatch | null;
  managedPublicProjection: ManagedCodexPublicProjection;
  managedSemanticProjection: ManagedCodexSemanticProjection;
  managedRunStartedAtById: Record<string, string>;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  claimAuthorityProjection: ClaimAuthorityProjection;
  contextRegistrySha256: string | null;
};

export function projectRecentMeaningfulEvents(
  input: RecentMeaningfulEventProjectionInput
): RecentMeaningfulEventProjection {
  const parsed = parseInput(input);
  const events: RecentMeaningfulEvent[] = [];
  const diagnostics: RecentEventDiagnostic[] = [];

  const githubBridge = buildGitHubIdentityBridge(
    parsed.githubBatch,
    parsed.workRelationProjection
  );
  const githubArtifactBridge = buildGitHubArtifactBridge(
    parsed,
    githubBridge
  );
  projectGitHubEvents(
    parsed,
    githubBridge,
    githubArtifactBridge,
    events,
    diagnostics
  );
  projectCodexInventoryEvents(parsed, events, diagnostics);
  projectManagedCodexEvents(parsed, githubBridge, events, diagnostics);

  const uniqueEvents = new Map<string, RecentMeaningfulEvent>();
  let duplicateCount = 0;
  for (const event of events) {
    const previous = uniqueEvents.get(event.eventId);
    if (!previous) {
      uniqueEvents.set(event.eventId, event);
      continue;
    }
    if (previous.eventSha256 !== event.eventSha256) {
      throw new TypeError(
        "Recent meaningful event identity has conflicting content."
      );
    }
    duplicateCount += 1;
    diagnostics.push(
      diagnostic({
        source: event.source,
        observationRef: event.nativeSubjectRef,
        eventId: event.eventId,
        disposition: "excluded",
        reasonCode: "EXCLUDED_DUPLICATE_EVENT"
      })
    );
  }
  const orderedEvents = [...uniqueEvents.values()].sort(
    compareRecentMeaningfulEvents
  );
  const orderedDiagnostics = [...diagnostics].sort((left, right) =>
    compareRuntimeStrings(left.diagnosticId, right.diagnosticId)
  );
  const retainedEvents = orderedEvents.slice(
    0,
    MAX_RECENT_MEANINGFUL_EVENTS
  );
  const retainedDiagnostics = orderedDiagnostics.slice(
    0,
    MAX_RECENT_EVENT_DIAGNOSTICS
  );
  const dependencies = {
    githubBatchSha256: parsed.githubBatch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      parsed.githubBatch?.sourceSnapshotSha256 ?? null,
    codexInventoryBatchSha256:
      parsed.codexInventoryBatch?.batchSha256 ?? null,
    codexInventorySourceSnapshotSha256:
      parsed.codexInventoryBatch?.sourceSnapshotSha256 ?? null,
    managedPublicProjectionSha256:
      managedCodexPublicProjectionDependencySha256(
        parsed.managedPublicProjection
      ),
    managedRunStartedAtByIdSha256: managedCodexRunStartTimesSha256(
      parsed.managedRunStartedAtById
    ),
    managedSourceRevision: parsed.managedPublicProjection.revision,
    managedGeneratedAt: parsed.managedPublicProjection.generatedAt,
    managedSemanticProjectionSha256:
      parsed.managedSemanticProjection.projectionSha256,
    workRelationProjectionSha256:
      parsed.workRelationProjection.projectionSha256,
    artifactRelationProjectionSha256:
      parsed.artifactRelationProjection.projectionSha256,
    claimAuthorityProjectionSha256:
      parsed.claimAuthorityProjection.projectionSha256,
    contextRegistrySha256: parsed.contextRegistrySha256
  };
  const inputSha256 = runtimeSha256({
    domain: "recent-meaningful-event-input-v0.1",
    asOf: parsed.asOf,
    dependencies,
    schemaVersion: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION
  });
  return sealRecentMeaningfulEventProjection({
    contract: RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
    schemaVersion: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    asOf: parsed.asOf,
    dependencies,
    inputSha256,
    coverage: {
      github: githubActivityCoverage(parsed.githubBatch),
      codexManaged: managedCoverage(
        parsed.managedPublicProjection,
        parsed.managedSemanticProjection
      ),
      codexInventory: inventoryCoverage(parsed.codexInventoryBatch)
    },
    events: retainedEvents,
    diagnostics: retainedDiagnostics,
    counts: {
      included: retainedEvents.filter(
        (event) => event.attentionCapability === "focus_selector"
      ).length,
      contextOnly: retainedEvents.filter(
        (event) =>
          event.attentionCapability === "historical_context_only"
      ).length,
      excluded: retainedDiagnostics.filter(
        (item) => item.disposition === "excluded"
      ).length,
      duplicate: duplicateCount,
      omittedMeaningfulEventCount:
        orderedEvents.length - retainedEvents.length,
      omittedDiagnosticCount:
        orderedDiagnostics.length - retainedDiagnostics.length
    },
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function parseInput(input: RecentMeaningfulEventProjectionInput) {
  const asOf = new Date(input.asOf).toISOString();
  const githubBatch = parseBatch(input.githubBatch, "github", asOf);
  const codexInventoryBatch = parseBatch(
    input.codexInventoryBatch,
    "codex",
    asOf
  );
  const managedPublicProjection = managedCodexPublicProjectionSchema.parse(
    input.managedPublicProjection
  );
  const managedSemanticProjection =
    managedCodexSemanticProjectionSchema.parse(
      input.managedSemanticProjection
    );
  const workRelationProjection =
    managedCodexWorkRelationProjectionSchema.parse(
      input.workRelationProjection
    );
  const artifactRelationProjection =
    managedCodexArtifactRelationProjectionSchema.parse(
      input.artifactRelationProjection
    );
  const claimAuthorityProjection = claimAuthorityProjectionSchema.parse(
    input.claimAuthorityProjection
  );
  const githubBatchSha256 = githubBatch?.batchSha256 ?? null;
  const githubSourceSnapshotSha256 =
    githubBatch?.sourceSnapshotSha256 ?? null;
  if (
    managedPublicProjection.generatedAt !== asOf ||
    managedSemanticProjection.generatedAt !== asOf ||
    managedSemanticProjection.sourceRevision !==
      managedPublicProjection.revision ||
    workRelationProjection.asOf !== asOf ||
    artifactRelationProjection.asOf !== asOf ||
    claimAuthorityProjection.asOf !== asOf ||
    workRelationProjection.managedSourceRevision !==
      managedPublicProjection.revision ||
    workRelationProjection.managedGeneratedAt !==
      managedPublicProjection.generatedAt ||
    workRelationProjection.githubBatchSha256 !== githubBatchSha256 ||
    workRelationProjection.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    workRelationProjection.contextRegistrySha256 !==
      input.contextRegistrySha256 ||
    artifactRelationProjection.workRelationProjectionSha256 !==
      workRelationProjection.projectionSha256 ||
    artifactRelationProjection.githubBatchSha256 !== githubBatchSha256 ||
    artifactRelationProjection.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    claimAuthorityProjection.inputs.workRelationProjectionSha256 !==
      workRelationProjection.projectionSha256 ||
    claimAuthorityProjection.inputs.artifactRelationProjectionSha256 !==
      artifactRelationProjection.projectionSha256 ||
    claimAuthorityProjection.inputs.githubBatchSha256 !==
      githubBatchSha256 ||
    claimAuthorityProjection.inputs.githubSourceSnapshotSha256 !==
      githubSourceSnapshotSha256 ||
    claimAuthorityProjection.inputs.managedSourceRevision !==
      managedPublicProjection.revision ||
    claimAuthorityProjection.inputs.managedGeneratedAt !==
      managedPublicProjection.generatedAt ||
    claimAuthorityProjection.inputs.managedSemanticProjectionSha256 !==
      managedSemanticProjection.projectionSha256 ||
    claimAuthorityProjection.inputs.contextRegistrySha256 !==
      input.contextRegistrySha256
  ) {
    throw new TypeError(
      "Recent event inputs must share one exact evidence graph."
    );
  }
  const managedRunIds = new Set(
    managedPublicProjection.runs.map((run) => run.managedRunId)
  );
  if (
    Object.keys(input.managedRunStartedAtById).some(
      (managedRunId) => !managedRunIds.has(managedRunId)
    )
  ) {
    throw new TypeError("Managed run start map contains an unknown run.");
  }
  return {
    asOf,
    githubBatch,
    codexInventoryBatch,
    managedPublicProjection,
    managedSemanticProjection,
    managedRunStartedAtById: { ...input.managedRunStartedAtById },
    workRelationProjection,
    artifactRelationProjection,
    claimAuthorityProjection,
    contextRegistrySha256: input.contextRegistrySha256
  };
}

function parseBatch(
  batch: RuntimeWorkSignalBatch | null,
  source: "github" | "codex",
  asOf: string
): RuntimeWorkSignalBatch | null {
  if (batch === null) return null;
  const parsed = runtimeWorkSignalBatchSchema.parse(batch);
  const supportedSourceSchema =
    source === "github"
      ? [
          "github-snapshot-v2",
          "github-snapshot-v3",
          "github-snapshot-v4",
          "github-snapshot-v5",
          "github-snapshot-v6"
        ].includes(parsed.sourceSchemaVersion)
      : parsed.sourceSchemaVersion === "codex-snapshot-v3";
  if (
    parsed.source !== source ||
    parsed.assessment.asOf !== asOf ||
    !SUPPORTED_FRESHNESS_POLICY_VERSIONS.has(
      parsed.assessment.freshnessPolicyVersion
    ) ||
    !supportedSourceSchema ||
    !verifyRuntimeWorkSignalBatchIntegrity(parsed).ok
  ) {
    throw new TypeError("Recent event source batch is not request-time exact.");
  }
  return parsed;
}

type GitHubIdentityBridge = Map<
  string,
  {
    subjectId: string;
    identityRef: string;
    claimTargetRef: string;
    projectId: string | null;
    displayLabel: string;
    relationRefs: string[];
  }
>;

function buildGitHubIdentityBridge(
  batch: RuntimeWorkSignalBatch | null,
  workRelations: ManagedCodexWorkRelationProjection
): GitHubIdentityBridge {
  const bridge: GitHubIdentityBridge = new Map();
  if (batch === null) return bridge;
  for (const signal of batch.signals) {
    if (signal.kind !== "work_item_observation") continue;
    const relationRefs = workRelations.relations
      .filter(
        (relation) =>
          relation.identityStatus === "resolved" &&
          relation.bindingEvidence.bindingState === "active" &&
          relation.to.subjectId === signal.subjectId
      )
      .map((relation) => relation.relationId)
      .sort(compareRuntimeStrings);
    const value = {
      subjectId: signal.subjectId,
      identityRef: createFocusIdentityRef({
        source: "github",
        sourceScopeId: signal.sourceScopeId,
        subjectId: signal.subjectId
      }),
      claimTargetRef: createClaimTargetRef({
        kind: "github_work_item",
        identity: {
          sourceScopeId: signal.sourceScopeId,
          subjectId: signal.subjectId
        }
      }),
      projectId: signal.projectId,
      displayLabel: githubWorkItemLabel(
        signal.facts.objectType,
        signal.facts.number
      ),
      relationRefs
    };
    bridge.set(
      githubTupleKey(
        signal.sourceScopeId,
        signal.facts.objectType,
        signal.facts.number
      ),
      value
    );
    bridge.set(`subject:${signal.subjectId}`, value);
  }
  if (
    batch.normalizerVersion !==
    GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
  ) {
    return bridge;
  }
  for (const signal of batch.signals) {
    if (
      signal.kind !== "activity_observation" ||
      !("nativeSubjectId" in signal.facts) ||
      signal.facts.nativeSubjectId === null ||
      (signal.facts.subjectType !== "issue" &&
        signal.facts.subjectType !== "pull_request") ||
      signal.facts.subjectNumber === null
    ) {
      continue;
    }
    const nativeSubjectId = signal.facts.nativeSubjectId;
    const relations = workRelations.relations
      .filter(
        (relation) =>
          relation.identityStatus === "resolved" &&
          relation.bindingEvidence.bindingState === "active" &&
          relation.conflictCodes.length === 0 &&
          relation.to.subjectId === nativeSubjectId
      )
      .sort((left, right) =>
        compareRuntimeStrings(left.relationId, right.relationId)
      );
    const alignedProjectIds = canonical(
      relations
        .filter(
          (relation) => relation.projectAlignment.status === "aligned"
        )
        .map((relation) => relation.projectAlignment.projectId)
        .filter((projectId): projectId is string => projectId !== null)
    );
    if (alignedProjectIds.length > 1) {
      throw new TypeError(
        "GitHub native activity identity has conflicting project relations."
      );
    }
    const value = {
      subjectId: nativeSubjectId,
      identityRef: createFocusIdentityRef({
        source: "github",
        sourceScopeId: signal.sourceScopeId,
        subjectId: nativeSubjectId
      }),
      claimTargetRef: createClaimTargetRef({
        kind: "github_work_item",
        identity: {
          sourceScopeId: signal.sourceScopeId,
          subjectId: nativeSubjectId
        }
      }),
      projectId: alignedProjectIds[0] ?? signal.projectId,
      displayLabel: githubWorkItemLabel(
        signal.facts.subjectType,
        signal.facts.subjectNumber
      ),
      relationRefs: relations.map((relation) => relation.relationId)
    };
    const tupleKey = githubTupleKey(
      signal.sourceScopeId,
      signal.facts.subjectType,
      signal.facts.subjectNumber
    );
    for (const key of [tupleKey, `subject:${nativeSubjectId}`]) {
      const existing = bridge.get(key);
      if (
        existing &&
        (existing.subjectId !== value.subjectId ||
          existing.identityRef !== value.identityRef ||
          existing.claimTargetRef !== value.claimTargetRef)
      ) {
        throw new TypeError(
          "GitHub native activity identity conflicts with current work-item evidence."
        );
      }
      bridge.set(key, existing ?? value);
    }
  }
  return bridge;
}

type GitHubArtifactIdentityBridge = Map<
  string,
  {
    projectId: string | null;
    identityRefs: string[];
    claimTargetRefs: string[];
    relationRefs: string[];
    displayLabel: string;
  }
>;

function buildGitHubArtifactBridge(
  input: ReturnType<typeof parseInput>,
  nativeBridge: GitHubIdentityBridge
): GitHubArtifactIdentityBridge {
  const bridge: GitHubArtifactIdentityBridge = new Map();
  const batch = input.githubBatch;
  if (batch === null) return bridge;
  const workRelationsById = new Map(
    input.workRelationProjection.relations.map((relation) => [
      relation.relationId,
      relation
    ])
  );

  for (const artifactRelation of input.artifactRelationProjection.relations) {
    if (
      artifactRelation.artifact.kind !== "github_commit" ||
      artifactRelation.attributionLifecycle.state !== "active" ||
      artifactRelation.githubObservation.status !== "not_observed" ||
      artifactRelation.githubObservation.sourceSnapshotSha256 !==
        batch.sourceSnapshotSha256 ||
      artifactRelation.githubObservation.completeness !==
        (batch.assessment.completeness === "complete"
          ? "complete"
          : "truncated") ||
      artifactRelation.githubObservation.signalIds.length !== 0 ||
      artifactRelation.artifactId !==
        createGitHubArtifactId(artifactRelation.artifact)
    ) {
      continue;
    }
    const workRelation = workRelationsById.get(
      artifactRelation.executesRelationId
    );
    if (
      !workRelation ||
      !isExactActiveWorkRelation(workRelation, artifactRelation)
    ) {
      continue;
    }
    const nativeTarget = nativeBridge.get(
      `subject:${workRelation.to.subjectId}`
    );
    const relationRefs = canonical([
      workRelation.relationId,
      artifactRelation.relationId
    ]);
    const identityRefs = canonical([
      createFocusIdentityRef({
        source: "github",
        artifactId: artifactRelation.artifactId
      }),
      ...relationRefs.map((relationRef) =>
        createFocusIdentityRef({ relationRef })
      ),
      ...(nativeTarget ? [nativeTarget.identityRef] : [])
    ]);
    const observedSignals = batch.signals
      .filter(
        (signal): signal is GitHubActivitySignal =>
          signal.kind === "activity_observation" &&
          signal.facts.activityKind === "push" &&
          signal.facts.artifactId === artifactRelation.artifactId &&
          signal.sourceScopeId ===
            `repository:${artifactRelation.artifact.repositoryId}` &&
          signal.sourceUpdatedAt !== null
      )
      .sort((left, right) =>
        compareRuntimeStrings(left.signalId, right.signalId)
      );
    for (const signal of observedSignals) {
      bridge.set(signal.signalId, {
        projectId:
          workRelation.projectAlignment.status === "aligned"
            ? workRelation.projectAlignment.projectId
            : nativeTarget?.projectId ?? signal.projectId,
        identityRefs,
        claimTargetRefs: nativeTarget
          ? [nativeTarget.claimTargetRef]
          : [],
        relationRefs,
        displayLabel:
          nativeTarget?.displayLabel ?? "GitHub push"
      });
    }
  }
  return bridge;
}

function isExactActiveWorkRelation(
  relation: ManagedCodexWorkRelation,
  artifactRelation: ManagedCodexArtifactRelation
): boolean {
  return (
    relation.authority === "user_configured" &&
    relation.type === "executes" &&
    relation.bindingEvidence.bindingState === "active" &&
    relation.identityStatus === "resolved" &&
    relation.conflictCodes.length === 0 &&
    relation.projectAlignment.status !== "conflict" &&
    relation.from.kind === "execution" &&
    relation.from.source === "codex" &&
    relation.from.subjectId === artifactRelation.executionId &&
    relation.to.kind === "work_item" &&
    relation.to.source === "github" &&
    relation.bindingId === artifactRelation.bindingId &&
    relation.managedRunIds.includes(artifactRelation.managedRunId)
  );
}

function projectGitHubEvents(
  input: ReturnType<typeof parseInput>,
  bridge: GitHubIdentityBridge,
  artifactBridge: GitHubArtifactIdentityBridge,
  events: RecentMeaningfulEvent[],
  diagnostics: RecentEventDiagnostic[]
) {
  const batch = input.githubBatch;
  if (batch === null) return;
  for (const signal of batch.signals) {
    if (signal.kind === "activity_observation") {
      const kind = githubActivityKind(signal);
      const subjectRef = githubActivitySubjectRef(signal);
      if (signal.sourceUpdatedAt === null) {
        diagnostics.push(
          diagnostic({
            source: "github",
            observationRef: subjectRef,
            eventId: null,
            disposition: "excluded",
            reasonCode: "EXCLUDED_UNSUPPORTED_TRANSITION_TIMESTAMP"
          })
        );
        continue;
      }
      if (kind === null) {
        diagnostics.push(
          diagnostic({
            source: "github",
            observationRef: subjectRef,
            eventId: null,
            disposition: "excluded",
            reasonCode: "EXCLUDED_UNSUPPORTED_ACTIVITY_KIND"
          })
        );
        continue;
      }
      const tupleKey =
        signal.facts.subjectNumber === null
          ? null
          : githubTupleKey(
              signal.sourceScopeId,
              signal.facts.subjectType,
              signal.facts.subjectNumber
            );
      const bridged = tupleKey === null ? undefined : bridge.get(tupleKey);
      const artifactBridged =
        kind === "github_push"
          ? artifactBridge.get(signal.signalId)
          : undefined;
      const identityScope =
        artifactBridged !== undefined ||
        ((signal.facts.subjectType === "issue" ||
          signal.facts.subjectType === "pull_request") &&
          signal.facts.subjectNumber !== null)
          ? "exact_task"
          : "project";
      const nativeIdentityRef = createFocusIdentityRef({
        source: "github",
        sourceScopeId: signal.sourceScopeId,
        subjectType: signal.facts.subjectType,
        subjectNumber: signal.facts.subjectNumber,
        refName: identityScope === "project" ? signal.facts.refName : null
      });
      const event = buildEvent(
        input,
        {
          source: "github",
          stableIdentity: {
            signalId: signal.signalId,
            kind,
            sourceUpdatedAt: signal.sourceUpdatedAt
          },
          nativeSubjectRef: subjectRef,
          projectId:
            artifactBridged?.projectId ??
            bridged?.projectId ??
            signal.projectId,
          identityScope,
          identityRefs: canonical([
            ...(artifactBridged ? [] : [nativeIdentityRef]),
            ...(bridged ? [bridged.identityRef] : []),
            ...(artifactBridged?.identityRefs ?? [])
          ]),
          claimTargetRefs:
            artifactBridged?.claimTargetRefs ??
            (bridged ? [bridged.claimTargetRef] : []),
          relationRefs:
            artifactBridged?.relationRefs ??
            bridged?.relationRefs ??
            [],
          kind,
          occurredAt: signal.sourceUpdatedAt,
          observedAt: signal.observedAt,
          sourceUpdatedAt: signal.sourceUpdatedAt,
          timeBasis: "source_occurred_at",
          freshness: batchFreshness(batch),
          completeness: signalCompleteness(signal.completeness),
          currentness: githubActivityCurrentness(
            batch,
            signal.completeness
          ),
          semanticRole: githubSemanticRole(kind),
          attentionCapability:
            githubActivityCurrentness(batch, signal.completeness) ===
            "current"
              ? "focus_selector"
              : "historical_context_only",
          displayLabel:
            artifactBridged?.displayLabel ??
            bridged?.displayLabel ??
            githubActivityLabel(signal, kind),
          evidenceIdentity: {
            signalId: signal.signalId,
            signalHash: signal.signalHash
          },
          sourceSnapshotSha256: batch.sourceSnapshotSha256,
          sourceBatchSha256: batch.batchSha256,
          normalizerVersion: batch.normalizerVersion
        },
        diagnostics
      );
      if (event) events.push(event);
      continue;
    }
    if (signal.kind === "work_item_observation") {
      projectGitHubActionabilityState(input, signal, bridge, events, diagnostics);
      continue;
    }
    const subjectRef = createFocusSubjectRef({
      source: "github",
      signalId: signal.signalId
    });
    diagnostics.push(
      diagnostic({
        source: "github",
        observationRef: subjectRef,
        eventId: null,
        disposition: "excluded",
        reasonCode: "EXCLUDED_GENERIC_UPDATED_AT"
      })
    );
  }
}

function projectGitHubActionabilityState(
  input: ReturnType<typeof parseInput>,
  signal: GitHubWorkItemSignal,
  bridge: GitHubIdentityBridge,
  events: RecentMeaningfulEvent[],
  diagnostics: RecentEventDiagnostic[]
) {
  const batch = input.githubBatch!;
  const bridged = bridge.get(`subject:${signal.subjectId}`)!;
  const actionability = signal.facts.actionability;
  const reasons = actionability?.actionRequiredReasons ?? [];
  if (
    signal.facts.taskKind !== "authored_pull_request" ||
    actionability?.actionRequired !== true ||
    reasons.length === 0
  ) {
    diagnostics.push(
      diagnostic({
        source: "github",
        observationRef: createFocusSubjectRef({
          source: "github",
          subjectId: signal.subjectId
        }),
        eventId: null,
        disposition: "excluded",
        reasonCode: "EXCLUDED_GENERIC_UPDATED_AT"
      })
    );
    return;
  }
  for (const reason of [...reasons].sort(compareRuntimeStrings)) {
    const kind =
      reason === "checks_failed"
        ? ("github_ci_failed" as const)
        : reason === "changes_requested"
          ? ("github_changes_requested" as const)
          : ("github_merge_conflict" as const);
    const completeness =
      signal.completeness === "complete" &&
      actionability.collectionState === "complete"
        ? ("complete" as const)
        : ("partial" as const);
    const currentness = batchCurrentness(
      batch,
      completeness === "complete" ? "complete" : "truncated"
    );
    const event = buildEvent(
      input,
      {
        source: "github",
        stableIdentity: {
          subjectId: signal.subjectId,
          kind,
          sourceUpdatedAt: signal.sourceUpdatedAt
        },
        nativeSubjectRef: createFocusSubjectRef({
          source: "github",
          sourceScopeId: signal.sourceScopeId,
          subjectType: signal.facts.objectType,
          subjectNumber: signal.facts.number
        }),
        projectId: signal.projectId,
        identityScope: "exact_task",
        identityRefs: [bridged.identityRef],
        claimTargetRefs: [bridged.claimTargetRef],
        relationRefs: bridged.relationRefs,
        kind,
        occurredAt: signal.sourceUpdatedAt ?? signal.observedAt,
        observedAt: signal.observedAt,
        sourceUpdatedAt: signal.sourceUpdatedAt,
        timeBasis: "source_updated_state_observation",
        freshness: batchFreshness(batch),
        completeness,
        currentness,
        semanticRole: "blocker",
        attentionCapability:
          currentness === "current"
            ? "focus_selector"
            : "historical_context_only",
        displayLabel: bridged.displayLabel,
        evidenceIdentity: {
          signalId: signal.signalId,
          signalHash: signal.signalHash,
          reason
        },
        sourceSnapshotSha256: batch.sourceSnapshotSha256,
        sourceBatchSha256: batch.batchSha256,
        normalizerVersion: batch.normalizerVersion
      },
      diagnostics
    );
    if (event) events.push(event);
  }
}

function projectCodexInventoryEvents(
  input: ReturnType<typeof parseInput>,
  events: RecentMeaningfulEvent[],
  diagnostics: RecentEventDiagnostic[]
) {
  const batch = input.codexInventoryBatch;
  if (batch === null) return;
  for (const signal of batch.signals) {
    if (signal.kind !== "execution_observation") continue;
    const subjectRef = createFocusSubjectRef({
      source: "codex_inventory",
      subjectId: signal.subjectId
    });
    const event = buildEvent(
      input,
      {
        source: "codex_inventory",
        stableIdentity: {
          subjectId: signal.subjectId,
          sourceUpdatedAt: signal.sourceUpdatedAt
        },
        nativeSubjectRef: subjectRef,
        projectId: signal.projectId,
        identityScope: "project",
        identityRefs: [
          createFocusIdentityRef({
            source: "codex_inventory",
            projectId: signal.projectId,
            sourceScopeId: signal.sourceScopeId
          })
        ],
        claimTargetRefs: [],
        relationRefs: [],
        kind: "codex_project_activity",
        occurredAt: signal.sourceUpdatedAt ?? signal.observedAt,
        observedAt: signal.observedAt,
        sourceUpdatedAt: signal.sourceUpdatedAt,
        timeBasis: "inventory_updated_at",
        freshness: batchFreshness(batch),
        completeness: signalCompleteness(signal.completeness),
        currentness: "historical_only",
        semanticRole: "historical_context",
        attentionCapability: "historical_context_only",
        displayLabel: "Codex project activity",
        evidenceIdentity: {
          signalId: signal.signalId,
          signalHash: signal.signalHash
        },
        sourceSnapshotSha256: batch.sourceSnapshotSha256,
        sourceBatchSha256: batch.batchSha256,
        normalizerVersion: batch.normalizerVersion
      },
      diagnostics,
      "CONTEXT_ONLY_CODEX_INVENTORY"
    );
    if (event) events.push(event);
  }
}

function projectManagedCodexEvents(
  input: ReturnType<typeof parseInput>,
  bridge: GitHubIdentityBridge,
  events: RecentMeaningfulEvent[],
  diagnostics: RecentEventDiagnostic[]
) {
  for (const run of input.managedPublicProjection.runs) {
    let latestFailureObservation: ManagedFailureObservation | null = null;
    const semantic = input.managedSemanticProjection.runs[run.managedRunId];
    const relations = input.workRelationProjection.relations
      .filter(
        (relation) =>
          relation.identityStatus === "resolved" &&
          relation.bindingEvidence.bindingState === "active" &&
          relation.managedRunIds.includes(run.managedRunId) &&
          relation.from.subjectId === run.executionId
      )
      .sort((left, right) =>
        compareRuntimeStrings(left.relationId, right.relationId)
      );
    const relation = relations[0] ?? null;
    const relationEvidenceCurrent = relations.every(
      (item) =>
        item.githubObservation.status === "current" &&
        item.githubObservation.completeness === "complete" &&
        item.projectAlignment.status !== "conflict"
    );
    const bridged =
      relation === null ? undefined : bridge.get(`subject:${relation.to.subjectId}`);
    const projectId =
      relation?.projectAlignment.status === "aligned"
        ? relation.projectAlignment.projectId
        : bridged?.projectId ?? null;
    const relationRefs = canonical([
      ...relations.map((item) => item.relationId),
      ...input.artifactRelationProjection.relations
        .filter(
          (item) =>
            item.managedRunId === run.managedRunId &&
            item.attributionLifecycle.state === "active"
        )
        .map((item) => item.relationId)
    ]);
    const identityRefs = canonical([
      createFocusIdentityRef({
        source: "codex_managed",
        executionId: run.executionId
      }),
      createFocusIdentityRef({
        source: "codex_managed",
        bindingId: run.bindingId
      }),
      ...(bridged ? [bridged.identityRef] : []),
      ...relationRefs.map((relationRef) =>
        createFocusIdentityRef({ relationRef })
      )
    ]);
    const claimTargetRefs = canonical([
      createClaimTargetRef({
        kind: "codex_execution",
        identity: {
          managedRunId: run.managedRunId,
          bindingId: run.bindingId,
          executionId: run.executionId
        }
      }),
      ...(bridged ? [bridged.claimTargetRef] : [])
    ]);
    const displayLabel =
      bridged?.displayLabel ??
      (relation?.githubObservation.number
        ? `GitHub ${relation.githubObservation.objectType === "issue" ? "issue" : "pull request"} #${relation.githubObservation.number}`
        : "Managed Codex work");
    const startedAt = input.managedRunStartedAtById[run.managedRunId];
    if (startedAt) {
      const event = buildManagedEvent({
        input,
        run,
        semantic,
        projectId,
        identityRefs,
        claimTargetRefs,
        relationRefs,
        relationEvidenceCurrent,
        displayLabel,
        kind: "codex_run_started",
        observedAt: startedAt,
        evidenceIdentity: { managedRunId: run.managedRunId, startedAt },
        diagnostics
      });
      if (event) events.push(event);
    }
    if (!semantic) {
      diagnostics.push(
        diagnostic({
          source: "codex_managed",
          observationRef: createFocusSubjectRef({
            source: "codex_managed",
            managedRunId: run.managedRunId
          }),
          eventId: null,
          disposition: "excluded",
          reasonCode: "EXCLUDED_IDENTITY_INCOMPLETE"
        })
      );
      continue;
    }
    for (const entry of semantic.timeline.entries) {
      let kind = managedEntryKind(entry.kind, entry.evidence.waitingState);
      if (kind === null) {
        diagnostics.push(
          diagnostic({
            source: "codex_managed",
            observationRef: createFocusSubjectRef({
              source: "codex_managed",
              evidenceId: entry.evidence.evidenceId
            }),
            eventId: null,
            disposition: "excluded",
            reasonCode:
              entry.kind === "item_activity"
                ? "EXCLUDED_MANAGED_ITEM_OUTCOME_UNKNOWN"
                : "EXCLUDED_HEARTBEAT_OR_STREAM_NOISE"
          })
        );
        continue;
      }
      const evidenceIdentity = {
        managedRunId: run.managedRunId,
        evidenceId: entry.evidence.evidenceId,
        sourceEvent: entry.evidence.sourceEvent,
        sequence: entry.evidence.sequence
      };
      if (isManagedFailureKind(kind)) {
        const failureObservation = managedFailureObservation(entry);
        if (
          latestFailureObservation !== null &&
          isRepeatedManagedFailure(
            latestFailureObservation,
            failureObservation
          )
        ) {
          const observationRef = createFocusSubjectRef({
            source: "codex_managed",
            evidence: evidenceIdentity
          });
          diagnostics.push(
            diagnostic({
              source: "codex_managed",
              observationRef,
              eventId: createRecentMeaningfulEventId({
                source: "codex_managed",
                kind,
                stableIdentity: {
                  kind,
                  evidence: evidenceIdentity
                }
              }),
              disposition: "excluded",
              reasonCode: "EXCLUDED_REPEATED_ERROR_OBSERVATION"
            })
          );
          latestFailureObservation = failureObservation;
          continue;
        }
        latestFailureObservation = failureObservation;
      } else {
        latestFailureObservation = null;
      }
      const event = buildManagedEvent({
        input,
        run,
        semantic,
        projectId,
        identityRefs,
        claimTargetRefs,
        relationRefs,
        relationEvidenceCurrent,
        displayLabel,
        kind,
        observedAt: entry.evidence.observedAt,
        evidenceIdentity,
        diagnostics
      });
      if (event) events.push(event);
    }
  }
}

type ManagedTimelineEntry =
  ManagedCodexSemanticProjection["runs"][string]["timeline"]["entries"][number];

type ManagedFailureObservation = {
  fingerprintSha256: string;
  sequence: number;
  observedAtMs: number;
};

function isManagedFailureKind(
  kind: RecentMeaningfulEvent["kind"]
): boolean {
  return kind === "codex_turn_failed" || kind === "codex_run_failed";
}

function managedFailureObservation(
  entry: ManagedTimelineEntry
): ManagedFailureObservation {
  return {
    fingerprintSha256: runtimeSha256({
      domain: "managed-failure-observation-fingerprint-v0.1",
      sourceEvent: entry.evidence.sourceEvent,
      executionState: entry.evidence.executionState,
      waitingState: entry.evidence.waitingState,
      itemType: entry.evidence.itemType,
      reasonCode: entry.evidence.reasonCode
    }),
    sequence: entry.evidence.sequence,
    observedAtMs: Date.parse(entry.evidence.observedAt)
  };
}

function isRepeatedManagedFailure(
  previous: ManagedFailureObservation,
  current: ManagedFailureObservation
): boolean {
  const sequenceGap = current.sequence - previous.sequence;
  const timeGapMs = current.observedAtMs - previous.observedAtMs;
  return (
    current.fingerprintSha256 === previous.fingerprintSha256 &&
    sequenceGap > 0 &&
    sequenceGap <= REPEATED_MANAGED_FAILURE_MAX_SEQUENCE_GAP &&
    timeGapMs >= 0 &&
    timeGapMs <= REPEATED_MANAGED_FAILURE_WINDOW_MS
  );
}

function buildManagedEvent(input: {
  input: ReturnType<typeof parseInput>;
  run: ManagedCodexPublicProjection["runs"][number];
  semantic:
    | ManagedCodexSemanticProjection["runs"][string]
    | undefined;
  projectId: string | null;
  identityRefs: string[];
  claimTargetRefs: string[];
  relationRefs: string[];
  relationEvidenceCurrent: boolean;
  displayLabel: string;
  kind: RecentMeaningfulEvent["kind"];
  observedAt: string;
  evidenceIdentity: unknown;
  diagnostics: RecentEventDiagnostic[];
}): RecentMeaningfulEvent | null {
  const managedCurrentness = managedQuality(input.run, input.semantic);
  const exactTask = input.relationRefs.some((ref) => ref.startsWith("relation_"));
  const quality =
    exactTask && !input.relationEvidenceCurrent
      ? ("partial" as const)
      : managedCurrentness;
  return buildEvent(
    input.input,
    {
      source: "codex_managed",
      stableIdentity: { kind: input.kind, evidence: input.evidenceIdentity },
      nativeSubjectRef: createFocusSubjectRef({
        source: "codex_managed",
        evidence: input.evidenceIdentity
      }),
      projectId: input.projectId,
      identityScope: exactTask ? "exact_task" : "project",
      identityRefs: input.identityRefs,
      claimTargetRefs: input.claimTargetRefs,
      relationRefs: input.relationRefs,
      kind: input.kind,
      occurredAt: input.observedAt,
      observedAt: input.observedAt,
      sourceUpdatedAt: null,
      timeBasis: "collector_observed_at",
      freshness: quality === "current" ? "current" : "unknown",
      completeness: quality === "current" ? "complete" : "partial",
      currentness: quality,
      semanticRole: managedSemanticRole(input.kind),
      attentionCapability:
        quality === "current" &&
        (input.projectId !== null || exactTask)
          ? "focus_selector"
          : "historical_context_only",
      displayLabel: input.displayLabel,
      evidenceIdentity: input.evidenceIdentity,
      sourceSnapshotSha256:
        input.input.managedSemanticProjection.projectionSha256,
      sourceBatchSha256: null,
      normalizerVersion: input.input.managedSemanticProjection.ruleVersion
    },
    input.diagnostics
  );
}

function buildEvent(
  input: ReturnType<typeof parseInput>,
  content: Omit<
    RecentMeaningfulEventContent,
    | "contract"
    | "ruleVersion"
    | "idPolicyVersion"
    | "eventId"
    | "evidenceRef"
    | "reasonCodes"
  > & {
    stableIdentity: unknown;
    evidenceIdentity: unknown;
  },
  diagnostics: RecentEventDiagnostic[],
  includedReason:
    | "INCLUDED_MEANINGFUL_DIRECT_EVENT"
    | "CONTEXT_ONLY_CODEX_INVENTORY" =
    "INCLUDED_MEANINGFUL_DIRECT_EVENT"
): RecentMeaningfulEvent | null {
  const ageMs = Date.parse(input.asOf) - Date.parse(content.occurredAt);
  const eventId = createRecentMeaningfulEventId({
    source: content.source,
    kind: content.kind,
    stableIdentity: content.stableIdentity
  });
  if (ageMs < -MAX_FUTURE_EVENT_SKEW_MS || ageMs > RECENT_EVENT_RETENTION_MS) {
    diagnostics.push(
      diagnostic({
        source: content.source,
        observationRef: content.nativeSubjectRef,
        eventId,
        disposition: "excluded",
        reasonCode:
          ageMs < -MAX_FUTURE_EVENT_SKEW_MS
            ? "EXCLUDED_FUTURE_EVENT_TIME"
            : "EXCLUDED_OUTSIDE_RETENTION_WINDOW"
      })
    );
    return null;
  }
  const event = sealRecentMeaningfulEvent({
    contract: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    eventId,
    source: content.source,
    nativeSubjectRef: content.nativeSubjectRef,
    projectId: content.projectId,
    identityScope: content.identityScope,
    identityRefs: canonical(content.identityRefs),
    claimTargetRefs: canonical(content.claimTargetRefs),
    relationRefs: canonical(content.relationRefs),
    kind: content.kind,
    occurredAt: new Date(content.occurredAt).toISOString(),
    observedAt: new Date(content.observedAt).toISOString(),
    sourceUpdatedAt:
      content.sourceUpdatedAt === null
        ? null
        : new Date(content.sourceUpdatedAt).toISOString(),
    timeBasis: content.timeBasis,
    freshness: content.freshness,
    completeness: content.completeness,
    currentness: content.currentness,
    semanticRole: content.semanticRole,
    attentionCapability: content.attentionCapability,
    displayLabel: safeLabel(content.displayLabel, "Recent work"),
    evidenceRef: createFocusEvidenceRef({
      source: content.source,
      evidence: content.evidenceIdentity
    }),
    sourceSnapshotSha256: content.sourceSnapshotSha256,
    sourceBatchSha256: content.sourceBatchSha256,
    normalizerVersion: content.normalizerVersion,
    reasonCodes: [includedReason]
  });
  diagnostics.push(
    diagnostic({
      source: event.source,
      observationRef: event.nativeSubjectRef,
      eventId: event.eventId,
      disposition:
        event.attentionCapability === "focus_selector"
          ? "included"
          : "context_only",
      reasonCode: includedReason
    })
  );
  return event;
}

function diagnostic(
  input: Omit<RecentEventDiagnostic, "diagnosticId">
): RecentEventDiagnostic {
  return {
    diagnosticId: createRecentEventDiagnosticId(input),
    ...input
  };
}

function githubActivityKind(
  signal: Extract<RuntimeWorkSignal, { kind: "activity_observation" }>
): RecentMeaningfulEvent["kind"] | null {
  switch (signal.facts.activityKind) {
    case "push":
      return "github_push";
    case "issue_opened":
      return "github_issue_opened";
    case "issue_closed":
      return "github_issue_closed";
    case "issue_reopened":
      return "github_issue_reopened";
    case "pull_request_opened":
      return "github_pull_request_opened";
    case "pull_request_closed":
      return "github_pull_request_closed";
    case "pull_request_reopened":
      return "github_pull_request_reopened";
    case "pull_request_merged":
      return "github_pull_request_merged";
    case "pull_request_reviewed":
      return signal.facts.reviewState === "changes_requested"
        ? "github_changes_requested"
        : "github_review_submitted";
    default:
      return null;
  }
}

function githubActivitySubjectRef(
  signal: GitHubActivitySignal
): string {
  return createFocusSubjectRef(
    (signal.facts.subjectType === "issue" ||
      signal.facts.subjectType === "pull_request") &&
      signal.facts.subjectNumber !== null
      ? {
          source: "github",
          sourceScopeId: signal.sourceScopeId,
          subjectType: signal.facts.subjectType,
          subjectNumber: signal.facts.subjectNumber
        }
      : {
          source: "github",
          activitySubjectId: signal.subjectId
        }
  );
}

function managedEntryKind(
  kind: ManagedCodexSemanticProjection["runs"][string]["timeline"]["entries"][number]["kind"],
  waitingState: "waiting_on_approval" | "waiting_on_user_input" | null
): RecentMeaningfulEvent["kind"] | null {
  if (waitingState === "waiting_on_approval") {
    return "codex_waiting_approval";
  }
  if (waitingState === "waiting_on_user_input") {
    return "codex_waiting_user_input";
  }
  switch (kind) {
    case "turn_started":
      return "codex_turn_started";
    case "turn_completed":
      return "codex_turn_completed";
    case "turn_failed":
      return "codex_turn_failed";
    case "turn_interrupted":
      return "codex_turn_interrupted";
    case "managed_run_failed":
      return "codex_run_failed";
    case "managed_run_closed":
      return "codex_run_closed";
    default:
      return null;
  }
}

function managedQuality(
  run: ManagedCodexPublicProjection["runs"][number],
  semantic:
    | ManagedCodexSemanticProjection["runs"][string]
    | undefined
): RecentMeaningfulEvent["currentness"] {
  if (!semantic) return "unknown";
  if (
    semantic.window.historyCompleteness !== "complete" ||
    semantic.window.continuity !== "continuous" ||
    semantic.window.clockQuality !== "monotonic"
  ) {
    return "partial";
  }
  const terminal = run.lifecycle === "ended" || run.lifecycle === "failed";
  return run.liveObservationAvailable || terminal ? "current" : "partial";
}

function githubSemanticRole(
  kind: RecentMeaningfulEvent["kind"]
): RecentMeaningfulEvent["semanticRole"] {
  if (
    kind === "github_issue_closed" ||
    kind === "github_pull_request_closed" ||
    kind === "github_pull_request_merged"
  ) {
    return "completion";
  }
  if (
    kind === "github_changes_requested" ||
    kind === "github_ci_failed" ||
    kind === "github_merge_conflict"
  ) {
    return "blocker";
  }
  return "meaningful_progress";
}

function managedSemanticRole(
  kind: RecentMeaningfulEvent["kind"]
): RecentMeaningfulEvent["semanticRole"] {
  if (kind === "codex_turn_failed" || kind === "codex_run_failed") {
    return "blocker";
  }
  if (
    kind === "codex_waiting_approval" ||
    kind === "codex_waiting_user_input"
  ) {
    return "current_state";
  }
  if (kind === "codex_run_closed" || kind === "codex_turn_completed") {
    return "completion";
  }
  return "meaningful_progress";
}

function githubEventLabel(kind: RecentMeaningfulEvent["kind"]): string {
  switch (kind) {
    case "github_push":
      return "GitHub push";
    case "github_issue_opened":
    case "github_issue_reopened":
    case "github_issue_closed":
      return "GitHub issue";
    case "github_pull_request_opened":
    case "github_pull_request_reopened":
    case "github_pull_request_closed":
    case "github_pull_request_merged":
      return "GitHub pull request";
    default:
      return "GitHub review";
  }
}

function githubWorkItemLabel(
  objectType: "issue" | "pull_request",
  number: number
): string {
  return `GitHub ${
    objectType === "issue" ? "issue" : "pull request"
  } #${number}`;
}

function githubActivityLabel(
  signal: GitHubActivitySignal,
  kind: RecentMeaningfulEvent["kind"]
): string {
  if (
    (signal.facts.subjectType === "issue" ||
      signal.facts.subjectType === "pull_request") &&
    signal.facts.subjectNumber !== null
  ) {
    return githubWorkItemLabel(
      signal.facts.subjectType,
      signal.facts.subjectNumber
    );
  }
  return githubEventLabel(kind);
}

function githubTupleKey(
  sourceScopeId: string,
  objectType: string,
  number: number
): string {
  return `${sourceScopeId}:${objectType}:${number}`;
}

function batchFreshness(
  batch: RuntimeWorkSignalBatch
): RecentMeaningfulEvent["freshness"] {
  return batch.assessment.freshness === "fresh"
    ? "current"
    : batch.assessment.freshness === "stale"
      ? "stale"
      : "unknown";
}

function signalCompleteness(
  completeness: RuntimeWorkSignal["completeness"]
): RecentMeaningfulEvent["completeness"] {
  return completeness === "complete"
    ? "complete"
    : completeness === "truncated"
      ? "partial"
      : "unknown";
}

function batchCurrentness(
  batch: RuntimeWorkSignalBatch,
  completeness: RuntimeWorkSignal["completeness"]
): RecentMeaningfulEvent["currentness"] {
  if (batch.assessment.freshness === "stale") return "stale";
  if (
    batch.assessment.freshness !== "fresh" ||
    batch.assessment.completeness !== "complete" ||
    completeness !== "complete"
  ) {
    return "partial";
  }
  return "current";
}

function githubActivityCurrentness(
  batch: RuntimeWorkSignalBatch,
  completeness: RuntimeWorkSignal["completeness"]
): RecentMeaningfulEvent["currentness"] {
  if (batch.assessment.freshness === "stale") return "stale";
  if (
    githubActivityCoverage(batch) !== "complete" ||
    completeness !== "complete"
  ) {
    return "partial";
  }
  return "current";
}

function githubActivityCoverage(
  batch: RuntimeWorkSignalBatch | null
): RecentMeaningfulEventProjection["coverage"]["github"] {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  if (batch.assessment.freshness === "stale") return "stale";
  const reasons = new Set(batch.assessment.reasonCodes);
  return batch.assessment.truncated ||
    reasons.has("GITHUB_ACTIVITIES_PARTIAL") ||
    reasons.has("GITHUB_ACTIVITIES_UNAVAILABLE")
    ? "partial"
    : "complete";
}

function inventoryCoverage(
  batch: RuntimeWorkSignalBatch | null
): RecentMeaningfulEventProjection["coverage"]["codexInventory"] {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  return batch.assessment.completeness === "complete"
    ? "historical_complete"
    : "historical_partial";
}

function managedCoverage(
  publicProjection: ManagedCodexPublicProjection,
  semantics: ManagedCodexSemanticProjection
): RecentMeaningfulEventProjection["coverage"]["codexManaged"] {
  if (publicProjection.runs.length === 0) return "complete";
  return publicProjection.runs.every((run) => {
    const semantic = semantics.runs[run.managedRunId];
    return (
      semantic?.window.historyCompleteness === "complete" &&
      semantic.window.continuity === "continuous" &&
      semantic.window.clockQuality === "monotonic"
    );
  })
    ? "complete"
    : "partial";
}

function safeLabel(value: string | null, fallback: string): string {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 240);
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}
