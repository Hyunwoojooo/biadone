import { randomBytes } from "node:crypto";

import {
  PHASE2_ATTENTION_INPUT_CONTRACT,
  PHASE2_ATTENTION_POLICY_VERSION,
  PHASE2_ATTENTION_RESULT_CONTRACT,
  PHASE2_CODEX_OVERVIEW_RULE_VERSION,
  PHASE2_GITHUB_CANDIDATE_RULE_VERSION
} from "../crossSource/versions";
import {
  attentionMonitorFailureRecordSchema,
  type AttentionMonitorFailureRecord
} from "./monitoringSchema";
import type { AttentionCodeProvenance } from "./codeProvenance";
import {
  ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
  ATTENTION_LIVE_ORCHESTRATOR_VERSION,
  ATTENTION_MONITOR_FAILURE_CONTRACT,
  ATTENTION_MONITOR_RETENTION_DAYS
} from "./versions";

export type AttentionExecutionIds = {
  runId: string;
  analysisId: string;
  sessionId: string;
};

export type AttentionFailureStage =
  AttentionMonitorFailureRecord["stage"];

export function createAttentionExecutionIds(): AttentionExecutionIds {
  return {
    runId: randomStableId("run"),
    analysisId: randomStableId("analysis"),
    sessionId: randomStableId("session")
  };
}

export function createAttentionFailureRecord(input: {
  executionIds: AttentionExecutionIds;
  startedAt: Date;
  completedAt: Date;
  stage: AttentionFailureStage;
  retryCount?: number;
  codeProvenance: AttentionCodeProvenance;
}): AttentionMonitorFailureRecord {
  const startedAt = input.startedAt.toISOString();
  const completedAt = input.completedAt.toISOString();
  return attentionMonitorFailureRecordSchema.parse({
    contract: ATTENTION_MONITOR_FAILURE_CONTRACT,
    ...input.executionIds,
    status: "failed",
    startedAt,
    completedAt,
    stage: input.stage,
    errorCode:
      input.stage === "source_sync"
        ? "SOURCE_SYNC_FAILED"
        : "ATTENTION_RESOLUTION_FAILED",
    retryCount: input.retryCount ?? 0,
    latencyMs: input.completedAt.getTime() - input.startedAt.getTime(),
    engineVersion: ATTENTION_LIVE_ORCHESTRATOR_VERSION,
    freshnessPolicyVersion:
      ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
    inputSchemaVersion: PHASE2_ATTENTION_INPUT_CONTRACT,
    resultSchemaVersion: PHASE2_ATTENTION_RESULT_CONTRACT,
    policyVersion: PHASE2_ATTENTION_POLICY_VERSION,
    githubCandidateRuleVersion:
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION,
    codexOverviewRuleVersion: PHASE2_CODEX_OVERVIEW_RULE_VERSION,
    ...input.codeProvenance,
    privacyClass: "private_local_metadata",
    retentionDays: ATTENTION_MONITOR_RETENTION_DAYS
  });
}

function randomStableId(prefix: "run" | "analysis" | "session"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}
