export type SegmentExtraction = {
  segmentId: string;
  topics: ExtractedTopic[];
  decisions: ExtractedDecision[];
  pendingIssues: ExtractedPendingIssue[];
  actionItems: ExtractedActionItem[];
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  constraints: ExtractedConstraint[];
};

export type ExtractedTopic = {
  title: string;
  summary: string;
  evidenceMessageIndexes: number[];
};

export type ExtractedDecision = {
  title: string;
  description: string;
  decisionStatus: "confirmed" | "rejected" | "suggested" | "unclear";
  madeBy: "user" | "assistant" | "both" | "inferred";
  rationale: string | null;
  evidenceMessageIndexes: number[];
};

export type ExtractedPendingIssue = {
  title: string;
  description: string;
  options: string[];
  evidenceMessageIndexes: number[];
};

export type ExtractedActionItem = {
  title: string;
  description: string;
  owner: "user" | "team" | "unknown";
  priority: "high" | "medium" | "low" | "unknown";
  evidenceMessageIndexes: number[];
};

export type ExtractedEntity = {
  name: string;
  canonicalNameHint: string | null;
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
    | "data_source"
    | "unknown";
  description: string;
  evidenceMessageIndexes: number[];
};

export type ExtractedRelation = {
  sourceEntity: string;
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
  targetEntity: string;
  description: string;
  evidenceMessageIndexes: number[];
};

export type ExtractedConstraint = {
  title: string;
  description: string;
  evidenceMessageIndexes: number[];
};
