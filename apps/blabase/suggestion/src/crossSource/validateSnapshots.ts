import { z } from "zod";

import type { CodexSnapshot } from "../connectors/codex/types";
import {
  actionabilityCoverageMatchesTasks,
  githubActionabilityCoverageSchema,
  githubPullRequestActionabilitySchema
} from "../connectors/github/actionabilityContract";
import type { GitHubSnapshot } from "../connectors/github/types";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "./canonicalHash";
import {
  freshnessPolicySchema,
  snapshotAssessmentSchema,
  type FreshnessPolicy,
  type RuntimeSource,
  type SnapshotAssessment
} from "./schema";
import {
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_SOURCE_COLLECTION_FAILURE_CONTRACT,
  RUNTIME_SOURCE_SNAPSHOT_CONTRACT
} from "./versions";

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const codexConversationReasonCodeSchema = z.enum([
  "CONTENT_MODE_DISABLED",
  "OUTSIDE_RAW_RETENTION_WINDOW",
  "THREAD_READ_LIMIT",
  "THREAD_READ_FAILED",
  "THREAD_RESPONSE_INVALID",
  "THREAD_CHANGED_DURING_READ",
  "TURN_LIMIT",
  "ITEM_LIMIT",
  "FIELD_BYTE_LIMIT",
  "THREAD_BYTE_LIMIT",
  "UNSUPPORTED_ITEM",
  "REASONING_EXCLUDED_BY_POLICY"
]);

const codexSessionContentManifestSchema = z
  .object({
    state: z.enum([
      "not_collected",
      "complete",
      "partial",
      "stale",
      "failed",
      "expired"
    ]),
    contentSha256: sha256Schema.nullable(),
    contentSourceUpdatedAt: timestampSchema.nullable(),
    collectedAt: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    historicalTurnStatus: z.enum([
      "completed",
      "failed",
      "interrupted",
      "in_progress",
      "unknown"
    ]),
    latestTurnCompletedAt: timestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
    userPromptCount: z.number().int().nonnegative(),
    agentResponseCount: z.number().int().nonnegative(),
    commandExecutionCount: z.number().int().nonnegative(),
    failedCommandCount: z.number().int().nonnegative(),
    fileChangeCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    omittedReasoningItemCount: z.number().int().nonnegative(),
    omittedUnsupportedItemCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    reasonCodes: z.array(codexConversationReasonCodeSchema),
    latestUserPromptExcerpt: z.string().max(300).nullable(),
    latestAgentResponseExcerpt: z.string().max(300).nullable(),
    latestExecutionSummary: z.string().max(300).nullable()
  })
  .strict()
  .superRefine((manifest, context) => {
    const hasContent = manifest.contentSha256 !== null;
    const hasAllContentMetadata = [
      manifest.contentSourceUpdatedAt,
      manifest.collectedAt,
      manifest.expiresAt
    ].every((value) => value !== null);
    if (hasContent !== hasAllContentMetadata) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentSha256"],
        message:
          "Codex content hash and collection timestamps must be present together."
      });
    }
    if (
      !hasContent &&
      (manifest.turnCount > 0 ||
        manifest.userPromptCount > 0 ||
        manifest.agentResponseCount > 0 ||
        manifest.commandExecutionCount > 0 ||
        manifest.failedCommandCount > 0 ||
        manifest.fileChangeCount > 0 ||
        manifest.toolCallCount > 0 ||
        manifest.omittedReasoningItemCount > 0 ||
        manifest.omittedUnsupportedItemCount > 0 ||
        manifest.truncated ||
        manifest.historicalTurnStatus !== "unknown" ||
        manifest.latestTurnCompletedAt !== null ||
        manifest.latestUserPromptExcerpt !== null ||
        manifest.latestAgentResponseExcerpt !== null ||
        manifest.latestExecutionSummary !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentSha256"],
        message:
          "Codex content counts and excerpts require a persisted content artifact."
      });
    }
    const stateRequiresContent =
      manifest.state === "complete" ||
      manifest.state === "partial" ||
      manifest.state === "stale";
    if (stateRequiresContent !== hasContent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message:
          "Codex collection state must match persisted content availability."
      });
    }
    if (
      manifest.failedCommandCount >
      manifest.commandExecutionCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failedCommandCount"],
        message:
          "Failed Codex command count cannot exceed command count."
      });
    }
  });

const githubInstallationSchema = z
  .object({
    id: z.number().int().positive(),
    accountLogin: z.string().min(1),
    accountType: z.enum(["User", "Organization"]),
    repositorySelection: z.enum(["all", "selected"]),
    suspended: z.boolean()
  })
  .strict();

const githubRepositorySchema = z
  .object({
    id: z.number().int().positive(),
    source: z.literal("github"),
    kind: z.literal("repository"),
    installationId: z.number().int().positive(),
    fullName: z.string().min(1),
    private: z.boolean(),
    archived: z.boolean(),
    updatedAt: timestampSchema
  })
  .strict();

const githubTaskSchema = z
  .object({
    id: z.number().int().positive(),
    source: z.literal("github"),
    kind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    repositoryId: z.number().int().positive(),
    repositoryFullName: z.string().min(1),
    number: z.number().int().positive(),
    title: z.string(),
    htmlUrl: z.string().url(),
    labelNames: z.array(z.string()),
    milestoneDueAt: timestampSchema.nullable(),
    state: z.literal("open"),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    actionability: githubPullRequestActionabilitySchema.optional()
  })
  .strict()
  .superRefine((task, context) => {
    if (
      task.kind !== "authored_pull_request" &&
      task.actionability !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionability"],
        message: "Only authored PR tasks can contain actionability."
      });
    }
  });

const githubActivitySchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.literal("github"),
    kind: z.literal("user_activity"),
    activityKind: z.enum([
      "push",
      "ref_created",
      "ref_deleted",
      "issue_opened",
      "issue_closed",
      "issue_reopened",
      "issue_commented",
      "pull_request_opened",
      "pull_request_closed",
      "pull_request_reopened",
      "pull_request_merged",
      "pull_request_reviewed",
      "pull_request_review_commented"
    ]),
    repositoryId: z.number().int().positive(),
    repositoryFullName: z.string().min(1),
    occurredAt: timestampSchema,
    subjectType: z.enum([
      "repository",
      "branch",
      "tag",
      "issue",
      "pull_request"
    ]),
    subjectNumber: z.number().int().positive().nullable(),
    subjectTitle: z.string().nullable(),
    refName: z.string().nullable(),
    reviewState: z
      .enum(["approved", "changes_requested", "commented"])
      .nullable()
  })
  .strict();

export const githubRuntimeSnapshotSchema = z
  .object({
    schemaVersion: z.enum(["github-snapshot-v2", "github-snapshot-v3"]),
    appClientId: z.string().min(1),
    appSlug: z.string().min(1),
    apiVersion: z.string().min(1),
    fetchedAt: timestampSchema,
    user: z
      .object({
        id: z.number().int().positive(),
        login: z.string().min(1)
      })
      .strict(),
    truncated: z.boolean(),
    activityWindowStart: timestampSchema,
    activitiesState: z.enum([
      "available",
      "partial",
      "unavailable"
    ]),
    activitiesTruncated: z.boolean(),
    actionabilityCoverage: githubActionabilityCoverageSchema.optional(),
    installations: z.array(githubInstallationSchema),
    repositories: z.array(githubRepositorySchema),
    tasks: z.array(githubTaskSchema),
    activities: z.array(githubActivitySchema)
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.schemaVersion === "github-snapshot-v2" &&
      (snapshot.actionabilityCoverage !== undefined ||
        snapshot.tasks.some((task) => task.actionability !== undefined))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tasks"],
        message: "GitHub v2 snapshots cannot contain v3 actionability facts."
      });
    }
    if (
      snapshot.schemaVersion === "github-snapshot-v3" &&
      snapshot.actionabilityCoverage === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionabilityCoverage"],
        message: "GitHub v3 snapshots require actionability coverage."
      });
    }
    if (snapshot.actionabilityCoverage !== undefined) {
      if (
        !actionabilityCoverageMatchesTasks(
          snapshot.actionabilityCoverage,
          snapshot.tasks
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actionabilityCoverage"],
          message:
            "GitHub actionability coverage must match collected PR facts."
        });
      }
    }
  });

const codexSessionSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/),
    source: z.literal("codex"),
    kind: z.literal("coding_session"),
    scopeId: z.string().regex(/^[a-f0-9]{24}$/),
    projectLabel: z.string().min(1).max(120),
    taskSummary: z.string().trim().min(1).max(200).nullable(),
    taskSummarySource: z
      .enum(["thread_name", "first_user_request"])
      .nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    activityState: z.enum([
      "active",
      "idle",
      "not_loaded",
      "system_error",
      "unknown"
    ]),
    attentionState: z
      .enum(["waiting_on_approval", "waiting_on_user_input"])
      .nullable(),
    content: codexSessionContentManifestSchema
  })
  .strict();

export const codexRuntimeSnapshotSchema = z
  .object({
    schemaVersion: z.literal("codex-snapshot-v3"),
    collectorVersion: z.enum([
      "codex-app-server-metadata-v1",
      "codex-app-server-activity-summary-v1",
      "codex-app-server-conversation-and-execution-v1"
    ]),
    contentMode: z.enum([
      "metadata_only",
      "activity_summary",
      "conversation_and_execution"
    ]),
    codexVersion: z.string().min(1).max(120),
    fetchedAt: timestampSchema,
    lookbackStart: timestampSchema,
    truncated: z.boolean(),
    conversationStoreSha256: sha256Schema.nullable(),
    conversationRetentionDays: z.literal(7).nullable(),
    scopeIds: z
      .array(z.string().regex(/^[a-f0-9]{24}$/))
      .min(1),
    sessions: z.array(codexSessionSchema)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedCollectorVersion =
      snapshot.contentMode === "conversation_and_execution"
        ? "codex-app-server-conversation-and-execution-v1"
        : snapshot.contentMode === "activity_summary"
          ? "codex-app-server-activity-summary-v1"
          : "codex-app-server-metadata-v1";
    if (snapshot.collectorVersion !== expectedCollectorVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collectorVersion"],
        message:
          "Codex collector version must match the selected content mode."
      });
    }
    const conversationEnabled =
      snapshot.contentMode === "conversation_and_execution";
    if (
      conversationEnabled !==
        (snapshot.conversationStoreSha256 !== null) ||
      conversationEnabled !==
        (snapshot.conversationRetentionDays === 7)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationStoreSha256"],
        message:
          "Codex conversation store metadata must be present only in conversation-and-execution mode."
      });
    }
    snapshot.sessions.forEach((session, index) => {
      if (
        (session.taskSummary === null) !==
          (session.taskSummarySource === null) ||
        (snapshot.contentMode === "metadata_only" &&
          session.taskSummary !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "taskSummary"],
          message: "Task summary does not match Codex content mode."
        });
      }
      if (
        !conversationEnabled &&
        (session.content.state !== "not_collected" ||
          session.content.contentSha256 !== null ||
          session.content.reasonCodes.length !== 1 ||
          session.content.reasonCodes[0] !==
            "CONTENT_MODE_DISABLED")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "content"],
          message:
            "Codex content manifests must remain disabled outside conversation-and-execution mode."
        });
      }
      if (!snapshot.scopeIds.includes(session.scopeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "scopeId"],
          message: "Codex session is outside the selected scope."
        });
      }
    });
  });

export type RuntimeSnapshotArtifact<T, S extends RuntimeSource> = {
  contract: typeof RUNTIME_SOURCE_SNAPSHOT_CONTRACT;
  source: S;
  sourceSchemaVersion: string;
  collectorVersion: string;
  fetchedAt: string;
  scopeIds: string[];
  sourceSnapshotSha256: string;
  payload: T;
};

export type GitHubRuntimeSnapshotArtifact = RuntimeSnapshotArtifact<
  GitHubSnapshot,
  "github"
>;

export type CodexRuntimeSnapshotArtifact = RuntimeSnapshotArtifact<
  CodexSnapshot,
  "codex"
>;

export type SourceCollectionFailureCode =
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_PARSE_FAILED"
  | "SNAPSHOT_SCHEMA_UNSUPPORTED";

export type SourceCollectionFailure = {
  contract: typeof RUNTIME_SOURCE_COLLECTION_FAILURE_CONTRACT;
  source: RuntimeSource;
  status: "missing" | "invalid" | "unsupported";
  code: SourceCollectionFailureCode;
};

export type SnapshotValidationResult<T> =
  | { status: "ok"; artifact: T }
  | { status: "rejected"; failure: SourceCollectionFailure };

export function validateGitHubSnapshot(
  input: unknown
): SnapshotValidationResult<GitHubRuntimeSnapshotArtifact> {
  const parsed = githubRuntimeSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return rejectedSnapshot("github", input);
  }
  const payload = normalizeGitHubPayload(parsed.data);
  return {
    status: "ok",
    artifact: {
      contract: RUNTIME_SOURCE_SNAPSHOT_CONTRACT,
      source: "github",
      sourceSchemaVersion: payload.schemaVersion,
      collectorVersion: `github-api-${payload.apiVersion}`,
      fetchedAt: payload.fetchedAt,
      scopeIds: payload.repositories
        .map((repository) => `repository:${repository.id}`)
        .sort(),
      sourceSnapshotSha256: runtimeSha256({
        domain: "blabase-runtime-source-snapshot-v0.1",
        source: "github",
        sourceSchemaVersion: payload.schemaVersion,
        payload
      }),
      payload
    }
  };
}

export function validateCodexSnapshot(
  input: unknown
): SnapshotValidationResult<CodexRuntimeSnapshotArtifact> {
  const parsed = codexRuntimeSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return rejectedSnapshot("codex", input);
  }
  const payload = normalizeCodexPayload(parsed.data);
  return {
    status: "ok",
    artifact: {
      contract: RUNTIME_SOURCE_SNAPSHOT_CONTRACT,
      source: "codex",
      sourceSchemaVersion: payload.schemaVersion,
      collectorVersion: payload.collectorVersion,
      fetchedAt: payload.fetchedAt,
      scopeIds: payload.scopeIds,
      sourceSnapshotSha256: runtimeSha256({
        domain: "blabase-runtime-source-snapshot-v0.1",
        source: "codex",
        sourceSchemaVersion: payload.schemaVersion,
        collectorVersion: payload.collectorVersion,
        payload
      }),
      payload
    }
  };
}

export function assessSnapshot(
  artifact:
    | GitHubRuntimeSnapshotArtifact
    | CodexRuntimeSnapshotArtifact,
  asOf: string,
  policyInput: FreshnessPolicy
): SnapshotAssessment {
  const policy = freshnessPolicySchema.parse(policyInput);
  const normalizedAsOf = timestampSchema.parse(asOf);
  const asOfMs = Date.parse(normalizedAsOf);
  const fetchedAtMs = Date.parse(artifact.fetchedAt);
  const futureByMs = fetchedAtMs - asOfMs;
  const ageMs = asOfMs - fetchedAtMs;
  const freshness =
    futureByMs > policy.maxFutureClockSkewMs
      ? "invalid"
      : ageMs <= policy.maxAgeMsBySource[artifact.source]
        ? "fresh"
        : "stale";
  const sourceCompleteness = completenessFor(artifact);
  const reasonCodes: SnapshotAssessment["reasonCodes"] = [];

  reasonCodes.push(
    freshness === "fresh"
      ? "SNAPSHOT_FRESH"
      : freshness === "stale"
        ? "SNAPSHOT_STALE"
        : "SNAPSHOT_FROM_FUTURE"
  );
  if (sourceCompleteness.truncated) {
    reasonCodes.push("SNAPSHOT_TRUNCATED");
  }
  if (artifact.source === "github") {
    if (artifact.payload.activitiesState === "partial") {
      reasonCodes.push("GITHUB_ACTIVITIES_PARTIAL");
    } else if (artifact.payload.activitiesState === "unavailable") {
      reasonCodes.push("GITHUB_ACTIVITIES_UNAVAILABLE");
    }
    if (artifact.sourceSchemaVersion === "github-snapshot-v3") {
      const actionabilityState =
        artifact.payload.actionabilityCoverage?.state ?? "unavailable";
      if (actionabilityState === "partial") {
        reasonCodes.push("GITHUB_ACTIONABILITY_PARTIAL");
      } else if (actionabilityState === "unavailable") {
        reasonCodes.push("GITHUB_ACTIONABILITY_UNAVAILABLE");
      }
    }
  } else {
    reasonCodes.push("CODEX_OVERVIEW_ONLY");
  }

  return snapshotAssessmentSchema.parse({
    contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
    source: artifact.source,
    asOf: normalizedAsOf,
    fetchedAt: artifact.fetchedAt,
    freshnessPolicyVersion: policy.version,
    freshness,
    completeness: sourceCompleteness.completeness,
    truncated: sourceCompleteness.truncated,
    candidateSetComplete: sourceCompleteness.candidateSetComplete,
    usableForOverview: freshness !== "invalid",
    usableForCurrentCandidates:
      freshness === "fresh" && artifact.source === "github",
    reasonCodes
  });
}

function completenessFor(
  artifact:
    | GitHubRuntimeSnapshotArtifact
    | CodexRuntimeSnapshotArtifact
): {
  completeness: "complete" | "partial";
  truncated: boolean;
  candidateSetComplete: boolean;
} {
  if (artifact.source === "codex") {
    const contentIncomplete =
      artifact.payload.contentMode ===
        "conversation_and_execution" &&
      artifact.payload.sessions.some(
        (session) =>
          session.content.state !== "complete" ||
          session.content.truncated
      );
    const truncated =
      artifact.payload.truncated ||
      artifact.payload.sessions.some(
        (session) => session.content.truncated
      );
    return {
      completeness:
        truncated || contentIncomplete ? "partial" : "complete",
      truncated,
      candidateSetComplete: false
    };
  }

  const truncated =
    artifact.payload.truncated ||
    artifact.payload.activitiesTruncated;
  const actionabilityComplete =
    artifact.sourceSchemaVersion === "github-snapshot-v2" ||
    artifact.payload.actionabilityCoverage?.state === "complete";
  return {
    completeness:
      truncated ||
      artifact.payload.activitiesState !== "available" ||
      !actionabilityComplete
        ? "partial"
        : "complete",
    truncated,
    candidateSetComplete: !truncated && actionabilityComplete
  };
}

function rejectedSnapshot(
  source: RuntimeSource,
  input: unknown
): SnapshotValidationResult<never> {
  if (input === null || input === undefined) {
    return {
      status: "rejected",
      failure: {
        contract: RUNTIME_SOURCE_COLLECTION_FAILURE_CONTRACT,
        source,
        status: "missing",
        code: "SNAPSHOT_MISSING"
      }
    };
  }

  const schemaVersion =
    typeof input === "object" &&
    typeof (input as Record<string, unknown>).schemaVersion ===
      "string"
      ? ((input as Record<string, unknown>).schemaVersion as string)
      : null;
  const expectedVersions: Set<string> =
    source === "github"
      ? new Set(["github-snapshot-v2", "github-snapshot-v3"])
      : new Set(["codex-snapshot-v3"]);
  const unsupported =
    schemaVersion !== null && !expectedVersions.has(schemaVersion);

  return {
    status: "rejected",
    failure: {
      contract: RUNTIME_SOURCE_COLLECTION_FAILURE_CONTRACT,
      source,
      status: unsupported ? "unsupported" : "invalid",
      code: unsupported
        ? "SNAPSHOT_SCHEMA_UNSUPPORTED"
        : "SNAPSHOT_PARSE_FAILED"
    }
  };
}

function normalizeGitHubPayload(
  snapshot: z.infer<typeof githubRuntimeSnapshotSchema>
): GitHubSnapshot {
  return {
    ...snapshot,
    installations: sortCanonical(snapshot.installations),
    repositories: sortCanonical(snapshot.repositories),
    tasks: sortCanonical(
      snapshot.tasks.map((task) => ({
        ...task,
        labelNames: [...new Set(task.labelNames)].sort(),
        ...(task.actionability
          ? {
              actionability: {
                ...task.actionability,
                actionRequiredReasons: [
                  ...task.actionability.actionRequiredReasons
                ].sort(compareRuntimeStrings)
              }
            }
          : {})
      }))
    ),
    activities: sortCanonical(snapshot.activities)
  };
}

function normalizeCodexPayload(
  snapshot: z.infer<typeof codexRuntimeSnapshotSchema>
): CodexSnapshot {
  return {
    ...snapshot,
    scopeIds: [...new Set(snapshot.scopeIds)].sort(),
    sessions: sortCanonical(
      snapshot.sessions.map((session) => ({
        ...session,
        content: {
          ...session.content,
          reasonCodes: [
            ...new Set(session.content.reasonCodes)
          ].sort(compareRuntimeStrings)
        }
      }))
    )
  };
}

function sortCanonical<T>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    compareRuntimeStrings(
      runtimeCanonicalJson(left),
      runtimeCanonicalJson(right)
    )
  );
}
