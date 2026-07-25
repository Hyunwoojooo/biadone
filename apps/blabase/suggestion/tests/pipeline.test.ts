import { describe, expect, it } from "vitest";

import {
  runSuggestionEngine,
  SuggestionEngineError
} from "../src/runSuggestionEngine";
import type { SourceStatus } from "../src/types";
import { conversationFixture, rawCandidateFixture } from "./helpers";

const providerConfig = {
  id: "gemini" as const,
  apiKey: "test-key",
  model: "test-model"
};

describe("suggestion engine pipeline", () => {
  it("requires three restored conversations before any provider call", async () => {
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      return providerResponse();
    };

    await expect(
      runSuggestionEngine({
        restored: [
          { inputIndex: 0, conversation: conversationFixture({ id: "a" }) },
          { inputIndex: 1, conversation: conversationFixture({ id: "b" }) }
        ],
        sources: sourceStatuses(2),
        providerConfig,
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toBeInstanceOf(SuggestionEngineError);
    expect(fetchCount).toBe(0);
  });

  it("produces a suggestion from three successful extractions", async () => {
    const result = await runSuggestionEngine({
      restored: ["a", "b", "c"].map((id, inputIndex) => ({
        inputIndex,
        conversation: conversationFixture({ id })
      })),
      sources: sourceStatuses(3),
      providerConfig,
      fetchImpl: (async () => providerResponse()) as typeof fetch,
      now: () => "2026-07-24T00:00:00.000Z"
    });

    expect(result.status).toBe("suggested");
    expect(result.run).toMatchObject({
      sourceCount: 3,
      requestCount: 3,
      failedRequestCount: 0,
      provider: "gemini",
      model: "test-model"
    });
    expect(result.topSuggestion?.sourceConversationCount).toBe(3);
  });

  it("aborts when fewer than three LLM extractions succeed", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) return new Response("failure", { status: 500 });
      return providerResponse();
    };

    await expect(
      runSuggestionEngine({
        restored: ["a", "b", "c"].map((id, inputIndex) => ({
          inputIndex,
          conversation: conversationFixture({ id })
        })),
        sources: sourceStatuses(3),
        providerConfig,
        fetchImpl: fetchImpl as typeof fetch
      })
    ).rejects.toMatchObject({
      code: "NOT_ENOUGH_SUCCESSFUL_EXTRACTIONS"
    });
  });
});

function providerResponse(): Response {
  return Response.json({
    id: "request-test",
    model: "test-model",
    output_text: JSON.stringify({
      candidates: [rawCandidateFixture()]
    }),
    usage: {
      total_input_tokens: 10,
      total_output_tokens: 5,
      total_tokens: 15
    }
  });
}

function sourceStatuses(count: number): SourceStatus[] {
  return Array.from({ length: count }, (_, inputIndex) => ({
    inputIndex,
    status: "restored",
    conversationId: `conversation-${inputIndex}`,
    title: null,
    messageCount: 2,
    errorCode: null,
    errorMessage: null
  }));
}
