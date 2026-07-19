import { describe, expect, it } from "vitest";

import {
  extractEnqueuePayloads,
  ChatGPTShareAdapterError
} from "../../src/core/adapters/chatgpt-share";

describe("extractEnqueuePayloads", () => {
  it("extracts a single enqueue payload", () => {
    const payloads = extractEnqueuePayloads(
      'window.__reactRouterContext.streamController.enqueue("{\\"ok\\":true}")'
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.rawArgument).toBe('"{\\"ok\\":true}"');
  });

  it("preserves multiple enqueue payload order", () => {
    const payloads = extractEnqueuePayloads(
      'x.streamController.enqueue("{\\"a\\":1}");x.streamController.enqueue("{\\"b\\":2}")'
    );

    expect(payloads.map((payload) => payload.order)).toEqual([0, 1]);
    expect(payloads[0]?.rawArgument).toContain('\\"a\\"');
    expect(payloads[1]?.rawArgument).toContain('\\"b\\"');
  });

  it("handles escaped quotes inside a payload string", () => {
    const payloads = extractEnqueuePayloads(
      'window.__reactRouterContext.streamController.enqueue("{\\"text\\":\\"say \\\\\\"hi\\\\\\"\\"}")'
    );

    expect(payloads[0]?.rawArgument).toContain('\\\\\\"hi\\\\\\"');
  });

  it("throws when no payload exists", () => {
    expect(() => extractEnqueuePayloads("<html></html>")).toThrow(
      ChatGPTShareAdapterError
    );
  });
});
