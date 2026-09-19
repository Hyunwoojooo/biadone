import assert from "node:assert/strict";
import test from "node:test";
import { AccountController } from "../src/auth.ts";
import type { AuthPort } from "../src/auth.ts";
import { startAccountSession } from "../src/session.ts";

type UserReply = Awaited<ReturnType<AuthPort["getUser"]>>;
const callback = { code: null, failed: false };
const user = { id: "account-1", email: "member@example.com" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function harness(getUser: AuthPort["getUser"] = async () => ({ data: { user: null }, error: null })) {
  const calls: string[] = [];
  let inListener = false;
  let listener: (event: string) => void = () => { throw new Error("Listener has not subscribed"); };
  const controller = new AccountController({
    getUser() {
      calls.push(inListener ? "getUser inside auth listener" : "getUser");
      return getUser();
    },
    exchangeCodeForSession: async () => ({ error: null }),
    signInWithOAuth: async () => ({ data: { url: null }, error: null }),
    signOut: async () => ({ error: null }),
  }, "https://account.example.com/", () => {}, {
    authorizeUrl: "https://project.example.com/auth/v1/authorize",
    isProviderEnabled: async () => true,
    navigate: () => {},
  });
  function subscribe(next: (event: string) => void) {
    calls.push("subscribe");
    listener = next;
    return { unsubscribe() { calls.push("unsubscribe"); } };
  }
  function emit(event: string) {
    inListener = true;
    try { listener(event); } finally { inListener = false; }
  }
  return { controller, calls, subscribe, emit };
}

test("observes cross-tab logout before a pending startup getUser can restore an account", async () => {
  const pending = deferred<UserReply>();
  const { controller, calls, subscribe, emit } = harness(() => pending.promise);
  const startup = startAccountSession(controller, callback, subscribe);
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  emit("SIGNED_OUT");
  pending.resolve({ data: { user }, error: null });
  const subscription = await startup;
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  subscription.unsubscribe();
});

for (const event of ["SIGNED_IN", "USER_UPDATED"]) {
  test(`${event} verifies the user outside the auth listener's lock`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let requests = 0;
    const { controller, calls, subscribe, emit } = harness(async () => ({
      data: { user: ++requests === 1 ? null : user }, error: null,
    }));
    const subscription = await startAccountSession(controller, callback, subscribe);
    context.after(() => subscription.unsubscribe());
    emit(event);
    assert.deepEqual(calls, ["subscribe", "getUser"]);
    assert.equal(controller.state.phase, "signed-out");
    context.mock.timers.tick(0);
    await Promise.resolve();
    assert.deepEqual(calls, ["subscribe", "getUser", "getUser"]);
    assert.equal(controller.state.phase, "signed-in");
    assert.deepEqual(controller.state.user, user);
  });
}

test("a signup event during startup waits for initialization and then queues verification", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<UserReply>();
  const { controller, calls, subscribe, emit } = harness(() => pending.promise);
  const startup = startAccountSession(controller, callback, subscribe);
  emit("SIGNED_IN");
  context.mock.timers.tick(0);
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  pending.resolve({ data: { user }, error: null });
  const subscription = await startup;
  context.after(() => subscription.unsubscribe());
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser", "getUser"]);
  assert.equal(controller.state.phase, "signed-in");
});

test("a logout during startup cancels an earlier signup event's deferred verification", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<UserReply>();
  const { controller, calls, subscribe, emit } = harness(() => pending.promise);
  const startup = startAccountSession(controller, callback, subscribe);
  emit("SIGNED_IN");
  emit("SIGNED_OUT");
  pending.resolve({ data: { user }, error: null });
  const subscription = await startup;
  context.after(() => subscription.unsubscribe());
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
});

test("logout cancels a queued refresh before it starts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls, subscribe, emit } = harness(async () => ({ data: { user }, error: null }));
  const subscription = await startAccountSession(controller, callback, subscribe);
  context.after(() => subscription.unsubscribe());
  emit("SIGNED_IN");
  emit("SIGNED_OUT");
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser"]);
  assert.equal(controller.state.phase, "signed-out");
  assert.equal(controller.state.user, null);
});

test("unsubscribe cancels a queued refresh and ignores subsequently delivered events", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls, subscribe, emit } = harness(async () => ({ data: { user }, error: null }));
  const subscription = await startAccountSession(controller, callback, subscribe);
  emit("SIGNED_IN");
  subscription.unsubscribe();
  emit("USER_UPDATED");
  emit("SIGNED_OUT");
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser", "unsubscribe"]);
  assert.equal(controller.state.phase, "signed-in");
  assert.deepEqual(controller.state.user, user);
});

test("multiple queued account-change events share one verification request", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls, subscribe, emit } = harness(async () => ({ data: { user }, error: null }));
  const subscription = await startAccountSession(controller, callback, subscribe);
  context.after(() => subscription.unsubscribe());
  emit("SIGNED_IN");
  emit("USER_UPDATED");
  emit("SIGNED_IN");
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser", "getUser"]);
  assert.equal(controller.state.phase, "signed-in");
});

test("initial-session and token-refresh notifications do not create recursive auth requests", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, calls, subscribe, emit } = harness();
  const subscription = await startAccountSession(controller, callback, subscribe);
  context.after(() => subscription.unsubscribe());
  emit("INITIAL_SESSION");
  emit("TOKEN_REFRESHED");
  context.mock.timers.tick(0);
  await Promise.resolve();
  assert.deepEqual(calls, ["subscribe", "getUser"]);
});
