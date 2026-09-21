import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CLAUDE_RUNTIME_PACKAGES, CLAUDE_RUNTIME_SOURCE_FILES, prepareClaudeRuntime } from "../../scripts/prepare-claude-runtime.mjs";

const packageEntries = {
  "@modelcontextprotocol/sdk": ["dist/esm/server/index.js", "dist/esm/server/stdio.js", "dist/esm/types.js"],
  zod: ["index.js", "v3/index.js", "v4/index.js", "v4-mini/index.js"],
  "zod-to-json-schema": ["dist/esm/index.js", "dist/esm/package.json"],
  ajv: ["dist/ajv.js"], "ajv-formats": ["dist/index.js"], "fast-deep-equal": ["index.js"],
  "fast-uri": ["index.js"], "json-schema-traverse": ["index.js"], "require-from-string": ["index.js"],
};

export async function fixtureFile(path, contents, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, contents, { mode });
  await chmod(path, mode);
}

export async function makeClaudeRuntimeFixture(t, { prepared = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "blabee-claude-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridgeRoot = join(root, "bridge");
  const outputDirectory = join(root, "runtime");
  const nodeBinaryPath = join(root, "standalone-node");
  const nodeLicensePath = join(root, "Node-LICENSE");
  // A non-executed Mach-O shape fixture; actual standalone Node qualification is
  // a separate root validation with the verified upstream archive.
  const node = Buffer.alloc(64);
  node.writeUInt32LE(0xfeedfacf, 0);
  node.writeUInt32LE(0x0100000c, 4);
  node.writeUInt32LE(2, 12);
  await fixtureFile(nodeBinaryPath, node, 0o755);
  await fixtureFile(nodeLicensePath, "Node license fixture\n");
  const metadata = { name: "blabee-claude-bridge", version: "0.1.0", private: true,
    type: "module", dependencies: { "@modelcontextprotocol/sdk": "1.30.0" } };
  await fixtureFile(join(bridgeRoot, "package.json"), JSON.stringify(metadata));
  const lock = { name: metadata.name, version: metadata.version, lockfileVersion: 3,
    packages: { "": metadata } };
  for (const [name, version] of Object.entries(CLAUDE_RUNTIME_PACKAGES)) {
    lock.packages[`node_modules/${name}`] = { version };
    const packageRoot = join(bridgeRoot, "node_modules", name);
    await fixtureFile(join(packageRoot, "package.json"), JSON.stringify({ name, version, type: "module" }));
    await fixtureFile(join(packageRoot, name === "require-from-string" ? "license" : "LICENSE"), `${name} license fixture\n`);
    for (const child of packageEntries[name]) {
      await fixtureFile(join(packageRoot, child), child.endsWith(".json") ? '{"type":"module"}' : "export {};\n");
    }
    await fixtureFile(join(packageRoot, "test", "ignored.test.js"), "do not package tests\n");
    await fixtureFile(join(packageRoot, "README.md"), "do not package documentation\n");
  }
  // zod's published runtime policy permits compiled exports, so its fixture
  // must put non-runtime tests in src just like the actual installed package.
  await rm(join(bridgeRoot, "node_modules", "zod", "test"), { recursive: true });
  await fixtureFile(join(bridgeRoot, "node_modules", "zod", "src", "ignored.test.ts"), "ignored source\n");
  await fixtureFile(join(bridgeRoot, "package-lock.json"), JSON.stringify(lock));
  for (const name of CLAUDE_RUNTIME_SOURCE_FILES) await fixtureFile(join(bridgeRoot, "src", name), "export {};\n");
  await fixtureFile(join(bridgeRoot, "src", "product-mcp.mjs"), "legacy excluded\n");
  await fixtureFile(join(bridgeRoot, "node_modules", "unrelated", "index.js"), "unrelated excluded\n");
  const options = { bridgeRoot, nodeBinaryPath, nodeLicensePath, nodeVersion: "22.23.2", nodeArch: "arm64", outputDirectory };
  const result = prepared ? await prepareClaudeRuntime(options) : undefined;
  return { root, ...options, manifest: result?.manifest, options };
}
