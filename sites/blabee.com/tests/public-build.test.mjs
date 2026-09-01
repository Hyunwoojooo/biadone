import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPublic, PUBLIC_ENTRIES } from "../scripts/build-public.mjs";

const EXPECTED_PUBLIC_ENTRIES = [
  "index.html",
  "404.html",
  "_headers",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "css",
  "js",
  "assets",
  "liquid-glass",
];

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "blabee-public-build-"));

  for (const entry of EXPECTED_PUBLIC_ENTRIES) {
    const entryPath = path.join(root, entry);
    if (["css", "js", "assets", "liquid-glass"].includes(entry)) {
      await mkdir(entryPath, { recursive: true });
      if (entry === "liquid-glass") {
        await writeFile(path.join(entryPath, "index.html"), "liquid-glass/index.html");
      } else {
        await writeFile(path.join(entryPath, `${entry}.txt`), entry);
      }
    } else {
      await writeFile(entryPath, entry);
    }
  }

  await mkdir(path.join(root, "tests"));
  await writeFile(path.join(root, "AGENTS.md"), "internal instructions");
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(path.join(root, "tests", "private.test.mjs"), "internal test");

  return root;
}

test("public allowlist remains explicit and exact", () => {
  assert.deepEqual(PUBLIC_ENTRIES, EXPECTED_PUBLIC_ENTRIES);
});

test("buildPublic creates a clean dist containing only public entries", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const outputRoot = await buildPublic({ sourceRoot: root });
  await writeFile(path.join(outputRoot, "stale-internal-file.txt"), "stale");
  await buildPublic({ sourceRoot: root });

  assert.deepEqual(
    (await readdir(outputRoot)).sort(),
    [...EXPECTED_PUBLIC_ENTRIES].sort(),
  );
  await assert.rejects(readFile(path.join(outputRoot, "AGENTS.md")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(outputRoot, "package.json")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(outputRoot, "tests", "private.test.mjs")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(path.join(outputRoot, "stale-internal-file.txt")), {
    code: "ENOENT",
  });
  assert.equal(await readFile(path.join(outputRoot, "index.html"), "utf8"), "index.html");
  assert.equal(
    await readFile(path.join(outputRoot, "liquid-glass", "index.html"), "utf8"),
    "liquid-glass/index.html",
  );
});

test("buildPublic rejects a missing allowlisted entry before replacing dist", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "dist"));
  await writeFile(path.join(root, "dist", "keep.txt"), "keep");
  await rm(path.join(root, "robots.txt"));

  await assert.rejects(
    buildPublic({ sourceRoot: root }),
    /Missing public entry: robots\.txt/,
  );
  assert.equal(await readFile(path.join(root, "dist", "keep.txt"), "utf8"), "keep");
});

test("buildPublic rejects symbolic links in public sources", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(path.join(root, "assets", "assets.txt"));
  await symlink(path.join(root, "index.html"), path.join(root, "assets", "linked.txt"));

  await assert.rejects(
    buildPublic({ sourceRoot: root }),
    /Symbolic links are not allowed in the public build: assets\/linked\.txt/,
  );
});
