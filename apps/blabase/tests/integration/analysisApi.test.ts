import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/analyses/route";
import { GET as GET_MESSAGES } from "../../src/app/api/analyses/[analysisId]/messages/route";
import { GET as GET_RESULT } from "../../src/app/api/analyses/[analysisId]/result/route";
import { getAnalysisStore } from "../../src/core/storage/analysisStore";

describe("analysis API Sprint 2 flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates an analysis and returns restored messages", async () => {
    vi.stubEnv("BLABASE_LLM_SHADOW_ENABLED", "false");
    const fixture = await readFile(
      join(process.cwd(), "tests/fixtures/chatgpt-share/simple-ko.html"),
      "utf8"
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(fixture, {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        });
      })
    );

    const createResponse = await POST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        body: JSON.stringify({
          shareUrl: "https://chatgpt.com/share/sprint2-fixture"
        })
      })
    );
    const createPayload = (await createResponse.json()) as {
      analysisId: string;
      status: string;
      shadowStatus: string;
      shadowVerifiedCount: number;
      shadowReviewCount: number;
      shadowRejectedCount: number;
      monitorData: {
        result: { analysisId: string; result: unknown };
        messages: {
          analysisId: string;
          conversation: { warnings: unknown[] };
          messages: { role: string; text: string }[];
        };
      };
    };

    expect(createResponse.status).toBe(200);
    expect(createPayload.status).toBe("completed");
    expect(createPayload.analysisId).toMatch(/^ana_/);
    expect(createPayload.shadowStatus).toBe("disabled");
    expect(createPayload).toMatchObject({
      shadowVerifiedCount: 0,
      shadowReviewCount: 0,
      shadowRejectedCount: 0
    });
    expect(createPayload.monitorData).toMatchObject({
      result: {
        analysisId: createPayload.analysisId
      },
      messages: {
        analysisId: createPayload.analysisId
      }
    });
    expect(createPayload.monitorData.result.result).toBeTruthy();
    expect(createPayload.monitorData.messages.messages).toHaveLength(2);

    const stored = getAnalysisStore().get(createPayload.analysisId);
    expect(stored?.structureResult?.extractor.name).toBe(
      "MockStructureExtractor"
    );
    expect(stored?.hybridExtraction).toMatchObject({
      mode: "shadow",
      llmResult: { status: "disabled", items: [] },
      verifiedItems: [],
      reviewQueue: [],
      rejectedItems: []
    });
    expect(stored?.hybridExtraction?.ruleResult.items.length).toBeGreaterThan(
      0
    );

    const messagesResponse = await GET_MESSAGES(
      new Request(
        `http://localhost/api/analyses/${createPayload.analysisId}/messages`
      ),
      {
        params: Promise.resolve({
          analysisId: createPayload.analysisId
        })
      }
    );
    const messagesPayload = (await messagesResponse.json()) as {
      conversation: {
        source: {
          originalUrl: string;
          adapterName: string;
          adapterVersion: string;
        };
        warnings: Array<{
          code: string;
          message: string;
          severity: "info" | "warning" | "error";
        }>;
      };
      messages: { role: string; text: string }[];
    };

    expect(messagesResponse.status).toBe(200);
    expect(messagesPayload.conversation.source).toMatchObject({
      originalUrl: "https://chatgpt.com/share/sprint2-fixture",
      adapterName: "ChatGPTShareAdapter"
    });
    expect(messagesPayload.conversation.source.adapterVersion).toBeTruthy();
    expect(messagesPayload.conversation.warnings).toEqual(
      stored?.conversation?.warnings
    );
    expect(messagesPayload.messages).toHaveLength(2);
    expect(messagesPayload.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(messagesPayload.messages[0]?.text).toContain(
      "JARVIS Context Mapper"
    );

    const resultResponse = await GET_RESULT(
      new Request(
        `http://localhost/api/analyses/${createPayload.analysisId}/result`
      ),
      { params: Promise.resolve({ analysisId: createPayload.analysisId }) }
    );
    const resultPayload = (await resultResponse.json()) as {
      result: unknown;
      sprint5: {
        llmResult: { status: string };
        evidenceDiagnostics: { candidateCount: number };
      };
    };
    expect(resultResponse.status).toBe(200);
    expect(resultPayload).toHaveProperty("result");
    expect(resultPayload).not.toHaveProperty("hybridExtraction");
    expect(resultPayload.sprint5).toMatchObject({
      llmResult: { status: "disabled" },
      evidenceDiagnostics: { candidateCount: 0 }
    });
  });

  it("keeps analysis completed and serves rule results when LLM shadow fails", async () => {
    const fixture = await readFile(
      join(process.cwd(), "tests/fixtures/chatgpt-share/simple-ko.html"),
      "utf8"
    );
    vi.stubEnv("BLABASE_LLM_SHADOW_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.openai.com")) {
          return new Response("shadow failure", { status: 500 });
        }
        return new Response(fixture, {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      })
    );

    const createResponse = await POST(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        body: JSON.stringify({
          shareUrl: "https://chatgpt.com/share/shadow-failure-fixture"
        })
      })
    );
    const createPayload = (await createResponse.json()) as {
      analysisId: string;
      status: string;
      shadowStatus: string;
    };

    expect(createResponse.status).toBe(200);
    expect(createPayload).toMatchObject({
      status: "completed",
      shadowStatus: "failed"
    });

    const stored = getAnalysisStore().get(createPayload.analysisId);
    expect(stored?.hybridExtraction?.llmResult.status).toBe("failed");
    expect(stored?.hybridExtraction?.ruleResult.items.length).toBeGreaterThan(
      0
    );

    const resultResponse = await GET_RESULT(
      new Request(
        `http://localhost/api/analyses/${createPayload.analysisId}/result`
      ),
      { params: Promise.resolve({ analysisId: createPayload.analysisId }) }
    );
    const resultPayload = (await resultResponse.json()) as {
      status: string;
      result?: { extractor?: { name?: string } };
    };

    expect(resultResponse.status).toBe(200);
    expect(resultPayload.status).toBe("completed");
    expect(resultPayload.result?.extractor?.name).toBe(
      "MockStructureExtractor"
    );
  });
});
