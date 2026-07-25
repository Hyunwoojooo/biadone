import { describe, expect, it } from "vitest";

import { mergeTaskLineage } from "../src/mergeTaskLineage";
import { scorePriority } from "../src/scorePriority";
import { selectSuggestion } from "../src/selectSuggestion";
import { verifiedCandidateFixture } from "./helpers";

const NOW = "2026-07-24T00:00:00.000Z";

describe("priority scoring and selection", () => {
  it("makes completed tasks ineligible", () => {
    const [candidate] = mergeTaskLineage([
      verifiedCandidateFixture({ state: "completed" })
    ]);
    const assessment = scorePriority(candidate, NOW);

    expect(assessment.eligibility).toBe("ineligible");
    expect(assessment.score).toBe(0);
  });

  it("rewards verified recurrence without requiring it", () => {
    const [single] = mergeTaskLineage([verifiedCandidateFixture()]);
    const [repeated] = mergeTaskLineage([
      verifiedCandidateFixture({ conversationId: "a" }),
      verifiedCandidateFixture({ conversationId: "b" }),
      verifiedCandidateFixture({ conversationId: "c" })
    ]);

    expect(
      scorePriority(repeated, NOW).factors.crossConversationRecurrence
    ).toBeGreaterThan(
      scorePriority(single, NOW).factors.crossConversationRecurrence
    );
  });

  it("returns one top suggestion when evidence and score are sufficient", () => {
    const candidates = mergeTaskLineage([
      verifiedCandidateFixture({ conversationId: "a" }),
      verifiedCandidateFixture({ conversationId: "b" }),
      verifiedCandidateFixture({ conversationId: "c" })
    ]);
    const assessments = candidates.map((candidate) =>
      scorePriority(candidate, NOW)
    );
    const result = selectSuggestion(candidates, assessments);

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion?.title).toBe("계약서 검토 후 회신하기");
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
  });

  it("chooses a stable top candidate even when scores are tied", () => {
    const candidates = mergeTaskLineage([
      verifiedCandidateFixture({
        conversationId: "a",
        canonicalKey: "계약 검토",
        deadlineIso: "2026-07-25T00:00:00.000Z"
      }),
      verifiedCandidateFixture({
        conversationId: "b",
        canonicalKey: "예산 검토",
        title: "예산안 검토하기",
        deadlineIso: "2026-07-25T00:00:00.000Z"
      })
    ]);
    const assessments = candidates.map((candidate) =>
      scorePriority(candidate, NOW)
    );
    const result = selectSuggestion(candidates, assessments);

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion).not.toBeNull();
    expect(result.alternatives).toHaveLength(1);
  });

  it("suggests the best eligible task without a minimum score gate", () => {
    const candidates = mergeTaskLineage([
      verifiedCandidateFixture({
        impact: "unknown",
        effort: "unknown",
        origin: "open_question"
      })
    ]);
    const assessments = candidates.map((candidate) =>
      scorePriority(candidate, NOW)
    );
    expect(assessments[0]?.score).toBeLessThan(50);

    const result = selectSuggestion(candidates, assessments);

    expect(result.status).toBe("suggested");
    expect(result.topSuggestion?.candidateId).toBe(candidates[0]?.id);
  });
});
