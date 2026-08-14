import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

const mocks = vi.hoisted(() => ({
  workCockpit: vi.fn((_props: { setupActionEnabled: boolean }) => null)
}));

vi.mock("../app/WorkCockpit", () => ({
  WorkCockpit: mocks.workCockpit
}));

import TodayPage from "../app/page";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Continuation Setup action UI flag", () => {
  it.each([
    [undefined, false],
    ["false", false],
    ["TRUE", false],
    ["true", true]
  ] as const)("maps exact server flag %s to %s", (flag, expected) => {
    if (flag === undefined) {
      vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "");
    } else {
      vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", flag);
    }

    renderToStaticMarkup(createElement(TodayPage));

    expect(mocks.workCockpit).toHaveBeenCalledOnce();
    expect(mocks.workCockpit.mock.calls[0]?.[0]).toEqual({
      setupActionEnabled: expected,
      monitoringEnabled: false
    });
  });

  it("applies one exact anti-framing policy to every page path", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'"
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" }
        ]
      }
    ]);

    for (const path of ["/", "/projects"]) {
      const rule = rules.find(({ source }) =>
        matchesGlobalPathRule(source, path)
      );
      expect(rule?.headers).toEqual([
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'none'"
        },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" }
      ]);
    }
  });
});

function matchesGlobalPathRule(source: string, path: string): boolean {
  return source === "/:path*" && path.startsWith("/");
}
