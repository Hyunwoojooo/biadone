import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  developerWorkConnectorSourceSchema,
  developerWorkLedgerSchema,
  workLedgerEvidenceIdSchema,
  workLedgerNextActionIdSchema,
  type DeveloperWorkLedger
} from "./workLedger";

export const DEVELOPER_CANDIDATE_FUNNEL_CONTRACT =
  "developer-candidate-funnel-v0.1" as const;
export const DEVELOPER_CANDIDATE_FUNNEL_SCHEMA_VERSION =
  "developer-candidate-funnel-schema-v0.1" as const;
export const DEVELOPER_CANDIDATE_FUNNEL_CANONICALIZATION_VERSION =
  "developer-candidate-funnel-canonicalization-v0.1" as const;
export const DEVELOPER_CANDIDATE_FUNNEL_ID_POLICY_VERSION =
  "developer-candidate-funnel-id-v0.1" as const;

const MAX_CANDIDATE_TRACES = 20_000;
const MAX_STAGE_EVIDENCE = 200;
const MAX_REASON_CODES = 32;

const timestampSchema = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Funnel timestamps must use canonical UTC ISO format."
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const versionSchema = z.string().min(1).max(120);
const runIdSchema = z.string().regex(/^run_[a-f0-9]{32}$/);
const analysisIdSchema = z.string().regex(/^analysis_[a-f0-9]{32}$/);
const resultIdSchema = z
  .string()
  .regex(/^attention_result_[a-f0-9]{32}$/);
const workLedgerIdSchema = z
  .string()
  .regex(/^work_ledger_[a-f0-9]{32}$/);
const funnelIdSchema = z
  .string()
  .regex(/^candidate_funnel_[a-f0-9]{32}$/);
const candidateSeedIdSchema = z.string().regex(/^seed_[a-f0-9]{32}$/);
const candidateIdSchema = z
  .string()
  .regex(/^attention_[a-f0-9]{32}$/);
const reasonCodeSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const canonicalVersionsSchema = z
  .array(versionSchema)
  .min(1)
  .max(20)
  .superRefine((values, context) => {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pipeline versions must be unique and canonical."
      });
    }
  });

export const developerCandidateFunnelStageSchema = z.enum([
  "collected",
  "normalized",
  "interpreted",
  "verified",
  "eligibility",
  "selected"
]);

export const DEVELOPER_CANDIDATE_FUNNEL_STAGE_ORDER = [
  "collected",
  "normalized",
  "interpreted",
  "verified",
  "eligibility",
  "selected"
] as const;

const canonicalReasonCodesSchema = z
  .array(reasonCodeSchema)
  .min(1)
  .max(MAX_REASON_CODES)
  .superRefine((values, context) => {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Funnel reason codes must be unique and canonical."
      });
    }
  });

const canonicalStageEvidenceSchema = z
  .array(workLedgerEvidenceIdSchema)
  .max(MAX_STAGE_EVIDENCE)
  .superRefine((values, context) => {
    if (!isCanonicalUnique(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stage evidence references must be unique and canonical."
      });
    }
  });

function stageEventSchema<
  Stage extends (typeof DEVELOPER_CANDIDATE_FUNNEL_STAGE_ORDER)[number],
  Outcome extends readonly [string, ...string[]]
>(stage: Stage, outcomes: Outcome) {
  return z
    .object({
      stage: z.literal(stage),
      outcome: z.enum(outcomes),
      reasonCodes: canonicalReasonCodesSchema,
      evidenceIds: canonicalStageEvidenceSchema
    })
    .strict()
    .superRefine((event, context) => {
      const notReached = event.outcome === "not_reached";
      if (notReached !== (event.evidenceIds.length === 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceIds"],
          message:
            "Reached stages require evidence; not-reached stages cannot claim it."
        });
      }
    });
}

export const candidateCollectedStageSchema = stageEventSchema(
  "collected",
  ["collected", "rejected"] as const
);
export const candidateNormalizedStageSchema = stageEventSchema(
  "normalized",
  ["normalized", "rejected", "not_reached"] as const
);
export const candidateInterpretedStageSchema = stageEventSchema(
  "interpreted",
  ["interpreted", "rejected", "not_reached"] as const
);
export const candidateVerifiedStageSchema = stageEventSchema(
  "verified",
  ["verified", "rejected", "not_reached"] as const
);
export const candidateEligibilityStageSchema = stageEventSchema(
  "eligibility",
  ["eligible", "review_required", "ineligible", "not_reached"] as const
);
export const candidateSelectedStageSchema = stageEventSchema(
  "selected",
  ["selected", "not_selected", "not_reached"] as const
);

const developerCandidateTraceBaseSchema = z
  .object({
    candidateSeedId: candidateSeedIdSchema,
    candidateId: candidateIdSchema.nullable(),
    source: developerWorkConnectorSourceSchema,
    sourceRecordSha256: sha256Schema,
    nextActionId: workLedgerNextActionIdSchema.nullable(),
    stages: z
      .object({
        collected: candidateCollectedStageSchema,
        normalized: candidateNormalizedStageSchema,
        interpreted: candidateInterpretedStageSchema,
        verified: candidateVerifiedStageSchema,
        eligibility: candidateEligibilityStageSchema,
        selected: candidateSelectedStageSchema
      })
      .strict()
  })
  .strict();

type DeveloperCandidateTraceBase = z.infer<
  typeof developerCandidateTraceBaseSchema
>;

export const developerCandidateTraceSchema =
  developerCandidateTraceBaseSchema.superRefine(refineCandidateTrace);

const outcomeCountsSchema = z
  .object({
    collected: z.number().int().nonnegative(),
    normalized: z.number().int().nonnegative(),
    interpreted: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    reviewRequired: z.number().int().nonnegative(),
    ineligible: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    notSelected: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    notReached: z.number().int().nonnegative()
  })
  .strict();

const reasonCountSchema = z
  .object({
    reasonCode: reasonCodeSchema,
    count: z.number().int().positive()
  })
  .strict();

export const developerCandidateFunnelStageSummarySchema = z
  .object({
    stage: developerCandidateFunnelStageSchema,
    totalTraceCount: z.number().int().nonnegative(),
    enteredCount: z.number().int().nonnegative(),
    outcomeCounts: outcomeCountsSchema,
    reasonCounts: z.array(reasonCountSchema).max(2_000)
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      !isCanonicalUnique(
        summary.reasonCounts.map((reason) => reason.reasonCode)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCounts"],
        message: "Reason counts must be unique and canonical."
      });
    }
    const totalOutcomes = Object.values(summary.outcomeCounts).reduce(
      (total, count) => total + count,
      0
    );
    if (totalOutcomes !== summary.totalTraceCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcomeCounts"],
        message: "Each trace must contribute exactly one stage outcome."
      });
    }
    if (
      summary.enteredCount !==
      summary.totalTraceCount - summary.outcomeCounts.notReached
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enteredCount"],
        message: "Entered count must exclude only not-reached traces."
      });
    }
  });

const candidateFunnelProjectionContentSchema = z
  .object({
    contract: z.literal(DEVELOPER_CANDIDATE_FUNNEL_CONTRACT),
    schemaVersion: z.literal(DEVELOPER_CANDIDATE_FUNNEL_SCHEMA_VERSION),
    canonicalizationVersion: z.literal(
      DEVELOPER_CANDIDATE_FUNNEL_CANONICALIZATION_VERSION
    ),
    idPolicyVersion: z.literal(
      DEVELOPER_CANDIDATE_FUNNEL_ID_POLICY_VERSION
    ),
    funnelId: funnelIdSchema,
    runId: runIdSchema,
    analysisId: analysisIdSchema,
    resultId: resultIdSchema,
    ledgerId: workLedgerIdSchema,
    ledgerSha256: sha256Schema,
    asOf: timestampSchema,
    inputSha256: sha256Schema,
    candidateRuleVersion: versionSchema,
    normalizationVersions: canonicalVersionsSchema,
    interpretationVersions: canonicalVersionsSchema,
    verifierVersions: canonicalVersionsSchema,
    eligibilityPolicyVersion: versionSchema,
    selectionPolicyVersion: versionSchema,
    traces: z.array(developerCandidateTraceSchema).max(MAX_CANDIDATE_TRACES),
    stageSummaries: z
      .array(developerCandidateFunnelStageSummarySchema)
      .length(DEVELOPER_CANDIDATE_FUNNEL_STAGE_ORDER.length),
    selectedCandidateSeedId: candidateSeedIdSchema.nullable(),
    selectedCandidateId: candidateIdSchema.nullable(),
    selectedNextActionId: workLedgerNextActionIdSchema.nullable()
  })
  .strict();

const candidateFunnelDraftSchema = candidateFunnelProjectionContentSchema.omit({
  contract: true,
  schemaVersion: true,
  canonicalizationVersion: true,
  idPolicyVersion: true,
  funnelId: true,
  stageSummaries: true,
  selectedCandidateSeedId: true,
  selectedCandidateId: true,
  selectedNextActionId: true
});

export const developerCandidateFunnelProjectionSchema =
  candidateFunnelProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (projection.funnelId !== createDeveloperCandidateFunnelId(projection)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["funnelId"],
          message: "Candidate funnel ID does not match canonical run identity."
        });
      }
      if (
        projection.projectionSha256 !==
        developerCandidateFunnelProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Candidate funnel hash does not match canonical content."
        });
      }
      if (
        !isCanonicalUnique(
          projection.traces.map((trace) => trace.candidateSeedId)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["traces"],
          message: "Candidate traces must be unique and canonical."
        });
      }
      const expectedSummaries = summarizeCandidateTraces(projection.traces);
      if (
        runtimeSha256(projection.stageSummaries) !==
        runtimeSha256(expectedSummaries)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stageSummaries"],
          message: "Stage counts and reasons do not match candidate traces."
        });
      }
      const selected = projection.traces.filter(
        (trace) => trace.stages.selected.outcome === "selected"
      );
      const selectedTrace = selected[0] ?? null;
      if (
        selected.length > 1 ||
        projection.selectedCandidateSeedId !==
          (selectedTrace?.candidateSeedId ?? null) ||
        projection.selectedCandidateId !==
          (selectedTrace?.candidateId ?? null) ||
        projection.selectedNextActionId !==
          (selectedTrace?.nextActionId ?? null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedCandidateSeedId"],
          message: "Selected identities must match the selected trace."
        });
      }
      const eligibleCount = projection.traces.filter(
        (trace) => trace.stages.eligibility.outcome === "eligible"
      ).length;
      if ((eligibleCount > 0) !== (selected.length === 1)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedCandidateId"],
          message:
            "A non-empty eligible set requires exactly one selected candidate."
        });
      }
    });

export type DeveloperCandidateTrace = z.infer<
  typeof developerCandidateTraceSchema
>;
export type DeveloperCandidateFunnelDraft = z.infer<
  typeof candidateFunnelDraftSchema
>;
export type DeveloperCandidateFunnelProjection = z.infer<
  typeof developerCandidateFunnelProjectionSchema
>;
export type DeveloperCandidateFunnelStageSummary = z.infer<
  typeof developerCandidateFunnelStageSummarySchema
>;

export function createDeveloperCandidateFunnelId(input: {
  runId: string;
  resultId: string;
  ledgerId: string;
  ledgerSha256: string;
  inputSha256: string;
}): string {
  return runtimeStableId(
    "candidate_funnel",
    DEVELOPER_CANDIDATE_FUNNEL_ID_POLICY_VERSION,
    {
      runId: input.runId,
      resultId: input.resultId,
      ledgerId: input.ledgerId,
      ledgerSha256: input.ledgerSha256,
      inputSha256: input.inputSha256
    }
  );
}

export function buildDeveloperCandidateFunnel(
  draftInput: DeveloperCandidateFunnelDraft
): DeveloperCandidateFunnelProjection {
  const canonical = canonicalizeFunnelDraft(draftInput);
  const draft = candidateFunnelDraftSchema.parse(canonical);
  const selectedTrace = draft.traces.find(
    (trace) => trace.stages.selected.outcome === "selected"
  );
  const content = candidateFunnelProjectionContentSchema.parse({
    contract: DEVELOPER_CANDIDATE_FUNNEL_CONTRACT,
    schemaVersion: DEVELOPER_CANDIDATE_FUNNEL_SCHEMA_VERSION,
    canonicalizationVersion:
      DEVELOPER_CANDIDATE_FUNNEL_CANONICALIZATION_VERSION,
    idPolicyVersion: DEVELOPER_CANDIDATE_FUNNEL_ID_POLICY_VERSION,
    funnelId: createDeveloperCandidateFunnelId(draft),
    ...draft,
    stageSummaries: summarizeCandidateTraces(draft.traces),
    selectedCandidateSeedId: selectedTrace?.candidateSeedId ?? null,
    selectedCandidateId: selectedTrace?.candidateId ?? null,
    selectedNextActionId: selectedTrace?.nextActionId ?? null
  });
  return developerCandidateFunnelProjectionSchema.parse({
    ...content,
    projectionSha256: developerCandidateFunnelProjectionSha256(content)
  });
}

export function summarizeCandidateTraces(
  traces: DeveloperCandidateTrace[]
): DeveloperCandidateFunnelStageSummary[] {
  return DEVELOPER_CANDIDATE_FUNNEL_STAGE_ORDER.map((stage) => {
    const events = traces.map((trace) => trace.stages[stage]);
    const counts = emptyOutcomeCounts();
    const reasonCounts = new Map<string, number>();
    for (const event of events) {
      incrementOutcome(counts, event.outcome);
      for (const reason of event.reasonCodes) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
    }
    return developerCandidateFunnelStageSummarySchema.parse({
      stage,
      totalTraceCount: traces.length,
      enteredCount:
        traces.length - events.filter((event) => event.outcome === "not_reached").length,
      outcomeCounts: counts,
      reasonCounts: [...reasonCounts.entries()]
        .sort(([left], [right]) => compareRuntimeStrings(left, right))
        .map(([reasonCode, count]) => ({ reasonCode, count }))
    });
  });
}

export function developerCandidateFunnelProjectionSha256(
  projection:
    | DeveloperCandidateFunnelProjection
    | z.infer<typeof candidateFunnelProjectionContentSchema>
): string {
  const { projectionSha256: _projectionSha256, ...content } =
    projection as DeveloperCandidateFunnelProjection;
  return runtimeSha256({
    domain: DEVELOPER_CANDIDATE_FUNNEL_CONTRACT,
    projection: content
  });
}

export function verifyDeveloperCandidateFunnel(input: unknown): boolean {
  return developerCandidateFunnelProjectionSchema.safeParse(input).success;
}

export function candidateFunnelReferencesLedger(
  funnelInput: unknown,
  ledgerInput: unknown
): boolean {
  const funnel = developerCandidateFunnelProjectionSchema.safeParse(funnelInput);
  const ledger = developerWorkLedgerSchema.safeParse(ledgerInput);
  if (!funnel.success || !ledger.success) return false;
  if (
    funnel.data.ledgerId !== ledger.data.ledgerId ||
    funnel.data.ledgerSha256 !== ledger.data.ledgerSha256 ||
    funnel.data.runId !== ledger.data.runId ||
    funnel.data.analysisId !== ledger.data.analysisId ||
    funnel.data.resultId !== ledger.data.resultId ||
    funnel.data.asOf !== ledger.data.asOf
  ) {
    return false;
  }
  return traceReferencesExist(funnel.data.traces, ledger.data);
}

function canonicalizeFunnelDraft(
  draft: DeveloperCandidateFunnelDraft
): DeveloperCandidateFunnelDraft {
  return {
    ...draft,
    normalizationVersions: canonicalStrings(draft.normalizationVersions),
    interpretationVersions: canonicalStrings(draft.interpretationVersions),
    verifierVersions: canonicalStrings(draft.verifierVersions),
    traces: [...draft.traces]
      .map(canonicalizeTrace)
      .sort((left, right) =>
        compareRuntimeStrings(left.candidateSeedId, right.candidateSeedId)
      )
  };
}

function canonicalizeTrace(
  trace: DeveloperCandidateTrace
): DeveloperCandidateTrace {
  const stage = <T extends DeveloperCandidateTrace["stages"][keyof DeveloperCandidateTrace["stages"]]>(
    event: T
  ): T =>
    ({
      ...event,
      reasonCodes: canonicalStrings(event.reasonCodes),
      evidenceIds: canonicalStrings(event.evidenceIds)
    }) as T;
  return {
    ...trace,
    stages: {
      collected: stage(trace.stages.collected),
      normalized: stage(trace.stages.normalized),
      interpreted: stage(trace.stages.interpreted),
      verified: stage(trace.stages.verified),
      eligibility: stage(trace.stages.eligibility),
      selected: stage(trace.stages.selected)
    }
  };
}

function refineCandidateTrace(
  trace: DeveloperCandidateTraceBase,
  context: z.RefinementCtx
): void {
  const collected = trace.stages.collected.outcome === "collected";
  const normalized = trace.stages.normalized.outcome === "normalized";
  const interpreted = trace.stages.interpreted.outcome === "interpreted";
  const verified = trace.stages.verified.outcome === "verified";
  const eligible = trace.stages.eligibility.outcome === "eligible";

  const expectedReachability = [
    ["normalized", collected, trace.stages.normalized.outcome],
    ["interpreted", collected && normalized, trace.stages.interpreted.outcome],
    [
      "verified",
      collected && normalized && interpreted,
      trace.stages.verified.outcome
    ],
    [
      "eligibility",
      collected && normalized && interpreted && verified,
      trace.stages.eligibility.outcome
    ],
    ["selected", eligible, trace.stages.selected.outcome]
  ] as const;
  for (const [stage, reached, outcome] of expectedReachability) {
    if (reached === (outcome === "not_reached")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages", stage, "outcome"],
        message: "Candidate funnel stages must preserve reachability."
      });
    }
  }
  if (eligible !== (trace.candidateId !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidateId"],
      message: "Only eligible traces may expose an active candidate ID."
    });
  }
  if (
    trace.stages.selected.outcome === "selected" &&
    trace.nextActionId === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nextActionId"],
      message: "A selected candidate must identify its ledger next action."
    });
  }
}

function emptyOutcomeCounts(): z.infer<typeof outcomeCountsSchema> {
  return {
    collected: 0,
    normalized: 0,
    interpreted: 0,
    verified: 0,
    eligible: 0,
    reviewRequired: 0,
    ineligible: 0,
    selected: 0,
    notSelected: 0,
    rejected: 0,
    notReached: 0
  };
}

function incrementOutcome(
  counts: z.infer<typeof outcomeCountsSchema>,
  outcome: string
): void {
  switch (outcome) {
    case "collected":
    case "normalized":
    case "interpreted":
    case "verified":
    case "eligible":
    case "selected":
    case "ineligible":
    case "rejected":
      counts[outcome] += 1;
      return;
    case "review_required":
      counts.reviewRequired += 1;
      return;
    case "not_selected":
      counts.notSelected += 1;
      return;
    case "not_reached":
      counts.notReached += 1;
      return;
    default:
      throw new TypeError(`Unsupported candidate funnel outcome: ${outcome}`);
  }
}

function traceReferencesExist(
  traces: DeveloperCandidateTrace[],
  ledger: DeveloperWorkLedger
): boolean {
  const evidenceIds = new Set(ledger.evidence.map((item) => item.evidenceId));
  const nextActionIds = new Set(
    ledger.nextActions.map((item) => item.nextActionId)
  );
  return traces.every((trace) => {
    if (trace.nextActionId && !nextActionIds.has(trace.nextActionId)) {
      return false;
    }
    return DEVELOPER_CANDIDATE_FUNNEL_STAGE_ORDER.every((stage) =>
      trace.stages[stage].evidenceIds.every((id) => evidenceIds.has(id))
    );
  });
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) =>
      index === 0
        ? true
        : compareRuntimeStrings(values[index - 1]!, value) < 0
    )
  );
}
