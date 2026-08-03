import { describe, expect, it } from "vitest";

import type { AttentionMonitorRun } from "../src/attention/monitoringSchema";
import {
  resolveActiveAttention,
  type ActiveAttentionResult
} from "../src/attentionDecision";
import { runPhase2AttentionRouter } from "../src/crossSource/runAttentionRouter";
import {
  buildLauncherAttentionView,
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
      contract: "blabase-launcher-attention-v1",
      resultId: result.resultId,
      decisionStatus: "suggested",
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
    expect(projection.card).toBeNull();
    expect(projection.clarificationQuestion).toBeNull();
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
  options: { githubUnavailable?: boolean } = {}
): AttentionMonitorRun {
  return {
    sources: [
      {
        source: "github",
        inputState:
          options.githubUnavailable === true
            ? "disconnected"
            : "available",
        freshness:
          options.githubUnavailable === true ? null : "fresh"
      },
      {
        source: "codex",
        inputState: "disconnected",
        freshness: null
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
