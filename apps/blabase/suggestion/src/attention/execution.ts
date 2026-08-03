import { randomBytes } from "node:crypto";

import {
  ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
  ACTIVE_ATTENTION_ID_POLICY_VERSION,
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_LANE_POLICY_VERSION,
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT
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
    inputSchemaVersion: ACTIVE_ATTENTION_INPUT_CONTRACT,
    resultSchemaVersion: ACTIVE_ATTENTION_RESULT_CONTRACT,
    policyVersion: ACTIVE_ATTENTION_POLICY_VERSION,
    candidateRuleVersion: ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    lanePolicyVersion: ACTIVE_ATTENTION_LANE_POLICY_VERSION,
    rankingPolicyVersion: ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
    resolverVersion: ACTIVE_ATTENTION_RESOLVER_VERSION,
    idPolicyVersion: ACTIVE_ATTENTION_ID_POLICY_VERSION,
    ...input.codeProvenance,
    privacyClass: "private_local_metadata",
    retentionDays: ATTENTION_MONITOR_RETENTION_DAYS
  });
}

function randomStableId(prefix: "run" | "analysis" | "session"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}
