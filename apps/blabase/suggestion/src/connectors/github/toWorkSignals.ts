import type {
  GitHubTaskKind,
  GitHubTaskSignal,
  GitHubUserActivitySignal
} from "./types";

import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../../crossSource/canonicalHash";
import {
  computeNormalizationInputSha256,
  issuesFromAssessment,
  sortNormalizationIssues,
  sortRuntimeSignals,
  type RuntimeNormalizationResult
} from "../../crossSource/normalization";
import {
  type FreshnessPolicy,
  type NormalizationIssue,
  type RuntimeWorkSignal
} from "../../crossSource/schema";
import {
  assessSnapshot,
  validateGitHubSnapshot
} from "../../crossSource/validateSnapshots";
import {
  GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT
} from "../../crossSource/versions";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../../crossSource/workSignalIntegrity";

export type GitHubNormalizationOptions = {
  asOf: string;
  freshnessPolicy: FreshnessPolicy;
  contextRegistrySha256?: string | null;
  resolveProjectId?: (sourceScopeId: string) => string | null;
};

type GitHubWorkSignalNormalizerVersion =
  | typeof GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
  | typeof GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION
  | typeof GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION
  | typeof GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION
  | typeof GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION;

export function normalizeGitHubSnapshotToWorkSignals(
  input: unknown,
  options: GitHubNormalizationOptions
): RuntimeNormalizationResult {
  const validation = validateGitHubSnapshot(input);
  if (validation.status === "rejected") return validation;

  const artifact = validation.artifact;
  const normalizerVersion =
    artifact.sourceSchemaVersion === "github-snapshot-v6"
      ? GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
      : artifact.sourceSchemaVersion === "github-snapshot-v5"
        ? GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION
        : artifact.sourceSchemaVersion === "github-snapshot-v4"
          ? GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION
          : artifact.sourceSchemaVersion === "github-snapshot-v3"
            ? GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION
            : GITHUB_WORK_SIGNAL_NORMALIZER_VERSION;
  const assessment = assessSnapshot(
    artifact,
    options.asOf,
    options.freshnessPolicy
  );
  const issues = issuesFromAssessment(assessment);
  const signals: RuntimeWorkSignal[] = [];
  let skippedRecordCount = 0;

  if (assessment.usableForOverview) {
    const uniqueTasks = uniqueRecords(
      artifact.payload.tasks,
      (task) => `${task.kind}:${task.id}`,
      (task) => githubSubjectId(task.id),
      issues
    );
    const uniqueActivities = uniqueRecords(
      artifact.payload.activities,
      (activity) => activity.id,
      (activity) => githubActivitySubjectId(activity.id),
      issues
    );
    skippedRecordCount +=
      artifact.payload.tasks.length -
      uniqueTasks.records.length +
      artifact.payload.activities.length -
      uniqueActivities.records.length;

    for (const task of uniqueTasks.records) {
      if (
        timestampTooFarInFuture(
          task.updatedAt,
          artifact.fetchedAt,
          options.freshnessPolicy.maxFutureClockSkewMs
        )
      ) {
        skippedRecordCount += 1;
        issues.push(recordInvalidIssue(githubSubjectId(task.id), task));
        continue;
      }
      const normalized = normalizeTask(
        task,
        artifact.sourceSnapshotSha256,
        artifact.fetchedAt,
        assessment.truncated,
        issues,
        normalizerVersion,
        options.resolveProjectId
      );
      signals.push(...normalized);
    }

    for (const activity of uniqueActivities.records) {
      if (
        timestampTooFarInFuture(
          activity.occurredAt,
          artifact.fetchedAt,
          options.freshnessPolicy.maxFutureClockSkewMs
        )
      ) {
        skippedRecordCount += 1;
        issues.push(
          recordInvalidIssue(
            githubActivitySubjectId(activity.id),
            activity
          )
        );
        continue;
      }
      signals.push(
        normalizeActivity(
          activity,
          artifact.sourceSnapshotSha256,
          artifact.fetchedAt,
          assessment.truncated,
          normalizerVersion,
          options.resolveProjectId
        )
      );
    }
  } else {
    skippedRecordCount =
      artifact.payload.tasks.length +
      artifact.payload.activities.length;
  }

  const sortedSignals = sortRuntimeSignals(signals);
  return {
    status: "normalized",
    batch: finalizeRuntimeWorkSignalBatch({
      contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
      source: "github",
      sourceSchemaVersion: artifact.sourceSchemaVersion,
      collectorVersion: artifact.collectorVersion,
      normalizerVersion,
      workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      normalizationInputSha256: computeNormalizationInputSha256({
        sourceSnapshotSha256: artifact.sourceSnapshotSha256,
        sourceSchemaVersion: artifact.sourceSchemaVersion,
        normalizerVersion,
        asOf: assessment.asOf,
        freshnessPolicy: options.freshnessPolicy,
        contextRegistrySha256:
          options.contextRegistrySha256 ?? null
      }),
      assessment,
      skippedRecordCount,
      issues: sortNormalizationIssues(issues),
      signals: sortedSignals
    })
  };
}

function normalizeTask(
  task: GitHubTaskSignal,
  snapshotSha256: string,
  observedAt: string,
  truncated: boolean,
  issues: NormalizationIssue[],
  normalizerVersion: GitHubWorkSignalNormalizerVersion,
  resolveProjectId:
    | ((sourceScopeId: string) => string | null)
    | undefined
): RuntimeWorkSignal[] {
  const subjectId = githubSubjectId(task.id);
  const sourceScopeId = `repository:${task.repositoryId}`;
  const projectId = resolveProjectId?.(sourceScopeId) ?? null;
  const relationship = relationshipFor(task.kind);
  const actionableAuthoredPullRequest =
    task.kind === "authored_pull_request" &&
    task.actionability?.actionRequired === true;
  const destinationUrl = safeGitHubDestination(task);
  if (destinationUrl === null) {
    issues.push({
      code: "UNSAFE_DESTINATION",
      subjectId,
      recordSha256: runtimeSha256({
        domain: "github-unsafe-destination-v0.1",
        value: task.htmlUrl
      })
    });
  }
  const workItem = finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion,
    source: "github",
    subjectId,
    subjectType: "work_item",
    sourceScopeId,
    projectId,
    kind: "work_item_observation",
    facts: {
      objectType:
        task.kind === "assigned_issue" ? "issue" : "pull_request",
      taskKind: task.kind,
      state: "open",
      relationship,
      semanticRole:
        task.kind === "authored_pull_request" &&
        !actionableAuthoredPullRequest
          ? "context_only"
          : "direct_work_item",
      eligibilityLimit:
        task.kind === "assigned_issue"
          ? "none"
          : task.kind === "review_requested_pull_request"
            ? "draft_state_unknown"
            : actionableAuthoredPullRequest
              ? "none"
              : "not_actionable_by_source_kind",
      draftState:
        task.kind === "assigned_issue"
          ? "not_applicable"
          : task.actionability === undefined
            ? "unknown"
            : task.actionability.draft
              ? "draft"
              : "ready",
      repositoryFullName: safeText(
        task.repositoryFullName,
        "repository"
      ),
      number: task.number,
      title: safeText(task.title, "Untitled GitHub item"),
      destinationUrl,
      ...(task.actionability
        ? { actionability: task.actionability }
        : {})
    },
    observedAt,
    sourceUpdatedAt: task.updatedAt,
    validUntil: null,
    directness: "explicit",
    completeness: truncated ? "truncated" : "complete",
    attentionCapability:
      task.kind === "authored_pull_request" &&
      !actionableAuthoredPullRequest
        ? "overview_only"
        : "candidate_input",
    evidence: [
      {
        type: "github_query_membership",
        source: "github",
        queryKind: queryKindFor(task.kind),
        objectId: String(task.id),
        snapshotSha256,
        subjectId,
        observedAt,
        sourceUpdatedAt: task.updatedAt
      },
      ...githubTaskFieldEvidence(
        task,
        snapshotSha256,
        subjectId,
        observedAt
      ),
      ...githubActionabilityEvidence(
        task,
        snapshotSha256,
        subjectId,
        observedAt
      )
    ]
  });
  if (task.milestoneDueAt === null) return [workItem];

  const deadline = finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion,
    source: "github",
    subjectId,
    subjectType: "work_item",
    sourceScopeId,
    projectId,
    kind: "deadline_observation",
    facts: {
      deadlineAt: task.milestoneDueAt,
      deadlineKind: "milestone_due_at",
      taskKind: task.kind,
      semanticRole:
        task.kind === "authored_pull_request"
          ? "context_only"
          : "direct_work_item",
      eligibilityLimit:
        task.kind === "assigned_issue"
          ? "none"
          : task.kind === "review_requested_pull_request"
            ? "draft_state_unknown"
            : "not_actionable_by_source_kind"
    },
    observedAt,
    sourceUpdatedAt: task.updatedAt,
    validUntil: null,
    directness: "explicit",
    completeness: truncated ? "truncated" : "complete",
    attentionCapability:
      task.kind === "authored_pull_request"
        ? "overview_only"
        : "candidate_input",
    evidence: [
      {
        type: "github_query_membership",
        source: "github",
        queryKind: queryKindFor(task.kind),
        objectId: String(task.id),
        snapshotSha256,
        subjectId,
        observedAt,
        sourceUpdatedAt: task.updatedAt
      },
      githubObjectEvidence(
        task,
        "milestone_due_at",
        task.milestoneDueAt,
        snapshotSha256,
        subjectId,
        observedAt
      )
    ]
  });
  return [workItem, deadline];
}

function normalizeActivity(
  activity: GitHubUserActivitySignal,
  snapshotSha256: string,
  observedAt: string,
  truncated: boolean,
  normalizerVersion: GitHubWorkSignalNormalizerVersion,
  resolveProjectId:
    | ((sourceScopeId: string) => string | null)
    | undefined
): RuntimeWorkSignal {
  const subjectId = githubActivitySubjectId(activity.id);
  const includesArtifactIdentity =
    normalizerVersion ===
      GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION ||
    normalizerVersion ===
      GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION ||
    normalizerVersion ===
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION;
  const includesNativeSubjectIdentity =
    normalizerVersion ===
      GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION ||
    normalizerVersion ===
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION;
  const baseFacts = {
    activityKind: activity.activityKind,
    repositoryFullName: safeText(
      activity.repositoryFullName,
      "repository"
    ),
    subjectType: activity.subjectType,
    subjectNumber: activity.subjectNumber,
    subjectTitle: nullableSafeText(activity.subjectTitle),
    refName: nullableSafeText(activity.refName),
    reviewState: activity.reviewState,
    semanticRole: "activity_only" as const
  };
  const facts = includesNativeSubjectIdentity
    ? {
        ...baseFacts,
        artifactId: activity.artifactId ?? null,
        nativeSubjectId:
          activity.subjectObjectId === null ||
          activity.subjectObjectId === undefined
            ? null
            : githubSubjectId(activity.subjectObjectId)
      }
    : includesArtifactIdentity
      ? { ...baseFacts, artifactId: activity.artifactId ?? null }
      : baseFacts;
  const sourceScopeId = `repository:${activity.repositoryId}`;
  return finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion,
    source: "github",
    subjectId,
    subjectType: "source_activity",
    sourceScopeId,
    projectId: resolveProjectId?.(sourceScopeId) ?? null,
    kind: "activity_observation",
    facts,
    observedAt,
    sourceUpdatedAt: activity.occurredAt,
    validUntil: null,
    directness: "explicit",
    completeness: truncated ? "truncated" : "complete",
    attentionCapability: "overview_only",
    evidence: [
      {
        type: "github_activity_record",
        source: "github",
        activityId: activity.id,
        activityKind: activity.activityKind,
        valueSha256: runtimeSha256({
          domain:
            includesNativeSubjectIdentity
              ? "github-activity-record-v0.3"
              : includesArtifactIdentity
              ? "github-activity-record-v0.2"
              : "github-activity-record-v0.1",
          facts
        }),
        snapshotSha256,
        subjectId,
        observedAt,
        sourceUpdatedAt: activity.occurredAt
      }
    ]
  });
}

function githubTaskFieldEvidence(
  task: GitHubTaskSignal,
  snapshotSha256: string,
  subjectId: string,
  observedAt: string
) {
  return [
    githubObjectEvidence(
      task,
      "state",
      task.state,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "title",
      task.title,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "repository_full_name",
      task.repositoryFullName,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "number",
      task.number,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "html_url",
      task.htmlUrl,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "created_at",
      task.createdAt,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "updated_at",
      task.updatedAt,
      snapshotSha256,
      subjectId,
      observedAt
    )
  ] as const;
}

function githubActionabilityEvidence(
  task: GitHubTaskSignal,
  snapshotSha256: string,
  subjectId: string,
  observedAt: string
) {
  if (!task.actionability) return [];
  const actionability = task.actionability;
  return [
    githubObjectEvidence(
      task,
      "collection_state",
      actionability.collectionState,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "draft",
      actionability.draft,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "review_decision",
      actionability.reviewDecision,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "checks_summary",
      actionability.checksSummary,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "mergeable",
      actionability.mergeable,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "merge_conflict",
      actionability.mergeConflict,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "unresolved_change_request_count",
      actionability.unresolvedChangeRequestCount,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "requested_reviewer_count",
      actionability.requestedReviewerCount,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "action_required",
      actionability.actionRequired,
      snapshotSha256,
      subjectId,
      observedAt
    ),
    githubObjectEvidence(
      task,
      "action_required_reasons",
      actionability.actionRequiredReasons,
      snapshotSha256,
      subjectId,
      observedAt
    )
  ] as const;
}

function githubObjectEvidence(
  task: GitHubTaskSignal,
  field:
    | "state"
    | "title"
    | "repository_full_name"
    | "number"
    | "html_url"
    | "milestone_due_at"
    | "created_at"
    | "updated_at"
    | "collection_state"
    | "draft"
    | "review_decision"
    | "checks_summary"
    | "mergeable"
    | "merge_conflict"
    | "unresolved_change_request_count"
    | "requested_reviewer_count"
    | "action_required"
    | "action_required_reasons",
  value: unknown,
  snapshotSha256: string,
  subjectId: string,
  observedAt: string
) {
  return {
    type: "github_object_field" as const,
    source: "github" as const,
    objectId: String(task.id),
    field,
    valueSha256: runtimeSha256({
      domain: "github-object-field-v0.1",
      field,
      value
    }),
    snapshotSha256,
    subjectId,
    observedAt,
    sourceUpdatedAt: task.updatedAt
  };
}

function uniqueRecords<T>(
  records: T[],
  identity: (record: T) => string,
  subjectId: (record: T) => string,
  issues: NormalizationIssue[]
): { records: T[] } {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = identity(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const selected: T[] = [];
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key) ?? [];
    const canonicalValues = [
      ...new Set(group.map(runtimeCanonicalJson))
    ];
    if (canonicalValues.length === 1 && group[0] !== undefined) {
      selected.push(group[0]);
      continue;
    }
    if (group[0] !== undefined) {
      issues.push({
        code: "CONFLICTING_DUPLICATE_RECORD",
        subjectId: subjectId(group[0]),
        recordSha256: runtimeSha256({
          domain: "conflicting-github-record-v0.1",
          records: canonicalValues.sort()
        })
      });
    }
  }
  return { records: selected };
}

function relationshipFor(
  kind: GitHubTaskKind
):
  | "assigned_to_user"
  | "review_requested_from_user"
  | "authored_by_user" {
  switch (kind) {
    case "assigned_issue":
      return "assigned_to_user";
    case "review_requested_pull_request":
      return "review_requested_from_user";
    case "authored_pull_request":
      return "authored_by_user";
  }
}

function queryKindFor(
  kind: GitHubTaskKind
):
  | "assigned_open_issue"
  | "review_requested_open_pr"
  | "authored_open_pr" {
  switch (kind) {
    case "assigned_issue":
      return "assigned_open_issue";
    case "review_requested_pull_request":
      return "review_requested_open_pr";
    case "authored_pull_request":
      return "authored_open_pr";
  }
}

function safeGitHubDestination(
  task: GitHubTaskSignal
): string | null {
  try {
    const url = new URL(task.htmlUrl);
    const objectPath =
      task.kind === "assigned_issue" ? "issues" : "pull";
    const expectedPath = `/${task.repositoryFullName}/${objectPath}/${task.number}`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== expectedPath
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeText(value: string, fallback: string): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 240);
}

function nullableSafeText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = safeText(value, "");
  return normalized || null;
}

function githubSubjectId(id: number): string {
  return `github:object:${id}`;
}

function githubActivitySubjectId(id: string): string {
  return `github:activity:${id}`;
}

function timestampTooFarInFuture(
  value: string,
  fetchedAt: string,
  maxFutureClockSkewMs: number
): boolean {
  return (
    Date.parse(value) >
    Date.parse(fetchedAt) + maxFutureClockSkewMs
  );
}

function recordInvalidIssue(
  subjectId: string,
  record: unknown
): NormalizationIssue {
  return {
    code: "RECORD_INVALID",
    subjectId,
    recordSha256: runtimeSha256({
      domain: "invalid-github-record-v0.1",
      record
    })
  };
}
