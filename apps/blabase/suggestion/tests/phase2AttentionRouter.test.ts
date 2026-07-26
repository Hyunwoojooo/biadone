import { describe, expect, it } from "vitest";

import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type {
  GitHubSnapshot,
  GitHubTaskSignal
} from "../src/connectors/github/types";
import {
  phase2AttentionInput,
  phase2AvailableSource,
  phase2UnavailableSource,
  runPhase2AttentionRouter,
  verifyPhase2AttentionResultIntegrity
} from "../src/crossSource/runAttentionRouter";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../src/crossSource/versions";

const AS_OF = "2026-07-26T12:00:00.000Z";
const SCOPE_ID = "111111111111111111111111";
const normalizationOptions = {
  asOf: AS_OF,
  freshnessPolicy: {
    version: SNAPSHOT_VALIDITY_POLICY_VERSION,
    maxAgeMsBySource: {
      github: 10 * 60 * 1_000,
      codex: 10 * 60 * 1_000
    },
    maxFutureClockSkewMs: 1_000
  }
};

describe("Phase 2 aggressive evidence-bound Attention Router", () => {
  it("suggests a grounded assigned issue and keeps Codex states overview-only", () => {
    const github = normalizeGitHub(
      githubSnapshot({
        tasks: [
          githubTask({
            id: 201,
            number: 11,
            title: "Checkout API cleanup"
          })
        ]
      })
    );
    const codex = normalizeCodex(
      codexSnapshot({
        sessions: [
          codexSession({
            id: "aaaaaaaaaaaaaaaaaaaaaaaa",
            activityState: "active",
            attentionState: "waiting_on_approval"
          }),
          codexSession({
            id: "bbbbbbbbbbbbbbbbbbbbbbbb",
            activityState: "system_error"
          })
        ]
      })
    );

    const result = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2AvailableSource(codex)
      })
    );

    expect(result.decision).toMatchObject({
      status: "suggested",
      certainty: "confirmed",
      topSuggestion: {
        taskKind: "assigned_issue",
        intervention: "do",
        lane: "focus",
        title: "Checkout API cleanup"
      },
      reasonCodes: ["DECISION_BEST_OBSERVED_CANDIDATE"]
    });
    expect(result.workCockpit.codexExecutions).toHaveLength(2);
    expect(
      result.workCockpit.codexExecutions.map((item) => [
        item.nativeActivityState,
        item.semanticState,
        item.forbiddenAsAttentionCandidate
      ])
    ).toEqual([
      ["active", "unknown", true],
      ["system_error", "unknown", true]
    ]);
    expect(
      result.candidateAssessments.some(
        (assessment) =>
          assessment.subjectId.startsWith("codex:")
      )
    ).toBe(false);
    expect(verifyPhase2AttentionResultIntegrity(result)).toBe(true);
  });

  it("turns a draft-unknown review request into a provisional status inspection, not a review claim", () => {
    const github = normalizeGitHub(
      githubSnapshot({
        tasks: [
          githubTask({
            id: 202,
            kind: "review_requested_pull_request",
            number: 22,
            title: "Review checkout changes",
            htmlUrl: "https://github.com/acme/app/pull/22"
          })
        ]
      })
    );
    const result = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2UnavailableSource(
          "CONNECTOR_DISCONNECTED"
        )
      })
    );

    expect(result.decision).toMatchObject({
      status: "suggested",
      certainty: "provisional",
      topSuggestion: {
        taskKind: "review_requested_pull_request",
        intervention: "inspect",
        lane: "unblock",
        certainty: "provisional",
        caveatCodes: ["CAVEAT_REVIEW_DRAFT_UNKNOWN"]
      }
    });
    expect(result.decision.topSuggestion?.firstStep).toContain(
      "draft 여부"
    );
    expect(JSON.stringify(result)).not.toContain(
      '"intervention":"review"'
    );
  });

  it("puts a native milestone inside the 48-hour hypothesis into must_now without inventing urgency", () => {
    const github = normalizeGitHub(
      githubSnapshot({
        tasks: [
          githubTask({
            milestoneDueAt: "2026-07-27T12:00:00.000Z"
          })
        ]
      })
    );
    const result = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING")
      })
    );

    expect(result.decision.topSuggestion).toMatchObject({
      lane: "must_now",
      dueAt: "2026-07-27T12:00:00.000Z",
      whyNowReasonCodes: ["WHY_NOW_MILESTONE_DUE_SOON"]
    });
    expect(JSON.stringify(result)).not.toContain('"urgency"');
    expect(JSON.stringify(result)).not.toContain('"impact"');
  });

  it("uses an active weekly outcome only as an in-lane exact-token preference and does not echo it", () => {
    const github = normalizeGitHub(
      githubSnapshot({
        tasks: [
          githubTask({
            id: 201,
            number: 11,
            title: "Payments release checklist",
            htmlUrl: "https://github.com/acme/app/issues/11",
            updatedAt: "2026-07-26T11:40:00.000Z"
          }),
          githubTask({
            id: 202,
            number: 12,
            title: "Onboarding copy cleanup",
            htmlUrl: "https://github.com/acme/app/issues/12",
            updatedAt: "2026-07-26T11:50:00.000Z"
          })
        ]
      })
    );
    const privateOutcome =
      "payments release confidential outcome";
    const result = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING"),
        focus: {
          primaryOutcome: privateOutcome,
          capturedAt: "2026-07-24T00:00:00.000Z",
          validUntil: "2026-07-31T00:00:00.000Z"
        }
      })
    );

    expect(result.decision.topSuggestion?.title).toBe(
      "Payments release checklist"
    );
    expect(result.decision.topSuggestion?.whyNowReasonCodes).toContain(
      "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
    );
    expect(result.focusContext).toEqual({
      present: true,
      active: true,
      appliedToRanking: true,
      relationStatus: "text_match_only"
    });
    expect(JSON.stringify(result)).not.toContain(privateOutcome);
    expect(JSON.stringify(result)).not.toContain("confidential");

    const futureFocus = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING"),
        focus: {
          primaryOutcome: privateOutcome,
          capturedAt: "2026-07-26T13:00:00.000Z",
          validUntil: "2026-07-31T00:00:00.000Z"
        }
      })
    );
    expect(futureFocus.focusContext).toEqual({
      present: true,
      active: false,
      appliedToRanking: false,
      relationStatus: "not_yet_active"
    });
    expect(
      futureFocus.decision.topSuggestion?.whyNowReasonCodes
    ).not.toContain("WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH");
  });

  it("picks the same default for equivalent candidates and exposes the other as an alternative", () => {
    const tasks = [
      githubTask({
        id: 201,
        number: 11,
        title: "First equal issue",
        htmlUrl: "https://github.com/acme/app/issues/11"
      }),
      githubTask({
        id: 202,
        number: 12,
        title: "Second equal issue",
        htmlUrl: "https://github.com/acme/app/issues/12"
      })
    ];
    const first = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(
          normalizeGitHub(githubSnapshot({ tasks }))
        ),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING")
      })
    );
    const reversed = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(
          normalizeGitHub(
            githubSnapshot({ tasks: [...tasks].reverse() })
          )
        ),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING")
      })
    );

    expect(reversed).toEqual(first);
    expect(first.decision.status).toBe("suggested");
    expect(first.decision.alternatives).toHaveLength(1);
    expect(first.decision.caveatCodes).toContain(
      "CAVEAT_DEFAULT_TIE_BREAK_USED"
    );
  });

  it("returns scoped no_action only for complete GitHub negative coverage", () => {
    const authoredOnly = normalizeGitHub(
      githubSnapshot({
        tasks: [
          githubTask({
            kind: "authored_pull_request",
            htmlUrl: "https://github.com/acme/app/pull/11"
          })
        ]
      })
    );
    const noAction = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(authoredOnly),
        codex: phase2AvailableSource(codexSnapshotBatch())
      })
    );
    expect(noAction.decision).toMatchObject({
      status: "no_action",
      certainty: "scoped",
      topSuggestion: null
    });
    expect(noAction.coverage).toMatchObject({
      githubCandidateCoverage: "complete",
      negativeCandidateCoverageComplete: true
    });
    expect(noAction.decision.scopeStatement).toContain(
      "현재 평가 가능한 GitHub 작업 범위"
    );

    const codexOnly = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2UnavailableSource(
          "CONNECTOR_DISCONNECTED"
        ),
        codex: phase2AvailableSource(codexSnapshotBatch())
      })
    );
    expect(codexOnly.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(codexOnly.workCockpit.codexExecutions).toHaveLength(1);

    const invalidCodex = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2UnavailableSource(
          "CONNECTOR_DISCONNECTED"
        ),
        codex: phase2AvailableSource(
          normalizeCodex(
            codexSnapshot({
              fetchedAt: "2026-07-26T12:00:02.001Z"
            })
          )
        )
      })
    );
    expect(invalidCodex.workCockpit.codexExecutions).toHaveLength(
      0
    );
    expect(invalidCodex.coverage.reasonCodes).toContain(
      "SOURCE_CODEX_STALE_OR_INVALID"
    );
  });

  it("suggests a visible positive from truncated coverage but refuses empty, stale, or unsafe coverage", () => {
    const truncatedPositive = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(
          normalizeGitHub(
            githubSnapshot({
              truncated: true,
              tasks: [githubTask()]
            })
          )
        ),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING")
      })
    );
    expect(truncatedPositive.decision).toMatchObject({
      status: "suggested",
      certainty: "provisional"
    });
    expect(truncatedPositive.decision.caveatCodes).toContain(
      "CAVEAT_CANDIDATE_SET_INCOMPLETE"
    );

    const truncatedEmpty = decide(
      githubSnapshot({ truncated: true, tasks: [] })
    );
    expect(truncatedEmpty.decision.status).toBe(
      "insufficient_evidence"
    );

    const stale = decide(
      githubSnapshot({
        fetchedAt: "2026-07-26T10:00:00.000Z",
        tasks: [
          githubTask({
            updatedAt: "2026-07-26T09:59:00.000Z"
          })
        ]
      })
    );
    expect(stale.decision.status).toBe(
      "insufficient_evidence"
    );

    const unsafe = decide(
      githubSnapshot({
        tasks: [
          githubTask({
            htmlUrl:
              "https://github.com.evil.test/acme/app/issues/11?token=secret"
          })
        ]
      })
    );
    expect(unsafe.decision.status).toBe(
      "insufficient_evidence"
    );
    expect(JSON.stringify(unsafe)).not.toContain("token=secret");
  });

  it("rejects tampered source batches and detects result tampering", () => {
    const github = normalizeGitHub(
      githubSnapshot({ tasks: [githubTask()] })
    );
    const result = runPhase2AttentionRouter(
      phase2AttentionInput({
        asOf: AS_OF,
        github: phase2AvailableSource(github),
        codex: phase2UnavailableSource("SNAPSHOT_MISSING")
      })
    );
    const tamperedResult = {
      ...result,
      decision: {
        ...result.decision,
        scopeStatement: "tampered"
      }
    };
    expect(verifyPhase2AttentionResultIntegrity(tamperedResult)).toBe(
      false
    );

    const tamperedBatch = {
      ...github,
      assessment: {
        ...github.assessment,
        candidateSetComplete: false
      }
    };
    expect(() =>
      runPhase2AttentionRouter({
        ...phase2AttentionInput({
          asOf: AS_OF,
          github: phase2AvailableSource(github),
          codex: phase2UnavailableSource("SNAPSHOT_MISSING")
        }),
        sources: {
          github: phase2AvailableSource(tamperedBatch),
          codex: phase2UnavailableSource("SNAPSHOT_MISSING")
        }
      })
    ).toThrow("integrity-verified source batches");
  });
});

function decide(snapshot: GitHubSnapshot) {
  return runPhase2AttentionRouter(
    phase2AttentionInput({
      asOf: AS_OF,
      github: phase2AvailableSource(normalizeGitHub(snapshot)),
      codex: phase2UnavailableSource("SNAPSHOT_MISSING")
    })
  );
}

function normalizeGitHub(
  snapshot: GitHubSnapshot
): RuntimeWorkSignalBatch {
  const result = normalizeGitHubSnapshotToWorkSignals(
    snapshot,
    normalizationOptions
  );
  expect(result.status).toBe("normalized");
  if (result.status !== "normalized") {
    throw new Error("Expected a normalized GitHub snapshot.");
  }
  return result.batch;
}

function normalizeCodex(
  snapshot: CodexSnapshot
): RuntimeWorkSignalBatch {
  const result = normalizeCodexSnapshotToWorkSignals(
    snapshot,
    normalizationOptions
  );
  expect(result.status).toBe("normalized");
  if (result.status !== "normalized") {
    throw new Error("Expected a normalized Codex snapshot.");
  }
  return result.batch;
}

function codexSnapshotBatch(): RuntimeWorkSignalBatch {
  return normalizeCodex(codexSnapshot());
}

function githubSnapshot(
  overrides: Partial<GitHubSnapshot> = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "Iv1.client",
    appSlug: "blabase",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-07-26T11:59:00.000Z",
    user: { id: 7, login: "nika" },
    truncated: false,
    activityWindowStart: "2026-06-26T12:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [],
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

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v2",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli 0.150.0",
    fetchedAt: "2026-07-26T11:59:00.000Z",
    lookbackStart: "2026-06-26T12:00:00.000Z",
    truncated: false,
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
    ...overrides
  };
}
