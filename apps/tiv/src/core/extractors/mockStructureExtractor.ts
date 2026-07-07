import type {
  CanonicalConversation,
  CanonicalMessage
} from "../types/conversation";
import type {
  ActionItem,
  Board,
  DecisionItem,
  DiagnosticWarning,
  EvidenceItem,
  ExtractionDiagnostics,
  MockStructureResult,
  OpenQuestionItem,
  PreferenceSignal,
  SatisfactionSignal,
  SatisfactionStatus,
  TopicChangeReason,
  TopicFlowItem
} from "../types/structures";

const EXTRACTOR_VERSION = "0.1.0";

type RuleKind =
  | "preference"
  | "decision"
  | "open_question"
  | "action"
  | "satisfaction"
  | "topic_shift";

type RuleDefinition = {
  id: string;
  kind: RuleKind;
  subtype: string;
  regex: RegExp;
  baseConfidence: number;
};

type PreparedMessage = {
  message: CanonicalMessage;
  preparedText: string;
  matchedRules: RuleDefinition[];
};

const USER_RULES: RuleDefinition[] = [
  {
    id: "preference.tone",
    kind: "preference",
    subtype: "tone",
    regex: /(친근|전문적|명확|직설|부드럽|딱딱하지|실무적|컨설턴트|tone|friendly|professional|direct|clear|casual|formal)/i,
    baseConfidence: 0.8
  },
  {
    id: "preference.length.concise",
    kind: "preference",
    subtype: "length_concise",
    regex: /(짧게|간단히|핵심만|요약|한 문장|short|brief|concise|summary|tl;dr)/i,
    baseConfidence: 0.82
  },
  {
    id: "preference.length.detailed",
    kind: "preference",
    subtype: "length_detailed",
    regex: /(자세히|상세하게|충분히|길게|세부|detailed|in depth|comprehensive|thorough)/i,
    baseConfidence: 0.82
  },
  {
    id: "preference.language",
    kind: "preference",
    subtype: "language",
    regex: /(한국어|영어|쉬운 말|표현|문장|제품스럽|기획안스럽|korean|english|plain language|wording|copy)/i,
    baseConfidence: 0.78
  },
  {
    id: "preference.format",
    kind: "preference",
    subtype: "format",
    regex: /(\.md|markdown|json|schema|표로|리스트|불렛|문서|파일|기획안|명세서|table|list|doc|spec|plan|file)/i,
    baseConfidence: 0.86
  },
  {
    id: "preference.depth",
    kind: "preference",
    subtype: "depth",
    regex: /(구체적|세부 규칙|현실적|바로 적용|구현 가능|방법론|룰|regex|typescript|specific|practical|implementation|rule|mock)/i,
    baseConfidence: 0.88
  },
  {
    id: "preference.avoidance",
    kind: "preference",
    subtype: "avoidance",
    regex: /(빼|제외|하지마|안 할|필요 없|의미 없|말고|후순위|추후|exclude|remove|do not|don't|avoid|not needed|later|defer)/i,
    baseConfidence: 0.88
  },
  {
    id: "decision.confirmed",
    kind: "decision",
    subtype: "confirmed",
    regex: /(이걸로 하자|방향으로 가자|확정|채택|진행하자|메인으로 잡자|기술로 잡자|let's go with|decide|confirmed|adopt|use this|proceed)/i,
    baseConfidence: 0.92
  },
  {
    id: "decision.deferred",
    kind: "decision",
    subtype: "deferred",
    regex: /(보류|나중에|추후|후순위|v0\.2|v0\.3|일단.*빼|defer|later|postpone|future|backlog|not now)/i,
    baseConfidence: 0.88
  },
  {
    id: "decision.excluded",
    kind: "decision",
    subtype: "excluded",
    regex: /(빼자|제외|안 할거야|하지 않는다|필요 없다|넣지 말자|탈락|exclude|drop|remove|won't do|will not|not include)/i,
    baseConfidence: 0.9
  },
  {
    id: "open_question.uncertainty",
    kind: "open_question",
    subtype: "uncertainty",
    regex: /(모르겠|고민|어떻게|가능할까|정해야|선택해야|편하려나|어때|not sure|wonder|how should|should we|which|whether)/i,
    baseConfidence: 0.72
  },
  {
    id: "action.user_request",
    kind: "action",
    subtype: "user_request",
    regex: /(정리해줘|만들어줘|작성해줘|비교해줘|분석해줘|제안해줘|뽑아줘|파일로|만들자|make|create|write|compare|analyze|suggest|generate|export)/i,
    baseConfidence: 0.88
  },
  {
    id: "action.team_next",
    kind: "action",
    subtype: "team_next",
    regex: /(해야 한다|해보자|테스트|검증|구현|설계|수집|확인|추가하자|need to|should|test|validate|implement|design|collect|check)/i,
    baseConfidence: 0.75
  },
  {
    id: "topic_shift.transition",
    kind: "topic_shift",
    subtype: "transition",
    regex: /(그렇다면|그럼|이제|다시|최종본|개발 얘기|기술 얘기|기획안|명세서|파일|codex|sprint|mock|now|next|then|implementation|spec|plan)/i,
    baseConfidence: 0.8
  }
];

const SATISFACTION_RULES: RuleDefinition[] = [
  {
    id: "satisfaction.correction",
    kind: "satisfaction",
    subtype: "correction_requested",
    regex: /(다시|수정|고쳐|바꿔|빼고|넣고|추가|제외|재정리|revise|fix|change|redo|rewrite|remove|add|update)/i,
    baseConfidence: 0.88
  },
  {
    id: "satisfaction.dissatisfied",
    kind: "satisfaction",
    subtype: "dissatisfied",
    regex: /(아니|아닌데|틀렸|별로|원하는 게 아니|잘못 이해|그게 아니|no|wrong|incorrect|not what i want|bad|missed)/i,
    baseConfidence: 0.86
  },
  {
    id: "satisfaction.partial",
    kind: "satisfaction",
    subtype: "partially_satisfied",
    regex: /(좋은데|맞는데|괜찮은데|방향은 맞|다만|근데|하지만|조금 더|good but|right but|however|but|partly|mostly)/i,
    baseConfidence: 0.78
  },
  {
    id: "satisfaction.clarification",
    kind: "satisfaction",
    subtype: "clarification_requested",
    regex: /(무슨 뜻|왜|어떻게|설명|이해가 안|차이가 뭐|가능한가|궁금|why|how|what do you mean|explain|clarify|possible)/i,
    baseConfidence: 0.76
  },
  {
    id: "satisfaction.satisfied",
    kind: "satisfaction",
    subtype: "satisfied",
    regex: /(좋아|좋습니다|맞아|맞습니다|오케이|괜찮|완료|충분|그걸로|good|great|ok|okay|works|correct|sounds good|enough)/i,
    baseConfidence: 0.75
  }
];

const CONTINUING_PATTERN =
  /(그렇다면|그럼 이제|다음으로|이제|그럼|next|then|now)/i;

const TOPIC_ENTITY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "MockExtractor", regex: /mock\s*extractor|mockextractor/i },
  { label: "Context Signals", regex: /context signals?|context signal|컨텍스트 신호/i },
  { label: "Clean Conversation", regex: /clean conversation|클린 대화/i },
  { label: "ChatGPT Share Adapter", regex: /chatgpt share|share adapter|공유 링크/i },
  { label: "구조화 결과", regex: /구조화|structure result|structured/i },
  { label: "Topic Flow", regex: /topic flow|토픽|논점/i },
  { label: "Overview", regex: /overview|요약|대시보드/i },
  { label: "Board", regex: /board|decision|action|open question/i },
  { label: "PDF 업로드", regex: /pdf/i },
  { label: "Sprint 3", regex: /sprint\s*3|sprint3/i },
  { label: "Codex", regex: /codex/i }
];

export function extractMockStructure(
  conversation: CanonicalConversation
): MockStructureResult {
  const cleanMessages = conversation.messages.filter(
    (message) => message.metadata.messageCategory === "clean_conversation"
  );
  const userMessages = cleanMessages.filter((message) => message.role === "user");
  const duplicateMessageIndexes = findDuplicateMessageIndexes(cleanMessages);
  const rulesFired: Record<string, number> = {};
  const warnings: DiagnosticWarning[] = [];
  const evidence: EvidenceItem[] = [];
  const preferences: PreferenceSignal[] = [];
  const decisions: DecisionItem[] = [];
  const openQuestions: OpenQuestionItem[] = [];
  const actions: ActionItem[] = [];
  const preparedMessages: PreparedMessage[] = [];

  for (const message of userMessages) {
    if (duplicateMessageIndexes.includes(message.index)) {
      warnings.push({
        code: "DUPLICATE_MESSAGE_SKIPPED",
        message: "Near-duplicate clean message was skipped.",
        messageIndexes: [message.index]
      });
      continue;
    }

    const prepared = prepareText(message.text);
    if (prepared.hadCodeBlock) {
      warnings.push({
        code: "CODE_BLOCK_SKIPPED",
        message: "Code block content was excluded from keyword extraction.",
        messageIndexes: [message.index]
      });
    }
    if (prepared.isExampleLike) {
      warnings.push({
        code: "EXAMPLE_TEXT_DETECTED",
        message: "Example-like text was detected and confidence was capped.",
        messageIndexes: [message.index]
      });
    }

    const matchedRules = USER_RULES.filter((rule) => rule.regex.test(prepared.text));
    preparedMessages.push({
      message,
      preparedText: prepared.text,
      matchedRules
    });
    for (const rule of matchedRules) {
      incrementRule(rulesFired, rule.id);
    }

    const quote = truncateQuote(message.text);
    const confidenceFor = (rule: RuleDefinition) =>
      adjustConfidence(rule.baseConfidence, {
        exampleLike: prepared.isExampleLike,
        questionLike: isQuestionLike(prepared.text)
      });

    for (const rule of matchedRules) {
      if (rule.kind === "preference") {
        preferences.push({
          id: createItemId("pref", preferences.length + 1),
          category: preferenceCategoryFor(rule.subtype),
          polarity: rule.subtype === "avoidance" ? "negative" : "positive",
          normalizedLabel: preferenceLabelFor(rule.subtype),
          description: quote,
          reinforced: false,
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id]
        });
      }

      if (rule.kind === "decision") {
        decisions.push({
          id: createItemId("dec", decisions.length + 1),
          title: titleFromMessage(message.text),
          description: quote,
          status: decisionStatusFor(rule.subtype),
          source: "explicit_user",
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id]
        });
      }

      if (rule.kind === "open_question") {
        openQuestions.push({
          id: createItemId("oq", openQuestions.length + 1),
          question: titleFromMessage(message.text),
          description: quote,
          status: "open",
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id]
        });
      }

      if (rule.kind === "action") {
        actions.push({
          id: createItemId("act", actions.length + 1),
          title: titleFromMessage(message.text),
          description: quote,
          actionType: rule.subtype === "team_next" ? "team_next" : "user_requested",
          assignee: rule.subtype === "team_next" ? "team" : "assistant",
          status: "requested",
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id]
        });
      }
    }

    if (matchedRules.length > 0) {
      evidence.push({
        id: createItemId("ev", evidence.length + 1),
        evidenceMessageIndexes: [message.index],
        quote,
        sourceType: "clean_conversation",
        evidenceStrength: "explicit_user_statement"
      });
    }
  }

  const aggregatedPreferences = aggregatePreferences(preferences);
  const satisfactionSignals = extractSatisfactionSignals(cleanMessages, rulesFired);
  evidence.push(
    ...satisfactionSignals.map((signal, index): EvidenceItem => ({
      id: createItemId("evsat", index + 1),
      evidenceMessageIndexes: signal.evidenceMessageIndexes,
      sourceType: "clean_conversation",
      evidenceStrength: "paired_reaction"
    }))
  );

  const prioritizedDecisions = prioritizeDecisions(decisions);
  const topicFlow = buildTopicFlow(cleanMessages, preparedMessages, rulesFired);
  const board: Board = {
    decisions: prioritizedDecisions,
    openQuestions: resolveOpenQuestions(
      dedupeByEvidence(openQuestions),
      prioritizedDecisions
    ),
    actions: dedupeActions(actions)
  };

  return {
    extractor: {
      name: "MockStructureExtractor",
      version: EXTRACTOR_VERSION,
      mode: "rule_based"
    },
    overview: buildOverview({
      conversation,
      cleanMessages,
      userMessages,
      topicFlow,
      preferences: aggregatedPreferences,
      satisfactionSignals,
      board
    }),
    topicFlow,
    preferenceSignals: aggregatedPreferences,
    satisfactionSignals,
    board,
    evidence,
    diagnostics: {
      analyzedMessageIndexes: cleanMessages.map((message) => message.index),
      skippedMessageIndexes: duplicateMessageIndexes,
      duplicateMessageIndexes,
      excludedInternalCount: conversation.stats.excludedInternalMessages,
      contextSignalCount: conversation.stats.contextSignalMessages,
      rulesFired,
      warnings
    }
  };
}

function extractSatisfactionSignals(
  cleanMessages: CanonicalMessage[],
  rulesFired: Record<string, number>
): SatisfactionSignal[] {
  const signals: SatisfactionSignal[] = [];

  for (let i = 0; i < cleanMessages.length; i += 1) {
    const assistantMessage = cleanMessages[i];
    if (assistantMessage?.role !== "assistant") {
      continue;
    }

    const nextUser = cleanMessages
      .slice(i + 1)
      .find((message) => message.role === "user");

    if (!nextUser) {
      signals.push({
        id: createItemId("sat", signals.length + 1),
        assistantMessageIndex: assistantMessage.index,
        userReactionMessageIndex: null,
        status: "continuing_without_clear_feedback",
        rationale: "No following user reaction was found.",
        evidenceMessageIndexes: [assistantMessage.index],
        confidence: 0.3,
        rulesMatched: []
      });
      continue;
    }

    const prepared = prepareText(nextUser.text);
    const matched = SATISFACTION_RULES.filter((rule) =>
      rule.regex.test(prepared.text)
    );
    for (const rule of matched) {
      incrementRule(rulesFired, rule.id);
    }

    const primary = matched[0];
    const continuingOnly =
      !primary && CONTINUING_PATTERN.test(prepared.text)
        ? "continuing_without_clear_feedback"
        : null;
    const status = (primary?.subtype ?? continuingOnly ?? "continuing_without_clear_feedback") as SatisfactionStatus;
    const secondaryStatuses = matched
      .slice(1)
      .map((rule) => rule.subtype as SatisfactionStatus);

    signals.push({
      id: createItemId("sat", signals.length + 1),
      assistantMessageIndex: assistantMessage.index,
      userReactionMessageIndex: nextUser.index,
      status,
      secondaryStatuses:
        secondaryStatuses.length > 0 ? secondaryStatuses : undefined,
      rationale: satisfactionRationale(status),
      evidenceMessageIndexes: [assistantMessage.index, nextUser.index],
      confidence: primary
        ? adjustConfidence(primary.baseConfidence, {
            exampleLike: prepared.isExampleLike,
            questionLike: isQuestionLike(prepared.text)
          })
        : continuingOnly
          ? 0.55
          : 0.3,
      rulesMatched: primary ? matched.map((rule) => rule.id) : []
    });
  }

  return signals;
}

function buildTopicFlow(
  cleanMessages: CanonicalMessage[],
  preparedMessages: PreparedMessage[],
  rulesFired: Record<string, number>
): TopicFlowItem[] {
  const preparedByIndex = new Map(
    preparedMessages.map((prepared) => [prepared.message.index, prepared])
  );
  const topicStarts: Array<{
    message: CanonicalMessage;
    reason: TopicChangeReason;
    label: string;
  }> = [];

  for (const message of cleanMessages) {
    if (message.role !== "user") {
      continue;
    }

    const prepared = preparedByIndex.get(message.index) ?? {
      message,
      preparedText: prepareText(message.text).text,
      matchedRules: []
    };
    const isFirstUser = topicStarts.length === 0;
    const topicRule = prepared.matchedRules.find(
      (rule) => rule.kind === "topic_shift"
    );
    const reason = isFirstUser
      ? "new_user_question"
      : topicChangeReasonFor(prepared.preparedText, prepared.matchedRules);
    const shouldStartTopic =
      isFirstUser ||
      Boolean(topicRule) ||
      reason !== "continuation" ||
      isNewQuestion(prepared.preparedText);

    if (shouldStartTopic) {
      if (topicRule) {
        incrementRule(rulesFired, topicRule.id);
      }
      topicStarts.push({
        message,
        reason,
        label: topicLabelFor(message.text, prepared.preparedText, prepared.matchedRules)
      });
    }
  }

  if (topicStarts.length === 0 && cleanMessages[0]) {
    topicStarts.push({
      message: cleanMessages[0],
      reason: "continuation",
      label: titleFromMessage(cleanMessages[0].text)
    });
  }

  return topicStarts.map((topicStart, index) => {
    const nextStart = topicStarts[index + 1]?.message.index;
    const endMessageIndex =
      nextStart != null
        ? previousCleanIndex(cleanMessages, nextStart) ?? topicStart.message.index
        : cleanMessages[cleanMessages.length - 1]?.index ?? topicStart.message.index;

    return {
      id: createItemId("topic", index + 1),
      order: index + 1,
      label: topicStart.label,
      summary: truncateQuote(topicStart.message.text),
      startMessageIndex: topicStart.message.index,
      endMessageIndex,
      changeReason: topicStart.reason,
      evidenceMessageIndexes: [topicStart.message.index],
      confidence: index === 0 ? 0.78 : 0.74
    };
  });
}

function buildOverview(input: {
  conversation: CanonicalConversation;
  cleanMessages: CanonicalMessage[];
  userMessages: CanonicalMessage[];
  topicFlow: TopicFlowItem[];
  preferences: PreferenceSignal[];
  satisfactionSignals: SatisfactionSignal[];
  board: Board;
}): MockStructureResult["overview"] {
  const firstUser = input.userMessages[0];
  const lastUser = input.userMessages[input.userMessages.length - 1];
  const lastClean = input.cleanMessages[input.cleanMessages.length - 1];
  const lastUserHasUnansweredRequest =
    lastClean?.role === "user" &&
    input.board.actions.some((action) =>
      action.evidenceMessageIndexes.includes(lastClean.index)
    );
  const unresolvedOpenQuestionCount = input.board.openQuestions.filter(
    (question) => question.status === "open"
  ).length;
  const completedActionCount = countCompletedActions(
    input.board.actions,
    input.cleanMessages
  );

  const correctionCount = input.satisfactionSignals.filter(
    (signal) =>
      signal.status === "correction_requested" ||
      signal.secondaryStatuses?.includes("correction_requested")
  ).length;
  const satisfiedCount = input.satisfactionSignals.filter(
    (signal) => signal.status === "satisfied"
  ).length;
  const dissatisfiedCount = input.satisfactionSignals.filter(
    (signal) => signal.status === "dissatisfied"
  ).length;

  return {
    title:
      input.conversation.title ??
      input.topicFlow[0]?.label ??
      "구조화된 대화 분석",
    mainSubject: input.topicFlow[0]?.label ?? "Clean Conversation 기반 대화 분석",
    userCoreIntent: lastUser
      ? truncateQuote(lastUser.text)
      : firstUser
        ? truncateQuote(firstUser.text)
        : "사용자 의도를 파악할 메시지가 부족합니다.",
    currentStatus: lastUserHasUnansweredRequest
      ? "in_progress"
      : unresolvedOpenQuestionCount > 0
        ? "in_progress"
        : correctionCount > 0
        ? "partially_resolved"
        : input.cleanMessages.length > 0 && completedActionCount > 0
          ? "resolved"
          : input.cleanMessages.length > 0
            ? "partially_resolved"
            : "unclear",
    resolutionSummary: buildResolutionSummary({
      actions: input.board.actions.length,
      completedActions: completedActionCount,
      decisions: input.board.decisions.length,
      openQuestions: input.board.openQuestions.length,
      unresolvedOpenQuestions: unresolvedOpenQuestionCount,
      lastUserText: lastUser?.text
    }),
    keyDecisionIds: input.board.decisions.slice(0, 5).map((item) => item.id),
    openQuestionIds: input.board.openQuestions.slice(0, 5).map((item) => item.id),
    actionIds: input.board.actions.slice(0, 5).map((item) => item.id),
    dominantPreferenceIds: input.preferences.slice(0, 5).map((item) => item.id),
    satisfactionSummary: summarizeSatisfaction({
      satisfiedCount,
      correctionCount,
      dissatisfiedCount
    }),
    evidenceMessageIndexes: [
      ...new Set(
        [firstUser?.index, lastUser?.index].filter(
          (index): index is number => typeof index === "number"
        )
      )
    ],
    confidence: input.cleanMessages.length > 0 ? 0.72 : 0.2
  };
}

function aggregatePreferences(preferences: PreferenceSignal[]): PreferenceSignal[] {
  const byKey = new Map<string, PreferenceSignal>();

  for (const preference of preferences) {
    const key = preferenceClusterKey(preference);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, preference);
      continue;
    }

    existing.reinforced = true;
    existing.evidenceMessageIndexes = [
      ...new Set([
        ...existing.evidenceMessageIndexes,
        ...preference.evidenceMessageIndexes
      ])
    ];
    existing.confidence = Math.min(0.98, existing.confidence + 0.08);
    existing.rulesMatched = [
      ...new Set([...existing.rulesMatched, ...preference.rulesMatched])
    ];
  }

  return [...byKey.values()];
}

function prioritizeDecisions(decisions: DecisionItem[]): DecisionItem[] {
  const byEvidence = new Map<string, DecisionItem>();

  for (const decision of decisions) {
    const key = decision.evidenceMessageIndexes.join(",");
    const existing = byEvidence.get(key);
    if (!existing || decisionPriority(decision) > decisionPriority(existing)) {
      byEvidence.set(key, {
        ...decision,
        confidence: Math.max(decision.confidence, existing?.confidence ?? 0),
        rulesMatched: [
          ...new Set([...(existing?.rulesMatched ?? []), ...decision.rulesMatched])
        ]
      });
    }
  }

  return [...byEvidence.values()].map((decision, index) => ({
    ...decision,
    id: createItemId("dec", index + 1)
  }));
}

function resolveOpenQuestions(
  openQuestions: OpenQuestionItem[],
  decisions: DecisionItem[]
): OpenQuestionItem[] {
  return openQuestions.map((question) => {
    const laterDecision = decisions.find(
      (decision) =>
        decision.evidenceMessageIndexes[0] > question.evidenceMessageIndexes[0] &&
        hasSharedTopic(question.description, decision.description)
    );

    if (!laterDecision) {
      return question;
    }

    return {
      ...question,
      status: "resolved",
      resolvedByDecisionId: laterDecision.id,
      confidence: clampConfidence(question.confidence + 0.05)
    };
  });
}

function dedupeActions(actions: ActionItem[]): ActionItem[] {
  const byEvidence = new Map<string, ActionItem>();

  for (const action of actions) {
    const key = action.evidenceMessageIndexes.join(",");
    const existing = byEvidence.get(key);
    if (!existing || actionPriority(action) > actionPriority(existing)) {
      byEvidence.set(key, {
        ...action,
        confidence: Math.max(action.confidence, existing?.confidence ?? 0),
        rulesMatched: [
          ...new Set([...(existing?.rulesMatched ?? []), ...action.rulesMatched])
        ]
      });
    }
  }

  return [...byEvidence.values()].map((action, index) => ({
    ...action,
    id: createItemId("act", index + 1)
  }));
}

function prepareText(text: string): {
  text: string;
  hadCodeBlock: boolean;
  isExampleLike: boolean;
} {
  const hadCodeBlock = /```[\s\S]*?```/.test(text);
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ");
  const withoutQuotes = withoutCode.replace(/^>\s+.*$/gm, " ");
  const normalized = normalizeText(withoutQuotes.replace(/https?:\/\/\S+/g, " "));

  return {
    text: normalized,
    hadCodeBlock,
    isExampleLike: /(예:|예시|example|for example)/i.test(text)
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function adjustConfidence(
  baseConfidence: number,
  input: { exampleLike: boolean; questionLike: boolean }
): number {
  let confidence = baseConfidence;

  if (input.questionLike) {
    confidence -= 0.1;
  }
  if (input.exampleLike) {
    confidence = Math.min(confidence - 0.2, 0.35);
  }

  return clampConfidence(confidence);
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function isQuestionLike(text: string): boolean {
  return /(\?|뭐야|무엇|어떻게|왜|가능할까|어때|should|how|why|what)/i.test(
    text
  );
}

function findDuplicateMessageIndexes(messages: CanonicalMessage[]): number[] {
  const duplicateIndexes: number[] = [];

  for (let i = 1; i < messages.length; i += 1) {
    const previous = messages[i - 1];
    const current = messages[i];
    if (!previous || !current || previous.role !== current.role) {
      continue;
    }

    if (normalizeText(previous.text) === normalizeText(current.text)) {
      duplicateIndexes.push(current.index);
    }
  }

  return duplicateIndexes;
}

function preferenceCategoryFor(
  subtype: string
): PreferenceSignal["category"] {
  if (subtype.startsWith("length")) {
    return "length";
  }
  if (subtype === "language") {
    return "language_expression";
  }
  if (subtype === "depth") {
    return "specificity_depth";
  }
  if (subtype === "format" || subtype === "tone" || subtype === "avoidance") {
    return subtype;
  }
  return "reinforced";
}

function preferenceLabelFor(subtype: string): string {
  switch (subtype) {
    case "length_concise":
      return "concise";
    case "length_detailed":
      return "detailed";
    case "language":
      return "language_expression";
    case "depth":
      return "implementation_ready_depth";
    default:
      return subtype;
  }
}

function decisionStatusFor(subtype: string): DecisionItem["status"] {
  if (subtype === "excluded") {
    return "excluded";
  }
  if (subtype === "deferred") {
    return "deferred";
  }
  return "confirmed";
}

function topicChangeReasonFor(
  text: string,
  matchedRules: RuleDefinition[]
): TopicChangeReason {
  if (matchedRules.some((rule) => rule.id === "action.user_request")) {
    if (/(\.md|markdown|파일|문서|download|export)/i.test(text)) {
      return "artifact_requested";
    }
  }
  if (/(파일|\.md|markdown|문서)/i.test(text)) {
    return "artifact_requested";
  }
  if (/(구현|개발|codex|implementation)/i.test(text)) {
    return "implementation_phase_started";
  }
  if (/(다시|수정|바꿔|재정리)/i.test(text)) {
    return "correction_or_revision";
  }
  if (/(추후|빼|제외|후순위)/i.test(text)) {
    return "scope_changed";
  }
  if (/(톤|짧게|자세히|구체적|형식|표로|json|schema)/i.test(text)) {
    return "condition_changed";
  }
  if (/(기획|기술|개발|사용자|관점)/i.test(text)) {
    return "perspective_changed";
  }
  return "continuation";
}

function topicLabelFor(
  originalText: string,
  preparedText: string,
  matchedRules: RuleDefinition[]
): string {
  const entity = TOPIC_ENTITY_PATTERNS.find((pattern) =>
    pattern.regex.test(preparedText)
  )?.label;
  const actionLabel = topicActionLabelFor(preparedText, matchedRules);

  if (entity && actionLabel) {
    return `${entity} ${actionLabel}`;
  }
  if (entity) {
    return entity;
  }
  if (actionLabel) {
    return actionLabel;
  }
  return titleFromMessage(originalText);
}

function topicActionLabelFor(
  text: string,
  matchedRules: RuleDefinition[]
): string | null {
  if (/(설명|무슨 뜻|why|how|explain)/i.test(text)) {
    return "설명";
  }
  if (/(비교|compare)/i.test(text)) {
    return "비교";
  }
  if (/(분석|analy)/i.test(text)) {
    return "분석";
  }
  if (/(구현|개발|implementation)/i.test(text)) {
    return "구현";
  }
  if (/(문서|파일|\.md|markdown|작성|write|create|make)/i.test(text)) {
    return "문서화";
  }
  if (/(수정|다시|바꿔|재정리|fix|revise|rewrite)/i.test(text)) {
    return "수정";
  }
  if (matchedRules.some((rule) => rule.kind === "decision")) {
    return "결정";
  }
  if (matchedRules.some((rule) => rule.kind === "open_question")) {
    return "검토";
  }
  return null;
}

function previousCleanIndex(
  cleanMessages: CanonicalMessage[],
  nextStartIndex: number
): number | null {
  const previous = [...cleanMessages]
    .reverse()
    .find((message) => message.index < nextStartIndex);
  return previous?.index ?? null;
}

function isNewQuestion(text: string): boolean {
  return /(\?|무엇|뭐야|왜|어떻게|가능할까|어때|정해야|선택해야|which|whether|should we)/i.test(
    text
  );
}

function preferenceClusterKey(preference: PreferenceSignal): string {
  if (preference.category === "avoidance") {
    return `${preference.category}:${avoidanceSubject(preference.description)}`;
  }
  return `${preference.category}:${preference.normalizedLabel}`;
}

function avoidanceSubject(text: string): string {
  const normalized = normalizeText(text);
  if (/pdf/.test(normalized)) {
    return "pdf";
  }
  if (/rag|ask/.test(normalized)) {
    return "ask_or_rag";
  }
  if (/timeline|타임라인/.test(normalized)) {
    return "timeline";
  }
  if (/기술|개발/.test(normalized)) {
    return "technical_details";
  }
  return "general";
}

function decisionPriority(decision: DecisionItem): number {
  if (decision.status === "deferred") {
    return 3;
  }
  if (decision.status === "excluded") {
    return 2;
  }
  return 1;
}

function actionPriority(action: ActionItem): number {
  if (action.actionType === "user_requested") {
    return 2;
  }
  return 1;
}

function hasSharedTopic(left: string, right: string): boolean {
  const leftPrepared = prepareText(left).text;
  const rightPrepared = prepareText(right).text;

  return TOPIC_ENTITY_PATTERNS.some(
    (pattern) => pattern.regex.test(leftPrepared) && pattern.regex.test(rightPrepared)
  );
}

function satisfactionRationale(status: SatisfactionStatus): string {
  switch (status) {
    case "satisfied":
      return "The next user message contains a positive acceptance signal.";
    case "partially_satisfied":
      return "The next user message accepts direction but asks for changes.";
    case "dissatisfied":
      return "The next user message contains a negative reaction.";
    case "correction_requested":
      return "The next user message asks for revision or correction.";
    case "clarification_requested":
      return "The next user message asks for explanation or clarification.";
    case "continuing_without_clear_feedback":
      return "The next user message continues without clear feedback.";
  }
}

function summarizeSatisfaction(input: {
  satisfiedCount: number;
  correctionCount: number;
  dissatisfiedCount: number;
}): string {
  if (input.dissatisfiedCount > 0) {
    return "사용자는 일부 답변에 불만족했고 수정 또는 재설명을 요구했다.";
  }
  if (input.satisfiedCount > 0 && input.correctionCount > 0) {
    return "사용자는 답변을 수용하면서도 지속적으로 구체화와 수정을 요청했다.";
  }
  if (input.satisfiedCount > 0) {
    return "사용자는 여러 답변을 긍정적으로 수용했다.";
  }
  return "명시적 만족도 신호가 부족해 보수적으로 판단했다.";
}

function countCompletedActions(
  actions: ActionItem[],
  cleanMessages: CanonicalMessage[]
): number {
  return actions.filter((action) => {
    const actionIndex = action.evidenceMessageIndexes[0];
    return cleanMessages.some(
      (message) => message.role === "assistant" && message.index > actionIndex
    );
  }).length;
}

function buildResolutionSummary(input: {
  actions: number;
  completedActions: number;
  decisions: number;
  openQuestions: number;
  unresolvedOpenQuestions: number;
  lastUserText?: string;
}): string {
  if (input.lastUserText) {
    return `최근 요청은 “${truncateQuote(input.lastUserText, 90)}”이며, decision ${input.decisions}개, action ${input.actions}개 중 completed ${input.completedActions}개, open question ${input.openQuestions}개 중 unresolved ${input.unresolvedOpenQuestions}개를 추출했다.`;
  }
  return "분석할 clean conversation 메시지가 부족하다.";
}

function titleFromMessage(text: string): string {
  return truncateQuote(text, 42).replace(/[.。]$/, "");
}

function truncateQuote(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function incrementRule(rulesFired: Record<string, number>, ruleId: string): void {
  rulesFired[ruleId] = (rulesFired[ruleId] ?? 0) + 1;
}

function createItemId(prefix: string, order: number): string {
  return `${prefix}_${String(order).padStart(3, "0")}`;
}

function dedupeByEvidence<T extends { evidenceMessageIndexes: number[] }>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.evidenceMessageIndexes.join(",");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
