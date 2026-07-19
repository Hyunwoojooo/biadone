import { describe, expect, it, vi } from "vitest";

import {
  GoldenSheetConfigError,
  nextSessionId,
  readGoldenSheetConfig,
  syncAnalysisToGoldenSheet,
  type GoldenSheetConfig
} from "../../src/core/golden-sheet/googleSheetsClient";
import type { CanonicalConversation } from "../../src/core/types/conversation";

const config: GoldenSheetConfig = {
  spreadsheetId: "sheet_test",
  clientEmail: "service@example.com",
  privateKey: "unused-in-test"
};

describe("googleSheetsClient", () => {
  it("writes only structural columns and preserves formula columns", async () => {
    type UpdateBody = {
      valueInputOption?: string;
      data?: Array<{ range?: string; values?: unknown[][] }>;
    };
    const captured: { updateBody?: UpdateBody } = {};
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") {
          return new Response(
            JSON.stringify({
              valueRanges: [
                {
                  values: [
                    ["S-001", "기존 세션", "https://chatgpt.com/share/existing"]
                  ]
                },
                { values: [["S-001"], ["S-001"]] },
                { values: [["S-001"]] }
              ]
            }),
            { status: 200 }
          );
        }
        captured.updateBody = JSON.parse(String(init.body)) as UpdateBody;
        return new Response(JSON.stringify({ totalUpdatedCells: 20 }), {
          status: 200
        });
      }
    );

    const result = await syncAnalysisToGoldenSheet(
      {
        analysisId: "ana_new",
        shareUrl: "https://chatgpt.com/share/new",
        conversation: conversation()
      },
      {
        config,
        fetchImpl: fetchMock as typeof fetch,
        getAccessToken: async () => "access-token"
      }
    );

    expect(result).toMatchObject({
      status: "created",
      sessionId: "S-002",
      sessionRow: 3,
      messageCount: 2,
      promptCount: 1
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.updateBody?.valueInputOption).toBe("RAW");

    const ranges = captured.updateBody?.data?.map((item) => item.range) ?? [];
    expect(ranges).toContain("'00_세션목록'!A3:E3");
    expect(ranges).toContain("'00_세션목록'!M3:O3");
    expect(ranges).toContain("'01_전체메시지'!A4:B5");
    expect(ranges).toContain("'01_전체메시지'!C4:I5");
    expect(ranges).toContain("'01_전체메시지'!J4:K5");
    expect(ranges).toContain("'02_프롬프트판정'!A3:B3");
    expect(ranges).toContain("'02_프롬프트판정'!D3:G3");
    expect(ranges).toContain("'02_프롬프트판정'!W3:Y3");
    expect(ranges).toContain("'03_세션요약'!A3:B3");
    expect(ranges.some((range) => /프롬프트판정'!C/.test(range ?? ""))).toBe(
      false
    );

    const promptDefaults = captured.updateBody?.data?.find((item) =>
      item.range?.includes("!T3:U3")
    );
    expect(promptDefaults?.values).toEqual([["미작성", "미검수"]]);
    const promptTiming = captured.updateBody?.data?.find((item) =>
      item.range?.includes("!W3:Y3")
    );
    expect(promptTiming?.values?.[0]?.[0]).toEqual(expect.any(Number));
    expect(promptTiming?.values?.[0]?.[1]).toEqual(expect.any(Number));
    expect(promptTiming?.values?.[0]?.[2]).toBe(10);
    expect(ranges.some((range) => range?.includes("04_예상추출항목"))).toBe(
      false
    );
  });

  it("returns the existing session without writing a duplicate link", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            valueRanges: [
              {
                values: [["S-001", "기존", "https://chatgpt.com/share/new"]]
              },
              { values: [["S-001"]] },
              { values: [["S-001"]] }
            ]
          }),
          { status: 200 }
        )
    );

    const result = await syncAnalysisToGoldenSheet(
      {
        analysisId: "ana_duplicate",
        shareUrl: "https://chatgpt.com/share/new",
        conversation: conversation()
      },
      {
        config,
        fetchImpl: fetchMock as typeof fetch,
        getAccessToken: async () => "access-token"
      }
    );

    expect(result).toMatchObject({
      status: "duplicate",
      sessionId: "S-001",
      sessionRow: 2
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires service account credentials and increments numeric session ids", () => {
    expect(() => readGoldenSheetConfig({})).toThrow(GoldenSheetConfigError);
    expect(nextSessionId([["S-001"], ["manual"], ["S-009"], ["S-003"]])).toBe(
      "S-010"
    );
  });
});

function conversation(): CanonicalConversation {
  return {
    id: "conv_new",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/new",
      normalizedUrl: "https://chatgpt.com/share/new",
      shareId: "new",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-18T00:00:00.000Z"
    },
    title: "새 대화",
    language: "ko",
    importedAt: "2026-07-18T00:00:00.000Z",
    messages: [
      {
        id: "msg_1",
        index: 1,
        role: "user",
        createdAt: "2026-07-18T03:00:00.000Z",
        updatedAt: null,
        text: "새 요청",
        blocks: [{ type: "paragraph", text: "새 요청" }],
        sourceRef: {
          type: "chatgpt_share_payload",
          messageId: "raw_1",
          messageIndex: 1,
          role: "user"
        },
        metadata: { messageCategory: "clean_conversation" }
      },
      {
        id: "msg_2",
        index: 2,
        role: "assistant",
        createdAt: "2026-07-18T03:00:10.000Z",
        updatedAt: "2026-07-18T03:00:12.000Z",
        text: "새 답변",
        blocks: [{ type: "paragraph", text: "새 답변" }],
        sourceRef: {
          type: "chatgpt_share_payload",
          messageId: "raw_2",
          messageIndex: 2,
          role: "assistant"
        },
        metadata: {
          messageCategory: "clean_conversation",
          assistantMessageType: "final_answer"
        }
      }
    ],
    stats: {
      startedAt: "2026-07-18T03:00:00.000Z",
      endedAt: "2026-07-18T03:00:10.000Z",
      durationSeconds: 10,
      totalMessages: 2,
      userMessages: 1,
      assistantMessages: 1,
      unsupportedMessages: 0,
      cleanConversationMessages: 2,
      contextSignalMessages: 0,
      excludedInternalMessages: 0,
      totalChars: 8
    },
    warnings: []
  };
}
