import { describe, expect, it } from "vitest";

import { mergeTaskLineage } from "../src/mergeTaskLineage";
import type { VerifiedTaskStateSignal } from "../src/types";
import { verifiedCandidateFixture } from "./helpers";

describe("task lineage safety boundaries", () => {
  it("does not merge a task with a broader follow-up that only contains it", () => {
    const merged = mergeTaskLineage([
      verifiedCandidateFixture({
        conversationId: "submit-form",
        canonicalKey: "릴리스 승인 양식 제출",
        title: "릴리스 승인 양식 제출",
        description: "릴리스 승인 양식을 제출한다"
      }),
      verifiedCandidateFixture({
        conversationId: "review-receipt",
        canonicalKey: "릴리스 승인 양식 제출 영수증 검토",
        title: "릴리스 승인 양식 제출 영수증 검토",
        description: "제출 후 영수증까지 검토한다"
      })
    ]);

    expect(merged).toHaveLength(2);
  });

  it("allows a newer authoritative structured state to reopen completed work", () => {
    const merged = mergeTaskLineage(
      [
        verifiedCandidateFixture({
        conversationId: "reopened",
        state: "not_started",
        conversationEndedAt: "2026-07-20T12:00:00.000Z",
        sourceContexts: [structuredContext("reopened", "2026-07-20T11:00:00.000Z")]
        })
      ],
      [
        verifiedStateSignalFixture({
          conversationId: "completed",
          conversationEndedAt: "2026-07-20T12:00:00.000Z",
          sourceContexts: [structuredContext("completed", "2026-07-20T10:00:00.000Z")]
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe("not_started");
  });

  it("does not let a later screen observation reopen structured completed work", () => {
    const merged = mergeTaskLineage(
      [
        verifiedCandidateFixture({
        conversationId: "screen-pending",
        state: "not_started",
        conversationEndedAt: "2026-07-20T11:00:00.000Z",
        sourceContexts: [screenContext("screen-pending", "2026-07-20T11:00:00.000Z")]
        })
      ],
      [
        verifiedStateSignalFixture({
          conversationId: "completed",
          conversationEndedAt: "2026-07-20T10:00:00.000Z",
          sourceContexts: [structuredContext("completed", "2026-07-20T10:00:00.000Z")]
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe("completed");
  });

  it("uses a terminal signal only as a state overlay", () => {
    const candidate = verifiedCandidateFixture({
      conversationId: "open",
      state: "not_started",
      owner: "user",
      confidence: 0.8,
      sourceContexts: [structuredContext("open", "2026-07-20T10:00:00.000Z")]
    });
    const merged = mergeTaskLineage(
      [candidate],
      [
        verifiedStateSignalFixture({
          conversationId: "completed",
          sourceContexts: [structuredContext("completed", "2026-07-20T11:00:00.000Z")]
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      state: "completed",
      owner: "user",
      confidence: 0.8,
      recurrenceCount: 1,
      sourceConversationIds: ["open"]
    });
    expect(merged[0]?.sourceContexts).toEqual(candidate.sourceContexts);
    expect(merged[0]?.evidence).toEqual(candidate.evidence);
  });

  it.each([
    {
      boundary: "invalid observedTo",
      candidateContexts: [structuredContext("reopened", "not-a-timestamp")],
      signalContexts: [structuredContext("completed", "also-not-a-timestamp")]
    },
    {
      boundary: "missing source context",
      candidateContexts: [],
      signalContexts: []
    },
    {
      boundary: "exact observedTo tie",
      candidateContexts: [
        structuredContext("reopened", "2026-07-20T10:00:00.000Z")
      ],
      signalContexts: [
        structuredContext("completed", "2026-07-20T10:00:00.000Z")
      ]
    }
  ])("keeps terminal state for $boundary", ({ candidateContexts, signalContexts }) => {
    const merged = mergeTaskLineage(
      [
        verifiedCandidateFixture({
          conversationId: "reopened",
          state: "not_started",
          conversationEndedAt: "2026-07-20T12:00:00.000Z",
          sourceContexts: [...candidateContexts]
        })
      ],
      [
        verifiedStateSignalFixture({
          conversationId: "completed",
          conversationEndedAt: "2026-07-20T12:00:00.000Z",
          sourceContexts: [...signalContexts]
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe("completed");
  });
});

function verifiedStateSignalFixture(
  overrides: Partial<VerifiedTaskStateSignal> = {}
): VerifiedTaskStateSignal {
  const candidate = verifiedCandidateFixture();
  return {
    id: `state_${candidate.id}`,
    canonicalKey: candidate.canonicalKey,
    title: candidate.title,
    state: "completed",
    conversationId: "completed",
    conversationEndedAt: "2026-07-20T11:00:00.000Z",
    evidence: candidate.evidence.map((evidence) => ({
      ...evidence,
      kind: "state"
    })),
    sourceContexts: [structuredContext("completed", "2026-07-20T11:00:00.000Z")],
    verificationIssues: [],
    ...overrides
  };
}

function structuredContext(sourceId: string, observedTo: string) {
  return {
    sourceId,
    modality: "structured" as const,
    authority: "structured_source" as const,
    observedFrom: observedTo,
    observedTo,
    confidenceFloor: 1,
    confidenceCeiling: 1,
    coverageRatio: 1,
    conflictCount: 0,
    issueCount: 0
  };
}

function screenContext(sourceId: string, observedTo: string) {
  return {
    sourceId,
    modality: "screen" as const,
    authority: "screen_observation" as const,
    observedFrom: observedTo,
    observedTo,
    confidenceFloor: 0.95,
    confidenceCeiling: 0.99,
    coverageRatio: 1,
    conflictCount: 0,
    issueCount: 0
  };
}
