import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const pluginRoot = path.join(repositoryRoot, "Plugin/blabee");
const manifestPath = path.join(pluginRoot, ".codex-plugin/plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const hooksPath = path.join(pluginRoot, "hooks/hooks.json");
const launcherPath = path.join(pluginRoot, "scripts/blabee-launcher");
const skillPath = path.join(pluginRoot, "skills/blabee-decision/SKILL.md");
const skillMetadataPath = path.join(pluginRoot, "skills/blabee-decision/agents/openai.yaml");

function guardedHookCommand(eventName) {
  return `if [ -n "\${PLUGIN_ROOT:-}" ] && [ -d "$PLUGIN_ROOT" ] && [ ! -L "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT/scripts" ] && [ ! -L "$PLUGIN_ROOT/scripts" ] && [ -f "$PLUGIN_ROOT/scripts/blabee-launcher" ] && [ ! -L "$PLUGIN_ROOT/scripts/blabee-launcher" ] && [ -x "$PLUGIN_ROOT/scripts/blabee-launcher" ]; then exec "$PLUGIN_ROOT/scripts/blabee-launcher" hook ${eventName}; fi; exit 0`;
}

async function json(pathname) {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(pathname));
    else if (entry.isFile()) result.push(pathname);
  }
  return result;
}

function run(executable, args, { cwd = repositoryRoot, env, input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function waitForFile(pathname, timeoutMilliseconds = 1_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await readFile(pathname);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${pathname}`);
}

test("plugin manifest has production metadata and relies on default hook discovery", async () => {
  const manifest = await json(manifestPath);

  assert.equal(manifest.name, "blabee");
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.author.name, "BiaDone");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.match(manifest.description, /[가-힣]/);
  assert.match(manifest.interface.shortDescription, /[가-힣]/);
  assert.match(manifest.interface.longDescription, /[가-힣]/);

  assert.ok(await readFile(hooksPath, "utf8"), "hooks/hooks.json must exist at the default discovery path");
});

test("four supported hooks call the native coordinator through the plugin launcher", async () => {
  const hookDocument = await json(hooksPath);
  const expected = {
    SessionStart: { timeout: 8, nativeBudget: 7 },
    UserPromptSubmit: { timeout: 8, nativeBudget: 7 },
    Stop: { timeout: 8, nativeBudget: 5 },
    PermissionRequest: { timeout: 60, nativeBudget: 57 },
  };

  assert.deepEqual(Object.keys(hookDocument.hooks).sort(), Object.keys(expected).sort());
  for (const [eventName, budget] of Object.entries(expected)) {
    const registrations = hookDocument.hooks[eventName];
    assert.equal(registrations.length, 1, eventName);
    assert.equal(registrations[0].hooks.length, 1, eventName);
    const hook = registrations[0].hooks[0];
    assert.equal(hook.type, "command", eventName);
    assert.equal(
      hook.command,
      guardedHookCommand(eventName),
      eventName,
    );
    assert.equal(hook.timeout, budget.timeout, eventName);
    assert.ok(
      hook.timeout > budget.nativeBudget,
      `${eventName}: Codex timeout must exceed the native connect + response budget`,
    );
  }
  assert.match(
    hookDocument.hooks.PermissionRequest[0].hooks[0].statusMessage,
    /확인/,
  );
  assert.equal(
    hookDocument.hooks.Stop[0].hooks[0].statusMessage,
    "Blabee 결정 저장 중",
  );
});

test("guarded Hook commands quote plugin roots and preserve valid launcher output", async () => {
  // Keep this comfortably below the smallest 5-second native Hook deadline,
  // while allowing loaded CI and developer Macs to schedule the shell/FIFO
  // helpers without turning harmless scheduler delay into a product failure.
  const responsiveHookUpperBoundMilliseconds = 2_500;
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-quoted-hook-"));
  const injectionMarkerName = "blabee-hook-injection-marker";
  const cachedPluginRoot = path.join(
    directory,
    `cached plugin ; $(touch ${injectionMarkerName}) [*]`,
  );
  const cachedLauncher = path.join(cachedPluginRoot, "scripts", "blabee-launcher");
  const fakeCoordinator = path.join(directory, "blabee-coordinator");
  const invocationLog = path.join(directory, "invocations.log");
  const hookDocument = await json(hooksPath);
  const commands = Object.fromEntries(
    Object.entries(hookDocument.hooks).map(([eventName, registrations]) => [
      eventName,
      registrations[0].hooks[0].command,
    ]),
  );

  try {
    await mkdir(path.dirname(cachedLauncher), { recursive: true });
    await writeFile(cachedLauncher, await readFile(launcherPath));
    await chmod(cachedLauncher, 0o755);
    await writeFile(
      fakeCoordinator,
      "#!/bin/sh\nprintf '%s:%s\\n' \"$1\" \"$2\" >> \"$BLABEE_HOOK_INVOCATION_LOG\"\n/bin/cat >/dev/null\nprintf 'hook-output:%s:%s' \"$1\" \"$2\"\nprintf 'private-stderr:%s:%s' \"$1\" \"$2\" >&2\nexit 0\n",
      "utf8",
    );
    await chmod(fakeCoordinator, 0o755);

    const env = {
      ...process.env,
      PLUGIN_ROOT: cachedPluginRoot,
      BLABEE_COORDINATOR_BINARY: fakeCoordinator,
      BLABEE_HOOK_INVOCATION_LOG: invocationLog,
    };
    for (const [eventName, command] of Object.entries(commands)) {
      const input = `payload:${eventName}:한글:\u0000\nsecond line\n`;
      const startedAt = Date.now();
      const result = await run("/bin/sh", ["-c", command], {
        cwd: directory,
        env,
        input,
      });
      const elapsedMilliseconds = Date.now() - startedAt;
      assert.equal(result.code, 0, eventName);
      assert.equal(result.signal, null, eventName);
      assert.equal(result.stdout, `hook-output:hook:${eventName}`, eventName);
      assert.equal(result.stderr, "", eventName);
      assert.ok(
        elapsedMilliseconds < responsiveHookUpperBoundMilliseconds,
        `${eventName}: valid Hook waited ${elapsedMilliseconds}ms`,
      );
    }
    assert.equal(
      await readFile(invocationLog, "utf8"),
      Object.keys(commands).map((eventName) => `hook:${eventName}\n`).join(""),
    );
    assert.equal((await readdir(directory)).includes(injectionMarkerName), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hook transport buffers output and fails open on child and output failures", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-hook-fail-open-"));
  const fakeCoordinator = path.join(directory, "blabee-coordinator");
  const inputLog = path.join(directory, "input.bin");
  const exactLimitOutput = path.join(directory, "exact-limit-output.bin");
  const oversizedOutput = path.join(directory, "oversized-output.bin");
  const timeoutOrphanMarker = path.join(directory, "timeout-orphan-marker");
  const successfulOrphanMarker = path.join(directory, "successful-orphan-marker");
  const validOutput = '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"한글"}}\n';
  const privateInput = Buffer.from("private-input\u0000한글\nsecond line\n", "utf8");
  const hookTempPrefix = "blabee-hook.";

  try {
    await writeFile(
      fakeCoordinator,
      `#!/bin/sh
/bin/cat > "$BLABEE_FAKE_INPUT_LOG"
case "$BLABEE_FAKE_MODE" in
  valid)
    /bin/cat "$BLABEE_FAKE_OUTPUT"
    printf 'must-never-reach-codex' >&2
    exit 0
    ;;
  nonzero)
    printf 'partial-output'
    printf 'private-failure' >&2
    exit 23
    ;;
  crash)
    /bin/kill -KILL $$
    ;;
  timeout)
    printf 'partial-before-timeout'
    /bin/sleep 2
    printf 'orphaned' > "$BLABEE_FAKE_TIMEOUT_MARKER"
    ;;
  orphan-success)
    printf 'partial-before-orphan'
    (
      trap '' TERM
      /bin/sleep 2
      printf 'orphaned' > "$BLABEE_FAKE_SUCCESSFUL_ORPHAN_MARKER"
    ) </dev/null >/dev/null 2>&1 &
    exit 0
    ;;
  exact-limit)
    /bin/cat "$BLABEE_FAKE_EXACT_LIMIT_OUTPUT"
    exit 0
    ;;
  oversized)
    /bin/cat "$BLABEE_FAKE_OVERSIZED_OUTPUT"
    exit 0
    ;;
esac
exit 91
`,
      "utf8",
    );
    await chmod(fakeCoordinator, 0o755);
    await writeFile(path.join(directory, "valid-output.json"), validOutput, "utf8");
    await writeFile(exactLimitOutput, Buffer.alloc(1_048_576, 0x61));
    await writeFile(oversizedOutput, Buffer.alloc(1_048_577, 0x61));

    const baseEnv = {
      ...process.env,
      BLABEE_COORDINATOR_BINARY: fakeCoordinator,
      BLABEE_FAKE_INPUT_LOG: inputLog,
      BLABEE_FAKE_OUTPUT: path.join(directory, "valid-output.json"),
      BLABEE_FAKE_EXACT_LIMIT_OUTPUT: exactLimitOutput,
      BLABEE_FAKE_OVERSIZED_OUTPUT: oversizedOutput,
      BLABEE_FAKE_TIMEOUT_MARKER: timeoutOrphanMarker,
      BLABEE_FAKE_SUCCESSFUL_ORPHAN_MARKER: successfulOrphanMarker,
      BLABEE_HOOK_DEADLINE_SECONDS: "1",
    };

    const beforeTempEntries = new Set(
      (await readdir(os.tmpdir())).filter((entry) => entry.startsWith(hookTempPrefix)),
    );
    const valid = await run(launcherPath, ["hook", "Stop"], {
      env: { ...baseEnv, BLABEE_FAKE_MODE: "valid" },
      input: privateInput,
    });
    assert.equal(valid.code, 0);
    assert.equal(valid.signal, null);
    assert.equal(valid.stdout, validOutput);
    assert.equal(valid.stderr, "");
    assert.deepEqual(await readFile(inputLog), privateInput);

    const exactLimit = await run(launcherPath, ["hook", "Stop"], {
      env: { ...baseEnv, BLABEE_FAKE_MODE: "exact-limit" },
      input: privateInput,
    });
    assert.equal(exactLimit.code, 0);
    assert.equal(exactLimit.signal, null);
    assert.equal(Buffer.byteLength(exactLimit.stdout, "utf8"), 1_048_576);
    assert.equal(exactLimit.stderr, "");

    for (const mode of ["nonzero", "crash", "timeout", "orphan-success", "oversized"]) {
      const startedAt = Date.now();
      const result = await run(launcherPath, ["hook", "Stop"], {
        env: { ...baseEnv, BLABEE_FAKE_MODE: mode },
        input: privateInput,
      });
      const elapsedMilliseconds = Date.now() - startedAt;
      assert.equal(result.code, 0, mode);
      assert.equal(result.signal, null, mode);
      assert.equal(result.stdout, "", mode);
      assert.equal(result.stderr, "", mode);
      assert.equal(`${result.stdout}${result.stderr}`.includes("private"), false, mode);
      assert.deepEqual(await readFile(inputLog), privateInput, mode);
      if (mode === "timeout") {
        assert.ok(elapsedMilliseconds < 3_000, `timeout took ${elapsedMilliseconds}ms`);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await assert.rejects(
          readFile(timeoutOrphanMarker),
          (error) => error?.code === "ENOENT",
        );
      }
      if (mode === "orphan-success") {
        assert.ok(
          elapsedMilliseconds < 1_500,
          `successful coordinator with orphan took ${elapsedMilliseconds}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2_200));
        await assert.rejects(
          readFile(successfulOrphanMarker),
          (error) => error?.code === "ENOENT",
        );
      }
    }

    const mcpFailure = await run(launcherPath, ["mcp"], {
      env: { ...baseEnv, BLABEE_FAKE_MODE: "nonzero" },
      input: privateInput,
    });
    assert.equal(mcpFailure.code, 23);
    assert.equal(mcpFailure.signal, null);
    assert.equal(mcpFailure.stdout, "partial-output");
    assert.equal(mcpFailure.stderr, "private-failure");

    const afterTempEntries = new Set(
      (await readdir(os.tmpdir())).filter((entry) => entry.startsWith(hookTempPrefix)),
    );
    assert.deepEqual(afterTempEntries, beforeTempEntries);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hook TERM performs bounded cleanup when the coordinator ignores TERM", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-hook-signal-"));
  const fakeCoordinator = path.join(directory, "blabee-coordinator");
  const startedMarker = path.join(directory, "coordinator-started");
  const completionMarker = path.join(directory, "coordinator-completed");

  try {
    await writeFile(
      fakeCoordinator,
      `#!/bin/sh
trap '' TERM
: > "$BLABEE_FAKE_STARTED_MARKER"
printf 'partial-before-signal'
/bin/sleep 2
printf 'completed' > "$BLABEE_FAKE_COMPLETION_MARKER"
`,
      "utf8",
    );
    await chmod(fakeCoordinator, 0o755);

    const startedAt = Date.now();
    const resultPromise = new Promise((resolve, reject) => {
      const child = spawn(launcherPath, ["hook", "Stop"], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          BLABEE_COORDINATOR_BINARY: fakeCoordinator,
          BLABEE_FAKE_STARTED_MARKER: startedMarker,
          BLABEE_FAKE_COMPLETION_MARKER: completionMarker,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
      child.stdin.end("private-input");

      waitForFile(startedMarker).then(
        () => child.kill("SIGTERM"),
        reject,
      );
    });

    const result = await resultPromise;
    const elapsedMilliseconds = Date.now() - startedAt;
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.ok(elapsedMilliseconds < 1_500, `signal cleanup took ${elapsedMilliseconds}ms`);

    await new Promise((resolve) => setTimeout(resolve, 2_200));
    await assert.rejects(
      readFile(completionMarker),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unusable or symlinked cached Hook launchers fail open silently", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-cached-hook-"));
  const privateValue = "private-cached-hook-payload";
  const unsafeMarkerName = "unsafe-launcher-invoked";
  const unsafeMarker = path.join(directory, unsafeMarkerName);
  const unsafeLauncher = path.join(directory, "unsafe-launcher");
  const deletedRoot = path.join(directory, "deleted-root");
  const launcherDirectoryRoot = path.join(directory, "launcher-directory-root");
  const nonExecutableRoot = path.join(directory, "non-executable-root");
  const symlinkScriptsRoot = path.join(directory, "symlink-scripts-root");
  const symlinkLauncherRoot = path.join(directory, "symlink-launcher-root");
  const symlinkRootTarget = path.join(directory, "symlink-root-target");
  const symlinkRoot = path.join(directory, "symlink-root");
  const hookDocument = await json(hooksPath);
  const commands = Object.fromEntries(
    Object.entries(hookDocument.hooks).map(([eventName, registrations]) => [
      eventName,
      registrations[0].hooks[0].command,
    ]),
  );

  try {
    await writeFile(
      unsafeLauncher,
      "#!/bin/sh\nprintf invoked > \"$BLABEE_UNSAFE_MARKER\"\n/bin/cat\nprintf unsafe >&2\nexit 31\n",
      "utf8",
    );
    await chmod(unsafeLauncher, 0o755);

    await mkdir(path.join(launcherDirectoryRoot, "scripts", "blabee-launcher"), {
      recursive: true,
    });
    await mkdir(path.join(nonExecutableRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(nonExecutableRoot, "scripts", "blabee-launcher"),
      await readFile(unsafeLauncher),
    );
    await chmod(path.join(nonExecutableRoot, "scripts", "blabee-launcher"), 0o644);
    await mkdir(symlinkScriptsRoot, { recursive: true });
    await mkdir(path.join(symlinkLauncherRoot, "scripts"), { recursive: true });
    await symlink(unsafeLauncher, path.join(symlinkLauncherRoot, "scripts", "blabee-launcher"));
    await mkdir(path.join(symlinkRootTarget, "scripts"), { recursive: true });
    await writeFile(
      path.join(symlinkRootTarget, "scripts", "blabee-launcher"),
      await readFile(unsafeLauncher),
    );
    await chmod(path.join(symlinkRootTarget, "scripts", "blabee-launcher"), 0o755);
    await symlink(
      path.join(symlinkRootTarget, "scripts"),
      path.join(symlinkScriptsRoot, "scripts"),
      "dir",
    );
    await symlink(symlinkRootTarget, symlinkRoot, "dir");

    // Packaged Plugin trees contain no symlinks. Reject symlinks at each fixed
    // executable path component without restricting ordinary real cache trees.
    const cases = [
      { name: "PLUGIN_ROOT unset", pluginRoot: undefined },
      { name: "PLUGIN_ROOT empty", pluginRoot: "" },
      { name: "deleted root", pluginRoot: deletedRoot },
      { name: "launcher directory", pluginRoot: launcherDirectoryRoot },
      { name: "non-executable launcher", pluginRoot: nonExecutableRoot },
      { name: "symlink scripts directory", pluginRoot: symlinkScriptsRoot },
      { name: "symlink launcher", pluginRoot: symlinkLauncherRoot },
      { name: "symlink root", pluginRoot: symlinkRoot },
    ];
    for (const scenario of cases) {
      const env = {
        ...process.env,
        BLABEE_UNSAFE_MARKER: unsafeMarker,
      };
      if (scenario.pluginRoot === undefined) delete env.PLUGIN_ROOT;
      else env.PLUGIN_ROOT = scenario.pluginRoot;

      for (const [eventName, command] of Object.entries(commands)) {
        const result = await run("/bin/sh", ["-c", command], {
          env,
          input: JSON.stringify({ hook_event_name: eventName, private_value: privateValue }),
        });
        const label = `${scenario.name}:${eventName}`;
        assert.equal(result.code, 0, `${label}: ${result.stderr}`);
        assert.equal(result.signal, null, label);
        assert.equal(result.stdout, "", label);
        assert.equal(result.stderr, "", label);
        assert.equal(`${result.stdout}${result.stderr}`.includes(privateValue), false, label);
      }
    }
    assert.equal((await readdir(directory)).includes(unsafeMarkerName), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP uses the plugin-local launcher without undocumented plugin-variable expansion", async () => {
  // PLUGIN_ROOT and PLUGIN_DATA are documented for Hook commands, not MCP config
  // expansion. A relative command and cwd keep MCP on the same launcher/runtime
  // discovery contract as Hooks without interpolating either variable.
  const mcp = await json(mcpPath);
  assert.deepEqual(Object.keys(mcp), ["mcpServers"]);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["blabee"]);
  assert.deepEqual(mcp.mcpServers.blabee, {
    command: "./scripts/blabee-launcher",
    args: ["mcp"],
    cwd: ".",
    env_vars: ["BLABEE_SOCKET"],
  });
  assert.equal(JSON.stringify(mcp).includes("PLUGIN_ROOT"), false);
  assert.equal(JSON.stringify(mcp).includes("PLUGIN_DATA"), false);
});

test("production plugin contains no M0 sentinel, fake coordinator, or unfinished placeholder", async () => {
  const forbidden = /sentinel|fake[-_ ]?coordinator|blabee[-_]?m0|\[?TODO\]?/i;
  for (const pathname of await filesUnder(pluginRoot)) {
    const content = await readFile(pathname, "utf8");
    assert.doesNotMatch(content, forbidden, path.relative(repositoryRoot, pathname));
  }
});

test("launcher forwards Hook input and leaves socket resolution to the native coordinator", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-native-"));
  const fakeCoordinator = path.join(directory, "blabee-coordinator");
  const pluginData = path.join(directory, "plugin data");
  const explicitSocket = path.join(directory, "explicit.sock");
  try {
    await writeFile(
      fakeCoordinator,
      "#!/bin/sh\nprintf '{\"hookSpecificOutput\":{\"hookEventName\":\"%s\",\"additionalContext\":\"%s\"}}\\n' \"$2\" \"$BLABEE_SOCKET\"\n",
      "utf8",
    );
    await chmod(fakeCoordinator, 0o755);
    const env = {
      ...process.env,
      BLABEE_COORDINATOR_BINARY: fakeCoordinator,
      BLABEE_SOCKET: explicitSocket,
      PLUGIN_DATA: pluginData,
    };

    const explicitResult = await run(launcherPath, ["hook", "SessionStart"], {
      env,
      input: JSON.stringify({ hook_event_name: "SessionStart", private_value: "must-not-be-logged" }),
    });

    assert.equal(explicitResult.code, 0, explicitResult.stderr);
    assert.equal(explicitResult.stderr, "");
    assert.deepEqual(JSON.parse(explicitResult.stdout), {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: explicitSocket,
      },
    });
    assert.equal(explicitResult.stdout.includes("must-not-be-logged"), false);

    delete env.BLABEE_SOCKET;
    const defaultResult = await run(launcherPath, ["hook", "UserPromptSubmit"], {
      env,
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    });
    assert.equal(defaultResult.code, 0, defaultResult.stderr);
    assert.deepEqual(JSON.parse(defaultResult.stdout), {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "",
      },
    });

    const launcher = await readFile(launcherPath, "utf8");
    assert.equal(launcher.includes("PLUGIN_DATA"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installed launcher discovers the dogfood coordinator through its runtime path contract", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-runtime-"));
  const installedPlugin = path.join(directory, "cached plugin");
  const installedLauncher = path.join(installedPlugin, "scripts", "blabee-launcher");
  const runtimePath = path.join(installedPlugin, "runtime", "coordinator-path");
  const fakeCoordinator = path.join(
    directory,
    "Blabee.app",
    "Contents",
    "MacOS",
    "blabee-coordinator",
  );
  try {
    await mkdir(path.dirname(installedLauncher), { recursive: true });
    await mkdir(path.dirname(runtimePath), { recursive: true });
    await mkdir(path.dirname(fakeCoordinator), { recursive: true });
    await writeFile(installedLauncher, await readFile(launcherPath));
    await chmod(installedLauncher, 0o755);
    await writeFile(
      fakeCoordinator,
      "#!/bin/sh\nprintf '%s\\n' \"$1:$2\"\n",
    );
    await chmod(fakeCoordinator, 0o755);
    await writeFile(runtimePath, `${fakeCoordinator}\n`);

    const env = { ...process.env };
    delete env.BLABEE_COORDINATOR_BINARY;
    const discovered = await run(installedLauncher, ["hook", "UserPromptSubmit"], {
      env,
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    });
    assert.equal(discovered.code, 0, discovered.stderr);
    assert.equal(discovered.stderr, "");
    assert.equal(discovered.stdout, "hook:UserPromptSubmit\n");

    const relativeMCP = await run("./scripts/blabee-launcher", ["mcp"], {
      cwd: installedPlugin,
      env,
    });
    assert.equal(relativeMCP.code, 0, relativeMCP.stderr);
    assert.equal(relativeMCP.stderr, "");
    assert.equal(relativeMCP.stdout, "mcp:\n");

    const relativeOverride = path.relative(repositoryRoot, fakeCoordinator);
    const rejectedRelative = await run(installedLauncher, ["hook", "SessionStart"], {
      env: { ...env, BLABEE_COORDINATOR_BINARY: relativeOverride },
      input: JSON.stringify({ hook_event_name: "SessionStart" }),
    });
    assert.equal(rejectedRelative.code, 0);
    assert.equal(rejectedRelative.stdout, "");
    assert.equal(rejectedRelative.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid runtime locators never fall back while an absent locator may use Applications", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-invalid-runtime-"));
  const installedPlugin = path.join(directory, "cached-plugin");
  const installedLauncher = path.join(installedPlugin, "scripts", "blabee-launcher");
  const runtimePath = path.join(installedPlugin, "runtime", "coordinator-path");
  const fallbackCoordinator = path.join(directory, "applications-fallback");
  const executableCoordinator = path.join(directory, "runtime-coordinator");
  const nonExecutableCoordinator = path.join(directory, "non-executable-coordinator");
  const linkedLocator = path.join(directory, "linked-coordinator-path");
  try {
    await mkdir(path.dirname(installedLauncher), { recursive: true });
    await mkdir(path.dirname(runtimePath), { recursive: true });
    const launcher = await readFile(launcherPath, "utf8");
    const instrumentedLauncher = launcher.replace(
      "/Applications/Blabee.app/Contents/MacOS/blabee-coordinator",
      fallbackCoordinator,
    );
    assert.notEqual(instrumentedLauncher, launcher);
    await writeFile(installedLauncher, instrumentedLauncher);
    await chmod(installedLauncher, 0o755);
    await writeFile(
      fallbackCoordinator,
      "#!/bin/sh\nprintf 'fallback:%s:%s\\n' \"$1\" \"$2\"\n",
    );
    await chmod(fallbackCoordinator, 0o755);
    await writeFile(executableCoordinator, "#!/bin/sh\nexit 0\n");
    await chmod(executableCoordinator, 0o755);
    await writeFile(nonExecutableCoordinator, "not executable\n");
    await writeFile(linkedLocator, `${executableCoordinator}\n`);

    const env = { ...process.env };
    delete env.BLABEE_COORDINATOR_BINARY;
    const absent = await run(installedLauncher, ["hook", "SessionStart"], { env });
    assert.equal(absent.code, 0, absent.stderr);
    assert.equal(absent.stdout, "fallback:hook:SessionStart\n");

    const invalidCases = [
      ["relative", async () => writeFile(runtimePath, "relative-coordinator\n")],
      ["malformed", async () => writeFile(runtimePath, Buffer.from([0xff, 0xfe, 0x0a]))],
      ["multi-line", async () => writeFile(
        runtimePath,
        `${executableCoordinator}\n${fallbackCoordinator}\n`,
      )],
      ["oversized", async () => writeFile(runtimePath, `/${"a".repeat(4096)}\n`)],
      ["non-executable", async () => writeFile(runtimePath, `${nonExecutableCoordinator}\n`)],
      ["directory", async () => mkdir(runtimePath)],
      ["symlink", async () => symlink(linkedLocator, runtimePath)],
    ];
    for (const [name, prepare] of invalidCases) {
      await rm(runtimePath, { recursive: true, force: true });
      await prepare();
      const hook = await run(installedLauncher, ["hook", "Stop"], { env });
      assert.equal(hook.code, 0, `${name}: ${hook.stderr}`);
      assert.equal(hook.stdout, "", name);
      assert.equal(hook.stderr, "", name);

      const mcp = await run("./scripts/blabee-launcher", ["mcp"], {
        cwd: installedPlugin,
        env,
      });
      assert.equal(mcp.code, 127, `${name}: ${mcp.stderr}`);
      assert.equal(mcp.stderr, "", name);
      assert.equal(JSON.parse(mcp.stdout).error.code, -32000, name);
      assert.equal(mcp.stdout.includes("fallback"), false, name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing native binary fails open for Hooks without leaking stdin", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-missing-hook-"));
  const privateValue = "private-hook-payload-value";
  try {
    const result = await run(launcherPath, ["hook", "Stop"], {
      env: {
        ...process.env,
        BLABEE_COORDINATOR_BINARY: path.join(directory, "missing"),
        PLUGIN_DATA: directory,
      },
      input: JSON.stringify({ last_assistant_message: privateValue }),
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(`${result.stdout}${result.stderr}`.includes(privateValue), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing native binary returns a clear JSON-RPC MCP error without leaking stdin", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blabee-plugin-missing-mcp-"));
  const privateValue = "private-mcp-token-value";
  try {
    const result = await run(launcherPath, ["mcp"], {
      env: {
        ...process.env,
        BLABEE_COORDINATOR_BINARY: path.join(directory, "missing"),
        PLUGIN_DATA: directory,
      },
      input: JSON.stringify({ correlation_token: privateValue }),
    });
    assert.equal(result.code, 127);
    assert.equal(result.stderr, "");
    const response = JSON.parse(result.stdout);
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, null);
    assert.equal(response.error.code, -32000);
    assert.match(response.error.message, /unavailable/i);
    assert.equal(result.stdout.includes(privateValue), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("decision skill applies suggestion modes and preserves the exact v1 contract", async () => {
  const skill = await readFile(skillPath, "utf8");
  const metadata = await readFile(skillMetadataPath, "utf8");
  const example = skill.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(example, "the complete tool payload example is required");
  const payload = JSON.parse(example[1]);

  assert.deepEqual(Object.keys(payload).sort(), [
    "correlation_token",
    "episode_id",
    "project_id",
    "proposal",
    "session_id",
    "source_prompt_id",
    "source_turn_id",
  ]);
  assert.deepEqual(Object.keys(payload.proposal).sort(), [
    "correlation_token",
    "interaction_kind",
    "next_actions",
    "outcome",
    "proposal_id",
    "reported_side_effects",
    "schema_version",
    "task_goal",
  ]);
  assert.equal(payload.proposal.schema_version, "1.0");
  assert.equal(payload.proposal.interaction_kind, "blabee_decision");
  assert.equal(payload.proposal.next_actions.length >= 2, true);
  assert.equal(payload.proposal.next_actions.length <= 4, true);
  assert.equal(payload.proposal.next_actions.every((action) => (
    Object.keys(action).sort().join(",") === "constraints,done_when,objective,title"
  )), true);
  assert.match(skill, /현재 Hook 컨텍스트의 `suggestion_mode`/);
  assert.match(skill, /이 필드만 없고.*`action_only`로 취급/);
  assert.match(skill, /### `action_only`/);
  assert.match(skill, /### `smart`/);
  assert.match(skill, /### `always`/);
  assert.match(skill, /서로 다른 유용한 후속 질문 또는 작업이 둘 이상/);
  assert.match(skill, /두 개 이상 기준은 설명·분석·일반 질문 응답에만 적용/);
  assert.match(skill, /실제로 제안할 수 있는 후속 항목이 둘 미만/);
  assert.match(skill, /proposal_source_prompt_mismatch/);
  assert.match(skill, /보정 재시도를 한 번/);
  assert.match(skill, /prompt 이외의 값도 다르거나/);
  assert.match(skill, /권한 승인이나 네이티브 질문/);
  assert.match(skill, /도구 호출이나 부수 효과를 명시적으로 금지/);
  assert.match(skill, /정확한 출력 하나, 명령의 정확히 한 번 실행 또는 추가 작업 금지/);
  assert.match(skill, /모든 답변을 번호 선택지나 고정된 1~4 형식으로 바꾸지 않는다/);
  assert.match(skill, /2~4개/);
  assert.match(skill, /첫 항목이 가장 권장/);
  assert.match(skill, /보류나 롤백을 이 배열에 넣지 않고/);
  assert.match(skill, /실행하지 않은 테스트/);
  assert.match(skill, /검증되지 않은 롤백 가능성/);
  assert.match(skill, /설명·분석 후속 제안도 기존/);
  assert.match(skill, /`suggestion_kind` 같은 새 필드를 추가하지 않는다/);
  assert.equal((skill.match(/`emit_decision`/g) ?? []).length, 3);
  assert.match(metadata, /\$blabee-decision/);
});
