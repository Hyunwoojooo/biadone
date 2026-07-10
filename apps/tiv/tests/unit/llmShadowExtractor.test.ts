import { describe, expect, it, vi } from "vitest";

import { extractLlmShadow } from "../../src/core/extractors/llmShadowExtractor";
import { runShadowExtraction } from "../../src/core/extractors/runShadowExtraction";
import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import type { CanonicalConversation, CanonicalMessage } from "../../src/core/types/conversation";

describe("extractLlmShadow", () => {
  it("returns disabled without calling the API when shadow mode is off", async () => {
    const fetchImpl = vi.fn();
    const result = await extractLlmShadow(conversation(), {
      enabled: false,
      apiKey: "unused",
      fetchImpl
    });

    expect(result).toMatchObject({ status: "disabled", items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses OpenAI Responses API structured output and marks LLM items as review-only", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        text: { format: { type: string; strict: boolean } };
        input: string;
      };
      expect(requestBody.text.format).toMatchObject({
        type: "json_schema",
        strict: true
      });
      expect(requestBody.input).toContain('"messageIndex":1');
      expect(requestBody.input).not.toContain("internal tool payload");

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: [
              {
                type: "intent",
                label: "공유 링크 분석",
                description: "대화를 구조화한다",
                status: null,
                category: null,
                triggerPhrase: "공유 링크로 분석해줘",
                evidenceMessageIndexes: [1],
                confidence: 0.83
              }
            ]
          })
        }),
        { status: 200 }
      );
    });

    const result = await extractLlmShadow(conversation(), {
      enabled: true,
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result).toMatchObject({ status: "completed", model: "test-model" });
    expect(result.items[0]).toMatchObject({
      source: "llm",
      sourceItemId: null,
      reviewRequired: true
    });
  });

  it("uses Qwen JSON mode in non-thinking mode and parses the common schema", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://qwen.example/compatible-mode/v1/chat/completions"
      );
      const requestBody = JSON.parse(String(init?.body)) as {
        model: string;
        response_format: { type: string };
        enable_thinking: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      expect(requestBody).toMatchObject({
        model: "qwen3.7-plus",
        response_format: { type: "json_object" },
        enable_thinking: false
      });
      expect(requestBody.messages[0]?.content).toContain("JSON");

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      type: "topic",
                      label: "공유 링크 분석",
                      description: "대화 분석 논의",
                      status: null,
                      category: null,
                      triggerPhrase: "공유 링크로 분석해줘",
                      evidenceMessageIndexes: [1],
                      confidence: 0.8
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    });

    const result = await extractLlmShadow(conversation(), {
      enabled: true,
      provider: "qwen",
      apiKey: "dashscope-test-key",
      model: "qwen3.7-plus",
      baseUrl: "https://qwen.example/compatible-mode/v1/",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result).toMatchObject({
      status: "completed",
      provider: "qwen",
      model: "qwen3.7-plus"
    });
    expect(result.items[0]).toMatchObject({
      type: "topic",
      source: "llm",
      reviewRequired: true
    });
  });

  it("keeps the rule result when the LLM request fails", async () => {
    const source = conversation();
    const ruleResult = extractMockStructure(source);
    const hybrid = await runShadowExtraction({
      conversation: source,
      ruleResult,
      llmOptions: {
        enabled: true,
        apiKey: "test-key",
        fetchImpl: vi.fn(async () => new Response("failure", { status: 500 })) as typeof fetch
      },
      now: () => "2026-07-10T00:00:00.000Z"
    });

    expect(hybrid.llmResult).toMatchObject({
      status: "failed",
      items: [],
      error: { code: "LLM_REQUEST_FAILED" }
    });
    expect(hybrid.ruleResult.items.length).toBeGreaterThan(0);
  });
});

function conversation(): CanonicalConversation {
  const messages: CanonicalMessage[] = [
    message(1, "user", "공유 링크로 분석해줘", "clean_conversation"),
    message(2, "assistant", "분석 방향을 정리했습니다.", "clean_conversation"),
    message(3, "assistant", "internal tool payload", "context_signal")
  ];
  return {
    id: "conv_shadow",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/test",
      normalizedUrl: "https://chatgpt.com/share/test",
      shareId: "test",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-10T00:00:00.000Z"
    },
    title: "Shadow test",
    language: "ko",
    importedAt: "2026-07-10T00:00:00.000Z",
    messages,
    stats: {
      totalMessages: 3,
      userMessages: 1,
      assistantMessages: 2,
      unsupportedMessages: 0,
      cleanConversationMessages: 2,
      contextSignalMessages: 1,
      excludedInternalMessages: 0,
      totalChars: messages.reduce((sum, item) => sum + item.text.length, 0)
    },
    warnings: []
  };
}

function message(
  index: number,
  role: "user" | "assistant",
  text: string,
  category: CanonicalMessage["metadata"]["messageCategory"]
): CanonicalMessage {
  return {
    id: `msg_${index}`,
    index,
    role,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw_${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory: category,
      semanticAnalyzable: category === "clean_conversation"
    }
  };
}
