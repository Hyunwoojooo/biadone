import { describe, expect, it } from "vitest";

import type { AttentionMonitorRun } from "../src/attention/monitoringSchema";
import {
  resolveActiveAttention,
  type ActiveAttentionResult
} from "../src/attentionDecision";
import { runPhase2AttentionRouter } from "../src/crossSource/runAttentionRouter";
import type { CurrentFocusProjection } from "../src/currentFocus";
import {
  buildLauncherAttentionView,
  launcherAttentionProjectionSchema,
  launcherRecentWorkSummarySchema,
  projectAttentionForLauncher
} from "../src/launcher";
import type { WorkResumptionStatus } from "../src/resumption";
import {
  ACTIVE_FIXTURE_EXECUTION_ID,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

describe("launcher Attention projection", () => {
  it("projects only the top suggestion and a safe GitHub action", () => {
    const fixture = activeAttentionFixture({
      deadlineAt: "2026-08-02T04:00:00.000Z"
    });
    const result = resolveActiveAttention(fixture.input);

    const projection = projectAttentionForLauncher({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun(),
      resumption: resumption()
    });

    expect(projection).toMatchObject({
      contract: "blabase-launcher-attention-v2",
      resultId: result.resultId,
      decisionStatus: "suggested",
      decisionReasonCodes: result.decision.reasonCodes,
      candidateCounts: result.counts,
      sourceDiagnostics: [
        {
          source: "github",
          state: "available",
          signalCount: 2,
          candidateSetComplete: true,
          reasonCode: null
        },
        {
          source: "codex",
          state: "disconnected",
          signalCount: 0,
          candidateSetComplete: false,
          reasonCode: "CONNECTOR_DISCONNECTED"
        },
        {
          source: "notion",
          state: "disconnected",
          signalCount: 0,
          candidateSetComplete: null,
          reasonCode: "CONNECTOR_DISCONNECTED"
        },
        {
          source: "google_calendar",
          state: "disconnected",
          signalCount: 0,
          candidateSetComplete: null,
          reasonCode: "CONNECTOR_DISCONNECTED"
        }
      ],
      card: {
        candidateId: result.decision.topSuggestion?.candidateId,
        title: "Synthetic linked task",
        contextLabel: "synthetic/private #42",
        laneLabel: "지금 확인",
        primaryAction: {
          kind: "open_github",
          url: "https://github.com/synthetic/private/issues/42"
        }
      },
      unavailableSources: [
        "codex",
        "notion",
        "google_calendar"
      ],
      dashboardPath: "/"
    });
    expect(JSON.stringify(projection)).not.toContain("assessments");
    expect(JSON.stringify(projection)).not.toContain("replayArtifact");
    expect(JSON.stringify(projection)).not.toContain("alternatives");
  });

  it("enables focus_or_resume only for the exact online binding", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "failed"
    });
    const result = resolveActiveAttention(fixture.input);
    const suggestion = result.decision.topSuggestion;
    expect(suggestion?.triggerSource).toBe("codex_managed");
    const status = resumption({
      online: true,
      bindingId: suggestion?.bindingId ?? "",
      executionId: ACTIVE_FIXTURE_EXECUTION_ID,
      subjectId: suggestion?.githubSubjectId ?? ""
    });

    const view = buildLauncherAttentionView({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun(),
      resumption: status
    });

    expect(view.projection.card?.primaryAction).toEqual({
      kind: "focus_or_resume",
      enabled: true
    });
    expect(view.executionGuard).toEqual({
      kind: "focus_or_resume",
      enabled: true,
      expectedBindingId: suggestion?.bindingId,
      expectedExecutionId: ACTIVE_FIXTURE_EXECUTION_ID
    });

    const changed = projectAttentionForLauncher({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun(),
      resumption: resumption({
        online: true,
        bindingId: `binding_${"f".repeat(32)}`,
        executionId: ACTIVE_FIXTURE_EXECUTION_ID,
        subjectId: suggestion?.githubSubjectId ?? ""
      })
    });
    expect(changed.card?.primaryAction).toEqual({
      kind: "focus_or_resume",
      enabled: false
    });
  });

  it("projects scoped no-action without inventing a card", () => {
    const fixture = activeAttentionFixture({
      githubKind: "none",
      managedScenario: "none"
    });
    const result = resolveActiveAttention(fixture.input);
    const projection = projectAttentionForLauncher({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun({ githubUnavailable: false }),
      resumption: resumption()
    });

    expect(projection.decisionStatus).toBe("no_action");
    expect(projection.decisionReasonCodes).toEqual(
      result.decision.reasonCodes
    );
    expect(projection.candidateCounts).toEqual(result.counts);
    expect(projection.card).toBeNull();
    expect(projection.clarificationQuestion).toBeNull();
  });

  it("projects bounded display-only summaries without changing no-action", () => {
    const fixture = activeAttentionFixture({
      githubKind: "none",
      managedScenario: "none"
    });
    const result = resolveActiveAttention(fixture.input);
    const projection = projectAttentionForLauncher({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun(),
      resumption: resumption(),
      currentFocus: selectedCurrentFocus(),
      recentWorkSummary: {
        displayLabel: "Launcher contract repair",
        pushOccurredAt: "2026-08-02T02:58:30.000Z",
        trackingState: "ahead",
        aheadCount: 2,
        behindCount: 0,
        correlation: "repository_scope_only",
        presentation: "display_only",
        attentionSelectionEffect: "none",
        executionEffect: "none"
      }
    });

    expect(projection).toMatchObject({
      decisionStatus: "no_action",
      candidateCounts: { eligible: 0 },
      card: null,
      currentFocusSummary: {
        status: "selected",
        displayLabel: "Launcher contract repair",
        reasonCodes: ["FOCUS_LATEST_DIRECT_COMPLETE_EVENT"],
        attentionSelectionEffect: "none"
      },
      recentWorkSummary: {
        displayLabel: "Launcher contract repair",
        trackingState: "ahead",
        aheadCount: 2,
        behindCount: 0,
        correlation: "repository_scope_only",
        presentation: "display_only",
        attentionSelectionEffect: "none",
        executionEffect: "none"
      }
    });
    const serialized = JSON.stringify({
      currentFocusSummary: projection.currentFocusSummary,
      recentWorkSummary: projection.recentWorkSummary
    });
    expect(serialized).not.toContain("workstream_");
    expect(serialized).not.toContain("identityRefs");
    expect(serialized).not.toContain("latestMeaningfulEvent");
    expect(serialized).not.toContain("candidateId");
    expect(serialized).not.toContain("projectId");
    expect(serialized).not.toContain("repositoryId");
    expect(serialized).not.toContain("scopeId");
    expect(serialized).not.toContain("resultSha256");
    expect(Object.keys(projection.recentWorkSummary ?? {}).sort()).toEqual([
      "aheadCount",
      "attentionSelectionEffect",
      "behindCount",
      "correlation",
      "displayLabel",
      "executionEffect",
      "presentation",
      "pushOccurredAt",
      "trackingState"
    ]);
    const canonicalRecentWork =
      launcherRecentWorkSummarySchema.parse(
        projection.recentWorkSummary
      );
    expect(canonicalRecentWork.pushOccurredAt).toBe(
      "2026-08-02T02:58:30.000Z"
    );
    for (const pushOccurredAt of [
      "2026-08-02T02:58Z",
      "2026-08-02T02:58:30Z",
      "2026-08-02T02:58:30.0Z",
      "2026-08-02T02:58:30.0000Z",
      "2026-08-02T02:58:30.000+00:00"
    ]) {
      expect(() =>
        launcherRecentWorkSummarySchema.parse({
          ...canonicalRecentWork,
          pushOccurredAt
        })
      ).toThrow();
    }

    const {
      currentFocusSummary: _summary,
      recentWorkSummary: _recentWorkSummary,
      ...legacy
    } = projection;
    const parsedLegacy = launcherAttentionProjectionSchema.parse(legacy);
    expect(parsedLegacy.currentFocusSummary).toBeNull();
    expect(parsedLegacy.recentWorkSummary).toBeNull();
  });

  it("keeps source diagnostics canonical and bounded to monitor metadata", () => {
    const fixture = activeAttentionFixture();
    const result = resolveActiveAttention(fixture.input);
    const projection = projectAttentionForLauncher({
      result,
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun({
        githubFreshness: "stale",
        githubCandidateSetComplete: false,
        supportingAvailable: true
      }),
      resumption: resumption()
    });

    expect(projection.sourceDiagnostics).toEqual([
      {
        source: "github",
        state: "stale",
        signalCount: 2,
        candidateSetComplete: false,
        reasonCode: null
      },
      {
        source: "codex",
        state: "disconnected",
        signalCount: 0,
        candidateSetComplete: false,
        reasonCode: "CONNECTOR_DISCONNECTED"
      },
      {
        source: "notion",
        state: "unevaluated",
        signalCount: 3,
        candidateSetComplete: null,
        reasonCode: null
      },
      {
        source: "google_calendar",
        state: "unevaluated",
        signalCount: 2,
        candidateSetComplete: null,
        reasonCode: null
      }
    ]);
    expect(JSON.stringify(projection.sourceDiagnostics)).not.toContain(
      "snapshot"
    );
  });

  it("rejects diagnostic fields that disagree with the decision", () => {
    const fixture = activeAttentionFixture();
    const projection = projectAttentionForLauncher({
      result: resolveActiveAttention(fixture.input),
      baseResult: runPhase2AttentionRouter(
        fixture.input.baseAttentionInput
      ),
      run: monitorRun(),
      resumption: resumption()
    });

    expect(
      launcherAttentionProjectionSchema.safeParse({
        ...projection,
        decisionReasonCodes: ["DECISION_SCOPED_NO_ACTION"]
      }).success
    ).toBe(false);
    expect(
      launcherAttentionProjectionSchema.safeParse({
        ...projection,
        candidateCounts: {
          ...projection.candidateCounts,
          eligible: 0
        }
      }).success
    ).toBe(false);
    expect(
      launcherAttentionProjectionSchema.safeParse({
        ...projection,
        sourceDiagnostics: [
          projection.sourceDiagnostics[1],
          projection.sourceDiagnostics[0],
          projection.sourceDiagnostics[2],
          projection.sourceDiagnostics[3]
        ]
      }).success
    ).toBe(false);
  });

  it("rejects a destination outside the exact GitHub work-item URL", () => {
    const fixture = activeAttentionFixture();
    const result = resolveActiveAttention(fixture.input);
    const suggestion = result.decision.topSuggestion;
    const unsafe = {
      ...result,
      decision: {
        ...result.decision,
        topSuggestion: suggestion
          ? {
              ...suggestion,
              destinationUrl: "https://evil.example/steal"
            }
          : null
      }
    } as ActiveAttentionResult;

    expect(() =>
      projectAttentionForLauncher({
        result: unsafe,
        baseResult: runPhase2AttentionRouter(
          fixture.input.baseAttentionInput
        ),
        run: monitorRun(),
        resumption: resumption()
      })
    ).toThrow("UNSAFE_GITHUB_DESTINATION");
  });
});

function monitorRun(
  options: {
    githubUnavailable?: boolean;
    githubFreshness?: "fresh" | "stale" | "invalid";
    githubCandidateSetComplete?: boolean;
    supportingAvailable?: boolean;
  } = {}
): AttentionMonitorRun {
  const githubUnavailable = options.githubUnavailable === true;
  const supportingAvailable = options.supportingAvailable === true;
  return {
    sources: [
      {
        source: "github",
        inputState: githubUnavailable ? "disconnected" : "available",
        unavailableReason: githubUnavailable
          ? "CONNECTOR_DISCONNECTED"
          : null,
        freshness: githubUnavailable
          ? null
          : (options.githubFreshness ?? "fresh"),
        completeness: githubUnavailable ? null : "complete",
        candidateSetComplete: githubUnavailable
          ? false
          : (options.githubCandidateSetComplete ?? true),
        signalCount: githubUnavailable ? 0 : 2,
        skippedRecordCount: githubUnavailable ? 0 : 1
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
        inputState: supportingAvailable ? "available" : "unavailable",
        unavailableReason: supportingAvailable
          ? null
          : "CONNECTOR_DISCONNECTED",
        freshness: supportingAvailable ? "fresh" : null,
        itemCount: supportingAvailable ? 2 : 0,
        mappedItemCount: supportingAvailable ? 1 : 0
      },
      {
        source: "notion",
        inputState: supportingAvailable ? "available" : "unavailable",
        unavailableReason: supportingAvailable
          ? null
          : "CONNECTOR_DISCONNECTED",
        freshness: supportingAvailable ? "fresh" : null,
        itemCount: supportingAvailable ? 3 : 0,
        mappedItemCount: supportingAvailable ? 2 : 0
      }
    ]
  } as AttentionMonitorRun;
}

function resumption(
  input: {
    online?: boolean;
    bindingId?: string;
    executionId?: string;
    subjectId?: string;
  } = {}
): WorkResumptionStatus {
  return {
    companion: {
      state: input.online ? "online" : "offline",
      lastSeenAt: input.online
        ? "2026-08-02T03:00:00.000Z"
        : null
    },
    bindings:
      input.bindingId && input.executionId && input.subjectId
        ? [
            {
              bindingId: input.bindingId,
              taskRef: {
                kind: "attention_subject",
                source: "github",
                subjectId: input.subjectId
              },
              executionId: input.executionId,
              boundAt: "2026-08-02T02:48:00.000Z"
            }
          ]
        : []
  };
}

function selectedCurrentFocus(): CurrentFocusProjection {
  return {
    status: "selected",
    selectedFocus: {
      displayLabel: "Launcher contract repair"
    },
    reasonCodes: ["FOCUS_LATEST_DIRECT_COMPLETE_EVENT"],
    attentionSelectionEffect: "none"
  } as CurrentFocusProjection;
}
