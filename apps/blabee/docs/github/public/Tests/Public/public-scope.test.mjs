import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PublicSourcesError, verifyPublicSources } from "../../scripts/verify-public-sources.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/verify-public-sources.mjs", import.meta.url));
const SECRET_SENTINEL = "PRIVATE_TEST_VALUE_MUST_NOT_APPEAR_IN_DIAGNOSTICS";
const FIXTURE_FILES = [
  ["README.md", "# Public Blabee integration fixtures\n"],
  ["README.ko.md", "# 공개 연동 테스트\n"],
  ["LICENSE", "Fixture license\n"],
  ["NOTICE", "Fixture notices\n"],
  ["CONTRIBUTING.md", "Fixture contribution guide\n"],
  ["SECURITY.md", "Fixture security guide\n"],
  ["CHANGELOG.md", "Fixture changelog\n"],
  ["CHANGELOG.ko.md", "# 앱 변경 이력\n\n## r86\n한국어 패치노트 테스트.\n"],
  ["PUBLIC_SCOPE.md", "Public integration fixture scope.\n"],
  ["package.json", '{"type":"module","private":true}\n'],
  ["package-lock.json", '{"lockfileVersion":3}\n'],
  [".gitignore", "node_modules/\n"],
  ["Contracts/v1/common.schema.json", '{}\n'],
  ["bridges/codex/plugin/scripts/blabee-launcher", "#!/bin/sh\nexit 0\n", "0755"],
  ["bridges/claude/src/session-v2-context.mjs", 'export const fixture = true;\n'],
  ["Tests/Contracts/fixture.test.mjs", 'export {};\n'],
  ["Tests/bridges/claude/fixture.test.mjs", 'export {};\n'],
  ["Tests/Public/fixture.test.mjs", 'export {};\n'],
  ["Tests/CoordinatorOperational/plugin-package.test.mjs", 'export {};\n'],
  ["Fixtures/v1/contracts/valid/action.json", '{}\n'],
  ["examples/README.md", "Integration examples fixture.\n"],
  ["docs/INTEGRATION.md", "Integration guide fixture.\n"],
  [".github/workflows/ci.yml", "name: fixture\n"],
];

async function put(root, relativePath, contents, mode = "0644") {
  const filename = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
  await chmod(filename, Number.parseInt(mode, 8));
}

async function writeManifest(fixture) {
  await put(fixture.root, "PUBLIC_SOURCES.json", `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}

async function makeExport(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), "blabee-public-scope-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "export");
  await mkdir(root);
  const files = [...FIXTURE_FILES, ["scripts/verify-public-sources.mjs", await readFile(SCRIPT), "0755"]];
  const entries = [];
  for (const [relativePath, contents, mode = "0644"] of files) {
    await put(root, relativePath, contents, mode);
    entries.push({
      path: relativePath,
      sha256: createHash("sha256").update(contents).digest("hex"),
      mode,
      origin: relativePath.startsWith("bridges/") ? "source" : "public-template",
    });
  }
  const fixture = {
    root,
    temporary,
    manifest: { schema_version: "1.0", app_release: "0.1.0+build.85", files: entries },
  };
  await writeManifest(fixture);
  return fixture;
}

function rejectsCode(root, code) {
  return assert.rejects(verifyPublicSources(root), (error) => {
    assert.ok(error instanceof PublicSourcesError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes(SECRET_SENTINEL), false);
    return true;
  });
}

async function linkOrSkip(t, target, filename, type = "file") {
  try {
    await symlink(target, filename, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("This filesystem does not permit creating test symbolic links.");
      return false;
    }
    throw error;
  }
}

test("a complete export accepts a declared Korean changelog, both origins and executable files, including the verifier itself", async (t) => {
  const fixture = await makeExport(t);
  assert.deepEqual(await verifyPublicSources(fixture.root), {
    ok: true,
    schemaVersion: "1.0",
    appRelease: "0.1.0+build.85",
    fileCount: fixture.manifest.files.length,
    modeChecked: process.platform !== "win32",
  });
});

test("the CLI accepts an explicit root and resolves its default root independently of cwd", async (t) => {
  const fixture = await makeExport(t);
  for (const args of [[SCRIPT, fixture.root], [path.join(fixture.root, "scripts/verify-public-sources.mjs")]]) {
    const result = spawnSync(process.execPath, args, { cwd: fixture.temporary, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout,
      `Public sources verified: ${fixture.manifest.files.length} files (0.1.0+build.85).\n`
      + (process.platform === "win32" ? "POSIX permission comparison is unavailable on Windows.\n" : ""));
    assert.equal(result.stderr, "");
  }
});

test("the CLI inspects a tampered manifest and exits nonzero with a fixed diagnostic", async (t) => {
  const fixture = await makeExport(t);
  fixture.manifest.files[0].sha256 = "0".repeat(64);
  await writeManifest(fixture);
  for (const args of [[SCRIPT, fixture.root], [path.join(fixture.root, "scripts/verify-public-sources.mjs")]]) {
    const result = spawnSync(process.execPath, args, { cwd: fixture.temporary, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr,
      "Public sources verification failed [HASH_MISMATCH]: A public file has different bytes than declared.\n");
    assert.equal(result.stderr.includes(fixture.root), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  }
});

test("modified bytes, missing declared files, and unlisted files fail independently", async (t) => {
  for (const [name, mutate, code] of [
    ["modified", (fixture) => put(fixture.root, "README.md", SECRET_SENTINEL), "HASH_MISMATCH"],
    ["missing", (fixture) => rm(path.join(fixture.root, "README.md")), "MISSING_FILE"],
    ["unlisted", (fixture) => put(fixture.root, "docs/unlisted.md", SECRET_SENTINEL), "UNLISTED_FILE"],
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await makeExport(subtest);
      await mutate(fixture);
      await rejectsCode(fixture.root, code);
    });
  }
});

test("the Korean changelog must match its manifest entry and remain present", async (t) => {
  for (const [name, mutate, code] of [
    ["modified", (fixture) => put(fixture.root, "CHANGELOG.ko.md", SECRET_SENTINEL), "HASH_MISMATCH"],
    ["missing", (fixture) => rm(path.join(fixture.root, "CHANGELOG.ko.md")), "MISSING_FILE"],
    ["undeclared", async (fixture) => {
      fixture.manifest.files = fixture.manifest.files.filter((entry) => entry.path !== "CHANGELOG.ko.md");
      await writeManifest(fixture);
    }, "UNLISTED_FILE"],
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await makeExport(subtest);
      await mutate(fixture);
      await rejectsCode(fixture.root, code);
    });
  }
});

test("POSIX permissions must match all declared permission bits", { skip: process.platform === "win32" }, async (t) => {
  const fixture = await makeExport(t);
  await chmod(path.join(fixture.root, "README.md"), 0o600);
  await rejectsCode(fixture.root, "MODE_MISMATCH");
});

test("manifest paths reject traversal, absolute and noncanonical platform aliases", async (t) => {
  for (const filename of [
    "../outside.txt", "scripts/../../outside.txt", "/tmp/private.txt", "C:/private.txt", "C:private.txt",
    "scripts\\..\\private.txt", "scripts//extra.mjs", "scripts/./extra.mjs", "scripts/extra.mjs/",
    "scripts/extra.mjs\u0000", "scripts/extra.mjs\n", "scripts/extra.mjs.", "scripts/CON.txt",
  ]) {
    await t.test(JSON.stringify(filename), async (subtest) => {
      const fixture = await makeExport(subtest);
      fixture.manifest.files.push({ ...fixture.manifest.files[0], path: filename });
      await writeManifest(fixture);
      await rejectsCode(fixture.root, "INVALID_PATH");
    });
  }
});

test("manifest paths exclude product implementations, environment, database and credential files", async (t) => {
  for (const filename of [
    "engine/Runtime.swift", "app/Pet.swift", "supabase/config.toml", "account-web/index.html",
    "dev/demo.mjs", "build/Blabee.app", "docs/engine/Runtime.swift", "scripts/.env", "docs/.env.example",
    "examples/state.db", "examples/state.sqlite3-wal", "examples/state.db-journal",
    "docs/credentials.json", "docs/secrets.yaml", "scripts/auth.json", "scripts/service-account.json",
    "examples/id_ed25519", "examples/signing.p12", "examples/private.pem", "examples/user.keychain-db",
    "node_modules/example.mjs", ".git/config", "docs/.aws/config",
  ]) {
    await t.test(filename, async (subtest) => {
      const fixture = await makeExport(subtest);
      fixture.manifest.files.push({ ...fixture.manifest.files[0], path: filename });
      await writeManifest(fixture);
      await rejectsCode(fixture.root, "FORBIDDEN_PATH");
    });
  }
});

test("scope permits only the one approved CoordinatorOperational test and named root files", async (t) => {
  for (const filename of [
    "Tests/CoordinatorOperational/operational-roundtrip.test.mjs", "PRIVATE.md", "bridges/claude/package.json",
    "CHANGELOG.ko-KR.md", "CHANGELOG.ko.md.bak",
  ]) {
    await t.test(filename, async (subtest) => {
      const fixture = await makeExport(subtest);
      fixture.manifest.files.push({ ...fixture.manifest.files[0], path: filename });
      await writeManifest(fixture);
      await rejectsCode(fixture.root, "OUTSIDE_SCOPE");
    });
  }
});

test("actual files and even empty directories cannot bypass the public path policy", async (t) => {
  for (const [filename, directory, code] of [
    ["engine/Private.swift", false, "FORBIDDEN_PATH"],
    ["docs/.env", false, "FORBIDDEN_PATH"],
    ["private", true, "OUTSIDE_SCOPE"],
    ["CHANGELOG.ko.md.bak", false, "OUTSIDE_SCOPE"],
  ]) {
    await t.test(filename, async (subtest) => {
      const fixture = await makeExport(subtest);
      if (directory) await mkdir(path.join(fixture.root, filename));
      else await put(fixture.root, filename, SECRET_SENTINEL);
      await rejectsCode(fixture.root, code);
    });
  }
});

test("duplicate manifest entries and case aliases are rejected", async (t) => {
  for (const filename of ["README.md", "docs/integration.md"]) {
    await t.test(filename, async (subtest) => {
      const fixture = await makeExport(subtest);
      fixture.manifest.files.push({ ...fixture.manifest.files[0], path: filename });
      await writeManifest(fixture);
      await rejectsCode(fixture.root, "DUPLICATE_PATH");
    });
  }
});

test("the manifest cannot declare itself", async (t) => {
  const fixture = await makeExport(t);
  fixture.manifest.files.push({ ...fixture.manifest.files[0], path: "PUBLIC_SOURCES.json" });
  await writeManifest(fixture);
  await rejectsCode(fixture.root, "MANIFEST_SELF_ENTRY");
});

test("manifest metadata and entry fields are strictly validated", async (t) => {
  for (const [name, mutate, code] of [
    ["schema", (value) => { value.schema_version = "2.0"; }, "INVALID_MANIFEST"],
    ["release", (value) => { value.app_release = "0.1.0+build.84"; }, "INVALID_MANIFEST"],
    ["empty", (value) => { value.files = []; }, "INVALID_MANIFEST"],
    ["extra field", (value) => { value.private_path = SECRET_SENTINEL; }, "INVALID_MANIFEST"],
    ["digest", (value) => { value.files[0].sha256 = "not a hash"; }, "INVALID_ENTRY"],
    ["mode", (value) => { value.files[0].mode = "0777"; }, "INVALID_ENTRY"],
    ["origin", (value) => { value.files[0].origin = "private"; }, "INVALID_ENTRY"],
    ["entry extra field", (value) => { value.files[0].secret = SECRET_SENTINEL; }, "INVALID_ENTRY"],
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await makeExport(subtest);
      mutate(fixture.manifest);
      await writeManifest(fixture);
      await rejectsCode(fixture.root, code);
    });
  }
});

test("missing and malformed manifests fail without printing source fragments", async (t) => {
  const fixture = await makeExport(t);
  await rm(path.join(fixture.root, "PUBLIC_SOURCES.json"));
  await rejectsCode(fixture.root, "MISSING_MANIFEST");
  await put(fixture.root, "PUBLIC_SOURCES.json", `{"secret":"${SECRET_SENTINEL}"`);
  await rejectsCode(fixture.root, "INVALID_MANIFEST");
  const result = spawnSync(process.execPath, [SCRIPT, fixture.root], { cwd: fixture.temporary, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[INVALID_MANIFEST\]/u);
  assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  assert.equal(result.stderr.includes(fixture.root), false);
});

test("filesystem errors are sanitized", async (t) => {
  const fixture = await makeExport(t);
  const missing = path.join(fixture.temporary, SECRET_SENTINEL);
  const result = spawnSync(process.execPath, [SCRIPT, missing], { cwd: fixture.temporary, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[FILESYSTEM_ERROR\]/u);
  assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  assert.equal(result.stderr.includes(fixture.temporary), false);
});

test("file, directory, manifest and export-root symbolic links are rejected", async (t) => {
  for (const kind of ["file", "directory", "manifest", "root"]) {
    await t.test(kind, async (subtest) => {
      const fixture = await makeExport(subtest);
      const privateFile = path.join(fixture.temporary, "outside.txt");
      await writeFile(privateFile, SECRET_SENTINEL);
      let root = fixture.root;
      if (kind === "file") {
        const filename = path.join(root, "README.md");
        await rm(filename);
        if (!await linkOrSkip(subtest, privateFile, filename)) return;
      } else if (kind === "directory") {
        if (!await linkOrSkip(subtest, fixture.temporary, path.join(root, "docs/linked"), "dir")) return;
      } else if (kind === "manifest") {
        const filename = path.join(root, "PUBLIC_SOURCES.json");
        await rm(filename);
        if (!await linkOrSkip(subtest, privateFile, filename)) return;
      } else {
        root = path.join(fixture.temporary, "linked-root");
        if (!await linkOrSkip(subtest, fixture.root, root, "dir")) return;
      }
      await rejectsCode(root, "SYMLINK");
    });
  }
});

test("local .git and node_modules entries are excluded from traversal", async (t) => {
  const fixture = await makeExport(t);
  await put(fixture.root, ".git/engine/private.json", SECRET_SENTINEL);
  await put(fixture.root, "node_modules/example/.env", SECRET_SENTINEL);
  await put(fixture.root, "docs/node_modules/example/private.db", SECRET_SENTINEL);
  assert.equal((await verifyPublicSources(fixture.root)).ok, true);
});
