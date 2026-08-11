import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { CodexSnapshot } from "../src/connectors/codex/types";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import type {
  GitHubSnapshot,
  GitHubTaskSignal
} from "../src/connectors/github/types";
import {
  evaluateCurrentAttention,
  evaluateAttentionSnapshots,
  LIVE_ATTENTION_FRESHNESS_POLICY
} from "../src/attention/liveAttention";
import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { verifyActiveAttentionResultIntegrity } from "../src/attentionDecision";
import { createEmptyWorkContextRegistry } from "../src/context";
import { verifyPhase2AttentionResultIntegrity } from "../src/crossSource/runAttentionRouter";

const AS_OF = "2026-07-26T12:00:00.000Z";
const SCOPE_ID = "111111111111111111111111";
const execFileAsync = promisify(execFile);

describe("live Attention orchestration", () => {
  it("keeps Active and replay hashes byte-identical across Recent Work rollout modes", () => {
    const input = {
      github: {
        status: "available" as const,
        snapshot: githubSnapshot({ tasks: [githubTask()] })
      },
      codex: {
        status: "available" as const,
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    };
    const shadow = evaluateAttentionSnapshots({
      ...input,
      recentWorkPresentationMode: "shadow"
    });
    const present = evaluateAttentionSnapshots({
      ...input,
      recentWorkPresentationMode: "present"
    });
    expect(present.result).toEqual(shadow.result);
    expect(present.result.inputSha256).toBe(shadow.result.inputSha256);
    expect(present.result.resultSha256).toBe(shadow.result.resultSha256);
    expect(present.replayArtifact.input).toEqual(shadow.replayArtifact.input);
    expect(present.recentWork).toEqual(shadow.recentWork);
  });

  it("normalizes fresh native snapshots into a suggestion and metadata-only run record", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "available",
        snapshot: githubSnapshot({
          tasks: [
            githubTask({
              title: "Private launch checklist",
              htmlUrl: "https://github.com/acme/app/issues/11"
            })
          ]
        })
      },
      codex: {
        status: "available",
        snapshot: codexSnapshot({
          sessions: [
            codexSession({
              projectLabel: "private-project",
              taskSummary: "Private Codex summary",
              taskSummarySource: "thread_name"
            })
          ]
        })
      },
      asOf: AS_OF,
      codeCommitSha: "a".repeat(40),
      latencyMs: 17
    });

    expect(evaluated.result.decision).toMatchObject({
      status: "suggested",
      topSuggestion: {
        title: "Private launch checklist",
        intervention: "do"
      }
    });
    expect(evaluated.run).toMatchObject({
      status: "completed",
      codeCommitSha: "a".repeat(40),
      codeState: "declared_commit",
      codeFingerprintSha256: null,
      replayArtifactState: "available",
      decisionStatus: "suggested",
      candidateCounts: {
        eligible: 1,
        reviewRequired: 0,
        ineligible: 0
      },
      candidateAssessments: [
        {
          triggerSource: "github",
          triggerKind: "github_work_item",
          status: "eligible",
          reviewRoute: "none",
          reasonCodes: ["ELIGIBLE_GITHUB_DIRECT_WORK"]
        }
      ],
      latencyMs: 17,
      freshnessPolicy: {
        githubMaxAgeMs:
          LIVE_ATTENTION_FRESHNESS_POLICY.maxAgeMsBySource.github,
        codexMaxAgeMs:
          LIVE_ATTENTION_FRESHNESS_POLICY.maxAgeMsBySource.codex,
        maxFutureClockSkewMs: 60_000
      }
    });
    expect(
      Date.parse(evaluated.run.completedAt) -
        Date.parse(evaluated.run.startedAt)
    ).toBe(17);
    expect(verifyActiveAttentionResultIntegrity(evaluated.result)).toBe(
      true
    );
    expect(
      verifyPhase2AttentionResultIntegrity(evaluated.baseResult)
    ).toBe(true);
    expect(evaluated.eligibilityProjection.projectionSha256).toBe(
      evaluated.result.dependencies.eligibilityProjectionSha256
    );
    expect(evaluated.developerSignals.publicSummary).toMatchObject({
      contract: "developer-runtime-public-summary-v0.1",
      runId: evaluated.run.runId,
      analysisId: evaluated.run.analysisId,
      resultId: evaluated.result.resultId,
      entityCounts: {
        workItems: 1
      },
      stageSummaries: expect.arrayContaining([
        expect.objectContaining({
          stage: "selected",
          outcomeCounts: expect.objectContaining({ selected: 1 })
        })
      ])
    });

    const serializedRun = JSON.stringify(evaluated.run);
    expect(serializedRun).not.toContain("Private launch checklist");
    expect(serializedRun).not.toContain(
      "github.com/acme/app/issues/11"
    );
    expect(serializedRun).not.toContain("private-project");
    expect(serializedRun).not.toContain("Private Codex summary");
    const serializedDeveloperSummary = JSON.stringify(
      evaluated.developerSignals.publicSummary
    );
    expect(serializedDeveloperSummary).not.toContain(
      "Private launch checklist"
    );
    expect(serializedDeveloperSummary).not.toContain("private-project");
    expect(serializedDeveloperSummary).not.toContain(
      "Private Codex summary"
    );
    expect(evaluated.run.analysisId).toMatch(
      /^analysis_[a-f0-9]{32}$/
    );
    expect(evaluated.run.sessionId).toBe(
      `session_${evaluated.result.inputSha256.slice(0, 32)}`
    );
    expect(evaluated.replayArtifact).toMatchObject({
      runId: evaluated.run.runId,
      analysisId: evaluated.run.analysisId,
      sessionId: evaluated.run.sessionId,
      inputSha256: evaluated.run.inputSha256,
      privacyClass: "private_local_engine_input",
      retentionDays: 30
    });
  });

  it("keeps an over-TTL GitHub snapshot out of current suggestions", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "available",
        snapshot: githubSnapshot({
          fetchedAt: "2026-07-26T11:29:59.999Z",
          tasks: [
            githubTask({
              updatedAt: "2026-07-26T11:29:00.000Z"
            })
          ]
        })
      },
      codex: {
        status: "available",
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    });

    expect(evaluated.result.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(evaluated.result.decision.topSuggestion).toBeNull();
    expect(evaluated.run.sources[0]).toMatchObject({
      source: "github",
      inputState: "available",
      freshness: "stale"
    });
    expect(evaluated.recentMeaningfulEvents).not.toBeNull();
    expect(evaluated.currentWorkstreams).not.toBeNull();
    expect(evaluated.currentFocus.attentionSelectionEffect).toBe("none");
    expect(evaluated.focusAwareAttentionShadow).toMatchObject({
      existingTopCandidateId: null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false,
      attentionSelectionEffect: "none"
    });
  });

  it("keeps partial source events out of selected Current Focus", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "available",
        snapshot: githubSnapshot({
          truncated: true,
          activitiesState: "partial",
          activitiesTruncated: true,
          tasks: [githubTask()],
          activities: [githubIssueActivity()]
        })
      },
      codex: {
        status: "available",
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    });

    expect(evaluated.recentMeaningfulEvents?.coverage.github).toBe(
      "partial"
    );
    expect(evaluated.currentFocus.status).toBe("unresolved");
    expect(evaluated.focusAwareAttentionShadow).toMatchObject({
      status: "not_applied",
      existingTopCandidateId:
        evaluated.result.decision.topSuggestion?.candidateId ?? null,
      counterfactualTopCandidateId:
        evaluated.result.decision.topSuggestion?.candidateId ?? null,
      wouldSwitch: false,
      attentionSelectionEffect: "none"
    });
  });

  it("fails a mismatched Focus graph closed without changing Active Attention", () => {
    const snapshots = {
      github: {
        status: "available" as const,
        snapshot: githubSnapshot({
          tasks: [githubTask()],
          activities: [githubIssueActivity()]
        })
      },
      codex: {
        status: "available" as const,
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    };
    const baseline = evaluateAttentionSnapshots(snapshots);
    expect(baseline.recentMeaningfulEvents?.events).toHaveLength(2);
    expect(
      baseline.currentWorkstreams?.workstreams.length
    ).toBeGreaterThan(0);
    expect(baseline.currentFocus.status).toBe("selected");
    const activeInput = baseline.replayArtifact.input;

    const mismatched = evaluateAttentionSnapshots({
      ...snapshots,
      currentWorkEvidence: {
        asOf: AS_OF,
        githubBatch: activeInput.githubBatch,
        managedProjection: activeInput.managedPublicProjection,
        managedSemantics: activeInput.managedSemanticProjection,
        managedRunStartedAtById:
          activeInput.managedRunStartedAtById,
        workRelations: activeInput.workRelationProjection,
        artifacts: activeInput.artifactRelationProjection,
        claims: activeInput.claimAuthorityProjection,
        contextRegistry: createEmptyWorkContextRegistry(AS_OF)
      }
    });

    expect(mismatched.result).toEqual(baseline.result);
    expect(mismatched.result.resultSha256).toBe(
      baseline.result.resultSha256
    );
    expect(mismatched.recentMeaningfulEvents).toBeNull();
    expect(mismatched.currentWorkstreams).toBeNull();
    expect(mismatched.currentFocus).toMatchObject({
      status: "unavailable",
      reasonCodes: ["FOCUS_DEPENDENCY_MISMATCH"],
      attentionSelectionEffect: "none"
    });
    expect(mismatched.focusAwareAttentionShadow).toMatchObject({
      status: "unavailable",
      existingTopCandidateId:
        baseline.result.decision.topSuggestion?.candidateId ?? null,
      counterfactualTopCandidateId:
        baseline.result.decision.topSuggestion?.candidateId ?? null,
      wouldSwitch: false,
      attentionSelectionEffect: "none"
    });
  });

  it("does not claim no_action before a GitHub repository scope exists", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "available",
        snapshot: githubSnapshot({
          installations: [],
          repositories: [],
          tasks: []
        })
      },
      codex: {
        status: "available",
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    });

    expect(evaluated.result.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(evaluated.run.sources[0]).toMatchObject({
      source: "github",
      inputState: "disconnected",
      unavailableReason: "CONNECTOR_DISCONNECTED"
    });
  });

  it("reports disconnected candidate coverage while preserving Codex overview", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      codex: {
        status: "available",
        snapshot: codexSnapshot()
      },
      asOf: AS_OF
    });

    expect(evaluated.result.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(evaluated.baseResult.workCockpit.codexExecutions).toHaveLength(
      1
    );
    expect(evaluated.run.errors).toEqual([
      {
        source: "github",
        code: "CONNECTOR_DISCONNECTED"
      }
    ]);
  });

  it("creates a new run ID for each execution while preserving a deterministic result", () => {
    const input = {
      github: {
        status: "unavailable" as const,
        reason: "CONNECTOR_DISCONNECTED" as const
      },
      codex: {
        status: "unavailable" as const,
        reason: "CONNECTOR_DISCONNECTED" as const
      },
      asOf: AS_OF
    };
    const first = evaluateAttentionSnapshots(input);
    const second = evaluateAttentionSnapshots(input);

    expect(first.result).toEqual(second.result);
    expect(first.run.resultId).toBe(second.run.resultId);
    expect(first.run.runId).not.toBe(second.run.runId);
  });

  it("samples completion only after resolving the decision and records an exact interval", () => {
    let completionClockCalled = false;
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      codex: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      asOf: AS_OF,
      startedAt: AS_OF,
      completionClock: () => {
        completionClockCalled = true;
        return Date.parse(AS_OF) + 31;
      }
    });

    expect(completionClockCalled).toBe(true);
    expect(evaluated.run.completedAt).toBe(
      "2026-07-26T12:00:00.031Z"
    );
    expect(evaluated.run.latencyMs).toBe(31);
  });

  it("uses execution IDs allocated before source collection for run and replay lineage", () => {
    const executionIds = {
      runId: `run_${"1".repeat(32)}`,
      analysisId: `analysis_${"2".repeat(32)}`,
      sessionId: `session_${"3".repeat(32)}`
    };
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      codex: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      asOf: AS_OF,
      executionIds
    });

    expect(evaluated.run).toMatchObject(executionIds);
    expect(evaluated.replayArtifact).toMatchObject(executionIds);
  });

  it("records a clean commit or a deterministic dirty-worktree fingerprint", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "blabase-attention-code-")
    );
    try {
      await execFileAsync("git", ["init", "--quiet"], { cwd });
      await writeFile(join(cwd, "engine.ts"), "export const value = 1;\n");
      await execFileAsync("git", ["add", "engine.ts"], { cwd });
      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=Blabase Test",
          "-c",
          "user.email=blabase-test@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture"
        ],
        { cwd }
      );

      const clean = await evaluateCurrentAttention({
        cwd,
        now: new Date(AS_OF),
        env: {} as NodeJS.ProcessEnv
      });
      expect(clean.run).toMatchObject({
        codeState: "clean_commit",
        codeFingerprintSha256: null
      });
      expect(clean.run.codeCommitSha).toMatch(/^[a-f0-9]{40}$/);

      await writeFile(
        join(cwd, "engine.ts"),
        "export const value = 2;\n"
      );
      const firstDirty = await evaluateCurrentAttention({
        cwd,
        now: new Date(AS_OF),
        env: {} as NodeJS.ProcessEnv
      });
      const secondDirty = await evaluateCurrentAttention({
        cwd,
        now: new Date(AS_OF),
        env: {} as NodeJS.ProcessEnv
      });

      expect(firstDirty.run).toMatchObject({
        codeCommitSha: null,
        codeState: "dirty_worktree"
      });
      expect(firstDirty.run.codeFingerprintSha256).toMatch(
        /^[a-f0-9]{64}$/
      );
      expect(firstDirty.run.codeFingerprintSha256).toBe(
        secondDirty.run.codeFingerprintSha256
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("accepts a packaged launcher fingerprint as declared provenance", async () => {
    const fingerprint = "b".repeat(64);

    await expect(
      resolveAttentionCodeProvenance("/private/tmp", {
        NODE_ENV: "test",
        BLABASE_CODE_FINGERPRINT_SHA256: fingerprint,
        GITHUB_SHA: "c".repeat(40)
      })
    ).resolves.toEqual({
      codeCommitSha: null,
      codeState: "dirty_worktree",
      codeFingerprintSha256: fingerprint
    });
  });

  it("records supporting-source and work-context provenance without raw titles", () => {
    const evaluated = evaluateAttentionSnapshots({
      github: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      codex: {
        status: "unavailable",
        reason: "CONNECTOR_DISCONNECTED"
      },
      googleCalendar: {
        status: "available",
        snapshot: {
          schemaVersion: "google-calendar-snapshot-v1",
          fetchedAt: "2026-07-26T11:59:00.000Z",
          timeMin: "2026-07-20T12:00:00.000Z",
          timeMax: "2026-08-10T12:00:00.000Z",
          events: [
            {
              id: "calendar-event-private",
              source: "google_calendar",
              kind: "calendar_event",
              title: "Private calendar title",
              status: "confirmed",
              startAt: "2026-07-26T13:00:00.000Z",
              endAt: "2026-07-26T14:00:00.000Z",
              allDay: false,
              recurringEventId: null,
              eventType: "default",
              updatedAt: "2026-07-26T11:00:00.000Z"
            }
          ]
        }
      },
      notion: {
        status: "available",
        snapshot: {
          schemaVersion: "notion-snapshot-v1",
          apiVersion: "2026-03-11",
          fetchedAt: "2026-07-26T11:59:00.000Z",
          workspaceId: "workspace-private",
          workspaceName: "Private workspace",
          truncated: false,
          resources: [
            {
              id: "notion-resource-private",
              source: "notion",
              kind: "page",
              title: "Private Notion title",
              createdAt: "2026-07-20T00:00:00.000Z",
              lastEditedAt: "2026-07-26T11:00:00.000Z"
            }
          ]
        }
      },
      contextProvenance: {
        contract: "resolved-work-context-v1",
        registrySha256: "1".repeat(64),
        resolutionSha256: "2".repeat(64),
        weeklyOutcomeStoreSha256: "3".repeat(64),
        weeklyOutcomeStatus: "active",
        projectResolution: "resolved",
        focusState: "active"
      },
      focus: {
        primaryOutcome: "Private weekly outcome",
        capturedAt: "2026-07-20T12:00:00.000Z",
        validUntil: "2026-07-27T12:00:00.000Z"
      },
      asOf: AS_OF
    });

    expect(evaluated.run.supportingSources).toMatchObject([
      {
        source: "google_calendar",
        inputState: "available",
        itemCount: 1,
        mappedItemCount: 0,
        truncated: false
      },
      {
        source: "notion",
        inputState: "available",
        itemCount: 1,
        mappedItemCount: 0,
        truncated: false
      }
    ]);
    expect(evaluated.run.workContext).toEqual({
      contract: "resolved-work-context-v1",
      registrySha256: "1".repeat(64),
      resolutionSha256: "2".repeat(64),
      weeklyOutcomeStoreSha256: "3".repeat(64),
      weeklyOutcomeStatus: "active",
      projectResolution: "resolved",
      focusState: "active"
    });
    const serialized = JSON.stringify(evaluated.run);
    expect(serialized).not.toContain("Private calendar title");
    expect(serialized).not.toContain("Private Notion title");
    expect(serialized).not.toContain("Private weekly outcome");
  });
});

function githubSnapshot(
  overrides: Partial<GitHubSnapshot> = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "Iv1.client",
    appSlug: "blabase",
    apiVersion: "2026-03-10",
    fetchedAt: "2026-07-26T11:59:00.000Z",
    user: { id: 7, login: "nika" },
    truncated: false,
    activityWindowStart: "2026-06-26T12:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 10,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 10,
        fullName: "acme/app",
        private: true,
        archived: false,
        updatedAt: "2026-07-26T11:00:00.000Z"
      }
    ],
    tasks: [],
    activities: [],
    ...overrides
  };
}

function githubTask(
  overrides: Partial<GitHubTaskSignal> = {}
): GitHubTaskSignal {
  return {
    id: 201,
    source: "github",
    kind: "assigned_issue",
    repositoryId: 101,
    repositoryFullName: "acme/app",
    number: 11,
    title: "Checkout issue",
    htmlUrl: "https://github.com/acme/app/issues/11",
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-26T11:50:00.000Z",
    ...overrides
  };
}

function githubIssueActivity() {
  return {
    id: "activity-issue-11-opened",
    source: "github" as const,
    kind: "user_activity" as const,
    activityKind: "issue_opened" as const,
    repositoryId: 101,
    repositoryFullName: "acme/app",
    occurredAt: "2026-07-26T11:58:00.000Z",
    subjectType: "issue" as const,
    subjectNumber: 11,
    subjectTitle: "Private issue activity",
    refName: null,
    reviewState: null
  };
}

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-activity-summary-v1",
    contentMode: "activity_summary",
    codexVersion: "codex-cli 0.150.0",
    fetchedAt: "2026-07-26T11:59:00.000Z",
    lookbackStart: "2026-06-26T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: [SCOPE_ID],
    sessions: [codexSession()],
    ...overrides
  };
}

function codexSession(
  overrides: Partial<CodexSnapshot["sessions"][number]> = {}
): CodexSnapshot["sessions"][number] {
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    source: "codex",
    kind: "coding_session",
    scopeId: SCOPE_ID,
    projectLabel: "blabase",
    taskSummary: null,
    taskSummarySource: null,
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-26T11:59:00.000Z",
    activityState: "active",
    attentionState: null,
    content: emptyCodexContentManifest(),
    ...overrides
  };
}
