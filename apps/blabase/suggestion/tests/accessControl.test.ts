import { describe, expect, it } from "vitest";

import { hasValidBasicAuthorization } from "../src/accessControl";

describe("suggestion access control", () => {
  it("accepts the configured username and password", () => {
    const encoded = btoa("blabase:test-password");

    expect(
      hasValidBasicAuthorization(`Basic ${encoded}`, "test-password")
    ).toBe(true);
  });

  it("rejects missing and invalid credentials", () => {
    expect(hasValidBasicAuthorization(null, "test-password")).toBe(false);
    expect(
      hasValidBasicAuthorization(
        `Basic ${btoa("blabase:wrong-password")}`,
        "test-password"
      )
    ).toBe(false);
  });

  it("rejects malformed basic authorization", () => {
    expect(
      hasValidBasicAuthorization("Basic not-valid-base64%%", "test-password")
    ).toBe(false);
  });
});
