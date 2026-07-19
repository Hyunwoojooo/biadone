import { describe, expect, it } from "vitest";

import { expandReactFlightPayloads } from "../../src/core/adapters/chatgpt-share";

describe("expandReactFlightPayloads", () => {
  it("parses JSON bodies from React Flight row strings", () => {
    const expanded = expandReactFlightPayloads([
      '12:{"linear_conversation":[{"message":"_1"}],"_1":{"id":"u1"}}',
      "P13:[{}]",
      "not a flight row"
    ]);

    expect(expanded.reactFlightRows).toHaveLength(2);
    expect(expanded.reactFlightRows[0]).toMatchObject({
      id: "12",
      tag: null,
      path: "$[0]"
    });
    expect(expanded.reactFlightRows[1]).toMatchObject({
      id: "13",
      tag: "P",
      path: "$[1]"
    });
  });

  it("materializes flat React Flight tables that contain linear_conversation", () => {
    const expanded = expandReactFlightPayloads([
      "id",
      "message",
      "author",
      "role",
      "content",
      "content_type",
      "parts",
      "user",
      "text",
      "hello",
      { _0: 9, _2: 11, _4: 12 },
      { _3: 7 },
      { _5: 8, _6: [9] },
      "linear_conversation",
      [10]
    ]);

    expect(expanded.reactFlightTables).toHaveLength(1);
    expect(expanded.reactFlightTables[0]).toMatchObject({
      linear_conversation: [
        {
          id: "hello",
          author: { role: "user" },
          content: {
            content_type: "text",
            parts: ["hello"]
          }
        }
      ]
    });
  });
});
