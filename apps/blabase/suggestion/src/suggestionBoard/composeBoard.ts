import {
  activeAttentionResultSchema,
  type ActiveAttentionResult
} from "../attentionDecision/contracts";
import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../crossSource/versions";
import type {
  ContinuationCandidateDerivationEnvelope,
  ContinuationCandidateDerivationResult
} from "../continuation/deriveCandidates";
import type {
  ContinuationIdentityInput,
  ContinuationIdentityResult
} from "../continuation/resolveIdentity";
import {
  continuationResolvedDecisionSchema,
  verifyContinuationDecisionAgainstInput,
  type ContinuationResolutionEnvelope,
  type ContinuationResolvedDecision
} from "../continuation/resolveContinuation";
import {
  WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
  WORK_SUGGESTION_BOARD_EXECUTION_POLICY,
  createWorkSuggestionBoardId,
  deriveWorkSuggestionBoardItems,
  sealWorkSuggestionBoardInput,
  sealWorkSuggestionBoardResult,
  workSuggestionBoardResultSchema,
  type WorkSuggestionBoardInput,
  type WorkSuggestionBoardResult
} from "./contracts";

const COMPOSITION_BUNDLE_KEYS = Object.freeze([
  "active",
  "continuationIdentityInput",
  "continuationIdentityResult",
  "continuationDerivationEnvelope",
  "continuationDerivationResult",
  "continuationResolutionEnvelope",
  "continuationResolvedDecision"
] as const);

export type WorkSuggestionBoardCompositionBundle = {
  active: ActiveAttentionResult;
  continuationIdentityInput: ContinuationIdentityInput;
  continuationIdentityResult: ContinuationIdentityResult;
  continuationDerivationEnvelope: ContinuationCandidateDerivationEnvelope;
  continuationDerivationResult: ContinuationCandidateDerivationResult;
  continuationResolutionEnvelope: ContinuationResolutionEnvelope;
  continuationResolvedDecision: ContinuationResolvedDecision;
};

export type WorkSuggestionBoardCompositionBoundaryResult =
  | { ok: true; board: WorkSuggestionBoardResult }
  | { ok: false; code: "WORK_SUGGESTION_BOARD_INPUT_REJECTED" };

/**
 * Authenticated B-001 boundary. It consumes the complete original R-001/R-002/
 * R-003 bundle and trusted resolver options, and never re-runs or rewrites the
 * independently sealed Active Attention result.
 */
export function composeWorkSuggestionBoard(
  bundleValue: unknown,
  trustedResolverOptionsValue: unknown
): WorkSuggestionBoardCompositionBoundaryResult {
  try {
    const bundle = readStrictCompositionBundle(bundleValue);
    if (bundle === null) return inputRejected();

    const active = bundle.active;
    const parsedActive = activeAttentionResultSchema.safeParse(active);
    if (
      !parsedActive.success ||
      runtimeCanonicalJson(parsedActive.data) !== runtimeCanonicalJson(active)
    ) {
      return inputRejected();
    }
    const activeCanonicalBefore = runtimeCanonicalJson(active);
    const activeResultSha256Before = active.resultSha256;

    // Authenticity must be established before this boundary reads the nested
    // `.decision` body. A locally rehashed outer artifact is not sufficient.
    if (
      !verifyContinuationDecisionAgainstInput(
        bundle.continuationIdentityInput,
        bundle.continuationIdentityResult,
        bundle.continuationDerivationEnvelope,
        bundle.continuationDerivationResult,
        bundle.continuationResolutionEnvelope,
        trustedResolverOptionsValue,
        bundle.continuationResolvedDecision
      )
    ) {
      return inputRejected();
    }

    const resolved = continuationResolvedDecisionSchema.safeParse(
      bundle.continuationResolvedDecision
    );
    if (
      !resolved.success ||
      runtimeCanonicalJson(resolved.data) !==
        runtimeCanonicalJson(bundle.continuationResolvedDecision) ||
      active.asOf !== resolved.data.decision.asOf
    ) {
      return inputRejected();
    }

    const sealedInput = sealWorkSuggestionBoardInput({
      contract: WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
      schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
      asOf: active.asOf,
      composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
      precedencePolicyVersion:
        WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
      idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
      active,
      continuation: bundle.continuationResolvedDecision
    });

    // Keep the exact caller-owned sealed lane artifacts in the Board input.
    // Zod parsing above is validation only; it must not become a reconstruction
    // authority for Active or the outer R-003 artifact.
    const input: WorkSuggestionBoardInput = {
      ...sealedInput,
      active,
      continuation:
        bundle.continuationResolvedDecision as ContinuationResolvedDecision
    };
    const {
      inputSha256: exactInputSha256,
      ...exactInputContent
    } = input;
    if (
      exactInputSha256 !==
      runtimeSha256({
        domain: WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
        value: exactInputContent
      })
    ) {
      return inputRejected();
    }
    const items = deriveWorkSuggestionBoardItems(input);
    const primary = items[0] ?? null;
    const sealedBoard = sealWorkSuggestionBoardResult({
      contract: WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
      schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
      boardId: createWorkSuggestionBoardId({
        inputSha256: input.inputSha256,
        composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
        precedencePolicyVersion:
          WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
        idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION
      }),
      asOf: input.asOf,
      composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
      precedencePolicyVersion:
        WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
      idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
      input,
      dependencies: {
        inputSha256: input.inputSha256,
        activeResultSha256: active.resultSha256,
        continuationResolvedResultSha256:
          input.continuation.resultSha256,
        continuationResultSha256:
          input.continuation.decision.resultSha256,
        continuationSemanticResultSha256:
          input.continuation.decision.semanticResultSha256
      },
      prominentLane: primary?.lane ?? "none",
      primary,
      alternatives: items.slice(1),
      executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
    });
    const board: WorkSuggestionBoardResult = {
      ...sealedBoard,
      input
    };

    if (
      active.resultSha256 !== activeResultSha256Before ||
      runtimeCanonicalJson(active) !== activeCanonicalBefore ||
      board.input.active !== active ||
      board.input.continuation !== bundle.continuationResolvedDecision ||
      !workSuggestionBoardResultSchema.safeParse(board).success
    ) {
      return inputRejected();
    }
    return { ok: true, board };
  } catch {
    return inputRejected();
  }
}

/**
 * Local schema/hash integrity is intentionally insufficient here. Authenticity
 * is checked by recomposing from the exact original chain and comparing the
 * complete canonical Board artifact.
 */
export function verifyWorkSuggestionBoardResultAgainstInput(
  bundleValue: unknown,
  trustedResolverOptionsValue: unknown,
  resultValue: unknown
): resultValue is WorkSuggestionBoardResult {
  try {
    const actual = workSuggestionBoardResultSchema.safeParse(resultValue);
    if (!actual.success) return false;
    const expected = composeWorkSuggestionBoard(
      bundleValue,
      trustedResolverOptionsValue
    );
    return (
      expected.ok &&
      runtimeCanonicalJson(actual.data) === runtimeCanonicalJson(expected.board)
    );
  } catch {
    return false;
  }
}

function readStrictCompositionBundle(
  value: unknown
): WorkSuggestionBoardCompositionBundle | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== COMPOSITION_BUNDLE_KEYS.length ||
    ownKeys.some((key) => typeof key !== "string") ||
    COMPOSITION_BUNDLE_KEYS.some((key) => !ownKeys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const fields: Record<string, unknown> = {};
  for (const key of COMPOSITION_BUNDLE_KEYS) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return null;
    fields[key] = descriptor.value;
  }
  return fields as unknown as WorkSuggestionBoardCompositionBundle;
}

function inputRejected(): WorkSuggestionBoardCompositionBoundaryResult {
  return { ok: false, code: "WORK_SUGGESTION_BOARD_INPUT_REJECTED" };
}
