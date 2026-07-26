import type { CodexSessionSignal } from "./types";

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
          assessment.truncated
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
        freshnessPolicy: options.freshnessPolicy
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
  contentMode: "metadata_only" | "activity_summary",
  snapshotSha256: string,
  observedAt: string,
  truncated: boolean
): RuntimeWorkSignal {
  const subjectId = codexSubjectId(session.id);
  const facts = {
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
      contentMode === "activity_summary"
        ? nullableSafeText(session.taskSummary, 200)
        : null,
    taskSummarySource:
      contentMode === "activity_summary"
        ? session.taskSummarySource
        : null,
    taskSummarySemanticRole: "display_only_unknown" as const,
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
      | "content_mode";
    value: unknown;
  }> = [
    { field: "scope_id", value: session.scopeId },
    { field: "project_label", value: session.projectLabel },
    { field: "created_at", value: session.createdAt },
    { field: "updated_at", value: session.updatedAt },
    { field: "activity_state", value: session.activityState },
    { field: "attention_state", value: session.attentionState },
    { field: "content_mode", value: contentMode }
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

  return finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion: CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
    source: "codex",
    subjectId,
    subjectType: "execution",
    sourceScopeId: `scope:${session.scopeId}`,
    projectId: null,
    kind: "execution_observation",
    facts,
    observedAt,
    sourceUpdatedAt: session.updatedAt,
    validUntil: null,
    directness: "explicit",
    completeness: truncated ? "truncated" : "complete",
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
