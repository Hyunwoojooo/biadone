import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentWorkCard } from "../app/WorkCockpit";

describe("Recent Work presentation", () => {
  it("renders no DOM when the public summary is null", () => {
    expect(
      renderToStaticMarkup(createElement(RecentWorkCard, { summary: null }))
    ).toBe("");
  });

  it("renders a display-only card without actions", () => {
    const markup = renderToStaticMarkup(
      createElement(RecentWorkCard, {
        summary: {
          displayLabel: "Safe recent work",
          pushOccurredAt: "2026-08-09T11:00:00.000Z",
          trackingState: "ahead",
          aheadCount: 2,
          behindCount: 0,
          correlation: "repository_scope_only",
          presentation: "display_only",
          attentionSelectionEffect: "none",
          executionEffect: "none"
        }
      })
    );
    expect(markup).toContain("Recent Work");
    expect(markup).toContain("Safe recent work");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
  });
});
