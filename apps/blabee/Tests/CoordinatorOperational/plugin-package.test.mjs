import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

function run(executable, args, { env, input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repositoryRoot,
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
    Stop: { timeout: 130, nativeBudget: 127 },
    PermissionRequest: { timeout: 8, nativeBudget: 7 },
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
      `"$PLUGIN_ROOT/scripts/blabee-launcher" hook ${eventName}`,
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
    /알림/,
  );
});

test("MCP uses one installed native server on PATH without undocumented plugin-variable expansion", async () => {
  // PLUGIN_ROOT and PLUGIN_DATA are documented for Hook commands, not MCP config
  // expansion. T-011 therefore delegates PATH/app installation to T-012 and
  // lets every native entry point resolve the same default socket itself.
  const mcp = await json(mcpPath);
  assert.deepEqual(Object.keys(mcp), ["mcpServers"]);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["blabee"]);
  assert.deepEqual(mcp.mcpServers.blabee, {
    command: "blabee-coordinator",
    args: ["mcp"],
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

test("decision skill gates emission and preserves the exact wrapper/proposal contract", async () => {
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
    "alternative_next",
    "correlation_token",
    "interaction_kind",
    "outcome",
    "pause_capsule",
    "proposal_id",
    "recommended_next",
    "reported_side_effects",
    "schema_version",
    "task_goal",
  ]);
  assert.equal(payload.proposal.schema_version, "1.0");
  assert.equal(payload.proposal.interaction_kind, "blabee_decision");
  assert.match(skill, /기본적으로 한 번 호출/);
  assert.match(skill, /proposal_source_prompt_mismatch/);
  assert.match(skill, /보정 재시도를 한 번/);
  assert.match(skill, /prompt 이외의 값도 다르거나/);
  assert.match(skill, /설명, 코드 구조 설명, 상태 확인, 일반 질문/);
  assert.match(skill, /권한 승인이나 네이티브 질문/);
  assert.match(skill, /모든 답변을 번호 선택지나 고정된 1~4 형식으로 바꾸지 않는다/);
  assert.match(skill, /실행하지 않은 테스트/);
  assert.match(skill, /검증되지 않은 롤백 가능성/);
  assert.equal((skill.match(/`emit_decision`/g) ?? []).length, 1);
  assert.match(metadata, /\$blabee-decision/);
});
