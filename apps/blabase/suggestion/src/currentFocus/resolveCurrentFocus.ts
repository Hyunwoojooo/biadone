import {
  managedCodexArtifactRelationProjectionSchema,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts/contracts";
import {
  claimAuthorityProjectionSchema,
  type ClaimAuthorityProjection
} from "../claims/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CURRENT_FOCUS_ID_POLICY_VERSION,
  CURRENT_FOCUS_PROJECTION_CONTRACT,
  CURRENT_FOCUS_SCHEMA_VERSION,
  CURRENT_FOCUS_SELECTION_POLICY_VERSION,
  CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION
} from "../crossSource/versions";
import {
  managedCodexWorkRelationProjectionSchema,
  type ManagedCodexWorkRelationProjection
} from "../relations/contracts";
import {
  projectRecentMeaningfulEvents,
  recentMeaningfulEventProjectionSchema,
  type RecentMeaningfulEventProjection,
  type RecentMeaningfulEventProjectionInput
} from "../recentEvents";
import {
  confirmedCurrentFocusInputSchema,
  createCurrentFocusId,
  CURRENT_FOCUS_RECENT_WINDOW_MS,
  currentWorkstreamProjectionSchema,
  sealCurrentFocusProjection,
  type ConfirmedCurrentFocusInput,
  type CurrentFocusProjection,
  type CurrentWorkstream,
  type CurrentWorkstreamProjection
} from "./contracts";
import { reconstructCurrentWorkStreams } from "./reconstructCurrentWorkStreams";

const MAX_FUTURE_EVENT_SKEW_MS = 60_000;

export type ResolveCurrentFocusInput = {
  asOf: string;
  recentEventProjection: RecentMeaningfulEventProjection;
  workstreamProjection: CurrentWorkstreamProjection;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  claimAuthorityProjection: ClaimAuthorityProjection;
  explicitFocus?: ConfirmedCurrentFocusInput | null;
};

export type ResolvedCurrentFocusEvidence = {
  recentMeaningfulEvents: RecentMeaningfulEventProjection;
  currentWorkstreams: CurrentWorkstreamProjection;
  currentFocus: CurrentFocusProjection;
};

export function resolveCurrentFocus(
  input: ResolveCurrentFocusInput
): CurrentFocusProjection {
  const asOf = new Date(input.asOf).toISOString();
  const recentEvents = recentMeaningfulEventProjectionSchema.parse(
    input.recentEventProjection
  );
  const workstreams = currentWorkstreamProjectionSchema.parse(
    input.workstreamProjection
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
    workstreams.asOf !== asOf ||
    workRelations.asOf !== asOf ||
    artifacts.asOf !== asOf ||
    claims.asOf !== asOf ||
    workstreams.recentEventProjectionSha256 !==
      recentEvents.projectionSha256 ||
    workstreams.workRelationProjectionSha256 !==
      workRelations.projectionSha256 ||
    workstreams.artifactRelationProjectionSha256 !==
      artifacts.projectionSha256 ||
    workstreams.claimAuthorityProjectionSha256 !==
      claims.projectionSha256
  ) {
    throw new TypeError(
      "Current Focus requires one exact WorkStream evidence graph."
    );
  }
  const dependencies = {
    recentEventProjectionSha256: recentEvents.projectionSha256,
    workstreamProjectionSha256: workstreams.projectionSha256,
    workRelationProjectionSha256: workRelations.projectionSha256,
    artifactRelationProjectionSha256: artifacts.projectionSha256,
    claimAuthorityProjectionSha256: claims.projectionSha256
  };
  const explicitFocus =
    input.explicitFocus === undefined || input.explicitFocus === null
      ? null
      : parseConfirmedFocus(input.explicitFocus);
  const inputSha256 = runtimeSha256({
    domain: "current-focus-input-v0.1",
    asOf,
    dependencies,
    explicitFocusSha256: explicitFocus?.confirmationSha256 ?? null,
    recentWindowMs: CURRENT_FOCUS_RECENT_WINDOW_MS,
    schemaVersion: CURRENT_FOCUS_SCHEMA_VERSION,
    selectionPolicyVersion: CURRENT_FOCUS_SELECTION_POLICY_VERSION
  });

  if (
    explicitFocus !== null &&
    Date.parse(explicitFocus.confirmedAt) <= Date.parse(asOf) &&
    Date.parse(explicitFocus.validUntil) >= Date.parse(asOf)
  ) {
    const selected = workstreams.workstreams.find(
      (workstream) =>
        workstream.workstreamId === explicitFocus.workstreamId
    );
    if (selected) {
      return sealCurrentFocusProjection({
        contract: CURRENT_FOCUS_PROJECTION_CONTRACT,
        schemaVersion: CURRENT_FOCUS_SCHEMA_VERSION,
        selectionPolicyVersion: CURRENT_FOCUS_SELECTION_POLICY_VERSION,
        idPolicyVersion: CURRENT_FOCUS_ID_POLICY_VERSION,
        rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
        asOf,
        recentWindowMs: CURRENT_FOCUS_RECENT_WINDOW_MS,
        dependencies,
        inputSha256,
        status: "selected",
        selectedFocus: selectedFocus(selected),
        reasonCodes: ["FOCUS_EXPLICIT_USER_CONFIRMATION"],
        explicitFocusApplied: true,
        attentionSelectionEffect: "none",
        attentionDisposition: "shadow_only",
        forbiddenAsAttentionCandidate: true
      });
    }
  }

  // Implicit Focus compares the newest event across direct sources. If one
  // direct source is stale, partial, or unavailable, a newer competing event
  // may be missing, so selection must abstain. Explicit user confirmation is
  // intentionally evaluated first and remains authoritative for its TTL.
  const coverageReason = directSourceCoverageReason(recentEvents.coverage);
  if (coverageReason !== null) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: [coverageReason]
    });
  }

  if (workstreams.workstreams.length === 0) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: recentEvents.events.length === 0 ? "unavailable" : "unresolved",
      reasonCodes:
        recentEvents.events.length === 0
          ? ["FOCUS_NO_MEANINGFUL_EVENT"]
          : ["FOCUS_INSUFFICIENT_IDENTITY"]
    });
  }

  // Select from direct-source WorkStreams first, then validate quality. A
  // newer stale/partial direct event must cause abstention instead of being
  // silently skipped in favor of an older healthy event.
  const focusRelevant = workstreams.workstreams.filter(
    (workstream) =>
      workstream.latestMeaningfulEvent.source !== "codex_inventory"
  );
  if (focusRelevant.length === 0) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_INSUFFICIENT_IDENTITY"]
    });
  }

  const latestTime = Date.parse(
    focusRelevant[0]!.latestMeaningfulEvent.occurredAt
  );
  const latest = focusRelevant.filter(
    (workstream) =>
      Date.parse(workstream.latestMeaningfulEvent.occurredAt) === latestTime
  );
  if (latest.length > 1) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_LATEST_EVENT_TIE"]
    });
  }
  const selected = latest[0]!;
  const ageMs = Date.parse(asOf) - latestTime;
  if (
    ageMs < -MAX_FUTURE_EVENT_SKEW_MS ||
    ageMs > CURRENT_FOCUS_RECENT_WINDOW_MS
  ) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_EVENT_OUTSIDE_RECENT_WINDOW"]
    });
  }
  if (selected.currentness !== "current") {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: [currentnessReason(selected)]
    });
  }
  if (selected.completeness !== "complete") {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_SOURCE_PARTIAL"]
    });
  }
  if (
    selected.latestMeaningfulEvent.attentionCapability !==
    "focus_selector"
  ) {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_INSUFFICIENT_IDENTITY"]
    });
  }
  if (selected.reconstructionConfidence === "low") {
    return unresolved({
      asOf,
      dependencies,
      inputSha256,
      status: "unresolved",
      reasonCodes: ["FOCUS_INSUFFICIENT_IDENTITY"]
    });
  }
  return sealCurrentFocusProjection({
    contract: CURRENT_FOCUS_PROJECTION_CONTRACT,
    schemaVersion: CURRENT_FOCUS_SCHEMA_VERSION,
    selectionPolicyVersion: CURRENT_FOCUS_SELECTION_POLICY_VERSION,
    idPolicyVersion: CURRENT_FOCUS_ID_POLICY_VERSION,
    rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
    asOf,
    recentWindowMs: CURRENT_FOCUS_RECENT_WINDOW_MS,
    dependencies,
    inputSha256,
    status: "selected",
    selectedFocus: selectedFocus(selected),
    reasonCodes: canonical([
      "FOCUS_LATEST_DIRECT_COMPLETE_EVENT",
      ...(selected.level === "project"
        ? ["FOCUS_PROJECT_LEVEL_ONLY"]
        : [])
    ]) as CurrentFocusProjection["reasonCodes"],
    explicitFocusApplied: false,
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

export function resolveCurrentFocusFromEvidence(
  input: RecentMeaningfulEventProjectionInput & {
    explicitFocus?: ConfirmedCurrentFocusInput | null;
  }
): ResolvedCurrentFocusEvidence {
  const recentMeaningfulEvents = projectRecentMeaningfulEvents(input);
  const currentWorkstreams = reconstructCurrentWorkStreams({
    asOf: input.asOf,
    recentEventProjection: recentMeaningfulEvents,
    workRelationProjection: input.workRelationProjection,
    artifactRelationProjection: input.artifactRelationProjection,
    claimAuthorityProjection: input.claimAuthorityProjection
  });
  const currentFocus = resolveCurrentFocus({
    asOf: input.asOf,
    recentEventProjection: recentMeaningfulEvents,
    workstreamProjection: currentWorkstreams,
    workRelationProjection: input.workRelationProjection,
    artifactRelationProjection: input.artifactRelationProjection,
    claimAuthorityProjection: input.claimAuthorityProjection,
    explicitFocus: input.explicitFocus ?? null
  });
  return {
    recentMeaningfulEvents,
    currentWorkstreams,
    currentFocus
  };
}

export function createConfirmedCurrentFocusInput(input: {
  workstreamId: string;
  confirmedAt: string;
  validUntil: string;
}): ConfirmedCurrentFocusInput {
  const content = {
    workstreamId: input.workstreamId,
    confirmedAt: new Date(input.confirmedAt).toISOString(),
    validUntil: new Date(input.validUntil).toISOString()
  };
  return confirmedCurrentFocusInputSchema.parse({
    ...content,
    confirmationSha256: runtimeSha256({
      domain: "confirmed-current-focus-v0.1",
      focus: content
    })
  });
}

function parseConfirmedFocus(
  input: ConfirmedCurrentFocusInput
): ConfirmedCurrentFocusInput {
  const parsed = confirmedCurrentFocusInputSchema.parse(input);
  const { confirmationSha256, ...content } = parsed;
  if (
    confirmationSha256 !==
    runtimeSha256({
      domain: "confirmed-current-focus-v0.1",
      focus: content
    })
  ) {
    throw new TypeError("Confirmed Current Focus hash is invalid.");
  }
  return parsed;
}

function selectedFocus(
  workstream: CurrentWorkstream
): NonNullable<CurrentFocusProjection["selectedFocus"]> {
  return {
    focusId: createCurrentFocusId({
      workstreamId: workstream.workstreamId,
      latestEventId: workstream.latestMeaningfulEvent.eventId
    }),
    workstreamId: workstream.workstreamId,
    projectId: workstream.projectId,
    level: workstream.level,
    displayLabel: workstream.displayLabel,
    identityRefs: workstream.identityRefs,
    latestMeaningfulEvent: workstream.latestMeaningfulEvent,
    authoritativeState: workstream.authoritativeState,
    activeBlocker: workstream.activeBlocker,
    owner: workstream.owner,
    completionState: workstream.completionState,
    currentness: workstream.currentness,
    completeness: workstream.completeness,
    reconstructionConfidence: workstream.reconstructionConfidence
  };
}

function unresolved(input: {
  asOf: string;
  dependencies: CurrentFocusProjection["dependencies"];
  inputSha256: string;
  status: "unresolved" | "unavailable";
  reasonCodes: CurrentFocusProjection["reasonCodes"];
}): CurrentFocusProjection {
  return sealCurrentFocusProjection({
    contract: CURRENT_FOCUS_PROJECTION_CONTRACT,
    schemaVersion: CURRENT_FOCUS_SCHEMA_VERSION,
    selectionPolicyVersion: CURRENT_FOCUS_SELECTION_POLICY_VERSION,
    idPolicyVersion: CURRENT_FOCUS_ID_POLICY_VERSION,
    rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
    asOf: input.asOf,
    recentWindowMs: CURRENT_FOCUS_RECENT_WINDOW_MS,
    dependencies: input.dependencies,
    inputSha256: input.inputSha256,
    status: input.status,
    selectedFocus: null,
    reasonCodes: canonical(input.reasonCodes) as CurrentFocusProjection["reasonCodes"],
    explicitFocusApplied: false,
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

function currentnessReason(
  workstream: CurrentWorkstream
): CurrentFocusProjection["reasonCodes"][number] {
  switch (workstream.currentness) {
    case "stale":
      return "FOCUS_SOURCE_STALE";
    case "partial":
      return "FOCUS_SOURCE_PARTIAL";
    case "conflict":
      return "FOCUS_AUTHORITY_CONFLICT";
    default:
      return "FOCUS_INSUFFICIENT_IDENTITY";
  }
}

function directSourceCoverageReason(
  coverage: RecentMeaningfulEventProjection["coverage"]
): CurrentFocusProjection["reasonCodes"][number] | null {
  if (coverage.github === "unavailable" || coverage.codexManaged === "unavailable") {
    return "FOCUS_PROJECTION_UNAVAILABLE";
  }
  if (coverage.github === "stale") return "FOCUS_SOURCE_STALE";
  if (coverage.github === "partial" || coverage.codexManaged === "partial") {
    return "FOCUS_SOURCE_PARTIAL";
  }
  return null;
}

function canonical<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareRuntimeStrings) as T[];
}
