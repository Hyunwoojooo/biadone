import type {
  CanonicalConversation,
  CanonicalMessage
} from "../types/conversation";
import type { TopicFlowItem } from "../types/structures";

export type LlmShadowSegmentationOptions = {
  maxCharsPerSegment: number;
  maxMessagesPerSegment: number;
  maxSegments: number;
};

export type LlmShadowSegment = {
  id: string;
  order: number;
  label: string;
  topicIds: string[];
  messages: CanonicalMessage[];
  contextMessages: CanonicalMessage[];
  inputChars: number;
};

export const DEFAULT_LLM_SEGMENTATION_OPTIONS: LlmShadowSegmentationOptions = {
  maxCharsPerSegment: 28_000,
  maxMessagesPerSegment: 40,
  maxSegments: 12
};

type TopicUnit = {
  topicIds: string[];
  topicLabels: string[];
  messages: CanonicalMessage[];
};

export function createLlmShadowSegments(
  conversation: CanonicalConversation,
  topicFlow: TopicFlowItem[] = [],
  overrides: Partial<LlmShadowSegmentationOptions> = {}
): LlmShadowSegment[] {
  const cleanMessages = conversation.messages.filter(
    (message) =>
      message.metadata.messageCategory === "clean_conversation" &&
      message.metadata.semanticAnalyzable !== false
  );
  if (cleanMessages.length === 0) return [];

  const configured = normalizeOptions(overrides);
  const totalChars = cleanMessages.reduce(
    (sum, message) => sum + message.text.length,
    0
  );
  const maxCharsPerSegment = Math.max(
    configured.maxCharsPerSegment,
    Math.ceil(totalChars / configured.maxSegments)
  );
  const maxMessagesPerSegment = Math.max(
    configured.maxMessagesPerSegment,
    Math.ceil(cleanMessages.length / configured.maxSegments)
  );

  const units = splitOversizedUnits(
    buildTopicUnits(cleanMessages, topicFlow),
    maxCharsPerSegment,
    maxMessagesPerSegment
  );
  const packed = packUnits(units, maxCharsPerSegment, maxMessagesPerSegment);
  const limited = mergeOverflowSegments(packed, configured.maxSegments);

  return limited.map((unit, index) => {
    const firstMessage = unit.messages[0];
    const firstPosition = cleanMessages.findIndex(
      (message) => message.id === firstMessage?.id
    );
    const previousMessage =
      firstPosition > 0 ? cleanMessages[firstPosition - 1] : undefined;
    const contextMessages =
      previousMessage?.role === "assistant" ? [previousMessage] : [];
    const topicLabels = unique(unit.topicLabels);

    return {
      id: `llm_seg_${String(index + 1).padStart(3, "0")}`,
      order: index + 1,
      label: buildSegmentLabel(topicLabels, index + 1),
      topicIds: unique(unit.topicIds),
      messages: unit.messages,
      contextMessages,
      inputChars: [...contextMessages, ...unit.messages].reduce(
        (sum, message) => sum + message.text.length,
        0
      )
    };
  });
}

function buildTopicUnits(
  messages: CanonicalMessage[],
  topicFlow: TopicFlowItem[]
): TopicUnit[] {
  const sortedTopics = [...topicFlow].sort(
    (left, right) => left.startMessageIndex - right.startMessageIndex
  );
  const units: TopicUnit[] = [];

  for (const message of messages) {
    const topic = sortedTopics.find(
      (item) =>
        message.index >= item.startMessageIndex &&
        message.index <= item.endMessageIndex
    );
    const topicId = topic?.id ?? "unscoped";
    const topicLabel = topic?.label ?? "";
    const current = units.at(-1);

    if (current && current.topicIds[0] === topicId) {
      current.messages.push(message);
      continue;
    }

    units.push({
      topicIds: [topicId],
      topicLabels: topicLabel ? [topicLabel] : [],
      messages: [message]
    });
  }

  return units;
}

function splitOversizedUnits(
  units: TopicUnit[],
  maxChars: number,
  maxMessages: number
): TopicUnit[] {
  const result: TopicUnit[] = [];

  for (const unit of units) {
    let current: TopicUnit = cloneUnitWithoutMessages(unit);
    let currentChars = 0;

    for (const message of unit.messages) {
      const exceedsBudget =
        current.messages.length > 0 &&
        (currentChars + message.text.length > maxChars ||
          current.messages.length >= maxMessages);
      if (exceedsBudget) {
        result.push(current);
        current = cloneUnitWithoutMessages(unit);
        currentChars = 0;
      }
      current.messages.push(message);
      currentChars += message.text.length;
    }

    if (current.messages.length > 0) result.push(current);
  }

  return result;
}

function packUnits(
  units: TopicUnit[],
  maxChars: number,
  maxMessages: number
): TopicUnit[] {
  const packed: TopicUnit[] = [];
  let current: TopicUnit | null = null;
  let currentChars = 0;

  for (const unit of units) {
    const unitChars = unit.messages.reduce(
      (sum, message) => sum + message.text.length,
      0
    );
    const exceedsBudget =
      current !== null &&
      (currentChars + unitChars > maxChars ||
        current.messages.length + unit.messages.length > maxMessages);

    if (exceedsBudget && current) {
      packed.push(current);
      current = null;
      currentChars = 0;
    }

    if (!current) current = { topicIds: [], topicLabels: [], messages: [] };
    current.topicIds.push(...unit.topicIds);
    current.topicLabels.push(...unit.topicLabels);
    current.messages.push(...unit.messages);
    currentChars += unitChars;
  }

  if (current?.messages.length) packed.push(current);
  return packed;
}

function mergeOverflowSegments(
  units: TopicUnit[],
  maxSegments: number
): TopicUnit[] {
  if (units.length <= maxSegments) return units;
  const kept = units.slice(0, maxSegments);
  const tail = kept[maxSegments - 1];
  if (!tail) return units;

  for (const overflow of units.slice(maxSegments)) {
    tail.topicIds.push(...overflow.topicIds);
    tail.topicLabels.push(...overflow.topicLabels);
    tail.messages.push(...overflow.messages);
  }
  return kept;
}

function normalizeOptions(
  overrides: Partial<LlmShadowSegmentationOptions>
): LlmShadowSegmentationOptions {
  return {
    maxCharsPerSegment: positiveInteger(
      overrides.maxCharsPerSegment,
      DEFAULT_LLM_SEGMENTATION_OPTIONS.maxCharsPerSegment
    ),
    maxMessagesPerSegment: positiveInteger(
      overrides.maxMessagesPerSegment,
      DEFAULT_LLM_SEGMENTATION_OPTIONS.maxMessagesPerSegment
    ),
    maxSegments: positiveInteger(
      overrides.maxSegments,
      DEFAULT_LLM_SEGMENTATION_OPTIONS.maxSegments
    )
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function cloneUnitWithoutMessages(unit: TopicUnit): TopicUnit {
  return {
    topicIds: [...unit.topicIds],
    topicLabels: [...unit.topicLabels],
    messages: []
  };
}

function buildSegmentLabel(topicLabels: string[], order: number): string {
  if (topicLabels.length === 0) return `대화 구간 ${order}`;
  if (topicLabels.length === 1) return topicLabels[0] ?? `대화 구간 ${order}`;
  return `${topicLabels[0]} -> ${topicLabels.at(-1)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
