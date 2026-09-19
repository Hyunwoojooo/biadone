import assert from "node:assert/strict";
import test from "node:test";
import { AccountController } from "../src/auth.ts";
import type { AccountOptions, AccountState, AccountUser, AuthPort, SocialProvider } from "../src/auth.ts";

type UserReply = Awaited<ReturnType<AuthPort["getUser"]>>;
type AuthReply = Awaited<ReturnType<AuthPort["exchangeCodeForSession"]>>;
type OAuthReply = Awaited<ReturnType<AuthPort["signInWithOAuth"]>>;

const callback = { code: null, failed: false };
const redirectTo = "https://account.example.com/";
const authorizeUrl = "https://project.example.com/auth/v1/authorize";
const user: AccountUser = { id: "account-1", email: "member@example.com" };

function authorizationUrl(provider: SocialProvider = "google") {
  const url = new URL(authorizeUrl);
  url.searchParams.set("provider", provider);
  url.searchParams.set("redirect_to", redirectTo);
  url.searchParams.set("code_challenge", "A".repeat(43));
  url.searchParams.set("code_challenge_method", "s256");
  return url.href;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<AuthPort> = {}, options: Partial<AccountOptions> = {}) {
  const calls = {
    getUser: 0,
    exchanges: [] as string[],
    oauth: [] as Parameters<AuthPort["signInWithOAuth"]>[0][],
    providers: [] as SocialProvider[],
    navigations: [] as string[],
    signOut: [] as Parameters<AuthPort["signOut"]>[0][],
  };
  const states: AccountState[] = [];
  const auth: AuthPort = {
    async getUser() {
      ++calls.getUser;
      return overrides.getUser ? overrides.getUser() : { data: { user: null }, error: null };
    },
    async exchangeCodeForSession(code) {
      calls.exchanges.push(code);
      return overrides.exchangeCodeForSession ? overrides.exchangeCodeForSession(code) : { error: null };
    },
    async signInWithOAuth(input) {
      calls.oauth.push(input);
      return overrides.signInWithOAuth ? overrides.signInWithOAuth(input) : { data: { url: authorizationUrl(input.provider) }, error: null };
    },
    async signOut(input) {
      calls.signOut.push(input);
      return overrides.signOut ? overrides.signOut(input) : { error: null };
    },
  };
  const controller = new AccountController(auth, redirectTo, (state) => states.push(state), {
    authorizeUrl: options.authorizeUrl ?? authorizeUrl,
    async isProviderEnabled(provider) {
      calls.providers.push(provider);
      return options.isProviderEnabled ? options.isProviderEnabled(provider) : true;
    },
    navigate(url) {
      calls.navigations.push(url);
      options.navigate?.(url);
    },
  });
  return { controller, calls, states };
}

test("restores an account only after getUser confirms the current user", async () => {
  const pending = deferred<UserReply>();
  const { controller, calls } = harness({ getUser: () => pending.promise });
  const started = controller.start(callback);
  assert.equal(controller.state.phase, "loading");
  assert.equal(controller.state.user, null);
  assert.equal(calls.getUser, 1);
  pending.resolve({ data: { user }, error: null });
  await started;
  assert.equal(controller.state.phase, "signed-in");
  assert.deepEqual(controller.state.user, user);
});

test("a first-time visitor with no session sees a clean signed-out state", async () => {
  const { controller } = harness();
  await controller.start(callback);
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.problem, "");
  assert.equal(controller.state.user, null);
});

test("exchanges a PKCE callback once even when start is called repeatedly", async () => {
  const exchange = deferred<AuthReply>();
  const { controller, calls } = harness({
    exchangeCodeForSession: () => exchange.promise,
    getUser: async () => ({ data: { user }, error: null }),
  });
  const first = controller.start({ code: "single-use-code", failed: false });
  const second = controller.start({ code: "different-code", failed: false });
  assert.equal(first, second);
  assert.deepEqual(calls.exchanges, ["single-use-code"]);
  assert.equal(calls.getUser, 0);
  exchange.resolve({ error: null });
  await first;
  await controller.start(callback);
  assert.deepEqual(calls.exchanges, ["single-use-code"]);
  assert.equal(calls.getUser, 1);
  assert.equal(controller.state.phase, "signed-in");
});

test("rejects an error callback before exchanging a code or restoring a user", async () => {
  const { controller, calls } = harness();
  await controller.start({ code: "untrusted-code", failed: true });
  assert.deepEqual(calls.exchanges, []);
  assert.equal(calls.getUser, 0);
  assert.equal(controller.state.phase, "signed-out");
  assert.match(controller.state.problem, /다시/);
});

for (const mode of ["returned error", "thrown error"] as const) {
  test(`an expired or unusable callback stays signed out after ${mode}`, async () => {
    const { controller, calls } = harness({
      exchangeCodeForSession: async () => {
        if (mode === "thrown error") throw new Error("offline");
        return { error: { code: "bad_code_verifier", status: 400 } };
      },
    });
    await controller.start({ code: "expired-code", failed: false });
    assert.equal(calls.getUser, 0);
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.user, null);
    assert.match(controller.state.problem, /다시/);
  });
}

for (const error of [
  { name: "AuthSessionMissingError" },
  { code: "session_not_found" },
  { code: "refresh_token_not_found" },
  { status: 401 },
  { status: 403 },
]) {
  test(`an absent or revoked session is signed out without a service error: ${JSON.stringify(error)}`, async () => {
    const { controller } = harness({ getUser: async () => ({ data: { user: null }, error }) });
    await controller.start(callback);
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.problem, "");
    assert.equal(controller.state.user, null);
  });
}

for (const mode of ["returned error", "thrown error"] as const) {
  test(`a getUser ${mode} cannot authenticate an account and can be retried`, async () => {
    let recovered = false;
    const { controller, calls } = harness({
      getUser: async () => {
        if (recovered) return { data: { user }, error: null };
        if (mode === "thrown error") throw new Error("offline");
        return { data: { user }, error: { status: 503 } };
      },
    });
    await controller.start(callback);
    assert.equal(controller.state.phase, "unavailable");
    assert.equal(controller.state.user, null);
    assert.notEqual(controller.state.problem, "");
    recovered = true;
    await controller.refreshUser();
    assert.equal(calls.getUser, 2);
    assert.equal(controller.state.phase, "signed-in");
  });
}

test("rejects providers other than Google and GitHub before preflight or SDK calls", async () => {
  const { controller, calls } = harness();
  await controller.start(callback);
  for (const provider of ["email", "facebook", "", "Google", "google&redirect_to=https://attacker.example"]) {
    await controller.signIn(provider as SocialProvider);
    assert.equal(controller.state.phase, "signed-out");
  }
  assert.deepEqual(calls.providers, []);
  assert.deepEqual(calls.oauth, []);
  assert.deepEqual(calls.navigations, []);
});

for (const provider of ["google", "github"] as const) {
  test(`${provider} preflights availability and navigates only to a validated PKCE authorization URL`, async () => {
    const { controller, calls } = harness();
    await controller.start(callback);
    assert.deepEqual(calls.providers, []);
    await controller.signIn(provider);
    assert.deepEqual(calls.providers, [provider]);
    assert.deepEqual(calls.oauth, [{ provider, options: { redirectTo, skipBrowserRedirect: true } }]);
    assert.deepEqual(calls.navigations, [authorizationUrl(provider)]);
    assert.equal(controller.state.phase, "redirecting");
    assert.equal(controller.state.provider, provider);
    assert.equal(controller.state.user, null);
  });
}

test("a disabled provider leaves a recoverable error without changing the PKCE verifier", async () => {
  let enabled = false;
  const { controller, calls } = harness({}, { isProviderEnabled: async () => enabled });
  await controller.start(callback);
  await controller.signIn("google");
  assert.equal(controller.state.phase, "signed-out");
  assert.notEqual(controller.state.problem, "");
  assert.deepEqual(calls.oauth, []);
  assert.deepEqual(calls.navigations, []);
  enabled = true;
  await controller.signIn("github");
  assert.equal(calls.oauth.length, 1);
  assert.deepEqual(calls.navigations, [authorizationUrl("github")]);
  assert.equal(controller.state.problem, "");
});

test("a preflight network failure shows safe text and allows retry", async () => {
  let recovered = false;
  const { controller, calls } = harness({}, {
    isProviderEnabled: async () => {
      if (!recovered) throw new Error("private-server-detail");
      return true;
    },
  });
  await controller.start(callback);
  await controller.signIn("google");
  assert.equal(controller.state.phase, "signed-out");
  assert.notEqual(controller.state.problem, "");
  assert.doesNotMatch(controller.state.problem, /private-server-detail/);
  assert.deepEqual(calls.oauth, []);
  recovered = true;
  await controller.signIn("google");
  assert.equal(controller.state.phase, "redirecting");
  assert.equal(calls.navigations.length, 1);
});

test("preflight blocks repeated clicks on either social provider", async () => {
  const pending = deferred<boolean>();
  const { controller, calls } = harness({}, { isProviderEnabled: () => pending.promise });
  await controller.start(callback);
  const signingIn = controller.signIn("google");
  assert.equal(controller.state.phase, "redirecting");
  await controller.signIn("google");
  await controller.signIn("github");
  assert.deepEqual(calls.providers, ["google"]);
  assert.deepEqual(calls.oauth, []);
  pending.resolve(true);
  await signingIn;
  assert.equal(calls.oauth.length, 1);
  assert.deepEqual(calls.navigations, [authorizationUrl()]);
});

test("a pending SDK response blocks repeated clicks and keeps the original provider", async () => {
  const pending = deferred<OAuthReply>();
  const { controller, calls } = harness({ signInWithOAuth: () => pending.promise });
  await controller.start(callback);
  const signingIn = controller.signIn("google");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.oauth.length, 1);
  await controller.signIn("github");
  assert.equal(calls.oauth.length, 1);
  pending.resolve({ data: { url: authorizationUrl() }, error: null });
  await signingIn;
  assert.equal(controller.state.provider, "google");
  assert.deepEqual(calls.navigations, [authorizationUrl()]);
});

test("social login is ignored before initialization and for an authenticated account", async () => {
  const { controller, calls } = harness({ getUser: async () => ({ data: { user }, error: null }) });
  await controller.signIn("google");
  await controller.start(callback);
  await controller.signIn("github");
  assert.deepEqual(calls.providers, []);
  assert.deepEqual(calls.oauth, []);
  assert.equal(controller.state.phase, "signed-in");
});

for (const mode of ["returned error", "thrown error", "missing URL"] as const) {
  test(`an OAuth ${mode} leaves the browser in place and permits another attempt`, async () => {
    let recovered = false;
    const { controller, calls } = harness({
      signInWithOAuth: async () => {
        if (recovered) return { data: { url: authorizationUrl() }, error: null };
        if (mode === "thrown error") throw new Error("private-server-detail");
        return { data: { url: null }, error: mode === "returned error" ? { status: 503 } : null };
      },
    });
    await controller.start(callback);
    await controller.signIn("google");
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.user, null);
    assert.notEqual(controller.state.problem, "");
    assert.doesNotMatch(controller.state.problem, /private-server-detail/);
    assert.deepEqual(calls.navigations, []);
    recovered = true;
    await controller.signIn("google");
    assert.equal(calls.oauth.length, 2);
    assert.equal(controller.state.problem, "");
    assert.deepEqual(calls.navigations, [authorizationUrl()]);
  });
}

for (const error of [{ status: 429 }, { code: "over_request_rate_limit" }]) {
  test(`a provider rate limit has a safe retry notice: ${JSON.stringify(error)}`, async () => {
    const { controller, calls } = harness({ signInWithOAuth: async () => ({ data: { url: null }, error }) });
    await controller.start(callback);
    await controller.signIn("google");
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.notice, "");
    assert.match(controller.state.problem, /잠시/);
    assert.deepEqual(calls.navigations, []);
  });
}

const invalidAuthorizationUrls: [string, (url: URL) => void][] = [
  ["HTTP", (url) => { url.protocol = "http:"; }],
  ["foreign origin", (url) => { url.hostname = "attacker.example"; }],
  ["lookalike origin", (url) => { url.hostname = "project.example.com.attacker.example"; }],
  ["different port", (url) => { url.port = "444"; }],
  ["different endpoint", (url) => { url.pathname = "/auth/v1/logout"; }],
  ["userinfo", (url) => { url.username = "user"; }],
  ["password", (url) => { url.password = "secret"; }],
  ["fragment", (url) => { url.hash = "private-token"; }],
  ["wrong provider", (url) => { url.searchParams.set("provider", "github"); }],
  ["missing provider", (url) => { url.searchParams.delete("provider"); }],
  ["duplicate provider", (url) => { url.searchParams.append("provider", "github"); }],
  ["external callback", (url) => { url.searchParams.set("redirect_to", "https://attacker.example/"); }],
  ["different callback path", (url) => { url.searchParams.set("redirect_to", `${redirectTo}other`); }],
  ["missing callback", (url) => { url.searchParams.delete("redirect_to"); }],
  ["duplicate callback", (url) => { url.searchParams.append("redirect_to", "https://attacker.example/"); }],
  ["missing challenge", (url) => { url.searchParams.delete("code_challenge"); }],
  ["short challenge", (url) => { url.searchParams.set("code_challenge", "A".repeat(42)); }],
  ["invalid challenge encoding", (url) => { url.searchParams.set("code_challenge", `${"A".repeat(42)}=`); }],
  ["duplicate challenge", (url) => { url.searchParams.append("code_challenge", "B".repeat(43)); }],
  ["plain challenge", (url) => { url.searchParams.set("code_challenge_method", "plain"); }],
  ["missing challenge method", (url) => { url.searchParams.delete("code_challenge_method"); }],
  ["duplicate challenge method", (url) => { url.searchParams.append("code_challenge_method", "plain"); }],
];

for (const [reason, modify] of invalidAuthorizationUrls) {
  test(`rejects an authorization URL with ${reason}`, async () => {
    const url = new URL(authorizationUrl());
    modify(url);
    const { controller, calls } = harness({
      signInWithOAuth: async () => ({ data: { url: url.href }, error: null }),
    });
    await controller.start(callback);
    await controller.signIn("google");
    assert.equal(controller.state.phase, "signed-out");
    assert.notEqual(controller.state.problem, "");
    assert.deepEqual(calls.navigations, []);
  });
}

test("a malformed authorization URL is recoverable without navigation", async () => {
  const { controller, calls } = harness({
    signInWithOAuth: async () => ({ data: { url: "not a URL" }, error: null }),
  });
  await controller.start(callback);
  await controller.signIn("google");
  assert.equal(controller.state.phase, "signed-out");
  assert.deepEqual(calls.navigations, []);
});

test("navigation failure resets the buttons without exposing the exception", async () => {
  const { controller } = harness({}, { navigate() { throw new Error("private-navigation-detail"); } });
  await controller.start(callback);
  await controller.signIn("google");
  assert.equal(controller.state.phase, "signed-out");
  assert.notEqual(controller.state.problem, "");
  assert.doesNotMatch(controller.state.problem, /private-navigation-detail/);
});

test("signs out the current browser using local scope and ignores duplicate clicks", async () => {
  const pending = deferred<AuthReply>();
  const { controller, calls } = harness({
    getUser: async () => ({ data: { user }, error: null }),
    signOut: () => pending.promise,
  });
  await controller.start(callback);
  const signingOut = controller.signOut();
  assert.equal(controller.state.phase, "signing-out");
  await controller.signOut();
  assert.deepEqual(calls.signOut, [{ scope: "local" }]);
  pending.resolve({ error: null });
  await signingOut;
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
  assert.equal(controller.state.problem, "");
});

for (const mode of ["returned error", "thrown error"] as const) {
  test(`a signout ${mode} preserves the account and allows retry`, async () => {
    let recovered = false;
    const { controller, calls } = harness({
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => {
        if (recovered) return { error: null };
        if (mode === "thrown error") throw new Error("offline");
        return { error: { status: 500 } };
      },
    });
    await controller.start(callback);
    await controller.signOut();
    assert.equal(controller.state.phase, "signed-in");
    assert.deepEqual(controller.state.user, user);
    assert.notEqual(controller.state.problem, "");
    recovered = true;
    await controller.signOut();
    assert.equal(calls.signOut.length, 2);
    assert.equal(controller.state.phase, "signed-out");
  });
}

test("a delayed getUser reply cannot restore an account after logout in another tab", async () => {
  const pending = deferred<UserReply>();
  const { controller, states } = harness({ getUser: () => pending.promise });
  const started = controller.start(callback);
  controller.signedOutElsewhere();
  const updatesAfterLogout = states.length;
  pending.resolve({ data: { user }, error: null });
  await started;
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
  assert.equal(states.length, updatesAfterLogout);
});

for (const mode of ["success", "error", "rejection"] as const) {
  test(`a delayed callback exchange ${mode} cannot restore an account after cross-tab logout`, async () => {
    const pending = deferred<AuthReply>();
    const { controller, calls, states } = harness({
      exchangeCodeForSession: () => pending.promise,
      getUser: async () => ({ data: { user }, error: null }),
    });
    const started = controller.start({ code: "one-time-code", failed: false });
    controller.signedOutElsewhere();
    const updatesAfterLogout = states.length;
    if (mode === "rejection") pending.reject(new Error("offline"));
    else pending.resolve({ error: mode === "error" ? { code: "bad_code_verifier" } : null });
    await started;
    assert.equal(calls.getUser, 0);
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.user, null);
    assert.equal(controller.state.problem, "");
    assert.equal(states.length, updatesAfterLogout);
  });
}

for (const mode of ["enabled", "disabled", "rejection"] as const) {
  test(`a delayed provider preflight ${mode} cannot overwrite logout in another tab`, async () => {
    const pending = deferred<boolean>();
    const { controller, calls, states } = harness({}, { isProviderEnabled: () => pending.promise });
    await controller.start(callback);
    const signingIn = controller.signIn("google");
    controller.signedOutElsewhere();
    const updatesAfterLogout = states.length;
    if (mode === "rejection") pending.reject(new Error("offline"));
    else pending.resolve(mode === "enabled");
    await signingIn;
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.problem, "");
    assert.equal(states.length, updatesAfterLogout);
    assert.deepEqual(calls.oauth, []);
    assert.deepEqual(calls.navigations, []);
  });
}

for (const mode of ["success", "error", "rejection"] as const) {
  test(`a delayed OAuth ${mode} cannot navigate or overwrite logout in another tab`, async () => {
    const pending = deferred<OAuthReply>();
    const { controller, calls, states } = harness({ signInWithOAuth: () => pending.promise });
    await controller.start(callback);
    const signingIn = controller.signIn("google");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.oauth.length, 1);
    controller.signedOutElsewhere();
    const updatesAfterLogout = states.length;
    if (mode === "rejection") pending.reject(new Error("offline"));
    else pending.resolve({ data: { url: authorizationUrl() }, error: mode === "error" ? { status: 503 } : null });
    await signingIn;
    assert.equal(controller.state.phase, "signed-out");
    assert.equal(controller.state.problem, "");
    assert.equal(states.length, updatesAfterLogout);
    assert.deepEqual(calls.navigations, []);
  });
}

test("a delayed signout failure cannot restore an account after cross-tab logout", async () => {
  const pending = deferred<AuthReply>();
  const { controller } = harness({
    getUser: async () => ({ data: { user }, error: null }),
    signOut: () => pending.promise,
  });
  await controller.start(callback);
  const signingOut = controller.signOut();
  controller.signedOutElsewhere();
  pending.resolve({ error: { status: 500 } });
  await signingOut;
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
});

test("a stale refresh cannot replace a more recently verified account", async () => {
  const earlier = deferred<UserReply>();
  const later = deferred<UserReply>();
  let count = 0;
  const currentUser = { id: "account-2", email: "current@example.com" };
  const { controller } = harness({ getUser: () => (++count === 1 ? earlier.promise : later.promise) });
  const first = controller.refreshUser();
  const second = controller.refreshUser();
  later.resolve({ data: { user: currentUser }, error: null });
  await second;
  earlier.resolve({ data: { user }, error: null });
  await first;
  assert.equal(controller.state.phase, "signed-in");
  assert.deepEqual(controller.state.user, currentUser);
});
