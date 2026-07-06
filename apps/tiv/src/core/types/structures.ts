export type Overview = {
  title: string;
  oneLineSummary: string;
  coreProblem: string;
  coreSolution: string;
  keyDecisions: string[];
  pendingIssues: string[];
  nextActions: string[];
  evidenceIds: string[];
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

export type Board = {
  decisions: DecisionCard[];
  pendingIssues: PendingCard[];
  actionItems: ActionCard[];
};

export type DecisionCard = {
  id: string;
  title: string;
  description: string;
  rationale: string | null;
  status: "confirmed" | "rejected";
  evidenceIds: string[];
};

export type PendingCard = {
  id: string;
  title: string;
  description: string;
  options: string[];
  evidenceIds: string[];
};

export type ActionCard = {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low" | "unknown";
  owner: "user" | "team" | "unknown";
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
