import { describe, expect, it } from "vitest";

import type { CanonicalConversation } from "../../src/core/types/conversation";
import { mergeTaskLineage } from "../src/mergeTaskLineage";
import type {
  RawTaskCandidate,
  SuggestionEvidenceSourceContext,
} from "../src/types";
import { verifyTaskCandidates } from "../src/verifyCandidates";

function conversation(id: string, endedAt: string): CanonicalConversation {
  const text = "Prepare the comparison report.";
  return {
    id,
    source: {
      type: "chatgpt_share_link",
      originalUrl: `https://local.invalid/${id}`,
      normalizedUrl: `https://local.invalid/${id}`,
      shareId: id,
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "source-context-fixture.v1",
      fetchedAt: endedAt,
    },
    title: null,
    language: "en",
    importedAt: endedAt,
    messages: [
      {
        id: `${id}_message`,
        index: 1,
        role: "user",
        createdAt: endedAt,
        updatedAt: null,
        text,
        blocks: [{ type: "paragraph", text }],
        sourceRef: {
          type: "chatgpt_share_payload",
          messageId: `${id}_message`,
          messageIndex: 1,
          role: "user",
        },
        metadata: {
          messageCategory: "clean_conversation",
          visibility: "user_visible",
          contentType: "plain_text",
          semanticAnalyzable: true,
        },
      },
    ],
    stats: {
      startedAt: endedAt,
      endedAt,
      durationSeconds: 0,
      totalMessages: 1,
      userMessages: 1,
      assistantMessages: 0,
      unsupportedMessages: 0,
      cleanConversationMessages: 1,
      contextSignalMessages: 0,
      excludedInternalMessages: 0,
      totalChars: text.length,
    },
    warnings: [],
  };
}

const rawCandidate: RawTaskCandidate = {
  title: "Prepare comparison report",
  target: "comparison",
  deliverable: "report",
  owner: "user",
  state: "open",
  origin: "user_request",
  deadlineKind: "none",
  deadlineText: "",
  consequence: "none",
  evidence: [
    {
      kind: "task",
      messageIndex: 1,
      quote: "Prepare the comparison report.",
    },
  ],
};

const structuredContext: SuggestionEvidenceSourceContext = {
  sourceId: "packet_structured",
  modality: "structured",
  authority: "structured_source",
  observedFrom: "2026-09-01T00:00:00.000Z",
  observedTo: "2026-09-01T00:09:59.000Z",
  confidenceFloor: null,
  confidenceCeiling: null,
  coverageRatio: null,
  conflictCount: 0,
  issueCount: 0,
};

const screenContext: SuggestionEvidenceSourceContext = {
  sourceId: "packet_screen",
  modality: "screen",
  authority: "screen_observation",
  observedFrom: "2026-09-01T00:00:00.000Z",
  observedTo: "2026-09-01T00:09:59.000Z",
  confidenceFloor: 0.4,
  confidenceCeiling: 0.8,
  coverageRatio: 0.75,
  conflictCount: 1,
  issueCount: 2,
};

describe("suggestion evidence source context", () => {
  it("preserves packet metadata through verification and lineage merge", () => {
    const structured = verifyTaskCandidates(
      conversation("structured_conversation", structuredContext.observedTo),
      [rawCandidate],
      structuredContext,
    )[0]!;
    const screen = verifyTaskCandidates(
      conversation("screen_conversation", screenContext.observedTo),
      [rawCandidate],
      screenContext,
    )[0]!;

    expect(structured.sourceContexts).toEqual([structuredContext]);
    expect(screen.sourceContexts).toEqual([screenContext]);
    expect(mergeTaskLineage([screen, structured])[0]!.sourceContexts).toEqual([
      screenContext,
      structuredContext,
    ]);
  });
});
