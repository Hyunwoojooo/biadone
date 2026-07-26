import {
  runtimeSha256,
  runtimeStableId
} from "./canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  runtimeWorkSignalSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "./schema";
import { WORK_SIGNAL_ID_POLICY_VERSION } from "./versions";

export type RuntimeWorkSignalIntegrityIssue =
  | "SIGNAL_ID_MISMATCH"
  | "OBSERVATION_ID_MISMATCH"
  | "SIGNAL_HASH_MISMATCH";

export type RuntimeBatchIntegrityIssue =
  | RuntimeWorkSignalIntegrityIssue
  | "BATCH_HASH_MISMATCH";

type RuntimeWorkSignalDraft = Omit<
  RuntimeWorkSignal,
  "signalId" | "observationId" | "signalHash"
>;

type RuntimeWorkSignalBatchDraft = Omit<
  RuntimeWorkSignalBatch,
  "batchSha256" | "signalCount"
>;

export function finalizeRuntimeWorkSignal(
  draft: RuntimeWorkSignalDraft
): RuntimeWorkSignal {
  const signalId = expectedSignalId(draft);
  const observationId = expectedObservationId(draft, signalId);
  const withoutHash = {
    ...draft,
    signalId,
    observationId
  };
  const signalHash = computeRuntimeWorkSignalSha256(withoutHash);
  return runtimeWorkSignalSchema.parse({
    ...withoutHash,
    signalHash
  });
}

export function computeRuntimeWorkSignalSha256(
  signal: Omit<RuntimeWorkSignal, "signalHash">
): string {
  return runtimeSha256({
    domain: "blabase-runtime-work-signal-v0.1",
    signal
  });
}

export function verifyRuntimeWorkSignalIntegrity(
  input: unknown
): {
  ok: boolean;
  issues: RuntimeWorkSignalIntegrityIssue[];
} {
  const parsed = runtimeWorkSignalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        "SIGNAL_ID_MISMATCH",
        "OBSERVATION_ID_MISMATCH",
        "SIGNAL_HASH_MISMATCH"
      ]
    };
  }

  const signal = parsed.data;
  const {
    signalId: _signalId,
    observationId: _observationId,
    signalHash: _signalHash,
    ...draft
  } = signal;
  const expectedId = expectedSignalId(draft);
  const expectedObservation = expectedObservationId(
    draft,
    expectedId
  );
  const {
    signalHash: storedHash,
    ...signalWithoutHash
  } = signal;
  const expectedHash =
    computeRuntimeWorkSignalSha256(signalWithoutHash);
  const issues: RuntimeWorkSignalIntegrityIssue[] = [];
  if (signal.signalId !== expectedId) {
    issues.push("SIGNAL_ID_MISMATCH");
  }
  if (signal.observationId !== expectedObservation) {
    issues.push("OBSERVATION_ID_MISMATCH");
  }
  if (storedHash !== expectedHash) {
    issues.push("SIGNAL_HASH_MISMATCH");
  }
  return { ok: issues.length === 0, issues };
}

export function finalizeRuntimeWorkSignalBatch(
  draft: RuntimeWorkSignalBatchDraft
): RuntimeWorkSignalBatch {
  const withoutHash = {
    ...draft,
    signalCount: draft.signals.length
  };
  const batchSha256 = computeRuntimeWorkSignalBatchSha256(withoutHash);
  return runtimeWorkSignalBatchSchema.parse({
    ...withoutHash,
    batchSha256
  });
}

export function computeRuntimeWorkSignalBatchSha256(
  batch: Omit<RuntimeWorkSignalBatch, "batchSha256">
): string {
  return runtimeSha256({
    domain: "blabase-runtime-work-signal-batch-v0.1",
    batch
  });
}

export function verifyRuntimeWorkSignalBatchIntegrity(
  input: unknown
): {
  ok: boolean;
  issues: RuntimeBatchIntegrityIssue[];
} {
  const parsed = runtimeWorkSignalBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: ["BATCH_HASH_MISMATCH"]
    };
  }

  const batch = parsed.data;
  const issues: RuntimeBatchIntegrityIssue[] = [];
  for (const signal of batch.signals) {
    issues.push(
      ...verifyRuntimeWorkSignalIntegrity(signal).issues
    );
  }
  const {
    batchSha256: storedHash,
    ...batchWithoutHash
  } = batch;
  if (
    storedHash !==
    computeRuntimeWorkSignalBatchSha256(batchWithoutHash)
  ) {
    issues.push("BATCH_HASH_MISMATCH");
  }
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)]
  };
}

function expectedSignalId(
  signal: RuntimeWorkSignalDraft
): string {
  return runtimeStableId("sig", WORK_SIGNAL_ID_POLICY_VERSION, {
    source: signal.source,
    subjectId: signal.subjectId,
    kind: signal.kind,
    claimDiscriminator: claimDiscriminator(signal)
  });
}

function expectedObservationId(
  signal: RuntimeWorkSignalDraft,
  signalId: string
): string {
  return runtimeStableId(
    "obs",
    "runtime-work-signal-observation-v0.1",
    {
      signalId,
      sourceSnapshotSha256: signal.sourceSnapshotSha256,
      observedAt: signal.observedAt,
      sourceUpdatedAt: signal.sourceUpdatedAt,
      facts: signal.facts,
      evidence: signal.evidence
    }
  );
}

function claimDiscriminator(
  signal: RuntimeWorkSignalDraft
): string {
  switch (signal.kind) {
    case "work_item_observation":
      return (
        signal.facts as {
          taskKind: string;
        }
      ).taskKind;
    case "deadline_observation": {
      const facts = signal.facts as {
        deadlineKind: string;
        taskKind: string;
      };
      return `${facts.deadlineKind}:${facts.taskKind}`;
    }
    case "activity_observation":
      return (
        signal.facts as {
          activityKind: string;
        }
      ).activityKind;
    case "execution_observation":
      return "native_session_state";
  }
}
