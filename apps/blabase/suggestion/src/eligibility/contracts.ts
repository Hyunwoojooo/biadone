import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
  ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_ID_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_RESOLVER_VERSION,
  ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT
} from "../crossSource/versions";

export const MAX_ATTENTION_ELIGIBILITY_ASSESSMENTS = 12_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSeedIdSchema = z.string().regex(/^seed_[a-f0-9]{32}$/);
const assessmentIdSchema = z.string().regex(/^elig_[a-f0-9]{32}$/);
const signalIdSchema = z.string().regex(/^sig_[a-f0-9]{32}$/);
const targetRefSchema = z.string().regex(/^claim_subject_[a-f0-9]{32}$/);
const relationRefSchema = z.string().regex(/^relation_[a-f0-9]{32}$/);
const conflictIdSchema = z.string().regex(/^claim_conflict_[a-f0-9]{32}$/);

export const attentionEligibilityStatusSchema = z.enum([
  "eligible",
  "review_required",
  "ineligible"
]);

export const attentionEligibilityReviewRouteSchema = z.enum([
  "none",
  "user_review",
  "refresh_sources"
]);

export const attentionEligibilityReasonCodeSchema = z.enum([
  "ELIGIBLE_DIRECT_ASSIGNED_ISSUE",
  "ELIGIBLE_REVIEW_STATUS_INSPECTION",
  "ELIGIBLE_RELEVANT_CONFLICT_RESOLVED",
  "ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH",
  "REVIEW_SOURCE_STALE",
  "REVIEW_MATERIAL_CLAIM_MISSING",
  "REVIEW_MATERIAL_CLAIM_UNRESOLVED",
  "REVIEW_MATERIAL_EVIDENCE_PARTIAL",
  "INELIGIBLE_CONTEXT_ONLY",
  "INELIGIBLE_UNSUPPORTED_TASK_KIND",
  "INELIGIBLE_NATIVE_DESTINATION_MISSING",
  "INELIGIBLE_NOT_CANDIDATE_INPUT",
  "INELIGIBLE_CURRENT_STATE_NOT_OPEN",
  "INELIGIBLE_USER_RELATIONSHIP_MISMATCH"
]);

export const attentionEligibilityAssessmentSchema = z
  .object({
    assessmentId: assessmentIdSchema,
    candidateSeedId: candidateSeedIdSchema,
    source: z.literal("github"),
    sourceSignalId: signalIdSchema,
    targetRef: targetRefSchema,
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    actionKind: z.enum(["do", "inspect"]).nullable(),
    status: attentionEligibilityStatusSchema,
    reviewRoute: attentionEligibilityReviewRouteSchema,
    reasonCodes: z.array(attentionEligibilityReasonCodeSchema).min(1).max(12),
    relationRefs: z.array(relationRefSchema).max(100),
    relatedConflictIds: z.array(conflictIdSchema).max(100),
    attentionDisposition: z.literal("shadow_only"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      (assessment.status === "review_required") !==
      (assessment.reviewRoute !== "none")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewRoute"],
        message: "Only review-required assessments may request a review route."
      });
    }
    if (
      assessment.taskKind === "assigned_issue" &&
      assessment.status !== "ineligible" &&
      assessment.actionKind !== "do"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionKind"],
        message: "An actionable assigned issue uses the direct do action."
      });
    }
    if (
      assessment.taskKind === "review_requested_pull_request" &&
      assessment.status !== "ineligible" &&
      assessment.actionKind !== "inspect"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionKind"],
        message: "A draft-unknown review request is inspection-only."
      });
    }
    if (
      !isCanonicalUnique(assessment.reasonCodes) ||
      !isCanonicalUnique(assessment.relationRefs) ||
      !isCanonicalUnique(assessment.relatedConflictIds)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Eligibility reasons and references must be canonical."
      });
    }
  });

export const attentionEligibilityDependenciesSchema = z
  .object({
    workRelationProjectionSha256: sha256Schema,
    artifactRelationProjectionSha256: sha256Schema,
    claimAuthorityProjectionSha256: sha256Schema,
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    managedSourceRevision: z.number().int().nonnegative(),
    managedGeneratedAt: timestampSchema,
    managedSemanticProjectionSha256: sha256Schema,
    contextRegistrySha256: sha256Schema.nullable()
  })
  .strict();

const eligibilityProjectionContentSchema = z
  .object({
    contract: z.literal(
      ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT
    ),
    candidateSeedSchemaVersion: z.literal(
      ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION
    ),
    policyVersion: z.literal(ATTENTION_ELIGIBILITY_POLICY_VERSION),
    evidencePolicyVersion: z.literal(
      ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION
    ),
    resolverVersion: z.literal(
      ATTENTION_ELIGIBILITY_RESOLVER_VERSION
    ),
    idPolicyVersion: z.literal(ATTENTION_ELIGIBILITY_ID_POLICY_VERSION),
    mode: z.literal("shadow"),
    asOf: timestampSchema,
    dependencies: attentionEligibilityDependenciesSchema,
    coverage: z
      .object({
        candidateUniverse: z.literal("github_work_items_only"),
        githubCandidateCoverage: z.enum([
          "complete",
          "partial",
          "stale",
          "unavailable"
        ]),
        codexManagedEligibility: z.literal("not_evaluated_phase_4a"),
        totalGitHubWorkItemSignalCount: z.number().int().nonnegative(),
        candidateSeedCount: z.number().int().nonnegative(),
        unrelatedUnresolvedCriticalConflictCount: z
          .number()
          .int()
          .nonnegative()
      })
      .strict(),
    counts: z
      .object({
        eligible: z.number().int().nonnegative(),
        reviewRequired: z.number().int().nonnegative(),
        ineligible: z.number().int().nonnegative()
      })
      .strict(),
    assessments: z
      .array(attentionEligibilityAssessmentSchema)
      .max(MAX_ATTENTION_ELIGIBILITY_ASSESSMENTS),
    inputSha256: sha256Schema,
    attentionSelectionEffect: z.literal("none"),
    attentionDisposition: z.literal("shadow_only"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const attentionEligibilityShadowProjectionSchema =
  eligibilityProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        attentionEligibilityProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Eligibility shadow projection hash is invalid."
        });
      }
      const candidateSeedIds = projection.assessments.map(
        (assessment) => assessment.candidateSeedId
      );
      if (
        projection.inputSha256 !==
        attentionEligibilityInputSha256({
          asOf: projection.asOf,
          dependencies: projection.dependencies,
          candidateSeedIds
        })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputSha256"],
          message: "Eligibility shadow input hash is invalid."
        });
      }
      if (
        !isCanonicalUnique(
          projection.assessments.map(
            (assessment) => assessment.assessmentId
          )
        ) ||
        new Set(candidateSeedIds).size !== candidateSeedIds.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assessments"],
          message: "Eligibility assessments must be unique and canonical."
        });
      }
      if (
        projection.coverage.candidateSeedCount !==
          projection.assessments.length ||
        projection.counts.eligible !==
          projection.assessments.filter(
            (assessment) => assessment.status === "eligible"
          ).length ||
        projection.counts.reviewRequired !==
          projection.assessments.filter(
            (assessment) => assessment.status === "review_required"
          ).length ||
        projection.counts.ineligible !==
          projection.assessments.filter(
            (assessment) => assessment.status === "ineligible"
          ).length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Eligibility projection counts are incoherent."
        });
      }
      if (
        Date.parse(projection.dependencies.managedGeneratedAt) >
        Date.parse(projection.asOf)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dependencies", "managedGeneratedAt"],
          message: "Eligibility projection cannot depend on future evidence."
        });
      }
    });

export type AttentionEligibilityStatus = z.infer<
  typeof attentionEligibilityStatusSchema
>;
export type AttentionEligibilityReasonCode = z.infer<
  typeof attentionEligibilityReasonCodeSchema
>;
export type AttentionEligibilityAssessment = z.infer<
  typeof attentionEligibilityAssessmentSchema
>;
export type AttentionEligibilityDependencies = z.infer<
  typeof attentionEligibilityDependenciesSchema
>;
export type AttentionEligibilityShadowProjection = z.infer<
  typeof attentionEligibilityShadowProjectionSchema
>;
export type AttentionEligibilityShadowProjectionContent = z.infer<
  typeof eligibilityProjectionContentSchema
>;

export type AttentionEligibilityReadyResponse = {
  status: "ready";
  projection: AttentionEligibilityShadowProjection;
};

export type AttentionEligibilityUnavailableResponse = {
  status: "unavailable";
  message: string;
  localUrl: string;
};

export type AttentionEligibilityErrorResponse = {
  status: "error";
  code: string;
  message: string;
};

export type AttentionEligibilityApiResponse =
  | AttentionEligibilityReadyResponse
  | AttentionEligibilityUnavailableResponse
  | AttentionEligibilityErrorResponse;

export function attentionEligibilityInputSha256(input: {
  asOf: string;
  dependencies: AttentionEligibilityDependencies;
  candidateSeedIds: string[];
}): string {
  return runtimeSha256({
    domain: "attention-eligibility-shadow-input-v0.1",
    asOf: input.asOf,
    dependencies: input.dependencies,
    candidateSeedIds: [...input.candidateSeedIds].sort(compareRuntimeStrings)
  });
}

export function sealAttentionEligibilityShadowProjection(
  content: AttentionEligibilityShadowProjectionContent
): AttentionEligibilityShadowProjection {
  return attentionEligibilityShadowProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function attentionEligibilityProjectionSha256(
  projection: AttentionEligibilityShadowProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT,
    projection: content
  });
}

function isCanonicalUnique(values: string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.join("|") === [...values].sort(compareRuntimeStrings).join("|")
  );
}
