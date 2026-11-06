import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CLAUDE_RUNTIME_PACKAGES } from "../../scripts/prepare-claude-runtime.mjs";

// The Swift qualifier in the shipped app (ClaudeRuntimePayload.packageVersions)
// must pin exactly the package versions the Node preparation script bundles.
// If they drift, the app rejects its own bundled Claude runtime at first use
// (claude_runtime_payload_invalid), which only the optional packaged-runtime
// Swift test would otherwise reveal. r90 (2026-11-06) was built with such a
// drift and was discarded before publication.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function swiftDictionary(source, name) {
  const start = source.indexOf(`static let ${name} = [`);
  assert.notEqual(start, -1, `${name} not found in ClaudeRuntimePayload.swift`);
  const body = source.slice(start + `static let ${name} = [`.length, source.indexOf("]", start));
  return Object.fromEntries([...body.matchAll(/"([^"]+)":\s*"([^"]+)"/gu)].map(([, key, value]) => [key, value]));
}

test("Swift qualifier package pins match the Node runtime package list", async () => {
  const swift = await readFile(join(root, "bridges/claude/swift/service/ClaudeRuntimePayload.swift"), "utf8");
  assert.deepEqual(swiftDictionary(swift, "packageVersions"), { ...CLAUDE_RUNTIME_PACKAGES });
});

test("Node runtime package list matches the bridge lock file", async () => {
  const lock = JSON.parse(await readFile(join(root, "bridges/claude/package-lock.json"), "utf8"));
  assert.equal(lock.lockfileVersion, 3);
  const locked = Object.fromEntries(Object.keys(CLAUDE_RUNTIME_PACKAGES)
    .map((name) => [name, lock.packages[`node_modules/${name}`]?.version]));
  assert.deepEqual(locked, { ...CLAUDE_RUNTIME_PACKAGES });
});
