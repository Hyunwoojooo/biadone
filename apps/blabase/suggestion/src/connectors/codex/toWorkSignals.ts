import type {
  CodexContentMode,
  CodexSessionContentManifest,
  CodexSessionSignal
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
  validateCodexSnapshot
} from "../../crossSource/validateSnapshots";
import {
  CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT
} from "../../crossSource/versions";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../../crossSource/workSignalIntegrity";

export type CodexNormalizationOptions = {
  asOf: string;
  freshnessPolicy: FreshnessPolicy;
  contextRegistrySha256?: string | null;
  resolveProjectId?: (sourceScopeId: string) => string | null;
};

export function normalizeCodexSnapshotToWorkSignals(
  input: unknown,
  options: CodexNormalizationOptions
): RuntimeNormalizationResult {
  const validation = validateCodexSnapshot(input);
  if (validation.status === "rejected") return validation;

  const artifact = validation.artifact;
  const assessment = assessSnapshot(
    artifact,
    options.asOf,
    options.freshnessPolicy
  );
  const issues = issuesFromAssessment(assessment);
  const signals: RuntimeWorkSignal[] = [];
  const uniqueSessions = uniqueSessionRecords(
    artifact.payload.sessions,
    issues
  );
  let skippedRecordCount =
    artifact.payload.sessions.length - uniqueSessions.length;

  if (assessment.usableForOverview) {
    for (const session of uniqueSessions) {
      if (
        timestampTooFarInFuture(
          session.updatedAt,
          artifact.fetchedAt,
          options.freshnessPolicy.maxFutureClockSkewMs
        )
      ) {
        skippedRecordCount += 1;
        issues.push({
          code: "RECORD_INVALID",
          subjectId: codexSubjectId(session.id),
          recordSha256: runtimeSha256({
            domain: "invalid-codex-session-v0.1",
            session
          })
        });
        continue;
      }
      signals.push(
        normalizeSession(
          session,
          artifact.payload.contentMode,
          artifact.sourceSnapshotSha256,
          artifact.fetchedAt,
          assessment.truncated,
          options.resolveProjectId
        )
      );
    }
  } else {
    skippedRecordCount += uniqueSessions.length;
  }

  const sortedSignals = sortRuntimeSignals(signals);
  return {
    status: "normalized",
    batch: finalizeRuntimeWorkSignalBatch({
      contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
      source: "codex",
      sourceSchemaVersion: artifact.sourceSchemaVersion,
      collectorVersion: artifact.collectorVersion,
      normalizerVersion: CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
      workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      normalizationInputSha256: computeNormalizationInputSha256({
        sourceSnapshotSha256: artifact.sourceSnapshotSha256,
        sourceSchemaVersion: artifact.sourceSchemaVersion,
        normalizerVersion: CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
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

function normalizeSession(
  session: CodexSessionSignal,
  contentMode: CodexContentMode,
  snapshotSha256: string,
  observedAt: string,
  truncated: boolean,
  resolveProjectId:
    | ((sourceScopeId: string) => string | null)
    | undefined
): RuntimeWorkSignal {
  const subjectId = codexSubjectId(session.id);
  const historicalContextCompleteness =
    codexHistoricalContextCompleteness(session.content);
  const facts = {
    observationMode: "inventory_only" as const,
    liveObservationAvailable: false as const,
    executionState: "unknown" as const,
    executionStateReason:
      "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE" as const,
    nativeActivityState: session.activityState,
    semanticState:
      session.activityState === "idle"
        ? ("idle" as const)
        : session.activityState === "not_loaded"
          ? ("not_loaded" as const)
          : ("unknown" as const),
    nativeAttentionState: session.attentionState,
    attentionSemanticRole: "overview_badge_only" as const,
    projectLabel: safeText(session.projectLabel, "project", 120),
    projectSemanticRole: "display_only_unresolved" as const,
    taskSummary:
      contentMode !== "metadata_only"
        ? nullableSafeText(session.taskSummary, 200)
        : null,
    taskSummarySource:
      contentMode !== "metadata_only"
        ? session.taskSummarySource
        : null,
    taskSummarySemanticRole: "display_only_unknown" as const,
    contentMode,
    conversationCollectionState: session.content.state,
    conversationContentAvailable:
      session.content.contentSha256 !== null,
    historicalContextCompleteness,
    historicalTurnStatus: session.content.historicalTurnStatus,
    historicalStatusSemanticRole:
      "persisted_history_only" as const,
    conversationSourceUpdatedAt:
      session.content.contentSourceUpdatedAt,
    contentCollectedAt: session.content.collectedAt,
    contentExpiresAt: session.content.expiresAt,
    latestTurnCompletedAt:
      session.content.latestTurnCompletedAt,
    turnCount: session.content.turnCount,
    userPromptCount: session.content.userPromptCount,
    agentResponseCount: session.content.agentResponseCount,
    commandExecutionCount:
      session.content.commandExecutionCount,
    failedCommandCount: session.content.failedCommandCount,
    fileChangeCount: session.content.fileChangeCount,
    toolCallCount: session.content.toolCallCount,
    omittedReasoningItemCount:
      session.content.omittedReasoningItemCount,
    omittedUnsupportedItemCount:
      session.content.omittedUnsupportedItemCount,
    contentTruncated: session.content.truncated,
    contentReasonCodes: [
      ...new Set(session.content.reasonCodes)
    ].sort(),
    latestUserPromptExcerpt: sanitizeManifestExcerpt(
      session.content.latestUserPromptExcerpt
    ),
    latestAgentResponseExcerpt: sanitizeManifestExcerpt(
      session.content.latestAgentResponseExcerpt
    ),
    latestExecutionSummary: sanitizeManifestExcerpt(
      session.content.latestExecutionSummary
    ),
    contentSemanticRole: "historical_context_only" as const,
    contentPrivacyBoundary: "sanitized_manifest_only" as const,
    destinationUrl: null
  };
  const fields: Array<{
    field:
      | "scope_id"
      | "project_label"
      | "task_summary"
      | "task_summary_source"
      | "created_at"
      | "updated_at"
      | "activity_state"
      | "attention_state"
      | "content_mode"
      | "content_state"
      | "content_source_updated_at"
      | "content_collected_at"
      | "content_expires_at"
      | "historical_turn_status"
      | "latest_turn_completed_at"
      | "turn_count"
      | "user_prompt_count"
      | "agent_response_count"
      | "command_execution_count"
      | "failed_command_count"
      | "file_change_count"
      | "tool_call_count"
      | "omitted_reasoning_item_count"
      | "omitted_unsupported_item_count"
      | "content_truncated"
      | "content_reason_codes"
      | "latest_user_prompt_excerpt"
      | "latest_agent_response_excerpt"
      | "latest_execution_summary";
    value: unknown;
  }> = [
    { field: "scope_id", value: session.scopeId },
    { field: "project_label", value: session.projectLabel },
    { field: "created_at", value: session.createdAt },
    { field: "updated_at", value: session.updatedAt },
    { field: "activity_state", value: session.activityState },
    { field: "attention_state", value: session.attentionState },
    { field: "content_mode", value: contentMode },
    { field: "content_state", value: session.content.state },
    {
      field: "content_source_updated_at",
      value: session.content.contentSourceUpdatedAt
    },
    {
      field: "content_collected_at",
      value: session.content.collectedAt
    },
    {
      field: "content_expires_at",
      value: session.content.expiresAt
    },
    {
      field: "historical_turn_status",
      value: session.content.historicalTurnStatus
    },
    {
      field: "latest_turn_completed_at",
      value: session.content.latestTurnCompletedAt
    },
    { field: "turn_count", value: session.content.turnCount },
    {
      field: "user_prompt_count",
      value: session.content.userPromptCount
    },
    {
      field: "agent_response_count",
      value: session.content.agentResponseCount
    },
    {
      field: "command_execution_count",
      value: session.content.commandExecutionCount
    },
    {
      field: "failed_command_count",
      value: session.content.failedCommandCount
    },
    {
      field: "file_change_count",
      value: session.content.fileChangeCount
    },
    {
      field: "tool_call_count",
      value: session.content.toolCallCount
    },
    {
      field: "omitted_reasoning_item_count",
      value: session.content.omittedReasoningItemCount
    },
    {
      field: "omitted_unsupported_item_count",
      value: session.content.omittedUnsupportedItemCount
    },
    {
      field: "content_truncated",
      value: session.content.truncated
    },
    {
      field: "content_reason_codes",
      value: facts.contentReasonCodes
    }
  ];
  if (facts.taskSummary !== null) {
    fields.push(
      { field: "task_summary", value: session.taskSummary },
      {
        field: "task_summary_source",
        value: session.taskSummarySource
      }
    );
  }
  if (facts.latestUserPromptExcerpt !== null) {
    fields.push({
      field: "latest_user_prompt_excerpt",
      value: facts.latestUserPromptExcerpt
    });
  }
  if (facts.latestAgentResponseExcerpt !== null) {
    fields.push({
      field: "latest_agent_response_excerpt",
      value: facts.latestAgentResponseExcerpt
    });
  }
  if (facts.latestExecutionSummary !== null) {
    fields.push({
      field: "latest_execution_summary",
      value: facts.latestExecutionSummary
    });
  }

  const sourceScopeId = `scope:${session.scopeId}`;
  return finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion: CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
    source: "codex",
    subjectId,
    subjectType: "execution",
    sourceScopeId,
    projectId: resolveProjectId?.(sourceScopeId) ?? null,
    kind: "execution_observation",
    facts,
    observedAt,
    sourceUpdatedAt: session.updatedAt,
    validUntil: null,
    directness: "explicit",
    completeness:
      truncated ||
      facts.historicalContextCompleteness === "partial"
        ? "truncated"
        : contentMode === "conversation_and_execution" &&
            facts.historicalContextCompleteness === "unavailable"
          ? "unknown"
          : "complete",
    attentionCapability: "overview_only",
    evidence: fields.map(({ field, value }) => ({
      type: "codex_session_field" as const,
      source: "codex" as const,
      sessionId: session.id,
      field,
      valueSha256: runtimeSha256({
        domain: "codex-session-field-v0.1",
        field,
        value
      }),
      snapshotSha256,
      subjectId,
      observedAt,
      sourceUpdatedAt: session.updatedAt
    }))
  });
}

function codexHistoricalContextCompleteness(
  content: CodexSessionContentManifest
): "not_collected" | "complete" | "partial" | "unavailable" {
  switch (content.state) {
    case "not_collected":
      return "not_collected";
    case "complete":
      return content.truncated ? "partial" : "complete";
    case "partial":
    case "stale":
      return "partial";
    case "failed":
    case "expired":
      return "unavailable";
  }
}

function uniqueSessionRecords(
  sessions: CodexSessionSignal[],
  issues: NormalizationIssue[]
): CodexSessionSignal[] {
  const groups = new Map<string, CodexSessionSignal[]>();
  for (const session of sessions) {
    groups.set(session.id, [
      ...(groups.get(session.id) ?? []),
      session
    ]);
  }

  const selected: CodexSessionSignal[] = [];
  for (const id of [...groups.keys()].sort()) {
    const group = groups.get(id) ?? [];
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
        subjectId: codexSubjectId(id),
        recordSha256: runtimeSha256({
          domain: "conflicting-codex-session-v0.1",
          records: canonicalValues.sort()
        })
      });
    }
  }
  return selected;
}

function codexSubjectId(id: string): string {
  return `codex:execution:${id}`;
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

function safeText(
  value: string,
  fallback: string,
  maxLength: number
): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

function nullableSafeText(
  value: string | null,
  maxLength: number
): string | null {
  if (value === null) return null;
  const normalized = safeText(value, "", maxLength);
  return normalized || null;
}

function sanitizeManifestExcerpt(
  value: string | null
): string | null {
  if (value === null) return null;
  const sanitized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " "
    )
    .replace(/https?:\/\/\S+/gi, "[링크]")
    .replace(/(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)/g, "[로컬 경로]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[이메일]"
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AIza[A-Za-z0-9_-]{12,})\b/g,
      "[비밀값]"
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [비밀값]")
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*\S+/gi,
      "[비밀값]"
    )
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, 200) : null;
}
