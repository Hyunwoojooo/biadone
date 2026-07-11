import type {
  CanonicalConversation,
  CanonicalMessage
} from "../types/conversation";
import type {
  EvidenceEvaluatedItem,
  EvidenceMatch,
  EvidenceVerificationDiagnostics,
  EvidenceVerificationIssue,
  EvidenceVerificationReason,
  EvidenceVerificationStatus,
  EvidenceVerifierMetadata,
  SemanticItem,
  SemanticItemType
} from "../types/semantic";

export const EVIDENCE_VERIFIER_VERSION = "5B-1.0";

export type EvidenceVerificationResult = {
  evidenceVerifier: EvidenceVerifierMetadata;
  verifiedItems: EvidenceEvaluatedItem[];
  reviewQueue: EvidenceEvaluatedItem[];
  rejectedItems: EvidenceEvaluatedItem[];
  evidenceDiagnostics: EvidenceVerificationDiagnostics;
};

const USER_BACKED_TYPES = new Set<SemanticItemType>([
  "intent",
  "preference",
  "content_constraint",
  "problem_signal",
  "change_event"
]);

const MAX_QUOTE_CHARS = 280;

export function verifyLlmEvidence(
  conversation: CanonicalConversation,
  items: SemanticItem[]
): EvidenceVerificationResult {
  const messageByIndex = new Map(
    conversation.messages.map((message) => [message.index, message])
  );
  const cleanMessages = conversation.messages
    .filter(isAnalyzableCleanMessage)
    .sort((left, right) => left.index - right.index);
  const verifiedItems: EvidenceEvaluatedItem[] = [];
  const reviewQueue: EvidenceEvaluatedItem[] = [];
  const rejectedItems: EvidenceEvaluatedItem[] = [];

  for (const item of items) {
    const evaluated = evaluateItem(item, messageByIndex, cleanMessages);
    switch (evaluated.evidenceVerification.status) {
      case "verified":
        verifiedItems.push(evaluated);
        break;
      case "review_required":
        reviewQueue.push(evaluated);
        break;
      case "rejected":
        rejectedItems.push(evaluated);
        break;
    }
  }

  return {
    evidenceVerifier: {
      name: "EvidenceVerifier",
      version: EVIDENCE_VERIFIER_VERSION,
      mode: "rule_based"
    },
    verifiedItems,
    reviewQueue,
    rejectedItems,
    evidenceDiagnostics: buildDiagnostics(
      items.length,
      verifiedItems,
      reviewQueue,
      rejectedItems
    )
  };
}

function evaluateItem(
  item: SemanticItem,
  messageByIndex: Map<number, CanonicalMessage>,
  cleanMessages: CanonicalMessage[]
): EvidenceEvaluatedItem {
  const issues: EvidenceVerificationIssue[] = [];
  const evidenceIndexes = [...new Set(item.evidenceMessageIndexes)];

  if (evidenceIndexes.length === 0) {
    issues.push(
      issue(
        "MISSING_EVIDENCE",
        "The semantic item has no evidence message index.",
        []
      )
    );
    return evaluatedItem(item, "rejected", [], issues);
  }

  const validMessages: CanonicalMessage[] = [];
  for (const index of evidenceIndexes) {
    const message = messageByIndex.get(index);
    if (!message) {
      issues.push(
        issue(
          "OUT_OF_RANGE_MESSAGE_INDEX",
          `Evidence message #${index} does not exist in the conversation.`,
          [index]
        )
      );
      continue;
    }
    if (!isAnalyzableCleanMessage(message)) {
      issues.push(
        issue(
          "NON_CLEAN_EVIDENCE",
          `Evidence message #${index} is not an analyzable Clean Conversation message.`,
          [index]
        )
      );
      continue;
    }
    validMessages.push(message);
  }

  const triggerPhrase = item.triggerPhrase?.trim() ?? "";
  const directMatches = triggerPhrase
    ? validMessages.flatMap((message) => {
        const match = directQuoteMatch(message, triggerPhrase);
        return match ? [match] : [];
      })
    : [];

  if (
    issues.some(
      (itemIssue) =>
        itemIssue.code === "OUT_OF_RANGE_MESSAGE_INDEX" ||
        itemIssue.code === "NON_CLEAN_EVIDENCE"
    )
  ) {
    return evaluatedItem(
      item,
      "rejected",
      markMatches(directMatches, "unsupported", "rejected"),
      issues
    );
  }

  if (!triggerPhrase) {
    issues.push(
      issue(
        "MISSING_TRIGGER_PHRASE",
        "No direct trigger phrase was supplied for span verification.",
        evidenceIndexes
      )
    );
  } else if (directMatches.length === 0) {
    issues.push(
      issue(
        "TRIGGER_PHRASE_NOT_FOUND",
        "The trigger phrase was not found in the cited messages.",
        evidenceIndexes
      )
    );
  }

  const policyResult = evaluateTypePolicy(
    item,
    validMessages,
    directMatches,
    cleanMessages
  );
  issues.push(...policyResult.issues);

  let status = policyResult.status;
  if (status === "verified" && issues.length > 0) {
    status = "review_required";
  }
  if (status !== "rejected" && item.confidence < 0.75) {
    issues.push(
      issue(
        "LOW_CONFIDENCE",
        "The semantic item confidence is below the 0.75 verification threshold.",
        evidenceIndexes
      )
    );
    status = "review_required";
  }

  return evaluatedItem(item, status, policyResult.matches, issues);
}

function evaluateTypePolicy(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[],
  cleanMessages: CanonicalMessage[]
): {
  status: EvidenceVerificationStatus;
  matches: EvidenceMatch[];
  issues: EvidenceVerificationIssue[];
} {
  if (item.type === "satisfaction") {
    return evaluateSatisfaction(
      item,
      validMessages,
      directMatches,
      cleanMessages
    );
  }
  if (item.type === "decision") {
    return evaluateDecision(item, validMessages, directMatches, cleanMessages);
  }
  if (item.type === "open_question") {
    return evaluateOpenQuestion(item, validMessages, directMatches);
  }
  if (item.type === "action") {
    return evaluateAction(item, validMessages, directMatches);
  }
  if (USER_BACKED_TYPES.has(item.type)) {
    return evaluateUserBackedItem(item, validMessages, directMatches);
  }

  if (directMatches.length === 0) {
    return inferredResult(item.evidenceMessageIndexes, directMatches);
  }
  return {
    status: "verified",
    matches: markMatches(directMatches, "explicit", "verified"),
    issues: []
  };
}

function evaluateUserBackedItem(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[]
) {
  const userMatches = matchesForRole(directMatches, validMessages, "user");
  if (userMatches.length > 0) {
    return {
      status: "verified" as const,
      matches: markMatches(userMatches, "explicit", "verified"),
      issues: []
    };
  }

  if (validMessages.some((message) => message.role === "user")) {
    return inferredResult(item.evidenceMessageIndexes, directMatches);
  }

  return {
    status: "rejected" as const,
    matches: markMatches(directMatches, "unsupported", "rejected"),
    issues: [
      issue(
        "ASSISTANT_ONLY_USER_CLAIM",
        `${item.type} requires direct user evidence, but only assistant evidence was cited.`,
        item.evidenceMessageIndexes
      )
    ]
  };
}

function evaluateDecision(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[],
  cleanMessages: CanonicalMessage[]
) {
  const acceptedPair = findAcceptedContextPair(validMessages, cleanMessages);
  if (
    acceptedPair &&
    item.status !== "candidate" &&
    item.status !== "suggested"
  ) {
    return {
      status: "verified" as const,
      matches: acceptedContextMatches(acceptedPair, directMatches),
      issues: []
    };
  }

  const userMatches = matchesForRole(directMatches, validMessages, "user");
  if (userMatches.length > 0) {
    const triggerText = userMatches.map((match) => match.quote).join(" ");
    if (
      item.status !== "candidate" &&
      isExplicitDecision(triggerText, item.status)
    ) {
      return {
        status: "verified" as const,
        matches: markMatches(userMatches, "explicit", "verified"),
        issues: []
      };
    }
    return {
      status: "review_required" as const,
      matches: markMatches(userMatches, "inferred", "review_required"),
      issues: [
        issue(
          "DECISION_NOT_EXPLICIT",
          "The cited user phrase does not explicitly confirm the extracted decision state.",
          item.evidenceMessageIndexes
        )
      ]
    };
  }

  if (validMessages.some((message) => message.role === "user")) {
    return inferredResult(item.evidenceMessageIndexes, directMatches, {
      code: "DECISION_NOT_EXPLICIT",
      message:
        "User context exists, but no direct user decision phrase was matched."
    });
  }

  return {
    status: "rejected" as const,
    matches: markMatches(directMatches, "unsupported", "rejected"),
    issues: [
      issue(
        "ASSISTANT_ONLY_USER_CLAIM",
        "A user decision cannot be verified from assistant-only evidence.",
        item.evidenceMessageIndexes
      )
    ]
  };
}

function evaluateSatisfaction(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[],
  cleanMessages: CanonicalMessage[]
) {
  const pair = findAssistantUserPair(validMessages, cleanMessages);
  if (pair && reactionSupportsStatus(pair.user.text, item.status)) {
    return {
      status: "verified" as const,
      matches: acceptedContextMatches(pair, directMatches),
      issues: []
    };
  }

  const hasUserEvidence = validMessages.some(
    (message) => message.role === "user"
  );
  return {
    status: hasUserEvidence
      ? ("review_required" as const)
      : ("rejected" as const),
    matches: markMatches(
      directMatches,
      hasUserEvidence ? "inferred" : "unsupported",
      hasUserEvidence ? "review_required" : "rejected"
    ),
    issues: [
      issue(
        "SATISFACTION_PAIR_REQUIRED",
        "Satisfaction requires a cited assistant final answer and its next user reaction matching the extracted status.",
        item.evidenceMessageIndexes
      )
    ]
  };
}

function evaluateOpenQuestion(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[]
) {
  const userMatches = matchesForRole(directMatches, validMessages, "user");
  if (
    userMatches.length > 0 &&
    userMatches.some((match) => isQuestionLike(match.quote))
  ) {
    return {
      status: "verified" as const,
      matches: markMatches(userMatches, "explicit", "verified"),
      issues: []
    };
  }
  if (!validMessages.some((message) => message.role === "user")) {
    return {
      status: "rejected" as const,
      matches: markMatches(directMatches, "unsupported", "rejected"),
      issues: [
        issue(
          "ASSISTANT_ONLY_USER_CLAIM",
          "A user open question cannot be verified from assistant-only evidence.",
          item.evidenceMessageIndexes
        )
      ]
    };
  }
  return {
    status: "review_required" as const,
    matches: markMatches(userMatches, "inferred", "review_required"),
    issues: [
      issue(
        "OPEN_QUESTION_NOT_EXPLICIT",
        "The cited user phrase is not explicitly question-like.",
        item.evidenceMessageIndexes
      )
    ]
  };
}

function evaluateAction(
  item: SemanticItem,
  validMessages: CanonicalMessage[],
  directMatches: EvidenceMatch[]
) {
  const userMatches = matchesForRole(directMatches, validMessages, "user");
  if (
    userMatches.length > 0 &&
    userMatches.some((match) => isActionLike(match.quote))
  ) {
    return {
      status: "verified" as const,
      matches: markMatches(userMatches, "explicit", "verified"),
      issues: []
    };
  }

  const assistantMatches = matchesForRole(
    directMatches,
    validMessages,
    "assistant"
  );
  const completedByAssistant = assistantMatches.some((match) => {
    const message = validMessages.find(
      (candidate) => candidate.index === match.messageIndex
    );
    return message ? isAssistantCompletion(item, message, match.quote) : false;
  });
  if (completedByAssistant) {
    return {
      status: "verified" as const,
      matches: markMatches(assistantMatches, "explicit", "verified"),
      issues: []
    };
  }

  return {
    status: "review_required" as const,
    matches: markMatches(directMatches, "inferred", "review_required"),
    issues: [
      issue(
        "ACTION_NOT_EXPLICIT",
        "The cited phrase is not an explicit user request or assistant completion.",
        item.evidenceMessageIndexes
      )
    ]
  };
}

function directQuoteMatch(
  message: CanonicalMessage,
  triggerPhrase: string
): EvidenceMatch | null {
  const startChar = findPhraseStart(message.text, triggerPhrase);
  if (startChar < 0) return null;
  const quote = message.text.slice(
    startChar,
    startChar + Math.min(triggerPhrase.length, MAX_QUOTE_CHARS)
  );
  return {
    messageId: message.id,
    messageIndex: message.index,
    quote,
    startChar,
    endChar: startChar + quote.length,
    supportType: "explicit",
    verificationStatus: "verified"
  };
}

function findPhraseStart(text: string, phrase: string): number {
  const exact = text.indexOf(phrase);
  if (exact >= 0) return exact;

  const lowerText = text.toLocaleLowerCase();
  const lowerPhrase = phrase.toLocaleLowerCase();
  if (
    lowerText.length !== text.length ||
    lowerPhrase.length !== phrase.length
  ) {
    return -1;
  }
  return lowerText.indexOf(lowerPhrase);
}

function matchesForRole(
  matches: EvidenceMatch[],
  messages: CanonicalMessage[],
  role: "user" | "assistant"
): EvidenceMatch[] {
  const indexes = new Set(
    messages
      .filter((message) => message.role === role)
      .map((message) => message.index)
  );
  return matches.filter((match) => indexes.has(match.messageIndex));
}

function markMatches(
  matches: EvidenceMatch[],
  supportType: EvidenceMatch["supportType"],
  verificationStatus: EvidenceMatch["verificationStatus"]
): EvidenceMatch[] {
  return matches.map((match) => ({
    ...match,
    supportType,
    verificationStatus
  }));
}

function findAcceptedContextPair(
  validMessages: CanonicalMessage[],
  cleanMessages: CanonicalMessage[]
) {
  const pair = findAssistantUserPair(validMessages, cleanMessages);
  return pair && isAcceptanceReaction(pair.user.text) ? pair : null;
}

function findAssistantUserPair(
  validMessages: CanonicalMessage[],
  cleanMessages: CanonicalMessage[]
): { assistant: CanonicalMessage; user: CanonicalMessage } | null {
  const validIndexes = new Set(validMessages.map((message) => message.index));

  for (const assistant of validMessages) {
    if (assistant.role !== "assistant" || !isFinalAssistantMessage(assistant)) {
      continue;
    }
    const assistantPosition = cleanMessages.findIndex(
      (message) => message.index === assistant.index
    );
    if (assistantPosition < 0) continue;
    const nextUserOffset = cleanMessages
      .slice(assistantPosition + 1)
      .findIndex((message) => message.role === "user");
    if (nextUserOffset < 0) continue;
    const userPosition = assistantPosition + nextUserOffset + 1;
    const user = cleanMessages[userPosition];
    if (!user || !validIndexes.has(user.index)) continue;

    const laterAssistantExists = cleanMessages
      .slice(assistantPosition + 1, userPosition)
      .some((message) => message.role === "assistant");
    if (!laterAssistantExists) return { assistant, user };
  }

  return null;
}

function acceptedContextMatches(
  pair: { assistant: CanonicalMessage; user: CanonicalMessage },
  directMatches: EvidenceMatch[]
): EvidenceMatch[] {
  const matches: EvidenceMatch[] = [];
  for (const message of [pair.assistant, pair.user]) {
    const direct = directMatches.find(
      (match) => match.messageIndex === message.index
    );
    matches.push(
      direct ??
        (message.role === "user"
          ? reactionQuoteMatch(message)
          : boundedMessageMatch(message))
    );
  }
  return markMatches(matches, "accepted_context", "verified");
}

function reactionQuoteMatch(message: CanonicalMessage): EvidenceMatch {
  const match = message.text.match(
    /(^|[\s,.!])(좋아|좋습니다|맞아|맞습니다|오케이|괜찮아|완료|그걸로|그렇게 하자|응|그래|ok(?:ay)?|yes|sounds good)(?=[\s,.!]|$)/i
  );
  if (!match || match.index == null) return boundedMessageMatch(message);
  const leading = match[1] ?? "";
  const quote = match[2] ?? match[0];
  return matchFromSpan(message, match.index + leading.length, quote);
}

function boundedMessageMatch(message: CanonicalMessage): EvidenceMatch {
  const firstNonWhitespace = message.text.search(/\S/);
  const startChar = firstNonWhitespace >= 0 ? firstNonWhitespace : 0;
  const remaining = message.text.slice(startChar);
  const firstLine = remaining.split("\n")[0] ?? remaining;
  const quote = firstLine.slice(0, MAX_QUOTE_CHARS);
  return matchFromSpan(message, startChar, quote);
}

function matchFromSpan(
  message: CanonicalMessage,
  startChar: number,
  quote: string
): EvidenceMatch {
  return {
    messageId: message.id,
    messageIndex: message.index,
    quote,
    startChar,
    endChar: startChar + quote.length,
    supportType: "explicit",
    verificationStatus: "verified"
  };
}

function isExplicitDecision(text: string, status: string | null): boolean {
  if (isQuestionLike(text)) return false;
  const normalizedStatus = (status ?? "").toLowerCase();
  if (normalizedStatus === "deferred") {
    return /(보류|나중|추후|후순위|미루|not now|later|defer|postpone)/i.test(
      text
    );
  }
  if (normalizedStatus === "excluded" || normalizedStatus === "rejected") {
    return /(빼자?|제외|안\s*할|하지\s*말|필요\s*없|drop|exclude|remove|won't|will not)/i.test(
      text
    );
  }
  if (normalizedStatus === "candidate" || normalizedStatus === "suggested") {
    return false;
  }
  return /(이걸로|그걸로|하자|가자|확정|채택|진행하자|잡자|선택하자|사용하자|적용하자|결정|let'?s|go with|decided|confirmed|adopt|proceed)/i.test(
    text
  );
}

function isQuestionLike(text: string): boolean {
  const trimmed = text.trim();
  return (
    /[?？]/.test(trimmed) ||
    /^(왜|어떻게|무엇|뭐|무슨|어떤|어디|언제|누가|가능한가|궁금|why|how|what|which|where|when|who|can |could |should )/i.test(
      trimmed
    )
  );
}

function isAcceptanceReaction(text: string): boolean {
  if (isQuestionLike(text)) return false;
  return /(^|[\s,.!])(좋아|좋습니다|맞아|맞습니다|오케이|괜찮아|완료|그걸로|그렇게 하자|응|그래|ok(?:ay)?|yes|sounds good)([\s,.!]|$)/i.test(
    text.trim()
  );
}

function reactionSupportsStatus(text: string, status: string | null): boolean {
  const normalizedStatus = (status ?? "").toLowerCase();
  if (normalizedStatus === "satisfied") return isAcceptanceReaction(text);
  if (normalizedStatus === "partially_satisfied") {
    return (
      /(좋은데|맞는데|괜찮은데|방향은\s*맞|good but|right but)/i.test(text) ||
      (isAcceptanceReaction(text) &&
        /(근데|다만|하지만|but|however)/i.test(text))
    );
  }
  if (normalizedStatus === "dissatisfied") {
    return /(아니|아닌데|틀렸|별로|원하는 게 아니|잘못 이해|그게 아니|wrong|incorrect|not what i want)/i.test(
      text
    );
  }
  if (normalizedStatus === "correction_requested") {
    return /(다시|수정|고쳐|바꿔|빼고|넣고|재정리|revise|fix|change|redo|rewrite)/i.test(
      text
    );
  }
  if (normalizedStatus === "clarification_requested") {
    return isQuestionLike(text);
  }
  return false;
}

function isActionLike(text: string): boolean {
  return /(해줘|해주세요|만들어|작성해|정리해|분석해|검토해|확인해|비교해|제안해|진행해|시작하자|해보자|해야\s*(?:해|한다|돼)|구현하자|테스트하자|create|make|write|analy[sz]e|review|check|compare|implement|test|please)/i.test(
    text
  );
}

function isAssistantCompletion(
  item: SemanticItem,
  message: CanonicalMessage,
  quote: string
): boolean {
  if (!isFinalAssistantMessage(message)) return false;
  const normalizedStatus = (item.status ?? "").toLowerCase();
  return (
    normalizedStatus === "completed" ||
    normalizedStatus === "done" ||
    message.metadata.assistantMessageType === "final_answer_with_artifact" ||
    /(완료|생성했|작성했|만들었|저장했|반영했|completed|created|written|saved|implemented)/i.test(
      quote
    )
  );
}

function isFinalAssistantMessage(message: CanonicalMessage): boolean {
  const type = message.metadata.assistantMessageType;
  return (
    message.role === "assistant" &&
    (type == null ||
      type === "final_answer" ||
      type === "final_answer_with_artifact")
  );
}

function inferredResult(
  messageIndexes: number[],
  matches: EvidenceMatch[],
  override?: {
    code: EvidenceVerificationReason;
    message: string;
  }
) {
  return {
    status: "review_required" as const,
    matches: markMatches(matches, "inferred", "review_required"),
    issues: [
      issue(
        override?.code ?? "INFERRED_SUPPORT",
        override?.message ??
          "The cited messages exist, but direct semantic support could not be verified.",
        messageIndexes
      )
    ]
  };
}

function evaluatedItem(
  item: SemanticItem,
  status: EvidenceVerificationStatus,
  matches: EvidenceMatch[],
  issues: EvidenceVerificationIssue[]
): EvidenceEvaluatedItem {
  return {
    ...item,
    evidenceVerification: {
      status,
      matches: dedupeMatches(matches),
      issues: dedupeIssues(issues)
    }
  };
}

function issue(
  code: EvidenceVerificationReason,
  message: string,
  messageIndexes: number[]
): EvidenceVerificationIssue {
  return { code, message, messageIndexes: [...new Set(messageIndexes)] };
}

function dedupeMatches(matches: EvidenceMatch[]): EvidenceMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.messageIndex}:${match.startChar}:${match.endChar}:${match.supportType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeIssues(
  issues: EvidenceVerificationIssue[]
): EvidenceVerificationIssue[] {
  const seen = new Set<string>();
  return issues.filter((itemIssue) => {
    const key = `${itemIssue.code}:${itemIssue.messageIndexes.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDiagnostics(
  candidateCount: number,
  verifiedItems: EvidenceEvaluatedItem[],
  reviewQueue: EvidenceEvaluatedItem[],
  rejectedItems: EvidenceEvaluatedItem[]
): EvidenceVerificationDiagnostics {
  const evaluatedItems = [...verifiedItems, ...reviewQueue, ...rejectedItems];
  const matches = evaluatedItems.flatMap(
    (item) => item.evidenceVerification.matches
  );
  const reasonCounts = evaluatedItems
    .flatMap((item) => item.evidenceVerification.issues)
    .reduce<Partial<Record<EvidenceVerificationReason, number>>>(
      (counts, itemIssue) => {
        counts[itemIssue.code] = (counts[itemIssue.code] ?? 0) + 1;
        return counts;
      },
      {}
    );

  return {
    candidateCount,
    verifiedItemCount: verifiedItems.length,
    reviewItemCount: reviewQueue.length,
    rejectedItemCount: rejectedItems.length,
    evidenceMatchCount: matches.length,
    verifiedMatchCount: matches.filter(
      (match) => match.verificationStatus === "verified"
    ).length,
    reviewMatchCount: matches.filter(
      (match) => match.verificationStatus === "review_required"
    ).length,
    rejectedMatchCount: matches.filter(
      (match) => match.verificationStatus === "rejected"
    ).length,
    reasonCounts
  };
}

function isAnalyzableCleanMessage(message: CanonicalMessage): boolean {
  return (
    message.metadata.messageCategory === "clean_conversation" &&
    message.metadata.semanticAnalyzable !== false &&
    (message.role === "user" || message.role === "assistant")
  );
}
