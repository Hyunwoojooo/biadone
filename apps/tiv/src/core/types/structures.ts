export type MockStructureResult = {
  extractor: {
    name: "MockStructureExtractor";
    version: string;
    mode: "rule_based";
  };
  overview: Overview;
  overviewSourceCandidates: OverviewSourceCandidates;
  topicFlow: TopicFlowItem[];
  preferenceSignals: PreferenceSignal[];
  contentConstraints: ContentConstraint[];
  satisfactionSignals: SatisfactionSignal[];
  board: Board;
  evidence: EvidenceItem[];
  diagnostics: ExtractionDiagnostics;
};

export type Overview = {
  title: string;
  mainSubject: string;
  userCoreIntent: string;
  currentStatus: "resolved" | "partially_resolved" | "in_progress" | "unclear";
  resolutionSummary: string;
  keyDecisionIds: string[];
  openQuestionIds: string[];
  actionIds: string[];
  dominantPreferenceIds: string[];
  satisfactionSummary: string;
  evidenceMessageIndexes: number[];
  confidence: number;
};

export type OverviewSourceCandidates = {
  firstUserIntent?: {
    messageIndex: number;
    preview: string;
    weight: number;
  };
  confirmedDecisionIds: string[];
  recurringTopicLabels: Array<{
    label: string;
    count: number;
    weight: number;
  }>;
  latestNonMetaTopicId?: string;
  latestMetaRequest?: {
    messageIndex: number;
    preview: string;
    weight: number;
  };
  excludedMetaMessageIndexes: number[];
};

export type TopicFlowItem = {
  id: string;
  order: number;
  label: string;
  summary: string;
  startMessageIndex: number;
  endMessageIndex: number;
  changeReason: TopicChangeReason;
  evidenceMessageIndexes: number[];
  mergedMessageIndexes?: number[];
  contextSignalRefs?: string[];
  contextSummary?: TopicContextSummary;
  confidence: number;
};

export type TopicContextSummary = {
  externalResearch: boolean;
  sourceBacked: boolean;
  signalCount: number;
  signalTypes: string[];
  citationCount: number;
};

export type TopicChangeReason =
  | "new_user_question"
  | "scope_changed"
  | "condition_changed"
  | "format_changed"
  | "perspective_changed"
  | "external_research_started"
  | "artifact_requested"
  | "correction_or_revision"
  | "implementation_phase_started"
  | "continuation";

export type PreferenceSignal = {
  id: string;
  category:
    | "tone"
    | "length"
    | "language_expression"
    | "format"
    | "specificity_depth"
    | "avoidance"
    | "reinforced";
  polarity: "positive" | "negative";
  normalizedLabel: string;
  description: string;
  triggerPhrase?: string;
  reinforced: boolean;
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
};

export type ReviewRequiredReason =
  | "low_confidence"
  | "very_low_confidence"
  | "assistant_suggestion"
  | "candidate_decision"
  | "example_derived"
  | "weak_evidence"
  | "missing_quote"
  | "multi_status_satisfaction"
  | "context_signal_only";

export type ReviewMetadata = {
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
  includeInKeyDecisionIds?: boolean;
};

export type SatisfactionSignal = {
  id: string;
  assistantMessageIndex: number;
  userReactionMessageIndex: number | null;
  status: SatisfactionStatus;
  secondaryStatuses?: SatisfactionStatus[];
  rationale: string;
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
};

export type SatisfactionStatus =
  | "satisfied"
  | "partially_satisfied"
  | "dissatisfied"
  | "correction_requested"
  | "clarification_requested"
  | "problem_reported"
  | "task_failed"
  | "direction_changed"
  | "alternative_proposed"
  | "new_requirement_added"
  | "meta_request"
  | "topic_shift"
  | "continuing_without_clear_feedback";

export type Board = {
  decisions: DecisionItem[];
  openQuestions: OpenQuestionItem[];
  actions: ActionItem[];
};

export type DecisionItem = {
  id: string;
  title: string;
  description: string;
  triggerPhrase?: string;
  status: "confirmed" | "excluded" | "deferred" | "candidate";
  source:
    | "explicit_user"
    | "assistant_suggestion"
    | "assistant_suggestion_accepted"
    | "inferred";
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
  includeInKeyDecisionIds: boolean;
};

export type OpenQuestionItem = {
  id: string;
  question: string;
  description: string;
  triggerPhrase?: string;
  status: OpenQuestionStatus;
  evidenceMessageIndexes: number[];
  resolvedBy?: OpenQuestionResolvedBy;
  resolvedByDecisionId?: string;
  confidence: number;
  rulesMatched: string[];
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
};

export type OpenQuestionStatus =
  | "open"
  | "answered"
  | "resolved_by_user_decision"
  | "superseded_by_scope_change";

export type OpenQuestionResolvedBy =
  | { type: "assistant_answer"; messageIndex: number }
  | { type: "user_decision"; decisionId: string }
  | { type: "superseded_by_scope_change"; decisionId: string };

export type ActionItem = {
  id: string;
  title: string;
  description: string;
  triggerPhrase?: string;
  actionType: "user_requested" | "team_next" | "assistant_suggested";
  assignee: "assistant" | "user" | "team" | "unknown";
  status: "requested" | "proposed" | "accepted" | "completed";
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
};

export type ContentConstraint = {
  id: string;
  constraintType:
    | "include_content"
    | "exclude_content"
    | "audience"
    | "domain_point"
    | "business_rule"
    | "source_material";
  title: string;
  description: string;
  triggerPhrase: string;
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
  reviewRequired: boolean;
  reviewRequiredReason?: ReviewRequiredReason;
  includeInMainBoard: boolean;
};

export type EvidenceItem = {
  id: string;
  evidenceMessageIndexes: number[];
  contextSignalRefs?: string[];
  quote?: string;
  sourceType: "clean_conversation" | "context_signal" | "mixed";
  evidenceStrength:
    | "explicit_user_statement"
    | "explicit_assistant_statement"
    | "accepted_assistant_suggestion"
    | "paired_reaction"
    | "contextual_support"
    | "weak_inference";
};

export type ExtractionDiagnostics = {
  analyzedMessageIndexes: number[];
  skippedMessageIndexes: number[];
  duplicateMessageIndexes: number[];
  excludedInternalCount: number;
  contextSignalCount: number;
  contextSignalTypeCounts: Record<string, number>;
  sourceBackedTopicCount: number;
  rulesFired: Record<string, number>;
  warnings: DiagnosticWarning[];
};

export type DiagnosticWarning = {
  code:
    | "EXAMPLE_TEXT_DETECTED"
    | "CODE_BLOCK_SKIPPED"
    | "ASSISTANT_ONLY_DECISION_DOWNGRADED"
    | "CONTEXT_SIGNAL_ONLY_DOWNGRADED"
    | "DUPLICATE_MESSAGE_SKIPPED"
    | "LOW_CONFIDENCE_OUTPUT";
  message: string;
  messageIndexes?: number[];
};

export type TopicNode = {
  id: string;
  title: string;
  summary: string;
  children: TopicNode[];
  relatedDecisionIds: string[];
  relatedPendingIssueIds: string[];
  relatedActionItemIds: string[];
  evidenceIds: string[];
};

export type ThoughtFlowStep = {
  id: string;
  order: number;
  title: string;
  summary: string;
  segmentId: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
  };
  relatedDecisionIds: string[];
  relatedPendingIssueIds: string[];
  evidenceIds: string[];
};

export type EntityGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphNode = {
  id: string;
  label: string;
  type:
    | "product"
    | "feature"
    | "technology"
    | "problem"
    | "goal"
    | "document"
    | "person"
    | "organization"
    | "concept"
    | "data_source";
  description: string;
  evidenceIds: string[];
};

export type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType:
    | "HAS_PROBLEM"
    | "HAS_GOAL"
    | "REQUIRES"
    | "LACKS"
    | "USES"
    | "EXCLUDES"
    | "REPLACES"
    | "ALTERNATIVE_TO"
    | "CAUSES"
    | "SOLVES"
    | "PART_OF"
    | "MENTIONS"
    | "SUPPORTED_BY"
    | "NEXT";
  description: string;
  evidenceIds: string[];
};
