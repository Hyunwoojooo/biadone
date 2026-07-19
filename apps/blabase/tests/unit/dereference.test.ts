import { describe, expect, it } from "vitest";

import { dereference } from "../../src/core/adapters/chatgpt-share";

describe("dereference", () => {
  it("resolves simple references", () => {
    const result = dereference({
      _1: { name: "target" },
      value: "_1"
    });

    expect(result.root).toMatchObject({
      value: { name: "target" }
    });
    expect(result.stats.resolvedRefs).toBe(1);
  });

  it("resolves nested object and array references", () => {
    const result = dereference({
      _1: { label: "node" },
      wrapper: {
        items: ["_1"]
      }
    });

    expect(result.root).toMatchObject({
      wrapper: {
        items: [{ label: "node" }]
      }
    });
  });

  it("preserves unresolved references when configured", () => {
    const result = dereference({ value: "_999" }, { preserveUnknownRefs: true });

    expect(result.root).toMatchObject({ value: "_999" });
    expect(result.stats.unresolvedRefs).toBe(1);
  });

  it("detects circular references", () => {
    const result = dereference({
      _1: "_2",
      _2: "_1",
      value: "_1"
    });

    expect(result.warnings).toContain("CIRCULAR_REF:_1");
  });

  it("records max depth", () => {
    const result = dereference({ _1: { child: "_1" }, value: "_1" }, { maxDepth: 1 });

    expect(result.stats.maxDepthReached).toBe(true);
  });
});
