import {
  deepFreezeLineageInternalV0_1,
  inspectReceiptIntrinsicInternalV0_1,
  parseReceiptStructuralInternalV0_1,
  planSourceVerificationInternalV0_1,
  type CommonSuggestionEvidenceLineageReceiptV0_1,
  type InspectReceiptIntrinsicInternalResultV0_1,
  type LineageFailureCodeV0_1,
  type PlanSourceVerificationInternalResultV0_1,
} from "./commonSuggestionEvidenceLineageV0_1.internal";

export type {
  CommonSuggestionEvidenceLineageReceiptV0_1,
  LineageFailureCodeV0_1,
};

export type CommonSuggestionEvidenceLineageStructuralParseResultV0_1 =
  | Readonly<{
      success: true;
      data: CommonSuggestionEvidenceLineageReceiptV0_1;
    }>
  | Readonly<{
      success: false;
      error: Readonly<{
        issues: readonly [
          Readonly<{
            code: "custom";
            message: LineageFailureCodeV0_1;
            path: readonly [];
          }>,
        ];
      }>;
    }>;

function structuralFailure(
  failureCode: LineageFailureCodeV0_1,
): CommonSuggestionEvidenceLineageStructuralParseResultV0_1 {
  return deepFreezeLineageInternalV0_1({
    success: false,
    error: {
      issues: [
        {
          code: "custom",
          message: failureCode,
          path: [],
        },
      ],
    },
  });
}

export const commonSuggestionEvidenceLineageReceiptStructuralSchemaV0_1:
  Readonly<{
    safeParse(
      input: unknown,
    ): CommonSuggestionEvidenceLineageStructuralParseResultV0_1;
  }> = Object.freeze({
    safeParse(
      input: unknown,
    ): CommonSuggestionEvidenceLineageStructuralParseResultV0_1 {
      const result = parseReceiptStructuralInternalV0_1(input);
      return result.ok
        ? deepFreezeLineageInternalV0_1({
            success: true,
            data: result.value,
          })
        : structuralFailure(result.failureCode);
    },
  });

export type InspectCommonSuggestionEvidenceLineageReceiptIntrinsicResultV0_1 =
  InspectReceiptIntrinsicInternalResultV0_1;

export function inspectCommonSuggestionEvidenceLineageReceiptIntrinsicV0_1(
  input: unknown,
): InspectCommonSuggestionEvidenceLineageReceiptIntrinsicResultV0_1 {
  return inspectReceiptIntrinsicInternalV0_1(input);
}

export type PlanCommonSuggestionEvidenceLineageSourceVerificationResultV0_1 =
  PlanSourceVerificationInternalResultV0_1;

export function planCommonSuggestionEvidenceLineageSourceVerificationV0_1(
  receipt: unknown,
  recordSet: unknown,
  sourceVerificationBundles: unknown,
): PlanCommonSuggestionEvidenceLineageSourceVerificationResultV0_1 {
  return planSourceVerificationInternalV0_1(
    receipt,
    recordSet,
    sourceVerificationBundles,
  );
}
