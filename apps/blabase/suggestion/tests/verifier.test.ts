import { describe, expect, it } from "vitest";

import { verifyTaskCandidates } from "../src/verifyCandidates";
import {
  conversationFixture,
  rawCandidateFixture
} from "./helpers";

describe("task evidence verifier", () => {
  it("records exact evidence spans for a direct user task", () => {
    const conversation = conversationFixture();
    const [verified] = verifyTaskCandidates(conversation, [
      rawCandidateFixture()
    ]);

    expect(verified.verificationIssues).toEqual([]);
    expect(verified.evidence[0]).toMatchObject({
      conversationId: conversation.id,
      messageIndex: 1,
      role: "user"
    });
    expect(verified.evidence[0]?.endChar).toBeGreaterThan(
      verified.evidence[0]?.startChar ?? 0
    );
  });

  it("blocks assistant-only evidence from becoming a user task", () => {
    const conversation = conversationFixture({
      assistantText: "계약서를 검토하고 회신해야 해."
    });
    const [verified] = verifyTaskCandidates(conversation, [
      rawCandidateFixture({
        evidence: [
          {
            kind: "task",
            messageIndex: 2,
            quote: "계약서를 검토하고 회신해야 해"
          }
        ]
      })
    ]);

    expect(verified.verificationIssues).toContain(
      "ASSISTANT_ONLY_USER_TASK"
    );
    expect(verified.verificationIssues).toContain("USER_EVIDENCE_REQUIRED");
  });

  it("rejects invented deadline source text", () => {
    const [verified] = verifyTaskCandidates(conversationFixture(), [
      rawCandidateFixture({
        deadlineKind: "relative",
        deadlineText: "내일 오전 9시"
      })
    ]);

    expect(verified.verificationIssues).toContain(
      "DEADLINE_SOURCE_NOT_VERIFIED"
    );
  });
});
