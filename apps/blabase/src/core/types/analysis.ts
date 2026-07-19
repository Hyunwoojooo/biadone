import type { CanonicalConversation } from "./conversation";
import type { EvidenceAnchor } from "./evidence";
import type {
  Board,
  EntityGraph,
  Overview,
  ThoughtFlowStep,
  TopicNode
} from "./structures";

export type AnalysisResult = {
  analysisId: string;
  conversation: CanonicalConversation;
  segments: ConversationSegment[];
  evidence: EvidenceAnchor[];
  overview: Overview;
  topicMap: TopicNode;
  thoughtFlow: ThoughtFlowStep[];
  board: Board;
  entityGraph: EntityGraph;
};

export type ConversationSegment = {
  id: string;
  order: number;
  title: string;
  summary: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
  };
  messageIds: string[];
  topicShiftReason:
    | "new_user_question"
    | "explicit_transition"
    | "semantic_shift"
    | "length_limit"
    | "manual";
};
