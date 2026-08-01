import { describe, expect, it } from "vitest";

import {
  observeCodexManagedNotification,
  type CodexManagedNotification
} from "../src/connectors/codex/observationContract";
import {
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
  createManagedCodexEvent,
  managedCodexPublicSourceEventSchema,
  sealManagedCodexHistory,
  type ManagedCodexEvent,
  type ManagedCodexEventHistory,
  type ManagedCodexPublicRunProjection
} from "../src/managedCodex/contracts";
import {
  CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT,
  buildManagedCodexSemanticProjection,
  buildManagedCodexSemanticRunResult,
  managedCodexSemanticProjectionSchema,
  managedCodexSemanticRunResultSchema
} from "../src/managedCodex/semanticTimeline";

const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const MANAGED_RUN_ID = `managed_run_${"a".repeat(32)}`;
const BINDING_ID = `binding_${"b".repeat(32)}`;
const PUBLIC_EXECUTION_ID = `codex:execution:${"c".repeat(24)}`;
const OPAQUE_EXECUTION_ID = "c".repeat(24);
const OWNER_ID = `instance_${"d".repeat(32)}`;
const OTHER_OWNER_ID = `instance_${"e".repeat(32)}`;
const STREAM_ID = `stream_${"f".repeat(32)}`;
const THREAD_ID = "native-thread-private-sentinel";

type EventSpec =
  | {
      kind: "stream";
      sourceEvent:
        | "stream_connected"
        | "stream_reconnected"
        | "stream_disconnected"
        | "run_failed"
        | "run_closed";
      offset?: number;
    }
  | {
      kind: "turn_started";
      offset?: number;
    }
  | {
      kind: "turn_completed";
      state: "completed" | "failed" | "interrupted";
      offset?: number;
    }
  | {
      kind: "thread";
      state: "active" | "idle" | "systemError" | "notLoaded";
      offset?: number;
    }
  | {
      kind: "item";
      phase: "started" | "completed";
      itemType: string;
      offset?: number;
    };

describe("managed Codex semantic timeline", () => {
  it("reports a completed turn as a direct fact but keeps progress and stall unknown", () => {
    const history = makeHistory([
      { kind: "stream", sourceEvent: "stream_connected" },
      { kind: "turn_started" },
      { kind: "item", phase: "completed", itemType: "fileChange" },
      { kind: "turn_completed", state: "completed" }
    ]);
    const result = build(history);

    expect(managedCodexSemanticRunResultSchema.parse(result)).toEqual(result);
    expect(result.timeline.entries.map((entry) => entry.kind)).toEqual([
      "stream_state_changed",
      "turn_started",
      "item_activity",
      "turn_completed"
    ]);
    expect(result.detector).toMatchObject({
      assessment: "turn_completed",
      latestTurnState: "completed",
      failureLifecycle: "not_observed_in_retained_window",
      meaningfulProgress: "unknown",
      meaningfulProgressReason: "TASK_OUTCOME_EVIDENCE_MISSING",
      stall: "not_evaluable",
      requestEscalation: "unsupported",
      attentionDisposition: "not_connected",
      forbiddenAsAttentionCandidate: true
    });
  });

  it.each([
    ["failed", "turn_failed", "latest_direct_turn_failure"],
    ["interrupted", "turn_interrupted", "not_observed_in_retained_window"]
  ] as const)(
    "distinguishes a directly observed %s turn",
    (state, assessment, failureLifecycle) => {
      const history = makeHistory([
        { kind: "stream", sourceEvent: "stream_connected" },
        { kind: "turn_started" },
        { kind: "turn_completed", state }
      ]);
      const result = build(history);
      expect(result.detector).toMatchObject({
        assessment,
        latestTurnState: state,
        failureLifecycle
      });
      expect(result.detector.latestTurnEvidence?.reasonCode).toBe(
        state === "failed"
          ? "CODEX_MANAGED_TURN_FAILED"
          : "CODEX_MANAGED_TURN_INTERRUPTED"
      );
    }
  );

  it("suppresses an earlier failed turn when a newer turn starts without claiming recovery", () => {
    const result = build(
      makeHistory([
        { kind: "stream", sourceEvent: "stream_connected" },
        { kind: "turn_started" },
        { kind: "turn_completed", state: "failed" },
        { kind: "turn_started" }
      ])
    );

    expect(result.detector).toMatchObject({
      assessment: "turn_running",
      latestTurnState: "running",
      failureLifecycle: "superseded_by_newer_turn"
    });
    expect(result.detector.failureEvidence?.reasonCode).toBe(
      "CODEX_MANAGED_TURN_FAILED"
    );
    expect(JSON.stringify(result).toLowerCase()).not.toContain("recover");
  });

  it("distinguishes managed run failure from a failed turn", () => {
    const history = makeHistory([
      { kind: "stream", sourceEvent: "stream_connected" },
      { kind: "stream", sourceEvent: "run_failed" }
    ]);
    const result = build(history, {
      lifecycle: "failed",
      streamState: "closed",
      liveObservationAvailable: false,
      effectiveExecutionState: "unknown"
    });

    expect(result.detector).toMatchObject({
      assessment: "managed_run_failed",
      latestTurnState: "not_observed",
      failureLifecycle: "latest_direct_managed_run_failure"
    });
    expect(result.detector.failureEvidence?.sourceEvent).toBe("run_failed");
  });

  it("fails closed after reconnect and when the retained history has an anchor", () => {
    const gapHistory = makeHistory([
      { kind: "stream", sourceEvent: "stream_connected" },
      { kind: "stream", sourceEvent: "stream_disconnected" },
      { kind: "stream", sourceEvent: "stream_reconnected" }
    ]);
    const gap = build(gapHistory, {
      continuity: "gap_detected",
      effectiveExecutionState: "unknown"
    });
    expect(gap.detector.assessment).toBe("observation_gap");
    expect(gap.detector.latestTurnState).toBe("not_observed");

    const anchoredHistory = makeHistory(
      [{ kind: "turn_completed", state: "completed" }],
      { anchored: true }
    );
    const anchored = build(anchoredHistory);
    expect(anchored.window.historyCompleteness).toBe("prefix_pruned");
    expect(anchored.detector.assessment).toBe("insufficient_evidence");
    expect(anchored.detector.latestTurnState).toBe("unknown");
  });

  it("keeps systemError as direct thread evidence without calling it a run failure", () => {
    const result = build(
      makeHistory([
        { kind: "stream", sourceEvent: "stream_connected" },
        { kind: "thread", state: "systemError" }
      ])
    );
    expect(result.timeline.entries.at(-1)).toMatchObject({
      kind: "thread_state_observed",
      evidence: {
        executionState: "unknown",
        reasonCode: "CODEX_MANAGED_THREAD_SYSTEM_ERROR"
      }
    });
    expect(result.detector.failureLifecycle).toBe(
      "not_observed_in_retained_window"
    );
  });

  it("uses sequence order when clocks regress and bounds the public timeline", () => {
    const specs: EventSpec[] = Array.from(
      { length: CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT + 3 },
      (_, index) => ({
        kind: "stream" as const,
        sourceEvent: "stream_connected" as const,
        offset: index === 1 ? -1 : index
      })
    );
    const result = build(makeHistory(specs));

    expect(result.window.clockQuality).toBe("regressed");
    expect(result.window.totalEvidenceCount).toBe(
      CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT + 3
    );
    expect(result.window.omittedEvidenceCount).toBe(3);
    expect(result.window.evidence).toHaveLength(
      CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT
    );
    expect(result.timeline.entries).toHaveLength(
      CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT
    );
    expect(result.timeline.omittedEntryCount).toBe(3);
    expect(result.timeline.entries.map((entry) => entry.evidence.sequence)).toEqual(
      Array.from(
        { length: CODEX_MANAGED_PUBLIC_TIMELINE_LIMIT },
        (_, index) => index + 3
      )
    );
  });

  it("hashes only canonical sanitized input and omits private event identities", () => {
    const specs: EventSpec[] = [
      { kind: "stream", sourceEvent: "stream_connected" },
      { kind: "turn_started" },
      { kind: "turn_completed", state: "completed" }
    ];
    const first = build(makeHistory(specs, { ownerInstanceId: OWNER_ID }));
    const second = build(
      makeHistory(specs, { ownerInstanceId: OTHER_OWNER_ID })
    );

    expect(first.window.inputSha256).toBe(second.window.inputSha256);
    expect(first.resultSha256).toBe(second.resultSha256);
    const serialized = JSON.stringify(first);
    for (const privateName of [
      "ownerInstanceId",
      "streamGeneration",
      "previousEventSha256",
      "eventSha256",
      "storeSha256",
      "scopeId",
      THREAD_ID
    ]) {
      expect(serialized).not.toContain(privateName);
    }
  });

  it("builds a deterministic projection keyed by managed run ID", () => {
    const history = makeHistory([
      { kind: "stream", sourceEvent: "stream_connected" }
    ]);
    const projection = buildManagedCodexSemanticProjection({
      sourceRevision: 7,
      generatedAt: iso(100),
      runs: [{ run: publicRun(history), history }]
    });
    expect(managedCodexSemanticProjectionSchema.parse(projection)).toEqual(
      projection
    );
    expect(Object.keys(projection.runs)).toEqual([MANAGED_RUN_ID]);
    expect(projection).toEqual(
      buildManagedCodexSemanticProjection({
        sourceRevision: 7,
        generatedAt: iso(100),
        runs: [{ run: publicRun(history), history }]
      })
    );

    const tampered = structuredClone(projection);
    tampered.runs[MANAGED_RUN_ID]!.detector.assessment = "turn_failed";
    expect(() =>
      managedCodexSemanticProjectionSchema.parse(tampered)
    ).toThrow(/hash|incoherent/i);
  });
});

function build(
  history: ManagedCodexEventHistory,
  overrides: Partial<ManagedCodexPublicRunProjection> = {}
) {
  return buildManagedCodexSemanticRunResult({
    sourceRevision: 7,
    generatedAt: iso(100),
    run: publicRun(history, overrides),
    history
  });
}

function publicRun(
  history: ManagedCodexEventHistory,
  overrides: Partial<ManagedCodexPublicRunProjection> = {}
): ManagedCodexPublicRunProjection {
  const last = history.events.at(-1);
  const sourceEvent = managedCodexPublicSourceEventSchema.parse(
    last?.observation?.sourceEvent ?? last?.streamKind ?? "run_started"
  );
  const executionState = last?.observation?.executionState ?? "unknown";
  const terminal = sourceEvent === "run_failed" || sourceEvent === "run_closed";
  return {
    managedRunId: MANAGED_RUN_ID,
    bindingId: BINDING_ID,
    executionId: PUBLIC_EXECUTION_ID,
    lifecycle: sourceEvent === "run_failed" ? "failed" : terminal ? "ended" : "observing",
    streamState: terminal
      ? "closed"
      : sourceEvent === "stream_disconnected"
        ? "disconnected"
        : "connected",
    continuity: "continuous",
    effectiveExecutionState: executionState,
    lastVerifiedExecutionState: executionState,
    waitingState: last?.observation?.waitingState ?? null,
    sourceEvent,
    itemType: last?.itemType ?? null,
    lastObservedAt: last?.observedAt ?? iso(0),
    liveObservationAvailable: !terminal && sourceEvent !== "stream_disconnected",
    forbiddenAsAttentionCandidate: true,
    ...overrides
  };
}

function makeHistory(
  specs: EventSpec[],
  options: { anchored?: boolean; ownerInstanceId?: string } = {}
): ManagedCodexEventHistory {
  const anchored = options.anchored ?? false;
  const startSequence = anchored ? 4 : 0;
  let previousEventSha256: string | null = anchored ? "9".repeat(64) : null;
  const events: ManagedCodexEvent[] = specs.map((spec, index) => {
    const sequence = startSequence + index;
    const observedAt = iso((spec.offset ?? index) * 1_000);
    const observation = nativeObservation(spec, sequence, observedAt);
    const event = createManagedCodexEvent({
      managedRunId: MANAGED_RUN_ID,
      sequence,
      ownerInstanceId: options.ownerInstanceId ?? OWNER_ID,
      streamGeneration: STREAM_ID,
      observedAt,
      retentionAt: iso(index * 1_000),
      kind: spec.kind === "stream" ? "stream_lifecycle" : "native_notification",
      streamKind: spec.kind === "stream" ? spec.sourceEvent : null,
      observation,
      itemType: spec.kind === "item" ? normalizeItemType(spec.itemType) : null,
      previousEventSha256
    });
    previousEventSha256 = event.eventSha256;
    return event;
  });
  return sealManagedCodexHistory({
    contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    managedRunId: MANAGED_RUN_ID,
    updatedAt: iso(Math.max(0, specs.length - 1) * 1_000),
    anchor: anchored
      ? {
          prunedThroughSequence: startSequence - 1,
          prunedThroughEventSha256: "9".repeat(64),
          anchoredAt: iso(0)
        }
      : null,
    events
  });
}

function nativeObservation(
  spec: EventSpec,
  sequence: number,
  observedAt: string
) {
  if (spec.kind === "stream") return null;
  let notification: CodexManagedNotification;
  if (spec.kind === "turn_started") {
    notification = {
      method: "turn/started",
      params: { threadId: THREAD_ID, turn: { id: `turn-${sequence}`, status: "inProgress" } }
    };
  } else if (spec.kind === "turn_completed") {
    notification = {
      method: "turn/completed",
      params: { threadId: THREAD_ID, turn: { id: `turn-${sequence}`, status: spec.state } }
    };
  } else if (spec.kind === "thread") {
    notification = {
      method: "thread/status/changed",
      params: {
        threadId: THREAD_ID,
        status:
          spec.state === "active"
            ? { type: "active", activeFlags: [] }
            : { type: spec.state }
      }
    };
  } else {
    notification = {
      method: `item/${spec.phase}`,
      params: {
        threadId: THREAD_ID,
        turnId: `turn-${sequence}`,
        item: { id: `item-${sequence}`, type: spec.itemType }
      }
    };
  }
  return observeCodexManagedNotification({
    notification,
    executionId: OPAQUE_EXECUTION_ID,
    expectedThreadId: THREAD_ID,
    observedAt,
    sequence
  });
}

function normalizeItemType(value: string) {
  return value === "fileChange" ? ("file_change" as const) : ("other" as const);
}

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}
