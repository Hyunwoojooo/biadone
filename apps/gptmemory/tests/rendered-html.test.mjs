import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("replaces the starter preview with the GPTMemory product shell", async () => {
  const [page, layout, component, styles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("components/GPTMemoryApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /<GPTMemoryApp \/>/);
  assert.match(page, /대화를 다시 읽는 노트/);
  assert.match(layout, /lang="ko"/);
  assert.match(layout, /GPTMemory/);
  assert.match(component, /All Notes/);
  assert.match(component, /Favorites/);
  assert.match(component, /Archive/);
  assert.match(component, /Trash/);
  assert.match(component, /\/api\/notes\/import/);
  assert.match(component, /공개 공유 링크만 지원합니다/);
  assert.doesNotMatch(component, /Entity Graph|Extraction Monitor|Knowledge Graph/);

  assert.match(styles, /grid-template-columns:\s*232px/);
  assert.match(styles, /data-mobile-pane/);
  assert.match(styles, /@media \(max-width:\s*900px\)/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)),
  );
});

test("declares durable D1 storage and keeps R2 disabled", async () => {
  const hosting = JSON.parse(
    await readFile(new URL(".openai/hosting.json", root), "utf8"),
  );
  assert.deepEqual(hosting, { d1: "DB", r2: null });
});
