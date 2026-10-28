import { describe, expect, it } from "vitest";

import {
  COMMON_SOURCE_VERIFICATION_SOURCE_ORDER_V0_4,
  classifyPreClaimDispositionInternalV0_4,
  convertProjectionCompletenessInternalV0_4,
  isCanonicalUtcMillisInternalV0_4,
  isNonNegativeSafeIntegerInternalV0_4,
  isPositiveSafeIntegerInternalV0_4,
  isSha256LowerHexInternalV0_4,
  type PreClaimDispositionFactsInternalV0_4,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceSourceVerificationV0_4.internal";

const BASE_FACTS: PreClaimDispositionFactsInternalV0_4 = Object.freeze({
  decisionAt: "2026-08-25T12:00:00.000Z",
  authoritativeCurrentGenerationId: "generation-2",
  generationFence: null,
  proofGenerationId: "generation-2",
  registeredAt: "2026-08-25T10:00:00.000Z",
  expiresAt: "2026-08-25T14:00:00.000Z",
  revokedAt: null,
});

function facts(
  overrides: Partial<PreClaimDispositionFactsInternalV0_4> = {},
): PreClaimDispositionFactsInternalV0_4 {
  return { ...BASE_FACTS, ...overrides };
}

describe("Common suggestion evidence source verification V0.4 internal kernel", () => {
  describe("primitive validators", () => {
    it("accepts only canonical real UTC millisecond timestamps", () => {
      expect(
        isCanonicalUtcMillisInternalV0_4("2024-02-29T23:59:59.999Z"),
      ).toBe(true);
      expect(
        isCanonicalUtcMillisInternalV0_4("2026-08-25T00:00:00.000Z"),
      ).toBe(true);

      for (const invalid of [
        "0000-01-01T00:00:00.000Z",
        "2026-02-29T00:00:00.000Z",
        "2026-13-01T00:00:00.000Z",
        "2026-08-25T24:00:00.000Z",
        "2026-08-25T00:00:60.000Z",
        "2026-08-25T00:00:00Z",
        "2026-08-25T00:00:00.00Z",
        "2026-08-25T00:00:00.0000Z",
        "2026-08-25t00:00:00.000z",
        "2026-08-25T00:00:00.000+00:00",
        " 2026-08-25T00:00:00.000Z",
        null,
      ]) {
        expect(isCanonicalUtcMillisInternalV0_4(invalid)).toBe(false);
      }
    });

    it("distinguishes non-negative and positive safe integers", () => {
      for (const valid of [0, 1, Number.MAX_SAFE_INTEGER]) {
        expect(isNonNegativeSafeIntegerInternalV0_4(valid)).toBe(true);
      }
      for (const invalid of [
        -0,
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
      ]) {
        expect(isNonNegativeSafeIntegerInternalV0_4(invalid)).toBe(false);
      }

      expect(isPositiveSafeIntegerInternalV0_4(1)).toBe(true);
      expect(
        isPositiveSafeIntegerInternalV0_4(Number.MAX_SAFE_INTEGER),
      ).toBe(true);
      for (const invalid of [0, -0, -1, 0.5, Number.NaN]) {
        expect(isPositiveSafeIntegerInternalV0_4(invalid)).toBe(false);
      }
    });

    it("accepts only exact lowercase SHA-256 hex", () => {
      expect(isSha256LowerHexInternalV0_4("a".repeat(64))).toBe(true);
      expect(isSha256LowerHexInternalV0_4("01".repeat(32))).toBe(true);

      for (const invalid of [
        "A".repeat(64),
        "a".repeat(63),
        "a".repeat(65),
        `0x${"a".repeat(64)}`,
        `${"a".repeat(64)} `,
        null,
      ]) {
        expect(isSha256LowerHexInternalV0_4(invalid)).toBe(false);
      }
    });

    it("does not delegate validation to a mutated RegExp exec", () => {
      const originalExec = RegExp.prototype.exec;
      let timestampResult: boolean | undefined;
      let shaResult: boolean | undefined;

      try {
        RegExp.prototype.exec = function tamperedExec(
          this: RegExp,
          _value: string,
        ): RegExpExecArray | null {
          throw new Error("mutated RegExp.prototype.exec was invoked");
        };
        timestampResult = isCanonicalUtcMillisInternalV0_4(
          "2026-02-29T00:00:00.000Z",
        );
        shaResult = isSha256LowerHexInternalV0_4("A".repeat(64));
      } finally {
        RegExp.prototype.exec = originalExec;
      }

      expect(timestampResult).toBe(false);
      expect(shaResult).toBe(false);
    });
  });

  describe("pre-claim disposition", () => {
    it("terminalizes equal or reversed proof intervals before every other fault", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({
            registeredAt: "2026-08-25T14:00:00.000Z",
            expiresAt: "2026-08-25T14:00:00.000Z",
            revokedAt: "2026-08-25T13:00:00.000Z",
            proofGenerationId: "generation-1",
            generationFence: {
              invalidatedGenerationId: "generation-1",
              successorGenerationId: "generation-2",
              invalidatedAt: "2026-08-25T11:00:00.000Z",
              fenceEpoch: 1,
              state: "committed",
            },
          }),
        ),
      ).toEqual({
        disposition: "terminalize_invalid_interval",
        failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
        failureDetail: "context_binding_invalid",
        terminalState: "invalid",
        terminalReason: "proof_interval_invalid",
        deletionBoundaryAtSource: "winning_cas_decision_at",
        normalClaimPermitted: false,
        disposalRequired: true,
      });

      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({ revokedAt: "2026-08-25T10:00:00.000Z" }),
        ).disposition,
      ).toBe("terminalize_invalid_interval");
    });

    it("prioritizes a committed matching generation fence over lifecycle time faults", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({
            decisionAt: "2026-08-25T15:00:00.000Z",
            expiresAt: "2026-08-25T14:00:00.000Z",
            revokedAt: "2026-08-25T13:00:00.000Z",
            proofGenerationId: "generation-1",
            generationFence: {
              invalidatedGenerationId: "generation-1",
              successorGenerationId: "generation-2",
              invalidatedAt: "2026-08-25T11:00:00.000Z",
              fenceEpoch: 1,
              state: "committed",
            },
          }),
        ),
      ).toEqual({
        disposition: "terminalize_generation_stale",
        failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
        failureDetail: "context_binding_invalid",
        terminalState: "generation_stale",
        terminalReason: "proof_generation_stale",
        deletionBoundaryAtSource:
          "authoritative_generation_invalidated_at",
        normalClaimPermitted: false,
        disposalRequired: true,
      });
    });

    it("requires every generation-stale predicate", () => {
      const matchingFence = {
        invalidatedGenerationId: "generation-1",
        successorGenerationId: "generation-2",
        invalidatedAt: "2026-08-25T11:00:00.000Z",
        fenceEpoch: 1,
        state: "committed",
      } as const;

      const nonStaleCases: readonly PreClaimDispositionFactsInternalV0_4[] = [
        facts({
          proofGenerationId: "generation-1",
          generationFence: null,
        }),
        facts({
          proofGenerationId: "generation-1",
          generationFence: {
            ...matchingFence,
            invalidatedGenerationId: "generation-0",
          },
        }),
        facts({
          proofGenerationId: "generation-2",
          generationFence: {
            ...matchingFence,
            invalidatedGenerationId: "generation-2",
          },
        }),
      ];

      for (const candidate of nonStaleCases) {
        expect(
          classifyPreClaimDispositionInternalV0_4(candidate).disposition,
        ).toBe("eligible");
      }
    });

    it("prioritizes generation stale over an otherwise valid future-issued proof", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({
            decisionAt: "2026-08-25T09:59:59.999Z",
            proofGenerationId: "generation-1",
            generationFence: {
              invalidatedGenerationId: "generation-1",
              successorGenerationId: "generation-2",
              invalidatedAt: "2026-08-25T09:00:00.000Z",
              fenceEpoch: 1,
              state: "committed",
            },
          }),
        ).disposition,
      ).toBe("terminalize_generation_stale");
    });

    it("terminalizes a strictly reversed registration and expiry interval", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({
            registeredAt: "2026-08-25T14:00:00.001Z",
            expiresAt: "2026-08-25T14:00:00.000Z",
          }),
        ).disposition,
      ).toBe("terminalize_invalid_interval");
    });

    it("treats revocation equality as revoked and lets revoked win over expired", () => {
      const result = classifyPreClaimDispositionInternalV0_4(
        facts({
          decisionAt: "2026-08-25T14:00:00.000Z",
          expiresAt: "2026-08-25T14:00:00.000Z",
          revokedAt: "2026-08-25T14:00:00.000Z",
        }),
      );

      expect(result).toEqual({
        disposition: "terminalize_revoked",
        failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
        failureDetail: "context_binding_invalid",
        terminalState: "revoked",
        terminalReason: "proof_revoked",
        deletionBoundaryAtSource: "proof_revoked_at",
        normalClaimPermitted: false,
        disposalRequired: true,
      });
    });

    it("treats expiry equality as expired", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({ decisionAt: "2026-08-25T14:00:00.000Z" }),
        ),
      ).toEqual({
        disposition: "terminalize_expired",
        failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
        failureDetail: "context_binding_invalid",
        terminalState: "expired",
        terminalReason: "proof_expired",
        deletionBoundaryAtSource: "proof_expires_at",
        normalClaimPermitted: false,
        disposalRequired: true,
      });
    });

    it("terminalizes strict standalone revocation and expiry", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({ revokedAt: "2026-08-25T11:59:59.999Z" }),
        ).disposition,
      ).toBe("terminalize_revoked");
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({ decisionAt: "2026-08-25T14:00:00.001Z" }),
        ).disposition,
      ).toBe("terminalize_expired");
    });

    it("rejects future-issued proofs without terminalization or disposal", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({
            decisionAt: "2026-08-25T09:59:59.999Z",
          }),
        ),
      ).toEqual({
        disposition: "reject_future_issued",
        failureCode: "PRIVACY_SCOPE_CONTEXT_INVALID",
        failureDetail: "context_binding_invalid",
        terminalState: null,
        terminalReason: null,
        deletionBoundaryAtSource: null,
        normalClaimPermitted: false,
        disposalRequired: false,
      });
    });

    it("permits a proof at its exact registration time", () => {
      expect(
        classifyPreClaimDispositionInternalV0_4(
          facts({ decisionAt: "2026-08-25T10:00:00.000Z" }),
        ),
      ).toEqual({
        disposition: "eligible",
        failureCode: null,
        failureDetail: null,
        terminalState: null,
        terminalReason: null,
        deletionBoundaryAtSource: null,
        normalClaimPermitted: true,
        disposalRequired: false,
      });
    });

    it("returns deterministic frozen singleton dispositions", () => {
      const first = classifyPreClaimDispositionInternalV0_4(BASE_FACTS);
      const second = classifyPreClaimDispositionInternalV0_4(BASE_FACTS);

      expect(first).toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
    });
  });

  describe("projection completeness", () => {
    it("implements the complete four-row conversion table", () => {
      expect(
        convertProjectionCompletenessInternalV0_4({
          coverageStatus: "unknown",
          applicableAllowedTextSpans: [{ wasTruncated: true }],
        }),
      ).toBe("unknown");
      expect(
        convertProjectionCompletenessInternalV0_4({
          coverageStatus: "partial",
          applicableAllowedTextSpans: [],
        }),
      ).toBe("truncated");
      expect(
        convertProjectionCompletenessInternalV0_4({
          coverageStatus: "complete",
          applicableAllowedTextSpans: [
            { wasTruncated: false },
            { wasTruncated: true },
          ],
        }),
      ).toBe("truncated");
      expect(
        convertProjectionCompletenessInternalV0_4({
          coverageStatus: "complete",
          applicableAllowedTextSpans: [{ wasTruncated: false }],
        }),
      ).toBe("complete");
      expect(
        convertProjectionCompletenessInternalV0_4({
          coverageStatus: "complete",
          applicableAllowedTextSpans: [],
        }),
      ).toBe("complete");
    });

    it("does not use a mutated inherited array iterator", () => {
      const spans = Object.freeze([
        Object.freeze({ wasTruncated: false }),
        Object.freeze({ wasTruncated: true }),
      ]);
      const originalIterator = Array.prototype[Symbol.iterator];
      let result: "unknown" | "truncated" | "complete" | undefined;

      try {
        Array.prototype[Symbol.iterator] = (function* tamperedArrayIterator() {
          return;
        }) as typeof Array.prototype[typeof Symbol.iterator];
        result = convertProjectionCompletenessInternalV0_4({
          coverageStatus: "complete",
          applicableAllowedTextSpans: spans,
        });
      } finally {
        Array.prototype[Symbol.iterator] = originalIterator;
      }

      expect(result).toBe("truncated");
    });
  });

  it("keeps the frozen canonical source order", () => {
    expect(COMMON_SOURCE_VERIFICATION_SOURCE_ORDER_V0_4).toEqual([
      "github",
      "codex",
      "google_calendar",
      "notion",
      "dayflow",
    ]);
    expect(
      Object.isFrozen(COMMON_SOURCE_VERIFICATION_SOURCE_ORDER_V0_4),
    ).toBe(true);
  });
});
