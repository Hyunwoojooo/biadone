import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const pluginRoot = path.join(repositoryRoot, "Plugin/blabee");

function runCodex(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function expectCodexJSON(args, env) {
  const result = await runCodex(args, env);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  assert.doesNotMatch(result.stderr, /panic|backtrace/i);
  return JSON.parse(result.stdout);
}

function containsJSONValue(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((entry) => containsJSONValue(entry, expected));
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => containsJSONValue(entry, expected));
  }
  return false;
}

test("Codex can install, cache-bust update, remove, and forget an isolated Blabee plugin", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "blabee-t011-plugin-lifecycle-"));
  const codexHome = path.join(temporaryRoot, "codex-home");
  const marketplaceRoot = path.join(temporaryRoot, "marketplace");
  const marketplaceConfigDirectory = path.join(marketplaceRoot, ".agents/plugins");
  const marketplacePlugin = path.join(marketplaceRoot, "plugins/blabee");
  const marketplaceName = "blabee-t011-test";
  const selector = `blabee@${marketplaceName}`;
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    NO_COLOR: "1",
  };

  try {
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await mkdir(marketplaceConfigDirectory, { recursive: true });
    await mkdir(path.dirname(marketplacePlugin), { recursive: true });
    await cp(pluginRoot, marketplacePlugin, { recursive: true });
    await writeFile(
      path.join(marketplaceConfigDirectory, "marketplace.json"),
      `${JSON.stringify({
        name: marketplaceName,
        interface: { displayName: "Blabee T-011 Test" },
        plugins: [{
          name: "blabee",
          source: { source: "local", path: "./plugins/blabee" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const marketplaceAdd = await expectCodexJSON(
      ["plugin", "marketplace", "add", marketplaceRoot, "--json"],
      env,
    );
    assert.equal(containsJSONValue(marketplaceAdd, marketplaceName), true);

    const available = await expectCodexJSON(
      ["plugin", "list", "--marketplace", marketplaceName, "--available", "--json"],
      env,
    );
    assert.equal(containsJSONValue(available, "blabee"), true);

    const initialInstall = await expectCodexJSON(["plugin", "add", selector, "--json"], env);
    assert.equal(containsJSONValue(initialInstall, "blabee"), true);

    const installed = await expectCodexJSON(["plugin", "list", "--json"], env);
    assert.equal(containsJSONValue(installed, "blabee"), true);
    assert.equal(containsJSONValue(installed, "0.1.0"), true);

    const manifestPath = path.join(marketplacePlugin, ".codex-plugin/plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "0.1.0+codex.local-t011test";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const updateInstall = await expectCodexJSON(["plugin", "add", selector, "--json"], env);
    assert.equal(containsJSONValue(updateInstall, "blabee"), true);

    const updated = await expectCodexJSON(["plugin", "list", "--json"], env);
    assert.equal(containsJSONValue(updated, "0.1.0+codex.local-t011test"), true);

    const removePlugin = await expectCodexJSON(["plugin", "remove", selector, "--json"], env);
    assert.equal(containsJSONValue(removePlugin, "blabee"), true);

    const afterRemove = await expectCodexJSON(["plugin", "list", "--json"], env);
    assert.equal(containsJSONValue(afterRemove, "blabee"), false);

    const removeMarketplace = await expectCodexJSON(
      ["plugin", "marketplace", "remove", marketplaceName, "--json"],
      env,
    );
    assert.equal(containsJSONValue(removeMarketplace, marketplaceName), true);

    const marketplaces = await expectCodexJSON(["plugin", "marketplace", "list", "--json"], env);
    assert.equal(containsJSONValue(marketplaces, marketplaceName), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
