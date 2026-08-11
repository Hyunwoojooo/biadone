import { describe, expect, it } from "vitest";

import {
  SOURCE_CONNECTION_ANCHORS,
  launcherSourceAnchor,
  sourceConnectionAnchor,
  sourceConnectionReturnUrl
} from "../app/sourceNavigation";

describe("source connection navigation", () => {
  it.each([
    ["github", "source-github"],
    ["codex", "source-codex"],
    ["notion", "source-notion"],
    ["google-calendar", "source-google-calendar"]
  ])("maps the allowlisted %s source to its canonical anchor", (
    source,
    anchor
  ) => {
    expect(sourceConnectionAnchor(source)).toBe(anchor);
  });

  it.each([
    null,
    "",
    "google_calendar",
    "GitHub",
    "../settings",
    "https://example.com"
  ])("rejects the non-canonical source value %s", (source) => {
    expect(sourceConnectionAnchor(source)).toBeNull();
  });

  it("requires the exact launcher entry before resolving a query target", () => {
    expect(launcherSourceAnchor("github", "launcher")).toBe(
      "source-github"
    );
    expect(launcherSourceAnchor("github", "Launcher")).toBeNull();
    expect(launcherSourceAnchor("github", "dashboard")).toBeNull();
    expect(launcherSourceAnchor("github", null)).toBeNull();
  });

  it.each([
    ["github", "github", "source-github"],
    ["notion", "notion", "source-notion"],
    ["google-calendar", "calendar", "source-google-calendar"]
  ] as const)(
    "builds a static /sources return for %s",
    (source, statusQuery, anchor) => {
      const destination = sourceConnectionReturnUrl(
        "http://localhost:3102/api/connectors/callback?returnTo=https%3A%2F%2Fexample.com#untrusted",
        source,
        "connected"
      );

      expect(destination.origin).toBe("http://localhost:3102");
      expect(destination.pathname).toBe("/sources");
      expect(destination.searchParams.size).toBe(1);
      expect(destination.searchParams.get(statusQuery)).toBe("connected");
      expect(destination.hash).toBe(`#${anchor}`);
    }
  );

  it("keeps the four canonical anchors unique", () => {
    expect(new Set(Object.values(SOURCE_CONNECTION_ANCHORS)).size).toBe(4);
  });
});
