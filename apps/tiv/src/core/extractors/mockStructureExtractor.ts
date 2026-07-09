import type {
  CanonicalConversation,
  CanonicalMessage,
  ContextSignalType
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
  OverviewSourceCandidates,
  PreferenceSignal,
  ReviewRequiredReason,
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

type ContextSignalSummary = {
  refs: string[];
  externalResearch: boolean;
  sourceBacked: boolean;
  signalTypes: ContextSignalType[];
  citationCount: number;
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
    regex: /(\.md|md파일|markdown|노션에 넣|json|schema|표로|리스트|불렛|파일로|문서로|코드블록|table|list|file)/i,
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
    regex: /(이걸로 하자|방향으로 가자|그걸로 하자|그렇게 하자|그렇게 해보자|확정|채택|결정|고정|진행하자|메인으로 잡자|기술로 잡자|잡고|링크로만|웹으로.*가자|실제 웹으로.*개발|let's go with|decide|confirmed|adopt|use this|proceed)/i,
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
    regex: /(모르겠|고민|어떻게 .*까|가능할까|맞을까|좋을까|정해야|선택해야|편하려나|어때|의미가 없을 것 같은데|궁금|되나|되어있나|연동 되어있나|not sure|wonder|how should|should we|which|whether)/i,
    baseConfidence: 0.72
  },
  {
    id: "action.user_request",
    kind: "action",
    subtype: "user_request",
    regex: /(정리해줘|만들어줘|작성해줘|비교해줘|분석해줘|검수해줘|제안해줘|제안해봐|뽑아줘|채워넣어|진행해봐|확인해봐|내용 만들어봐|프롬프트 만들어줘|설계 진행해봐|파일로|문서로|만들자|make|create|write|compare|analyze|suggest|generate|export)/i,
    baseConfidence: 0.88
  },
  {
    id: "action.team_next",
    kind: "action",
    subtype: "team_next",
    regex: /(우리가 해야 할 일|다음에 해야 할 것|팀은 .*해야|개발해야 한다|구현해야 한다|테스트해야 한다|이후 구현은|다음 작업은|need to|team should)/i,
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
    id: "satisfaction.task_failed",
    kind: "satisfaction",
    subtype: "task_failed",
    regex: /(왜 안보|안 보이|안 돼|못만드냐|뭐하냐|반영이 안|작동 안|실패|안 됨)/i,
    baseConfidence: 0.88
  },
  {
    id: "satisfaction.direction_changed",
    kind: "satisfaction",
    subtype: "direction_changed",
    regex: /(그냥 웹으로|실제 웹으로|이렇게 만드는 것보다|전환하는게|나을 수도|방향을 바꾸자)/i,
    baseConfidence: 0.82
  },
  {
    id: "satisfaction.alternative_proposed",
    kind: "satisfaction",
    subtype: "alternative_proposed",
    regex: /(이 방식은 어때|이 구조로 .* 가능한가|대신 .* 하면|다른 방식|이렇게 하면)/i,
    baseConfidence: 0.78
  },
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
  { label: "링크 기반 입력", regex: /링크|link/i },
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
  const contextSignals = conversation.messages.filter(
    (message) => message.metadata.messageCategory === "context_signal"
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
    const semanticRules = prepared.isExampleLike
      ? matchedRules.filter(
          (rule) => rule.kind === "action" || rule.kind === "topic_shift"
        )
      : isAcceptanceOnly(prepared.text)
      ? []
      : matchedRules;
    preparedMessages.push({
      message,
      preparedText: prepared.text,
      matchedRules: semanticRules
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
    const hasActionRequest = semanticRules.some((rule) => rule.kind === "action");

    for (const rule of semanticRules) {
      const ruleQuote = quoteForRule(message.text, rule);
      if (rule.kind === "preference") {
        preferences.push({
          id: createItemId("pref", preferences.length + 1),
          category: preferenceCategoryFor(rule.subtype),
          polarity: rule.subtype === "avoidance" ? "negative" : "positive",
          normalizedLabel: preferenceLabelFor(rule.subtype),
          description: ruleQuote,
          triggerPhrase: ruleQuote,
          reinforced: false,
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id]
        });
      }

      if (rule.kind === "decision") {
        const status = decisionStatusFor(rule.subtype);
        const source = "explicit_user" as const;
        const confidence = confidenceFor(rule);
        decisions.push({
          id: createItemId("dec", decisions.length + 1),
          title: titleFromMessage(ruleQuote),
          description: ruleQuote,
          triggerPhrase: ruleQuote,
          status,
          source,
          evidenceMessageIndexes: [message.index],
          confidence,
          rulesMatched: [rule.id],
          ...reviewMetadataForDecision({
            status,
            source,
            confidence,
            evidenceMessageIndexes: [message.index]
          })
        });
      }

      if (rule.kind === "open_question") {
        if (hasActionRequest && isImperativeActionText(ruleQuote)) {
          continue;
        }
        openQuestions.push({
          id: createItemId("oq", openQuestions.length + 1),
          question: titleFromMessage(ruleQuote),
          description: ruleQuote,
          triggerPhrase: ruleQuote,
          status: "open",
          evidenceMessageIndexes: [message.index],
          confidence: confidenceFor(rule),
          rulesMatched: [rule.id],
          ...reviewMetadataForItem({
            confidence: confidenceFor(rule),
            evidenceMessageIndexes: [message.index]
          })
        });
      }

      if (rule.kind === "action") {
        const actionType = rule.subtype === "team_next" ? "team_next" : "user_requested";
        const confidence = confidenceFor(rule);
        actions.push({
          id: createItemId("act", actions.length + 1),
          title: titleFromMessage(ruleQuote),
          description: ruleQuote,
          triggerPhrase: ruleQuote,
          actionType,
          assignee: actionType === "team_next" ? "team" : "assistant",
          status: "requested",
          evidenceMessageIndexes: [message.index],
          confidence,
          rulesMatched: [rule.id],
          ...reviewMetadataForAction({
            actionType,
            confidence,
            evidenceMessageIndexes: [message.index]
          })
        });
      }
    }

    if (semanticRules.length > 0) {
      evidence.push({
        id: createItemId("ev", evidence.length + 1),
        evidenceMessageIndexes: [message.index],
        quote,
        sourceType: "clean_conversation",
        evidenceStrength: "explicit_user_statement"
      });
    }
  }

  const assistantCandidateDecisions = extractAssistantCandidateDecisions(
    cleanMessages,
    decisions,
    rulesFired
  );
  const acceptedAssistantDecisions = extractAcceptedAssistantSuggestionDecisions(
    cleanMessages,
    assistantCandidateDecisions,
    rulesFired
  );
  decisions.push(...assistantCandidateDecisions, ...acceptedAssistantDecisions);
  evidence.push(
    ...[...assistantCandidateDecisions, ...acceptedAssistantDecisions].map((decision, index): EvidenceItem => ({
      id: createItemId("evcand", index + 1),
      evidenceMessageIndexes: decision.evidenceMessageIndexes,
      quote: decision.triggerPhrase,
      sourceType: "clean_conversation",
      evidenceStrength: "explicit_assistant_statement"
    }))
  );

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
  const topicFlow = enrichTopicFlowWithContextSignals(
    buildTopicFlow(cleanMessages, preparedMessages, duplicateMessageIndexes, rulesFired),
    contextSignals
  );
  evidence.push(
    ...contextSignals.map((signal, index): EvidenceItem => ({
      id: createItemId("evctx", index + 1),
      evidenceMessageIndexes: [],
      contextSignalRefs: [contextSignalRef(signal)],
      quote: truncateQuote(signal.text),
      sourceType: "context_signal",
      evidenceStrength: "contextual_support"
    }))
  );
  const board: Board = {
    decisions: prioritizedDecisions,
    openQuestions: resolveOpenQuestions(
      dedupeByEvidence(openQuestions),
      prioritizedDecisions,
      cleanMessages
    ),
    actions: dedupeActions(actions)
  };
  const overviewSourceCandidates = buildOverviewSourceCandidates({
    userMessages,
    topicFlow,
    board
  });
  const overview = buildOverview({
    conversation,
    cleanMessages,
    userMessages,
    topicFlow,
    preferences: aggregatedPreferences,
    satisfactionSignals,
    board,
    overviewSourceCandidates
  });

  return {
    extractor: {
      name: "MockStructureExtractor",
      version: EXTRACTOR_VERSION,
      mode: "rule_based"
    },
    overview,
    overviewSourceCandidates,
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
      contextSignalTypeCounts: countContextSignalTypes(contextSignals),
      sourceBackedTopicCount: topicFlow.filter(
        (topic) => topic.contextSummary?.sourceBacked
      ).length,
      rulesFired,
      warnings: [
        ...warnings,
        ...contextSignals.map((signal): DiagnosticWarning => ({
          code: "CONTEXT_SIGNAL_ONLY_DOWNGRADED",
          message:
            "Context signal was used only as topic/answer quality metadata, not semantic evidence.",
          messageIndexes: [signal.index]
        }))
      ]
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

    const nextCleanMessage = cleanMessages
      .slice(i + 1)
      .find((message) => message.role === "user" || message.role === "assistant");
    if (nextCleanMessage?.role === "assistant") {
      continue;
    }

    const nextUser = nextCleanMessage?.role === "user" ? nextCleanMessage : undefined;

    if (!nextUser) {
      const confidence = 0.3;
      signals.push({
        id: createItemId("sat", signals.length + 1),
        assistantMessageIndex: assistantMessage.index,
        userReactionMessageIndex: null,
        status: "continuing_without_clear_feedback",
        rationale: "No following user reaction was found.",
        evidenceMessageIndexes: [assistantMessage.index],
        confidence,
        rulesMatched: [],
        ...reviewMetadataForSatisfaction({
          confidence,
          evidenceMessageIndexes: [assistantMessage.index],
          secondaryStatuses: []
        })
      });
      continue;
    }

    const prepared = prepareText(nextUser.text);
    const rawMatched = SATISFACTION_RULES.filter((rule) =>
      rule.regex.test(prepared.text)
    );
    const matched = isTopicShiftOnlyReaction(prepared.text, rawMatched)
      ? []
      : rawMatched;
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
    const confidence = primary
      ? adjustConfidence(primary.baseConfidence, {
          exampleLike: prepared.isExampleLike,
          questionLike: isQuestionLike(prepared.text)
        })
      : continuingOnly
        ? 0.55
        : 0.3;

    signals.push({
      id: createItemId("sat", signals.length + 1),
      assistantMessageIndex: assistantMessage.index,
      userReactionMessageIndex: nextUser.index,
      status,
      secondaryStatuses:
        secondaryStatuses.length > 0 ? secondaryStatuses : undefined,
      rationale: satisfactionRationale(status),
      evidenceMessageIndexes: [assistantMessage.index, nextUser.index],
      confidence,
      rulesMatched: primary ? matched.map((rule) => rule.id) : [],
      ...reviewMetadataForSatisfaction({
        confidence,
        evidenceMessageIndexes: [assistantMessage.index, nextUser.index],
        secondaryStatuses
      })
    });
  }

  return signals;
}

function extractAssistantCandidateDecisions(
  cleanMessages: CanonicalMessage[],
  explicitUserDecisions: DecisionItem[],
  rulesFired: Record<string, number>
): DecisionItem[] {
  const candidates: DecisionItem[] = [];

  for (const message of cleanMessages) {
    if (message.role !== "assistant") {
      continue;
    }

    const prepared = prepareText(message.text);
    if (!isAssistantSuggestionText(prepared.text) || isAssistantArtifactOrSpecText(message.text)) {
      continue;
    }

    const decisionRules = USER_RULES.filter(
      (rule) => rule.kind === "decision" && rule.regex.test(prepared.text)
    );

    for (const rule of decisionRules) {
      const triggerPhrase = quoteForRule(message.text, rule);
      if (
        explicitUserDecisions.some(
          (decision) =>
            decision.status === decisionStatusFor(rule.subtype) &&
            hasSharedTopic(decision.description, triggerPhrase)
        )
      ) {
        continue;
      }

      incrementRule(rulesFired, "decision.candidate.assistant_suggestion");
      candidates.push({
        id: createItemId("dec_candidate", candidates.length + 1),
        title: titleFromMessage(triggerPhrase),
        description: triggerPhrase,
        triggerPhrase,
        status: "candidate",
        source: "assistant_suggestion",
        evidenceMessageIndexes: [message.index],
        confidence: 0.55,
        rulesMatched: [rule.id, "decision.candidate.assistant_suggestion"],
        ...reviewMetadataForDecision({
          status: "candidate",
          source: "assistant_suggestion",
          confidence: 0.55,
          evidenceMessageIndexes: [message.index]
        })
      });
    }
  }

  return candidates;
}

function extractAcceptedAssistantSuggestionDecisions(
  cleanMessages: CanonicalMessage[],
  candidateDecisions: DecisionItem[],
  rulesFired: Record<string, number>
): DecisionItem[] {
  const accepted: DecisionItem[] = [];

  for (const candidate of candidateDecisions) {
    const assistantIndex = candidate.evidenceMessageIndexes[0];
    const nextUser = cleanMessages.find(
      (message) => message.index > assistantIndex && message.role === "user"
    );

    if (!nextUser || !isAcceptanceOnly(prepareText(nextUser.text).text)) {
      continue;
    }

    incrementRule(rulesFired, "decision.accepted_assistant_suggestion");
    accepted.push({
      ...candidate,
      id: createItemId("dec_accepted", accepted.length + 1),
      status: "confirmed",
      source: "assistant_suggestion_accepted",
      evidenceMessageIndexes: [assistantIndex, nextUser.index],
      confidence: 0.85,
      rulesMatched: [
        ...candidate.rulesMatched,
        "decision.accepted_assistant_suggestion"
      ],
      ...reviewMetadataForDecision({
        status: "confirmed",
        source: "assistant_suggestion_accepted",
        confidence: 0.85,
        evidenceMessageIndexes: [assistantIndex, nextUser.index]
      })
    });
  }

  return accepted;
}

function buildTopicFlow(
  cleanMessages: CanonicalMessage[],
  preparedMessages: PreparedMessage[],
  duplicateMessageIndexes: number[],
  rulesFired: Record<string, number>
): TopicFlowItem[] {
  const preparedByIndex = new Map(
    preparedMessages.map((prepared) => [prepared.message.index, prepared])
  );
  const topicStarts: Array<{
    message: CanonicalMessage;
    reason: TopicChangeReason;
    label: string;
    mergedMessageIndexes: number[];
  }> = [];

  for (const message of cleanMessages) {
    if (message.role !== "user") {
      continue;
    }
    if (duplicateMessageIndexes.includes(message.index)) {
      const previousTopic = topicStarts[topicStarts.length - 1];
      if (previousTopic) {
        previousTopic.mergedMessageIndexes.push(message.index);
      }
      continue;
    }

    const prepared = preparedByIndex.get(message.index) ?? {
      message,
      preparedText: prepareText(message.text).text,
      matchedRules: []
    };
    if (isShortReactionOnly(prepared.preparedText)) {
      continue;
    }
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
      const label = topicLabelFor(
        message.text,
        prepared.preparedText,
        prepared.matchedRules
      );
      const previousTopic = topicStarts[topicStarts.length - 1];
      if (previousTopic?.label === label) {
        previousTopic.mergedMessageIndexes.push(message.index);
        continue;
      }
      topicStarts.push({
        message,
        reason,
        label,
        mergedMessageIndexes: []
      });
    }
  }

  if (topicStarts.length === 0 && cleanMessages[0]) {
    topicStarts.push({
      message: cleanMessages[0],
      reason: "continuation",
      label: titleFromMessage(cleanMessages[0].text),
      mergedMessageIndexes: []
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
      mergedMessageIndexes:
        topicStart.mergedMessageIndexes.length > 0
          ? topicStart.mergedMessageIndexes
          : undefined,
      confidence: index === 0 ? 0.78 : 0.74
    };
  });
}

function enrichTopicFlowWithContextSignals(
  topics: TopicFlowItem[],
  contextSignals: CanonicalMessage[]
): TopicFlowItem[] {
  if (contextSignals.length === 0) {
    return topics;
  }

  return topics.map((topic, index) => {
    const nextTopicStart = topics[index + 1]?.startMessageIndex;
    const matchingSignals = contextSignals.filter(
      (signal) =>
        signal.index >= topic.startMessageIndex &&
        (nextTopicStart == null
          ? signal.index <= topic.endMessageIndex
          : signal.index < nextTopicStart)
    );

    if (matchingSignals.length === 0) {
      return topic;
    }

    const summary = summarizeContextSignals(matchingSignals);

    return {
      ...topic,
      changeReason:
        topic.changeReason === "continuation" && summary.externalResearch
          ? "external_research_started"
          : topic.changeReason,
      contextSignalRefs: summary.refs,
      contextSummary: {
        externalResearch: summary.externalResearch,
        sourceBacked: summary.sourceBacked,
        signalCount: matchingSignals.length,
        signalTypes: summary.signalTypes,
        citationCount: summary.citationCount
      },
      confidence: summary.sourceBacked
        ? clampConfidence(topic.confidence + 0.03)
        : topic.confidence
    };
  });
}

function summarizeContextSignals(
  signals: CanonicalMessage[]
): ContextSignalSummary {
  const signalTypes = [
    ...new Set(
      signals
        .map((signal) => signal.metadata.contextSignalType)
        .filter((type): type is ContextSignalType => Boolean(type))
    )
  ];
  const citationCount = signals.filter(
    (signal) => signal.metadata.contextSignalType === "citation_or_ref"
  ).length;

  return {
    refs: signals.map((signal) => contextSignalRef(signal)),
    externalResearch: signalTypes.some((type) =>
      [
        "search_query",
        "opened_source",
        "clicked_source",
        "find_pattern",
        "search_result",
        "citation_or_ref"
      ].includes(type)
    ),
    sourceBacked: signalTypes.some((type) =>
      ["opened_source", "clicked_source", "search_result", "citation_or_ref"].includes(
        type
      )
    ),
    signalTypes,
    citationCount
  };
}

function buildOverviewSourceCandidates(input: {
  userMessages: CanonicalMessage[];
  topicFlow: TopicFlowItem[];
  board: Board;
}): OverviewSourceCandidates {
  const firstUserIntent = input.userMessages.find(
    (message) => !isMetaRequestMessage(message.text)
  );
  const latestMetaRequest = [...input.userMessages]
    .reverse()
    .find((message) => isMetaRequestMessage(message.text));
  const excludedMetaMessageIndexes = input.userMessages
    .filter((message) => isMetaRequestMessage(message.text))
    .map((message) => message.index);
  const confirmedDecisionIds = input.board.decisions
    .filter(
      (decision) =>
        decision.status === "confirmed" &&
        decision.includeInKeyDecisionIds &&
        decision.confidence >= 0.75
    )
    .slice(0, 5)
    .map((decision) => decision.id);
  const topicCounts = countTopicLabels(input.topicFlow);
  const recurringTopicLabels = [...topicCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([label, count]) => ({
      label,
      count,
      weight: 0.2
    }))
    .sort((a, b) => b.count - a.count);
  const latestNonMetaTopic = [...input.topicFlow]
    .reverse()
    .find((topic) => !isMetaTopicLabel(topic.label));

  return {
    firstUserIntent: firstUserIntent
      ? {
          messageIndex: firstUserIntent.index,
          preview: truncateQuote(firstUserIntent.text),
          weight: 0.35
        }
      : undefined,
    confirmedDecisionIds,
    recurringTopicLabels,
    latestNonMetaTopicId: latestNonMetaTopic?.id,
    latestMetaRequest: latestMetaRequest
      ? {
          messageIndex: latestMetaRequest.index,
          preview: truncateQuote(latestMetaRequest.text),
          weight: 0.05
        }
      : undefined,
    excludedMetaMessageIndexes
  };
}

function countTopicLabels(topicFlow: TopicFlowItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const topic of topicFlow) {
    if (isMetaTopicLabel(topic.label)) {
      continue;
    }
    counts.set(topic.label, (counts.get(topic.label) ?? 0) + 1);
  }
  return counts;
}

function buildOverview(input: {
  conversation: CanonicalConversation;
  cleanMessages: CanonicalMessage[];
  userMessages: CanonicalMessage[];
  topicFlow: TopicFlowItem[];
  preferences: PreferenceSignal[];
  satisfactionSignals: SatisfactionSignal[];
  board: Board;
  overviewSourceCandidates: OverviewSourceCandidates;
}): MockStructureResult["overview"] {
  const firstUser = input.userMessages.find(
    (message) => !isMetaRequestMessage(message.text)
  ) ?? input.userMessages[0];
  const lastUser = input.userMessages[input.userMessages.length - 1];
  const lastClean = input.cleanMessages[input.cleanMessages.length - 1];
  const latestNonMetaTopic = input.topicFlow.find(
    (topic) => topic.id === input.overviewSourceCandidates.latestNonMetaTopicId
  );
  const primaryDecision = input.board.decisions.find(
    (decision) => decision.id === input.overviewSourceCandidates.confirmedDecisionIds[0]
  );
  const primaryRecurringTopic =
    input.overviewSourceCandidates.recurringTopicLabels[0]?.label;
  const lastUserHasUnansweredRequest =
    lastClean?.role === "user" &&
    !isMetaRequestMessage(lastClean.text) &&
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
      !signal.reviewRequired &&
      (signal.status === "correction_requested" ||
        signal.secondaryStatuses?.includes("correction_requested"))
  ).length;
  const satisfiedCount = input.satisfactionSignals.filter(
    (signal) => !signal.reviewRequired && signal.status === "satisfied"
  ).length;
  const dissatisfiedCount = input.satisfactionSignals.filter(
    (signal) => !signal.reviewRequired && signal.status === "dissatisfied"
  ).length;
  const mainSubject = buildWeightedMainSubject({
    primaryDecision,
    primaryRecurringTopic,
    firstUser,
    latestNonMetaTopic
  });
  const userCoreIntent = buildWeightedUserCoreIntent({
    firstUser,
    primaryDecision,
    primaryRecurringTopic,
    latestNonMetaTopic
  });

  return {
    title:
      input.conversation.title ??
      input.topicFlow[0]?.label ??
      "구조화된 대화 분석",
    mainSubject,
    userCoreIntent,
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
      mainSubject,
      latestMetaRequest: input.overviewSourceCandidates.latestMetaRequest?.preview
    }),
    keyDecisionIds: input.board.decisions
      .filter((item) => item.includeInKeyDecisionIds)
      .slice(0, 5)
      .map((item) => item.id),
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
    const key = [
      decision.evidenceMessageIndexes.join(","),
      decision.status,
      normalizeText(decision.description)
    ].join(":");
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
  decisions: DecisionItem[],
  cleanMessages: CanonicalMessage[]
): OpenQuestionItem[] {
  return openQuestions.map((question) => {
    const laterDecision = decisions.find(
      (decision) =>
        decision.evidenceMessageIndexes[0] > question.evidenceMessageIndexes[0] &&
        hasSharedTopic(question.description, decision.description)
    );

    if (laterDecision) {
      if (laterDecision.status === "deferred" || laterDecision.status === "excluded") {
        const confidence = clampConfidence(question.confidence + 0.05);
        return {
          ...question,
          status: "superseded_by_scope_change",
          resolvedBy: {
            type: "superseded_by_scope_change",
            decisionId: laterDecision.id
          },
          resolvedByDecisionId: laterDecision.id,
          confidence,
          ...reviewMetadataForItem({
            confidence,
            evidenceMessageIndexes: question.evidenceMessageIndexes
          })
        };
      }

      const confidence = clampConfidence(question.confidence + 0.05);
      return {
        ...question,
        status: "resolved_by_user_decision",
        resolvedBy: {
          type: "user_decision",
          decisionId: laterDecision.id
        },
        resolvedByDecisionId: laterDecision.id,
        confidence,
        ...reviewMetadataForItem({
          confidence,
          evidenceMessageIndexes: question.evidenceMessageIndexes
        })
      };
    }

    const assistantAnswer = cleanMessages.find(
      (message) =>
        message.index > question.evidenceMessageIndexes[0] &&
        message.role === "assistant"
    );

    if (!assistantAnswer) {
      return question;
    }

    const confidence = clampConfidence(question.confidence + 0.03);
    return {
      ...question,
      status: "answered",
      resolvedBy: {
        type: "assistant_answer",
        messageIndex: assistantAnswer.index
      },
      confidence,
      ...reviewMetadataForItem({
        confidence,
        evidenceMessageIndexes: question.evidenceMessageIndexes
      })
    };
  });
}

function dedupeActions(actions: ActionItem[]): ActionItem[] {
  const byEvidence = new Map<string, ActionItem>();

  for (const action of actions) {
    const key = [
      action.evidenceMessageIndexes.join(","),
      action.actionType,
      normalizeText(action.description)
    ].join(":");
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

function reviewMetadataForDecision(input: {
  status: DecisionItem["status"];
  source: DecisionItem["source"];
  confidence: number;
  evidenceMessageIndexes: number[];
}): Pick<
  DecisionItem,
  | "reviewRequired"
  | "reviewRequiredReason"
  | "includeInMainBoard"
  | "includeInKeyDecisionIds"
> {
  const reason = reviewReasonFromCoreSignals({
    confidence: input.confidence,
    evidenceMessageIndexes: input.evidenceMessageIndexes,
    assistantSuggestion: input.source === "assistant_suggestion",
    candidateDecision: input.status === "candidate"
  });
  const includeInMainBoard =
    !reason &&
    input.confidence >= 0.75 &&
    input.status !== "candidate" &&
    input.source !== "assistant_suggestion";

  return {
    reviewRequired: Boolean(reason),
    reviewRequiredReason: reason,
    includeInMainBoard,
    includeInKeyDecisionIds: includeInMainBoard
  };
}

function reviewMetadataForAction(input: {
  actionType: ActionItem["actionType"];
  confidence: number;
  evidenceMessageIndexes: number[];
}): Pick<
  ActionItem,
  "reviewRequired" | "reviewRequiredReason" | "includeInMainBoard"
> {
  const reason = reviewReasonFromCoreSignals({
    confidence: input.confidence,
    evidenceMessageIndexes: input.evidenceMessageIndexes
  });
  const includeInMainBoard =
    !reason && input.confidence >= 0.75 && input.actionType === "user_requested";

  return {
    reviewRequired: Boolean(reason),
    reviewRequiredReason: reason,
    includeInMainBoard
  };
}

function reviewMetadataForItem(input: {
  confidence: number;
  evidenceMessageIndexes: number[];
}): Pick<
  OpenQuestionItem,
  "reviewRequired" | "reviewRequiredReason" | "includeInMainBoard"
> {
  const reason = reviewReasonFromCoreSignals(input);

  return {
    reviewRequired: Boolean(reason),
    reviewRequiredReason: reason,
    includeInMainBoard: !reason && input.confidence >= 0.7
  };
}

function reviewMetadataForSatisfaction(input: {
  confidence: number;
  evidenceMessageIndexes: number[];
  secondaryStatuses: SatisfactionStatus[];
}): Pick<
  SatisfactionSignal,
  "reviewRequired" | "reviewRequiredReason" | "includeInMainBoard"
> {
  const reason =
    input.secondaryStatuses.length >= 2
      ? "multi_status_satisfaction"
      : reviewReasonFromCoreSignals(input);

  return {
    reviewRequired: Boolean(reason),
    reviewRequiredReason: reason,
    includeInMainBoard: !reason && input.confidence >= 0.7
  };
}

function reviewReasonFromCoreSignals(input: {
  confidence: number;
  evidenceMessageIndexes: number[];
  assistantSuggestion?: boolean;
  candidateDecision?: boolean;
}): ReviewRequiredReason | undefined {
  if (input.evidenceMessageIndexes.length === 0) {
    return "weak_evidence";
  }
  if (input.candidateDecision) {
    return "candidate_decision";
  }
  if (input.assistantSuggestion) {
    return "assistant_suggestion";
  }
  if (input.confidence <= 0.35) {
    return "very_low_confidence";
  }
  if (input.confidence < 0.7) {
    return "low_confidence";
  }
  return undefined;
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

function isTopicShiftOnlyReaction(
  text: string,
  matchedRules: RuleDefinition[]
): boolean {
  if (!CONTINUING_PATTERN.test(text)) {
    return false;
  }

  const hasExplicitFeedback = matchedRules.some((rule) =>
    [
      "satisfaction.satisfied",
      "satisfaction.partial",
      "satisfaction.dissatisfied"
    ].includes(rule.id)
  );
  if (hasExplicitFeedback) {
    return false;
  }

  return /(그렇다면|그럼|이제|다음으로|next|then|now)/i.test(text);
}

function quoteForRule(text: string, rule: RuleDefinition): string {
  const fragment = splitMeaningfulFragments(text).find((candidate) =>
    rule.regex.test(prepareText(candidate).text)
  );

  if (fragment) {
    return truncateQuote(cleanTriggerQuote(fragment), 90);
  }

  return truncateQuote(cleanTriggerQuote(text), 90);
}

function splitMeaningfulFragments(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?。！？])\s+|[,，;；]|\s+(?:그리고|또|다만|하지만|근데)\s+/)
    .map((fragment) => cleanTriggerQuote(fragment))
    .filter((fragment) => fragment.length > 0);
}

function cleanTriggerQuote(text: string): string {
  return text
    .replace(/^[\s"'“”‘’`*_>-]+/, "")
    .replace(/[\s"'“”‘’`*_>.\-。!?！？]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isImperativeActionText(text: string): boolean {
  return /(정리해줘|만들어줘|작성해줘|비교해줘|분석해줘|검수해줘|제안해줘|제안해봐|뽑아줘|채워넣어|진행해봐|확인해봐|내용 만들어봐|프롬프트 만들어줘|설계 진행해봐|파일로|문서로|만들자|해줘|create|write|compare|analyze|suggest|generate|export)/i.test(
    prepareText(text).text
  );
}

function isAssistantSuggestionText(text: string): boolean {
  return /(제안|추천|권장|좋겠습니다|좋습니다|할 수 있습니다|하는 게 좋|하는 것이 좋|suggest|recommend|should|could)/i.test(
    text
  );
}

function isAssistantArtifactOrSpecText(text: string): boolean {
  return (
    text.length > 700 ||
    /```[\s\S]*?```/.test(text) ||
    /\|.*\|/.test(text) ||
    /(type\s+\w+\s*=|interface\s+\w+|decisionStatus\s*:|status:\s*["']confirmed|결정은 가능하면 user message|보류된 내용|예시|example)/i.test(
      text
    )
  );
}

function isMetaRequestMessage(text: string): boolean {
  const prepared = prepareText(text);
  return (
    prepared.isExampleLike ||
    isRuleSpecMessage(text) ||
    /(프롬프트.*만들어줘|커밋하자|push 하자|문서에.*적|문서.*정리|gpt.*물어볼|gpt.*검수|검수 파일|audit|수정사항|작업 진행|세분화|설명해봐|정리해봐|commit|push)/i.test(
      prepared.text
    )
  );
}

function isRuleSpecMessage(text: string): boolean {
  return (
    text.length > 1200 ||
    /(rule spec|schema 제안|구현 우선순위|완료 기준|priority\s*\d|type\s+\w+\s*=|```ts|```json)/i.test(
      text
    )
  );
}

function isMetaTopicLabel(label: string): boolean {
  return /(gpt 검수|parser 정규화 개선|mockextractor 규칙 설계|문서화|구현 지시서|review queue|overview|audit|커밋|commit)/i.test(
    label
  );
}

function isAcceptanceOnly(text: string): boolean {
  return /^(좋아|맞아|응|오케이|ok|okay|ㅇㅋ|그걸로 하자|그렇게 하자|그래 그렇게 해보자|좋아 그렇게|맞아 그렇게|오케이 그렇게|좋아 그걸로 하자)[.!。！\s]*$/i.test(
    text
  );
}

function isShortReactionOnly(text: string): boolean {
  return /^(좋아|좋습니다|맞아|맞습니다|응|오케이|ok|okay|ㅇㅋ|완료|확인|알겠어|이해했어|그렇군|good|great|works|done)[.!。！\s]*$/i.test(
    text
  );
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
  const specificLabel = specificTopicLabelFor(preparedText);
  if (specificLabel) {
    return specificLabel;
  }

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

function specificTopicLabelFor(text: string): string | null {
  if (
    /codex/i.test(text) &&
    /(구현 지시서|implementation plan|implementation spec|지시서)/i.test(text)
  ) {
    return "Codex 구현 지시서 작성";
  }
  if (/(parser|파서|정규화|normalizer|normalization)/i.test(text)) {
    if (/(개선|수정|고쳐|보정|hardening|fix)/i.test(text)) {
      return "Parser 정규화 개선";
    }
  }
  if (/(gpt audit|gpt 검수|검수 결과)/i.test(text)) {
    if (/(반영|수정|개선|피드백)/i.test(text)) {
      return "GPT 검수 결과 반영";
    }
  }
  if (/(공유 링크|share link|chatgpt share)/i.test(text)) {
    if (/(파싱|parser|parse|가져오|복원|분리)/i.test(text)) {
      return "공유 링크 파싱 방식 검토";
    }
    if (/(분석|analy)/i.test(text)) {
      return "공유 링크 분석";
    }
  }
  if (/(기획안|proposal|prd)/i.test(text)) {
    if (/(다시|수정|재작성|rewrite|revise)/i.test(text)) {
      return "기획안 재작성";
    }
    if (/(최종본|문서|파일|\.md|markdown)/i.test(text)) {
      return "기획안 문서화";
    }
  }
  if (/(mockextractor|mock extractor)/i.test(text)) {
    if (/(룰|규칙|rule)/i.test(text)) {
      return "MockExtractor 규칙 설계";
    }
  }
  if (/(gpt audit|gpt 검수|검수 파일)/i.test(text)) {
    return "GPT 검수 파일 생성";
  }
  return null;
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

function countContextSignalTypes(
  contextSignals: CanonicalMessage[]
): Record<string, number> {
  return contextSignals.reduce<Record<string, number>>((counts, signal) => {
    const type = signal.metadata.contextSignalType ?? "unknown";
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
}

function contextSignalRef(signal: CanonicalMessage): string {
  return `${signal.metadata.contextSignalType ?? "context_signal"}:${signal.index}`;
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
    case "problem_reported":
      return "The next user message reports that the previous output did not work or was not visible.";
    case "task_failed":
      return "The next user message indicates the requested task failed.";
    case "direction_changed":
      return "The next user message changes the product or implementation direction.";
    case "alternative_proposed":
      return "The next user message proposes an alternative approach.";
    case "new_requirement_added":
      return "The next user message adds a new requirement.";
    case "meta_request":
      return "The next user message asks for meta-level handling or review.";
    case "topic_shift":
      return "The next user message shifts topic without clear satisfaction feedback.";
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

function buildWeightedMainSubject(input: {
  primaryDecision?: DecisionItem;
  primaryRecurringTopic?: string;
  firstUser?: CanonicalMessage;
  latestNonMetaTopic?: TopicFlowItem;
}): string {
  if (input.primaryDecision) {
    return `주요 결정: ${input.primaryDecision.title}`;
  }
  if (input.primaryRecurringTopic) {
    return input.primaryRecurringTopic;
  }
  if (input.latestNonMetaTopic) {
    return input.latestNonMetaTopic.label;
  }
  if (input.firstUser) {
    return truncateQuote(input.firstUser.text, 90);
  }
  return "Clean Conversation 기반 대화 분석";
}

function buildWeightedUserCoreIntent(input: {
  firstUser?: CanonicalMessage;
  primaryDecision?: DecisionItem;
  primaryRecurringTopic?: string;
  latestNonMetaTopic?: TopicFlowItem;
}): string {
  const parts = [
    input.firstUser ? `초기 의도: ${truncateQuote(input.firstUser.text, 80)}` : null,
    input.primaryDecision
      ? `확정 방향: ${input.primaryDecision.triggerPhrase ?? input.primaryDecision.title}`
      : null,
    input.primaryRecurringTopic ? `반복 논점: ${input.primaryRecurringTopic}` : null,
    input.latestNonMetaTopic ? `최근 주요 논점: ${input.latestNonMetaTopic.label}` : null
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return "사용자 의도를 파악할 메시지가 부족합니다.";
  }
  return parts.slice(0, 3).join(" / ");
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
  mainSubject: string;
  latestMetaRequest?: string;
}): string {
  const metaTail = input.latestMetaRequest
    ? ` 최근에는 “${truncateQuote(input.latestMetaRequest, 70)}” 같은 검수/문서화성 요청이 있었다.`
    : "";

  return `대화의 중심은 “${truncateQuote(input.mainSubject, 90)}”이며, decision ${input.decisions}개, action ${input.actions}개 중 completed ${input.completedActions}개, open question ${input.openQuestions}개 중 unresolved ${input.unresolvedOpenQuestions}개를 추출했다.${metaTail}`;
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
