import { describe, expect, it, vi } from "vitest";

import type {
  AttentionMonitorRun,
  AttentionReplayInputArtifact
} from "../src/attention/monitoringSchema";
import { resolveActiveAttention } from "../src/attentionDecision";
import { runPhase2AttentionRouter } from "../src/crossSource/runAttentionRouter";
import { createUnavailableCurrentFocusProjection } from "../src/currentFocus";
import {
  LauncherService,
  LauncherServiceError,
  launcherIpcRequestSchema,
  type LauncherAttentionEvaluation,
  type LauncherServiceDependencies
} from "../src/launcher";
import type {
  PublicWorkResumptionCommandStatus,
  WorkResumptionStatus
} from "../src/resumption";
import { activeAttentionFixture } from "./fixtures/activeAttentionFixture";

const DATA_ROOT = "/private/tmp/blabase-launcher-service-test";
const BINDING_ID = `binding_${"b".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"e".repeat(24)}`;
const COMMAND_ID = `command_${"c".repeat(32)}`;
const FIXED_NOW = new Date("2026-08-02T03:00:00.000Z");

describe("LauncherService", () => {
  it("refreshes with the explicit data root and records the run", async () => {
    const evaluated = evaluation();
    const syncSources = vi.fn(async () => syncResult());
    const evaluateAttention = vi.fn(async () => evaluated);
    const recordRun = vi.fn(async () => evaluated.run);
    const service = serviceWith({
      syncSources,
      evaluateAttention,
      recordRun
    });

    const result = await service.handle(
      request("attention.get", { refresh: true })
    );

    expect(result.contract).toBe("blabase-launcher-attention-v2");
    expect(result).toMatchObject({
      currentFocusSummary: {
        status: "unavailable",
        displayLabel: null,
        reasonCodes: ["FOCUS_PROJECTION_UNAVAILABLE"],
        attentionSelectionEffect: "none"
      },
      recentWorkSummary: {
        displayLabel: "Launcher recent work",
        trackingState: "in_sync",
        aheadCount: 0,
        behindCount: 0,
        correlation: "repository_scope_only",
        presentation: "display_only",
        attentionSelectionEffect: "none",
        executionEffect: "none"
      }
    });
    expect(syncSources).toHaveBeenCalledWith({
      cwd: DATA_ROOT,
      env: expect.any(Object)
    });
    expect(evaluateAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: DATA_ROOT,
        refreshSources: false,
        executionIds: {
          runId: `run_${"1".repeat(32)}`,
          analysisId: `analysis_${"2".repeat(32)}`,
          sessionId: `session_${"3".repeat(32)}`
        }
      })
    );
    expect(recordRun).toHaveBeenCalledWith(
      evaluated.run,
      evaluated.replayArtifact,
      DATA_ROOT,
      new Date(evaluated.run.completedAt)
    );
  });

  it("treats an overridden shared data root as read-only", async () => {
    const evaluated = evaluation();
    const syncSources = vi.fn(async () => syncResult());
    const evaluateAttention = vi.fn(async () => evaluated);
    const recordRun = vi.fn(async () => evaluated.run);
    const provenance = {
      codeCommitSha: "a".repeat(40),
      codeState: "declared_commit" as const,
      codeFingerprintSha256: null
    };
    const service = serviceWith(
      {
        syncSources,
        evaluateAttention,
        recordRun,
        resolveCodeProvenance: vi.fn(async () => provenance)
      },
      {
        NODE_ENV: "test",
        BLABASE_LAUNCHER_SOURCE_MODE: "read_only"
      }
    );

    await service.handle(
      request("attention.get", { refresh: true })
    );

    expect(syncSources).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
    expect(evaluateAttention).toHaveBeenCalledWith({
      cwd: DATA_ROOT,
      env: expect.objectContaining({
        BLABASE_LAUNCHER_SOURCE_MODE: "read_only"
      }),
      now: FIXED_NOW,
      refreshSources: false,
      codeProvenance: provenance
    });
  });

  it("returns a managed owner status with the persisted root revision", async () => {
    const rootId = `root_${"a".repeat(32)}`;
    const resolveRootMarker = vi.fn(async () => ({
      contract: "blabase-root-marker-v1" as const,
      rootId
    }));
    const readSyncRevision = vi.fn(
      async () => "pipeline:0123456789abcdef0123456789abcdef"
    );
    const service = serviceWith({
      resolveRootMarker,
      readSyncRevision
    });

    await expect(
      service.handle(request("status.get", {}))
    ).resolves.toEqual({
      contract: "blabase-launcher-status-v1",
      rootId,
      sourceMode: "managed",
      mutationAuthority: "launcher_agent",
      syncRevision: "pipeline:0123456789abcdef0123456789abcdef"
    });
    expect(resolveRootMarker).toHaveBeenCalledWith(DATA_ROOT, "owner");
    expect(readSyncRevision).toHaveBeenCalledWith(DATA_ROOT);
  });

  it("returns a non-mutating read-only status when no marker exists", async () => {
    const resolveRootMarker = vi.fn(async () => null);
    const readSyncRevision = vi.fn(async () => null);
    const service = serviceWith(
      { resolveRootMarker, readSyncRevision },
      {
        NODE_ENV: "test",
        BLABASE_LAUNCHER_SOURCE_MODE: "read_only"
      }
    );

    await expect(
      service.handle(request("status.get", {}))
    ).resolves.toEqual({
      contract: "blabase-launcher-status-v1",
      rootId: null,
      sourceMode: "read_only",
      mutationAuthority: "none",
      syncRevision: null
    });
    expect(resolveRootMarker).toHaveBeenCalledWith(
      DATA_ROOT,
      "read_only"
    );
    expect(readSyncRevision).toHaveBeenCalledWith(DATA_ROOT);
  });

  it("sanitizes root storage failures", async () => {
    const service = serviceWith({
      resolveRootMarker: vi.fn(async () => {
        throw new Error("private-root:/secret");
      }),
      readSyncRevision: vi.fn(async () => null)
    });

    const failure = await service
      .handle(request("status.get", {}))
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "ROOT_CONTEXT_FAILED"
    });
    expect(String(failure)).not.toMatch(/private-root|secret/);
  });

  it("revalidates top identity and exact binding before opening Codex", async () => {
    const evaluated = evaluation();
    const suggestion = evaluated.result.decision.topSuggestion;
    expect(suggestion).not.toBeNull();
    const status = onlineStatus(
      suggestion?.githubSubjectId ?? ""
    );
    const evaluateAttention = vi.fn(async () => evaluated);
    const readResumptionStatus = vi.fn(async () => status);
    const openSession = vi.fn(async () => command());
    const service = serviceWith({
      evaluateAttention,
      readResumptionStatus,
      openSession
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (projection.contract !== "blabase-launcher-attention-v2") {
      throw new Error("Expected launcher attention projection.");
    }
    expect(projection.card?.primaryAction).toEqual({
      kind: "focus_or_resume",
      enabled: true
    });

    const result = await service.handle(
      request("attention.execute", {
        resultId: projection.resultId,
        candidateId: projection.card?.candidateId,
        explicitUserAction: true
      })
    );

    expect(result).toEqual({
      contract: "blabase-launcher-execution-v1",
      kind: "focus_or_resume",
      commandId: COMMAND_ID,
      status: "pending"
    });
    expect(evaluateAttention).toHaveBeenLastCalledWith({
      cwd: DATA_ROOT,
      env: expect.any(Object),
      now: new Date(projection.asOf),
      refreshSources: false,
      codeProvenance: {
        codeCommitSha: null,
        codeState: "unavailable",
        codeFingerprintSha256: null
      }
    });
    expect(openSession).toHaveBeenCalledWith(
      {
        taskRef: {
          kind: "attention_subject",
          source: "github",
          subjectId: suggestion?.githubSubjectId,
          displayTitle: suggestion?.title
        },
        explicitUserAction: true,
        expectedBindingId: BINDING_ID,
        expectedExecutionId: EXECUTION_ID
      },
      DATA_ROOT,
      FIXED_NOW
    );
  });

  it("returns the existing command for a repeated explicit execution", async () => {
    const evaluated = evaluation();
    const suggestion = evaluated.result.decision.topSuggestion;
    const openSession = vi.fn(async () => command());
    const readCommandStatus = vi.fn(async () => ({
      ...command(),
      status: "claimed" as const
    }));
    const service = serviceWith({
      evaluateAttention: vi.fn(async () => evaluated),
      readResumptionStatus: vi.fn(async () =>
        onlineStatus(suggestion?.githubSubjectId ?? "")
      ),
      openSession,
      readCommandStatus
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (
      projection.contract !== "blabase-launcher-attention-v2" ||
      !projection.card
    ) {
      throw new Error("Expected recommendation.");
    }
    const executeRequest = request("attention.execute", {
      resultId: projection.resultId,
      candidateId: projection.card.candidateId,
      explicitUserAction: true
    });

    await service.handle(executeRequest);
    await expect(service.handle(executeRequest)).resolves.toEqual({
      contract: "blabase-launcher-execution-v1",
      kind: "focus_or_resume",
      commandId: COMMAND_ID,
      status: "claimed"
    });

    expect(openSession).toHaveBeenCalledTimes(1);
    expect(readCommandStatus).toHaveBeenCalledWith(
      COMMAND_ID,
      DATA_ROOT,
      FIXED_NOW
    );
  });

  it("refuses to execute a recommendation older than five minutes", async () => {
    let now = new Date(FIXED_NOW);
    const evaluated = evaluation();
    const suggestion = evaluated.result.decision.topSuggestion;
    const evaluateAttention = vi.fn(async () => evaluated);
    const openSession = vi.fn(async () => command());
    const service = serviceWith({
      now: () => new Date(now),
      evaluateAttention,
      readResumptionStatus: vi.fn(async () =>
        onlineStatus(suggestion?.githubSubjectId ?? "")
      ),
      openSession
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (
      projection.contract !== "blabase-launcher-attention-v2" ||
      !projection.card
    ) {
      throw new Error("Expected recommendation.");
    }
    now = new Date(FIXED_NOW.getTime() + 5 * 60 * 1_000 + 1);

    await expect(
      service.handle(
        request("attention.execute", {
          resultId: projection.resultId,
          candidateId: projection.card.candidateId,
          explicitUserAction: true
        })
      )
    ).rejects.toMatchObject({ code: "STALE_RECOMMENDATION" });
    expect(evaluateAttention).toHaveBeenCalledTimes(1);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("fails closed when the current top recommendation changes", async () => {
    const first = evaluation();
    const changed = evaluation({ noAction: true });
    const evaluateAttention = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(changed);
    const openSession = vi.fn(async () => command());
    const suggestion = first.result.decision.topSuggestion;
    const service = serviceWith({
      evaluateAttention,
      readResumptionStatus: vi.fn(async () =>
        onlineStatus(suggestion?.githubSubjectId ?? "")
      ),
      openSession
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (
      projection.contract !== "blabase-launcher-attention-v2" ||
      !projection.card
    ) {
      throw new Error("Expected recommendation.");
    }

    await expect(
      service.handle(
        request("attention.execute", {
          resultId: projection.resultId,
          candidateId: projection.card.candidateId,
          explicitUserAction: true
        })
      )
    ).rejects.toMatchObject({ code: "STALE_RECOMMENDATION" });
    expect(openSession).not.toHaveBeenCalled();
  });

  it("does not open a replacement binding that appeared after projection", async () => {
    const evaluated = evaluation();
    const suggestion = evaluated.result.decision.topSuggestion;
    const first = onlineStatus(suggestion?.githubSubjectId ?? "");
    const replacement = {
      ...first,
      bindings: [
        {
          ...first.bindings[0],
          bindingId: `binding_${"d".repeat(32)}`,
          executionId: `codex:execution:${"f".repeat(24)}`
        }
      ]
    } satisfies WorkResumptionStatus;
    const readResumptionStatus = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement);
    const openSession = vi.fn(async () => command());
    const service = serviceWith({
      evaluateAttention: vi.fn(async () => evaluated),
      readResumptionStatus,
      openSession
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (
      projection.contract !== "blabase-launcher-attention-v2" ||
      !projection.card
    ) {
      throw new Error("Expected recommendation.");
    }

    await expect(
      service.handle(
        request("attention.execute", {
          resultId: projection.resultId,
          candidateId: projection.card.candidateId,
          explicitUserAction: true
        })
      )
    ).rejects.toMatchObject({ code: "BINDING_IDENTITY_CHANGED" });
    expect(openSession).not.toHaveBeenCalled();
  });

  it("returns a bounded public command status with the explicit root", async () => {
    const readCommandStatus = vi.fn(async () => ({
      ...command(),
      status: "completed" as const,
      completedAt: "2026-08-02T03:00:02.000Z",
      resultCode: "FOCUSED_EXISTING" as const
    }));
    const service = serviceWith({ readCommandStatus });

    await expect(
      service.handle(
        request("command.get", { commandId: COMMAND_ID })
      )
    ).resolves.toEqual({
      contract: "blabase-launcher-execution-v1",
      kind: "focus_or_resume",
      commandId: COMMAND_ID,
      status: "completed"
    });
    expect(readCommandStatus).toHaveBeenCalledWith(
      COMMAND_ID,
      DATA_ROOT,
      FIXED_NOW
    );
  });

  it("requires a new get before executing a GitHub-only action", async () => {
    const evaluated = evaluation();
    const service = serviceWith({
      evaluateAttention: vi.fn(async () => evaluated),
      readResumptionStatus: vi.fn(async () => offlineStatus())
    });
    const projection = await service.handle(
      request("attention.get", { refresh: false })
    );
    if (
      projection.contract !== "blabase-launcher-attention-v2" ||
      !projection.card
    ) {
      throw new Error("Expected recommendation.");
    }
    expect(projection.card.primaryAction.kind).toBe("open_github");

    await expect(
      service.handle(
        request("attention.execute", {
          resultId: projection.resultId,
          candidateId: projection.card.candidateId,
          explicitUserAction: true
        })
      )
    ).rejects.toBeInstanceOf(LauncherServiceError);
  });
});

function serviceWith(
  overrides: Partial<LauncherServiceDependencies>,
  env: NodeJS.ProcessEnv = { NODE_ENV: "test" }
): LauncherService {
  const evaluated = evaluation();
  return new LauncherService(
    DATA_ROOT,
    env,
    {
      syncSources: vi.fn(async () => syncResult()),
      evaluateAttention: vi.fn(async () => evaluated),
      readResumptionStatus: vi.fn(async () => offlineStatus()),
      openSession: vi.fn(async () => command()),
      readCommandStatus: vi.fn(async () => command()),
      createExecutionIds: () => ({
        runId: `run_${"1".repeat(32)}`,
        analysisId: `analysis_${"2".repeat(32)}`,
        sessionId: `session_${"3".repeat(32)}`
      }),
      resolveCodeProvenance: vi.fn(async () => ({
        codeCommitSha: null,
        codeState: "unavailable" as const,
        codeFingerprintSha256: null
      })),
      recordRun: vi.fn(async (run) => run),
      recordFailure: vi.fn(async (failure) => failure),
      now: () => new Date(FIXED_NOW),
      warn: vi.fn(),
      ...overrides
    }
  );
}

function evaluation(
  options: { noAction?: boolean } = {}
): LauncherAttentionEvaluation {
  const fixture = activeAttentionFixture(
    options.noAction
      ? { githubKind: "none", managedScenario: "none" }
      : {}
  );
  return {
    result: resolveActiveAttention(fixture.input),
    baseResult: runPhase2AttentionRouter(
      fixture.input.baseAttentionInput
    ),
    run: {
      completedAt: "2026-08-02T03:00:00.000Z",
      sources: [
        {
          source: "github",
          inputState: "available",
          unavailableReason: null,
          freshness: "fresh",
          completeness: "complete",
          candidateSetComplete: true,
          signalCount: 1,
          skippedRecordCount: 0
        },
        {
          source: "codex",
          inputState: "disconnected",
          unavailableReason: "CONNECTOR_DISCONNECTED",
          freshness: null,
          completeness: null,
          candidateSetComplete: false,
          signalCount: 0,
          skippedRecordCount: 0
        }
      ],
      supportingSources: [
        {
          source: "google_calendar",
          inputState: "unavailable",
          unavailableReason: "CONNECTOR_DISCONNECTED",
          freshness: null,
          itemCount: 0,
          mappedItemCount: 0
        },
        {
          source: "notion",
          inputState: "unavailable",
          unavailableReason: "CONNECTOR_DISCONNECTED",
          freshness: null,
          itemCount: 0,
          mappedItemCount: 0
        }
      ]
    } as AttentionMonitorRun,
    replayArtifact: {} as AttentionReplayInputArtifact,
    currentFocus: createUnavailableCurrentFocusProjection({
      asOf: FIXED_NOW.toISOString()
    }),
    recentWorkPublicSummary: {
      displayLabel: "Launcher recent work",
      pushOccurredAt: "2026-08-02T02:58:30.000Z",
      trackingState: "in_sync",
      aheadCount: 0,
      behindCount: 0,
      correlation: "repository_scope_only",
      presentation: "display_only",
      attentionSelectionEffect: "none",
      executionEffect: "none"
    }
  };
}

function onlineStatus(subjectId: string): WorkResumptionStatus {
  return {
    companion: {
      state: "online",
      lastSeenAt: FIXED_NOW.toISOString()
    },
    bindings: [
      {
        bindingId: BINDING_ID,
        taskRef: {
          kind: "attention_subject",
          source: "github",
          subjectId
        },
        executionId: EXECUTION_ID,
        boundAt: "2026-08-02T02:50:00.000Z"
      }
    ]
  };
}

function offlineStatus(): WorkResumptionStatus {
  return {
    companion: { state: "offline", lastSeenAt: null },
    bindings: []
  };
}

function command(): PublicWorkResumptionCommandStatus {
  return {
    commandId: COMMAND_ID,
    bindingId: BINDING_ID,
    operation: "focus_or_resume",
    status: "pending",
    createdAt: "2026-08-02T03:00:00.000Z",
    expiresAt: "2026-08-02T03:00:30.000Z",
    completedAt: null,
    resultCode: null
  };
}

function request(
  method:
    | "attention.get"
    | "attention.execute"
    | "command.get"
    | "status.get",
  params: Record<string, unknown>
) {
  return launcherIpcRequestSchema.parse({
    contract: "blabase-launcher-ipc-v1",
    requestId: `request-${method.replace(".", "-")}`,
    method,
    params
  });
}

function syncResult() {
  return {
    status: "ready" as const,
    revision: "sync:test",
    generatedAt: FIXED_NOW.toISOString(),
    sources: [],
    adapterMode: "coordinator" as const
  };
}
