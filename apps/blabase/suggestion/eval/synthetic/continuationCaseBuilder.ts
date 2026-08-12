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
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../../src/crossSource/versions";
import { sha256Canonical } from "../../src/evaluation/crossSourceIntegrity";
import {
  WORK_SUGGESTION_BOARD_EXECUTION_POLICY,
  createWorkSuggestionBoardId,
  createWorkSuggestionBoardItemId,
  createWorkSuggestionBoardSourceItemRef,
  sealWorkSuggestionBoardInput,
  sealWorkSuggestionBoardResult,
  verifyWorkSuggestionBoardResultIntegrity,
  workSuggestionBoardInputSchema,
  workSuggestionBoardResultSemanticSha256,
  type WorkSuggestionBoardInput,
  type WorkSuggestionBoardItem,
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
import { buildContinuationResolverEvaluationFixture } from "./continuationResolverCaseBuilder";

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
      return boardAttentionFixture();
    case "board_continuation_fallback":
      return boardContinuationFixture();
    case "board_setup_fallback":
      return boardSetupFixture();
    case "board_empty":
      return boardEmptyFixture();
    case "board_mixed_version":
      return boardMixedVersionFixture();
    case "semantic_hash_runtime_metadata":
      return semanticHashFixture();
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

function boardAttentionFixture(): ContinuationEvaluationFixture {
  const active = suggestedAttention();
  const decision = readyDecision("1");
  const board = boardResult(active, decision, "attention");
  return fixture("board_attention_precedence", { active, decision, board }, () => {
    const accepted = verifyWorkSuggestionBoardResultIntegrity(board);
    const objectUnchanged = sha256Canonical(board.input.active) === sha256Canonical(active);
    const hashUnchanged = board.input.active.resultSha256 === active.resultSha256;
    const wrongLaneRejected = rejectsWrongBoardLane(board, {
      prominentLane: "continuation",
      primary: boardPrimary(active, decision, "continuation")
    });
    return summarize({
      expectedCode: "BOARD_ATTENTION_PRECEDENCE_CONTRACT_ENFORCED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: decision.status,
      prominentLane: accepted ? board.prominentLane : null,
      checks: [
        check("ACTIVE_OBJECT_UNCHANGED", objectUnchanged, "ACTIVE_RESULT_DIFF"),
        check("ACTIVE_RESULT_HASH_UNCHANGED", hashUnchanged, "ACTIVE_RESULT_HASH_DIFF"),
        check("ATTENTION_PRIMARY", board.prominentLane === "attention", "ACTIVE_RESULT_DIFF"),
        check("EXECUTION_POLICY_READ_ONLY", readOnlyBoard(board), "AUTOMATIC_EXECUTION_OR_MUTATION"),
        check("WRONG_LANE_MUTATION_REJECTED", wrongLaneRejected, "CONTRACT_INTEGRITY_FAILURE")
      ]
    });
  });
}

function boardContinuationFixture(): ContinuationEvaluationFixture {
  const active = noActionAttention();
  const decision = readyDecision("1");
  const board = boardResult(active, decision, "continuation");
  return fixture("board_continuation_fallback", { active, decision, board }, () => {
    const accepted = verifyWorkSuggestionBoardResultIntegrity(board);
    const wrongLaneRejected = rejectsWrongBoardLane(board, {
      prominentLane: "none",
      primary: null
    });
    return summarize({
      expectedCode: "BOARD_CONTINUATION_PRECEDENCE_CONTRACT_ENFORCED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: decision.status,
      prominentLane: accepted ? board.prominentLane : null,
      checks: [
        check("CONTINUATION_PRIMARY", board.prominentLane === "continuation", "CONTRACT_INTEGRITY_FAILURE"),
        check("EXECUTION_POLICY_READ_ONLY", readOnlyBoard(board), "AUTOMATIC_EXECUTION_OR_MUTATION"),
        check("WRONG_LANE_MUTATION_REJECTED", wrongLaneRejected, "CONTRACT_INTEGRITY_FAILURE")
      ]
    });
  });
}

function boardSetupFixture(): ContinuationEvaluationFixture {
  const active = noActionAttention();
  const decision = setupDecision("1");
  const board = boardResult(active, decision, "setup");
  return fixture("board_setup_fallback", { active, decision, board }, () => {
    const accepted = verifyWorkSuggestionBoardResultIntegrity(board);
    const wrongLaneRejected = rejectsWrongBoardLane(board, {
      prominentLane: "none",
      primary: null
    });
    return summarize({
      expectedCode: "BOARD_SETUP_PRECEDENCE_CONTRACT_ENFORCED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: decision.status,
      prominentLane: accepted ? board.prominentLane : null,
      checks: [
        check("EXECUTION_POLICY_READ_ONLY", readOnlyBoard(board), "AUTOMATIC_EXECUTION_OR_MUTATION"),
        check("SETUP_PRIMARY", board.prominentLane === "setup", "UNSAFE_ACTION_TARGET"),
        check("WRONG_LANE_MUTATION_REJECTED", wrongLaneRejected, "CONTRACT_INTEGRITY_FAILURE")
      ]
    });
  });
}

function boardEmptyFixture(): ContinuationEvaluationFixture {
  const active = noActionAttention();
  const decision = emptyDecision("1");
  const board = boardResult(active, decision, "none");
  return fixture("board_empty", { active, decision, board }, () => {
    const empty =
      verifyWorkSuggestionBoardResultIntegrity(board) &&
      board.prominentLane === "none" &&
      board.primary === null &&
      board.alternatives.length === 0;
    const fabricatedActive = suggestedAttention();
    const wrongLaneRejected = rejectsWrongBoardLane(board, {
      prominentLane: "attention",
      primary: boardPrimary(fabricatedActive, decision, "attention")
    });
    return summarize({
      expectedCode: "BOARD_EMPTY_PRECEDENCE_CONTRACT_ENFORCED",
      contractOutcome: empty ? "accepted" : "rejected",
      decisionStatus: decision.status,
      prominentLane: empty ? board.prominentLane : null,
      checks: [
        check("EMPTY_BOARD", empty, "CONTRACT_INTEGRITY_FAILURE"),
        check("EXECUTION_POLICY_READ_ONLY", readOnlyBoard(board), "AUTOMATIC_EXECUTION_OR_MUTATION"),
        check("WRONG_LANE_MUTATION_REJECTED", wrongLaneRejected, "CONTRACT_INTEGRITY_FAILURE")
      ]
    });
  });
}

function boardMixedVersionFixture(): ContinuationEvaluationFixture {
  const active = noActionAttention();
  const decision = readyDecision("1");
  const input = boardInput(active, decision);
  const mixed = {
    ...input,
    continuation: {
      ...input.continuation,
      schemaVersion: "continuation-decision-schema-v999"
    }
  };
  return fixture("board_mixed_version", mixed, () => {
    const rejected = !workSuggestionBoardInputSchema.safeParse(mixed).success;
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
  const firstBoard = boardResult(active, firstDecision, "attention");
  const secondBoard = boardResult(active, secondDecision, "attention");
  const materializedInput = {
    active,
    firstDecision,
    secondDecision,
    firstBoard,
    secondBoard
  };
  return fixture("semantic_hash_runtime_metadata", materializedInput, () => {
    const continuationSemanticStable =
      firstDecision.semanticResultSha256 === secondDecision.semanticResultSha256;
    const boardSemanticStable =
      firstBoard.semanticResultSha256 === secondBoard.semanticResultSha256;
    const artifactHashChanged =
      firstDecision.resultSha256 !== secondDecision.resultSha256 &&
      firstBoard.resultSha256 !== secondBoard.resultSha256;
    const activeObjectUnchanged =
      sha256Canonical(firstBoard.input.active) === sha256Canonical(active) &&
      sha256Canonical(secondBoard.input.active) === sha256Canonical(active);
    const activeHashUnchanged =
      firstBoard.input.active.resultSha256 === active.resultSha256 &&
      secondBoard.input.active.resultSha256 === active.resultSha256;
    const helperMatched =
      continuationDecisionSemanticSha256(firstDecision) === firstDecision.semanticResultSha256 &&
      continuationDecisionSemanticSha256(secondDecision) === secondDecision.semanticResultSha256 &&
      workSuggestionBoardResultSemanticSha256(firstBoard) === firstBoard.semanticResultSha256 &&
      workSuggestionBoardResultSemanticSha256(secondBoard) === secondBoard.semanticResultSha256;
    const accepted =
      verifyContinuationDecisionIntegrity(firstDecision) &&
      verifyContinuationDecisionIntegrity(secondDecision) &&
      verifyWorkSuggestionBoardResultIntegrity(firstBoard) &&
      verifyWorkSuggestionBoardResultIntegrity(secondBoard);
    return summarize({
      expectedCode: "SEMANTIC_HASH_VOLATILE_METADATA_ISOLATED",
      contractOutcome: accepted ? "accepted" : "rejected",
      decisionStatus: firstDecision.status,
      prominentLane: firstBoard.prominentLane,
      checks: [
        check("ACTIVE_OBJECT_UNCHANGED", activeObjectUnchanged, "ACTIVE_RESULT_DIFF"),
        check("ACTIVE_RESULT_HASH_UNCHANGED", activeHashUnchanged, "ACTIVE_RESULT_HASH_DIFF"),
        check("ARTIFACT_HASH_CHANGED", artifactHashChanged, "CONTRACT_INTEGRITY_FAILURE"),
        check("BOARD_SEMANTIC_HASH_STABLE", boardSemanticStable, "DETERMINISTIC_REPLAY_MISMATCH"),
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

function suggestedAttention(): ActiveAttentionResult {
  return resolveActiveAttention(activeAttentionFixture({ githubKind: "assigned_issue" }).input);
}

function noActionAttention(): ActiveAttentionResult {
  return resolveActiveAttention(
    activeAttentionFixture({ githubKind: "none", managedScenario: "none" }).input
  );
}

function boardInput(
  active: ActiveAttentionResult,
  continuation: ContinuationDecision
): WorkSuggestionBoardInput {
  return sealWorkSuggestionBoardInput({
    contract: WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
    precedencePolicyVersion: WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
    idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
    active,
    continuation
  });
}

function boardResult(
  active: ActiveAttentionResult,
  continuation: ContinuationDecision,
  lane: "attention" | "continuation" | "setup" | "none"
): WorkSuggestionBoardResult {
  const input = boardInput(active, continuation);
  const primary = boardPrimary(active, continuation, lane);
  return sealWorkSuggestionBoardResult({
    contract: WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
    schemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
    boardId: createWorkSuggestionBoardId({
      inputSha256: input.inputSha256,
      composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
      precedencePolicyVersion: WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
      idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION
    }),
    asOf: ACTIVE_FIXTURE_AS_OF,
    composerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
    precedencePolicyVersion: WORK_SUGGESTION_BOARD_PRECEDENCE_POLICY_VERSION,
    idPolicyVersion: WORK_SUGGESTION_BOARD_ID_POLICY_VERSION,
    input,
    dependencies: {
      inputSha256: input.inputSha256,
      activeResultSha256: active.resultSha256,
      continuationResultSha256: continuation.resultSha256,
      continuationSemanticResultSha256: continuation.semanticResultSha256
    },
    prominentLane: lane,
    primary,
    alternatives: [],
    executionPolicy: WORK_SUGGESTION_BOARD_EXECUTION_POLICY
  });
}

function boardPrimary(
  active: ActiveAttentionResult,
  continuation: ContinuationDecision,
  lane: "attention" | "continuation" | "setup" | "none"
): WorkSuggestionBoardItem | null {
  if (lane === "none") return null;
  if (lane === "attention") {
    const candidate = active.decision.topSuggestion;
    if (!candidate) throw new TypeError("Synthetic Attention primary is absent.");
    return boardItem({
      lane,
      sourceStableId: candidate.candidateId,
      workContextId: candidate.projectId,
      label: candidate.title,
      observedAt: candidate.sourceUpdatedAt,
      expiresAt: candidate.dueAt,
      evidenceBand: "verified_attention",
      capability: "display"
    });
  }
  const candidate = continuation.primary;
  if (!candidate) throw new TypeError("Synthetic Continuation primary is absent.");
  return boardItem({
    lane,
    sourceStableId: candidate.candidateId,
    workContextId: candidate.workContextId,
    label: candidate.localDisplayLabel,
    observedAt: candidate.observedAt,
    expiresAt: candidate.expiresAt,
    evidenceBand: candidate.evidenceBand,
    capability:
      candidate.capability === "open_setup_surface"
        ? "open_setup_surface"
        : candidate.capability === "display"
          ? "display"
          : "open_source"
  });
}

function boardItem(input: {
  lane: "attention" | "continuation" | "setup";
  sourceStableId: string;
  workContextId: string | null;
  label: string;
  observedAt: string | null;
  expiresAt: string | null;
  evidenceBand: WorkSuggestionBoardItem["evidenceBand"];
  capability: WorkSuggestionBoardItem["capability"];
}): WorkSuggestionBoardItem {
  const sourceItemRef = createWorkSuggestionBoardSourceItemRef({
    lane: input.lane,
    sourceStableId: input.sourceStableId
  });
  return {
    boardItemId: createWorkSuggestionBoardItemId({
      lane: input.lane,
      sourceItemRef,
      workContextId: input.workContextId
    }),
    lane: input.lane,
    sourceItemRef,
    workContextId: input.workContextId,
    localDisplayLabel: input.label,
    summary: input.label,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    evidenceBand: input.evidenceBand,
    capability: input.capability
  };
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
