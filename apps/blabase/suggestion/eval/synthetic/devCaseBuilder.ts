import type {
  AttentionCapability,
  AttentionIntervention,
  ConnectedSource,
  CrossSourceEvaluationCase,
  RankableAttentionLane
} from "../../src/evaluation/crossSourceDatasetSchema";
import { computeCrossSourceSnapshotSha256 } from "../../src/evaluation/crossSourceIntegrity";
import {
  SYNTHETIC_CODEX_DETECTOR_CONFIG_REF,
  SYNTHETIC_CODEX_DETECTOR_CONFIG_SHA256,
  SYNTHETIC_CODEX_DETECTOR_CONFIG_VERSION
} from "./codexDetectorConfig";

const DECISION_AT = "2026-07-26T03:00:00.000Z";
const OBSERVATION_STARTED_AT = "2026-07-25T03:00:00.000Z";
const OBSERVATION_ENDED_AT = "2026-07-26T02:59:00.000Z";
const DEFAULT_SNAPSHOT_AT = "2026-07-26T02:55:00.000Z";

type SourceWindow = CrossSourceEvaluationCase["sourceSnapshotWindows"][number];
type WorkSignal = CrossSourceEvaluationCase["workSignals"][number];
type Relation = CrossSourceEvaluationCase["relations"][number];
type Annotation = CrossSourceEvaluationCase["annotations"][number];
type CodexExpectation =
  CrossSourceEvaluationCase["expectedCodexExecutions"][number];
type Coverage = CrossSourceEvaluationCase["expectedCoverage"];
type Decision = CrossSourceEvaluationCase["expectedDecision"];
type Focus = CrossSourceEvaluationCase["focus"];

type OverviewReason = Annotation["reasonCodes"]["overview"][number];
type CandidateReason = Annotation["reasonCodes"]["candidate"][number];
type WhyNowReason = Annotation["reasonCodes"]["whyNow"][number];
type GateReason = Annotation["reasonCodes"]["gate"][number];
type ReviewReason = Annotation["reasonCodes"]["review"][number];

export type SyntheticSourceSpec = {
  source: ConnectedSource;
  status?: SourceWindow["status"];
  attentionCapability: AttentionCapability;
  materialToDecision?: boolean;
  candidateSetComplete?: boolean;
  truncated?: boolean;
  snapshotTimes?: string[];
  schemaVersion?: string;
  normalizerVersion?: string;
};

export type SyntheticSignalSpec = {
  signalId: string;
  source: ConnectedSource;
  nativeId?: string;
  subjectId: string;
  subjectType?: WorkSignal["subjectType"];
  projectId?: string | null;
  kind: WorkSignal["kind"];
  snapshotIndex?: number;
  observedAt?: string;
  sourceUpdatedAt?: string | null;
  validUntil?: string | null;
  evidenceLevel?: WorkSignal["evidenceLevel"];
  completeness?: WorkSignal["completeness"];
  facts: WorkSignal["facts"];
  destinationRef?: string | null;
};

export type SyntheticCaseSpec = {
  caseId: string;
  title: string;
  summary: string;
  tags: string[];
  focus?: Focus;
  sources: SyntheticSourceSpec[];
  signals: SyntheticSignalSpec[];
  relations?: Relation[];
  useCodexDetector?: boolean;
  annotations: Annotation[];
  expectedCodexExecutions?: CodexExpectation[];
  expectedCoverage: Coverage;
  expectedDecision: Decision;
  pairwisePreferences?: CrossSourceEvaluationCase["pairwisePreferences"];
  hardFailureRisks: CrossSourceEvaluationCase["hardFailureRisks"];
  reviewerNotes?: string;
};

function snapshotId(
  caseId: string,
  source: ConnectedSource,
  snapshotIndex: number
): string {
  return `${caseId}/${source}/snapshot-${snapshotIndex + 1}`;
}

export function source(
  connectedSource: ConnectedSource,
  attentionCapability: AttentionCapability,
  options: Omit<
    SyntheticSourceSpec,
    "source" | "attentionCapability"
  > = {}
): SyntheticSourceSpec {
  const status = options.status ?? "fresh";
  const unavailable = status === "failed" || status === "disconnected";
  const truncated = options.truncated ?? false;
  const candidateSetComplete =
    options.candidateSetComplete ??
    (status === "fresh" &&
      !truncated &&
      attentionCapability === "candidate_capable");

  return {
    source: connectedSource,
    status,
    attentionCapability,
    materialToDecision: options.materialToDecision ?? true,
    candidateSetComplete,
    truncated,
    snapshotTimes:
      options.snapshotTimes ?? (unavailable ? [] : [DEFAULT_SNAPSHOT_AT]),
    schemaVersion:
      options.schemaVersion ??
      `synthetic-${connectedSource}-snapshot-v0.1`,
    normalizerVersion:
      options.normalizerVersion ?? "synthetic-work-signal-normalizer-v0.1"
  };
}

export function signal(
  signalId: string,
  sourceName: ConnectedSource,
  subjectId: string,
  kind: WorkSignal["kind"],
  facts: WorkSignal["facts"],
  options: Omit<
    SyntheticSignalSpec,
    "signalId" | "source" | "subjectId" | "kind" | "facts"
  > = {}
): SyntheticSignalSpec {
  return {
    signalId,
    source: sourceName,
    subjectId,
    kind,
    facts,
    ...options
  };
}

export function noFocus(): Focus {
  return {
    primaryOutcome: null,
    capturedAt: null,
    validUntil: null,
    activeProjectIds: []
  };
}

export function weeklyFocus(
  primaryOutcome: string,
  activeProjectIds: string[]
): Focus {
  return {
    primaryOutcome,
    capturedAt: "2026-07-21T00:00:00.000Z",
    validUntil: "2026-07-28T00:00:00.000Z",
    activeProjectIds
  };
}

export function eligibleAnnotation(input: {
  itemId: string;
  subjectIds: string[];
  intervention: AttentionIntervention;
  acceptableInterventions?: AttentionIntervention[];
  lane: RankableAttentionLane;
  candidateReasons: CandidateReason[];
  whyNow?: WhyNowReason[];
  overview?: OverviewReason[];
  overviewStates?: Annotation["acceptableOverviewStates"];
  evidenceSignalIds: string[];
  destinationRequired?: boolean;
  notes?: string;
}): Annotation {
  const acceptableInterventions = input.acceptableInterventions ?? [];
  return {
    itemId: input.itemId,
    sourceSubjectIds: input.subjectIds,
    disposition: {
      overview: input.overview?.length ? "include" : "exclude",
      candidate: "eligible_signal"
    },
    acceptableOverviewStates: input.overviewStates ?? [],
    eligibility: "eligible",
    interventions: {
      required: [input.intervention],
      acceptable: acceptableInterventions,
      forbidden: []
    },
    acceptableLanes: [input.lane],
    forbiddenAsRankableCandidateAtDecision: false,
    reasonCodes: {
      overview: input.overview ?? [],
      candidate: input.candidateReasons,
      whyNow: input.whyNow ?? [],
      gate: [],
      review: []
    },
    firstStep: {
      required: true,
      destinationRequired: input.destinationRequired ?? true,
      acceptableInterventions: [
        input.intervention,
        ...acceptableInterventions
      ],
      evidenceSignalIds: input.evidenceSignalIds
    },
    notes: input.notes ?? ""
  };
}

export function excludedAnnotation(input: {
  itemId: string;
  subjectIds: string[];
  gateReasons: GateReason[];
  overview?: OverviewReason[];
  overviewStates?: Annotation["acceptableOverviewStates"];
  forbiddenInterventions?: AttentionIntervention[];
  notes?: string;
}): Annotation {
  return {
    itemId: input.itemId,
    sourceSubjectIds: input.subjectIds,
    disposition: {
      overview: input.overview?.length ? "include" : "exclude",
      candidate: "excluded"
    },
    acceptableOverviewStates: input.overviewStates ?? [],
    eligibility: "ineligible",
    interventions: {
      required: [],
      acceptable: [],
      forbidden: input.forbiddenInterventions ?? []
    },
    acceptableLanes: [],
    forbiddenAsRankableCandidateAtDecision: true,
    reasonCodes: {
      overview: input.overview ?? [],
      candidate: [],
      whyNow: [],
      gate: input.gateReasons,
      review: []
    },
    firstStep: {
      required: false,
      destinationRequired: false,
      acceptableInterventions: [],
      evidenceSignalIds: []
    },
    notes: input.notes ?? ""
  };
}

export function reviewAnnotation(input: {
  itemId: string;
  subjectIds: string[];
  reviewReasons: ReviewReason[];
  gateReasons?: GateReason[];
  overview?: OverviewReason[];
  overviewStates?: Annotation["acceptableOverviewStates"];
  notes?: string;
}): Annotation {
  return {
    itemId: input.itemId,
    sourceSubjectIds: input.subjectIds,
    disposition: {
      overview: input.overview?.length ? "include" : "exclude",
      candidate: "review_required"
    },
    acceptableOverviewStates: input.overviewStates ?? [],
    eligibility: "review_required",
    interventions: {
      required: [],
      acceptable: [],
      forbidden: []
    },
    acceptableLanes: [],
    forbiddenAsRankableCandidateAtDecision: true,
    reasonCodes: {
      overview: input.overview ?? [],
      candidate: [],
      whyNow: [],
      gate: input.gateReasons ?? [],
      review: input.reviewReasons
    },
    firstStep: {
      required: false,
      destinationRequired: false,
      acceptableInterventions: [],
      evidenceSignalIds: []
    },
    notes: input.notes ?? ""
  };
}

export function codexExpectation(input: {
  executionId: string;
  states?: CodexExpectation["acceptableStates"];
  mustAppear?: boolean;
}): CodexExpectation {
  return {
    executionId: input.executionId,
    acceptableStates: input.states ?? [],
    mustAppearInOverview: input.mustAppear ?? true,
    executionForbiddenAsAttentionCandidate: true
  };
}

export function completeCoverage(): Coverage {
  return {
    disposition: "complete",
    negativeCandidateCoverageComplete: true,
    limitedSources: [],
    materialUncertaintySources: [],
    uncertaintyBasis: [],
    positiveCandidateIndependentOfUnknowns: false
  };
}

export function insufficientCoverage(
  materialUncertaintySources: ConnectedSource[],
  uncertaintyBasis:
    | "source_coverage"
    | "history_gap"
    | "contract_gap"
    | "critical_conflict" = "source_coverage"
): Coverage {
  return {
    disposition: "insufficient",
    negativeCandidateCoverageComplete: false,
    limitedSources:
      uncertaintyBasis === "critical_conflict"
        ? []
        : materialUncertaintySources,
    materialUncertaintySources,
    uncertaintyBasis: [uncertaintyBasis],
    positiveCandidateIndependentOfUnknowns: false
  };
}

export function limitedPositiveCoverage(
  limitedSources: ConnectedSource[],
  materialUncertaintySources: ConnectedSource[] = []
): Coverage {
  return {
    disposition: "limited_but_sufficient",
    negativeCandidateCoverageComplete: false,
    limitedSources,
    materialUncertaintySources,
    uncertaintyBasis: ["source_coverage"],
    positiveCandidateIndependentOfUnknowns: true
  };
}

export function scopedNoActionCoverage(
  limitedSources: ConnectedSource[]
): Coverage {
  return {
    disposition: "limited_but_sufficient",
    negativeCandidateCoverageComplete: true,
    limitedSources,
    materialUncertaintySources: [],
    uncertaintyBasis: ["source_coverage"],
    positiveCandidateIndependentOfUnknowns: false
  };
}

export function suggestedDecision(
  acceptableTopItemIds: string[],
  forbiddenItemIds: string[] = []
): Decision {
  return {
    status: "suggested",
    acceptableTopItemIds,
    forbiddenItemIds,
    reasonCodes: ["DECISION_TOP_ITEM_SELECTED"],
    clarification: null
  };
}

export function noActionDecision(
  forbiddenItemIds: string[],
  reason:
    | "DECISION_NO_ELIGIBLE_INTERVENTION"
    | "DECISION_ALL_OBSERVED_WORK_HEALTHY" =
    "DECISION_NO_ELIGIBLE_INTERVENTION"
): Decision {
  return {
    status: "no_action",
    acceptableTopItemIds: [],
    forbiddenItemIds,
    reasonCodes: [reason],
    clarification: null
  };
}

export function insufficientDecision(
  forbiddenItemIds: string[],
  needsRefresh = false
): Decision {
  return {
    status: "insufficient_evidence",
    acceptableTopItemIds: [],
    forbiddenItemIds,
    reasonCodes: [
      "DECISION_RELEVANT_COVERAGE_INSUFFICIENT",
      ...(needsRefresh ? (["DECISION_SOURCE_REFRESH_REQUIRED"] as const) : [])
    ],
    clarification: null
  };
}

export function clarificationDecision(
  acceptableTopItemIds: string[],
  questionIntent: string,
  answerChanges: "top_item" | "eligibility" = "top_item"
): Decision {
  return {
    status: "needs_clarification",
    acceptableTopItemIds,
    forbiddenItemIds: [],
    reasonCodes: [
      "DECISION_TOP_CANDIDATES_EQUIVALENT",
      "DECISION_USER_PRIORITY_REQUIRED"
    ],
    clarification: {
      questionIntent,
      answerChanges
    }
  };
}

export function buildSyntheticCase(
  spec: SyntheticCaseSpec
): CrossSourceEvaluationCase {
  const sourceSpecs = new Map(
    spec.sources.map((sourceSpec) => [sourceSpec.source, sourceSpec])
  );

  const workSignals: WorkSignal[] = spec.signals.map((signalSpec) => {
    const sourceSpec = sourceSpecs.get(signalSpec.source);
    const snapshotTimes = sourceSpec?.snapshotTimes ?? [];
    const selectedSnapshotIndex =
      signalSpec.snapshotIndex ?? snapshotTimes.length - 1;
    const observedAt =
      signalSpec.observedAt ?? snapshotTimes[selectedSnapshotIndex];

    if (observedAt === undefined) {
      throw new Error(
        `Synthetic signal ${signalSpec.signalId} has no source snapshot`
      );
    }

    return {
      signalId: signalSpec.signalId,
      source: signalSpec.source,
      nativeId:
        signalSpec.nativeId ?? `${signalSpec.subjectId}/synthetic-native`,
      subjectId: signalSpec.subjectId,
      subjectType:
        signalSpec.subjectType ??
        (signalSpec.source === "codex"
          ? signalSpec.kind === "transient_attention_lifecycle"
            ? "request"
            : "execution"
          : signalSpec.source === "google_calendar"
            ? "event"
            : signalSpec.source === "notion" &&
                signalSpec.kind === "activity"
              ? "page"
              : signalSpec.source === "github" &&
                  signalSpec.subjectId.startsWith("repo-")
                ? "repository"
                : "work_item"),
      projectId: signalSpec.projectId ?? null,
      kind: signalSpec.kind,
      observedAt,
      sourceUpdatedAt: signalSpec.sourceUpdatedAt ?? observedAt,
      validUntil: signalSpec.validUntil ?? null,
      evidenceLevel: signalSpec.evidenceLevel ?? "explicit",
      completeness: signalSpec.completeness ?? "complete",
      facts: signalSpec.facts,
      evidenceRefs: [
        snapshotId(spec.caseId, signalSpec.source, selectedSnapshotIndex)
      ],
      destinationRef: signalSpec.destinationRef ?? null
    };
  });

  const sourceSnapshotWindows: SourceWindow[] = spec.sources.map(
    (sourceSpec) => {
      const status = sourceSpec.status ?? "fresh";
      const snapshotTimes = sourceSpec.snapshotTimes ?? [];
      const schemaVersion =
        sourceSpec.schemaVersion ??
        `synthetic-${sourceSpec.source}-snapshot-v0.1`;
      const normalizerVersion =
        sourceSpec.normalizerVersion ??
        "synthetic-work-signal-normalizer-v0.1";
      const orderedSnapshotRefs = snapshotTimes.map(
        (fetchedAt, snapshotIndex) => {
          const currentSnapshotId = snapshotId(
            spec.caseId,
            sourceSpec.source,
            snapshotIndex
          );
          const snapshotSignals = workSignals.filter(
            (item) =>
              item.source === sourceSpec.source &&
              item.evidenceRefs.includes(currentSnapshotId)
          );
          const snapshotSha256 = computeCrossSourceSnapshotSha256({
            schemaVersion,
            normalizerVersion,
            fetchedAt,
            signals: snapshotSignals
          });

          return {
            snapshotId: currentSnapshotId,
            snapshotSha256,
            fetchedAt,
            schemaVersion,
            normalizerVersion,
            fixtureRef: `synthetic://${spec.caseId}/${sourceSpec.source}/${snapshotIndex + 1}`
          };
        }
      );

      return {
        source: sourceSpec.source,
        status,
        attentionCapability: sourceSpec.attentionCapability,
        materialToDecision: sourceSpec.materialToDecision ?? true,
        candidateSetComplete: sourceSpec.candidateSetComplete ?? false,
        observationStartedAt: OBSERVATION_STARTED_AT,
        observationEndedAt: OBSERVATION_ENDED_AT,
        truncated: sourceSpec.truncated ?? false,
        orderedSnapshotRefs
      };
    }
  );

  return {
    caseId: spec.caseId,
    title: spec.title,
    summary: spec.summary,
    tags: ["synthetic", ...spec.tags],
    decisionAt: DECISION_AT,
    timezone: "Asia/Seoul",
    focus: spec.focus ?? noFocus(),
    sourceSnapshotWindows,
    workSignals,
    relations: spec.relations ?? [],
    codexDetectorConfig: spec.useCodexDetector
      ? {
          version: SYNTHETIC_CODEX_DETECTOR_CONFIG_VERSION,
          immutableRef: SYNTHETIC_CODEX_DETECTOR_CONFIG_REF,
          sha256: SYNTHETIC_CODEX_DETECTOR_CONFIG_SHA256
        }
      : null,
    annotations: spec.annotations,
    expectedCodexExecutions: spec.expectedCodexExecutions ?? [],
    expectedCoverage: spec.expectedCoverage,
    expectedDecision: spec.expectedDecision,
    pairwisePreferences: spec.pairwisePreferences ?? [],
    hardFailureRisks: spec.hardFailureRisks,
    review: {
      status: "draft",
      authorId: "synthetic-fixture-author-v0.1",
      reviewerIds: [],
      adjudicationRef: null,
      notes:
        spec.reviewerNotes ??
        "Mutable synthetic Dev Candidate. Independent human review pending."
    }
  };
}
