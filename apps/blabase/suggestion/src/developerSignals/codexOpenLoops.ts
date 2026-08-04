import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal
} from "../crossSource/schema";
import { verifyRuntimeWorkSignalBatchIntegrity } from "../crossSource/workSignalIntegrity";

export const CODEX_OPEN_LOOP_INPUT_CONTRACT =
  "codex-open-loop-input-v1" as const;
export const CODEX_OPEN_LOOP_LEDGER_CONTRACT =
  "codex-open-loop-ledger-v1" as const;
export const CODEX_OPEN_LOOP_SCHEMA_VERSION =
  "codex-open-loop-schema-v1" as const;
export const CODEX_OPEN_LOOP_RULE_VERSION =
  "codex-open-loop-conservative-rules-v1" as const;
export const CODEX_OPEN_LOOP_EVIDENCE_POLICY_VERSION =
  "codex-open-loop-bounded-evidence-v1" as const;
export const CODEX_OPEN_LOOP_EXPIRY_POLICY_VERSION =
  "codex-open-loop-seven-day-expiry-v1" as const;

const OPEN_LOOP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_SIGNALS = 5_000;
const MAX_CLAIMS = 20_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const signalIdSchema = z.string().regex(/^sig_[a-f0-9]{32}$/);
const subjectIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const projectIdSchema = z
  .string()
  .regex(/^project_[a-f0-9]{32}$/)
  .nullable();
const boundedFactSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
        value
      ),
    "Codex open-loop facts cannot contain control characters."
  );

export const codexOpenLoopClaimTypeSchema = z.enum([
  "goal",
  "remaining_work",
  "blocker",
  "verification_needed",
  "follow_through"
]);

export const codexOpenLoopEvidenceFieldSchema = z.enum([
  "task_summary",
  "latest_user_prompt_excerpt",
  "latest_agent_response_excerpt",
  "latest_execution_summary"
]);

const codexOpenLoopInputEvidenceSchema = z
  .object({
    field: codexOpenLoopEvidenceFieldSchema,
    valueSha256: sha256Schema,
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema
  })
  .strict();

const historicalContextCompletenessSchema = z.enum([
  "not_collected",
  "complete",
  "partial",
  "unavailable"
]);

const historicalTurnStatusSchema = z.enum([
  "completed",
  "failed",
  "interrupted",
  "in_progress",
  "unknown"
]);

export const codexOpenLoopSignalInputSchema = z
  .object({
    signalId: signalIdSchema,
    subjectId: subjectIdSchema,
    projectId: projectIdSchema,
    sourceUpdatedAt: timestampSchema,
    evidenceValidUntil: timestampSchema.nullable(),
    historicalContextCompleteness:
      historicalContextCompletenessSchema,
    historicalTurnStatus: historicalTurnStatusSchema,
    contentTruncated: z.boolean(),
    taskSummary: boundedFactSchema.nullable(),
    latestUserPromptExcerpt: boundedFactSchema.nullable(),
    latestAgentResponseExcerpt: boundedFactSchema.nullable(),
    latestExecutionSummary: boundedFactSchema.nullable(),
    factEvidence: z
      .array(codexOpenLoopInputEvidenceSchema)
      .max(codexOpenLoopEvidenceFieldSchema.options.length)
  })
  .strict()
  .superRefine((signal, context) => {
    const contentAvailable =
      signal.historicalContextCompleteness === "complete" ||
      signal.historicalContextCompleteness === "partial";
    if (
      !contentAvailable &&
      (signal.latestUserPromptExcerpt !== null ||
        signal.latestAgentResponseExcerpt !== null ||
        signal.latestExecutionSummary !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["historicalContextCompleteness"],
        message:
          "Historical excerpts require available complete or partial content."
      });
    }
    if (
      signal.evidenceValidUntil !== null &&
      Date.parse(signal.evidenceValidUntil) <=
        Date.parse(signal.sourceUpdatedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceValidUntil"],
        message:
          "Evidence validity must extend beyond its source update time."
      });
    }
    const expectedFacts = openLoopFacts(signal);
    const evidenceByField = new Map(
      signal.factEvidence.map((evidence) => [evidence.field, evidence])
    );
    if (evidenceByField.size !== signal.factEvidence.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["factEvidence"],
        message: "Codex open-loop fact evidence fields must be unique."
      });
    }
    for (const [field, value] of expectedFacts) {
      const evidence = evidenceByField.get(field);
      if (
        !evidence ||
        evidence.sourceUpdatedAt !== signal.sourceUpdatedAt ||
        evidence.valueSha256 !== codexSessionFieldSha256(field, value)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["factEvidence"],
          message:
            "Every bounded Codex fact requires exact source-field evidence."
        });
      }
    }
    if (
      signal.factEvidence.some(
        (evidence) => !expectedFacts.has(evidence.field)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["factEvidence"],
        message: "Codex open-loop evidence cannot outlive its mapped fact."
      });
    }
  });

export const codexOpenLoopInputSchema = z
  .object({
    contract: z.literal(CODEX_OPEN_LOOP_INPUT_CONTRACT),
    asOf: timestampSchema,
    signals: z.array(codexOpenLoopSignalInputSchema).max(MAX_SIGNALS)
  })
  .strict()
  .superRefine((input, context) => {
    const signalIds = input.signals.map((signal) => signal.signalId);
    if (new Set(signalIds).size !== signalIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signals"],
        message: "Codex open-loop input signal IDs must be unique."
      });
    }
    const asOfMs = Date.parse(input.asOf);
    input.signals.forEach((signal, index) => {
      if (
        Date.parse(signal.sourceUpdatedAt) > asOfMs ||
        signal.factEvidence.some(
          (evidence) => Date.parse(evidence.observedAt) > asOfMs
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["signals", index, "sourceUpdatedAt"],
          message: "Codex open-loop evidence cannot come from the future."
        });
      }
    });
  });

export type CodexOpenLoopInput = z.infer<
  typeof codexOpenLoopInputSchema
>;
export type CodexOpenLoopSignalInput = z.infer<
  typeof codexOpenLoopSignalInputSchema
>;
export type CodexOpenLoopClaimType = z.infer<
  typeof codexOpenLoopClaimTypeSchema
>;
export type CodexOpenLoopEvidenceField = z.infer<
  typeof codexOpenLoopEvidenceFieldSchema
>;

const codexOpenLoopRuleIdSchema = z.enum([
  "TASK_SUMMARY_AS_GOAL",
  "USER_EXPLICIT_REMAINING_WORK",
  "USER_EXPLICIT_BLOCKER",
  "USER_EXPLICIT_VERIFICATION",
  "AGENT_EXPLICIT_BLOCKER",
  "AGENT_EXPLICIT_VERIFICATION",
  "AGENT_EXPLICIT_FOLLOW_THROUGH",
  "EXECUTION_FAILED_NEEDS_INSPECTION"
]);

export const codexOpenLoopEvidenceRefSchema = z
  .object({
    source: z.literal("codex"),
    signalId: signalIdSchema,
    subjectId: subjectIdSchema,
    field: codexOpenLoopEvidenceFieldSchema,
    valueSha256: sha256Schema,
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema
  })
  .strict();

const claimIdSchema = z
  .string()
  .regex(/^open_loop_[a-f0-9]{32}$/);

export const codexOpenLoopClaimSchema = z
  .object({
    claimId: claimIdSchema,
    claimType: codexOpenLoopClaimTypeSchema,
    ruleId: codexOpenLoopRuleIdSchema,
    subjectId: subjectIdSchema,
    projectId: projectIdSchema,
    value: z.string().min(1).max(240),
    confidence: z.number().min(0).max(1),
    verificationStatus: z.enum([
      "unverified",
      "evidence_supported",
      "verified"
    ]),
    lifecycleStatus: z.enum(["open", "expired", "superseded"]),
    sourceUpdatedAt: timestampSchema,
    validUntil: timestampSchema,
    supersededBySignalId: signalIdSchema.nullable(),
    evidenceRefs: z.array(codexOpenLoopEvidenceRefSchema).min(1).max(2),
    attentionDisposition: z.literal("ledger_input_only"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      (claim.lifecycleStatus === "superseded") !==
      (claim.supersededBySignalId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersededBySignalId"],
        message:
          "Only superseded claims may reference a superseding signal."
      });
    }
    if (
      claim.evidenceRefs.some(
        (evidence) =>
          evidence.subjectId !== claim.subjectId ||
          evidence.sourceUpdatedAt !== claim.sourceUpdatedAt
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message:
          "Open-loop evidence must match the claim subject and source revision."
      });
    }
  });

const claimCountsSchema = z
  .object({
    open: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    superseded: z.number().int().nonnegative(),
    byType: z
      .object({
        goal: z.number().int().nonnegative(),
        remaining_work: z.number().int().nonnegative(),
        blocker: z.number().int().nonnegative(),
        verification_needed: z.number().int().nonnegative(),
        follow_through: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const ledgerContentSchema = z
  .object({
    contract: z.literal(CODEX_OPEN_LOOP_LEDGER_CONTRACT),
    schemaVersion: z.literal(CODEX_OPEN_LOOP_SCHEMA_VERSION),
    ruleVersion: z.literal(CODEX_OPEN_LOOP_RULE_VERSION),
    evidencePolicyVersion: z.literal(
      CODEX_OPEN_LOOP_EVIDENCE_POLICY_VERSION
    ),
    expiryPolicyVersion: z.literal(
      CODEX_OPEN_LOOP_EXPIRY_POLICY_VERSION
    ),
    asOf: timestampSchema,
    inputSha256: sha256Schema,
    counts: claimCountsSchema,
    claims: z.array(codexOpenLoopClaimSchema).max(MAX_CLAIMS),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const codexOpenLoopLedgerSchema = ledgerContentSchema
  .extend({ ledgerSha256: sha256Schema })
  .strict()
  .superRefine((ledger, context) => {
    const ids = ledger.claims.map((claim) => claim.claimId);
    if (
      new Set(ids).size !== ids.length ||
      ids.join("|") !==
        [...ids].sort(compareRuntimeStrings).join("|")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claims"],
        message: "Open-loop claims must be unique and canonical."
      });
    }
    const expectedCounts = countClaims(ledger.claims);
    if (
      runtimeSha256(ledger.counts) !== runtimeSha256(expectedCounts)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counts"],
        message: "Open-loop claim counts do not match the ledger."
      });
    }
    const asOfMs = Date.parse(ledger.asOf);
    ledger.claims.forEach((claim, index) => {
      const expired = Date.parse(claim.validUntil) <= asOfMs;
      if (
        claim.lifecycleStatus === "open" &&
        (expired || claim.supersededBySignalId !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", index, "lifecycleStatus"],
          message: "An open claim must be current and unsuperseded."
        });
      }
      if (
        claim.lifecycleStatus === "expired" &&
        (!expired || claim.supersededBySignalId !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", index, "lifecycleStatus"],
          message: "An expired claim must be past its validity window."
        });
      }
    });
    const { ledgerSha256: _ledgerSha256, ...content } = ledger;
    if (
      ledger.ledgerSha256 !==
      runtimeSha256({
        domain: CODEX_OPEN_LOOP_LEDGER_CONTRACT,
        ledger: content
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ledgerSha256"],
        message: "Open-loop ledger hash does not match its content."
      });
    }
  });

export type CodexOpenLoopClaim = z.infer<
  typeof codexOpenLoopClaimSchema
>;
export type CodexOpenLoopLedger = z.infer<
  typeof codexOpenLoopLedgerSchema
>;

type DraftClaim = Omit<
  CodexOpenLoopClaim,
  | "claimId"
  | "lifecycleStatus"
  | "validUntil"
  | "supersededBySignalId"
> & {
  signalId: string;
  evidenceValidUntil: string | null;
};

const BLOCKER_PATTERNS = [
  /(?:막혀|막혔|차단|진행(?:을)?\s*할\s*수\s*없|실패\s*(?:해서|때문)|의존성[^.]{0,40}없)/i,
  /\b(?:blocked by|cannot proceed|can't proceed|unable to proceed|blocking issue|missing dependency)\b/i
] as const;

const VERIFICATION_PATTERNS = [
  /(?:검증|확인)(?:이|을)?\s*(?:필요|해야)/i,
  /테스트(?:가|를)?\s*(?:못|하지\s*못|필요)/i,
  /\b(?:needs? verification|verify this|not tested|tests? (?:were )?not run|needs? testing)\b/i
] as const;

const REMAINING_WORK_PATTERNS = [
  /(?:해야\s*(?:할|될|돼|해|합니다)?|남아\s*있|남은\s*작업|할\s*일|다음\s*(?:작업|단계))/i,
  /\b(?:todo|need to|needs to|must|remaining work|next step)\b/i
] as const;

const FOLLOW_THROUGH_PATTERNS = [
  /(?:후속|다음(?:으로|\s*단계|\s*작업)|이어서|추가로|남은)/i,
  /\b(?:follow[- ]?up|next step|after this|still need)\b/i
] as const;

const COMPLETION_PATTERNS = [
  /(?:완료(?:했|됐|되었|됨)|마쳤|끝냈)/i,
  /\b(?:completed|finished|done)\b/i
] as const;

const FAILED_EXECUTION_PATTERNS = [
  /^failed\b/i,
  /(?:^|·\s*)exit\s+[1-9][0-9]*\b/i
] as const;

/**
 * Extracts a conservative, deterministic ledger from already-bounded Codex
 * overview facts. The returned claims are context for a later eligibility
 * stage; this function never creates or ranks an Attention candidate.
 */
export function extractCodexOpenLoops(
  input: unknown
): CodexOpenLoopLedger {
  const parsed = codexOpenLoopInputSchema.parse(input);
  const orderedSignals = [...parsed.signals].sort(compareSignals);
  const drafts = orderedSignals.flatMap(deriveClaims);
  const completionSignals = orderedSignals.filter(isStrictCompletionMarker);
  const claims = drafts
    .map((draft) =>
      finalizeClaim(draft, drafts, completionSignals, parsed.asOf)
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.claimId, right.claimId)
    );
  const inputSha256 = runtimeSha256({
    domain: CODEX_OPEN_LOOP_INPUT_CONTRACT,
    input: parsed
  });
  const content = ledgerContentSchema.parse({
    contract: CODEX_OPEN_LOOP_LEDGER_CONTRACT,
    schemaVersion: CODEX_OPEN_LOOP_SCHEMA_VERSION,
    ruleVersion: CODEX_OPEN_LOOP_RULE_VERSION,
    evidencePolicyVersion:
      CODEX_OPEN_LOOP_EVIDENCE_POLICY_VERSION,
    expiryPolicyVersion: CODEX_OPEN_LOOP_EXPIRY_POLICY_VERSION,
    asOf: parsed.asOf,
    inputSha256,
    counts: countClaims(claims),
    claims,
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
  return codexOpenLoopLedgerSchema.parse({
    ...content,
    ledgerSha256: runtimeSha256({
      domain: CODEX_OPEN_LOOP_LEDGER_CONTRACT,
      ledger: content
    })
  });
}

type CodexExecutionSignal = Extract<
  RuntimeWorkSignal,
  { kind: "execution_observation" }
>;

/**
 * Maps one integrity-verified, fresh Codex WorkSignal batch to the extractor's
 * bounded input. It reads only normalized manifest facts and their existing
 * evidence references; private conversation storage is deliberately outside
 * this adapter's dependency boundary.
 */
export function adaptCodexWorkSignalBatchToOpenLoopInput(input: {
  batch: unknown;
  asOf: string;
}): CodexOpenLoopInput {
  const asOf = timestampSchema.parse(input.asOf);
  const batch = runtimeWorkSignalBatchSchema.parse(input.batch);
  const integrity = verifyRuntimeWorkSignalBatchIntegrity(batch);
  if (!integrity.ok) {
    throw new TypeError(
      `CODEX_OPEN_LOOP_BATCH_INTEGRITY_FAILED:${integrity.issues.join(",")}`
    );
  }
  if (batch.source !== "codex") {
    throw new TypeError("CODEX_OPEN_LOOP_SOURCE_MISMATCH");
  }
  if (batch.assessment.asOf !== asOf) {
    throw new TypeError("CODEX_OPEN_LOOP_AS_OF_MISMATCH");
  }
  if (
    batch.assessment.freshness !== "fresh" ||
    !batch.assessment.usableForOverview
  ) {
    throw new TypeError("CODEX_OPEN_LOOP_SOURCE_NOT_CURRENT");
  }
  const signals = batch.signals.map((signal) => {
    if (signal.kind !== "execution_observation") {
      throw new TypeError("CODEX_OPEN_LOOP_SIGNAL_KIND_INVALID");
    }
    return adaptCodexExecutionSignal(signal, asOf);
  });
  return codexOpenLoopInputSchema.parse({
    contract: CODEX_OPEN_LOOP_INPUT_CONTRACT,
    asOf,
    signals
  });
}

function adaptCodexExecutionSignal(
  signal: CodexExecutionSignal,
  asOf: string
): CodexOpenLoopSignalInput {
  if (
    signal.attentionCapability !== "overview_only" ||
    signal.sourceUpdatedAt === null
  ) {
    throw new TypeError("CODEX_OPEN_LOOP_SIGNAL_BOUNDARY_INVALID");
  }
  const facts = signal.facts;
  const contentExpiresAt = facts.contentExpiresAt;
  const contentCurrent = Boolean(
    facts.conversationContentAvailable &&
      contentExpiresAt !== null &&
      Date.parse(contentExpiresAt) > Date.parse(asOf) &&
      (facts.historicalContextCompleteness === "complete" ||
        facts.historicalContextCompleteness === "partial")
  );
  const mappedFacts = {
    task_summary: facts.taskSummary,
    latest_user_prompt_excerpt: contentCurrent
      ? facts.latestUserPromptExcerpt
      : null,
    latest_agent_response_excerpt: contentCurrent
      ? facts.latestAgentResponseExcerpt
      : null,
    latest_execution_summary: contentCurrent
      ? facts.latestExecutionSummary
      : null
  } satisfies Record<CodexOpenLoopEvidenceField, string | null>;
  const factEvidence = Object.entries(mappedFacts).flatMap(
    ([fieldInput, value]) => {
      if (value === null) return [];
      const field = codexOpenLoopEvidenceFieldSchema.parse(fieldInput);
      const evidence = signal.evidence.filter(
        (candidate) =>
          candidate.type === "codex_session_field" &&
          candidate.field === field
      );
      if (evidence.length !== 1 || evidence[0] === undefined) {
        throw new TypeError("CODEX_OPEN_LOOP_FACT_EVIDENCE_AMBIGUOUS");
      }
      const exact = evidence[0];
      if (
        exact.subjectId !== signal.subjectId ||
        exact.sourceUpdatedAt !== signal.sourceUpdatedAt ||
        exact.observedAt !== signal.observedAt ||
        exact.valueSha256 !== codexSessionFieldSha256(field, value)
      ) {
        throw new TypeError("CODEX_OPEN_LOOP_FACT_EVIDENCE_MISMATCH");
      }
      return [
        {
          field,
          valueSha256: exact.valueSha256,
          observedAt: exact.observedAt,
          sourceUpdatedAt: signal.sourceUpdatedAt
        }
      ];
    }
  );
  return codexOpenLoopSignalInputSchema.parse({
    signalId: signal.signalId,
    subjectId: signal.subjectId,
    projectId: signal.projectId,
    sourceUpdatedAt: signal.sourceUpdatedAt,
    evidenceValidUntil: contentCurrent ? contentExpiresAt : null,
    historicalContextCompleteness: contentCurrent
      ? facts.historicalContextCompleteness
      : facts.historicalContextCompleteness === "not_collected"
        ? "not_collected"
        : "unavailable",
    historicalTurnStatus: contentCurrent
      ? facts.historicalTurnStatus
      : "unknown",
    contentTruncated: contentCurrent && facts.contentTruncated,
    taskSummary: mappedFacts.task_summary,
    latestUserPromptExcerpt:
      mappedFacts.latest_user_prompt_excerpt,
    latestAgentResponseExcerpt:
      mappedFacts.latest_agent_response_excerpt,
    latestExecutionSummary: mappedFacts.latest_execution_summary,
    factEvidence
  });
}

function deriveClaims(signal: CodexOpenLoopSignalInput): DraftClaim[] {
  const claims: DraftClaim[] = [];
  if (signal.taskSummary !== null) {
    claims.push(
      draftClaim({
        signal,
        claimType: "goal",
        ruleId: "TASK_SUMMARY_AS_GOAL",
        field: "task_summary",
        value: normalizeFact(signal.taskSummary),
        confidence: 0.45,
        verificationStatus: "unverified"
      })
    );
  }
  if (signal.latestUserPromptExcerpt !== null) {
    const value = signal.latestUserPromptExcerpt;
    if (matches(value, BLOCKER_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "blocker",
          ruleId: "USER_EXPLICIT_BLOCKER",
          field: "latest_user_prompt_excerpt",
          value: normalizeFact(value),
          confidence: 0.75,
          verificationStatus: "evidence_supported"
        })
      );
    } else if (matches(value, VERIFICATION_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "verification_needed",
          ruleId: "USER_EXPLICIT_VERIFICATION",
          field: "latest_user_prompt_excerpt",
          value: normalizeFact(value),
          confidence: 0.75,
          verificationStatus: "evidence_supported"
        })
      );
    } else if (matches(value, REMAINING_WORK_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "remaining_work",
          ruleId: "USER_EXPLICIT_REMAINING_WORK",
          field: "latest_user_prompt_excerpt",
          value: normalizeFact(value),
          confidence: 0.72,
          verificationStatus: "evidence_supported"
        })
      );
    }
  }
  if (signal.latestAgentResponseExcerpt !== null) {
    const value = signal.latestAgentResponseExcerpt;
    if (matches(value, BLOCKER_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "blocker",
          ruleId: "AGENT_EXPLICIT_BLOCKER",
          field: "latest_agent_response_excerpt",
          value: normalizeFact(value),
          confidence: 0.65,
          verificationStatus: "evidence_supported"
        })
      );
    } else if (matches(value, VERIFICATION_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "verification_needed",
          ruleId: "AGENT_EXPLICIT_VERIFICATION",
          field: "latest_agent_response_excerpt",
          value: normalizeFact(value),
          confidence: 0.65,
          verificationStatus: "evidence_supported"
        })
      );
    } else if (matches(value, FOLLOW_THROUGH_PATTERNS)) {
      claims.push(
        draftClaim({
          signal,
          claimType: "follow_through",
          ruleId: "AGENT_EXPLICIT_FOLLOW_THROUGH",
          field: "latest_agent_response_excerpt",
          value: normalizeFact(value),
          confidence: 0.62,
          verificationStatus: "evidence_supported"
        })
      );
    }
  }
  if (
    signal.latestExecutionSummary !== null &&
    matches(signal.latestExecutionSummary, FAILED_EXECUTION_PATTERNS)
  ) {
    claims.push(
      draftClaim({
        signal,
        claimType: "blocker",
        ruleId: "EXECUTION_FAILED_NEEDS_INSPECTION",
        field: "latest_execution_summary",
        value: "최근 실패한 실행 결과를 확인해야 합니다.",
        confidence: 0.85,
        verificationStatus: "evidence_supported"
      })
    );
  }
  return claims;
}

function draftClaim(input: {
  signal: CodexOpenLoopSignalInput;
  claimType: CodexOpenLoopClaimType;
  ruleId: z.infer<typeof codexOpenLoopRuleIdSchema>;
  field: CodexOpenLoopEvidenceField;
  value: string;
  confidence: number;
  verificationStatus: CodexOpenLoopClaim["verificationStatus"];
}): DraftClaim {
  const factEvidence = input.signal.factEvidence.find(
    (evidence) => evidence.field === input.field
  );
  if (!factEvidence) {
    throw new TypeError("CODEX_OPEN_LOOP_FACT_EVIDENCE_MISSING");
  }
  const incomplete =
    input.signal.historicalContextCompleteness === "partial" ||
    input.signal.contentTruncated;
  return {
    signalId: input.signal.signalId,
    evidenceValidUntil: input.signal.evidenceValidUntil,
    claimType: input.claimType,
    ruleId: input.ruleId,
    subjectId: input.signal.subjectId,
    projectId: input.signal.projectId,
    value: input.value,
    confidence: roundConfidence(
      Math.max(0, input.confidence - (incomplete ? 0.2 : 0))
    ),
    verificationStatus:
      incomplete || input.claimType === "goal"
        ? "unverified"
        : input.verificationStatus,
    sourceUpdatedAt: input.signal.sourceUpdatedAt,
    evidenceRefs: [
      {
        source: "codex",
        signalId: input.signal.signalId,
        subjectId: input.signal.subjectId,
        field: input.field,
        valueSha256: factEvidence.valueSha256,
        observedAt: factEvidence.observedAt,
        sourceUpdatedAt: factEvidence.sourceUpdatedAt
      }
    ],
    attentionDisposition: "ledger_input_only",
    forbiddenAsAttentionCandidate: true
  };
}

function finalizeClaim(
  draft: DraftClaim,
  allDrafts: DraftClaim[],
  completionSignals: CodexOpenLoopSignalInput[],
  asOf: string
): CodexOpenLoopClaim {
  const claimId = runtimeStableId(
    "open_loop",
    CODEX_OPEN_LOOP_RULE_VERSION,
    {
      signalId: draft.signalId,
      subjectId: draft.subjectId,
      claimType: draft.claimType,
      ruleId: draft.ruleId,
      evidenceRefs: draft.evidenceRefs
    }
  );
  const supersedingSignals = [
    ...allDrafts
      .filter(
        (candidate) =>
          candidate.subjectId === draft.subjectId &&
          candidate.claimType === draft.claimType &&
          isStrictlyNewer(candidate, draft)
      )
      .map((candidate) => ({
        signalId: candidate.signalId,
        sourceUpdatedAt: candidate.sourceUpdatedAt
      })),
    ...(draft.claimType === "goal"
      ? []
      : completionSignals
          .filter(
            (signal) =>
              signal.subjectId === draft.subjectId &&
              isStrictlyNewer(signal, draft)
          )
          .map((signal) => ({
            signalId: signal.signalId,
            sourceUpdatedAt: signal.sourceUpdatedAt
          })))
  ].sort(compareSignals);
  const supersededBySignalId =
    supersedingSignals[0]?.signalId ?? null;
  const policyValidUntil = new Date(
    Date.parse(draft.sourceUpdatedAt) + OPEN_LOOP_MAX_AGE_MS
  ).toISOString();
  const validUntil = earlierTimestamp(
    policyValidUntil,
    draft.evidenceValidUntil
  );
  const lifecycleStatus =
    supersededBySignalId !== null
      ? ("superseded" as const)
      : Date.parse(validUntil) <= Date.parse(asOf)
        ? ("expired" as const)
        : ("open" as const);
  const { signalId: _signalId, evidenceValidUntil: _expiry, ...base } =
    draft;
  return codexOpenLoopClaimSchema.parse({
    ...base,
    claimId,
    lifecycleStatus,
    validUntil,
    supersededBySignalId
  });
}

function isStrictCompletionMarker(
  signal: CodexOpenLoopSignalInput
): boolean {
  const response = signal.latestAgentResponseExcerpt;
  return Boolean(
    response &&
      signal.historicalTurnStatus === "completed" &&
      matches(response, COMPLETION_PATTERNS) &&
      !matches(response, BLOCKER_PATTERNS) &&
      !matches(response, VERIFICATION_PATTERNS) &&
      !matches(response, FOLLOW_THROUGH_PATTERNS)
  );
}

function isStrictlyNewer(
  candidate: { sourceUpdatedAt: string },
  current: { sourceUpdatedAt: string }
): boolean {
  return (
    Date.parse(candidate.sourceUpdatedAt) >
    Date.parse(current.sourceUpdatedAt)
  );
}

function compareSignals(
  left: { sourceUpdatedAt: string; signalId: string },
  right: { sourceUpdatedAt: string; signalId: string }
): number {
  return (
    Date.parse(left.sourceUpdatedAt) -
      Date.parse(right.sourceUpdatedAt) ||
    compareRuntimeStrings(left.signalId, right.signalId)
  );
}

function earlierTimestamp(
  policyValidUntil: string,
  evidenceValidUntil: string | null
): string {
  if (evidenceValidUntil === null) return policyValidUntil;
  return Date.parse(evidenceValidUntil) < Date.parse(policyValidUntil)
    ? evidenceValidUntil
    : policyValidUntil;
}

function normalizeFact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function openLoopFacts(
  signal: Pick<
    CodexOpenLoopSignalInput,
    | "taskSummary"
    | "latestUserPromptExcerpt"
    | "latestAgentResponseExcerpt"
    | "latestExecutionSummary"
  >
): Map<CodexOpenLoopEvidenceField, string> {
  return new Map(
    [
      ["task_summary", signal.taskSummary],
      ["latest_user_prompt_excerpt", signal.latestUserPromptExcerpt],
      ["latest_agent_response_excerpt", signal.latestAgentResponseExcerpt],
      ["latest_execution_summary", signal.latestExecutionSummary]
    ].filter(
      (
        entry
      ): entry is [CodexOpenLoopEvidenceField, string] =>
        entry[1] !== null
    )
  );
}

function codexSessionFieldSha256(
  field: CodexOpenLoopEvidenceField,
  value: string
): string {
  return runtimeSha256({
    domain: "codex-session-field-v0.1",
    field,
    value
  });
}

function matches(
  value: string,
  patterns: readonly RegExp[]
): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function countClaims(
  claims: CodexOpenLoopClaim[]
): z.infer<typeof claimCountsSchema> {
  return {
    open: claims.filter((claim) => claim.lifecycleStatus === "open")
      .length,
    expired: claims.filter(
      (claim) => claim.lifecycleStatus === "expired"
    ).length,
    superseded: claims.filter(
      (claim) => claim.lifecycleStatus === "superseded"
    ).length,
    byType: {
      goal: claims.filter((claim) => claim.claimType === "goal").length,
      remaining_work: claims.filter(
        (claim) => claim.claimType === "remaining_work"
      ).length,
      blocker: claims.filter((claim) => claim.claimType === "blocker")
        .length,
      verification_needed: claims.filter(
        (claim) => claim.claimType === "verification_needed"
      ).length,
      follow_through: claims.filter(
        (claim) => claim.claimType === "follow_through"
      ).length
    }
  };
}
