import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summarizePayloadStructure } from "../../src/core/adapters/chatgpt-share";

describe("summarizePayloadStructure", () => {
  it("summarizes enqueue payload shape without returning message content", async () => {
    const fixture = await readFile(
      join(process.cwd(), "tests/fixtures/chatgpt-share/simple-ko.html"),
      "utf8"
    );

    const summary = summarizePayloadStructure(fixture);

    expect(summary.html.hasStreamControllerEnqueue).toBe(true);
    expect(summary.html.hasLinearConversationText).toBe(true);
    expect(summary.payloadCount).toBe(1);
    expect(summary.payloads[0]?.decoded.kind).toBe("object");
    expect(summary.combined.linearConversationKeyPaths).toEqual([
      "$.linear_conversation"
    ]);
    expect(summary.dereferenced.linearConversationKeyPaths).toEqual([
      "$.decodedPayloads.linear_conversation"
    ]);
    expect(summary.combined.mappingKeyCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("JARVIS Context Mapper");
  });
});
