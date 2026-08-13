import {
  continuationDecisionSchema,
  continuationDecisionSemanticSha256,
  createContinuationCandidateId,
  sealContinuationCandidate,
  sealContinuationDecision,
  verifyContinuationDecisionIntegrity,
  type ContinuationCandidate,
  type ContinuationDecision,
  type ContinuationDecisionContent
} from "../../src/continuation";
import { resolveActiveAttention, type ActiveAttentionResult } from "../../src/attentionDecision";
import {
  CONTINUATION_ACTION_POLICY_VERSION,
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_PUBLIC_DECISION_CONTRACT,
  CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION,
  CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../../src/crossSource/versions";
import {
  sealWorkSuggestionBoardResult,
  type WorkSuggestionBoardResult
} from "../../src/suggestionBoard";
import {
  ACTIVE_FIXTURE_AS_OF,
  activeAttentionFixture
} from "../../tests/fixtures/activeAttentionFixture";
import {
  continuationContractOracleSummarySchema,
  type ContinuationContractOracleCode,
  type ContinuationContractOracleSummary,
  type ContinuationCriticalErrorCode,
  type ContinuationExecutableScenario,
  type ContinuationOracleInvariantCode
} from "../../src/evaluation/continuation/contracts";
import {
  buildContinuationBoardChainDescriptor,
  buildContinuationResolverEvaluationFixture,
  executeContinuationResolverEvaluationDescriptor,
  type ContinuationBoardChainKind,
  type ContinuationResolverEvaluationInputDescriptor
} from "./continuationResolverCaseBuilder";
import {
  composeWorkSuggestionBoard,
  verifyWorkSuggestionBoardResultAgainstInput,
  type WorkSuggestionBoardCompositionBundle
} from "../../src/suggestionBoard";

const STARTED_AT = "2026-08-02T02:59:00.000Z";
const COMPLETED_AT = "2026-08-02T02:59:01.000Z";
const OBSERVED_AT = "2026-08-02T02:00:00.000Z";
const EXPIRES_AT = "2026-08-09T03:00:00.000Z";
const WORK_CONTEXT_ID = `project_${"6".repeat(32)}`;
const SHA_A = "a".repeat(64);

type OracleCheck = {
  invariantCode: ContinuationOracleInvariantCode;
  passed: boolean;
  criticalOnFailure: ContinuationCriticalErrorCode[];
};

export type ContinuationEvaluationFixture = {
  scenario: ContinuationExecutableScenario;
  materializedInput: unknown;
  execute: () => ContinuationContractOracleSummary;
};

export function buildContinuationEvaluationFixture(
  scenario: ContinuationExecutableScenario
): ContinuationEvaluationFixture {
  switch (scenario) {
    case "continuation_ready":
      return continuationReadyFixture();
    case "continuation_setup":
      return continuationSetupFixture();
    case "continuation_empty":
      return continuationEmptyFixture();
    case "continuation_tamper":
      return continuationTamperFixture();
    case "future_capability_block":
      return futureCapabilityFixture();
    case "public_privacy_rejection":
      return publicPrivacyFixture();
    case "board_attention_precedence":
      return authenticatedBoardFixture(
        "board_attention_precedence",
        "BOARD_ATTENTION_PRECEDENCE_CONTRACT_ENFORCED",
        suggestedAttention(),
        "ready_dedupe"
      );
    case "board_continuation_fallback":
      return authenticatedBoardFixture(
        "board_continuation_fallback",
        "BOARD_CONTINUATION_PRECEDENCE_CONTRACT_ENFORCED",
        noActionAttention(),
        "ready_dedupe"
      );
    case "board_setup_fallback":
      return authenticatedBoardFixture(
        "board_setup_fallback",
        "BOARD_SETUP_PRECEDENCE_CONTRACT_ENFORCED",
        noActionAttention(),
        "setup"
      );
    case "board_empty":
      return authenticatedBoardFixture(
        "board_empty",
        "BOARD_EMPTY_PRECEDENCE_CONTRACT_ENFORCED",
        noActionAttention(),
        "empty"
      );
    case "board_mixed_version":
      return boardMixedVersionFixture();
    case "semantic_hash_runtime_metadata":
      return semanticHashFixture();
    case "resolver_cross_lane_dedupe":
      return crossLaneDedupeFixture();
  }
  return buildContinuationResolverEvaluationFixture(scenario);
}

function continuationReadyFixture(): ContinuationEvaluationFixture {
  const decision = readyDecision("1");
  return fixture("continuation_ready", decision, () => {
    const accepted = verifyContinuationDecisionIntegrity(decision);
    const readOnly =
      decision.primary?.capability === "display" &&
      decision.primary.privateActionTarget === null;
    return summarize({
      expectedCode: "CONTINUATION_READY_ACCEPTED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: accepted ? decision.status : null,
      prominentLane: null,
      checks: [
        check("CONTINUATION_INTEGRITY_VERIFIED", accepted, "CONTRACT_INTEGRITY_FAILURE"),
        check("CONTINUATION_SCHEMA_ACCEPTED", accepted, "CONTRACT_INTEGRITY_FAILURE"),
        check("EXECUTION_POLICY_READ_ONLY", readOnly, "AUTOMATIC_EXECUTION_OR_MUTATION")
      ]
    });
  });
}

function continuationSetupFixture(): ContinuationEvaluationFixture {
  const decision = setupDecision("1");
  return fixture("continuation_setup", decision, () => {
    const accepted = verifyContinuationDecisionIntegrity(decision);
    const bounded =
      decision.primary?.capability === "open_setup_surface" &&
      decision.primary.privateActionTarget?.capability === "open_setup_surface";
    return summarize({
      expectedCode: "CONTINUATION_SETUP_ACCEPTED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: accepted ? decision.status : null,
      prominentLane: null,
      checks: [
        check("CONTINUATION_INTEGRITY_VERIFIED", accepted, "CONTRACT_INTEGRITY_FAILURE"),
        check("EXECUTION_POLICY_READ_ONLY", bounded, "AUTOMATIC_EXECUTION_OR_MUTATION"),
        check("SETUP_CAPABILITY_BOUNDED", bounded, "UNSAFE_ACTION_TARGET")
      ]
    });
  });
}

function continuationEmptyFixture(): ContinuationEvaluationFixture {
  const decision = emptyDecision("1");
  return fixture("continuation_empty", decision, () => {
    const empty =
      verifyContinuationDecisionIntegrity(decision) &&
      decision.primary === null &&
      decision.alternatives.length === 0;
    return summarize({
      expectedCode: "CONTINUATION_EMPTY_ACCEPTED",
      contractOutcome: empty ? "accepted" : "rejected",
      decisionStatus: empty ? decision.status : null,
      prominentLane: null,
      checks: [
        check("EMPTY_DECISION_ACTIONLESS", empty, "CONTRACT_INTEGRITY_FAILURE"),
        check("EXECUTION_POLICY_READ_ONLY", empty, "AUTOMATIC_EXECUTION_OR_MUTATION")
      ]
    });
  });
}

function continuationTamperFixture(): ContinuationEvaluationFixture {
  const decision = readyDecision("1");
  const tampered = { ...decision, resultSha256: "0".repeat(64) };
  return fixture("continuation_tamper", tampered, () => {
    const rejected = !continuationDecisionSchema.safeParse(tampered).success;
    return summarize({
      expectedCode: "CONTINUATION_TAMPER_REJECTED",
      contractOutcome: rejected ? "rejected" : "accepted",
      decisionStatus: null,
      prominentLane: null,
      checks: [check("TAMPER_REJECTED", rejected, "CONTRACT_INTEGRITY_FAILURE")]
    });
  });
}

function futureCapabilityFixture(): ContinuationEvaluationFixture {
  const primary = futureCandidate();
  const content = decisionContent("offers_available", primary, "1");
  return fixture("future_capability_block", content, () => {
    const rejected = rejects(() => sealContinuationDecision(content));
    return summarize({
      expectedCode: "CONTINUATION_FUTURE_CAPABILITY_REJECTED",
      contractOutcome: rejected ? "rejected" : "accepted",
      decisionStatus: null,
      prominentLane: null,
      checks: [check("FUTURE_CAPABILITY_BLOCKED", rejected, "UNSAFE_ACTION_TARGET")]
    });
  });
}

function publicPrivacyFixture(): ContinuationEvaluationFixture {
  const invalidPublicDecision = {
    contract: CONTINUATION_PUBLIC_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION,
    generatedAt: ACTIVE_FIXTURE_AS_OF,
    status: "offers_available",
    primary: {
      itemRef: `item_ref_${"A".repeat(22)}`,
      workContextRef: null,
      kind: "recent_github_push",
      title: "/private/evaluation/native-locator",
      summary: "Recent work",
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      evidenceBand: "single_source",
      capability: "display",
      action: null,
      caveatCodes: []
    },
    alternatives: [],
    coverageCode: "SOURCE_LOCAL_PARTIAL"
  };
  return fixture("public_privacy_rejection", invalidPublicDecision, () => {
    const rejected = !importedPublicDecisionSchema().safeParse(invalidPublicDecision).success;
    return summarize({
      expectedCode: "CONTINUATION_PRIVATE_IDENTIFIER_REJECTED",
      contractOutcome: rejected ? "rejected" : "accepted",
      decisionStatus: null,
      prominentLane: null,
      checks: [check("PRIVATE_IDENTIFIER_REJECTED", rejected, "PRIVACY_LEAK")]
    });
  });
}

type AuthenticatedBoardFixture = {
  descriptor: ContinuationResolverEvaluationInputDescriptor;
  active: ActiveAttentionResult;
};

function authenticatedBoardFixture(
  scenario: Extract<
    ContinuationExecutableScenario,
    | "board_attention_precedence"
    | "board_continuation_fallback"
    | "board_setup_fallback"
    | "board_empty"
  >,
  oracleCode: ContinuationContractOracleCode,
  active: ActiveAttentionResult,
  chainKind: ContinuationBoardChainKind
): ContinuationEvaluationFixture {
  const materializedInput: AuthenticatedBoardFixture = {
    descriptor: buildContinuationBoardChainDescriptor(chainKind),
    active
  };
  return fixture(scenario, materializedInput, () => {
    const { bundle, options, resolved } = boardBundle(materializedInput);
    const composed = composeWorkSuggestionBoard(bundle, options);
    const accepted =
      composed.ok &&
      verifyWorkSuggestionBoardResultAgainstInput(
        bundle,
        options,
        composed.board
      );
    const board = composed.ok ? composed.board : null;
    const expectedLane =
      active.decision.status === "suggested"
        ? "attention"
        : chainKind === "ready_dedupe"
          ? "continuation"
          : chainKind === "setup"
            ? "setup"
            : "none";
    const laneInvariant =
      expectedLane === "attention"
        ? "ATTENTION_PRIMARY"
        : expectedLane === "continuation"
          ? "CONTINUATION_PRIMARY"
          : expectedLane === "setup"
            ? "SETUP_PRIMARY"
            : "EMPTY_BOARD";
    return summarize({
      expectedCode: oracleCode,
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: resolved.decision.status,
      coverageCode: resolved.decision.coverageCode,
      prominentLane: board?.prominentLane ?? null,
      checks: [
        check(
          laneInvariant,
          accepted && board?.prominentLane === expectedLane,
          expectedLane === "attention" ? "ACTIVE_RESULT_DIFF" : "CONTRACT_INTEGRITY_FAILURE"
        ),
        check(
          "EXECUTION_POLICY_READ_ONLY",
          board !== null && readOnlyBoard(board),
          "AUTOMATIC_EXECUTION_OR_MUTATION"
        ),
        check(
          "WRONG_LANE_MUTATION_REJECTED",
          board !== null && rejectsWrongBoardLane(board, {
            prominentLane: expectedLane === "none" ? "attention" : "none",
            primary: null
          }),
          "CONTRACT_INTEGRITY_FAILURE"
        ),
        ...(expectedLane === "attention"
          ? [
              check(
                "ACTIVE_OBJECT_UNCHANGED",
                board?.input.active === active,
                "ACTIVE_RESULT_DIFF"
              ),
              check(
                "ACTIVE_RESULT_HASH_UNCHANGED",
                board?.input.active.resultSha256 === active.resultSha256,
                "ACTIVE_RESULT_HASH_DIFF"
              )
            ]
          : [])
      ]
    });
  });
}

function crossLaneDedupeFixture(): ContinuationEvaluationFixture {
  const active = suggestedAttention("Recent GitHub activity");
  const materializedInput: AuthenticatedBoardFixture = {
    descriptor: buildContinuationBoardChainDescriptor("ready_dedupe"),
    active
  };
  return fixture("resolver_cross_lane_dedupe", materializedInput, () => {
    const { bundle, options, resolved } = boardBundle(materializedInput);
    const composed = composeWorkSuggestionBoard(bundle, options);
    const board = composed.ok ? composed.board : null;
    const inputBound =
      composed.ok &&
      verifyWorkSuggestionBoardResultAgainstInput(bundle, options, composed.board);
    const continuationCandidates = [
      ...(resolved.decision.primary === null ? [] : [resolved.decision.primary]),
      ...resolved.decision.alternatives
    ];
    const visibleItems = board === null
      ? []
      : [
          ...(board.primary === null ? [] : [board.primary]),
          ...board.alternatives
        ];
    const activeWorkContextId = active.decision.topSuggestion?.projectId ?? null;
    const sameLabelDifferentContext = continuationCandidates.find(
      (candidate) =>
        candidate.workContextId !== null &&
        candidate.workContextId !== activeWorkContextId &&
        candidate.localDisplayLabel === active.decision.topSuggestion?.title
    );
    const exactContextDeduped =
      activeWorkContextId !== null &&
      continuationCandidates.some(
        (candidate) => candidate.workContextId === activeWorkContextId
      ) &&
      !visibleItems.some(
        (item) =>
          item.lane !== "attention" &&
          item.workContextId === activeWorkContextId
      );
    const sameLabelDifferentContextRetained =
      sameLabelDifferentContext !== undefined &&
      visibleItems.some(
        (item) =>
          item.lane === "continuation" &&
          item.workContextId === sameLabelDifferentContext.workContextId
      );
    // Authenticated setup candidates have null WorkContext IDs. The Board
    // never treats null as an identity key, so separately composed null-setup
    // items remain present rather than being auto-deduped by label.
    const setupInput: AuthenticatedBoardFixture = {
      descriptor: buildContinuationBoardChainDescriptor("setup"),
      active: noActionAttention()
    };
    const setupBundle = boardBundle(setupInput);
    const setupBoard = composeWorkSuggestionBoard(
      setupBundle.bundle,
      setupBundle.options
    );
    const setupItems = setupBoard.ok
      ? [
          ...(setupBoard.board.primary === null
            ? []
            : [setupBoard.board.primary]),
          ...setupBoard.board.alternatives
        ].filter((item) => item.lane === "setup")
      : [];
    const nullSetupRetained =
      setupItems.length >= 2 &&
      setupItems.every((item) => item.workContextId === null);
    return summarize({
      expectedCode: "CROSS_LANE_DEDUPE_PRESERVES_ATTENTION",
      contractOutcome: inputBound ? "accepted" : "rejected",
      decisionStatus: resolved.decision.status,
      coverageCode: resolved.decision.coverageCode,
      prominentLane: board?.prominentLane ?? null,
      checks: [
        check("ACTIVE_OBJECT_UNCHANGED", board?.input.active === active, "ACTIVE_RESULT_DIFF"),
        check(
          "ACTIVE_RESULT_HASH_UNCHANGED",
          board?.input.active.resultSha256 === active.resultSha256,
          "ACTIVE_RESULT_HASH_DIFF"
        ),
        check("ATTENTION_PRIMARY", board?.prominentLane === "attention", "ACTIVE_RESULT_DIFF"),
        check("BOARD_INPUT_BOUND_VERIFIED", inputBound, "CONTRACT_INTEGRITY_FAILURE"),
        check("EXACT_WORK_CONTEXT_DEDUPED", exactContextDeduped, "WRONG_IDENTITY"),
        check(
          "EXECUTION_POLICY_READ_ONLY",
          board !== null && readOnlyBoard(board),
          "AUTOMATIC_EXECUTION_OR_MUTATION"
        ),
        check("NULL_SETUP_NOT_AUTO_DEDUPED", nullSetupRetained, "WRONG_IDENTITY"),
        check(
          "R003_ARTIFACT_SCHEMA_ACCEPTED",
          bundle.continuationResolvedDecision === resolved,
          "CONTRACT_INTEGRITY_FAILURE"
        ),
        check(
          "R003_INPUT_BOUND_VERIFIED",
          inputBound,
          "CONTRACT_INTEGRITY_FAILURE"
        ),
        check(
          "SAME_LABEL_DIFFERENT_CONTEXT_RETAINED",
          sameLabelDifferentContextRetained,
          "WRONG_IDENTITY"
        )
      ]
    });
  });
}

function boardBundle(input: AuthenticatedBoardFixture) {
  const chain = executeContinuationResolverEvaluationDescriptor(input.descriptor);
  const bundle: WorkSuggestionBoardCompositionBundle = {
    active: input.active,
    continuationIdentityInput: chain.identityInput,
    continuationIdentityResult: chain.identityResult,
    continuationDerivationEnvelope: chain.derivationEnvelope,
    continuationDerivationResult: chain.derivationResult,
    continuationResolutionEnvelope: chain.resolutionEnvelope,
    continuationResolvedDecision: chain.resolved
  };
  return { bundle, options: chain.resolutionOptions, resolved: chain.resolved };
}

function boardMixedVersionFixture(): ContinuationEvaluationFixture {
  const materialized: AuthenticatedBoardFixture = {
    active: noActionAttention(),
    descriptor: buildContinuationBoardChainDescriptor("ready_dedupe")
  };
  const { bundle, options } = boardBundle(materialized);
  const mixed = {
    ...bundle,
    continuationResolvedDecision: {
      ...bundle.continuationResolvedDecision,
      schemaVersion: "continuation-decision-schema-v999"
    }
  };
  return fixture("board_mixed_version", mixed, () => {
    const rejected = !composeWorkSuggestionBoard(mixed, options).ok;
    return summarize({
      expectedCode: "BOARD_MIXED_VERSION_REJECTED",
      contractOutcome: rejected ? "rejected" : "accepted",
      decisionStatus: null,
      prominentLane: null,
      checks: [check("MIXED_VERSION_REJECTED", rejected, "CONTRACT_INTEGRITY_FAILURE")]
    });
  });
}

function semanticHashFixture(): ContinuationEvaluationFixture {
  const active = suggestedAttention();
  const firstDecision = readyDecision("1");
  const secondDecision = readyDecision("2");
  const materializedInput = {
    active,
    firstDecision,
    secondDecision
  };
  return fixture("semantic_hash_runtime_metadata", materializedInput, () => {
    const continuationSemanticStable =
      firstDecision.semanticResultSha256 === secondDecision.semanticResultSha256;
    const artifactHashChanged =
      firstDecision.resultSha256 !== secondDecision.resultSha256;
    const helperMatched =
      continuationDecisionSemanticSha256(firstDecision) === firstDecision.semanticResultSha256 &&
      continuationDecisionSemanticSha256(secondDecision) === secondDecision.semanticResultSha256;
    const accepted =
      verifyContinuationDecisionIntegrity(firstDecision) &&
      verifyContinuationDecisionIntegrity(secondDecision);
    return summarize({
      expectedCode: "SEMANTIC_HASH_VOLATILE_METADATA_ISOLATED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: firstDecision.status,
      prominentLane: "attention",
      checks: [
        check("ACTIVE_OBJECT_UNCHANGED", active === materializedInput.active, "ACTIVE_RESULT_DIFF"),
        check("ACTIVE_RESULT_HASH_UNCHANGED", active.resultSha256 === materializedInput.active.resultSha256, "ACTIVE_RESULT_HASH_DIFF"),
        check("ARTIFACT_HASH_CHANGED", artifactHashChanged, "CONTRACT_INTEGRITY_FAILURE"),
        check("BOARD_SEMANTIC_HASH_STABLE", continuationSemanticStable, "DETERMINISTIC_REPLAY_MISMATCH"),
        check("CONTINUATION_SEMANTIC_HASH_STABLE", continuationSemanticStable, "DETERMINISTIC_REPLAY_MISMATCH"),
        check("HASH_HELPER_MATCHED", helperMatched, "CONTRACT_INTEGRITY_FAILURE")
      ]
    });
  });
}

function fixture(
  scenario: ContinuationExecutableScenario,
  materializedInput: unknown,
  execute: () => ContinuationContractOracleSummary
): ContinuationEvaluationFixture {
  return { scenario, materializedInput, execute };
}

function check(
  invariantCode: ContinuationOracleInvariantCode,
  passed: boolean,
  ...criticalOnFailure: ContinuationCriticalErrorCode[]
): OracleCheck {
  return { invariantCode, passed, criticalOnFailure };
}

function summarize(input: {
  expectedCode: ContinuationContractOracleCode;
  contractOutcome: "accepted" | "rejected";
  decisionStatus: ContinuationContractOracleSummary["decisionStatus"];
  coverageCode?: ContinuationContractOracleSummary["coverageCode"];
  prominentLane: ContinuationContractOracleSummary["prominentLane"];
  checks: OracleCheck[];
}): ContinuationContractOracleSummary {
  const allPassed = input.checks.every((item) => item.passed);
  return continuationContractOracleSummarySchema.parse({
    oracleCode: allPassed ? input.expectedCode : "CONTRACT_ORACLE_FAILED",
    contractOutcome: input.contractOutcome,
    decisionStatus: input.decisionStatus,
    coverageCode: input.coverageCode ??
      (input.decisionStatus === "offers_available" ||
      input.decisionStatus === "no_recent_context"
        ? "COMPLETE"
        : input.decisionStatus === "setup_required"
          ? "SOURCE_LOCAL_PARTIAL"
          : input.decisionStatus === "insufficient_evidence"
            ? "INSUFFICIENT"
            : input.decisionStatus === "unavailable"
              ? "UNAVAILABLE"
              : null),
    prominentLane: input.prominentLane,
    invariantCodes: input.checks
      .filter((item) => item.passed)
      .map((item) => item.invariantCode)
      .sort(),
    criticalErrorCodes: [
      ...new Set(
        input.checks.flatMap((item) =>
          item.passed ? [] : item.criticalOnFailure
        )
      )
    ].sort()
  });
}

function readyDecision(variant: "1" | "2"): ContinuationDecision {
  return sealContinuationDecision(
    decisionContent("offers_available", readyCandidate(), variant)
  );
}

function setupDecision(variant: "1" | "2"): ContinuationDecision {
  return sealContinuationDecision(
    decisionContent("setup_required", setupCandidate(), variant)
  );
}

function emptyDecision(variant: "1" | "2"): ContinuationDecision {
  return sealContinuationDecision(
    decisionContent("no_recent_context", null, variant)
  );
}

function decisionContent(
  status: "offers_available" | "setup_required" | "no_recent_context",
  primary: ContinuationCandidate | null,
  variant: "1" | "2"
): ContinuationDecisionContent {
  return {
    contract: CONTINUATION_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_DECISION_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    status,
    primary,
    alternatives: [],
    coverageCode: status === "setup_required" ? "SOURCE_LOCAL_PARTIAL" : "COMPLETE",
    reasonCodes: [
      status === "offers_available"
        ? "OFFERS_AVAILABLE"
        : status === "setup_required"
          ? "SETUP_REQUIRED"
          : "NO_RECENT_CONTEXT"
    ],
    run: {
      runId: `continuation_run_${variant.repeat(32)}`,
      analysisId: `analysis_${variant === "1" ? "3".repeat(32) : "4".repeat(32)}`,
      startedAt: variant === "1" ? STARTED_AT : "2026-08-02T02:58:00.000Z",
      completedAt: variant === "1" ? COMPLETED_AT : "2026-08-02T02:58:02.000Z",
      status: "completed",
      codeCommitSha: variant === "1" ? "a".repeat(40) : "e".repeat(40),
      inputSha256: "b".repeat(64),
      dependencies: continuationDependencies(),
      datasetVersion: null,
      datasetSha256: null,
      observationCount: primary === null ? 0 : 1,
      admittedCandidateCount: primary === null ? 0 : 1,
      excludedCandidateCount: 0,
      errors: [],
      latencyMs: variant === "1" ? 1 : 2,
      tokenUsage: null
    }
  };
}

function readyCandidate(): ContinuationCandidate {
  return candidate({
    marker: "7",
    candidateKind: "recent_github_push",
    workContextId: WORK_CONTEXT_ID,
    evidenceBand: "single_source",
    capability: "display",
    availability: "ready",
    privateActionTarget: null,
    localDisplayLabel: "Recent work"
  });
}

function setupCandidate(): ContinuationCandidate {
  return candidate({
    marker: "8",
    candidateKind: "workspace_mapping",
    workContextId: null,
    evidenceBand: "setup",
    capability: "open_setup_surface",
    availability: "setup_required",
    privateActionTarget: {
      capability: "open_setup_surface",
      targetRef: `private_target_${"8".repeat(32)}`
    },
    localDisplayLabel: "Connect workspace"
  });
}

function futureCandidate(): ContinuationCandidate {
  return candidate({
    marker: "9",
    candidateKind: "workspace_mapping",
    workContextId: null,
    evidenceBand: "single_source",
    capability: "map_or_select",
    availability: "future_capability_blocked",
    privateActionTarget: null,
    localDisplayLabel: "Workspace selection pending"
  });
}

function candidate(input: {
  marker: string;
  candidateKind: "recent_github_push" | "workspace_mapping";
  workContextId: string | null;
  evidenceBand: "single_source" | "setup";
  capability: "display" | "open_setup_surface" | "map_or_select";
  availability: "ready" | "setup_required" | "future_capability_blocked";
  privateActionTarget: null | {
    capability: "open_setup_surface";
    targetRef: string;
  };
  localDisplayLabel: string;
}): ContinuationCandidate {
  const sourceObservationIds = [
    `continuation_observation_${input.marker.repeat(32)}`
  ];
  const candidateId = createContinuationCandidateId({
    candidateKind: input.candidateKind,
    workContextId: input.workContextId,
    sourceObservationIds,
    observedAt: OBSERVED_AT
  });
  const scoreBreakdown = {
    recency: 35,
    exactCorroboration: 0,
    resumability: input.capability === "display" ? 20 : 0,
    localContinuity: input.workContextId === null ? 0 : 10,
    explicitPreference: 5
  };
  return sealContinuationCandidate({
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateId,
    candidateKind: input.candidateKind,
    workContextId: input.workContextId,
    sourceObservationIds,
    localDisplayLabel: input.localDisplayLabel,
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    evidenceBand: input.evidenceBand,
    capability: input.capability,
    availability: input.availability,
    continuityScore: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
    scoreBreakdown,
    reasonCodes: [input.evidenceBand === "setup" ? "SETUP_REQUIRED" : "RECENT_ACTIVITY"],
    caveatCodes: [],
    privateActionTarget: input.privateActionTarget
  });
}

function continuationDependencies() {
  return {
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion: CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    ruleVersion: CONTINUATION_RULE_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    resolverVersion: CONTINUATION_RESOLVER_VERSION,
    actionPolicyVersion: CONTINUATION_ACTION_POLICY_VERSION,
    publicProjectionPolicyVersion: CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
    workContextRegistryContract: "work-context-registry-v1" as const,
    workContextRegistrySha256: SHA_A,
    github: {
      state: "available" as const,
      source: "github" as const,
      sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
      snapshotSha256: "b".repeat(64)
    },
    codex: {
      state: "available" as const,
      source: "codex" as const,
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
      snapshotSha256: "c".repeat(64)
    },
    configSha256: "d".repeat(64)
  };
}

function suggestedAttention(title?: string): ActiveAttentionResult {
  return resolveActiveAttention(
    activeAttentionFixture({
      githubKind: "assigned_issue",
      ...(title === undefined ? {} : { githubTitle: title })
    }).input
  );
}

function noActionAttention(): ActiveAttentionResult {
  return resolveActiveAttention(
    activeAttentionFixture({ githubKind: "none", managedScenario: "none" }).input
  );
}

function readOnlyBoard(board: WorkSuggestionBoardResult): boolean {
  return (
    board.executionPolicy.automaticExecutionAllowed === false &&
    board.executionPolicy.explicitUserActionRequired === true &&
    board.executionPolicy.externalMutationAllowed === false
  );
}

function rejectsWrongBoardLane(
  board: WorkSuggestionBoardResult,
  mutation: Pick<WorkSuggestionBoardResult, "prominentLane" | "primary">
): boolean {
  return rejects(() =>
    sealWorkSuggestionBoardResult({
      contract: board.contract,
      schemaVersion: board.schemaVersion,
      boardId: board.boardId,
      asOf: board.asOf,
      composerVersion: board.composerVersion,
      precedencePolicyVersion: board.precedencePolicyVersion,
      idPolicyVersion: board.idPolicyVersion,
      input: board.input,
      dependencies: board.dependencies,
      prominentLane: mutation.prominentLane,
      primary: mutation.primary,
      alternatives: board.alternatives,
      executionPolicy: board.executionPolicy
    })
  );
}

function rejects(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

function importedPublicDecisionSchema() {
  return requirePublicDecisionSchema;
}

import { continuationPublicDecisionSchema as requirePublicDecisionSchema } from "../../src/continuation";
