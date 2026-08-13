import { z } from "zod";

import {
  activeAttentionResultSchema,
  type ActiveAttentionResult
} from "../attentionDecision/contracts";
import {
  continuationMvpPublicCapabilitySchema,
  continuationPrivateActionTargetSchema,
  continuationPublicItemSchema,
  type ContinuationDecision
} from "../continuation/contracts";
import {
  continuationResolvedDecisionSchema,
  type ContinuationResolvedDecision
} from "../continuation/resolveContinuation";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT,
  WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../crossSource/versions";

export const WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN =
  "work-suggestion-board-input-hash-v0.3" as const;
export const WORK_SUGGESTION_BOARD_RESULT_HASH_DOMAIN =
  "work-suggestion-board-result-hash-v0.3" as const;
export const WORK_SUGGESTION_BOARD_SEMANTIC_RESULT_HASH_DOMAIN =
  "work-suggestion-board-semantic-result-hash-v0.3" as const;
export const WORK_SUGGESTION_BOARD_ID_DOMAIN =
  "work-suggestion-board-id-v0.1" as const;
export const WORK_SUGGESTION_BOARD_ITEM_ID_DOMAIN =
  "work-suggestion-board-item-id-v0.1" as const;
export const WORK_SUGGESTION_BOARD_SOURCE_REF_DOMAIN =
  "work-suggestion-board-source-ref-v0.1" as const;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const workContextIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/u);
const boardIdSchema = z.string().regex(/^work_board_[a-f0-9]{32}$/u);
const boardItemIdSchema = z.string().regex(/^board_item_[a-f0-9]{32}$/u);
const boardSourceRefSchema = z
  .string()
  .regex(/^board_source_[a-f0-9]{32}$/u);
const publicItemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const publicWorkContextRefSchema = z
  .string()
  .regex(/^context_ref_[A-Za-z0-9_-]{22,128}$/u);
const reasonCodeSchema = z.string().regex(/^[A-Z0-9_]{1,80}$/u);
const NON_CANONICAL_BOUNDARY_VALUE = Object.freeze({
  nonCanonicalWorkSuggestionBoardBoundaryValue: true
});

const publicSafeTextForbiddenPatterns = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:session_|run_|analysis_|evidence_|source_ref_|managed_run_|continuation_observation_|continuation_candidate_)[A-Za-z0-9_-]*/u
] as const;

export const workSuggestionBoardLaneSchema = z.enum([
  "attention",
  "continuation",
  "setup"
]);

export const workSuggestionBoardProminentLaneSchema = z.enum([
  "attention",
  "continuation",
  "setup",
  "none"
]);

export const workSuggestionBoardExecutionPolicySchema = z
  .object({
    automaticExecutionAllowed: z.literal(false),
    explicitUserActionRequired: z.literal(true),
    externalMutationAllowed: z.literal(false)
  })
  .strict();

export const WORK_SUGGESTION_BOARD_EXECUTION_POLICY = {
  automaticExecutionAllowed: false,
  explicitUserActionRequired: true,
  externalMutationAllowed: false
} as const;

const boardItemObjectSchema = z
  .object({
    boardItemId: boardItemIdSchema,
    lane: workSuggestionBoardLaneSchema,
    sourceItemRef: boardSourceRefSchema,
    workContextId: workContextIdSchema.nullable(),
    localDisplayLabel: z.string().trim().min(1).max(120),
    summary: publicSafeTextSchema(240),
    observedAt: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    evidenceBand: z.enum([
      "verified_attention",
      "exact",
      "corroborated",
      "single_source",
      "setup"
    ]),
    capability: continuationMvpPublicCapabilitySchema,
    privateActionTarget: continuationPrivateActionTargetSchema.nullable()
  })
  .strict();

export const workSuggestionBoardItemSchema = failClosedCanonicalBoundary(
  boardItemObjectSchema.superRefine((item, context) => {
    refineComputedStringIntegrity(
      item.boardItemId,
      () =>
        createWorkSuggestionBoardItemId({
          lane: item.lane,
          sourceItemRef: item.sourceItemRef,
          workContextId: item.workContextId
        }),
      context,
      ["boardItemId"],
      "Board item ID mismatch"
    );

    const evidenceMatchesLane =
      (item.lane === "attention" &&
        item.evidenceBand === "verified_attention") ||
      (item.lane === "setup" && item.evidenceBand === "setup") ||
      (item.lane === "continuation" &&
        ["exact", "corroborated", "single_source"].includes(
          item.evidenceBand
        ));
    if (!evidenceMatchesLane) {
      addIssue(
        context,
        ["evidenceBand"],
        "Board lane and evidence band must agree"
      );
    }
    if (item.summary !== item.localDisplayLabel) {
      addIssue(
        context,
        ["summary"],
        "Board summary must exactly preserve the source display label"
      );
    }
    if (
      (item.capability === "display") !==
      (item.privateActionTarget === null)
    ) {
      addIssue(
        context,
        ["privateActionTarget"],
        "Board actions must preserve an exact bounded source target"
      );
    }
    if (
      item.privateActionTarget !== null &&
      item.privateActionTarget.capability !== item.capability
    ) {
      addIssue(
        context,
        ["privateActionTarget"],
        "Board capability cannot elevate or rewrite its source target"
      );
    }
  })
);

const boardInputContentObjectSchema = z
  .object({
    contract: z.literal(WORK_SUGGESTION_BOARD_INPUT_CONTRACT),
    schemaVersion: z.literal(WORK_SUGGESTION_BOARD_SCHEMA_VERSION),
    asOf: timestampSchema,
    composerVersion: z.literal(WORK_SUGGESTION_BOARD_COMPOSER_VERSION),
    precedencePolicyVersion: z.literal(
      WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(WORK_SUGGESTION_BOARD_ID_POLICY_VERSION),
    active: activeAttentionResultSchema,
    continuation: continuationResolvedDecisionSchema
  })
  .strict();

export const workSuggestionBoardInputContentSchema =
  failClosedCanonicalBoundary(
    boardInputContentObjectSchema.superRefine((input, context) => {
      if (
        input.active.asOf !== input.asOf ||
        input.continuation.decision.asOf !== input.asOf
      ) {
        addIssue(
          context,
          ["asOf"],
          "Board lanes must share one exact as-of timestamp"
        );
      }
    })
  );

const boardInputSealedObjectSchema = boardInputContentObjectSchema
  .extend({ inputSha256: sha256Schema })
  .strict();

export const workSuggestionBoardInputSchema = failClosedCanonicalBoundary(
  boardInputSealedObjectSchema.superRefine((input, context) => {
    if (
      input.active.asOf !== input.asOf ||
      input.continuation.decision.asOf !== input.asOf
    ) {
      addIssue(
        context,
        ["asOf"],
        "Board lanes must share one exact as-of timestamp"
      );
    }
    refineComputedStringIntegrity(
      input.inputSha256,
      () => digestBoardInputUnchecked(input),
      context,
      ["inputSha256"],
      "Board input hash mismatch"
    );
  })
);

export const workSuggestionBoardDependenciesSchema = z
  .object({
    inputSha256: sha256Schema,
    activeResultSha256: sha256Schema,
    continuationResolvedResultSha256: sha256Schema,
    continuationResultSha256: sha256Schema,
    continuationSemanticResultSha256: sha256Schema
  })
  .strict();

const boardResultContentObjectSchema = z
  .object({
    contract: z.literal(WORK_SUGGESTION_BOARD_RESULT_CONTRACT),
    schemaVersion: z.literal(WORK_SUGGESTION_BOARD_SCHEMA_VERSION),
    boardId: boardIdSchema,
    asOf: timestampSchema,
    composerVersion: z.literal(WORK_SUGGESTION_BOARD_COMPOSER_VERSION),
    precedencePolicyVersion: z.literal(
      WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(WORK_SUGGESTION_BOARD_ID_POLICY_VERSION),
    input: workSuggestionBoardInputSchema,
    dependencies: workSuggestionBoardDependenciesSchema,
    prominentLane: workSuggestionBoardProminentLaneSchema,
    primary: workSuggestionBoardItemSchema.nullable(),
    alternatives: z.array(workSuggestionBoardItemSchema).max(2),
    executionPolicy: workSuggestionBoardExecutionPolicySchema
  })
  .strict();

export const workSuggestionBoardResultContentSchema =
  failClosedCanonicalBoundary(
    boardResultContentObjectSchema.superRefine(refineBoardResult)
  );

const boardResultSealedObjectSchema = boardResultContentObjectSchema
  .extend({
    semanticResultSha256: sha256Schema,
    resultSha256: sha256Schema
  })
  .strict();

export const workSuggestionBoardResultSchema = failClosedCanonicalBoundary(
  boardResultSealedObjectSchema.superRefine((result, context) => {
    refineBoardResult(result, context);
    refineComputedStringIntegrity(
      result.semanticResultSha256,
      () => digestBoardResultSemanticUnchecked(result),
      context,
      ["semanticResultSha256"],
      "Board semantic result hash mismatch"
    );
    refineComputedStringIntegrity(
      result.resultSha256,
      () => digestBoardResultArtifactUnchecked(result),
      context,
      ["resultSha256"],
      "Board result hash mismatch"
    );
  })
);

const publicAttentionItemObjectSchema = z
  .object({
    itemRef: publicItemRefSchema,
    workContextRef: publicWorkContextRefSchema.nullable(),
    kind: z.enum(["active_attention", "attention_clarification"]),
    title: publicSafeTextSchema(120),
    summary: publicSafeTextSchema(240),
    observedAt: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    evidenceBand: z.literal("verified_attention"),
    capability: z.literal("display"),
    action: z.null(),
    caveatCodes: z.array(reasonCodeSchema).max(8)
  })
  .strict();

export const workSuggestionBoardPublicAttentionItemSchema =
  publicAttentionItemObjectSchema.superRefine((item, context) => {
    if (item.summary !== item.title) {
      addIssue(
        context,
        ["summary"],
        "Public Board summary must exactly preserve its title"
      );
    }
    if (!isCanonicalUnique(item.caveatCodes)) {
      addIssue(
        context,
        ["caveatCodes"],
        "Public caveats must be canonical and unique"
      );
    }
  });

const publicAttentionBoardItemSchema = z
  .object({
    lane: z.literal("attention"),
    item: workSuggestionBoardPublicAttentionItemSchema
  })
  .strict();

const publicContinuationBoardItemSchema = z
  .object({
    lane: z.enum(["continuation", "setup"]),
    item: continuationPublicItemSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.item.summary !== value.item.title) {
      addIssue(
        context,
        ["item", "summary"],
        "Public Board summary must exactly preserve its title"
      );
    }
    const isSetup = value.item.evidenceBand === "setup";
    if ((value.lane === "setup") !== isSetup) {
      addIssue(
        context,
        ["lane"],
        "Public continuation lane and evidence band must agree"
      );
    }
  });

export const workSuggestionBoardPublicItemSchema = z.union([
  publicAttentionBoardItemSchema,
  publicContinuationBoardItemSchema
]);

const publicBoardObjectSchema = z
  .object({
    contract: z.literal(WORK_SUGGESTION_BOARD_PUBLIC_CONTRACT),
    schemaVersion: z.literal(WORK_SUGGESTION_BOARD_PUBLIC_SCHEMA_VERSION),
    generatedAt: timestampSchema,
    prominentLane: workSuggestionBoardProminentLaneSchema,
    primary: workSuggestionBoardPublicItemSchema.nullable(),
    alternatives: z.array(workSuggestionBoardPublicItemSchema).max(2),
    continuationStatus: z.enum(["available", "empty", "unavailable"]),
    executionPolicy: workSuggestionBoardExecutionPolicySchema
  })
  .strict();

export const workSuggestionBoardPublicSchema =
  publicBoardObjectSchema.superRefine((board, context) => {
    if (
      board.prominentLane === "none" ? board.primary !== null :
        board.primary === null || board.primary.lane !== board.prominentLane
    ) {
      addIssue(
        context,
        ["primary"],
        "Public Board primary must match its prominent lane"
      );
    }
    if (board.prominentLane === "none" && board.alternatives.length > 0) {
      addIssue(
        context,
        ["alternatives"],
        "An empty public Board cannot have alternatives"
      );
    }
    if (
      board.prominentLane === "none" &&
      board.primary === null &&
      board.alternatives.length === 0 &&
      board.continuationStatus === "available"
    ) {
      addIssue(
        context,
        ["continuationStatus"],
        "An empty public Board cannot report available Continuation"
      );
    }
    const publicItems = [
      ...(board.primary === null ? [] : [board.primary]),
      ...board.alternatives
    ];
    const hasAttention = publicItems.some(
      (item) => item.lane === "attention"
    );
    const hasContinuation = publicItems.some(
      (item) => item.lane === "continuation" || item.lane === "setup"
    );
    if (
      hasAttention &&
      (board.prominentLane !== "attention" ||
        board.primary?.lane !== "attention")
    ) {
      addIssue(
        context,
        ["primary"],
        "Any public Attention item requires an Attention primary"
      );
    }
    if (hasContinuation && board.continuationStatus !== "available") {
      addIssue(
        context,
        ["continuationStatus"],
        "Visible Continuation or Setup requires available status"
      );
    }
    if (
      board.continuationStatus !== "available" &&
      hasContinuation
    ) {
      addIssue(
        context,
        ["alternatives"],
        "Empty or unavailable Continuation cannot expose Board items"
      );
    }
    if (!isValidPublicSequence(board.alternatives, board.primary)) {
      addIssue(
        context,
        ["alternatives"],
        "Public Board alternatives must preserve precedence and uniqueness"
      );
    }
  });

export type WorkSuggestionBoardLane = z.infer<
  typeof workSuggestionBoardLaneSchema
>;
export type WorkSuggestionBoardItem = z.infer<
  typeof workSuggestionBoardItemSchema
>;
export type WorkSuggestionBoardInputContent = z.infer<
  typeof workSuggestionBoardInputContentSchema
>;
export type WorkSuggestionBoardInput = z.infer<
  typeof workSuggestionBoardInputSchema
>;
export type WorkSuggestionBoardResultContent = z.infer<
  typeof workSuggestionBoardResultContentSchema
>;
export type WorkSuggestionBoardResult = z.infer<
  typeof workSuggestionBoardResultSchema
>;
type WorkSuggestionBoardResultArtifactContent =
  WorkSuggestionBoardResultContent & {
    semanticResultSha256: string;
  };
export type WorkSuggestionBoardPublic = z.infer<
  typeof workSuggestionBoardPublicSchema
>;

export function createWorkSuggestionBoardSourceItemRef(input: {
  lane: WorkSuggestionBoardLane;
  sourceStableId: string;
}): string {
  return runtimeStableId(
    "board_source",
    WORK_SUGGESTION_BOARD_SOURCE_REF_DOMAIN,
    input
  );
}

export function createWorkSuggestionBoardItemId(input: {
  lane: WorkSuggestionBoardLane;
  sourceItemRef: string;
  workContextId: string | null;
}): string {
  return runtimeStableId(
    "board_item",
    WORK_SUGGESTION_BOARD_ITEM_ID_DOMAIN,
    input
  );
}

export function createWorkSuggestionBoardId(input: {
  inputSha256: string;
  composerVersion: typeof WORK_SUGGESTION_BOARD_COMPOSER_VERSION;
  precedencePolicyVersion: typeof WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION;
  idPolicyVersion: typeof WORK_SUGGESTION_BOARD_ID_POLICY_VERSION;
}): string {
  return runtimeStableId(
    "work_board",
    WORK_SUGGESTION_BOARD_ID_DOMAIN,
    input
  );
}

export function workSuggestionBoardInputSha256(
  value: WorkSuggestionBoardInputContent | WorkSuggestionBoardInput
): string {
  const parsed = workSuggestionBoardInputContentSchema.parse(
    withoutField(value, "inputSha256")
  );
  return digestBoardInputUnchecked(parsed);
}

export function sealWorkSuggestionBoardInput(
  content: WorkSuggestionBoardInputContent
): WorkSuggestionBoardInput {
  const parsed = workSuggestionBoardInputContentSchema.parse(content);
  return workSuggestionBoardInputSchema.parse({
    ...parsed,
    inputSha256: digestBoardInputUnchecked(parsed)
  });
}

export function verifyWorkSuggestionBoardInputIntegrity(
  value: unknown
): value is WorkSuggestionBoardInput {
  try {
    return workSuggestionBoardInputSchema.safeParse(value).success;
  } catch {
    return false;
  }
}

export function workSuggestionBoardResultSha256(
  value: WorkSuggestionBoardResultContent | WorkSuggestionBoardResult
): string {
  const parsed = workSuggestionBoardResultContentSchema.parse(
    withoutBoardResultHashes(value)
  );
  const artifactContent: WorkSuggestionBoardResultArtifactContent = {
    ...parsed,
    semanticResultSha256:
      "semanticResultSha256" in value
        ? value.semanticResultSha256
        : digestBoardResultSemanticUnchecked(parsed)
  };
  return digestBoardResultArtifactUnchecked(artifactContent);
}

export function workSuggestionBoardResultSemanticSha256(
  value: WorkSuggestionBoardResultContent | WorkSuggestionBoardResult
): string {
  const parsed = workSuggestionBoardResultContentSchema.parse(
    withoutBoardResultHashes(value)
  );
  return digestBoardResultSemanticUnchecked(parsed);
}

export function sealWorkSuggestionBoardResult(
  content: WorkSuggestionBoardResultContent
): WorkSuggestionBoardResult {
  const parsed = workSuggestionBoardResultContentSchema.parse(content);
  const artifactContent: WorkSuggestionBoardResultArtifactContent = {
    ...parsed,
    semanticResultSha256: digestBoardResultSemanticUnchecked(parsed)
  };
  return workSuggestionBoardResultSchema.parse({
    ...artifactContent,
    resultSha256: digestBoardResultArtifactUnchecked(artifactContent)
  });
}

export function verifyWorkSuggestionBoardResultIntegrity(
  value: unknown
): value is WorkSuggestionBoardResult {
  try {
    return workSuggestionBoardResultSchema.safeParse(value).success;
  } catch {
    return false;
  }
}

/**
 * Deterministically projects the complete Board-visible sequence. The caller
 * must supply a locally valid sealed input; authenticity is established only
 * by the input-bound composer/verifier boundary.
 */
export function deriveWorkSuggestionBoardItems(
  input: WorkSuggestionBoardInput
): WorkSuggestionBoardItem[] {
  return expectedBoardSequence(input).slice(0, 3).map((item) =>
    workSuggestionBoardItemSchema.parse({
      ...item,
      boardItemId: createWorkSuggestionBoardItemId({
        lane: item.lane,
        sourceItemRef: item.sourceItemRef,
        workContextId: item.workContextId
      })
    })
  );
}

function refineBoardResult(
  result: z.infer<typeof boardResultContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (result.asOf !== result.input.asOf) {
    addIssue(context, ["asOf"], "Board result and input as-of must agree");
  }
  if (
    result.composerVersion !== result.input.composerVersion ||
    result.precedencePolicyVersion !==
      result.input.precedencePolicyVersion ||
    result.idPolicyVersion !== result.input.idPolicyVersion
  ) {
    addIssue(
      context,
      ["composerVersion"],
      "Board result and input versions must agree exactly"
    );
  }
  if (
    result.dependencies.inputSha256 !== result.input.inputSha256 ||
    result.dependencies.activeResultSha256 !==
      result.input.active.resultSha256 ||
    result.dependencies.continuationResolvedResultSha256 !==
      result.input.continuation.resultSha256 ||
    result.dependencies.continuationResultSha256 !==
      result.input.continuation.decision.resultSha256 ||
    result.dependencies.continuationSemanticResultSha256 !==
      result.input.continuation.decision.semanticResultSha256
  ) {
    addIssue(
      context,
      ["dependencies"],
      "Board dependencies must preserve sealed artifact and semantic lane hashes"
    );
  }
  refineComputedStringIntegrity(
    result.boardId,
    () =>
      createWorkSuggestionBoardId({
        inputSha256: result.input.inputSha256,
        composerVersion: result.composerVersion,
        precedencePolicyVersion: result.precedencePolicyVersion,
        idPolicyVersion: result.idPolicyVersion
      }),
    context,
    ["boardId"],
    "Board ID mismatch"
  );

  const expectedSequence = expectedBoardSequence(result.input).slice(0, 3);
  const actualSequence = [
    ...(result.primary === null ? [] : [result.primary]),
    ...result.alternatives
  ];
  const expectedPrimary = expectedSequence[0] ?? null;
  if (expectedPrimary === null) {
    if (
      result.prominentLane !== "none" ||
      result.primary !== null ||
      actualSequence.length !== 0
    ) {
      addIssue(
        context,
        ["primary"],
        "A Board without a valid lane primary must be empty"
      );
    }
  } else if (
    result.prominentLane !== expectedPrimary.lane ||
    result.primary === null ||
    result.primary.lane !== expectedPrimary.lane ||
    !matchesExpectedBoardItem(result.primary, expectedPrimary)
  ) {
    addIssue(
      context,
      ["primary"],
      "Board primary violates Attention, Continuation, Setup precedence"
    );
  }

  if (result.prominentLane === "none" && result.alternatives.length > 0) {
    addIssue(
      context,
      ["alternatives"],
      "An empty Board cannot have alternatives"
    );
  }
  if (
    actualSequence.length !== expectedSequence.length ||
    actualSequence.some(
      (item, index) =>
        !matchesExpectedBoardItem(item, expectedSequence[index]!)
    )
  ) {
    addIssue(
      context,
      ["alternatives"],
      "Board items must preserve the sealed lane order and exact projection"
    );
  }
}

type ExpectedBoardItem = {
  lane: WorkSuggestionBoardLane;
  sourceItemRef: string;
  workContextId: string | null;
  localDisplayLabel: string;
  summary: string;
  observedAt: string | null;
  expiresAt: string | null;
  evidenceBand: WorkSuggestionBoardItem["evidenceBand"];
  capability: WorkSuggestionBoardItem["capability"];
  privateActionTarget: WorkSuggestionBoardItem["privateActionTarget"];
};

function expectedBoardSequence(
  input: WorkSuggestionBoardInput
): ExpectedBoardItem[] {
  const sequence: ExpectedBoardItem[] = [];
  const activeStatus = input.active.decision.status;
  if (activeStatus === "suggested") {
    for (const candidate of [
      ...(input.active.decision.topSuggestion === null
        ? []
        : [input.active.decision.topSuggestion]),
      ...input.active.decision.alternatives
    ]) {
      sequence.push({
        lane: "attention",
        sourceItemRef: createWorkSuggestionBoardSourceItemRef({
          lane: "attention",
          sourceStableId: candidate.candidateId
        }),
        workContextId: candidate.projectId,
        localDisplayLabel: candidate.title,
        summary: candidate.title,
        observedAt: candidate.sourceUpdatedAt,
        expiresAt: candidate.dueAt,
        evidenceBand: "verified_attention",
        capability: "display",
        privateActionTarget: null
      });
    }
  } else if (activeStatus === "needs_clarification") {
    const clarification = input.active.decision.clarification;
    if (clarification !== null) {
      sequence.push({
        lane: "attention",
        sourceItemRef: createWorkSuggestionBoardSourceItemRef({
          lane: "attention",
          sourceStableId: clarification.clarificationId
        }),
        workContextId: null,
        localDisplayLabel: clarification.question.slice(0, 120),
        summary: clarification.question.slice(0, 120),
        observedAt: null,
        expiresAt: null,
        evidenceBand: "verified_attention",
        capability: "display",
        privateActionTarget: null
      });
    }
  }

  const seenWorkContexts = new Set(
    sequence.flatMap((item) =>
      item.workContextId === null ? [] : [item.workContextId]
    )
  );
  for (const candidate of [
    ...(input.continuation.decision.primary === null
      ? []
      : [input.continuation.decision.primary]),
    ...input.continuation.decision.alternatives
  ]) {
    const lane: WorkSuggestionBoardLane =
      candidate.availability === "setup_required"
        ? "setup"
        : "continuation";
    const capability = boardCapabilityForCandidate(candidate);
    if (capability === null) {
      continue;
    }
    const sourceItemRef = createWorkSuggestionBoardSourceItemRef({
      lane,
      sourceStableId: candidate.candidateId
    });
    if (
      candidate.workContextId !== null &&
      seenWorkContexts.has(candidate.workContextId)
    ) {
      continue;
    }
    sequence.push({
      lane,
      sourceItemRef,
      workContextId: candidate.workContextId,
      localDisplayLabel: candidate.localDisplayLabel,
      summary: candidate.localDisplayLabel,
      observedAt: candidate.observedAt,
      expiresAt: candidate.expiresAt,
      evidenceBand: candidate.evidenceBand,
      capability,
      privateActionTarget: candidate.privateActionTarget
    });
    if (candidate.workContextId !== null) {
      seenWorkContexts.add(candidate.workContextId);
    }
  }
  return sequence;
}

function boardCapabilityForCandidate(
  candidate: ContinuationDecision["primary"] extends infer _Candidate
    ? NonNullable<ContinuationDecision["primary"]>
    : never
): WorkSuggestionBoardItem["capability"] | null {
  if (
    candidate.availability === "ready" &&
    candidate.capability === "display"
  ) {
    return "display";
  }
  if (
    candidate.availability === "ready" &&
    candidate.capability === "open_source"
  ) {
    return "open_source";
  }
  if (
    candidate.availability === "setup_required" &&
    candidate.capability === "open_setup_surface"
  ) {
    return "open_setup_surface";
  }
  return null;
}

function matchesExpectedBoardItem(
  actual: WorkSuggestionBoardItem,
  expected: ExpectedBoardItem
): boolean {
  return (
    actual.lane === expected.lane &&
    actual.sourceItemRef === expected.sourceItemRef &&
    actual.workContextId === expected.workContextId &&
    actual.localDisplayLabel === expected.localDisplayLabel &&
    actual.summary === expected.summary &&
    actual.observedAt === expected.observedAt &&
    actual.expiresAt === expected.expiresAt &&
    actual.evidenceBand === expected.evidenceBand &&
    actual.capability === expected.capability &&
    runtimeSha256(actual.privateActionTarget) ===
      runtimeSha256(expected.privateActionTarget)
  );
}

function isValidPublicSequence(
  alternatives: Array<z.infer<typeof workSuggestionBoardPublicItemSchema>>,
  primary: z.infer<typeof workSuggestionBoardPublicItemSchema> | null
): boolean {
  const primaryKey = primary === null ? null : primary.item.itemRef;
  let previousLane = primary === null ? -1 : laneOrder(primary.lane);
  const seen = new Set<string>();
  for (const item of alternatives) {
    const key = publicItemKey(item);
    if (
      key === primaryKey ||
      seen.has(key) ||
      laneOrder(item.lane) < previousLane
    ) {
      return false;
    }
    seen.add(key);
    previousLane = laneOrder(item.lane);
  }
  return true;
}

function publicItemKey(
  item: z.infer<typeof workSuggestionBoardPublicItemSchema>
): string {
  return item.item.itemRef;
}

function laneOrder(lane: WorkSuggestionBoardLane): number {
  return lane === "attention" ? 0 : lane === "continuation" ? 1 : 2;
}

function isCanonicalUnique(values: readonly string[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (
      index > 0 &&
      compareRuntimeStrings(values[index - 1]!, values[index]!) >= 0
    ) {
      return false;
    }
  }
  return true;
}

function publicSafeTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        publicSafeTextForbiddenPatterns.every(
          (pattern) => !pattern.test(value)
        ),
      "Public Board text contains a forbidden native identifier or locator"
    );
}

function withoutField<T extends object>(
  value: T,
  field: "inputSha256" | "resultSha256" | "semanticResultSha256"
): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[field];
  return copy;
}

function digestBoardInputUnchecked(
  value: WorkSuggestionBoardInputContent | WorkSuggestionBoardInput
): string {
  return runtimeSha256({
    domain: WORK_SUGGESTION_BOARD_INPUT_HASH_DOMAIN,
    value: withoutField(value, "inputSha256")
  });
}

function withoutBoardResultHashes(
  value: WorkSuggestionBoardResultContent | WorkSuggestionBoardResult
): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>;
  delete copy.semanticResultSha256;
  delete copy.resultSha256;
  return copy;
}

function digestBoardResultSemanticUnchecked(
  value: WorkSuggestionBoardResultContent | WorkSuggestionBoardResult
): string {
  const result = withoutBoardResultHashes(
    value
  ) as WorkSuggestionBoardResultContent;
  return runtimeSha256({
    domain: WORK_SUGGESTION_BOARD_SEMANTIC_RESULT_HASH_DOMAIN,
    value: {
      contract: result.contract,
      schemaVersion: result.schemaVersion,
      asOf: result.asOf,
      composerVersion: result.composerVersion,
      precedencePolicyVersion: result.precedencePolicyVersion,
      idPolicyVersion: result.idPolicyVersion,
      primary:
        result.primary === null
          ? null
          : boardItemSemanticProjection(result.primary),
      alternatives: result.alternatives.map(boardItemSemanticProjection),
      executionPolicy: result.executionPolicy
    }
  });
}

function boardItemSemanticProjection(
  item: WorkSuggestionBoardItem
): Record<string, unknown> {
  return {
    lane: item.lane,
    ...(item.workContextId === null
      ? {}
      : { workContextId: item.workContextId }),
    localDisplayLabel: item.localDisplayLabel,
    summary: item.summary,
    observedAt: item.observedAt,
    expiresAt: item.expiresAt,
    evidenceBand: item.evidenceBand,
    capability: item.capability,
    targetCapability:
      item.capability === "display" ? null : item.capability
  };
}

function digestBoardResultArtifactUnchecked(
  value:
    | WorkSuggestionBoardResultArtifactContent
    | WorkSuggestionBoardResult
): string {
  return runtimeSha256({
    domain: WORK_SUGGESTION_BOARD_RESULT_HASH_DOMAIN,
    value: withoutField(value, "resultSha256")
  });
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function failClosedCanonicalBoundary<T extends z.ZodTypeAny>(
  schema: T
): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess((value) => {
    try {
      return JSON.parse(runtimeCanonicalJson(value)) as unknown;
    } catch {
      return NON_CANONICAL_BOUNDARY_VALUE;
    }
  }, schema);
}

function refineComputedStringIntegrity(
  actual: string,
  computeExpected: () => string,
  context: z.RefinementCtx,
  path: Array<string | number>,
  mismatchMessage: string
): void {
  let expected: string;
  try {
    expected = computeExpected();
  } catch {
    addIssue(
      context,
      path,
      "Integrity value cannot be computed from non-canonical content"
    );
    return;
  }
  if (actual !== expected) {
    addIssue(context, path, mismatchMessage);
  }
}

export type WorkSuggestionBoardActiveDependency = ActiveAttentionResult;
export type WorkSuggestionBoardContinuationDependency =
  ContinuationResolvedDecision;
