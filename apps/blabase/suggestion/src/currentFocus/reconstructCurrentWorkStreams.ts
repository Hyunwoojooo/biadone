import {
  managedCodexArtifactRelationProjectionSchema,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts/contracts";
import {
  claimAuthorityProjectionSchema,
  type ClaimAuthorityProjection,
  type ClaimField,
  type NormalizedWorkClaim
} from "../claims/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
  CURRENT_WORKSTREAM_ID_POLICY_VERSION,
  CURRENT_WORKSTREAM_PROJECTION_CONTRACT,
  CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
  CURRENT_WORKSTREAM_SCHEMA_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
} from "../crossSource/versions";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelationProjection
} from "../relations/contracts";
import {
  createFocusIdentityRef,
  recentMeaningfulEventProjectionSchema,
  type RecentMeaningfulEvent,
  type RecentMeaningfulEventProjection
} from "../recentEvents/contracts";
import {
  compareCurrentWorkstreams,
  createCurrentWorkstreamId,
  MAX_WORKSTREAM_HISTORY_REFS,
  sealCurrentWorkstream,
  sealCurrentWorkstreamProjection,
  type CurrentWorkstream,
  type CurrentWorkstreamProjection
} from "./contracts";

export type ReconstructCurrentWorkStreamsInput = {
  asOf: string;
  recentEventProjection: RecentMeaningfulEventProjection;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  claimAuthorityProjection: ClaimAuthorityProjection;
};

export function reconstructCurrentWorkStreams(
  input: ReconstructCurrentWorkStreamsInput
): CurrentWorkstreamProjection {
  const asOf = new Date(input.asOf).toISOString();
  const recentEvents = recentMeaningfulEventProjectionSchema.parse(
    input.recentEventProjection
  );
  const workRelations = managedCodexWorkRelationProjectionSchema.parse(
    input.workRelationProjection
  );
  const artifacts = managedCodexArtifactRelationProjectionSchema.parse(
    input.artifactRelationProjection
  );
  const claims = claimAuthorityProjectionSchema.parse(
    input.claimAuthorityProjection
  );
  if (
    recentEvents.asOf !== asOf ||
    workRelations.asOf !== asOf ||
    artifacts.asOf !== asOf ||
    claims.asOf !== asOf ||
    recentEvents.dependencies.workRelationProjectionSha256 !==
      workRelations.projectionSha256 ||
    recentEvents.dependencies.artifactRelationProjectionSha256 !==
      artifacts.projectionSha256 ||
    recentEvents.dependencies.claimAuthorityProjectionSha256 !==
      claims.projectionSha256 ||
    artifacts.workRelationProjectionSha256 !==
      workRelations.projectionSha256 ||
    claims.inputs.workRelationProjectionSha256 !==
      workRelations.projectionSha256 ||
    claims.inputs.artifactRelationProjectionSha256 !==
      artifacts.projectionSha256
  ) {
    throw new TypeError(
      "WorkStream reconstruction requires one exact evidence graph."
    );
  }

  const components = eventComponents(recentEvents.events);
  const workstreams = components
    .map((events) => buildWorkstream(events, claims))
    .sort(compareCurrentWorkstreams);
  const counts = {
    exactTask: workstreams.filter(
      (workstream) => workstream.level === "exact_task"
    ).length,
    projectLevel: workstreams.filter(
      (workstream) => workstream.level === "project"
    ).length,
    current: workstreams.filter(
      (workstream) => workstream.currentness === "current"
    ).length,
    unresolved: workstreams.filter((workstream) =>
      ["partial", "conflict", "unknown"].includes(
        workstream.currentness
      )
    ).length
  };
  const inputSha256 = runtimeSha256({
    domain: "current-workstream-input-v0.1",
    asOf,
    recentEventProjectionSha256: recentEvents.projectionSha256,
    workRelationProjectionSha256: workRelations.projectionSha256,
    artifactRelationProjectionSha256: artifacts.projectionSha256,
    claimAuthorityProjectionSha256: claims.projectionSha256,
    reconstructionRuleVersion:
      CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
    currentnessPolicyVersion:
      CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION
  });
  return sealCurrentWorkstreamProjection({
    contract: CURRENT_WORKSTREAM_PROJECTION_CONTRACT,
    schemaVersion: CURRENT_WORKSTREAM_SCHEMA_VERSION,
    reconstructionRuleVersion:
      CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
    currentnessPolicyVersion:
      CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
    idPolicyVersion: CURRENT_WORKSTREAM_ID_POLICY_VERSION,
    asOf,
    recentEventProjectionSha256: recentEvents.projectionSha256,
    workRelationProjectionSha256: workRelations.projectionSha256,
    artifactRelationProjectionSha256: artifacts.projectionSha256,
    claimAuthorityProjectionSha256: claims.projectionSha256,
    inputSha256,
    workstreams,
    counts,
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function eventComponents(
  events: RecentMeaningfulEvent[]
): RecentMeaningfulEvent[][] {
  if (events.length === 0) return [];
  const parent = events.map((_, index) => index);
  const identityOwner = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    const groupingRefs =
      event.identityScope === "project" && event.projectId !== null
        ? [
            createFocusIdentityRef({
              scope: "project_workstream",
              projectId: event.projectId
            })
          ]
        : event.identityRefs;
    for (const identityRef of groupingRefs) {
      const previous = identityOwner.get(identityRef);
      if (previous === undefined) {
        identityOwner.set(identityRef, index);
      } else {
        union(parent, previous, index);
      }
    }
  }
  const grouped = new Map<number, RecentMeaningfulEvent[]>();
  for (const [index, event] of events.entries()) {
    const root = find(parent, index);
    grouped.set(root, [...(grouped.get(root) ?? []), event]);
  }
  return [...grouped.values()].map((component) =>
    [...component].sort((left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
      compareRuntimeStrings(left.source, right.source) ||
      compareRuntimeStrings(left.kind, right.kind) ||
      compareRuntimeStrings(left.eventId, right.eventId)
    )
  );
}

function buildWorkstream(
  events: RecentMeaningfulEvent[],
  claims: ClaimAuthorityProjection
): CurrentWorkstream {
  // Inventory/history may be newer than a direct source event, but it must
  // remain context-only and cannot become the WorkStream's focus anchor.
  const latest =
    events.find((event) => event.source !== "codex_inventory") ?? events[0]!;
  const level = events.some((event) => event.identityScope === "exact_task")
    ? ("exact_task" as const)
    : ("project" as const);
  const identityRefs = canonical(
    events.flatMap((event) => event.identityRefs)
  );
  const claimTargetRefs = canonical(
    events.flatMap((event) => event.claimTargetRefs)
  );
  const relationEvidenceRefs = canonical(
    events.flatMap((event) => event.relationRefs)
  );
  const projectIds = canonical(
    events
      .map((event) => event.projectId)
      .filter((projectId): projectId is string => projectId !== null)
  );
  const projectId = projectIds.length === 1 ? projectIds[0]! : null;
  const claimState = resolveAuthoritativeState(claimTargetRefs, claims);
  const latestGitHubLifecycle = latestDirectGitHubLifecycle(events);
  const lifecycleConflict = directLifecycleConflictsWithAuthority(
    latestGitHubLifecycle?.kind ?? null,
    claimState.state,
    claimState.stateField
  );
  const authorityConflict = claimState.conflict || lifecycleConflict;
  const terminal = authorityConflict
    ? {
        state: "conflict" as const,
        completionState: "unknown" as const
      }
    : terminalState({
        latestKind: latest.kind,
        latestGitHubLifecycleKind: latestGitHubLifecycle?.kind ?? null,
        authoritativeState: claimState.state,
        stateField: claimState.stateField
      });
  const currentness = authorityConflict
    ? ("conflict" as const)
    : latest.currentness;
  const completionState = terminal.completionState;
  const blocker =
    completionState === "completed" || completionState === "cancelled"
      ? ("none" as const)
      : activeBlockerFor(events, claimState.state);
  const reasonCodes = canonical([
    level === "exact_task"
      ? "WORKSTREAM_EXACT_NATIVE_IDENTITY"
      : "WORKSTREAM_PROJECT_LEVEL_ONLY",
    ...(events.some((event) => event.source === "codex_managed")
      ? ["WORKSTREAM_MANAGED_EXECUTION_IDENTITY"]
      : []),
    ...(relationEvidenceRefs.some((ref) => ref.startsWith("relation_"))
      ? ["WORKSTREAM_EXPLICIT_WORK_RELATION"]
      : []),
    ...(relationEvidenceRefs.some((ref) =>
      ref.startsWith("artifact_relation_")
    )
      ? ["WORKSTREAM_VERIFIED_ARTIFACT_RELATION"]
      : []),
    ...(authorityConflict
      ? ["WORKSTREAM_AUTHORITATIVE_STATE_CONFLICT"]
      : claimState.resolved
        ? ["WORKSTREAM_AUTHORITATIVE_STATE_RESOLVED"]
        : []),
    ...(currentness === "stale" ? ["WORKSTREAM_SOURCE_STALE"] : []),
    ...(currentness === "partial" ? ["WORKSTREAM_SOURCE_PARTIAL"] : []),
    ...(events.length > 1
      ? ["WORKSTREAM_HISTORICAL_CONTEXT_BOUNDED"]
      : []),
    ...(completionState === "completed" || completionState === "cancelled"
      ? ["WORKSTREAM_TERMINAL_STATE_PRESERVED"]
      : [])
  ]) as CurrentWorkstream["reasonCodes"];
  const history = events
    .filter((event) => event.eventId !== latest.eventId)
    .slice(0, MAX_WORKSTREAM_HISTORY_REFS)
    .map((event) => event.eventId);
  const anchorRef = selectStableWorkstreamAnchor({
    events,
    claims,
    level,
    projectId,
    identityRefs,
    claimTargetRefs
  });
  return sealCurrentWorkstream({
    contract: CURRENT_WORKSTREAM_SCHEMA_VERSION,
    reconstructionRuleVersion:
      CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
    currentnessPolicyVersion:
      CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
    idPolicyVersion: CURRENT_WORKSTREAM_ID_POLICY_VERSION,
    workstreamId: createCurrentWorkstreamId(anchorRef),
    projectId,
    level,
    displayLabel: latest.displayLabel,
    identityRefs,
    claimTargetRefs,
    relationEvidenceRefs,
    relatedSources: canonical(
      events.map((event) => event.source)
    ) as CurrentWorkstream["relatedSources"],
    latestMeaningfulEvent: latest,
    historicalEventRefs: history,
    totalEventCount: events.length,
    omittedHistoricalEventCount: Math.max(0, events.length - 1 - history.length),
    authoritativeState: terminal.state,
    activeBlocker: blocker,
    owner: claimState.owner,
    completionState,
    currentness,
    completeness: latest.completeness,
    reconstructionConfidence:
      level === "exact_task" && !authorityConflict
        ? "high"
        : projectId !== null
          ? "medium"
          : "low",
    reasonCodes
  });
}

function resolveAuthoritativeState(
  targetRefs: string[],
  projection: ClaimAuthorityProjection
): {
  state: CurrentWorkstream["authoritativeState"];
  owner: CurrentWorkstream["owner"];
  stateField: ClaimField | null;
  resolved: boolean;
  conflict: boolean;
} {
  const relevant = projection.fieldResolutions.filter(
    (resolution) => targetRefs.includes(resolution.target.ref)
  );
  const conflict = relevant.some(
    (resolution) => resolution.status === "review_required"
  );
  if (conflict) {
    return {
      state: "conflict",
      owner: "conflict",
      stateField: null,
      resolved: false,
      conflict: true
    };
  }
  const claimById = new Map(
    projection.claims.map((claim) => [claim.claimId, claim])
  );
  const winning = (field: ClaimField): NormalizedWorkClaim | null => {
    const resolution = relevant.find(
      (item) => item.field === field && item.status === "resolved"
    );
    return resolution?.winningClaimId
      ? claimById.get(resolution.winningClaimId) ?? null
      : null;
  };
  const githubState = winning("github_work_item_state");
  const managedState = winning("managed_codex_execution_state");
  const relationship = winning("github_user_relationship");
  const stateClaim = githubState ?? managedState;
  const state =
    stateClaim?.value.type === "enum"
      ? toWorkstreamState(stateClaim.value.value)
      : "unknown";
  const owner =
    relationship?.value.type === "enum" &&
    [
      "assigned_to_user",
      "review_requested_from_user",
      "authored_by_user"
    ].includes(relationship.value.value)
      ? ("user" as const)
      : ("unknown" as const);
  return {
    state,
    owner,
    stateField:
      githubState !== null
        ? "github_work_item_state"
        : managedState !== null
          ? "managed_codex_execution_state"
          : null,
    resolved: stateClaim !== null,
    conflict: false
  };
}

function toWorkstreamState(
  value: string
): CurrentWorkstream["authoritativeState"] {
  switch (value) {
    case "open":
    case "running":
    case "idle":
    case "failed":
    case "interrupted":
    case "completed":
    case "cancelled":
      return value;
    default:
      return "unknown";
  }
}

function terminalState(input: {
  latestKind: RecentMeaningfulEvent["kind"];
  latestGitHubLifecycleKind: RecentMeaningfulEvent["kind"] | null;
  authoritativeState: CurrentWorkstream["authoritativeState"];
  stateField: ClaimField | null;
}): {
  state: CurrentWorkstream["authoritativeState"];
  completionState: CurrentWorkstream["completionState"];
} {
  const {
    latestKind,
    latestGitHubLifecycleKind,
    authoritativeState,
    stateField
  } = input;
  if (authoritativeState === "conflict") {
    return { state: "conflict", completionState: "unknown" };
  }
  if (stateField === "github_work_item_state") {
    if (authoritativeState === "completed") {
      return { state: "completed", completionState: "completed" };
    }
    if (authoritativeState === "cancelled") {
      return { state: "cancelled", completionState: "cancelled" };
    }
    return {
      state: authoritativeState,
      completionState:
        authoritativeState === "unknown" ? "unknown" : "active"
    };
  }
  // A newer managed execution event cannot reopen a task after the latest
  // direct GitHub lifecycle event closed or merged it. Current GitHub state,
  // when available, is handled above and remains authoritative.
  if (latestGitHubLifecycleKind === "github_pull_request_merged") {
    return { state: "completed", completionState: "completed" };
  }
  if (
    latestGitHubLifecycleKind === "github_issue_closed" ||
    latestGitHubLifecycleKind === "github_pull_request_closed"
  ) {
    return { state: "cancelled", completionState: "cancelled" };
  }
  if (
    latestGitHubLifecycleKind === "github_issue_opened" ||
    latestGitHubLifecycleKind === "github_issue_reopened" ||
    latestGitHubLifecycleKind === "github_pull_request_opened" ||
    latestGitHubLifecycleKind === "github_pull_request_reopened"
  ) {
    return { state: "open", completionState: "active" };
  }
  if (stateField === "managed_codex_execution_state") {
    if (
      authoritativeState === "completed" ||
      latestKind === "codex_run_closed" ||
      latestKind === "codex_turn_completed"
    ) {
      return {
        state: authoritativeState,
        completionState: "execution_completed"
      };
    }
    return {
      state: authoritativeState,
      completionState:
        authoritativeState === "unknown" ? "unknown" : "active"
    };
  }
  if (
    latestKind === "codex_run_closed" ||
    latestKind === "codex_turn_completed"
  ) {
    return {
      state: authoritativeState,
      completionState: "execution_completed"
    };
  }
  return {
    state: authoritativeState,
    completionState:
      authoritativeState === "unknown" ? "unknown" : "active"
  };
}

function directLifecycleConflictsWithAuthority(
  kind: RecentMeaningfulEvent["kind"] | null,
  authoritativeState: CurrentWorkstream["authoritativeState"],
  stateField: ClaimField | null
): boolean {
  if (stateField !== "github_work_item_state") return false;
  if (
    kind === "github_pull_request_merged" ||
    kind === "github_issue_closed" ||
    kind === "github_pull_request_closed"
  ) {
    return authoritativeState === "open";
  }
  return false;
}

function latestDirectGitHubLifecycle(
  events: RecentMeaningfulEvent[]
): RecentMeaningfulEvent | null {
  return (
    events.find(
      (event) =>
        event.source === "github" &&
        event.identityScope === "exact_task" &&
        isGitHubLifecycleKind(event.kind)
    ) ?? null
  );
}

function isGitHubLifecycleKind(
  kind: RecentMeaningfulEvent["kind"]
): boolean {
  return (
    kind === "github_issue_opened" ||
    kind === "github_issue_closed" ||
    kind === "github_issue_reopened" ||
    kind === "github_pull_request_opened" ||
    kind === "github_pull_request_closed" ||
    kind === "github_pull_request_reopened" ||
    kind === "github_pull_request_merged"
  );
}

function selectStableWorkstreamAnchor(input: {
  events: RecentMeaningfulEvent[];
  claims: ClaimAuthorityProjection;
  level: CurrentWorkstream["level"];
  projectId: string | null;
  identityRefs: string[];
  claimTargetRefs: string[];
}): string {
  if (input.level === "project" && input.projectId !== null) {
    return createFocusIdentityRef({
      scope: "project_workstream",
      projectId: input.projectId
    });
  }
  const directGitHubClaimTargets = canonical(
    input.events
      .filter(
        (event) =>
          event.source === "github" &&
          event.identityScope === "exact_task"
      )
      .flatMap((event) => event.claimTargetRefs)
  );
  const hasNativeGitHubActivityIdentity = input.events.some(
    (event) =>
      event.source === "github" &&
      event.normalizerVersion ===
        GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
  );
  if (
    hasNativeGitHubActivityIdentity &&
    directGitHubClaimTargets.length === 1
  ) {
    return `github_native_target:${directGitHubClaimTargets[0]}`;
  }
  const directGitHubTaskSubjects = canonical(
    input.events
      .filter(
        (event) =>
          event.source === "github" &&
          event.identityScope === "exact_task" &&
          event.kind !== "github_push"
      )
      .map((event) => event.nativeSubjectRef)
  );
  if (directGitHubTaskSubjects.length === 1) {
    return `github_task:${directGitHubTaskSubjects[0]}`;
  }
  if (directGitHubClaimTargets.length === 1) {
    return `github_native_target:${directGitHubClaimTargets[0]}`;
  }
  const targetForField = (fields: readonly ClaimField[]) =>
    canonical(
      input.claims.fieldResolutions
        .filter(
          (resolution) =>
            input.claimTargetRefs.includes(resolution.target.ref) &&
            fields.includes(resolution.field)
        )
        .map((resolution) => resolution.target.ref)
    )[0] ?? null;
  const githubTarget = targetForField([
    "github_native_identity",
    "github_work_item_state"
  ]);
  if (githubTarget !== null) return `github:${githubTarget}`;

  const directGitHubEvents = input.events.filter(
    (event) =>
      event.source === "github" && event.identityScope === "exact_task"
  );
  if (directGitHubEvents.length > 0) {
    const sharedNativeRefs = directGitHubEvents[0]!.identityRefs.filter(
      (identityRef) =>
        directGitHubEvents.every((event) =>
          event.identityRefs.includes(identityRef)
        )
    );
    if (sharedNativeRefs.length > 0) {
      return canonical(sharedNativeRefs)[0]!;
    }
  }

  const managedTarget = targetForField([
    "managed_codex_execution_state"
  ]);
  if (managedTarget !== null) return `managed:${managedTarget}`;
  return input.identityRefs[0]!;
}

function activeBlockerFor(
  events: RecentMeaningfulEvent[],
  state: CurrentWorkstream["authoritativeState"]
): CurrentWorkstream["activeBlocker"] {
  const currentGitHubStateKinds = new Set(
    events
      .filter(
        (event) =>
          event.source === "github" &&
          event.timeBasis === "source_updated_state_observation" &&
          event.currentness === "current" &&
          event.completeness === "complete"
      )
      .map((event) => event.kind)
  );
  if (currentGitHubStateKinds.has("github_merge_conflict")) {
    return "merge_conflict";
  }
  if (currentGitHubStateKinds.has("github_changes_requested")) {
    return "changes_requested";
  }
  if (currentGitHubStateKinds.has("github_ci_failed")) {
    return "ci_failed";
  }
  const latestManagedEvent = events.find(
    (event) => event.source === "codex_managed"
  );
  const latestManagedEventIsCurrent =
    latestManagedEvent?.currentness === "current" &&
    latestManagedEvent.completeness === "complete" &&
    latestManagedEvent.attentionCapability === "focus_selector";
  if (
    latestManagedEventIsCurrent &&
    latestManagedEvent?.kind === "codex_waiting_approval"
  ) {
    return "waiting_on_approval";
  }
  if (
    latestManagedEventIsCurrent &&
    latestManagedEvent?.kind === "codex_waiting_user_input"
  ) {
    return "waiting_on_user_input";
  }
  if (
    latestManagedEventIsCurrent &&
    (latestManagedEvent?.kind === "codex_turn_failed" ||
      latestManagedEvent?.kind === "codex_run_failed")
  ) {
    return "codex_failure";
  }
  return "none";
}

function find(parent: number[], index: number): number {
  let current = index;
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]!]!;
    current = parent[current]!;
  }
  return current;
}

function union(parent: number[], left: number, right: number) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot === rightRoot) return;
  parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}
