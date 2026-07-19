import { z, type RefinementCtx } from "zod";

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Expected a non-blank string.");
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const confidenceSchema = z.number().finite().min(0).max(1);

export const coreSemanticTypeV1Schema = z.enum([
  "intent",
  "topic",
  "content_constraint",
  "problem_signal",
  "change_event",
  "entity",
  "relation"
]);

export type CoreSemanticTypeV1 = z.infer<typeof coreSemanticTypeV1Schema>;

export const semanticAttributionV1Schema = z.enum([
  "user",
  "assistant",
  "conversation"
]);

export type SemanticAttributionV1 = z.infer<typeof semanticAttributionV1Schema>;

export const coreSupportTypeV1Schema = z.enum(["explicit", "accepted_context"]);

export type CoreSupportTypeV1 = z.infer<typeof coreSupportTypeV1Schema>;

export const candidateSupportTypeV1Schema = z.enum([
  "explicit",
  "accepted_context",
  "inferred",
  "unsupported"
]);

export type CandidateSupportTypeV1 = z.infer<
  typeof candidateSupportTypeV1Schema
>;

export const evidenceRoleV1Schema = z.enum([
  "direct_support",
  "proposition",
  "acceptance"
]);

export type EvidenceRoleV1 = z.infer<typeof evidenceRoleV1Schema>;

export const extractorSourceV1Schema = z.enum(["rule", "llm", "human"]);

export type ExtractorSourceV1 = z.infer<typeof extractorSourceV1Schema>;

export const verificationReasonV1Schema = z.enum([
  "DUPLICATE_ITEM_ID",
  "DUPLICATE_EVIDENCE_ID",
  "DUPLICATE_EVIDENCE_REF",
  "DUPLICATE_REFERENCE",
  "ORPHAN_EVIDENCE",
  "MISSING_EVIDENCE",
  "OUT_OF_RANGE_MESSAGE_INDEX",
  "NON_CLEAN_EVIDENCE",
  "MISSING_QUOTE",
  "QUOTE_NOT_FOUND",
  "QUOTE_SPAN_MISMATCH",
  "ATTRIBUTION_MISMATCH",
  "ASSISTANT_ONLY_USER_CLAIM",
  "LOW_CONFIDENCE",
  "INFERRED_SUPPORT",
  "EXAMPLE_OR_HYPOTHETICAL",
  "AMBIGUOUS_ACCEPTANCE",
  "INVALID_ACCEPTED_CONTEXT",
  "DANGLING_TOPIC_REFERENCE",
  "DANGLING_ENTITY_REFERENCE",
  "REFERENCE_TARGET_TYPE_MISMATCH",
  "REFERENCE_CYCLE",
  "TOPIC_RANGE_INVALID",
  "CHANGE_ENDPOINT_MISSING",
  "ENTITY_NOT_IDENTIFIABLE",
  "RELATION_ENDPOINT_MISSING",
  "RELATION_PREDICATE_UNSUPPORTED",
  "RELATION_NOT_EXPLICIT",
  "RELATION_CO_OCCURRENCE_ONLY",
  "RELATION_CONDITIONAL_ONLY",
  "RELATION_SELF_EDGE",
  "RELATION_CANONICAL_ORDER_INVALID",
  "DUPLICATE_RELATION",
  "CHANGE_STATE_UNCHANGED"
]);

export type VerificationReasonV1 = z.infer<typeof verificationReasonV1Schema>;

export const evidenceAnchorV1Schema = z
  .object({
    id: nonBlankStringSchema,
    messageId: nonBlankStringSchema,
    messageIndex: positiveIntegerSchema,
    role: z.enum(["user", "assistant"]),
    quote: nonBlankStringSchema,
    startChar: nonNegativeIntegerSchema,
    endChar: positiveIntegerSchema
  })
  .strict()
  .superRefine((evidence, ctx) => {
    if (evidence.endChar <= evidence.startChar) {
      addIssue(
        ctx,
        ["endChar"],
        "QUOTE_SPAN_MISMATCH",
        "endChar must be greater than startChar."
      );
    }
    if (evidence.endChar - evidence.startChar !== evidence.quote.length) {
      addIssue(
        ctx,
        ["quote"],
        "QUOTE_SPAN_MISMATCH",
        "quote length must match the declared character span."
      );
    }
  });

export type EvidenceAnchorV1 = z.infer<typeof evidenceAnchorV1Schema>;

export const semanticEvidenceRefV1Schema = z
  .object({
    evidenceId: nonBlankStringSchema,
    role: evidenceRoleV1Schema
  })
  .strict();

export type SemanticEvidenceRefV1 = z.infer<typeof semanticEvidenceRefV1Schema>;

export const semanticItemSourceV1Schema = z
  .object({
    extractor: extractorSourceV1Schema,
    extractorVersion: nonBlankStringSchema,
    runId: nonBlankStringSchema
  })
  .strict();

export type SemanticItemSourceV1 = z.infer<typeof semanticItemSourceV1Schema>;

const semanticItemBaseV1Schema = z
  .object({
    id: nonBlankStringSchema,
    label: nonBlankStringSchema,
    description: z.string(),
    topicIds: z.array(nonBlankStringSchema),
    evidenceRefs: z.array(semanticEvidenceRefV1Schema).min(1),
    confidence: confidenceSchema,
    canonicalKey: nonBlankStringSchema,
    source: semanticItemSourceV1Schema
  })
  .strict();

export const intentItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("intent"),
  attribution: z.literal("user"),
  supportType: z.literal("explicit"),
  intentKind: z.enum(["goal", "desired_outcome"]),
  scope: z.enum(["conversation", "topic"]),
  targetEntityIds: z.array(nonBlankStringSchema)
});

export type IntentItemV1 = z.infer<typeof intentItemV1Schema>;

export const topicItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("topic"),
  attribution: z.literal("conversation"),
  supportType: z.literal("explicit"),
  topicIds: z.array(nonBlankStringSchema).length(0),
  order: nonNegativeIntegerSchema,
  level: z.enum(["main", "subtopic"]),
  parentTopicId: nonBlankStringSchema.nullable(),
  summary: nonBlankStringSchema,
  startMessageIndex: positiveIntegerSchema,
  endMessageIndex: positiveIntegerSchema
});

export type TopicItemV1 = z.infer<typeof topicItemV1Schema>;

export const contentConstraintItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("content_constraint"),
  attribution: z.literal("user"),
  supportType: z.enum(["explicit", "accepted_context"]),
  constraintKind: z.enum([
    "include_content",
    "exclude_content",
    "audience",
    "domain_point",
    "business_rule",
    "source_material",
    "scope_limit"
  ]),
  polarity: z.enum(["include", "exclude", "limit", "require"]),
  targetEntityIds: z.array(nonBlankStringSchema)
});

export type ContentConstraintItemV1 = z.infer<
  typeof contentConstraintItemV1Schema
>;

export const problemSignalItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("problem_signal"),
  attribution: z.literal("user"),
  supportType: z.literal("explicit"),
  problemKind: z.enum([
    "pain_point",
    "workflow_friction",
    "product_problem",
    "task_failure",
    "blocker",
    "risk"
  ]),
  state: z.enum(["open", "mitigated", "resolved", "unclear"]),
  affectedEntityIds: z.array(nonBlankStringSchema)
});

export type ProblemSignalItemV1 = z.infer<typeof problemSignalItemV1Schema>;

export const changeEventItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("change_event"),
  attribution: z.literal("user"),
  supportType: z.enum(["explicit", "accepted_context"]),
  changeKind: z.enum([
    "scope",
    "condition",
    "approach",
    "phase",
    "replacement"
  ]),
  subjectEntityIds: z.array(nonBlankStringSchema),
  before: nonBlankStringSchema,
  after: nonBlankStringSchema,
  reasonText: nonBlankStringSchema.nullable()
});

export type ChangeEventItemV1 = z.infer<typeof changeEventItemV1Schema>;

export const entityItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("entity"),
  attribution: semanticAttributionV1Schema,
  supportType: z.literal("explicit"),
  entityKind: z.enum([
    "product",
    "feature",
    "technology",
    "document",
    "person",
    "organization",
    "concept",
    "data_source"
  ]),
  canonicalName: nonBlankStringSchema,
  aliases: z.array(nonBlankStringSchema)
});

export type EntityItemV1 = z.infer<typeof entityItemV1Schema>;

export const relationPredicateV1Schema = z.enum([
  "USES",
  "REQUIRES",
  "INCLUDES",
  "EXCLUDES",
  "REPLACES",
  "ALTERNATIVE_TO",
  "CAUSES",
  "SOLVES",
  "PART_OF",
  "SUPPORTS"
]);

export type RelationPredicateV1 = z.infer<typeof relationPredicateV1Schema>;

export const relationItemV1Schema = semanticItemBaseV1Schema.extend({
  type: z.literal("relation"),
  attribution: semanticAttributionV1Schema,
  supportType: z.enum(["explicit", "accepted_context"]),
  sourceEntityId: nonBlankStringSchema,
  polarity: z.enum(["affirmed", "negated"]),
  modality: z.enum(["asserted", "planned", "proposed"]),
  predicate: relationPredicateV1Schema,
  targetEntityId: nonBlankStringSchema
});

export type RelationItemV1 = z.infer<typeof relationItemV1Schema>;

export const coreSemanticItemV1Schema = z.discriminatedUnion("type", [
  intentItemV1Schema,
  topicItemV1Schema,
  contentConstraintItemV1Schema,
  problemSignalItemV1Schema,
  changeEventItemV1Schema,
  entityItemV1Schema,
  relationItemV1Schema
]);

export type CoreSemanticItemV1 = z.infer<typeof coreSemanticItemV1Schema>;

export const candidateValidationStatusV1Schema = z.enum([
  "pending",
  "verified",
  "review_required",
  "rejected"
]);

export type CandidateValidationStatusV1 = z.infer<
  typeof candidateValidationStatusV1Schema
>;

export const semanticCandidateV1Schema = z
  .object({
    candidate: z
      .unknown()
      .refine((candidate) => candidate !== undefined, "candidate is required."),
    validationStatus: candidateValidationStatusV1Schema,
    supportType: candidateSupportTypeV1Schema,
    reviewReasons: z.array(verificationReasonV1Schema)
  })
  .strict();

export type SemanticCandidateV1 = z.infer<typeof semanticCandidateV1Schema>;

export const semanticCoreSnapshotBaseV1Schema = z
  .object({
    schemaVersion: z.literal("blabase-semantic-core.v1"),
    snapshotId: nonBlankStringSchema,
    snapshotVersion: nonBlankStringSchema,
    analysisId: nonBlankStringSchema,
    conversationId: nonBlankStringSchema,
    conversationRevision: nonBlankStringSchema,
    createdAt: z.string().datetime(),
    extractorVersion: nonBlankStringSchema,
    verifierVersion: nonBlankStringSchema,
    normalizerVersion: nonBlankStringSchema,
    items: z.array(coreSemanticItemV1Schema),
    evidence: z.array(evidenceAnchorV1Schema)
  })
  .strict();

export const semanticCoreSnapshotV1Schema =
  semanticCoreSnapshotBaseV1Schema.superRefine((snapshot, ctx) => {
    validateSemanticCoreSnapshotV1(snapshot, ctx);
  });

export type SemanticCoreSnapshotV1 = z.infer<
  typeof semanticCoreSnapshotV1Schema
>;

type SnapshotV1Input = z.infer<typeof semanticCoreSnapshotBaseV1Schema>;

type IndexedItem = {
  item: CoreSemanticItemV1;
  index: number;
};

type IndexedEvidence = {
  evidence: EvidenceAnchorV1;
  index: number;
};

function validateSemanticCoreSnapshotV1(
  snapshot: SnapshotV1Input,
  ctx: RefinementCtx
): void {
  const itemIndexesById = collectIndexes(snapshot.items, (item) => item.id);
  const evidenceIndexesById = collectIndexes(
    snapshot.evidence,
    (evidence) => evidence.id
  );

  reportDuplicateIndexes(
    itemIndexesById,
    ctx,
    "items",
    "DUPLICATE_ITEM_ID",
    "Semantic Item ID must be unique within a Snapshot."
  );
  reportDuplicateIndexes(
    evidenceIndexesById,
    ctx,
    "evidence",
    "DUPLICATE_EVIDENCE_ID",
    "Evidence ID must be unique within a Snapshot."
  );

  const itemById = buildUniqueItemLookup(snapshot.items, itemIndexesById);
  const evidenceById = buildUniqueEvidenceLookup(
    snapshot.evidence,
    evidenceIndexesById
  );
  const referencedEvidenceIds = new Set<string>();

  for (const [itemIndex, item] of snapshot.items.entries()) {
    validateItemReferences(
      item,
      itemIndex,
      itemById,
      itemIndexesById,
      evidenceIndexesById,
      referencedEvidenceIds,
      ctx
    );
  }

  for (const [itemIndex, item] of snapshot.items.entries()) {
    validateEvidenceSupport(item, itemIndex, evidenceById, ctx);
  }

  validateTopicGraph(snapshot.items, itemById, ctx);
  validateRelations(snapshot.items, itemById, ctx);

  for (const [evidenceId, indexes] of evidenceIndexesById) {
    if (indexes.length !== 1 || referencedEvidenceIds.has(evidenceId)) {
      continue;
    }
    addIssue(
      ctx,
      ["evidence", indexes[0], "id"],
      "ORPHAN_EVIDENCE",
      `Evidence ${evidenceId} is not referenced by any Semantic Item.`
    );
  }
}

function validateItemReferences(
  item: CoreSemanticItemV1,
  itemIndex: number,
  itemById: Map<string, IndexedItem>,
  itemIndexesById: Map<string, number[]>,
  evidenceIndexesById: Map<string, number[]>,
  referencedEvidenceIds: Set<string>,
  ctx: RefinementCtx
): void {
  reportDuplicateValues(
    item.evidenceRefs.map((reference) => reference.evidenceId),
    ctx,
    ["items", itemIndex, "evidenceRefs"],
    "DUPLICATE_EVIDENCE_REF",
    "A Semantic Item cannot reference the same Evidence more than once."
  );

  for (const [referenceIndex, reference] of item.evidenceRefs.entries()) {
    const evidenceIndexes = evidenceIndexesById.get(reference.evidenceId);
    if (!evidenceIndexes || evidenceIndexes.length === 0) {
      addIssue(
        ctx,
        ["items", itemIndex, "evidenceRefs", referenceIndex, "evidenceId"],
        "MISSING_EVIDENCE",
        `Evidence ${reference.evidenceId} does not exist in this Snapshot.`
      );
      continue;
    }
    referencedEvidenceIds.add(reference.evidenceId);
  }

  reportDuplicateValues(
    item.topicIds,
    ctx,
    ["items", itemIndex, "topicIds"],
    "DUPLICATE_REFERENCE",
    "topicIds cannot contain duplicate IDs."
  );
  validateTypedReferences(
    item.topicIds,
    "topic",
    itemIndex,
    "topicIds",
    itemById,
    itemIndexesById,
    ctx,
    "DANGLING_TOPIC_REFERENCE"
  );

  switch (item.type) {
    case "intent":
    case "content_constraint":
      validateEntityReferences(
        item.targetEntityIds,
        itemIndex,
        "targetEntityIds",
        itemById,
        itemIndexesById,
        ctx
      );
      break;
    case "problem_signal":
      validateEntityReferences(
        item.affectedEntityIds,
        itemIndex,
        "affectedEntityIds",
        itemById,
        itemIndexesById,
        ctx
      );
      break;
    case "change_event":
      validateEntityReferences(
        item.subjectEntityIds,
        itemIndex,
        "subjectEntityIds",
        itemById,
        itemIndexesById,
        ctx
      );
      if (
        normalizeComparisonText(item.before) ===
        normalizeComparisonText(item.after)
      ) {
        addIssue(
          ctx,
          ["items", itemIndex, "after"],
          "CHANGE_STATE_UNCHANGED",
          "Change Event before and after states must be different."
        );
      }
      break;
    case "topic":
      if (item.startMessageIndex > item.endMessageIndex) {
        addIssue(
          ctx,
          ["items", itemIndex, "endMessageIndex"],
          "TOPIC_RANGE_INVALID",
          "Topic endMessageIndex must be greater than or equal to startMessageIndex."
        );
      }
      if (item.level === "main" && item.parentTopicId !== null) {
        addIssue(
          ctx,
          ["items", itemIndex, "parentTopicId"],
          "DANGLING_TOPIC_REFERENCE",
          "A main Topic must have parentTopicId set to null."
        );
      }
      if (item.level === "subtopic" && item.parentTopicId === null) {
        addIssue(
          ctx,
          ["items", itemIndex, "parentTopicId"],
          "DANGLING_TOPIC_REFERENCE",
          "A subtopic must reference a parent Topic."
        );
      }
      if (item.parentTopicId !== null) {
        validateTypedReferences(
          [item.parentTopicId],
          "topic",
          itemIndex,
          "parentTopicId",
          itemById,
          itemIndexesById,
          ctx,
          "DANGLING_TOPIC_REFERENCE"
        );
      }
      break;
    case "relation":
      validateTypedReferences(
        [item.sourceEntityId],
        "entity",
        itemIndex,
        "sourceEntityId",
        itemById,
        itemIndexesById,
        ctx,
        "RELATION_ENDPOINT_MISSING"
      );
      validateTypedReferences(
        [item.targetEntityId],
        "entity",
        itemIndex,
        "targetEntityId",
        itemById,
        itemIndexesById,
        ctx,
        "RELATION_ENDPOINT_MISSING"
      );
      break;
    case "entity":
      break;
  }
}

function validateEvidenceSupport(
  item: CoreSemanticItemV1,
  itemIndex: number,
  evidenceById: Map<string, IndexedEvidence>,
  ctx: RefinementCtx
): void {
  const referenceIds = item.evidenceRefs.map(
    (reference) => reference.evidenceId
  );
  if (
    new Set(referenceIds).size !== referenceIds.length ||
    referenceIds.some((evidenceId) => !evidenceById.has(evidenceId))
  ) {
    return;
  }

  const resolvedReferences = item.evidenceRefs.flatMap((reference) => {
    const indexedEvidence = evidenceById.get(reference.evidenceId);
    return indexedEvidence
      ? [{ reference, evidence: indexedEvidence.evidence }]
      : [];
  });

  if (item.supportType === "explicit") {
    for (const [referenceIndex, reference] of item.evidenceRefs.entries()) {
      if (reference.role !== "direct_support") {
        addIssue(
          ctx,
          ["items", itemIndex, "evidenceRefs", referenceIndex, "role"],
          "ATTRIBUTION_MISMATCH",
          "Explicit items may only use direct_support Evidence Refs."
        );
      }
    }

    if (item.attribution !== "conversation") {
      const wrongRole = resolvedReferences.find(
        ({ evidence }) => evidence.role !== item.attribution
      );
      if (wrongRole) {
        addIssue(
          ctx,
          ["items", itemIndex, "attribution"],
          "ATTRIBUTION_MISMATCH",
          `An explicit ${item.attribution}-attributed item must use ${item.attribution} Evidence.`
        );
      }
    }

    if (item.type === "topic") {
      for (const { evidence } of resolvedReferences) {
        if (
          evidence.messageIndex < item.startMessageIndex ||
          evidence.messageIndex > item.endMessageIndex
        ) {
          addIssue(
            ctx,
            ["items", itemIndex, "evidenceRefs"],
            "TOPIC_RANGE_INVALID",
            "Topic Evidence must fall inside the Topic message range."
          );
          break;
        }
      }
    }
    return;
  }

  if (item.attribution !== "user") {
    addIssue(
      ctx,
      ["items", itemIndex, "attribution"],
      "ATTRIBUTION_MISMATCH",
      "accepted_context items must be attributed to the user."
    );
  }

  const propositions = resolvedReferences.filter(
    ({ reference }) => reference.role === "proposition"
  );
  const acceptances = resolvedReferences.filter(
    ({ reference }) => reference.role === "acceptance"
  );

  if (propositions.length === 0 || acceptances.length === 0) {
    addIssue(
      ctx,
      ["items", itemIndex, "evidenceRefs"],
      "INVALID_ACCEPTED_CONTEXT",
      "accepted_context requires proposition and acceptance Evidence Refs."
    );
    return;
  }

  if (propositions.some(({ evidence }) => evidence.role !== "assistant")) {
    addIssue(
      ctx,
      ["items", itemIndex, "evidenceRefs"],
      "INVALID_ACCEPTED_CONTEXT",
      "Proposition Evidence must come from an assistant message."
    );
  }
  if (acceptances.some(({ evidence }) => evidence.role !== "user")) {
    addIssue(
      ctx,
      ["items", itemIndex, "evidenceRefs"],
      "INVALID_ACCEPTED_CONTEXT",
      "Acceptance Evidence must come from a user message."
    );
  }

  const latestPropositionIndex = Math.max(
    ...propositions.map(({ evidence }) => evidence.messageIndex)
  );
  const earliestAcceptanceIndex = Math.min(
    ...acceptances.map(({ evidence }) => evidence.messageIndex)
  );
  if (earliestAcceptanceIndex <= latestPropositionIndex) {
    addIssue(
      ctx,
      ["items", itemIndex, "evidenceRefs"],
      "INVALID_ACCEPTED_CONTEXT",
      "Acceptance Evidence must follow all proposition Evidence."
    );
  }

  const wrongDirectSupport = resolvedReferences.find(
    ({ reference, evidence }) =>
      reference.role === "direct_support" && evidence.role !== "user"
  );
  if (wrongDirectSupport) {
    addIssue(
      ctx,
      ["items", itemIndex, "evidenceRefs"],
      "ATTRIBUTION_MISMATCH",
      "Direct support on an accepted_context item must come from the user."
    );
  }
}

function validateTopicGraph(
  items: CoreSemanticItemV1[],
  itemById: Map<string, IndexedItem>,
  ctx: RefinementCtx
): void {
  const topics = items
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: TopicItemV1; index: number } =>
        entry.item.type === "topic"
    );
  const parentByTopicId = new Map<string, string>();

  for (const { item } of topics) {
    if (item.level !== "subtopic" || item.parentTopicId === null) {
      continue;
    }
    const parent = itemById.get(item.parentTopicId)?.item;
    if (parent?.type === "topic") {
      parentByTopicId.set(item.id, item.parentTopicId);
    }
  }

  const completed = new Set<string>();
  const reportedCycleIds = new Set<string>();
  for (const { item, index } of topics) {
    if (completed.has(item.id)) {
      continue;
    }
    const path: string[] = [];
    const positionById = new Map<string, number>();
    let currentId: string | undefined = item.id;

    while (currentId !== undefined && !completed.has(currentId)) {
      const cycleStart = positionById.get(currentId);
      if (cycleStart !== undefined) {
        const cycleIds = path.slice(cycleStart);
        const cycleKey = JSON.stringify([...cycleIds].sort());
        if (!reportedCycleIds.has(cycleKey)) {
          reportedCycleIds.add(cycleKey);
          const closingTopicId = path[path.length - 1];
          const closingTopicIndex = closingTopicId
            ? (itemById.get(closingTopicId)?.index ?? index)
            : index;
          addIssue(
            ctx,
            ["items", closingTopicIndex, "parentTopicId"],
            "REFERENCE_CYCLE",
            `Topic parent cycle detected: ${cycleIds.join(" -> ")}.`
          );
        }
        break;
      }
      positionById.set(currentId, path.length);
      path.push(currentId);
      currentId = parentByTopicId.get(currentId);
    }

    for (const topicId of path) {
      completed.add(topicId);
    }
  }
}

function validateRelations(
  items: CoreSemanticItemV1[],
  itemById: Map<string, IndexedItem>,
  ctx: RefinementCtx
): void {
  const relationIndexBySignature = new Map<string, number>();

  for (const [itemIndex, item] of items.entries()) {
    if (item.type !== "relation") {
      continue;
    }

    const source = itemById.get(item.sourceEntityId)?.item;
    const target = itemById.get(item.targetEntityId)?.item;
    if (source?.type !== "entity" || target?.type !== "entity") {
      continue;
    }

    if (item.sourceEntityId === item.targetEntityId) {
      addIssue(
        ctx,
        ["items", itemIndex, "targetEntityId"],
        "RELATION_SELF_EDGE",
        "Relation endpoints must reference two distinct Entities."
      );
    }

    if (
      item.predicate === "ALTERNATIVE_TO" &&
      item.sourceEntityId > item.targetEntityId
    ) {
      addIssue(
        ctx,
        ["items", itemIndex, "sourceEntityId"],
        "RELATION_CANONICAL_ORDER_INVALID",
        "ALTERNATIVE_TO endpoints must use ascending Entity ID order."
      );
    }

    const signature = relationSignature(item);
    const previousIndex = relationIndexBySignature.get(signature);
    if (previousIndex !== undefined) {
      addIssue(
        ctx,
        ["items", itemIndex],
        "DUPLICATE_RELATION",
        `Relation duplicates items[${previousIndex}].`
      );
    } else {
      relationIndexBySignature.set(signature, itemIndex);
    }
  }

  for (const [itemIndex, item] of items.entries()) {
    if (item.type !== "relation") {
      continue;
    }

    const inversePredicate =
      item.predicate === "INCLUDES"
        ? "PART_OF"
        : item.predicate === "PART_OF"
          ? "INCLUDES"
          : null;
    if (inversePredicate === null) {
      continue;
    }
    const inverseSignature = relationSignature({
      ...item,
      sourceEntityId: item.targetEntityId,
      predicate: inversePredicate,
      targetEntityId: item.sourceEntityId
    });
    const inverseIndex = relationIndexBySignature.get(inverseSignature);
    if (inverseIndex !== undefined && itemIndex > inverseIndex) {
      addIssue(
        ctx,
        ["items", itemIndex],
        "DUPLICATE_RELATION",
        `${item.predicate} duplicates inverse ${inversePredicate} at items[${inverseIndex}].`
      );
    }
  }
}

function validateEntityReferences(
  entityIds: string[],
  itemIndex: number,
  field: string,
  itemById: Map<string, IndexedItem>,
  itemIndexesById: Map<string, number[]>,
  ctx: RefinementCtx
): void {
  reportDuplicateValues(
    entityIds,
    ctx,
    ["items", itemIndex, field],
    "DUPLICATE_REFERENCE",
    `${field} cannot contain duplicate IDs.`
  );
  validateTypedReferences(
    entityIds,
    "entity",
    itemIndex,
    field,
    itemById,
    itemIndexesById,
    ctx,
    "DANGLING_ENTITY_REFERENCE"
  );
}

function validateTypedReferences(
  referenceIds: string[],
  expectedType: "topic" | "entity",
  itemIndex: number,
  field: string,
  itemById: Map<string, IndexedItem>,
  itemIndexesById: Map<string, number[]>,
  ctx: RefinementCtx,
  missingReason:
    | "DANGLING_TOPIC_REFERENCE"
    | "DANGLING_ENTITY_REFERENCE"
    | "RELATION_ENDPOINT_MISSING"
): void {
  for (const referenceId of referenceIds) {
    const targetIndexes = itemIndexesById.get(referenceId);
    if (targetIndexes && targetIndexes.length > 1) {
      continue;
    }
    const target = itemById.get(referenceId)?.item;
    if (!target) {
      addIssue(
        ctx,
        ["items", itemIndex, field],
        missingReason,
        `${field} references missing or ambiguous ID ${referenceId}.`
      );
      continue;
    }
    if (target.type !== expectedType) {
      addIssue(
        ctx,
        ["items", itemIndex, field],
        "REFERENCE_TARGET_TYPE_MISMATCH",
        `${field} must reference a ${expectedType} item, received ${target.type}.`
      );
    }
  }
}

function collectIndexes<T>(
  values: T[],
  getId: (value: T) => string
): Map<string, number[]> {
  const indexesById = new Map<string, number[]>();
  values.forEach((value, index) => {
    const id = getId(value);
    const indexes = indexesById.get(id) ?? [];
    indexes.push(index);
    indexesById.set(id, indexes);
  });
  return indexesById;
}

function reportDuplicateIndexes(
  indexesById: Map<string, number[]>,
  ctx: RefinementCtx,
  collection: "items" | "evidence",
  reason: "DUPLICATE_ITEM_ID" | "DUPLICATE_EVIDENCE_ID",
  message: string
): void {
  for (const indexes of indexesById.values()) {
    if (indexes.length < 2) {
      continue;
    }
    for (const index of indexes) {
      addIssue(ctx, [collection, index, "id"], reason, message);
    }
  }
}

function reportDuplicateValues(
  values: string[],
  ctx: RefinementCtx,
  path: Array<string | number>,
  reason: "DUPLICATE_EVIDENCE_REF" | "DUPLICATE_REFERENCE",
  message: string
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      addIssue(ctx, path, reason, message);
      return;
    }
    seen.add(value);
  }
}

function buildUniqueItemLookup(
  items: CoreSemanticItemV1[],
  indexesById: Map<string, number[]>
): Map<string, IndexedItem> {
  const itemById = new Map<string, IndexedItem>();
  for (const [id, indexes] of indexesById) {
    if (indexes.length !== 1) {
      continue;
    }
    const index = indexes[0];
    const item = items[index];
    if (item) {
      itemById.set(id, { item, index });
    }
  }
  return itemById;
}

function buildUniqueEvidenceLookup(
  evidence: EvidenceAnchorV1[],
  indexesById: Map<string, number[]>
): Map<string, IndexedEvidence> {
  const evidenceById = new Map<string, IndexedEvidence>();
  for (const [id, indexes] of indexesById) {
    if (indexes.length !== 1) {
      continue;
    }
    const index = indexes[0];
    const item = evidence[index];
    if (item) {
      evidenceById.set(id, { evidence: item, index });
    }
  }
  return evidenceById;
}

function relationSignature(item: RelationItemV1): string {
  return JSON.stringify([
    item.sourceEntityId,
    item.predicate,
    item.targetEntityId,
    item.polarity,
    item.modality
  ]);
}

function normalizeComparisonText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

function addIssue(
  ctx: RefinementCtx,
  path: Array<string | number>,
  reason: VerificationReasonV1,
  message: string
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
    params: { reason }
  });
}
