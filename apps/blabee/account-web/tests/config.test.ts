import assert from "node:assert/strict";
import test from "node:test";
import { consumeCallback, readConfig } from "../src/config.ts";

const validEnv = {
  VITE_SUPABASE_URL: "https://project.example.com",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example-not-a-real-key",
};

test("reads only a browser publishable key and normalizes whitespace and origin", () => {
  assert.deepEqual(readConfig({
    VITE_SUPABASE_URL: "  https://project.example.com/  ",
    VITE_SUPABASE_PUBLISHABLE_KEY: `  ${validEnv.VITE_SUPABASE_PUBLISHABLE_KEY}  `,
  }), {
    url: validEnv.VITE_SUPABASE_URL,
    publishableKey: validEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
});

test("rejects missing or malformed public configuration", () => {
  for (const env of [{}, { VITE_SUPABASE_URL: "not a URL" }, { VITE_SUPABASE_URL: validEnv.VITE_SUPABASE_URL }]) {
    assert.throws(() => readConfig(env));
  }
});

test("rejects non-HTTPS URLs and URLs carrying credentials or extra URL components", () => {
  for (const url of [
    "http://project.example.com",
    "ftp://project.example.com",
    "javascript:alert(1)",
    "https://user@project.example.com",
    "https://user:password@project.example.com",
    "https://project.example.com/api",
    "https://project.example.com/?key=example",
    "https://project.example.com/#example",
  ]) {
    assert.throws(() => readConfig({ ...validEnv, VITE_SUPABASE_URL: url }), url);
  }
});

test("rejects secret, service-role, legacy JWT, empty and malformed browser keys", () => {
  for (const key of [
    "sb_secret_example-not-a-real-key",
    "service_role",
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.example",
    "",
    "sb_publishable_",
    "sb_publishable_with spaces",
    "sb_publishable_with/slash",
  ]) {
    assert.throws(() => readConfig({ ...validEnv, VITE_SUPABASE_PUBLISHABLE_KEY: key }), /publishable key/);
  }
});

test("consumes a PKCE code and removes all query and fragment values from browser history", () => {
  const replacements: string[] = [];
  const result = consumeCallback(
    new URL("https://account.example.com/?code=one-time-code&next=https%3A%2F%2Fattacker.example#private-data"),
    (path) => replacements.push(path),
  );
  assert.deepEqual(result, { code: "one-time-code", failed: false });
  assert.deepEqual(replacements, ["/"]);
});

test("callback cleanup keeps the current path and never trusts a next redirect", () => {
  const replacements: string[] = [];
  const result = consumeCallback(
    new URL("https://account.example.com/account/?next=//attacker.example&redirectTo=https://attacker.example"),
    (path) => replacements.push(path),
  );
  assert.deepEqual(result, { code: null, failed: false });
  assert.deepEqual(replacements, ["/account/"]);
});

test("an ordinary visit does not rewrite history or invent a callback", () => {
  const replacements: string[] = [];
  assert.deepEqual(consumeCallback(new URL("https://account.example.com/"), (path) => replacements.push(path)), {
    code: null,
    failed: false,
  });
  assert.deepEqual(replacements, []);
});

for (const query of [
  "?error=access_denied&error_description=private-detail",
  "?error_code=otp_expired",
  "?error_description=expired",
  "#error=access_denied",
  "#error_code=otp_expired",
  "#error_description=expired",
  "#access_token=unsupported-token&refresh_token=unsupported-refresh-token",
  "?token_hash=unsupported-token-hash&type=magiclink",
]) {
  test(`rejects and sanitizes an auth error or unsupported callback: ${query.split("=")[0]}`, () => {
    const replacements: string[] = [];
    const result = consumeCallback(new URL(`https://account.example.com/${query}`), (path) => replacements.push(path));
    assert.equal(result.failed, true);
    assert.deepEqual(replacements, ["/"]);
  });
}

test("an auth error takes precedence even when a PKCE code is also present", () => {
  const result = consumeCallback(new URL("https://account.example.com/?code=present&error=access_denied"), () => {});
  assert.equal(result.failed, true);
});
