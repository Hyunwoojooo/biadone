import { describe, expect, it, vi } from "vitest";

import { extractLlmShadow } from "../../src/core/extractors/llmShadowExtractor";
import { runShadowExtraction } from "../../src/core/extractors/runShadowExtraction";
import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";

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
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
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
      }
    );

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
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
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
      }
    );

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

  it("uses stateless Gemini structured output and parses the common schema", async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://gemini.example/v1/interactions");
        const headers = new Headers(init?.headers);
        expect(headers.get("x-goog-api-key")).toBe("gemini-test-key");

        const requestBody = JSON.parse(String(init?.body)) as {
          model: string;
          input: string;
          store: boolean;
          response_format: {
            type: string;
            mime_type: string;
            schema: { required: string[] };
          };
          generation_config: {
            thinking_level: string;
            thinking_summaries: string;
          };
        };
        expect(requestBody).toMatchObject({
          model: "gemini-3.1-flash-lite",
          store: false,
          response_format: {
            type: "text",
            mime_type: "application/json"
          },
          generation_config: {
            thinking_level: "minimal",
            thinking_summaries: "none"
          }
        });
        expect(requestBody.response_format.schema.required).toEqual(["items"]);
        expect(requestBody.input).toContain('"messageIndex":1');
        expect(requestBody.input).not.toContain("internal tool payload");

        return new Response(
          JSON.stringify({
            id: "int_gemini_test",
            status: "completed",
            model: "gemini-3.1-flash-lite",
            usage: {
              total_input_tokens: 30,
              total_output_tokens: 12,
              total_tokens: 42,
              total_cached_tokens: 3,
              total_thought_tokens: 0
            },
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      items: [
                        {
                          type: "decision",
                          label: "공유 링크 분석 채택",
                          description: "공유 링크를 분석 입력으로 사용한다",
                          status: "confirmed",
                          category: null,
                          triggerPhrase: "공유 링크로 분석해줘",
                          evidenceMessageIndexes: [1],
                          confidence: 0.86
                        }
                      ]
                    })
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
    );

    const result = await extractLlmShadow(conversation(), {
      enabled: true,
      provider: "gemini",
      apiKey: "gemini-test-key",
      model: "gemini-3.1-flash-lite",
      baseUrl: "https://gemini.example/v1/",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result).toMatchObject({
      status: "completed",
      provider: "gemini",
      model: "gemini-3.1-flash-lite"
    });
    expect(result.items[0]).toMatchObject({
      type: "decision",
      source: "llm",
      reviewRequired: true
    });
    expect(result.metrics).toMatchObject({
      requestCount: 1,
      completedRequestCount: 1,
      failedRequestCount: 0,
      usage: {
        reportedRequestCount: 1,
        inputTokens: 30,
        outputTokens: 12,
        totalTokens: 42,
        cachedInputTokens: 3,
        thoughtTokens: 0
      }
    });
    expect(result.segments[0]).toMatchObject({
      requestId: "int_gemini_test",
      responseModel: "gemini-3.1-flash-lite",
      itemCount: 1
    });
  });

  it("segments long conversations and aggregates provider usage and coverage", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as { input: string };
        expect(requestBody.input).toContain(
          "exhaustive extraction, not a summary or top-N list"
        );
        expect(requestBody.input).toContain("Semantic checklist:");
        const payloadStart = requestBody.input.lastIndexOf('{"conversationId"');
        const promptPayload = JSON.parse(
          requestBody.input.slice(payloadStart)
        ) as {
          segment: {
            messages: Array<{ messageIndex: number }>;
          };
        };
        const evidenceIndex =
          promptPayload.segment.messages[0]?.messageIndex ?? 1;

        return new Response(
          JSON.stringify({
            status: "completed",
            model: "gemini-3.1-flash-lite",
            usage: {
              total_input_tokens: 100,
              total_output_tokens: 20,
              total_tokens: 120,
              total_cached_tokens: 0,
              total_thought_tokens: 0
            },
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      items: [
                        {
                          type: "topic",
                          label: `대화 주제 ${evidenceIndex}`,
                          description: "구간별 주제",
                          status: null,
                          category: null,
                          triggerPhrase: "구간 메시지",
                          evidenceMessageIndexes: [evidenceIndex],
                          confidence: 0.8
                        }
                      ]
                    })
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
    );

    const result = await extractLlmShadow(longConversation(), {
      enabled: true,
      provider: "gemini",
      apiKey: "gemini-test-key",
      model: "gemini-3.1-flash-lite",
      baseUrl: "https://gemini.example/v1",
      segmentation: {
        maxCharsPerSegment: 90,
        maxMessagesPerSegment: 10,
        maxSegments: 10
      },
      segmentConcurrency: 2,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("completed");
    expect(result.items).toHaveLength(2);
    expect(result.metrics).toMatchObject({
      requestCount: 2,
      completedRequestCount: 2,
      failedRequestCount: 0,
      usage: {
        reportedRequestCount: 2,
        inputTokens: 200,
        outputTokens: 40,
        totalTokens: 240
      }
    });
    expect(result.coverage).toMatchObject({
      cleanMessageCount: 4,
      analyzedMessageCount: 4,
      segmentCount: 2,
      semanticTypeCounts: { topic: 2 },
      invalidEvidenceItemIds: []
    });
  });

  it("preserves successful segment output when another segment fails", async () => {
    let requestCount = 0;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requestCount += 1;
        if (requestCount === 1) return new Response("failure", { status: 500 });

        const requestBody = JSON.parse(String(init?.body)) as { input: string };
        const payloadStart = requestBody.input.lastIndexOf('{"conversationId"');
        const promptPayload = JSON.parse(
          requestBody.input.slice(payloadStart)
        ) as {
          segment: { messages: Array<{ messageIndex: number }> };
        };
        const evidenceIndex =
          promptPayload.segment.messages[0]?.messageIndex ?? 3;

        return new Response(
          JSON.stringify({
            id: "int_partial_success",
            model: "gemini-3.1-flash-lite",
            usage: {
              total_input_tokens: 80,
              total_output_tokens: 20,
              total_tokens: 100
            },
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      items: [
                        {
                          type: "action",
                          label: "성공 구간 작업",
                          description: "성공한 구간의 작업 후보",
                          status: "requested",
                          category: null,
                          triggerPhrase: "구간 메시지",
                          evidenceMessageIndexes: [evidenceIndex],
                          confidence: 0.82
                        }
                      ]
                    })
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
    );

    const result = await extractLlmShadow(longConversation(), {
      enabled: true,
      provider: "gemini",
      apiKey: "gemini-test-key",
      model: "gemini-3.1-flash-lite",
      baseUrl: "https://gemini.example/v1",
      segmentation: {
        maxCharsPerSegment: 90,
        maxMessagesPerSegment: 10,
        maxSegments: 10
      },
      segmentConcurrency: 1,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result.status).toBe("partial");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "action",
      source: "llm",
      reviewRequired: true
    });
    expect(result.segments.map((segment) => segment.status)).toEqual([
      "failed",
      "completed"
    ]);
    expect(result.metrics).toMatchObject({
      requestCount: 2,
      completedRequestCount: 1,
      failedRequestCount: 1,
      usage: {
        reportedRequestCount: 1,
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100
      }
    });
    expect(result.error).toBeUndefined();
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
        fetchImpl: vi.fn(
          async () => new Response("failure", { status: 500 })
        ) as typeof fetch
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

function longConversation(): CanonicalConversation {
  const messages: CanonicalMessage[] = [
    message(1, "user", "a".repeat(40), "clean_conversation"),
    message(2, "assistant", "b".repeat(40), "clean_conversation"),
    message(3, "user", "c".repeat(40), "clean_conversation"),
    message(4, "assistant", "d".repeat(40), "clean_conversation")
  ];
  return {
    ...conversation(),
    id: "conv_shadow_long",
    messages,
    stats: {
      totalMessages: 4,
      userMessages: 2,
      assistantMessages: 2,
      unsupportedMessages: 0,
      cleanConversationMessages: 4,
      contextSignalMessages: 0,
      excludedInternalMessages: 0,
      totalChars: 160
    }
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
