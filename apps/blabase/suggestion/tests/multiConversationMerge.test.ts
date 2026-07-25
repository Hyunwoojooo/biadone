import { describe, expect, it } from "vitest";

import { mergeTaskLineage } from "../src/mergeTaskLineage";
import { verifiedCandidateFixture } from "./helpers";

describe("cross-conversation task lineage", () => {
  it("merges the same canonical task while preserving all evidence", () => {
    const merged = mergeTaskLineage([
      verifiedCandidateFixture({ conversationId: "conversation-a" }),
      verifiedCandidateFixture({ conversationId: "conversation-b" }),
      verifiedCandidateFixture({ conversationId: "conversation-c" })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      recurrenceCount: 3,
      sourceConversationIds: [
        "conversation-a",
        "conversation-b",
        "conversation-c"
      ]
    });
    expect(merged[0]?.evidence).toHaveLength(3);
  });

  it("keeps similar titles separate when canonical targets differ", () => {
    const merged = mergeTaskLineage([
      verifiedCandidateFixture({
        conversationId: "conversation-a",
        canonicalKey: "고객 계약서 검토"
      }),
      verifiedCandidateFixture({
        conversationId: "conversation-b",
        canonicalKey: "채용 계약서 검토"
      })
    ]);

    expect(merged).toHaveLength(2);
  });

  it("uses a later explicit completed state to suppress old open state", () => {
    const merged = mergeTaskLineage([
      verifiedCandidateFixture({
        conversationId: "conversation-a",
        conversationEndedAt: "2026-07-01T00:00:00.000Z",
        state: "not_started"
      }),
      verifiedCandidateFixture({
        conversationId: "conversation-b",
        conversationEndedAt: "2026-07-20T00:00:00.000Z",
        state: "completed"
      })
    ]);

    expect(merged[0]?.state).toBe("completed");
  });
});
