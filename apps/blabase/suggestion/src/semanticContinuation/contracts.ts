import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import { containsCredentialShapedPublicText } from "../publicTextSafety";
import {
  workBoardApiResponseSchema,
  type WorkBoardApiResponse
} from "../suggestionBoard/monitoringSchema";
import { SEMANTIC_VALIDATION_TITLES } from "./validation/versions";

export const SEMANTIC_CONTINUATION_LEGACY_INTENT_CONTRACT =
  "semantic-continuation-intent-v0.1" as const;
export const SEMANTIC_CONTINUATION_INTENT_CONTRACT =
  "semantic-continuation-intent-v0.2" as const;
export const SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_CONTRACT =
  "semantic-continuation-intent-store-v0.2" as const;
export const SEMANTIC_CONTINUATION_INTENT_STORE_CONTRACT =
  "semantic-continuation-intent-store-v0.3" as const;
export const SEMANTIC_CONTINUATION_LEGACY_SCHEMA_VERSION =
  "semantic-continuation-schema-v0.1" as const;
export const SEMANTIC_CONTINUATION_SCHEMA_VERSION =
  "semantic-continuation-schema-v0.2" as const;
export const SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_SCHEMA_VERSION =
  "semantic-continuation-intent-store-schema-v0.2" as const;
export const SEMANTIC_CONTINUATION_INTENT_STORE_SCHEMA_VERSION =
  "semantic-continuation-intent-store-schema-v0.3" as const;
export const SEMANTIC_CONTINUATION_LEGACY_TITLE_OVERLAY_POLICY_VERSION =
  "semantic-continuation-title-overlay-v0.1" as const;
export const SEMANTIC_CONTINUATION_TITLE_OVERLAY_POLICY_VERSION =
  "semantic-continuation-title-overlay-v0.2" as const;
export const SEMANTIC_CONTINUATION_PRESENTATION_CONTRACT =
  "semantic-continuation-presentation-v0.2" as const;
export const SEMANTIC_CONTINUATION_WORK_BOARD_RESPONSE_CONTRACT =
  "semantic-continuation-work-board-response-v0.2" as const;
export const SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION =
  "semantic-continuation-presentation-schema-v0.2" as const;
export const SEMANTIC_CONTINUATION_TTL_POLICY_VERSION =
  "semantic-continuation-intent-ttl-24h-v0.1" as const;

export const SEMANTIC_CONTINUATION_INTENT_TTL_MS =
  24 * 60 * 60 * 1_000;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const installationSecretSchema = sha256Schema;
export const semanticContinuationIntentAuthKeyIdSchema = z
  .string()
  .regex(/^semantic_continuation_intent_key_[a-f0-9]{32}$/u);
const itemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const workContextRefSchema = z
  .string()
  .regex(/^context_ref_[A-Za-z0-9_-]{22,128}$/u);
const continuationCandidateKindSchema = z.enum([
  "recent_github_push",
  "recent_codex_session",
  "local_worktree",
  "linked_workstream",
  "workspace_mapping"
]);
const continuationEvidenceBandSchema = z.enum([
  "exact",
  "corroborated",
  "single_source"
]);
const timestampSchema = z.string().datetime().refine(isCanonicalTimestamp, {
  message: "Timestamp must use canonical UTC ISO form"
});

const unsafePublicTextPatterns = [
  /[\p{Cc}\p{Cf}\p{Cs}]/u,
  /[\\/]/u,
  /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:action_ref|analysis|artifact|artifact_relation|attention|attention_assessment|attention_clarification|attention_result|attribution|binding|blocker|board_item|board_source|candidate_funnel|claim|claim_conflict|claim_evidence|claim_key|claim_lineage|claim_resolution|claim_subject|command|connection|context_ref|continuation_candidate|continuation_context_link|continuation_observation|continuation_offer|continuation_run|elig|evidence|execution|focus|focus_evidence|focus_identity|focus_subject|github_repo|installation_key|instance|item_ref|ledger_evidence|local_commit|local_repo|managed_event|managed_run|managed_settlement|mapping|next_action|open_loop|outcome|private_target|project|proposal|recent_event|relation|repository_scope_link|root|run|scope_binding_ref|seed|semantic_entry|semantic_evidence|semantic_intent|session|settlement|sig|source_record_ref|source_ref|stream|sync|thread|transition|user|client|app|work_board|work_item|work_ledger|workflow_closure|workflow_decision|workstream)_[A-Za-z0-9_-]+/iu
] as const;
const forbiddenSubjectMeaningFragments = [
  "결과",
  "반영",
  "통과",
  "실패",
  "완료",
  "성공",
  "종료",
  "실행",
  "순위",
  "텔레메트리",
  "pass",
  "fail",
  "failure",
  "complete",
  "completion",
  "done",
  "finish",
  "success",
  "succeed",
  "result",
  "apply",
  "execute",
  "execution",
  "rank",
  "action",
  "telemetry"
] as const;

function containsForbiddenSubjectMeaning(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
  return forbiddenSubjectMeaningFragments.some((fragment) =>
    normalized.includes(fragment)
  );
}

export const semanticContinuationSubjectLabelSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === value.trim(), {
    message: "Subject label cannot contain surrounding whitespace"
  })
  .refine(
    (value) => unsafePublicTextPatterns.every((pattern) => !pattern.test(value)),
    { message: "Subject label is not safe for a public title" }
  )
  .refine(
    (value) => !containsForbiddenSubjectMeaning(value),
    { message: "Subject label cannot imply execution or QA result state" }
  )
  .refine((value) => !containsCredentialShapedPublicText(value), {
    message: "Subject label resembles a credential"
  })
  .refine(
    (value) => `${value} QA 진행하기`.length <= 120,
    { message: "Derived title exceeds the public title bound" }
  );

export const semanticContinuationConfirmationInputSchema = z
  .object({
    intent: z.literal("QA_RUN"),
    subjectLabel: semanticContinuationSubjectLabelSchema,
    itemRef: itemRefSchema,
    workContextRef: workContextRefSchema,
    explicitUserConfirmation: z.literal(true)
  })
  .strict();

export const semanticContinuationConfirmationTargetSchema = z
  .object({
    itemRef: itemRefSchema,
    workContextRef: workContextRefSchema,
    candidateKind: continuationCandidateKindSchema,
    evidenceBand: continuationEvidenceBandSchema,
    observedAt: timestampSchema,
    candidateExpiresAt: timestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.candidateExpiresAt) <= Date.parse(value.observedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateExpiresAt"],
        message: "Candidate expiry must follow its observation"
      });
    }
  });

const semanticIntentDecisionCommonShape = {
  decisionId: z
    .string()
    .regex(/^semantic_intent_[a-f0-9]{32}$/u),
  intent: z.literal("QA_RUN"),
  subjectLabel: semanticContinuationSubjectLabelSchema,
  labelSource: z.literal("explicit_user"),
  explicitUserConfirmation: z.literal(true),
  itemRef: itemRefSchema,
  workContextRef: workContextRefSchema,
  registrySha256: sha256Schema,
  targetObservedAt: timestampSchema,
  targetCandidateExpiresAt: timestampSchema,
  confirmedAt: timestampSchema,
  expiresAt: timestampSchema,
  supersedesDecisionId: z
    .string()
    .regex(/^semantic_intent_[a-f0-9]{32}$/u)
    .nullable(),
  ttlPolicyVersion: z.literal(
    SEMANTIC_CONTINUATION_TTL_POLICY_VERSION
  )
} as const;

const legacySemanticIntentDecisionContentObjectSchema = z
  .object({
    contract: z.literal(SEMANTIC_CONTINUATION_LEGACY_INTENT_CONTRACT),
    schemaVersion: z.literal(SEMANTIC_CONTINUATION_LEGACY_SCHEMA_VERSION),
    ...semanticIntentDecisionCommonShape,
    overlayPolicyVersion: z.literal(
      SEMANTIC_CONTINUATION_LEGACY_TITLE_OVERLAY_POLICY_VERSION
    )
  })
  .strict();

const currentSemanticIntentDecisionContentObjectSchema = z
  .object({
    contract: z.literal(SEMANTIC_CONTINUATION_INTENT_CONTRACT),
    schemaVersion: z.literal(SEMANTIC_CONTINUATION_SCHEMA_VERSION),
    ...semanticIntentDecisionCommonShape,
    targetCandidateKind: continuationCandidateKindSchema,
    targetEvidenceBand: continuationEvidenceBandSchema,
    overlayPolicyVersion: z.literal(
      SEMANTIC_CONTINUATION_TITLE_OVERLAY_POLICY_VERSION
    )
  })
  .strict();

const currentSemanticIntentDecisionContentSchema =
  currentSemanticIntentDecisionContentObjectSchema.superRefine(
    refineSemanticIntentDecision
  );

export const semanticContinuationLegacyIntentDecisionSchema =
  legacySemanticIntentDecisionContentObjectSchema
    .extend({ decisionSha256: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineSemanticIntentDecision(value, context);
      const { decisionSha256: _decisionSha256, ...content } = value;
      if (value.decisionSha256 !== semanticIntentDecisionSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisionSha256"],
          message: "Semantic intent decision hash mismatch"
        });
      }
    });

export const semanticContinuationCurrentIntentDecisionSchema =
  currentSemanticIntentDecisionContentObjectSchema
    .extend({ decisionSha256: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineSemanticIntentDecision(value, context);
      const { decisionSha256: _decisionSha256, ...content } = value;
      if (value.decisionSha256 !== semanticIntentDecisionSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisionSha256"],
          message: "Semantic intent decision hash mismatch"
        });
      }
    });

export const semanticContinuationIntentDecisionSchema = z.union([
  semanticContinuationLegacyIntentDecisionSchema,
  semanticContinuationCurrentIntentDecisionSchema
]);

const legacySemanticIntentStoreContentObjectSchema = z
  .object({
    contract: z.literal(
      SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_CONTRACT
    ),
    schemaVersion: z.literal(
      SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_SCHEMA_VERSION
    ),
    authKeyId: semanticContinuationIntentAuthKeyIdSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    decisions: z
      .array(semanticContinuationLegacyIntentDecisionSchema)
      .max(1_000)
  })
  .strict();

const currentSemanticIntentStoreContentObjectSchema = z
  .object({
    contract: z.literal(SEMANTIC_CONTINUATION_INTENT_STORE_CONTRACT),
    schemaVersion: z.literal(
      SEMANTIC_CONTINUATION_INTENT_STORE_SCHEMA_VERSION
    ),
    authKeyId: semanticContinuationIntentAuthKeyIdSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    decisions: z.array(semanticContinuationIntentDecisionSchema).max(1_000)
  })
  .strict();

const currentSemanticIntentStoreContentSchema =
  currentSemanticIntentStoreContentObjectSchema.superRefine(
    refineSemanticIntentStore
  );

export const semanticContinuationLegacyIntentStoreSchema =
  legacySemanticIntentStoreContentObjectSchema
    .extend({ storeSha256: sha256Schema, storeHmac: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineSemanticIntentStore(value, context);
      const {
        storeSha256: _storeSha256,
        storeHmac: _storeHmac,
        ...content
      } = value;
      if (value.storeSha256 !== semanticIntentStoreSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Semantic intent store hash mismatch"
        });
      }
    });

export const semanticContinuationCurrentIntentStoreSchema =
  currentSemanticIntentStoreContentObjectSchema
    .extend({ storeSha256: sha256Schema, storeHmac: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      refineSemanticIntentStore(value, context);
      const {
        storeSha256: _storeSha256,
        storeHmac: _storeHmac,
        ...content
      } = value;
      if (value.storeSha256 !== semanticIntentStoreSha256(content)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Semantic intent store hash mismatch"
        });
      }
    });

export const semanticContinuationIntentStoreSchema = z.union([
  semanticContinuationLegacyIntentStoreSchema,
  semanticContinuationCurrentIntentStoreSchema
]);

export const semanticContinuationTitlePresentationSchema = z
  .object({
    contract: z.literal(SEMANTIC_CONTINUATION_PRESENTATION_CONTRACT),
    schemaVersion: z.literal(
      SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION
    ),
    baseGeneratedAt: timestampSchema,
    overlays: z
      .array(
        z
          .object({
            itemRef: itemRefSchema,
            displayTitle: z
              .string()
              .refine(isSafeSemanticContinuationPublicTitle, {
                message: "Semantic presentation title is invalid"
              })
          })
          .strict()
      )
      .min(1)
      .max(3)
  })
  .strict()
  .superRefine((value, context) => {
    const refs = value.overlays.map((overlay) => overlay.itemRef);
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlays"],
        message: "Semantic presentation item refs must be unique"
      });
    }
  });

export const semanticContinuationWorkBoardResponseSchema = z
  .object({
    contract: z.literal(
      SEMANTIC_CONTINUATION_WORK_BOARD_RESPONSE_CONTRACT
    ),
    schemaVersion: z.literal(
      SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION
    ),
    base: workBoardApiResponseSchema,
    semanticPresentation:
      semanticContinuationTitlePresentationSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.semanticPresentation === null) return;
    if (value.base.status !== "ready" || value.base.mode !== "full") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticPresentation"],
        message: "Semantic presentation requires a full ready base Board"
      });
      return;
    }
    if (
      value.semanticPresentation.baseGeneratedAt !==
      value.base.board.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticPresentation", "baseGeneratedAt"],
        message: "Semantic presentation must bind the base Board time"
      });
    }
    const items = [
      ...(value.base.board.primary === null
        ? []
        : [value.base.board.primary]),
      ...value.base.board.alternatives
    ];
    const positions = value.semanticPresentation.overlays.map((overlay) =>
      items.findIndex(
        (entry) =>
          entry.lane === "continuation" &&
          entry.item.itemRef === overlay.itemRef &&
          entry.item.workContextRef !== null &&
          entry.item.capability === "display" &&
          entry.item.action === null
      )
    );
    if (
      positions.some((position) => position < 0) ||
      positions.some(
        (position, index) =>
          index > 0 && positions[index - 1]! >= position
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticPresentation", "overlays"],
        message:
          "Semantic presentation must preserve eligible base item order"
      });
    }
  });

export type SemanticContinuationConfirmationInput = z.infer<
  typeof semanticContinuationConfirmationInputSchema
>;
export type SemanticContinuationConfirmationTarget = z.infer<
  typeof semanticContinuationConfirmationTargetSchema
>;
export type SemanticContinuationIntentDecision = z.infer<
  typeof semanticContinuationIntentDecisionSchema
>;
export type SemanticContinuationIntentStore = z.infer<
  typeof semanticContinuationIntentStoreSchema
>;
export type SemanticContinuationCurrentIntentStore = z.infer<
  typeof semanticContinuationCurrentIntentStoreSchema
>;
export type SemanticContinuationTitlePresentation = z.infer<
  typeof semanticContinuationTitlePresentationSchema
>;
export type SemanticContinuationWorkBoardResponse = z.infer<
  typeof semanticContinuationWorkBoardResponseSchema
>;

export function semanticContinuationTitle(subjectLabel: string): string {
  const label = semanticContinuationSubjectLabelSchema.parse(subjectLabel);
  return `${label} QA 진행하기`;
}

export function isSafeSemanticContinuationPublicTitle(
  value: unknown
): value is string {
  if (
    typeof value === "string" &&
    Object.values(SEMANTIC_VALIDATION_TITLES).includes(
      value as (typeof SEMANTIC_VALIDATION_TITLES)[keyof typeof SEMANTIC_VALIDATION_TITLES]
    )
  ) {
    return true;
  }
  if (typeof value !== "string" || !value.endsWith(" QA 진행하기")) {
    return false;
  }
  const label = value.slice(0, -" QA 진행하기".length);
  return (
    semanticContinuationSubjectLabelSchema.safeParse(label).success &&
    semanticContinuationTitle(label) === value
  );
}

export function createSemanticContinuationWorkBoardResponse(
  base: WorkBoardApiResponse,
  semanticPresentation: SemanticContinuationTitlePresentation | null
): SemanticContinuationWorkBoardResponse {
  return semanticContinuationWorkBoardResponseSchema.parse({
    contract: SEMANTIC_CONTINUATION_WORK_BOARD_RESPONSE_CONTRACT,
    schemaVersion: SEMANTIC_CONTINUATION_PRESENTATION_SCHEMA_VERSION,
    base,
    semanticPresentation
  });
}

export function createSemanticContinuationIntentDecision(input: {
  confirmation: SemanticContinuationConfirmationInput;
  target: SemanticContinuationConfirmationTarget;
  registrySha256: string;
  confirmedAt: string;
  supersedesDecisionId: string | null;
}): SemanticContinuationIntentDecision {
  const confirmation = semanticContinuationConfirmationInputSchema.parse(
    input.confirmation
  );
  const target = semanticContinuationConfirmationTargetSchema.parse(
    input.target
  );
  const registrySha256 = sha256Schema.parse(input.registrySha256);
  const confirmedAt = timestampSchema.parse(input.confirmedAt);
  const expiresAt = new Date(
    Math.min(
      Date.parse(confirmedAt) + SEMANTIC_CONTINUATION_INTENT_TTL_MS,
      Date.parse(target.candidateExpiresAt)
    )
  ).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(confirmedAt)) {
    throw new TypeError("Semantic intent target is already expired");
  }
  const stableContent = {
    intent: confirmation.intent,
    subjectLabel: confirmation.subjectLabel,
    labelSource: "explicit_user" as const,
    explicitUserConfirmation: true as const,
    itemRef: target.itemRef,
    workContextRef: target.workContextRef,
    registrySha256,
    targetObservedAt: target.observedAt,
    targetCandidateExpiresAt: target.candidateExpiresAt,
    targetCandidateKind: target.candidateKind,
    targetEvidenceBand: target.evidenceBand,
    confirmedAt,
    expiresAt,
    supersedesDecisionId: input.supersedesDecisionId,
    overlayPolicyVersion:
      SEMANTIC_CONTINUATION_TITLE_OVERLAY_POLICY_VERSION,
    ttlPolicyVersion: SEMANTIC_CONTINUATION_TTL_POLICY_VERSION
  };
  const content = currentSemanticIntentDecisionContentSchema.parse({
    contract: SEMANTIC_CONTINUATION_INTENT_CONTRACT,
    schemaVersion: SEMANTIC_CONTINUATION_SCHEMA_VERSION,
    decisionId: runtimeStableId(
      "semantic_intent",
      SEMANTIC_CONTINUATION_INTENT_CONTRACT,
      stableContent
    ),
    ...stableContent
  });
  return semanticContinuationIntentDecisionSchema.parse({
    ...content,
    decisionSha256: semanticIntentDecisionSha256(content)
  });
}

export function createEmptySemanticContinuationIntentStore(
  updatedAt: string,
  installationSecret: string
): SemanticContinuationCurrentIntentStore {
  return sealSemanticContinuationIntentStore(
    {
      contract: SEMANTIC_CONTINUATION_INTENT_STORE_CONTRACT,
      schemaVersion: SEMANTIC_CONTINUATION_INTENT_STORE_SCHEMA_VERSION,
      authKeyId: semanticContinuationIntentAuthKeyId(installationSecret),
      revision: 0,
      updatedAt: timestampSchema.parse(updatedAt),
      decisions: []
    },
    installationSecret
  );
}

export function sealSemanticContinuationIntentStore(
  contentInput: z.input<typeof currentSemanticIntentStoreContentSchema>,
  installationSecret: string
): SemanticContinuationCurrentIntentStore {
  const content = currentSemanticIntentStoreContentSchema.parse(contentInput);
  if (
    content.authKeyId !==
    semanticContinuationIntentAuthKeyId(installationSecret)
  ) {
    throw new TypeError("Semantic intent store key namespace mismatch");
  }
  const withHash = {
    ...content,
    storeSha256: semanticIntentStoreSha256(content)
  };
  return semanticContinuationCurrentIntentStoreSchema.parse({
    ...withHash,
    storeHmac: semanticIntentStoreHmac(installationSecret, withHash)
  });
}

export function verifySemanticContinuationIntentStore(
  value: unknown,
  installationSecret: string
): SemanticContinuationIntentStore | null {
  const parsed = semanticContinuationIntentStoreSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.authKeyId !==
    semanticContinuationIntentAuthKeyId(installationSecret)
  ) {
    return null;
  }
  const { storeHmac, ...authenticatedContent } = parsed.data;
  const expected = semanticIntentStoreHmac(
    installationSecret,
    authenticatedContent
  );
  const claimedBytes = Buffer.from(storeHmac, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return claimedBytes.length === expectedBytes.length &&
    timingSafeEqual(claimedBytes, expectedBytes)
    ? parsed.data
    : null;
}

export function semanticContinuationIntentAuthKeyId(
  installationSecretInput: string
): string {
  const installationSecret = installationSecretSchema.parse(
    installationSecretInput
  );
  return `semantic_continuation_intent_key_${createHmac(
    "sha256",
    Buffer.from(installationSecret, "hex")
  )
    .update("semantic-continuation-intent-key-id-v0.2", "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function semanticIntentDecisionSha256(
  value: { contract: string } & Record<string, unknown>
): string {
  return runtimeSha256({
    domain:
      value.contract === SEMANTIC_CONTINUATION_LEGACY_INTENT_CONTRACT
        ? "semantic-continuation-intent-decision-hash-v0.1"
        : "semantic-continuation-intent-decision-hash-v0.2",
    decision: value
  });
}

function semanticIntentStoreSha256(
  value: { contract: string } & Record<string, unknown>
): string {
  return runtimeSha256({
    domain:
      value.contract === SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_CONTRACT
        ? "semantic-continuation-intent-store-hash-v0.2"
        : "semantic-continuation-intent-store-hash-v0.3",
    store: value
  });
}

function semanticIntentStoreHmac(
  installationSecret: string,
  value: { contract: string } & Record<string, unknown>
): string {
  if (!/^[a-f0-9]{64}$/u.test(installationSecret)) {
    throw new TypeError("Semantic intent store requires an installation secret");
  }
  const key = createHmac("sha256", Buffer.from(installationSecret, "hex"))
    .update(
      value.contract === SEMANTIC_CONTINUATION_LEGACY_INTENT_STORE_CONTRACT
        ? "semantic-continuation-intent-store-hmac-v0.2"
        : "semantic-continuation-intent-store-hmac-v0.3",
      "utf8"
    )
    .digest();
  return createHmac("sha256", key)
    .update(runtimeCanonicalJson(value), "utf8")
    .digest("hex");
}

function refineSemanticIntentDecision(
  value:
    | z.infer<typeof legacySemanticIntentDecisionContentObjectSchema>
    | z.infer<typeof currentSemanticIntentDecisionContentObjectSchema>,
  context: z.RefinementCtx
): void {
  const expectedDecisionId = runtimeStableId(
    "semantic_intent",
    value.contract,
    semanticIntentDecisionStableContent(value)
  );
  if (value.decisionId !== expectedDecisionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisionId"],
      message: "Semantic intent decision ID mismatch"
    });
  }
  const expectedExpiry = Math.min(
    Date.parse(value.confirmedAt) + SEMANTIC_CONTINUATION_INTENT_TTL_MS,
    Date.parse(value.targetCandidateExpiresAt)
  );
  if (
    Date.parse(value.targetObservedAt) > Date.parse(value.confirmedAt) ||
    Date.parse(value.expiresAt) !== expectedExpiry ||
    expectedExpiry <= Date.parse(value.confirmedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Semantic intent temporal bounds are contradictory"
    });
  }
  if (value.supersedesDecisionId === value.decisionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supersedesDecisionId"],
      message: "A semantic intent decision cannot supersede itself"
    });
  }
}

function refineSemanticIntentStore(
  value: {
    revision: number;
    decisions: SemanticContinuationIntentDecision[];
  },
  context: z.RefinementCtx
): void {
  if (value.revision !== value.decisions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["revision"],
      message: "Semantic intent store revision must match its history"
    });
  }
  const ids = value.decisions.map((decision) => decision.decisionId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "Semantic intent decision IDs must be unique"
    });
  }
  if (
    value.decisions.some(
      (decision, index) =>
        index > 0 &&
        compareDecisionOrder(value.decisions[index - 1]!, decision) >= 0
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "Semantic intent decisions must use canonical order"
    });
  }
  const byId = new Map(
    value.decisions.map((decision) => [decision.decisionId, decision])
  );
  if (value.decisions.some((decision) => {
    if (decision.supersedesDecisionId === null) return false;
    const superseded = byId.get(decision.supersedesDecisionId);
    return (
      superseded === undefined ||
      superseded.intent !== decision.intent ||
      superseded.workContextRef !== decision.workContextRef
    );
  })) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message:
        "Semantic intent supersession must reference a matching decision"
    });
  }
  if (value.decisions.some((decision) => hasSupersessionCycle(decision, byId))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "Semantic intent supersession cannot contain a cycle"
    });
  }
  const supersededIds = new Set(
    value.decisions.flatMap((decision) =>
      decision.supersedesDecisionId === null
        ? []
        : [decision.supersedesDecisionId]
    )
  );
  const currentKeys = value.decisions
    .filter((decision) => !supersededIds.has(decision.decisionId))
    .map((decision) => `${decision.intent}\0${decision.workContextRef}`);
  if (new Set(currentKeys).size !== currentKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message:
        "Semantic intent store must have one current decision per work context"
    });
  }
}

function hasSupersessionCycle(
  start: SemanticContinuationIntentDecision,
  byId: Map<string, SemanticContinuationIntentDecision>
): boolean {
  const seen = new Set<string>();
  let current: SemanticContinuationIntentDecision | undefined = start;
  while (current !== undefined && current.supersedesDecisionId !== null) {
    if (seen.has(current.decisionId)) return true;
    seen.add(current.decisionId);
    current = byId.get(current.supersedesDecisionId);
  }
  return false;
}

function semanticIntentDecisionStableContent(value: {
  contract:
    | typeof SEMANTIC_CONTINUATION_LEGACY_INTENT_CONTRACT
    | typeof SEMANTIC_CONTINUATION_INTENT_CONTRACT;
  intent: "QA_RUN";
  subjectLabel: string;
  labelSource: "explicit_user";
  explicitUserConfirmation: true;
  itemRef: string;
  workContextRef: string;
  registrySha256: string;
  targetObservedAt: string;
  targetCandidateExpiresAt: string;
  confirmedAt: string;
  expiresAt: string;
  supersedesDecisionId: string | null;
  targetCandidateKind?: z.infer<typeof continuationCandidateKindSchema>;
  targetEvidenceBand?: z.infer<typeof continuationEvidenceBandSchema>;
  overlayPolicyVersion:
    | typeof SEMANTIC_CONTINUATION_LEGACY_TITLE_OVERLAY_POLICY_VERSION
    | typeof SEMANTIC_CONTINUATION_TITLE_OVERLAY_POLICY_VERSION;
  ttlPolicyVersion: typeof SEMANTIC_CONTINUATION_TTL_POLICY_VERSION;
}) {
  const common = {
    intent: value.intent,
    subjectLabel: value.subjectLabel,
    labelSource: value.labelSource,
    explicitUserConfirmation: value.explicitUserConfirmation,
    itemRef: value.itemRef,
    workContextRef: value.workContextRef,
    registrySha256: value.registrySha256,
    targetObservedAt: value.targetObservedAt,
    targetCandidateExpiresAt: value.targetCandidateExpiresAt,
    confirmedAt: value.confirmedAt,
    expiresAt: value.expiresAt,
    supersedesDecisionId: value.supersedesDecisionId,
    overlayPolicyVersion: value.overlayPolicyVersion,
    ttlPolicyVersion: value.ttlPolicyVersion
  };
  return value.contract === SEMANTIC_CONTINUATION_INTENT_CONTRACT
    ? {
        ...common,
        targetCandidateKind: value.targetCandidateKind,
        targetEvidenceBand: value.targetEvidenceBand
      }
    : common;
}

export function compareSemanticIntentDecisions(
  left: SemanticContinuationIntentDecision,
  right: SemanticContinuationIntentDecision
): number {
  return compareDecisionOrder(left, right);
}

function compareDecisionOrder(
  left: { confirmedAt: string; decisionId: string },
  right: { confirmedAt: string; decisionId: string }
): number {
  return left.confirmedAt < right.confirmedAt
    ? -1
    : left.confirmedAt > right.confirmedAt
      ? 1
      : left.decisionId < right.decisionId
        ? -1
        : left.decisionId > right.decisionId
          ? 1
          : 0;
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
