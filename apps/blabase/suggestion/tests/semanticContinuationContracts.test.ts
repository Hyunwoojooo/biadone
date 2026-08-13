import { describe, expect, it } from "vitest";

import {
  createSemanticContinuationIntentDecision,
  isSafeSemanticContinuationPublicTitle,
  semanticContinuationConfirmationInputSchema,
  semanticContinuationIntentDecisionSchema,
  semanticContinuationTitle
} from "../src/semanticContinuation";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const OBSERVED_AT = "2026-08-13T10:00:00.000Z";
const CONFIRMED_AT = "2026-08-13T12:00:00.000Z";

describe("Semantic Continuation contracts", () => {
  it("accepts only an explicit QA_RUN confirmation and derives one title", () => {
    const confirmation = semanticContinuationConfirmationInputSchema.parse({
      intent: "QA_RUN",
      subjectLabel: "blabase",
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    });

    expect(semanticContinuationTitle(confirmation.subjectLabel)).toBe(
      "blabase QA 진행하기"
    );
    expect(
      isSafeSemanticContinuationPublicTitle("blabase QA 진행하기")
    ).toBe(true);
    expect(
      semanticContinuationConfirmationInputSchema.safeParse({
        ...confirmation,
        explicitUserConfirmation: false
      }).success
    ).toBe(false);
    expect(
      semanticContinuationConfirmationInputSchema.safeParse({
        ...confirmation,
        intent: "APPLY_RESULT"
      }).success
    ).toBe(false);
  });

  it("rejects URL, path, control, private-ref, hash, and credential labels", () => {
    for (const subjectLabel of [
      "https://private.example/repo",
      "/Users/private/repo",
      "../private-project",
      "./private-project",
      "owner/private-project",
      "owner\\private-project",
      "line\nbreak",
      "bidi\u202ereversed",
      `session_${"c".repeat(32)}`,
      `client_${"c".repeat(32)}`,
      `action_ref_${"c".repeat(32)}`,
      `claim_${"c".repeat(32)}`,
      "QA 실패 결과",
      "QA 통과 완료",
      "Apply result",
      "result_apply",
      "completed release",
      "QAPassed",
      "testFailure",
      "resultApply",
      "completionStatus",
      "d".repeat(40),
      `ghp_${"e".repeat(24)}`,
      "token=syntheticSecret123",
      " surrounded "
    ]) {
      expect(
        semanticContinuationConfirmationInputSchema.safeParse({
          intent: "QA_RUN",
          subjectLabel,
          itemRef: ITEM_REF,
          workContextRef: CONTEXT_REF,
          explicitUserConfirmation: true
        }).success
      ).toBe(false);
    }
  });

  it("binds the base target and clamps expiry to candidate expiry", () => {
    const decision = createSemanticContinuationIntentDecision({
      confirmation: {
        intent: "QA_RUN",
        subjectLabel: "blabase",
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        explicitUserConfirmation: true
      },
      target: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        observedAt: OBSERVED_AT,
        candidateExpiresAt: "2026-08-14T06:00:00.000Z"
      },
      registrySha256: "f".repeat(64),
      confirmedAt: CONFIRMED_AT,
      supersedesDecisionId: null
    });

    expect(decision.expiresAt).toBe("2026-08-14T06:00:00.000Z");
    expect(semanticContinuationIntentDecisionSchema.parse(decision)).toEqual(
      decision
    );
    expect(
      semanticContinuationIntentDecisionSchema.safeParse({
        ...decision,
        registrySha256: "0".repeat(64)
      }).success
    ).toBe(false);

    const ttlClamped = createSemanticContinuationIntentDecision({
      confirmation: {
        intent: "QA_RUN",
        subjectLabel: "blabase",
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        explicitUserConfirmation: true
      },
      target: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        observedAt: OBSERVED_AT,
        candidateExpiresAt: "2026-08-15T12:00:00.000Z"
      },
      registrySha256: "f".repeat(64),
      confirmedAt: CONFIRMED_AT,
      supersedesDecisionId: null
    });
    expect(ttlClamped.expiresAt).toBe("2026-08-14T12:00:00.000Z");
  });
});
