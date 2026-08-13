import {
  chmod,
  mkdir,
  mkdtemp,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const liveAttentionMock = vi.hoisted(() => ({
  capture: vi.fn()
}));

vi.mock("../src/attention/liveAttention", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/attention/liveAttention")
  >();
  return {
    ...actual,
    evaluateCurrentAttentionWithLiveInputs: liveAttentionMock.capture
  };
});

import type { LiveAttentionCapturedInputs } from "../src/attention/liveAttention";
import type { CodexSnapshot, StoredCodexConfig } from "../src/connectors/codex/types";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import {
  sealActiveAttentionResult,
  type ActiveAttentionResult
} from "../src/attentionDecision";
import { continuationPublicItemSchema } from "../src/continuation/contracts";
import { continuationReadDecisionSchema } from "../src/continuation/readApi";
import {
  composeCapturedBoard,
  composeCapturedBoardResolution,
  evaluateLiveContinuationRead,
  evaluateLiveSemanticWorkSuggestionBoard,
  evaluateLiveWorkSuggestionBoard
} from "../src/suggestionBoard/liveShadow";
import {
  workBoardApiResponseSchema,
  workBoardReadyResponseSchema
} from "../src/suggestionBoard/monitoringSchema";
import {
  emptyUnavailableWorkSuggestionBoardPublic,
  projectActiveOnlyWorkSuggestionBoardPublic,
  projectWorkSuggestionBoardPublic
} from "../src/suggestionBoard/publicProjection";
import {
  workSuggestionBoardPublicSchema,
  type WorkSuggestionBoardResult
} from "../src/suggestionBoard/contracts";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_PROJECT_ID
} from "./fixtures/activeAttentionFixture";
import {
  BOARD_FIXTURE_CODE_SHA,
  BOARD_FIXTURE_SECRET,
  authenticBoardFixture,
  composeAuthenticBoard
} from "./fixtures/suggestionBoardFixture";

const PROJECTION_SECRET = "9".repeat(64);
const CREDENTIAL_SHAPED_TEXTS = [
  `ghp_${"a1".repeat(12)}`,
  `github_pat_${"b2".repeat(12)}`,
  `sk-${"c3".repeat(12)}`,
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljU2lnbmF0dXJl",
  "token=syntheticToken123",
  "api key: syntheticApiKey123",
  "access key=syntheticAccessKey123",
  "password: syntheticPassword123",
  "secret=syntheticSecret123"
] as const;
const ORDINARY_PUBLIC_TEXTS = [
  "API key rotation policy 검토",
  "Access key 문서와 token parser를 정리합니다",
  "Secret Garden release notes",
  "비밀번호와 토큰 보안 정책을 검토합니다"
] as const;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Work Board public projection", () => {
  it("runtime-parses every public projection and keeps private lineage opaque", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    const full = projectWorkSuggestionBoardPublic(
      composed.board,
      PROJECTION_SECRET
    );
    const activeOnly = projectActiveOnlyWorkSuggestionBoardPublic(
      fixture.bundle.active,
      PROJECTION_SECRET
    );
    const empty = emptyUnavailableWorkSuggestionBoardPublic(
      ACTIVE_FIXTURE_AS_OF
    );

    for (const projected of [full, activeOnly, empty]) {
      expect(workSuggestionBoardPublicSchema.parse(projected)).toEqual(
        projected
      );
    }

    const serialized = JSON.stringify([full, activeOnly, empty]);
    const continuation =
      fixture.bundle.continuationResolvedDecision.decision;
    const privateValues = [
      PROJECTION_SECRET,
      BOARD_FIXTURE_SECRET,
      ACTIVE_FIXTURE_PROJECT_ID,
      fixture.bundle.active.resultId,
      fixture.bundle.active.decision.topSuggestion?.candidateId,
      fixture.bundle.continuationResolutionEnvelope.run.runId,
      fixture.bundle.continuationResolutionEnvelope.run.analysisId,
      continuation.primary?.candidateId,
      fixture.bundle.continuationIdentityInput.adapterBatches[0]
        ?.observations[0]?.sourceIdentity.opaqueId
    ].filter((value): value is string => typeof value === "string");

    for (const privateValue of privateValues) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toMatch(
      /(?:privateActionTarget|sourceItemRef|workContextId|resultSha256|inputSha256|continuation_run_|analysis_|session_|repositoryId)/u
    );
  });

  it("rejects malformed private inputs and projection keys before output", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    expect(() =>
      projectWorkSuggestionBoardPublic(
        {
          ...composed.board,
          fixtureSentinel: "PRIVATE_FIXTURE_SENTINEL"
        } as unknown as WorkSuggestionBoardResult,
        PROJECTION_SECRET
      )
    ).toThrow();
    expect(() =>
      projectWorkSuggestionBoardPublic(
        composed.board,
        BOARD_FIXTURE_SECRET
      )
    ).toThrow();
    expect(() =>
      projectActiveOnlyWorkSuggestionBoardPublic(
        {
          ...fixture.bundle.active,
          privateSessionId: `session_${"a".repeat(32)}`
        } as unknown as typeof fixture.bundle.active,
        PROJECTION_SECRET
      )
    ).toThrow();
  });

  it("rejects credential-shaped Active titles and Continuation title/summary fields", () => {
    const fixture = authenticBoardFixture();
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const full = projectWorkSuggestionBoardPublic(
      composed.board,
      PROJECTION_SECRET
    );
    const continuation = [
      ...(full.primary === null ? [] : [full.primary]),
      ...full.alternatives
    ].find((item) => item.lane !== "attention");
    expect(continuation).toBeDefined();
    if (continuation === undefined) {
      return;
    }

    for (const credential of CREDENTIAL_SHAPED_TEXTS) {
      const activeProjection = projectActiveOnlyWorkSuggestionBoardPublic(
        withActiveTitle(
          fixture.bundle.active,
          `Review ${credential}`
        ),
        PROJECTION_SECRET
      );
      expect(JSON.stringify(activeProjection)).not.toContain(credential);

      expect(
        continuationPublicItemSchema.safeParse({
          ...continuation.item,
          title: `Continue ${credential}`
        }).success
      ).toBe(false);
      expect(
        continuationPublicItemSchema.safeParse({
          ...continuation.item,
          summary: `Continue ${credential}`
        }).success
      ).toBe(false);
    }
  });

  it("rejects credential-shaped clarification text without redacting it", () => {
    const active = authenticBoardFixture({ active: "clarification" })
      .bundle.active;
    expect(active.decision.status).toBe("needs_clarification");

    for (const credential of CREDENTIAL_SHAPED_TEXTS) {
      const projected = projectActiveOnlyWorkSuggestionBoardPublic(
        withClarificationQuestion(
          active,
          `어느 작업을 진행할까요? ${credential}`
        ),
        PROJECTION_SECRET
      );
      expect(projected.primary).toBeNull();
      expect(projected.alternatives).toEqual([]);
      expect(JSON.stringify(projected)).not.toContain(credential);
    }
  });

  it("preserves ordinary Korean and English public text", () => {
    const fixture = authenticBoardFixture();
    const clarification = authenticBoardFixture({ active: "clarification" })
      .bundle.active;
    const composed = composeAuthenticBoard(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const full = projectWorkSuggestionBoardPublic(
      composed.board,
      PROJECTION_SECRET
    );
    const continuation = [
      ...(full.primary === null ? [] : [full.primary]),
      ...full.alternatives
    ].find((item) => item.lane !== "attention");
    expect(continuation).toBeDefined();
    if (continuation === undefined) {
      return;
    }

    for (const text of ORDINARY_PUBLIC_TEXTS) {
      const activeProjection = projectActiveOnlyWorkSuggestionBoardPublic(
        withActiveTitle(fixture.bundle.active, text),
        PROJECTION_SECRET
      );
      expect(activeProjection.primary?.item.title).toBe(text);

      const clarificationProjection =
        projectActiveOnlyWorkSuggestionBoardPublic(
          withClarificationQuestion(clarification, text),
          PROJECTION_SECRET
        );
      expect(clarificationProjection.primary?.item.title).toBe(text);

      expect(
        continuationPublicItemSchema.safeParse({
          ...continuation.item,
          title: text,
          summary: text
        }).success
      ).toBe(true);
    }
  });
});

describe("live Work Board shadow", () => {
  it("keeps the strict base response unchanged inside the semantic presentation wrapper", async () => {
    const captured = capturedInput();
    const expectedBase = composeCapturedBoard(captured);
    liveAttentionMock.capture.mockReset();
    liveAttentionMock.capture.mockResolvedValue(captured);

    const response = await evaluateLiveSemanticWorkSuggestionBoard({
      cwd: "/synthetic/missing-semantic-store",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" }
    });

    expect(liveAttentionMock.capture).toHaveBeenCalledTimes(1);
    expect(liveAttentionMock.capture).toHaveBeenCalledWith({
      cwd: "/synthetic/missing-semantic-store",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" },
      refreshSources: false,
      readMode: "preserve"
    });
    expect(response.semanticPresentation).toBeNull();
    expect(JSON.stringify(response.base)).toBe(JSON.stringify(expectedBase));
    expect(workBoardApiResponseSchema.parse(response.base)).toEqual(
      expectedBase
    );
  });

  it("keeps a ready base and drops only an unstable semantic overlay", async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), "blabase-semantic-preserve-")
    );
    temporaryDirectories.push(cwd);
    const semanticDirectory = join(
      cwd,
      ".local",
      "semantic-continuation"
    );
    await mkdir(semanticDirectory, { recursive: true, mode: 0o700 });
    await chmod(join(cwd, ".local"), 0o700);
    await chmod(semanticDirectory, 0o755);
    const captured = capturedInput();
    const expectedBase = composeCapturedBoard(captured);
    liveAttentionMock.capture.mockReset();
    liveAttentionMock.capture.mockResolvedValue(captured);

    const response = await evaluateLiveSemanticWorkSuggestionBoard({
      cwd,
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" }
    });

    expect(response.semanticPresentation).toBeNull();
    expect(JSON.stringify(response.base)).toBe(JSON.stringify(expectedBase));
  });

  it("executes one capture through the real R1/R2/R3/B1 path", async () => {
    const captured = capturedInput();
    liveAttentionMock.capture.mockReset();
    liveAttentionMock.capture.mockResolvedValue(captured);

    const response = await evaluateLiveWorkSuggestionBoard({
      cwd: "/synthetic/workspace",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" }
    });

    expect(liveAttentionMock.capture).toHaveBeenCalledTimes(1);
    expect(liveAttentionMock.capture).toHaveBeenCalledWith({
      cwd: "/synthetic/workspace",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" },
      refreshSources: false,
      readMode: "preserve"
    });
    expect(response).toMatchObject({
      status: "ready",
      mode: "full",
      reasonCode: null
    });
    expect(workBoardApiResponseSchema.parse(response)).toEqual(response);
    if (response.status !== "ready") return;
    expect(response.board.primary?.lane).toBe("attention");
    expect(response.board.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lane: "continuation" })
      ])
    );
  });

  it("reuses the same single capture for the exact R3 display-only read", async () => {
    const captured = capturedInput();
    liveAttentionMock.capture.mockReset();
    liveAttentionMock.capture.mockResolvedValue(captured);

    const response = await evaluateLiveContinuationRead({
      cwd: "/synthetic/workspace",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" }
    });

    expect(liveAttentionMock.capture).toHaveBeenCalledTimes(1);
    expect(liveAttentionMock.capture).toHaveBeenCalledWith({
      cwd: "/synthetic/workspace",
      now: new Date(ACTIVE_FIXTURE_AS_OF),
      env: { NODE_ENV: "test" },
      refreshSources: false,
      readMode: "preserve"
    });
    expect(continuationReadDecisionSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("offers_available");
    expect(
      response.items.every(
        (item) => item.capability === "display" && item.action === null
      )
    ).toBe(true);
    expect(composeCapturedBoardResolution(captured).continuation).toMatchObject({
      kind: "resolved"
    });
  });

  it("preserves verified Active output when Continuation prerequisites fail", () => {
    const captured = capturedInput();
    const resolution = composeCapturedBoardResolution({
      ...captured,
      registryStatus: "missing",
      registry: null
    });
    const response = resolution.response;

    expect(response).toMatchObject({
      status: "ready",
      mode: "active_only_fallback",
      reasonCode: "CONTINUATION_PREREQUISITES_UNAVAILABLE",
      board: {
        prominentLane: "attention",
        continuationStatus: "unavailable"
      }
    });
    expect(workBoardReadyResponseSchema.parse(response)).toEqual(
      response
    );
    if (response.status !== "ready") return;
    expect(response.board.primary?.item.title).toBe(
      captured.evaluated.result.decision.topSuggestion?.title
    );
    expect(response.board.alternatives.every(
      (item) => item.lane === "attention"
    )).toBe(true);
    expect(resolution.continuation).toEqual({ kind: "unavailable" });
  });

  it("returns bounded unavailable output when no safe projection key exists", () => {
    for (const installationSecret of [null, "not-a-64-byte-hex-key"]) {
      const captured = capturedInput();
      const response = composeCapturedBoard({
        ...captured,
        codexConfig:
          installationSecret === null
            ? null
            : {
                ...captured.codexConfig!,
                installationSecret
              }
      });

      expect(response).toEqual({
        status: "unavailable",
        code: "WORK_BOARD_PROJECTION_KEY_UNAVAILABLE",
        message: "Work Board 공개 식별 키를 사용할 수 없습니다."
      });
      expect(workBoardApiResponseSchema.parse(response)).toEqual(
        response
      );
    }
  });

  it("keeps random private run artifacts out of stable public output", () => {
    const captured = capturedInput();
    const first = composeCapturedBoard(captured);
    const second = composeCapturedBoard(captured);

    expect(first).toEqual(second);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toMatch(
      /(?:continuation_run_|analysis_|runId|analysisId|codeCommitSha|datasetSha256)/u
    );
  });

  it("rejects unbounded or inconsistent monitoring states", () => {
    const full = composeCapturedBoard(capturedInput());
    expect(full.status).toBe("ready");
    if (full.status !== "ready") return;

    expect(workBoardApiResponseSchema.safeParse({
      ...full,
      mode: "active_only_fallback",
      reasonCode: "RAW_PRIVATE_FAILURE_DETAIL"
    }).success).toBe(false);
    expect(workBoardApiResponseSchema.safeParse({
      ...full,
      mode: "full",
      reasonCode: "BOARD_COMPOSITION_REJECTED"
    }).success).toBe(false);
    expect(workBoardApiResponseSchema.safeParse({
      ...full,
      privateRunId: `run_${"f".repeat(32)}`
    }).success).toBe(false);
  });
});

function capturedInput(): LiveAttentionCapturedInputs {
  const fixture = authenticBoardFixture();
  return {
    evaluated: {
      result: fixture.bundle.active
    } as LiveAttentionCapturedInputs["evaluated"],
    asOf: ACTIVE_FIXTURE_AS_OF,
    github: {
      status: "available",
      snapshot: githubSnapshot()
    },
    codex: {
      status: "available",
      snapshot: codexSnapshot()
    },
    registry: fixture.bundle.continuationIdentityInput.registry,
    registryStatus: "available",
    codexConfig: codexConfig(),
    codeProvenance: {
      codeCommitSha: BOARD_FIXTURE_CODE_SHA,
      codeState: "clean_commit",
      codeFingerprintSha256: null
    }
  };
}

function withActiveTitle(
  active: ActiveAttentionResult,
  title: string
): ActiveAttentionResult {
  const { resultSha256: _resultSha256, ...content } = active;
  const topSuggestion = content.decision.topSuggestion;
  if (topSuggestion === null) {
    throw new TypeError("Synthetic Active title fixture requires a suggestion");
  }
  return sealActiveAttentionResult({
    ...content,
    rankedCandidates: content.rankedCandidates.map((candidate) =>
      candidate.candidateId === topSuggestion.candidateId
        ? { ...candidate, title }
        : candidate
    ),
    decision: {
      ...content.decision,
      topSuggestion: { ...topSuggestion, title }
    }
  });
}

function withClarificationQuestion(
  active: ActiveAttentionResult,
  question: string
): ActiveAttentionResult {
  const { resultSha256: _resultSha256, ...content } = active;
  const clarification = content.decision.clarification;
  if (clarification === null) {
    throw new TypeError(
      "Synthetic Active clarification fixture requires a question"
    );
  }
  return sealActiveAttentionResult({
    ...content,
    decision: {
      ...content.decision,
      clarification: { ...clarification, question }
    }
  });
}

function codexConfig(): StoredCodexConfig {
  return {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: PROJECTION_SECRET,
    selectedScopeIds: [],
    scopes: [],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: ACTIVE_FIXTURE_AS_OF
  };
}

function codexSnapshot(): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "test-codex",
    fetchedAt: "2026-08-02T02:40:00.000Z",
    lookbackStart: "2026-07-26T03:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: [],
    sessions: []
  };
}

function githubSnapshot(): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v6",
    appClientId: "private-client-id",
    appSlug: "private-app-slug",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-02T02:40:00.000Z",
    user: { id: 701, login: "private-user" },
    truncated: false,
    activityWindowStart: "2026-07-26T03:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    actionabilityCoverage: {
      state: "complete",
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    installations: [
      {
        id: 701,
        accountLogin: "private-user",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 10,
        source: "github",
        kind: "repository",
        installationId: 701,
        fullName: "private-owner/private-repository",
        private: true,
        archived: false,
        updatedAt: "2026-08-02T02:30:00.000Z"
      }
    ],
    tasks: [],
    activities: [
      {
        id: "private-push-event",
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 10,
        repositoryFullName: "private-owner/private-repository",
        occurredAt: "2026-08-02T02:30:00.000Z",
        subjectType: "repository",
        subjectNumber: null,
        subjectObjectId: null,
        subjectTitle: null,
        refName: "refs/heads/private-branch",
        reviewState: null,
        artifactId: `artifact_${"7".repeat(32)}`
      }
    ]
  };
}
