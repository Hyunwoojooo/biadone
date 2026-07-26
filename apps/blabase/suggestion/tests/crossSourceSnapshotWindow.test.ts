import { describe, expect, it } from "vitest";

import {
  buildCodexNativeObservationTimeline,
  buildRuntimeSnapshotWindow,
  type RuntimeSnapshotWindow
} from "../src/crossSource/buildSnapshotWindow";
import { finalizeRuntimeWorkSignalBatch } from "../src/crossSource/workSignalIntegrity";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import type {
  CodexActivityState,
  CodexAttentionState,
  CodexSnapshot
} from "../src/connectors/codex/types";
import type {
  FreshnessPolicy,
  RuntimeWorkSignalBatch
} from "../src/crossSource/schema";

const SCOPE_ID = "0123456789abcdef01234567";
const SESSION_ID = "89abcdef0123456789abcdef";

const freshnessPolicy = {
  version: "cross-source-window-test-freshness-v0.1",
  maxAgeMsBySource: {
    github: 24 * 60 * 60 * 1_000,
    codex: 24 * 60 * 60 * 1_000
  },
  maxFutureClockSkewMs: 60_000
} satisfies FreshnessPolicy;

const historyPolicy = {
  version: "cross-source-window-test-history-v0.1",
  minimumSnapshots: 2
};

describe("cross-source runtime snapshot window", () => {
  it("requires input to be strictly chronological", () => {
    const first = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "active"
      })
    );
    const second = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:05:00.000Z",
        activityState: "idle"
      })
    );

    expect(
      buildRuntimeSnapshotWindow([first, second], historyPolicy)
        .status
    ).toBe("ready");
    expect(
      buildRuntimeSnapshotWindow([second, first], historyPolicy)
    ).toEqual({
      status: "rejected",
      code: "NON_CHRONOLOGICAL_WINDOW"
    });

    const sameTimeDifferentSnapshot = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "system_error"
      })
    );
    expect(
      buildRuntimeSnapshotWindow(
        [first, sameTimeDifferentSnapshot],
        historyPolicy
      )
    ).toEqual({
      status: "rejected",
      code: "NON_CHRONOLOGICAL_WINDOW"
    });
  });

  it("rejects the same source snapshot appearing twice", () => {
    const batch = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "active"
      })
    );

    expect(
      buildRuntimeSnapshotWindow([batch, batch], historyPolicy)
    ).toEqual({
      status: "rejected",
      code: "DUPLICATE_SNAPSHOT"
    });
  });

  it("marks minimum history, version changes, and truncation as insufficient", () => {
    const first = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "active"
      })
    );
    const second = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:05:00.000Z",
        activityState: "idle"
      })
    );
    const sufficient = ready(
      buildRuntimeSnapshotWindow([first, second], historyPolicy)
    );
    expect(sufficient.historySufficiency).toBe("sufficient");
    expect(sufficient.reasonCodes).toEqual(["HISTORY_SUFFICIENT"]);

    const tooShort = ready(
      buildRuntimeSnapshotWindow([first], historyPolicy)
    );
    expect(tooShort.historySufficiency).toBe("insufficient");
    expect(tooShort.reasonCodes).toEqual(["HISTORY_TOO_SHORT"]);

    const { batchSha256: _batchSha256, ...secondDraft } = second;
    const changedVersion = finalizeRuntimeWorkSignalBatch({
      ...secondDraft,
      sourceSchemaVersion: "codex-snapshot-v2-test-revision"
    });
    const versionChanged = ready(
      buildRuntimeSnapshotWindow(
        [first, changedVersion],
        historyPolicy
      )
    );
    expect(versionChanged.historySufficiency).toBe("insufficient");
    expect(versionChanged.reasonCodes).toEqual([
      "HISTORY_VERSION_CHANGE"
    ]);

    const truncated = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:10:00.000Z",
        activityState: "idle",
        truncated: true
      })
    );
    const truncatedWindow = ready(
      buildRuntimeSnapshotWindow(
        [first, truncated],
        historyPolicy
      )
    );
    expect(truncatedWindow.historySufficiency).toBe(
      "insufficient"
    );
    expect(truncatedWindow.reasonCodes).toEqual([
      "HISTORY_TRUNCATED"
    ]);
  });

  it("produces deterministic window and timeline hashes while preserving execution identity", () => {
    const first = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "active",
        attentionState: "waiting_on_approval"
      })
    );
    const second = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:05:00.000Z",
        activityState: "idle"
      })
    );

    const windowA = ready(
      buildRuntimeSnapshotWindow([first, second], historyPolicy)
    );
    const windowB = ready(
      buildRuntimeSnapshotWindow([first, second], historyPolicy)
    );
    const timelineA =
      buildCodexNativeObservationTimeline(windowA);
    const timelineB =
      buildCodexNativeObservationTimeline(windowB);

    expect(windowA.windowSha256).toBe(windowB.windowSha256);
    expect(timelineA.timelineSha256).toBe(
      timelineB.timelineSha256
    );
    expect(timelineA).toEqual(timelineB);
    expect(() =>
      buildCodexNativeObservationTimeline({
        ...windowA,
        historySufficiency: "insufficient"
      })
    ).toThrow("integrity-verified Codex snapshot window");

    const observations = timelineA.executions[0]?.observations;
    expect(observations).toHaveLength(2);
    expect(observations?.[0]?.signalId).toBe(
      observations?.[1]?.signalId
    );
    expect(observations?.[0]?.observationId).not.toBe(
      observations?.[1]?.observationId
    );
  });

  it("does not synthesize completion, failure, or request lifecycle facts when a session disappears", () => {
    const present = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:00:00.000Z",
        activityState: "active",
        attentionState: "waiting_on_approval"
      })
    );
    const missing = normalize(
      codexSnapshot({
        fetchedAt: "2026-07-26T09:05:00.000Z",
        includeSession: false
      })
    );
    expect(missing.signals).toEqual([]);

    const timeline = buildCodexNativeObservationTimeline(
      ready(
        buildRuntimeSnapshotWindow(
          [present, missing],
          historyPolicy
        )
      )
    );
    expect(timeline.executionCount).toBe(1);
    expect(timeline.executions[0]?.observations).toHaveLength(1);

    const observation =
      timeline.executions[0]?.observations[0];
    expect(observation).toMatchObject({
      nativeActivityState: "active",
      semanticState: "unknown",
      nativeAttentionState: "waiting_on_approval",
      attentionSemanticRole: "overview_badge_only"
    });
    for (const forbiddenField of [
      "completionState",
      "completedAt",
      "failureState",
      "failedAt",
      "requestLifecycle",
      "requestState",
      "requestCreatedAt",
      "requestResolvedAt"
    ]) {
      expect(observation).not.toHaveProperty(forbiddenField);
    }
  });
});

function codexSnapshot({
  fetchedAt,
  activityState = "active",
  attentionState = null,
  truncated = false,
  includeSession = true
}: {
  fetchedAt: string;
  activityState?: CodexActivityState;
  attentionState?: CodexAttentionState;
  truncated?: boolean;
  includeSession?: boolean;
}): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v2",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli 0.145.0",
    fetchedAt,
    lookbackStart: "2026-06-26T00:00:00.000Z",
    truncated,
    scopeIds: [SCOPE_ID],
    sessions: includeSession
      ? [
          {
            id: SESSION_ID,
            source: "codex",
            kind: "coding_session",
            scopeId: SCOPE_ID,
            projectLabel: "blabase",
            taskSummary: null,
            taskSummarySource: null,
            createdAt: "2026-07-26T08:00:00.000Z",
            updatedAt: fetchedAt,
            activityState,
            attentionState
          }
        ]
      : []
  };
}

function normalize(
  snapshot: CodexSnapshot
): RuntimeWorkSignalBatch {
  const result = normalizeCodexSnapshotToWorkSignals(snapshot, {
    asOf: "2026-07-26T12:00:00.000Z",
    freshnessPolicy
  });
  expect(result.status).toBe("normalized");
  if (result.status !== "normalized") {
    throw new Error("Expected a normalized Codex snapshot.");
  }
  return result.batch;
}

function ready(
  result: ReturnType<typeof buildRuntimeSnapshotWindow>
): RuntimeSnapshotWindow {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`Expected a ready window, got ${result.code}.`);
  }
  return result.window;
}
