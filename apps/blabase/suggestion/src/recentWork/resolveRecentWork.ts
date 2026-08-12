import type { CodexLocalGitSnapshot } from "../connectors/codex/localGitContracts";
import type { ConfirmedRepositoryScopeLinkResolution } from "../context";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import type { RuntimeWorkSignalBatch } from "../crossSource/schema";
import type { CurrentFocusProjection } from "../currentFocus";
import { createRecentMeaningfulEventId } from "../recentEvents";
import {
  RECENT_WORK_FOCUS_MAX_AGE_MS,
  RECENT_WORK_LOCAL_GIT_MAX_AGE_MS,
  RECENT_WORK_MAX_FUTURE_SKEW_MS,
  RECENT_WORK_PROJECTION_CONTRACT,
  RECENT_WORK_RESOLVER_VERSION,
  RECENT_WORK_SCHEMA_VERSION,
  createUnavailableRecentWorkProjection,
  recentWorkPublicSummarySchema,
  sealRecentWorkProjection,
  type RecentWorkProjection,
  type RecentWorkPublicSummary,
  type RecentWorkReasonCode
} from "./contracts";

export const RECENT_WORK_PRESENTATION_MODE_ENV =
  "BLABASE_RECENT_WORK_PRESENTATION_MODE" as const;

export type RecentWorkPresentationMode = "shadow" | "present";
export type RecentWorkPresentationEnv = Readonly<
  Record<string, string | undefined>
>;

export type ResolveRecentWorkInput = {
  asOf: string;
  currentFocus: CurrentFocusProjection;
  githubBatch: RuntimeWorkSignalBatch | null;
  confirmedLinks: ConfirmedRepositoryScopeLinkResolution;
  localGitSnapshot: CodexLocalGitSnapshot | null;
};

function resolveExactRecentWork(
  input: ResolveRecentWorkInput
): RecentWorkProjection {
  const focus = input.currentFocus.selectedFocus;
  const focusEvent = focus?.latestMeaningfulEvent ?? null;
  const inputSha256 = runtimeSha256({
    domain: "recent-work-input-v0.2",
    asOf: input.asOf,
    currentFocusProjectionSha256: input.currentFocus.projectionSha256,
    focusEventSha256: focusEvent?.eventSha256 ?? null,
    githubBatchSha256: input.githubBatch?.batchSha256 ?? null,
    confirmedLinks: input.confirmedLinks,
    localGitSnapshotSha256:
      input.localGitSnapshot?.snapshotSha256 ?? null
  });
  const unavailable = (
    reasonCode: Exclude<
      RecentWorkReasonCode,
      "RECENT_WORK_MATCHED" | "RECENT_WORK_PUSH_ACTIVITY_MATCHED"
    >
  ) =>
    createUnavailableRecentWorkProjection({
      asOf: input.asOf,
      inputSha256,
      reasonCode
    });

  if (
    input.currentFocus.status !== "selected" ||
    focus === null ||
    focus.projectId === null
  ) {
    return unavailable("RECENT_WORK_FOCUS_UNAVAILABLE");
  }
  const event = focus.latestMeaningfulEvent;
  if (event.source !== "github" || event.kind !== "github_push") {
    return unavailable("RECENT_WORK_FOCUS_NOT_GITHUB_PUSH");
  }
  if (
    focus.currentness !== "current" ||
    focus.completeness !== "complete" ||
    event.freshness !== "current" ||
    event.completeness !== "complete" ||
    event.currentness !== "current" ||
    event.attentionCapability !== "focus_selector"
  ) {
    return unavailable("RECENT_WORK_FOCUS_NOT_CURRENT");
  }
  if (
    !withinAge(
      event.occurredAt,
      input.asOf,
      RECENT_WORK_FOCUS_MAX_AGE_MS
    )
  ) {
    return unavailable("RECENT_WORK_FOCUS_STALE");
  }
  const pushRepositoryScope = resolvePushRepositoryScope(
    input.githubBatch,
    event.eventId
  );
  if (pushRepositoryScope.status === "unavailable") {
    return unavailable("RECENT_WORK_FOCUS_REPOSITORY_UNAVAILABLE");
  }
  if (pushRepositoryScope.status === "conflict") {
    return unavailable("RECENT_WORK_FOCUS_REPOSITORY_CONFLICT");
  }
  if (input.confirmedLinks.status === "conflict") {
    return unavailable("RECENT_WORK_LINK_CONFLICT");
  }
  if (input.confirmedLinks.status !== "ready") {
    return unavailable("RECENT_WORK_LINK_UNAVAILABLE");
  }
  const matchingLinks = input.confirmedLinks.links.filter(
    (link) =>
      link.projectId === focus.projectId &&
      link.scopes.github.opaqueId ===
        pushRepositoryScope.repositoryOpaqueId
  );
  if (matchingLinks.length === 0) {
    return unavailable("RECENT_WORK_LINK_UNAVAILABLE");
  }
  if (matchingLinks.length !== 1) {
    return unavailable("RECENT_WORK_LINK_TIE");
  }
  const link = matchingLinks[0];
  const localGitSnapshot = input.localGitSnapshot;
  if (
    localGitSnapshot === null ||
    localGitSnapshot.truncated ||
    localGitSnapshot.snapshotSha256 !== link.localGitSnapshotSha256
  ) {
    return unavailable("RECENT_WORK_LOCAL_GIT_UNAVAILABLE");
  }
  if (
    !withinAge(
      localGitSnapshot.fetchedAt,
      input.asOf,
      RECENT_WORK_LOCAL_GIT_MAX_AGE_MS
    )
  ) {
    return unavailable("RECENT_WORK_LOCAL_GIT_STALE");
  }
  if (
    localGitSnapshot.scopeIds.filter(
      (scopeId) => scopeId === link.scopes.codex.opaqueId
    ).length !== 1
  ) {
    return unavailable("RECENT_WORK_LOCAL_GIT_CONFLICT");
  }
  const rows = localGitSnapshot.repositories.filter(
    (repository) => repository.scopeId === link.scopes.codex.opaqueId
  );
  if (rows.length !== 1) {
    return unavailable("RECENT_WORK_LOCAL_GIT_CONFLICT");
  }
  const row = rows[0];
  if (
    row.mappingEligibility !== "exact" ||
    row.githubRepositoryKey === null ||
    localGitSnapshot.repositories.filter(
      (candidate) =>
        candidate.mappingEligibility === "exact" &&
        candidate.githubRepositoryKey === row.githubRepositoryKey
    ).length !== 1
  ) {
    return unavailable("RECENT_WORK_LOCAL_GIT_CONFLICT");
  }
  if (row.trackingState === "unborn") {
    return unavailable("RECENT_WORK_LOCAL_GIT_UNBORN");
  }
  if (row.trackingState === "unavailable") {
    return unavailable("RECENT_WORK_LOCAL_GIT_UNAVAILABLE");
  }

  return sealRecentWorkProjection({
    contract: RECENT_WORK_PROJECTION_CONTRACT,
    schemaVersion: RECENT_WORK_SCHEMA_VERSION,
    resolverVersion: RECENT_WORK_RESOLVER_VERSION,
    asOf: input.asOf,
    inputSha256,
    status: "matched",
    reasonCodes: ["RECENT_WORK_MATCHED"],
    match: {
      matchKind: "confirmed_focus",
      linkId: link.linkId,
      projectId: focus.projectId,
      displayLabel: safeDisplayLabel(focus.displayLabel),
      pushOccurredAt: event.occurredAt,
      trackingState: row.trackingState,
      aheadCount: row.aheadCount,
      behindCount: row.behindCount,
      correlation: "repository_scope_only",
      currentFocusProjectionSha256: input.currentFocus.projectionSha256,
      focusEventSha256: event.eventSha256,
      registrySha256: link.registrySha256,
      localGitSnapshotSha256: localGitSnapshot.snapshotSha256
    },
    presentationDisposition: "sidecar_only",
    correlationBasis: "repository_scope_only",
    attentionSelectionEffect: "none",
    candidateEligibilityEffect: "none",
    rankingEffect: "none",
    executionEffect: "none"
  });
}

export function resolveRecentWork(
  input: ResolveRecentWorkInput
): RecentWorkProjection {
  const exact = resolveExactRecentWork(input);
  if (exact.status === "matched") return exact;

  const asOfMs = Date.parse(input.asOf);
  const push = input.githubBatch?.signals
    .filter(
      (signal) =>
        signal.kind === "activity_observation" &&
        signal.facts.activityKind === "push" &&
        signal.completeness === "complete" &&
        signal.sourceUpdatedAt !== null &&
        /^repository:[0-9]+$/u.test(signal.sourceScopeId) &&
        Date.parse(signal.sourceUpdatedAt) >=
          asOfMs - RECENT_WORK_FOCUS_MAX_AGE_MS &&
        Date.parse(signal.sourceUpdatedAt) <=
          asOfMs + RECENT_WORK_MAX_FUTURE_SKEW_MS
    )
    .sort((left, right) => {
      const occurredAtDifference =
        Date.parse(right.sourceUpdatedAt!) -
        Date.parse(left.sourceUpdatedAt!);
      return occurredAtDifference !== 0
        ? occurredAtDifference
        : left.signalId.localeCompare(right.signalId);
    })[0];

  if (push === undefined || push.sourceUpdatedAt === null) return exact;

  const needsScopeSelection = input.confirmedLinks.status === "conflict";
  return sealRecentWorkProjection({
    contract: RECENT_WORK_PROJECTION_CONTRACT,
    schemaVersion: RECENT_WORK_SCHEMA_VERSION,
    resolverVersion: RECENT_WORK_RESOLVER_VERSION,
    asOf: input.asOf,
    inputSha256: exact.inputSha256,
    status: "matched",
    reasonCodes: ["RECENT_WORK_PUSH_ACTIVITY_MATCHED"],
    match: {
      matchKind: "verified_push_activity",
      displayLabel: needsScopeSelection
        ? "최근 GitHub push · 작업 공간 선택 필요"
        : "최근 GitHub push · 로컬 작업 공간 연결 필요",
      pushOccurredAt: push.sourceUpdatedAt,
      trackingState: "not_configured",
      aheadCount: null,
      behindCount: null,
      correlation: "repository_scope_only",
      githubBatchSha256: input.githubBatch!.batchSha256,
      activitySignalSha256: push.signalHash
    },
    presentationDisposition: "sidecar_only",
    correlationBasis: "repository_scope_only",
    attentionSelectionEffect: "none",
    candidateEligibilityEffect: "none",
    rankingEffect: "none",
    executionEffect: "none"
  });
}

function resolvePushRepositoryScope(
  githubBatch: RuntimeWorkSignalBatch | null,
  selectedEventId: string
):
  | { status: "matched"; repositoryOpaqueId: string }
  | { status: "unavailable" }
  | { status: "conflict" } {
  if (githubBatch === null) return { status: "unavailable" };
  const matches = githubBatch.signals.filter((signal) => {
    if (
      signal.kind !== "activity_observation" ||
      signal.facts.activityKind !== "push" ||
      signal.sourceUpdatedAt === null
    ) {
      return false;
    }
    return (
      createRecentMeaningfulEventId({
        source: "github",
        kind: "github_push",
        stableIdentity: {
          signalId: signal.signalId,
          kind: "github_push",
          sourceUpdatedAt: signal.sourceUpdatedAt
        }
      }) === selectedEventId
    );
  });
  if (matches.length === 0) return { status: "unavailable" };
  if (matches.length !== 1) return { status: "conflict" };
  const repositoryScope = /^repository:([0-9]+)$/u.exec(
    matches[0]!.sourceScopeId
  );
  return repositoryScope === null
    ? { status: "unavailable" }
    : { status: "matched", repositoryOpaqueId: repositoryScope[1]! };
}

export function resolveRecentWorkPresentationMode(
  env: RecentWorkPresentationEnv
): RecentWorkPresentationMode {
  return env[RECENT_WORK_PRESENTATION_MODE_ENV] === "present"
    ? "present"
    : "shadow";
}

export function projectRecentWorkPublicSummary(
  projection: RecentWorkProjection,
  mode: RecentWorkPresentationMode
): RecentWorkPublicSummary | null {
  if (mode !== "present" || projection.match === null) return null;
  const pushOccurredAt = new Date(projection.match.pushOccurredAt);
  if (!Number.isFinite(pushOccurredAt.getTime())) return null;
  const parsed = recentWorkPublicSummarySchema.safeParse({
    displayLabel: projection.match.displayLabel,
    pushOccurredAt: pushOccurredAt.toISOString(),
    trackingState: projection.match.trackingState,
    aheadCount: projection.match.aheadCount,
    behindCount: projection.match.behindCount,
    correlation: "repository_scope_only",
    presentation: "display_only",
    attentionSelectionEffect: "none",
    executionEffect: "none"
  });
  return parsed.success ? parsed.data : null;
}

function withinAge(
  value: string,
  asOf: string,
  maxAgeMs: number
): boolean {
  const timestamp = Date.parse(value);
  const current = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return false;
  const age = current - timestamp;
  return age >= -RECENT_WORK_MAX_FUTURE_SKEW_MS && age <= maxAgeMs;
}

function safeDisplayLabel(value: string): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu,
      " "
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
  return normalized || "최근 GitHub 작업";
}
