import type { CanonicalConversation, CanonicalMessage } from "../types/conversation";
import type { MockStructureResult } from "../types/structures";

type GptAuditExportInput = {
  analysisId: string;
  shareUrl: string;
  conversation: CanonicalConversation;
  result: MockStructureResult;
};

export function buildGptAuditMarkdown(input: GptAuditExportInput): string {
  const { analysisId, shareUrl, conversation, result } = input;
  const cleanMessages = conversation.messages.filter(
    (message) => message.metadata.messageCategory === "clean_conversation"
  );
  const contextSignals = conversation.messages.filter(
    (message) => message.metadata.messageCategory === "context_signal"
  );
  const excludedInternal = conversation.messages.filter(
    (message) => message.metadata.messageCategory === "excluded_internal"
  );

  return [
    "# TIV GPT Audit File",
    "",
    "이 파일은 ChatGPT에게 현재 TIV 분석 결과가 잘 분리/구조화됐는지 검수시키기 위한 자료입니다.",
    "아래 내용을 보고 Clean Conversation, Context Signals, Excluded/Internal 분리가 적절한지와 Sprint 3/4 구조화 결과가 원문 근거와 맞는지 평가해주세요.",
    "",
    "## 1. Audit Questions",
    "",
    "1. Clean Conversation에 실제 사용자/assistant 최종 답변만 잘 남아 있나요?",
    "2. 검색어, open/click/find 같은 Context Signals가 사용자 의도/결정으로 오판되지 않았나요?",
    "3. thoughts/reasoning/model context/system context 같은 내부 메시지가 semantic 분석에서 제외됐나요?",
    "4. Preference, Decision, Action, Satisfaction, Topic Flow가 원문 evidence와 맞나요?",
    "5. confidence가 낮거나 example-derived로 보이는 항목은 기본 판단에서 제외하는 게 맞나요?",
    "6. 사람이 이 결과를 보고 사용자의 의도와 선호를 이해할 수 있나요?",
    "",
    "## 2. Analysis Metadata",
    "",
    fencedJson({
      analysisId,
      shareUrl,
      conversationId: conversation.id,
      title: conversation.title,
      importedAt: conversation.importedAt,
      stats: conversation.stats,
      extractor: result.extractor
    }),
    "",
    "## 3. Separation Summary",
    "",
    fencedJson({
      cleanConversationCount: cleanMessages.length,
      contextSignalCount: contextSignals.length,
      excludedInternalCount: excludedInternal.length,
      contextSignalTypeCounts: result.diagnostics.contextSignalTypeCounts,
      warnings: result.diagnostics.warnings
    }),
    "",
    "## 4. Sprint 3 Structured Result",
    "",
    fencedJson({
      overview: result.overview,
      overviewSourceCandidates: result.overviewSourceCandidates,
      topicFlow: result.topicFlow,
      preferenceSignals: result.preferenceSignals,
      contentConstraints: result.contentConstraints,
      satisfactionSignals: result.satisfactionSignals,
      board: result.board,
      diagnostics: result.diagnostics
    }),
    "",
    "## 5. Evidence",
    "",
    fencedJson(result.evidence),
    "",
    "## 6. Trigger Phrases",
    "",
    "Decision / Action / Preference가 어떤 짧은 원문 조각 때문에 추출됐는지 확인하는 섹션입니다.",
    "",
    fencedJson({
      decisions: result.board.decisions.map((item) => ({
        id: item.id,
        status: item.status,
        title: item.title,
        triggerPhrase: item.triggerPhrase,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence,
        reviewRequired: item.reviewRequired,
        reviewRequiredReason: item.reviewRequiredReason,
        includeInMainBoard: item.includeInMainBoard,
        includeInKeyDecisionIds: item.includeInKeyDecisionIds
      })),
      actions: result.board.actions.map((item) => ({
        id: item.id,
        actionType: item.actionType,
        title: item.title,
        triggerPhrase: item.triggerPhrase,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence,
        reviewRequired: item.reviewRequired,
        reviewRequiredReason: item.reviewRequiredReason,
        includeInMainBoard: item.includeInMainBoard
      })),
      openQuestions: result.board.openQuestions.map((item) => ({
        id: item.id,
        status: item.status,
        question: item.question,
        triggerPhrase: item.triggerPhrase,
        resolvedBy: item.resolvedBy,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence,
        reviewRequired: item.reviewRequired,
        reviewRequiredReason: item.reviewRequiredReason,
        includeInMainBoard: item.includeInMainBoard
      })),
      satisfaction: result.satisfactionSignals.map((item) => ({
        id: item.id,
        status: item.status,
        secondaryStatuses: item.secondaryStatuses,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence,
        reviewRequired: item.reviewRequired,
        reviewRequiredReason: item.reviewRequiredReason,
        includeInMainBoard: item.includeInMainBoard
      })),
      preferences: result.preferenceSignals.map((item) => ({
        id: item.id,
        category: item.category,
        normalizedLabel: item.normalizedLabel,
        triggerPhrase: item.triggerPhrase,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence
      })),
      contentConstraints: result.contentConstraints.map((item) => ({
        id: item.id,
        constraintType: item.constraintType,
        title: item.title,
        triggerPhrase: item.triggerPhrase,
        evidenceMessageIndexes: item.evidenceMessageIndexes,
        confidence: item.confidence,
        reviewRequired: item.reviewRequired,
        reviewRequiredReason: item.reviewRequiredReason,
        includeInMainBoard: item.includeInMainBoard
      }))
    }),
    "",
    "## 7. Clean Conversation Messages",
    "",
    renderMessages(cleanMessages),
    "",
    "## 8. Context Signals",
    "",
    renderMessages(contextSignals),
    "",
    "## 9. Excluded/Internal Messages",
    "",
    "내부 메시지는 semantic 분석 대상이 아니므로 원문 전체 대신 type과 짧은 preview만 제공합니다.",
    "",
    renderInternalMessages(excludedInternal)
  ].join("\n");
}

function renderMessages(messages: CanonicalMessage[]): string {
  if (messages.length === 0) {
    return "_No messages._";
  }

  return messages
    .map((message) =>
      [
        `### #${message.index} ${message.role}`,
        "",
        `category: ${message.metadata.messageCategory}`,
        message.metadata.contextSignalType
          ? `contextSignalType: ${message.metadata.contextSignalType}`
          : null,
        "",
        blockquote(truncate(message.text, 4000))
      ]
        .filter((line): line is string => line != null)
        .join("\n")
    )
    .join("\n\n");
}

function renderInternalMessages(messages: CanonicalMessage[]): string {
  if (messages.length === 0) {
    return "_No internal messages._";
  }

  return messages
    .slice(0, 80)
    .map((message) =>
      [
        `- #${message.index} ${message.role}`,
        `internalContentType=${message.metadata.internalContentType ?? "unknown"}`,
        `preview="${escapeInline(truncate(message.text, 180))}"`
      ].join(" · ")
    )
    .join("\n");
}

function fencedJson(value: unknown): string {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function truncate(text: string, maxLength: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function escapeInline(text: string): string {
  return text.replaceAll('"', '\\"').replace(/\s+/g, " ");
}
