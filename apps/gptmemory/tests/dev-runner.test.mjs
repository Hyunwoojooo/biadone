import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createFetcherSecret,
  DevConfigurationError,
  resolveFetcherConfig,
  runDev,
} from "../tools/dev.mjs";

test("fetcher config requires URL and secret together", () => {
  assert.deepEqual(resolveFetcherConfig({}), { mode: "local" });
  assert.deepEqual(
    resolveFetcherConfig({
      CHATGPT_SHARE_FETCHER_URL: " https://fetcher.example.test ",
      CHATGPT_SHARE_FETCHER_SECRET: " test-secret ",
    }),
    {
      mode: "external",
      url: "https://fetcher.example.test",
      secret: " test-secret ",
    },
  );

  assert.throws(
    () =>
      resolveFetcherConfig({
        CHATGPT_SHARE_FETCHER_URL: "https://fetcher.example.test",
      }),
    DevConfigurationError,
  );
  assert.throws(
    () =>
      resolveFetcherConfig({ CHATGPT_SHARE_FETCHER_SECRET: "test-secret" }),
    DevConfigurationError,
  );
});

test("generated fetcher secrets are non-empty and distinct", () => {
  const first = createFetcherSecret();
  const second = createFetcherSecret();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("dev runner starts a local bridge, forwards args, and closes it", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;

  const calls = { close: 0 };
  let bridgeOptions;
  let spawnCall;
  const logs = [];

  const resultPromise = runDev({
    args: ["--hostname", "127.0.0.1", "--port", "3101"],
    env: { PATH: "/test/bin" },
    createSecret: () => "ephemeral-test-secret",
    startFetcher: async (options) => {
      bridgeOptions = options;
      return {
        url: "http://127.0.0.1:43210/fetch",
        close: async () => {
          calls.close += 1;
        },
      };
    },
    spawnProcess: (command, args, options) => {
      spawnCall = { command, args, options };
      return child;
    },
    log: (message) => logs.push(message),
    logError: (message) => logs.push(message),
  });

  queueMicrotask(() => {
    child.exitCode = 0;
    child.emit("exit", 0, null);
  });

  assert.equal(await resultPromise, 0);
  assert.deepEqual(bridgeOptions, {
    host: "127.0.0.1",
    port: 0,
    secret: "ephemeral-test-secret",
  });
  assert.deepEqual(spawnCall.args, [
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3101",
  ]);
  assert.equal(
    spawnCall.options.env.CHATGPT_SHARE_FETCHER_URL,
    "http://127.0.0.1:43210/fetch",
  );
  assert.equal(
    spawnCall.options.env.CHATGPT_SHARE_FETCHER_SECRET,
    "ephemeral-test-secret",
  );
  assert.equal(
    spawnCall.options.env.GPTMEMORY_DEV_FETCHER_BINDINGS,
    "1",
  );
  assert.equal(calls.close, 1);
  assert.equal(
    logs.some((message) => message.includes("ephemeral-test-secret")),
    false,
  );
});

test("dev runner reuses a complete external fetcher configuration", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;

  let startCalls = 0;
  let childEnv;
  const resultPromise = runDev({
    env: {
      CHATGPT_SHARE_FETCHER_URL: "https://fetcher.example.test",
      CHATGPT_SHARE_FETCHER_SECRET: "external-test-secret",
    },
    startFetcher: async () => {
      startCalls += 1;
      throw new Error("should not start");
    },
    spawnProcess: (_command, _args, options) => {
      childEnv = options.env;
      return child;
    },
    log: () => {},
    logError: () => {},
  });

  queueMicrotask(() => {
    child.exitCode = 0;
    child.emit("exit", 0, null);
  });

  assert.equal(await resultPromise, 0);
  assert.equal(startCalls, 0);
  assert.equal(
    childEnv.CHATGPT_SHARE_FETCHER_URL,
    "https://fetcher.example.test",
  );
  assert.equal(
    childEnv.CHATGPT_SHARE_FETCHER_SECRET,
    "external-test-secret",
  );
  assert.equal(childEnv.GPTMEMORY_DEV_FETCHER_BINDINGS, "1");
});

test("dev runner forwards a shutdown signal once and closes the bridge", async () => {
  const signalTarget = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const receivedSignals = [];
  child.kill = (signal) => {
    receivedSignals.push(signal);
    return true;
  };

  let closeCalls = 0;
  const resultPromise = runDev({
    env: {},
    signalTarget,
    startFetcher: async () => ({
      url: "http://127.0.0.1:43210/fetch",
      close: async () => {
        closeCalls += 1;
      },
    }),
    spawnProcess: () => child,
    log: () => {},
    logError: () => {},
  });

  queueMicrotask(() => {
    signalTarget.emit("SIGINT");
    signalTarget.emit("SIGTERM");
    child.signalCode = "SIGINT";
    child.emit("exit", null, "SIGINT");
  });

  assert.equal(await resultPromise, 130);
  assert.deepEqual(receivedSignals, ["SIGINT"]);
  assert.equal(closeCalls, 1);
});

test("dev runner closes a bridge without spawning after a startup signal", async () => {
  const signalTarget = new EventEmitter();
  let resolveFetcher;
  const fetcherStarted = new Promise((resolveStart) => {
    resolveFetcher = resolveStart;
  });
  let closeCalls = 0;
  let spawnCalls = 0;

  const resultPromise = runDev({
    env: {},
    signalTarget,
    startFetcher: () => fetcherStarted,
    spawnProcess: () => {
      spawnCalls += 1;
      throw new Error("should not spawn");
    },
    log: () => {},
    logError: () => {},
  });

  signalTarget.emit("SIGTERM");
  resolveFetcher({
    url: "http://127.0.0.1:43210/fetch",
    close: async () => {
      closeCalls += 1;
    },
  });

  assert.equal(await resultPromise, 143);
  assert.equal(spawnCalls, 0);
  assert.equal(closeCalls, 1);
});

test("dev runner terminates vinext when the local bridge stops", async () => {
  const signalTarget = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const receivedSignals = [];
  child.kill = (signal) => {
    receivedSignals.push(signal);
    queueMicrotask(() => {
      child.signalCode = signal;
      child.emit("exit", null, signal);
    });
    return true;
  };

  let resolveClosed;
  const closed = new Promise((resolveBridge) => {
    resolveClosed = resolveBridge;
  });
  const errors = [];
  const resultPromise = runDev({
    env: {},
    signalTarget,
    startFetcher: async () => ({
      url: "http://127.0.0.1:43210/fetch",
      closed,
      close: async () => resolveClosed(),
    }),
    spawnProcess: () => child,
    log: () => {},
    logError: (message) => errors.push(message),
  });

  queueMicrotask(() => resolveClosed());

  assert.equal(await resultPromise, 143);
  assert.deepEqual(receivedSignals, ["SIGTERM"]);
  assert.deepEqual(errors, [
    "[gptmemory] Local ChatGPT fetch bridge stopped unexpectedly.",
  ]);
});
