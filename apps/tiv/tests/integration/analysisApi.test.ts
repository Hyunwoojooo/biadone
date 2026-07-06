import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/analyses/route";
import { GET as GET_MESSAGES } from "../../src/app/api/analyses/[analysisId]/messages/route";

describe("analysis API Sprint 2 flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an analysis and returns restored messages", async () => {
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
    };

    expect(createResponse.status).toBe(200);
    expect(createPayload.status).toBe("completed");
    expect(createPayload.analysisId).toMatch(/^ana_/);

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
      messages: { role: string; text: string }[];
    };

    expect(messagesResponse.status).toBe(200);
    expect(messagesPayload.messages).toHaveLength(2);
    expect(messagesPayload.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(messagesPayload.messages[0]?.text).toContain("JARVIS Context Mapper");
  });
});
