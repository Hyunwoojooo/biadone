import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  attentionReplayInputArtifactSchema,
  attentionFeedbackRecordSchema,
  attentionMonitorFailureRecordSchema,
  attentionMonitorRunSchema,
  attentionMonitorStoreSchema,
  currentAttentionReplayInputArtifactSchema,
  type AttentionFeedbackRecord,
  type AttentionFeedbackRequest,
  type AttentionFeedbackType,
  type AttentionHistoryResponse,
  type AttentionMonitorFailureRecord,
  type AttentionMonitorRun,
  type AttentionMonitorStore,
  type AttentionReplayInputArtifact,
  type StoredAttentionReplayInputArtifact
} from "./monitoringSchema";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import { runPhase2AttentionRouter } from "../crossSource/runAttentionRouter";
import { resolveActiveAttention } from "../attentionDecision";
import {
  ATTENTION_FEEDBACK_CONTRACT,
  ATTENTION_MONITOR_MAX_FEEDBACK,
  ATTENTION_MONITOR_MAX_FAILURES,
  ATTENTION_MONITOR_MAX_RUNS,
  ATTENTION_MONITOR_FAILURE_CONTRACT,
  ATTENTION_MONITOR_FAILURE_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_FAILURE_V02_CONTRACT,
  ATTENTION_MONITOR_RETENTION_DAYS,
  ATTENTION_MONITOR_RUN_CONTRACT,
  ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_RUN_V03_CONTRACT,
  ATTENTION_REPLAY_INPUT_CONTRACT,
  ATTENTION_REPLAY_INPUT_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_STORE_CONTRACT
} from "./versions";

const mutationQueues = new Map<string, Promise<unknown>>();
const replayArtifactFileNamePattern =
  /^run_[a-f0-9]{32}\.json$/;
const replayTemporaryFileNamePattern =
  /^run_[a-f0-9]{32}\.json\.\d+\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;

type PersistedLegacyRecords = {
  runs: Map<string, Record<string, unknown>>;
  failures: Map<string, Record<string, unknown>>;
};

export class AttentionMonitorStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "REPLAY_ARTIFACT_INVALID"
      | "REPLAY_ARTIFACT_WRITE_FAILED"
      | "RUN_NOT_FOUND"
  ) {
    super(code);
    this.name = "AttentionMonitorStoreError";
  }
}

export function attentionMonitorDirectory(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "attention");
}

export function attentionReplayInputDirectory(
  cwd = process.cwd()
): string {
  return join(attentionMonitorDirectory(cwd), "replay-inputs");
}

export async function readAttentionMonitorStore(
  cwd = process.cwd(),
  now = new Date()
): Promise<AttentionMonitorStore> {
  return withStoreMutation(cwd, async () => {
    const { store, changed, legacyRecords } =
      await readPrunedStore(cwd, now);
    if (changed) {
      await writeAttentionMonitorStore(
        store,
        cwd,
        legacyRecords
      );
    }
    await pruneReplayArtifacts(
      new Set(store.runs.map((run) => run.runId)),
      cwd,
      now
    );
    return store;
  });
}

async function readPrunedStore(
  cwd: string,
  now: Date
): Promise<{
  store: AttentionMonitorStore;
  changed: boolean;
  legacyRecords: PersistedLegacyRecords;
}> {
  try {
    await pruneReplayArtifacts(null, cwd, now);
    const text = await readFile(
      join(attentionMonitorDirectory(cwd), "monitor.json"),
      "utf8"
    );
    const raw = JSON.parse(text);
    const parsed = attentionMonitorStoreSchema.parse(raw);
    const store = pruneStore(parsed, now);
    await assertPersistedReplayClaims(store, cwd);
    return {
      store,
      changed: JSON.stringify(parsed) !== JSON.stringify(store),
      legacyRecords: collectPersistedLegacyRecords(raw)
    };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return {
        store: emptyStore(now),
        changed: false,
        legacyRecords: emptyLegacyRecords()
      };
    }
    throw new AttentionMonitorStoreError("STORE_READ_FAILED");
  }
}

export async function recordAttentionRun(
  runInput: AttentionMonitorRun,
  replayArtifactInput: AttentionReplayInputArtifact,
  cwd = process.cwd(),
  now = new Date()
): Promise<AttentionMonitorRun> {
  const run = attentionMonitorRunSchema.parse(runInput);
  if (run.contract !== ATTENTION_MONITOR_RUN_CONTRACT) {
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_INVALID"
    );
  }
  const replayArtifact =
    currentAttentionReplayInputArtifactSchema.parse(
      replayArtifactInput
    );
  assertReplayArtifactMatchesRun(run, replayArtifact);
  return withStoreMutation(cwd, async () => {
    const { store, legacyRecords } = await readPrunedStore(
      cwd,
      now
    );
    await writeReplayArtifact(replayArtifact, cwd);
    const next = pruneStore(
      {
        ...store,
        updatedAt: now.toISOString(),
        runs: [
          run,
          ...store.runs.filter((item) => item.runId !== run.runId)
        ].slice(0, ATTENTION_MONITOR_MAX_RUNS)
      },
      now
    );
    await writeAttentionMonitorStore(next, cwd, legacyRecords);
    await pruneReplayArtifacts(
      new Set(next.runs.map((item) => item.runId)),
      cwd,
      now
    );
    return run;
  });
}

export async function readAttentionReplayInputArtifact(
  runId: string,
  cwd = process.cwd()
): Promise<StoredAttentionReplayInputArtifact | null> {
  if (!/^run_[a-f0-9]{32}$/.test(runId)) {
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_INVALID"
    );
  }
  try {
    const text = await readFile(
      join(attentionReplayInputDirectory(cwd), `${runId}.json`),
      "utf8"
    );
    return attentionReplayInputArtifactSchema.parse(JSON.parse(text));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_INVALID"
    );
  }
}

export async function recordAttentionFeedback(
  input: AttentionFeedbackRequest,
  cwd = process.cwd(),
  now = new Date()
): Promise<AttentionFeedbackRecord> {
  return withStoreMutation(cwd, async () => {
    const { store, legacyRecords } = await readPrunedStore(
      cwd,
      now
    );
    const run = store.runs.find((item) => item.runId === input.runId);
    if (!run) {
      throw new AttentionMonitorStoreError("RUN_NOT_FOUND");
    }
    const previous = store.feedback.find(
      (item) => item.runId === input.runId
    );
    if (previous?.feedbackType === input.feedbackType) {
      return previous;
    }
    const feedback = attentionFeedbackRecordSchema.parse({
      contract: ATTENTION_FEEDBACK_CONTRACT,
      feedbackId: randomUUID(),
      createdAt: now.toISOString(),
      runId: run.runId,
      candidateId: run.topCandidateId,
      feedbackType: input.feedbackType,
      supersedesFeedbackId: previous?.feedbackId ?? null,
      signalSource: "explicit_rating",
      explicit: true,
      reviewState: "candidate",
      privacyClass: "private_local_metadata",
      retentionDays: ATTENTION_MONITOR_RETENTION_DAYS
    });
    const next = pruneStore(
      {
        ...store,
        updatedAt: now.toISOString(),
        feedback: [feedback, ...store.feedback].slice(
          0,
          ATTENTION_MONITOR_MAX_FEEDBACK
        )
      },
      now
    );
    await writeAttentionMonitorStore(next, cwd, legacyRecords);
    await pruneReplayArtifacts(
      new Set(next.runs.map((runItem) => runItem.runId)),
      cwd,
      now
    );
    return feedback;
  });
}

export async function recordAttentionFailure(
  failureInput: AttentionMonitorFailureRecord,
  cwd = process.cwd(),
  now = new Date()
): Promise<AttentionMonitorFailureRecord> {
  const failure =
    attentionMonitorFailureRecordSchema.parse(failureInput);
  if (failure.contract !== ATTENTION_MONITOR_FAILURE_CONTRACT) {
    throw new AttentionMonitorStoreError("STORE_WRITE_FAILED");
  }
  return withStoreMutation(cwd, async () => {
    const { store, legacyRecords } = await readPrunedStore(
      cwd,
      now
    );
    const next = pruneStore(
      {
        ...store,
        updatedAt: now.toISOString(),
        failures: [
          failure,
          ...store.failures.filter(
            (item) => item.runId !== failure.runId
          )
        ].slice(0, ATTENTION_MONITOR_MAX_FAILURES)
      },
      now
    );
    await writeAttentionMonitorStore(next, cwd, legacyRecords);
    await pruneReplayArtifacts(
      new Set(next.runs.map((run) => run.runId)),
      cwd,
      now
    );
    return failure;
  });
}

function assertReplayArtifactMatchesRun(
  run: AttentionMonitorRun,
  artifact: StoredAttentionReplayInputArtifact
): void {
  const contractGenerationMatches =
    (run.contract === ATTENTION_MONITOR_RUN_CONTRACT &&
      artifact.contract === ATTENTION_REPLAY_INPUT_CONTRACT) ||
    (run.contract === ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT &&
      artifact.contract === ATTENTION_REPLAY_INPUT_CONTRACT) ||
    (run.contract === ATTENTION_MONITOR_RUN_V03_CONTRACT &&
      artifact.contract === ATTENTION_REPLAY_INPUT_PREVIOUS_CONTRACT);
  const artifactSha256 = runtimeSha256({
    domain:
      artifact.contract === ATTENTION_REPLAY_INPUT_CONTRACT
        ? "attention-private-replay-artifact-v2"
        : "attention-private-replay-artifact-v1",
    artifact
  });
  if (
    !contractGenerationMatches ||
    run.replayArtifactState !== "available" ||
    run.replayArtifactSha256 !== artifactSha256 ||
    run.runId !== artifact.runId ||
    run.analysisId !== artifact.analysisId ||
    run.sessionId !== artifact.sessionId ||
    run.inputSha256 !== artifact.inputSha256 ||
    run.completedAt !== artifact.capturedAt
  ) {
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_INVALID"
    );
  }
  if (
    run.contract === ATTENTION_MONITOR_RUN_CONTRACT &&
    artifact.contract === ATTENTION_REPLAY_INPUT_CONTRACT
  ) {
    assertActiveReplayResolutionMatchesRun(run, artifact);
  }
}

function assertActiveReplayResolutionMatchesRun(
  run: AttentionMonitorRun,
  artifact: AttentionReplayInputArtifact
): void {
  const result = resolveActiveAttention(artifact.input);
  const baseResult = runPhase2AttentionRouter(
    artifact.input.baseAttentionInput
  );
  const expectedCounts = {
    eligible: result.assessments.filter(
      (assessment) => assessment.status === "eligible"
    ).length,
    reviewRequired: result.assessments.filter(
      (assessment) => assessment.status === "review_required"
    ).length,
    ineligible: result.assessments.filter(
      (assessment) => assessment.status === "ineligible"
    ).length
  };
  const expectedAssessments = result.assessments.map(
    (assessment) => ({
      assessmentId: assessment.assessmentId,
      candidateId: assessment.candidateId,
      triggerSource: assessment.triggerSource,
      triggerKind: assessment.triggerKind,
      status: assessment.status,
      reviewRoute: assessment.reviewRoute,
      reasonCodes: assessment.reasonCodes
    })
  );
  const expectedCoverageDisposition =
    result.coverage.negativeCandidateCoverageComplete
      ? "scoped_complete"
      : result.decision.status === "suggested"
        ? "limited_but_sufficient"
        : "insufficient";
  const expected = {
    resultId: result.resultId,
    resultSha256: result.resultSha256,
    decisionStatus: result.decision.status,
    certainty: result.decision.certainty,
    topCandidateId:
      result.decision.topSuggestion?.candidateId ?? null,
    alternativeCount: result.decision.alternatives.length,
    candidateCounts: expectedCounts,
    candidateAssessmentDetailState: "available",
    candidateAssessments: expectedAssessments,
    codexExecutionCount:
      baseResult.workCockpit.codexExecutions.length,
    coverageDisposition: expectedCoverageDisposition,
    decisionReasonCodes: result.decision.reasonCodes,
    caveatCodes: result.decision.caveatCodes
  };
  const recorded = {
    resultId: run.resultId,
    resultSha256: run.resultSha256,
    decisionStatus: run.decisionStatus,
    certainty: run.certainty,
    topCandidateId: run.topCandidateId,
    alternativeCount: run.alternativeCount,
    candidateCounts: run.candidateCounts,
    candidateAssessmentDetailState:
      run.candidateAssessmentDetailState,
    candidateAssessments: run.candidateAssessments,
    codexExecutionCount: run.codexExecutionCount,
    coverageDisposition: run.coverageDisposition,
    decisionReasonCodes: run.decisionReasonCodes,
    caveatCodes: run.caveatCodes
  };
  if (
    runtimeSha256({ domain: "active-replay-resolution-v0.2", expected }) !==
    runtimeSha256({ domain: "active-replay-resolution-v0.2", expected: recorded })
  ) {
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_INVALID"
    );
  }
}

async function assertPersistedReplayClaims(
  store: AttentionMonitorStore,
  cwd: string
): Promise<void> {
  for (const run of store.runs) {
    if (
      run.contract !== ATTENTION_MONITOR_RUN_CONTRACT &&
      run.contract !== ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT &&
      run.contract !== ATTENTION_MONITOR_RUN_V03_CONTRACT
    ) {
      continue;
    }
    const artifact = await readAttentionReplayInputArtifact(
      run.runId,
      cwd
    );
    if (artifact === null) {
      throw new AttentionMonitorStoreError(
        "REPLAY_ARTIFACT_INVALID"
      );
    }
    assertReplayArtifactMatchesRun(run, artifact);
  }
}

async function writeReplayArtifact(
  artifact: AttentionReplayInputArtifact,
  cwd: string
): Promise<void> {
  const directory = attentionReplayInputDirectory(cwd);
  const target = join(directory, `${artifact.runId}.json`);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  let temporary: string | null = null;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      const existing = await readFile(target, "utf8");
      if (existing !== serialized) {
        throw new AttentionMonitorStoreError(
          "REPLAY_ARTIFACT_INVALID"
        );
      }
      return;
    } catch (error) {
      if (
        error instanceof AttentionMonitorStoreError ||
        !isNodeError(error, "ENOENT")
      ) {
        throw error;
      }
    }
    temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, serialized, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    temporary = null;
    await chmod(target, 0o600);
  } catch (error) {
    if (temporary) {
      try {
        await unlink(temporary);
      } catch {
        // The atomic rename may already have moved the temporary file.
      }
    }
    if (error instanceof AttentionMonitorStoreError) throw error;
    throw new AttentionMonitorStoreError(
      "REPLAY_ARTIFACT_WRITE_FAILED"
    );
  }
}

async function pruneReplayArtifacts(
  retainedRunIds: ReadonlySet<string> | null,
  cwd: string,
  now: Date
): Promise<void> {
  const directory = attentionReplayInputDirectory(cwd);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new AttentionMonitorStoreError("STORE_WRITE_FAILED");
  }
  const temporaryCutoff =
    now.getTime() -
    ATTENTION_MONITOR_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const path = join(directory, entry.name);
      if (replayArtifactFileNamePattern.test(entry.name)) {
        const runId = entry.name.slice(0, -5);
        if (
          retainedRunIds !== null
            ? !retainedRunIds.has(runId)
            : await replayArtifactExpiredWithoutStore(
                path,
                temporaryCutoff
              )
        ) {
          await unlinkIfPresent(path);
        }
        return;
      }
      if (
        !replayTemporaryFileNamePattern.test(entry.name)
      ) {
        return;
      }
      try {
        const metadata = await stat(path);
        if (metadata.mtimeMs < temporaryCutoff) {
          await unlinkIfPresent(path);
        }
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    })
  );
}

async function replayArtifactExpiredWithoutStore(
  path: string,
  cutoff: number
): Promise<boolean> {
  try {
    const artifact = attentionReplayInputArtifactSchema.parse(
      JSON.parse(await readFile(path, "utf8"))
    );
    return Date.parse(artifact.capturedAt) < cutoff;
  } catch {
    try {
      const metadata = await stat(path);
      return metadata.mtimeMs < cutoff;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

export async function readAttentionHistory(
  cwd = process.cwd(),
  now = new Date()
): Promise<Extract<AttentionHistoryResponse, { status: "ready" }>> {
  const store = await readAttentionMonitorStore(cwd, now);
  const feedbackByRun = new Map<string, AttentionFeedbackRecord[]>();
  const currentFeedbackByRun = new Map<
    string,
    AttentionFeedbackRecord
  >();
  for (const item of store.feedback) {
    const current = feedbackByRun.get(item.runId) ?? [];
    current.push(item);
    feedbackByRun.set(item.runId, current);
    if (!currentFeedbackByRun.has(item.runId)) {
      currentFeedbackByRun.set(item.runId, item);
    }
  }
  const decisionCounts = {
    suggested: 0,
    needs_clarification: 0,
    no_action: 0,
    insufficient_evidence: 0
  };
  for (const run of store.runs) {
    decisionCounts[run.decisionStatus] += 1;
  }
  const feedbackCounts: Record<AttentionFeedbackType, number> = {
    helpful: 0,
    wrong_priority: 0,
    already_done: 0,
    not_mine: 0,
    insufficient_context: 0
  };
  for (const item of currentFeedbackByRun.values()) {
    feedbackCounts[item.feedbackType] += 1;
  }

  return {
    status: "ready",
    generatedAt: now.toISOString(),
    retentionDays: ATTENTION_MONITOR_RETENTION_DAYS,
    runCount: store.runs.length,
    failureCount: store.failures.length,
    feedbackCount: currentFeedbackByRun.size,
    feedbackEventCount: store.feedback.length,
    decisionCounts,
    feedbackCounts,
    failures: store.failures.slice(0, 100),
    entries: store.runs.slice(0, 100).map((run) => ({
      ...run,
      feedback: feedbackByRun.get(run.runId) ?? []
    }))
  };
}

async function writeAttentionMonitorStore(
  storeInput: AttentionMonitorStore,
  cwd: string,
  legacyRecords = emptyLegacyRecords()
): Promise<void> {
  const store = attentionMonitorStoreSchema.parse(storeInput);
  const persistedStore = {
    ...store,
    runs: store.runs.map((run) =>
      run.contract === "attention-monitor-run-v0.1" ||
      run.contract === "attention-monitor-run-v0.2" ||
      run.contract === "attention-monitor-run-v0.3"
        ? legacyRecords.runs.get(run.runId) ?? run
        : run
    ),
    failures: store.failures.map((failure) =>
      failure.contract === "attention-monitor-failure-v0.1" ||
      failure.contract === ATTENTION_MONITOR_FAILURE_V02_CONTRACT ||
      failure.contract === ATTENTION_MONITOR_FAILURE_PREVIOUS_CONTRACT
        ? legacyRecords.failures.get(failure.runId) ?? failure
        : failure
    )
  };
  const directory = attentionMonitorDirectory(cwd);
  let temporary: string | null = null;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const target = join(directory, "monitor.json");
    temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(persistedStore, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
    if (temporary) {
      try {
        await unlink(temporary);
      } catch {
        // The atomic rename may already have moved the temporary file.
      }
    }
    throw new AttentionMonitorStoreError("STORE_WRITE_FAILED");
  }
}

function collectPersistedLegacyRecords(
  input: unknown
): PersistedLegacyRecords {
  const records = emptyLegacyRecords();
  if (!isRecord(input)) return records;
  if (Array.isArray(input.runs)) {
    for (const run of input.runs) {
      if (
        isRecord(run) &&
        typeof run.runId === "string" &&
        (run.contract === "attention-monitor-run-v0.1" ||
          run.contract === "attention-monitor-run-v0.2" ||
          run.contract === "attention-monitor-run-v0.3")
      ) {
        records.runs.set(run.runId, run);
      }
    }
  }
  if (Array.isArray(input.failures)) {
    for (const failure of input.failures) {
      if (
        isRecord(failure) &&
        typeof failure.runId === "string" &&
        (failure.contract === "attention-monitor-failure-v0.1" ||
          failure.contract === ATTENTION_MONITOR_FAILURE_V02_CONTRACT ||
          failure.contract === ATTENTION_MONITOR_FAILURE_PREVIOUS_CONTRACT)
      ) {
        records.failures.set(failure.runId, failure);
      }
    }
  }
  return records;
}

function emptyLegacyRecords(): PersistedLegacyRecords {
  return {
    runs: new Map(),
    failures: new Map()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function emptyStore(now: Date): AttentionMonitorStore {
  return {
    contract: ATTENTION_MONITOR_STORE_CONTRACT,
    updatedAt: now.toISOString(),
    runs: [],
    feedback: [],
    failures: []
  };
}

function pruneStore(
  store: AttentionMonitorStore,
  now: Date
): AttentionMonitorStore {
  const cutoff =
    now.getTime() -
    ATTENTION_MONITOR_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  const runs = store.runs
    .filter((run) => Date.parse(run.asOf) >= cutoff)
    .sort(
      (left, right) =>
        Date.parse(right.asOf) - Date.parse(left.asOf) ||
        right.runId.localeCompare(left.runId)
    )
    .slice(0, ATTENTION_MONITOR_MAX_RUNS);
  const retainedRunIds = new Set(runs.map((run) => run.runId));
  const feedback = store.feedback
    .filter(
      (item) =>
        retainedRunIds.has(item.runId) &&
        Date.parse(item.createdAt) >= cutoff
    )
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.feedbackId.localeCompare(left.feedbackId)
    )
    .slice(0, ATTENTION_MONITOR_MAX_FEEDBACK);
  const failures = store.failures
    .filter(
      (failure) => Date.parse(failure.completedAt) >= cutoff
    )
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) -
          Date.parse(left.completedAt) ||
        right.runId.localeCompare(left.runId)
    )
    .slice(0, ATTENTION_MONITOR_MAX_FAILURES);

  return attentionMonitorStoreSchema.parse({
    ...store,
    runs,
    feedback,
    failures
  });
}

function withStoreMutation<T>(
  cwd: string,
  mutation: () => Promise<T>
): Promise<T> {
  const previous = mutationQueues.get(cwd) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  mutationQueues.set(cwd, next);
  return next.finally(() => {
    if (mutationQueues.get(cwd) === next) {
      mutationQueues.delete(cwd);
    }
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
