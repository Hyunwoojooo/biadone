#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalChatGPTFetcher } from "./local-chatgpt-fetcher.mjs";

const FETCHER_URL_ENV = "CHATGPT_SHARE_FETCHER_URL";
const FETCHER_SECRET_ENV = "CHATGPT_SHARE_FETCHER_SECRET";
const DEV_FETCHER_BINDINGS_ENV = "GPTMEMORY_DEV_FETCHER_BINDINGS";
const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
};
const FORCE_KILL_AFTER_MS = 5_000;

export class DevConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevConfigurationError";
  }
}

export function resolveFetcherConfig(env = process.env) {
  const url = env[FETCHER_URL_ENV]?.trim() ?? "";
  const secret = env[FETCHER_SECRET_ENV] ?? "";
  const hasUrl = url.length > 0;
  const hasSecret = secret.trim().length > 0;

  if (hasUrl !== hasSecret) {
    throw new DevConfigurationError(
      `${FETCHER_URL_ENV} and ${FETCHER_SECRET_ENV} must be set together.`,
    );
  }

  if (hasUrl) {
    return { mode: "external", url, secret };
  }

  return { mode: "local" };
}

export function createFetcherSecret() {
  return randomBytes(32).toString("base64url");
}

function isChildRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

export async function runDev({
  args = process.argv.slice(2),
  env = process.env,
  signalTarget = process,
  spawnProcess = spawn,
  startFetcher = startLocalChatGPTFetcher,
  createSecret = createFetcherSecret,
  log = console.log,
  logError = console.error,
} = {}) {
  const fetcherConfig = resolveFetcherConfig(env);
  let bridge;
  let child;
  let closePromise;
  let forceKillTimer;
  let shutdownSignal;

  const closeBridge = () => {
    if (!bridge) {
      return Promise.resolve();
    }

    closePromise ??= Promise.resolve()
      .then(() => bridge.close())
      .catch(() => {
        logError("[gptmemory] Failed to close the local ChatGPT fetch bridge.");
      });

    return closePromise;
  };

  const handleSignal = (signal) => {
    if (shutdownSignal) {
      return;
    }

    shutdownSignal = signal;
    void closeBridge();

    if (child && isChildRunning(child)) {
      child.kill(signal);
      forceKillTimer = setTimeout(() => {
        if (child && isChildRunning(child)) {
          child.kill("SIGKILL");
        }
      }, FORCE_KILL_AFTER_MS);
      forceKillTimer.unref?.();
    }
  };

  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  signalTarget.once("SIGINT", handleSigint);
  signalTarget.once("SIGTERM", handleSigterm);

  try {
    let fetcherUrl;
    let fetcherSecret;

    if (fetcherConfig.mode === "external") {
      fetcherUrl = fetcherConfig.url;
      fetcherSecret = fetcherConfig.secret;
      log("[gptmemory] Using the configured ChatGPT share fetcher.");
    } else {
      fetcherSecret = createSecret();
      bridge = await startFetcher({
        host: "127.0.0.1",
        port: 0,
        secret: fetcherSecret,
      });
      fetcherUrl = bridge.url;

      if (typeof fetcherUrl !== "string" || typeof bridge.close !== "function") {
        throw new Error("The local ChatGPT fetch bridge returned an invalid handle.");
      }

      log("[gptmemory] Local ChatGPT fetch bridge ready.");
    }

    if (shutdownSignal) {
      return SIGNAL_EXIT_CODES[shutdownSignal] ?? 1;
    }

    const childEnv = {
      ...env,
      WRANGLER_LOG_PATH:
        env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
      [FETCHER_URL_ENV]: fetcherUrl,
      [FETCHER_SECRET_ENV]: fetcherSecret,
      [DEV_FETCHER_BINDINGS_ENV]: "1",
    };
    const executable = process.platform === "win32" ? "vinext.cmd" : "vinext";

    child = spawnProcess(executable, ["dev", ...args], {
      env: childEnv,
      stdio: "inherit",
    });

    const childResult = new Promise((resolveChild, rejectChild) => {
      child.once("error", rejectChild);
      child.once("exit", (code, signal) => resolveChild({ code, signal }));
    });
    const bridgeResult =
      bridge?.closed && typeof bridge.closed.then === "function"
        ? Promise.resolve(bridge.closed).then(
            () => ({ kind: "bridge" }),
            () => ({ kind: "bridge" }),
          )
        : undefined;

    let result;
    if (bridgeResult) {
      const firstResult = await Promise.race([
        childResult.then((value) => ({ kind: "child", value })),
        bridgeResult,
      ]);

      if (firstResult.kind === "bridge") {
        if (!shutdownSignal) {
          logError(
            "[gptmemory] Local ChatGPT fetch bridge stopped unexpectedly.",
          );
          handleSignal("SIGTERM");
        }
        result = await childResult;
      } else {
        result = firstResult.value;
      }
    } else {
      result = await childResult;
    }

    if (typeof result.code === "number") {
      return result.code;
    }

    return SIGNAL_EXIT_CODES[result.signal ?? shutdownSignal] ?? 1;
  } finally {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
    signalTarget.off("SIGINT", handleSigint);
    signalTarget.off("SIGTERM", handleSigterm);
    await closeBridge();
  }
}

function isMainModule() {
  return Boolean(
    process.argv[1] &&
      resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)),
  );
}

if (isMainModule()) {
  try {
    process.exitCode = await runDev();
  } catch (error) {
    if (error instanceof DevConfigurationError) {
      console.error(`[gptmemory] ${error.message}`);
    } else {
      console.error("[gptmemory] Failed to start the development server.");
    }

    process.exitCode = 1;
  }
}
