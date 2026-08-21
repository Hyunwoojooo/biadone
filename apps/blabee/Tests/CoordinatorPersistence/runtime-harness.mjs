import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const SWIFT_PACKAGE_ROOT = path.join(PROJECT_ROOT, "src", "coordinator-swift");
export const CONTRACTS_ROOT = path.join(PROJECT_ROOT, "Contracts", "v1");

let buildPromise;
let buildResult;
let productBuildPromise;
let productBuildResult;
let requestSequence = 0;

const KEYCHAIN_TEST_NAMESPACE_GATE = "BLABEE_T007B_ENABLE_KEYCHAIN_TEST_NAMESPACE";
const KEYCHAIN_TEST_ACCOUNT = "BLABEE_T007B_KEYCHAIN_ACCOUNT";
const KEYCHAIN_TEST_DELETE = "BLABEE_T007B_DELETE_KEYCHAIN_TEST_ANCHOR";

function requestId() {
  requestSequence += 1;
  return `persistence_request_${String(requestSequence).padStart(5, "0")}`;
}

async function swiftEnvironment(scratchPath) {
  assert.equal(
    process.platform,
    "darwin",
    "T-007b product runtime requires the macOS/Xcode test target",
  );
  const { stdout: developerDirectoryOutput } = await execFileAsync(
    "/usr/bin/xcode-select",
    ["-p"],
    { encoding: "utf8" },
  );
  let developerDirectory = developerDirectoryOutput.trim();
  const fullXcodeDeveloperDirectory = "/Applications/Xcode.app/Contents/Developer";
  try {
    await access(fullXcodeDeveloperDirectory, fsConstants.R_OK);
    developerDirectory = fullXcodeDeveloperDirectory;
  } catch {
    // Command Line Tools remain the supported fallback when full Xcode is absent.
  }
  assert.ok(developerDirectory, "xcode-select must resolve a developer directory");

  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
    SWIFTPM_MODULECACHE_OVERRIDE: path.join(scratchPath, "module-cache", "swiftpm"),
    CLANG_MODULE_CACHE_PATH: path.join(scratchPath, "module-cache", "clang"),
  };
  await Promise.all([
    mkdir(environment.SWIFTPM_MODULECACHE_OVERRIDE, { recursive: true }),
    mkdir(environment.CLANG_MODULE_CACHE_PATH, { recursive: true }),
  ]);
  const { stdout: swiftPathOutput } = await execFileAsync(
    "/usr/bin/xcrun",
    ["--find", "swift"],
    { encoding: "utf8", env: environment },
  );
  assert.ok(
    path.isAbsolute(swiftPathOutput.trim()),
    "the macOS/Xcode target must fail when the Swift compiler is unavailable",
  );
  return environment;
}

export async function buildCoordinator() {
  buildPromise ??= (async () => {
    const scratchPath = await mkdtemp(
      "/tmp/blabee-t007b-swift-build-",
    );
    const environment = await swiftEnvironment(scratchPath);
    const commonArguments = [
      "swift",
      "build",
      // This package has no dependency/plugin execution; disabling SwiftPM's
      // nested sandbox only keeps this external test build usable inside Codex.
      "--disable-sandbox",
      "--package-path",
      SWIFT_PACKAGE_ROOT,
      "--scratch-path",
      scratchPath,
      "--configuration",
      "debug",
      "-Xswiftc",
      "-DBLABEE_JOURNAL_TEST_HARNESS",
    ];
    try {
      await execFileAsync(
        "/usr/bin/xcrun",
        [...commonArguments, "--product", "blabee-coordinator"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          env: environment,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 240_000,
        },
      );
      const { stdout } = await execFileAsync(
        "/usr/bin/xcrun",
        [...commonArguments, "--show-bin-path"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          env: environment,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000,
        },
      );
      const binaryPath = path.join(stdout.trim(), "blabee-coordinator");
      await access(binaryPath, fsConstants.X_OK);
      assert.ok(
        path.resolve(binaryPath).startsWith(`${path.resolve("/tmp")}${path.sep}`),
        `Swift binary escaped the external scratch path: ${binaryPath}`,
      );
      buildResult = Object.freeze({ binaryPath, environment, scratchPath });
      return buildResult;
    } catch (error) {
      await rm(scratchPath, { force: true, recursive: true });
      if (error && typeof error === "object") {
        error.message = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
      }
      throw error;
    }
  })();
  return buildPromise;
}

export async function buildProductCoordinator() {
  productBuildPromise ??= (async () => {
    const scratchPath = await mkdtemp(
      "/tmp/blabee-t007b-product-swift-build-",
    );
    const environment = await swiftEnvironment(scratchPath);
    const commonArguments = [
      "swift",
      "build",
      "--disable-sandbox",
      "--package-path",
      SWIFT_PACKAGE_ROOT,
      "--scratch-path",
      scratchPath,
      "--configuration",
      "debug",
    ];
    try {
      await execFileAsync(
        "/usr/bin/xcrun",
        [...commonArguments, "--product", "blabee-coordinator"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          env: environment,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 240_000,
        },
      );
      const { stdout } = await execFileAsync(
        "/usr/bin/xcrun",
        [...commonArguments, "--show-bin-path"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          env: environment,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000,
        },
      );
      const binaryPath = path.join(stdout.trim(), "blabee-coordinator");
      await access(binaryPath, fsConstants.X_OK);
      assert.ok(
        path.resolve(binaryPath).startsWith(`${path.resolve("/tmp")}${path.sep}`),
        `Swift product binary escaped the external scratch path: ${binaryPath}`,
      );
      productBuildResult = Object.freeze({ binaryPath, environment, scratchPath });
      return productBuildResult;
    } catch (error) {
      await rm(scratchPath, { force: true, recursive: true });
      if (error && typeof error === "object") {
        error.message = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
      }
      throw error;
    }
  })();
  return productBuildPromise;
}

export async function cleanupCoordinatorBuild() {
  const scratchPaths = new Set(
    [buildResult?.scratchPath, productBuildResult?.scratchPath].filter(Boolean),
  );
  await Promise.all(
    [...scratchPaths].map((scratchPath) => rm(scratchPath, { force: true, recursive: true })),
  );
  buildResult = undefined;
  buildPromise = undefined;
  productBuildResult = undefined;
  productBuildPromise = undefined;
}

export async function createPersistenceWorkspace(prefix = "case") {
  const directory = await mkdtemp(
    path.join(tmpdir(), `blabee-t007b-${prefix}-`),
  );
  await chmod(directory, 0o700);
  const keyDirectory = path.join(directory, "keys");
  await mkdir(keyDirectory, { mode: 0o700 });
  await chmod(keyDirectory, 0o700);
  const keyPath = path.join(keyDirectory, "coordinator.key");
  const freshnessAccount = `test-${randomBytes(16).toString("hex")}`;
  return {
    databasePath: path.join(directory, "coordinator.sqlite3"),
    directory,
    freshnessAccount,
    keyDirectory,
    keyPath,
    async cleanup() {
      try {
        await deleteKeychainTestAnchor({
          account: freshnessAccount,
          databasePath: path.join(directory, "coordinator.sqlite3"),
          keyPath,
        });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}

export async function deleteKeychainTestAnchor({
  account: explicitAccount,
  databasePath,
  freshnessAccount,
  keyPath,
}) {
  const availableBuild = buildResult ?? productBuildResult;
  if (!availableBuild) return;
  const account = explicitAccount ?? freshnessAccount;
  assert.match(account, /^test-[a-f0-9]{32}$/);
  const environment = {
    ...availableBuild.environment,
    [KEYCHAIN_TEST_NAMESPACE_GATE]: "1",
    [KEYCHAIN_TEST_ACCOUNT]: account,
    [KEYCHAIN_TEST_DELETE]: "1",
  };
  delete environment.BLABEE_T007B_ENABLE_CRASH_INJECTION;
  await execFileAsync(
    availableBuild.binaryPath,
    [
      "--database", databasePath,
      "--key", keyPath,
      "--contracts", CONTRACTS_ROOT,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    },
  );
}

export async function readKeychainTestAnchor(workspace) {
  assert.match(workspace.freshnessAccount, /^test-[a-f0-9]{32}$/);
  const { stdout } = await execFileAsync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s", "com.biadone.blabee.coordinator.freshness.v1",
      "-a", workspace.freshnessAccount,
      "-w",
    ],
    {
      cwd: PROJECT_ROOT,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  const bytes = Buffer.from(stdout);
  return bytes.at(-1) === 0x0A ? bytes.subarray(0, bytes.length - 1) : bytes;
}

export async function createStorageKey(
  directory,
  filename,
  { bytes = randomBytes(32), mode = 0o600 } = {},
) {
  const keyPath = path.join(directory, filename);
  await writeFile(keyPath, bytes, { mode });
  await chmod(keyPath, mode);
  return keyPath;
}

export async function createKeySymlink(target, linkPath) {
  await symlink(target, linkPath);
  return linkPath;
}

export class RuntimeExitedError extends Error {
  constructor(result) {
    super(
      `coordinator exited before responding (code=${result.code}, signal=${result.signal})`,
    );
    this.name = "RuntimeExitedError";
    this.exitResult = result;
  }
}

export class CoordinatorClient {
  #child;
  #exitResult;
  #exitResolve;
  #pending = new Map();
  #stdoutBuffer = "";
  #stdoutChunks = [];
  #stderrChunks = [];

  constructor({
    binaryPath,
    contractsPath,
    databasePath,
    environment,
    environmentOverrides,
    freshnessAccount,
    keyPath,
  }) {
    const arguments_ = ["--database", databasePath, "--key", keyPath];
    if (contractsPath !== null) arguments_.push("--contracts", contractsPath);
    const childEnvironment = { ...environment };
    delete childEnvironment.BLABEE_T007B_ENABLE_CRASH_INJECTION;
    delete childEnvironment[KEYCHAIN_TEST_NAMESPACE_GATE];
    delete childEnvironment[KEYCHAIN_TEST_ACCOUNT];
    delete childEnvironment[KEYCHAIN_TEST_DELETE];
    if (freshnessAccount !== null) {
      childEnvironment[KEYCHAIN_TEST_NAMESPACE_GATE] = "1";
      childEnvironment[KEYCHAIN_TEST_ACCOUNT] = freshnessAccount;
    }
    Object.assign(childEnvironment, environmentOverrides);
    this.#child = spawn(
      binaryPath,
      arguments_,
      {
        cwd: PROJECT_ROOT,
        env: childEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.exit = new Promise((resolve) => {
      this.#exitResolve = resolve;
    });

    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => {
      this.#stdoutChunks.push(Buffer.from(chunk));
      this.#consumeStdout(chunk);
    });
    this.#child.stderr.on("data", (chunk) => this.#stderrChunks.push(Buffer.from(chunk)));
    this.#child.on("error", (error) => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.#pending.clear();
      if (this.#exitResult === undefined) {
        this.#exitResult = Object.freeze({ code: null, signal: null });
        this.#exitResolve(this.#exitResult);
      }
    });
    this.#child.on("exit", (code, signal) => {
      this.#exitResult ??= Object.freeze({ code, signal });
      const error = new RuntimeExitedError(this.#exitResult);
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.#pending.clear();
      this.#exitResolve(this.#exitResult);
    });
  }

  get childPid() {
    return this.#child.pid;
  }

  get closed() {
    return this.#exitResult !== undefined;
  }

  get stderrBytes() {
    return Buffer.concat(this.#stderrChunks);
  }

  get stdoutBytes() {
    return Buffer.concat(this.#stdoutChunks);
  }

  get stdoutText() {
    return this.stdoutBytes.toString("utf8");
  }

  get stderrText() {
    return this.stderrBytes.toString("utf8");
  }

  #consumeStdout(chunk) {
    this.#stdoutBuffer += chunk;
    for (;;) {
      const newline = this.#stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#stdoutBuffer.slice(0, newline).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("invalid coordinator NDJSON response", { cause: error }));
        }
        this.#pending.clear();
        continue;
      }
      const pending = this.#pending.get(response.request_id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.#pending.delete(response.request_id);
      pending.resolve(response);
    }
  }

  request(request, timeoutMs = 15_000) {
    assert.equal(this.closed, false, "cannot request from a closed coordinator");
    const request_id = request.request_id ?? requestId();
    const envelope = { ...request, request_id };
    return this.#sendLine(JSON.stringify(envelope), request_id, timeoutMs);
  }

  requestExpecting(request, responseRequestID, timeoutMs = 15_000) {
    assert.equal(this.closed, false, "cannot request from a closed coordinator");
    assert.equal(typeof request.request_id, "string", "explicit request_id is required");
    return this.#sendLine(JSON.stringify(request), responseRequestID, timeoutMs);
  }

  requestRawLine(line, responseRequestID, timeoutMs = 15_000) {
    assert.equal(this.closed, false, "cannot request from a closed coordinator");
    assert.equal(typeof line, "string", "raw NDJSON line must be a string");
    return this.#sendLine(line, responseRequestID, timeoutMs);
  }

  #sendLine(line, responseRequestID, timeoutMs) {
    assert.equal(
      this.#pending.has(responseRequestID),
      false,
      "a request with the same response correlation is already pending",
    );
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(responseRequestID);
        reject(new Error(`coordinator request exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(responseRequestID, { reject, resolve, timeout });
      this.#child.stdin.write(`${line}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.#pending.delete(responseRequestID);
        reject(error);
      });
    });
  }

  async close() {
    if (this.closed) return this.#exitResult;
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 5_000);
    try {
      return await this.exit;
    } finally {
      clearTimeout(timer);
    }
  }

  async kill(signal = "SIGKILL") {
    if (!this.closed) this.#child.kill(signal);
    return await this.exit;
  }
}

export async function launchCoordinator(
  workspace,
  {
    contractsPath = CONTRACTS_ROOT,
    databasePath = workspace.databasePath,
    environmentOverrides = {},
    freshnessAccount = workspace.freshnessAccount,
    keyPath = workspace.keyPath,
  } = {},
) {
  const build = await buildCoordinator();
  return new CoordinatorClient({
    binaryPath: build.binaryPath,
    contractsPath,
    databasePath,
    environment: build.environment,
    environmentOverrides,
    freshnessAccount,
    keyPath,
  });
}

export async function launchProductCoordinator(
  workspace,
  {
    contractsPath = CONTRACTS_ROOT,
    databasePath = workspace.databasePath,
    environmentOverrides = {},
    freshnessAccount = workspace.freshnessAccount,
    keyPath = workspace.keyPath,
  } = {},
) {
  const build = await buildProductCoordinator();
  return new CoordinatorClient({
    binaryPath: build.binaryPath,
    contractsPath,
    databasePath,
    environment: build.environment,
    environmentOverrides,
    freshnessAccount,
    keyPath,
  });
}

export async function sqlite(databasePath, sql) {
  return await execFileAsync("/usr/bin/sqlite3", [databasePath, sql], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
}

export async function existingDatabaseArtifacts(databasePath) {
  const output = [];
  for (const filename of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      output.push({ filename, bytes: await readFile(filename) });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return output;
}

export function structuredLogCodes(stderr) {
  const codes = [];
  for (const line of stderr.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const code = entry.code ?? entry.error?.code;
      if (typeof code === "string") codes.push(code);
    } catch {
      // A malformed diagnostic is caught by the tests that inspect all log lines.
    }
  }
  return codes;
}
