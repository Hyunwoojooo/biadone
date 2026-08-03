import {
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
  mkdir
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateAttentionSnapshots } from "../src/attention/liveAttention";
import { createAttentionFailureRecord } from "../src/attention/execution";
import {
  AttentionMonitorStoreError,
  attentionMonitorDirectory,
  attentionReplayInputDirectory,
  readAttentionHistory,
  readAttentionReplayInputArtifact,
  readAttentionMonitorStore,
  recordAttentionFeedback,
  recordAttentionFailure,
  recordAttentionRun
} from "../src/attention/localMonitorStore";
import {
  attentionMonitorFailureRecordSchema,
  attentionMonitorRunSchema
} from "../src/attention/monitoringSchema";
import { asEphemeralAttentionPreview } from "../src/attention/liveAttention";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Attention local monitor store", () => {
  it("keeps previously recorded v0.2 Attention replay inputs readable", async () => {
    const cwd = await temporaryDirectory();
    const current = evaluatedAt("2026-07-26T12:00:00.000Z");
    const legacyInput = {
      ...current.replayArtifact.input.baseAttentionInput,
      contract: "cross-source-attention-input-v0.2"
    };
    const legacyArtifact = {
      ...current.replayArtifact,
      contract: "attention-replay-input-v1" as const,
      inputSha256: runtimeSha256({
        domain: "blabase-cross-source-attention-input-v0.2",
        input: legacyInput
      }),
      input: legacyInput
    };
    const directory = attentionReplayInputDirectory(cwd);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${legacyArtifact.runId}.json`),
      `${JSON.stringify(legacyArtifact)}\n`,
      "utf8"
    );

    await expect(
      readAttentionReplayInputArtifact(
        legacyArtifact.runId,
        cwd
      )
    ).resolves.toEqual(legacyArtifact);
  });

  it("reads v0.1 run metadata with conservative provenance defaults", () => {
    const current = legacyRunFieldsAt(
      "2026-07-26T12:00:00.000Z"
    );
    const {
      supportingSources: _supportingSources,
      workContext: _workContext,
      analysisId: _analysisId,
      sessionId: _sessionId,
      codeState: _codeState,
      codeFingerprintSha256: _codeFingerprintSha256,
      replayArtifactState: _replayArtifactState,
      replayArtifactSha256: _replayArtifactSha256,
      ...legacyFields
    } = current;
    const legacy = attentionMonitorRunSchema.parse({
      ...legacyFields,
      contract: "attention-monitor-run-v0.1"
    });

    expect(legacy.contract).toBe("attention-monitor-run-v0.1");
    expect(legacy.supportingSources).toMatchObject([
      {
        source: "google_calendar",
        inputState: "unavailable"
      },
      {
        source: "notion",
        inputState: "unavailable"
      }
    ]);
    expect(legacy.workContext).toMatchObject({
      weeklyOutcomeStatus: "not_resolved",
      projectResolution: "not_resolved"
    });
    expect(
      attentionMonitorRunSchema.parse({
        ...legacy,
        analysisId: `analysis_${"a".repeat(32)}`
      })
    ).toMatchObject({
      analysisId: null,
      sessionId: null,
      codeCommitSha: null,
      codeState: "legacy_unknown",
      codeFingerprintSha256: null,
      replayArtifactState: "not_recorded",
      replayArtifactSha256: null
    });
  });

  it("reads v0.2 run metadata without inventing replay or code provenance", () => {
    const current = legacyRunFieldsAt(
      "2026-07-26T12:00:00.000Z"
    );
    const {
      analysisId: _analysisId,
      sessionId: _sessionId,
      codeState: _codeState,
      codeFingerprintSha256: _codeFingerprintSha256,
      replayArtifactState: _replayArtifactState,
      replayArtifactSha256: _replayArtifactSha256,
      ...previousFields
    } = current;
    const previous = attentionMonitorRunSchema.parse({
      ...previousFields,
      contract: "attention-monitor-run-v0.2"
    });

    expect(previous).toMatchObject({
      contract: "attention-monitor-run-v0.2",
      analysisId: null,
      sessionId: null,
      codeState: "legacy_unknown",
      codeFingerprintSha256: null,
      replayArtifactState: "not_recorded",
      replayArtifactSha256: null
    });
    for (const provenanceClaim of [
      {
        replayArtifactState: "available",
        replayArtifactSha256: "a".repeat(64)
      },
      {
        codeCommitSha: "a".repeat(40),
        codeState: "clean_commit"
      },
      {
        sessionId: `session_${"a".repeat(32)}`
      }
    ]) {
      expect(
        attentionMonitorRunSchema.parse({
          ...previous,
          ...provenanceClaim
        })
      ).toMatchObject({
        analysisId: null,
        sessionId: null,
        codeCommitSha: null,
        codeState: "legacy_unknown",
        codeFingerprintSha256: null,
        replayArtifactState: "not_recorded",
        replayArtifactSha256: null
      });
    }
  });

  it.each([
    "attention-monitor-run-v0.1",
    "attention-monitor-run-v0.2"
  ] as const)("reads persisted historical %s code provenance conservatively and preserves the raw record across future writes", async (contract) => {
    const cwd = await temporaryDirectory();
    const historical = evaluatedAt("2026-07-26T12:00:00.000Z");
    const originalCodeCommitSha = "a".repeat(40);
    const historicalRawRun = historicalRunFixture(
      historical,
      contract,
      originalCodeCommitSha
    );
    const currentFailureForLegacy = createAttentionFailureRecord({
      executionIds: {
        runId: `run_${"4".repeat(32)}`,
        analysisId: `analysis_${"5".repeat(32)}`,
        sessionId: `session_${"6".repeat(32)}`
      },
      startedAt: new Date("2026-07-26T12:00:00.000Z"),
      completedAt: new Date("2026-07-26T12:00:00.000Z"),
      stage: "source_sync",
      codeProvenance: unavailableCodeProvenanceFixture()
    });
    const legacyFailure = legacyFailureFixture(
      currentFailureForLegacy
    );
    const {
      codeCommitSha: _failureCodeCommitSha,
      codeState: _failureCodeState,
      codeFingerprintSha256: _failureCodeFingerprintSha256,
      ...legacyFailureFields
    } = legacyFailure;
    const historicalRawFailure = {
      ...legacyFailureFields,
      contract: "attention-monitor-failure-v0.1"
    };
    const directory = attentionMonitorDirectory(cwd);
    const storePath = join(directory, "monitor.json");
    await mkdir(directory, { recursive: true });
    await writeFile(
      storePath,
      `${JSON.stringify({
        contract: "attention-monitor-store-v0.1",
        updatedAt: "2026-07-26T12:00:00.000Z",
        runs: [historicalRawRun],
        feedback: [],
        failures: [historicalRawFailure]
      })}\n`,
      "utf8"
    );

    const migrated = await readAttentionMonitorStore(
      cwd,
      new Date("2026-07-26T12:01:00.000Z")
    );
    expect(migrated.runs[0]).toMatchObject({
      analysisId: null,
      sessionId: null,
      replayArtifactState: "not_recorded",
      replayArtifactSha256: null,
      codeCommitSha: null,
      codeState: "legacy_unknown",
      codeFingerprintSha256: null
    });
    expect(migrated.failures[0]).toMatchObject({
      contract: "attention-monitor-failure-v0.1",
      codeCommitSha: null,
      codeState: "legacy_unknown",
      codeFingerprintSha256: null
    });
    expect(JSON.stringify(migrated)).not.toContain(
      originalCodeCommitSha
    );
    expect(
      JSON.stringify(
        await readAttentionHistory(
          cwd,
          new Date("2026-07-26T12:01:30.000Z")
        )
      )
    ).not.toContain(originalCodeCommitSha);

    await recordAttentionFeedback(
      {
        runId: historicalRawRun.runId,
        feedbackType: "helpful"
      },
      cwd,
      new Date("2026-07-26T12:02:00.000Z")
    );
    const currentFailure = failureAt(
      "7",
      "2026-07-26T12:03:00.000Z"
    );
    await recordAttentionFailure(
      currentFailure,
      cwd,
      new Date(currentFailure.completedAt)
    );
    const currentRun = evaluatedAt("2026-07-26T12:04:00.000Z");
    await recordAttentionRun(
      currentRun.run,
      currentRun.replayArtifact,
      cwd,
      new Date(currentRun.run.completedAt)
    );

    const persisted = JSON.parse(
      await readFile(storePath, "utf8")
    ) as {
      runs: Array<Record<string, unknown>>;
      feedback: Array<Record<string, unknown>>;
      failures: Array<Record<string, unknown>>;
    };
    expect(
      persisted.runs.find(
        (run) => run.runId === historicalRawRun.runId
      )
    ).toEqual(historicalRawRun);
    expect(
      persisted.runs.find(
        (run) => run.runId === currentRun.run.runId
      )
    ).toMatchObject({
      contract: "attention-monitor-run-v0.4",
      replayArtifactState: "available"
    });
    expect(persisted.feedback).toHaveLength(1);
    expect(
      persisted.failures.find(
        (failure) => failure.runId === legacyFailure.runId
      )
    ).toEqual(historicalRawFailure);
    expect(
      persisted.failures.find(
        (failure) => failure.runId === currentFailure.runId
      )
    ).toMatchObject({
      contract: "attention-monitor-failure-v0.3",
      codeState: "unavailable"
    });
  });

  it("atomically records concurrent runs and explicit feedback as private metadata", async () => {
    const cwd = await temporaryDirectory();
    const first = evaluatedAt("2026-07-26T12:00:00.000Z");
    const second = evaluatedAt("2026-07-26T12:01:00.000Z");

    await Promise.all([
      recordAttentionRun(
        first.run,
        first.replayArtifact,
        cwd,
        new Date(first.run.asOf)
      ),
      recordAttentionRun(
        second.run,
        second.replayArtifact,
        cwd,
        new Date(second.run.asOf)
      )
    ]);
    const feedback = await recordAttentionFeedback(
      {
        runId: second.run.runId,
        feedbackType: "helpful"
      },
      cwd,
      new Date("2026-07-26T12:02:00.000Z")
    );
    const history = await readAttentionHistory(
      cwd,
      new Date("2026-07-26T12:03:00.000Z")
    );

    expect(history.runCount).toBe(2);
    expect(history.feedbackCount).toBe(1);
    expect(history.feedbackEventCount).toBe(1);
    expect(history.feedbackCounts.helpful).toBe(1);
    expect(history.entries[0].feedback).toEqual([feedback]);

    const directory = attentionMonitorDirectory(cwd);
    const file = join(directory, "monitor.json");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(file, "utf8");
    expect(serialized).not.toContain("github.com");
    expect(serialized).not.toContain("taskSummary");
    expect(serialized).not.toContain("destinationUrl");
    const replayArtifact = await readAttentionReplayInputArtifact(
      second.run.runId,
      cwd
    );
    expect(replayArtifact).toEqual(second.replayArtifact);
    expect(
      (
        await stat(
          join(
            attentionMonitorDirectory(cwd),
            "replay-inputs",
            `${second.run.runId}.json`
          )
        )
      ).mode & 0o777
    ).toBe(0o600);
  });

  it("records strict sanitized failure metadata and exposes it in history", async () => {
    const cwd = await temporaryDirectory();
    const failure = createAttentionFailureRecord({
      executionIds: {
        runId: `run_${"1".repeat(32)}`,
        analysisId: `analysis_${"2".repeat(32)}`,
        sessionId: `session_${"3".repeat(32)}`
      },
      startedAt: new Date("2026-07-26T12:00:00.000Z"),
      completedAt: new Date("2026-07-26T12:00:01.250Z"),
      stage: "attention_resolution",
      retryCount: 0,
      codeProvenance: {
        codeCommitSha: "a".repeat(40),
        codeState: "declared_commit",
        codeFingerprintSha256: null
      }
    });

    expect(
      attentionMonitorFailureRecordSchema.safeParse({
        ...failure,
        rawError: "secret-token"
      }).success
    ).toBe(false);
    const {
      codeCommitSha: _codeCommitSha,
      codeState: _codeState,
      codeFingerprintSha256: _codeFingerprintSha256,
      ...failureWithoutCodeProvenance
    } = failure;
    expect(
      attentionMonitorFailureRecordSchema.safeParse(
        failureWithoutCodeProvenance
      ).success
    ).toBe(false);
    await recordAttentionFailure(
      failure,
      cwd,
      new Date(failure.completedAt)
    );
    const history = await readAttentionHistory(
      cwd,
      new Date("2026-07-26T12:01:00.000Z")
    );

    expect(history).toMatchObject({
      runCount: 0,
      failureCount: 1,
      failures: [
        {
          ...failure,
          status: "failed",
          errorCode: "ATTENTION_RESOLUTION_FAILED",
          latencyMs: 1_250,
          contract: "attention-monitor-failure-v0.3",
          codeCommitSha: "a".repeat(40),
          codeState: "declared_commit",
          codeFingerprintSha256: null
        }
      ]
    });
    const serialized = await readFile(
      join(attentionMonitorDirectory(cwd), "monitor.json"),
      "utf8"
    );
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("rawError");
  });

  it("deduplicates repeated ratings and preserves explicit corrections", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");
    const run = evaluated.run;
    await recordAttentionRun(
      run,
      evaluated.replayArtifact,
      cwd,
      new Date(run.asOf)
    );

    const first = await recordAttentionFeedback(
      { runId: run.runId, feedbackType: "helpful" },
      cwd,
      new Date("2026-07-26T12:01:00.000Z")
    );
    const duplicate = await recordAttentionFeedback(
      { runId: run.runId, feedbackType: "helpful" },
      cwd,
      new Date("2026-07-26T12:02:00.000Z")
    );
    const correction = await recordAttentionFeedback(
      { runId: run.runId, feedbackType: "wrong_priority" },
      cwd,
      new Date("2026-07-26T12:03:00.000Z")
    );
    const history = await readAttentionHistory(
      cwd,
      new Date("2026-07-26T12:04:00.000Z")
    );

    expect(duplicate).toEqual(first);
    expect(correction.supersedesFeedbackId).toBe(first.feedbackId);
    expect(history.feedbackCount).toBe(1);
    expect(history.feedbackEventCount).toBe(2);
    expect(history.feedbackCounts).toMatchObject({
      helpful: 0,
      wrong_priority: 1
    });
    expect(
      history.entries[0].feedback.map((item) => item.feedbackId)
    ).toEqual([correction.feedbackId, first.feedbackId]);
  });

  it("prunes runs and feedback beyond the 30-day retention boundary", async () => {
    const cwd = await temporaryDirectory();
    const oldRun = evaluatedAt("2026-06-01T12:00:00.000Z");
    const currentRun = evaluatedAt("2026-07-02T12:00:00.001Z");

    await recordAttentionRun(
      oldRun.run,
      oldRun.replayArtifact,
      cwd,
      new Date("2026-06-01T12:00:00.000Z")
    );
    await recordAttentionFeedback(
      { runId: oldRun.run.runId, feedbackType: "wrong_priority" },
      cwd,
      new Date("2026-06-01T12:01:00.000Z")
    );
    await recordAttentionRun(
      currentRun.run,
      currentRun.replayArtifact,
      cwd,
      new Date("2026-07-02T12:00:00.001Z")
    );

    const history = await readAttentionHistory(
      cwd,
      new Date("2026-07-02T12:00:00.001Z")
    );
    expect(history.entries.map((entry) => entry.runId)).toEqual([
      currentRun.run.runId
    ]);
    expect(history.feedbackCount).toBe(0);
    const persisted = JSON.parse(
      await readFile(
        join(attentionMonitorDirectory(cwd), "monitor.json"),
        "utf8"
      )
    ) as { runs: Array<{ runId: string }>; feedback: unknown[] };
    expect(persisted.runs.map((run) => run.runId)).toEqual([
      currentRun.run.runId
    ]);
    expect(persisted.feedback).toEqual([]);
    await expect(
      readAttentionReplayInputArtifact(oldRun.run.runId, cwd)
    ).resolves.toBeNull();
    await expect(
      readAttentionReplayInputArtifact(currentRun.run.runId, cwd)
    ).resolves.toEqual(currentRun.replayArtifact);
  });

  it("prunes failure metadata beyond the same 30-day boundary", async () => {
    const cwd = await temporaryDirectory();
    const oldFailure = failureAt(
      "1",
      "2026-06-01T12:00:00.000Z"
    );
    const currentFailure = failureAt(
      "2",
      "2026-07-02T12:00:00.001Z"
    );

    await recordAttentionFailure(
      oldFailure,
      cwd,
      new Date(oldFailure.completedAt)
    );
    await recordAttentionFailure(
      currentFailure,
      cwd,
      new Date(currentFailure.completedAt)
    );

    const history = await readAttentionHistory(
      cwd,
      new Date("2026-07-02T12:00:00.001Z")
    );
    expect(history.failureCount).toBe(1);
    expect(history.failures).toEqual([currentFailure]);
  });

  it("does not silently overwrite a corrupt private store", async () => {
    const cwd = await temporaryDirectory();
    const directory = attentionMonitorDirectory(cwd);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "monitor.json"), "{invalid", "utf8");

    await expect(readAttentionMonitorStore(cwd)).rejects.toMatchObject({
      name: "AttentionMonitorStoreError",
      code: "STORE_READ_FAILED"
    } satisfies Partial<AttentionMonitorStoreError>);
  });

  it("retention-cleans only strict old replay files when the monitor store is corrupt", async () => {
    const cwd = await temporaryDirectory();
    const directory = attentionMonitorDirectory(cwd);
    const replayDirectory = attentionReplayInputDirectory(cwd);
    await mkdir(replayDirectory, { recursive: true });
    await writeFile(join(directory, "monitor.json"), "{invalid", "utf8");

    const oldArtifact = evaluatedAt(
      "2026-06-01T12:00:00.000Z"
    ).replayArtifact;
    const currentArtifact = evaluatedAt(
      "2026-07-26T12:00:00.000Z"
    ).replayArtifact;
    const oldArtifactPath = join(
      replayDirectory,
      `${oldArtifact.runId}.json`
    );
    const currentArtifactPath = join(
      replayDirectory,
      `${currentArtifact.runId}.json`
    );
    await writeFile(
      oldArtifactPath,
      `${JSON.stringify(oldArtifact)}\n`,
      "utf8"
    );
    await writeFile(
      currentArtifactPath,
      `${JSON.stringify(currentArtifact)}\n`,
      "utf8"
    );
    const oldTemporaryPath = join(
      replayDirectory,
      `run_${"8".repeat(32)}.json.101.00000000-0000-4000-8000-000000000008.tmp`
    );
    const currentTemporaryPath = join(
      replayDirectory,
      `run_${"9".repeat(32)}.json.102.00000000-0000-4000-8000-000000000009.tmp`
    );
    const unsafeOldPath = join(
      replayDirectory,
      `run_${"a".repeat(32)}.json.103.not-a-uuid.tmp`
    );
    const canonicalDirectory = join(
      replayDirectory,
      `run_${"b".repeat(32)}.json`
    );
    await writeFile(oldTemporaryPath, "stale", "utf8");
    await writeFile(currentTemporaryPath, "current", "utf8");
    await writeFile(unsafeOldPath, "unsafe", "utf8");
    await mkdir(canonicalDirectory);
    const oldTimestamp = new Date("2026-06-01T00:00:00.000Z");
    await Promise.all([
      utimes(oldTemporaryPath, oldTimestamp, oldTimestamp),
      utimes(unsafeOldPath, oldTimestamp, oldTimestamp)
    ]);

    await expect(
      readAttentionMonitorStore(
        cwd,
        new Date("2026-07-27T12:00:00.000Z")
      )
    ).rejects.toMatchObject({
      code: "STORE_READ_FAILED"
    });

    await expect(readFile(oldArtifactPath, "utf8")).rejects.toMatchObject(
      { code: "ENOENT" }
    );
    await expect(readFile(oldTemporaryPath, "utf8")).rejects.toMatchObject(
      { code: "ENOENT" }
    );
    await expect(readFile(currentArtifactPath, "utf8")).resolves.toContain(
      currentArtifact.runId
    );
    await expect(readFile(currentTemporaryPath, "utf8")).resolves.toBe(
      "current"
    );
    await expect(readFile(unsafeOldPath, "utf8")).resolves.toBe(
      "unsafe"
    );
    expect((await stat(canonicalDirectory)).isDirectory()).toBe(true);
  });

  it("rejects a mismatched replay artifact and never overwrites an immutable one", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");
    const mismatched = {
      ...evaluated.replayArtifact,
      sessionId: `session_${"f".repeat(32)}`
    };

    await expect(
      recordAttentionRun(
        evaluated.run,
        mismatched,
        cwd,
        new Date(evaluated.run.asOf)
      )
    ).rejects.toMatchObject({
      code: "REPLAY_ARTIFACT_INVALID"
    });

    await recordAttentionRun(
      evaluated.run,
      evaluated.replayArtifact,
      cwd,
      new Date(evaluated.run.asOf)
    );
    await writeFile(
      join(
        attentionMonitorDirectory(cwd),
        "replay-inputs",
        `${evaluated.run.runId}.json`
      ),
      "{}\n",
      "utf8"
    );

    await expect(
      recordAttentionRun(
        evaluated.run,
        evaluated.replayArtifact,
        cwd,
        new Date(evaluated.run.asOf)
      )
    ).rejects.toMatchObject({
      code: "STORE_READ_FAILED"
    });
  });

  it("rejects active monitor result metadata that the exact replay input cannot reproduce", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");

    await expect(
      recordAttentionRun(
        {
          ...evaluated.run,
          resultSha256: "f".repeat(64)
        },
        evaluated.replayArtifact,
        cwd,
        new Date(evaluated.run.asOf)
      )
    ).rejects.toMatchObject({
      code: "REPLAY_ARTIFACT_INVALID"
    });
  });

  it("fails closed when a v0.4 replay artifact is missing or schema-invalid", async () => {
    for (const corruption of ["missing", "invalid_schema"] as const) {
      const cwd = await temporaryDirectory();
      const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");
      await recordAttentionRun(
        evaluated.run,
        evaluated.replayArtifact,
        cwd,
        new Date(evaluated.run.asOf)
      );
      const artifactPath = join(
        attentionReplayInputDirectory(cwd),
        `${evaluated.run.runId}.json`
      );
      if (corruption === "missing") {
        await unlink(artifactPath);
      } else {
        await writeFile(artifactPath, "{}\n", "utf8");
      }

      await expect(
        readAttentionMonitorStore(
          cwd,
          new Date("2026-07-26T12:01:00.000Z")
        )
      ).rejects.toMatchObject({
        code: "STORE_READ_FAILED"
      });
    }
  });

  it("fails closed when a v0.4 replay hash claim is not the artifact hash", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");
    await recordAttentionRun(
      evaluated.run,
      evaluated.replayArtifact,
      cwd,
      new Date(evaluated.run.asOf)
    );
    const storePath = join(
      attentionMonitorDirectory(cwd),
      "monitor.json"
    );
    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      runs: Array<{ replayArtifactSha256: string }>;
    };
    store.runs[0].replayArtifactSha256 = "f".repeat(64);
    await writeFile(storePath, `${JSON.stringify(store)}\n`, "utf8");

    await expect(
      readAttentionHistory(
        cwd,
        new Date("2026-07-26T12:01:00.000Z")
      )
    ).rejects.toMatchObject({
      code: "STORE_READ_FAILED"
    });
  });

  it("fails closed when an otherwise valid replay artifact has different execution linkage", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");
    await recordAttentionRun(
      evaluated.run,
      evaluated.replayArtifact,
      cwd,
      new Date(evaluated.run.asOf)
    );
    const artifactPath = join(
      attentionReplayInputDirectory(cwd),
      `${evaluated.run.runId}.json`
    );
    const relinkedArtifact = {
      ...evaluated.replayArtifact,
      sessionId: `session_${"f".repeat(32)}`
    };
    await writeFile(
      artifactPath,
      `${JSON.stringify(relinkedArtifact)}\n`,
      "utf8"
    );
    const storePath = join(
      attentionMonitorDirectory(cwd),
      "monitor.json"
    );
    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      runs: Array<{ replayArtifactSha256: string }>;
    };
    store.runs[0].replayArtifactSha256 = runtimeSha256({
      domain: "attention-private-replay-artifact-v2",
      artifact: relinkedArtifact
    });
    await writeFile(storePath, `${JSON.stringify(store)}\n`, "utf8");

    await expect(
      readAttentionMonitorStore(
        cwd,
        new Date("2026-07-26T12:01:00.000Z")
      )
    ).rejects.toMatchObject({
      code: "STORE_READ_FAILED"
    });
  });

  it("retention-prunes crashed replay temp files without deleting a current temp", async () => {
    const cwd = await temporaryDirectory();
    const directory = attentionReplayInputDirectory(cwd);
    await mkdir(directory, { recursive: true });
    const oldTemporary = join(
      directory,
      `run_${"a".repeat(32)}.json.101.00000000-0000-4000-8000-000000000001.tmp`
    );
    const currentTemporary = join(
      directory,
      `run_${"b".repeat(32)}.json.102.00000000-0000-4000-8000-000000000002.tmp`
    );
    await writeFile(oldTemporary, "stale", "utf8");
    await writeFile(currentTemporary, "active", "utf8");
    const oldTimestamp = new Date("2026-06-01T00:00:00.000Z");
    await utimes(oldTemporary, oldTimestamp, oldTimestamp);
    const currentTimestamp = new Date("2026-07-26T12:00:00.000Z");
    await utimes(
      currentTemporary,
      currentTimestamp,
      currentTimestamp
    );

    await readAttentionMonitorStore(
      cwd,
      new Date("2026-07-27T12:00:00.000Z")
    );

    await expect(readFile(oldTemporary, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(currentTemporary, "utf8")).resolves.toBe(
      "active"
    );
  });

  it("never persists an ephemeral preview as a formal run", async () => {
    const cwd = await temporaryDirectory();
    const evaluated = evaluatedAt("2026-07-26T12:00:00.000Z");

    await expect(
      recordAttentionRun(
        asEphemeralAttentionPreview(evaluated.run),
        evaluated.replayArtifact,
        cwd
      )
    ).rejects.toMatchObject({
      code: "REPLAY_ARTIFACT_INVALID"
    });
    await expect(readAttentionMonitorStore(cwd)).resolves.toMatchObject({
      runs: []
    });
  });
});

function evaluatedAt(asOf: string) {
  return evaluateAttentionSnapshots({
    github: {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    },
    codex: {
      status: "unavailable",
      reason: "CONNECTOR_DISCONNECTED"
    },
    asOf
  });
}

function historicalRunFixture(
  evaluated: ReturnType<typeof evaluatedAt>,
  contract:
    | "attention-monitor-run-v0.1"
    | "attention-monitor-run-v0.2",
  codeCommitSha: string
): Record<string, unknown> & { runId: string } {
  const run = legacyRunFieldsFromEvaluation(evaluated);
  const {
    analysisId: _analysisId,
    sessionId: _sessionId,
    codeState: _codeState,
    codeFingerprintSha256: _codeFingerprintSha256,
    replayArtifactState: _replayArtifactState,
    replayArtifactSha256: _replayArtifactSha256,
    ...preExecutionLineage
  } = run;
  if (contract === "attention-monitor-run-v0.2") {
    return {
      ...preExecutionLineage,
      contract,
      codeCommitSha
    };
  }
  const {
    supportingSources: _supportingSources,
    workContext: _workContext,
    ...v01Fields
  } = preExecutionLineage;
  return {
    ...v01Fields,
    contract,
    codeCommitSha
  };
}

function legacyRunFieldsAt(asOf: string) {
  return legacyRunFieldsFromEvaluation(evaluatedAt(asOf));
}

function legacyRunFieldsFromEvaluation(
  evaluated: ReturnType<typeof evaluatedAt>
) {
  const result = evaluated.baseResult;
  const candidateCounts = {
    eligible: 0,
    provisional: 0,
    ineligible: 0
  };
  for (const assessment of result.candidateAssessments) {
    candidateCounts[assessment.disposition] += 1;
  }
  return {
    contract: "attention-monitor-run-v0.3" as const,
    runId: evaluated.run.runId,
    analysisId: evaluated.run.analysisId,
    sessionId: evaluated.run.sessionId,
    resultId: result.resultId,
    status: "completed" as const,
    asOf: result.asOf,
    startedAt: evaluated.run.startedAt,
    completedAt: evaluated.run.completedAt,
    codeCommitSha: evaluated.run.codeCommitSha,
    codeState: evaluated.run.codeState,
    codeFingerprintSha256: evaluated.run.codeFingerprintSha256,
    inputSha256: result.inputSha256,
    resultSha256: result.resultSha256,
    replayArtifactState: "available" as const,
    replayArtifactSha256: evaluated.run.replayArtifactSha256,
    orchestratorVersion: "attention-live-orchestrator-v0.2" as const,
    freshnessPolicyVersion:
      evaluated.run.freshnessPolicyVersion,
    freshnessPolicy: evaluated.run.freshnessPolicy,
    resultContract: result.contract,
    policyVersion: result.policyVersion,
    githubCandidateRuleVersion: result.githubCandidateRuleVersion,
    codexOverviewRuleVersion: result.codexOverviewRuleVersion,
    decisionStatus: result.decision.status,
    certainty: result.decision.certainty,
    topCandidateId:
      result.decision.topSuggestion?.candidateId ?? null,
    alternativeCount: result.decision.alternatives.length,
    candidateCounts,
    candidateAssessmentDetailState: "available" as const,
    candidateAssessments: result.candidateAssessments.map(
      (assessment) => ({
        assessmentId: assessment.assessmentId,
        taskKind: assessment.taskKind,
        disposition: assessment.disposition,
        candidateId: assessment.candidateId,
        gateReasonCodes: assessment.gateReasonCodes
      })
    ),
    codexExecutionCount: result.workCockpit.codexExecutions.length,
    coverageDisposition: result.coverage.disposition,
    decisionReasonCodes: result.decision.reasonCodes,
    caveatCodes: result.decision.caveatCodes,
    sources: evaluated.run.sources,
    supportingSources: evaluated.run.supportingSources,
    workContext: evaluated.run.workContext,
    latencyMs: evaluated.run.latencyMs,
    errors: evaluated.run.errors
  };
}

function legacyFailureFixture(
  current: ReturnType<typeof createAttentionFailureRecord>
) {
  if (current.contract !== "attention-monitor-failure-v0.3") {
    throw new TypeError("Expected a current failure fixture.");
  }
  const {
    candidateRuleVersion: _candidateRuleVersion,
    lanePolicyVersion: _lanePolicyVersion,
    rankingPolicyVersion: _rankingPolicyVersion,
    resolverVersion: _resolverVersion,
    idPolicyVersion: _idPolicyVersion,
    ...common
  } = current;
  return {
    ...common,
    contract: "attention-monitor-failure-v0.2" as const,
    engineVersion: "attention-live-orchestrator-v0.2" as const,
    inputSchemaVersion: "cross-source-attention-input-v0.3" as const,
    resultSchemaVersion: "cross-source-attention-result-v0.3" as const,
    policyVersion:
      "aggressive-evidence-bound-attention-policy-v0.2" as const,
    githubCandidateRuleVersion:
      "github-project-aware-candidate-rule-v0.2" as const,
    codexOverviewRuleVersion:
      "codex-historical-context-overview-rule-v0.3" as const
  };
}

function failureAt(seed: string, at: string) {
  return createAttentionFailureRecord({
    executionIds: {
      runId: `run_${seed.repeat(32)}`,
      analysisId: `analysis_${seed.repeat(32)}`,
      sessionId: `session_${seed.repeat(32)}`
    },
    startedAt: new Date(at),
    completedAt: new Date(at),
    stage: "source_sync",
    codeProvenance: unavailableCodeProvenanceFixture()
  });
}

function unavailableCodeProvenanceFixture() {
  return {
    codeCommitSha: null,
    codeState: "unavailable" as const,
    codeFingerprintSha256: null
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-attention-store-")
  );
  temporaryDirectories.push(directory);
  return directory;
}
