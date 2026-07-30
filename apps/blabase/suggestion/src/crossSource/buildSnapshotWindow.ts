import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256
} from "./canonicalHash";
import type {
  RuntimeWorkSignalBatch,
  RuntimeSource
} from "./schema";
import {
  CODEX_NATIVE_OBSERVATION_TIMELINE_CONTRACT,
  RUNTIME_SNAPSHOT_WINDOW_CONTRACT
} from "./versions";
import { verifyRuntimeWorkSignalBatchIntegrity } from "./workSignalIntegrity";

const historyPolicySchema = z
  .object({
    version: z.string().min(1).max(120),
    minimumSnapshots: z.number().int().min(2)
  })
  .strict();

export type SnapshotHistoryPolicy = z.infer<
  typeof historyPolicySchema
>;

export type SnapshotWindowReasonCode =
  | "HISTORY_SUFFICIENT"
  | "HISTORY_TOO_SHORT"
  | "HISTORY_VERSION_CHANGE"
  | "HISTORY_TRUNCATED";

export type RuntimeSnapshotWindow = {
  contract: typeof RUNTIME_SNAPSHOT_WINDOW_CONTRACT;
  source: RuntimeSource;
  historyPolicyVersion: string;
  observationStartedAt: string;
  observationEndedAt: string;
  historySufficiency: "sufficient" | "insufficient";
  reasonCodes: SnapshotWindowReasonCode[];
  windowSha256: string;
  orderedBatches: RuntimeWorkSignalBatch[];
};

export type SnapshotWindowFailureCode =
  | "EMPTY_WINDOW"
  | "MIXED_SOURCE_WINDOW"
  | "NON_CHRONOLOGICAL_WINDOW"
  | "DUPLICATE_SNAPSHOT"
  | "BATCH_INTEGRITY_FAILED";

export type SnapshotWindowBuildResult =
  | { status: "ready"; window: RuntimeSnapshotWindow }
  | {
      status: "rejected";
      code: SnapshotWindowFailureCode;
    };

export function verifyRuntimeSnapshotWindowIntegrity(
  window: RuntimeSnapshotWindow
): boolean {
  if (
    window.contract !== RUNTIME_SNAPSHOT_WINDOW_CONTRACT ||
    window.orderedBatches.length === 0 ||
    window.orderedBatches.some(
      (batch) =>
        batch.source !== window.source ||
        !verifyRuntimeWorkSignalBatchIntegrity(batch).ok
    )
  ) {
    return false;
  }

  const first = window.orderedBatches[0];
  const last = window.orderedBatches.at(-1);
  if (
    !first ||
    !last ||
    first.assessment.fetchedAt !== window.observationStartedAt ||
    last.assessment.fetchedAt !== window.observationEndedAt
  ) {
    return false;
  }
  const seenHashes = new Set<string>();
  for (let index = 0; index < window.orderedBatches.length; index += 1) {
    const current = window.orderedBatches[index];
    if (
      !current ||
      seenHashes.has(current.sourceSnapshotSha256)
    ) {
      return false;
    }
    seenHashes.add(current.sourceSnapshotSha256);
    const previous = window.orderedBatches[index - 1];
    if (
      previous &&
      Date.parse(current.assessment.fetchedAt) <=
        Date.parse(previous.assessment.fetchedAt)
    ) {
      return false;
    }
  }

  const {
    windowSha256: storedHash,
    ...windowWithoutHash
  } = window;
  return (
    storedHash ===
    computeRuntimeSnapshotWindowSha256(windowWithoutHash)
  );
}

export function buildRuntimeSnapshotWindow(
  orderedBatches: RuntimeWorkSignalBatch[],
  policyInput: SnapshotHistoryPolicy
): SnapshotWindowBuildResult {
  const policy = historyPolicySchema.parse(policyInput);
  if (orderedBatches.length === 0) {
    return { status: "rejected", code: "EMPTY_WINDOW" };
  }
  if (
    orderedBatches.some(
      (batch) =>
        !verifyRuntimeWorkSignalBatchIntegrity(batch).ok
    )
  ) {
    return {
      status: "rejected",
      code: "BATCH_INTEGRITY_FAILED"
    };
  }

  const source = orderedBatches[0]?.source;
  if (
    source === undefined ||
    orderedBatches.some((batch) => batch.source !== source)
  ) {
    return { status: "rejected", code: "MIXED_SOURCE_WINDOW" };
  }

  const seenSnapshotHashes = new Set<string>();
  for (let index = 0; index < orderedBatches.length; index += 1) {
    const current = orderedBatches[index];
    if (current === undefined) continue;
    if (seenSnapshotHashes.has(current.sourceSnapshotSha256)) {
      return {
        status: "rejected",
        code: "DUPLICATE_SNAPSHOT"
      };
    }
    seenSnapshotHashes.add(current.sourceSnapshotSha256);
    const previous = orderedBatches[index - 1];
    if (
      previous &&
      Date.parse(current.assessment.fetchedAt) <=
        Date.parse(previous.assessment.fetchedAt)
    ) {
      return {
        status: "rejected",
        code: "NON_CHRONOLOGICAL_WINDOW"
      };
    }
  }

  const first = orderedBatches[0];
  const last = orderedBatches.at(-1);
  if (!first || !last) {
    return { status: "rejected", code: "EMPTY_WINDOW" };
  }

  const reasonCodes: SnapshotWindowReasonCode[] = [];
  if (orderedBatches.length < policy.minimumSnapshots) {
    reasonCodes.push("HISTORY_TOO_SHORT");
  }
  const versions = new Set(
    orderedBatches.map(
      (batch) =>
        `${batch.sourceSchemaVersion}:${batch.normalizerVersion}:${batch.workSignalContract}`
    )
  );
  if (versions.size > 1) {
    reasonCodes.push("HISTORY_VERSION_CHANGE");
  }
  if (
    orderedBatches.some(
      (batch) => batch.assessment.truncated
    )
  ) {
    reasonCodes.push("HISTORY_TRUNCATED");
  }
  if (reasonCodes.length === 0) {
    reasonCodes.push("HISTORY_SUFFICIENT");
  }

  const withoutHash = {
    contract: RUNTIME_SNAPSHOT_WINDOW_CONTRACT,
    source,
    historyPolicyVersion: policy.version,
    observationStartedAt: first.assessment.fetchedAt,
    observationEndedAt: last.assessment.fetchedAt,
    historySufficiency:
      reasonCodes.length === 1 &&
      reasonCodes[0] === "HISTORY_SUFFICIENT"
        ? ("sufficient" as const)
        : ("insufficient" as const),
    reasonCodes,
    orderedBatches
  };
  return {
    status: "ready",
    window: {
      ...withoutHash,
      windowSha256:
        computeRuntimeSnapshotWindowSha256(withoutHash)
    }
  };
}

export type CodexNativeObservation = {
  signalId: string;
  observationId: string;
  sourceSnapshotSha256: string;
  observedAt: string;
  sourceUpdatedAt: string;
  observationMode: "inventory_only";
  liveObservationAvailable: false;
  executionState: "unknown";
  executionStateReason:
    "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE";
  nativeActivityState:
    | "active"
    | "idle"
    | "not_loaded"
    | "system_error"
    | "unknown";
  semanticState: "idle" | "not_loaded" | "unknown";
  nativeAttentionState:
    | "waiting_on_approval"
    | "waiting_on_user_input"
    | null;
  attentionSemanticRole: "overview_badge_only";
  projectLabel: string;
  taskSummary: string | null;
  taskSummarySemanticRole: "display_only_unknown";
};

export type CodexNativeObservationTimeline = {
  contract: typeof CODEX_NATIVE_OBSERVATION_TIMELINE_CONTRACT;
  sourceWindowSha256: string;
  historySufficiency: "sufficient" | "insufficient";
  reasonCodes: SnapshotWindowReasonCode[];
  executionCount: number;
  timelineSha256: string;
  executions: Array<{
    executionId: string;
    sourceScopeId: string;
    observations: CodexNativeObservation[];
  }>;
};

export function buildCodexNativeObservationTimeline(
  window: RuntimeSnapshotWindow
): CodexNativeObservationTimeline {
  if (
    window.source !== "codex" ||
    !verifyRuntimeSnapshotWindowIntegrity(window)
  ) {
    throw new TypeError(
      "Codex native timeline requires an integrity-verified Codex snapshot window."
    );
  }

  const executionsById = new Map<
    string,
    {
      executionId: string;
      sourceScopeId: string;
      observations: CodexNativeObservation[];
    }
  >();
  for (const batch of window.orderedBatches) {
    for (const signal of batch.signals) {
      if (signal.kind !== "execution_observation") continue;
      const existing = executionsById.get(signal.subjectId) ?? {
        executionId: signal.subjectId,
        sourceScopeId: signal.sourceScopeId,
        observations: []
      };
      existing.observations.push({
        signalId: signal.signalId,
        observationId: signal.observationId,
        sourceSnapshotSha256: signal.sourceSnapshotSha256,
        observedAt: signal.observedAt,
        sourceUpdatedAt: signal.sourceUpdatedAt ?? signal.observedAt,
        observationMode: signal.facts.observationMode,
        liveObservationAvailable:
          signal.facts.liveObservationAvailable,
        executionState: signal.facts.executionState,
        executionStateReason:
          signal.facts.executionStateReason,
        nativeActivityState: signal.facts.nativeActivityState,
        semanticState: signal.facts.semanticState,
        nativeAttentionState: signal.facts.nativeAttentionState,
        attentionSemanticRole:
          signal.facts.attentionSemanticRole,
        projectLabel: signal.facts.projectLabel,
        taskSummary: signal.facts.taskSummary,
        taskSummarySemanticRole:
          signal.facts.taskSummarySemanticRole
      });
      executionsById.set(signal.subjectId, existing);
    }
  }

  const executions = [...executionsById.values()]
    .sort((left, right) =>
      compareRuntimeStrings(
        left.executionId,
        right.executionId
      )
    )
    .map((execution) => ({
      ...execution,
      observations: [...execution.observations].sort(
        (left, right) =>
          Date.parse(left.observedAt) -
            Date.parse(right.observedAt) ||
          compareRuntimeStrings(
            left.observationId,
            right.observationId
          )
      )
    }));
  const withoutHash = {
    contract: CODEX_NATIVE_OBSERVATION_TIMELINE_CONTRACT,
    sourceWindowSha256: window.windowSha256,
    historySufficiency: window.historySufficiency,
    reasonCodes: window.reasonCodes,
    executionCount: executions.length,
    executions
  };
  return {
    ...withoutHash,
    timelineSha256: runtimeSha256({
      domain: "blabase-codex-native-observation-timeline-v0.2",
      timeline: withoutHash
    })
  };
}

function computeRuntimeSnapshotWindowSha256(
  window: Omit<RuntimeSnapshotWindow, "windowSha256">
): string {
  return runtimeSha256({
    domain: "blabase-runtime-snapshot-window-v0.1",
    window
  });
}
