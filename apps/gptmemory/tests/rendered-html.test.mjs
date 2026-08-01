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
  assert.match(component, /already_exists/);
  assert.match(component, /expectedUpdatedAt/);
  assert.match(component, /이미 가져온 대화입니다/);
  assert.match(component, /기존 노트 열기/);
  assert.match(component, /다시 생성/);
  assert.match(component, /생성에 실패하면 기존 노트는 그대로 유지됩니다/);
  assert.doesNotMatch(component, /Entity Graph|Extraction Monitor|Knowledge Graph/);

  assert.match(styles, /grid-template-columns:\s*232px/);
  assert.match(styles, /data-mobile-pane/);
  assert.match(styles, /existing-note-card/);
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

test("declares the duplicate-safe import and generation metadata contract", async () => {
  const [
    importRoute,
    notesRoute,
    repository,
    noteImportService,
    shared,
    database,
    schema,
    migration,
  ] =
    await Promise.all([
      readFile(new URL("app/api/notes/import/route.ts", root), "utf8"),
      readFile(new URL("app/api/notes/route.ts", root), "utf8"),
      readFile(new URL("app/api/notes/_repository.ts", root), "utf8"),
      readFile(new URL("lib/note-import/index.ts", root), "utf8"),
      readFile(new URL("app/api/notes/_shared.ts", root), "utf8"),
      readFile(new URL("db/index.ts", root), "utf8"),
      readFile(new URL("db/schema.ts", root), "utf8"),
      readFile(
        new URL("drizzle/0001_add_note_generation_metadata.sql", root),
        "utf8",
      ),
    ]);

  assert.match(
    importRoute,
    /const ownerKey = requireOwnerKey\(request\);[\s\S]*importService\.execute\(command\)/,
  );
  assert.match(
    importRoute,
    /case "already_exists":[\s\S]*jsonResponse\(result, 409\)/,
  );
  assert.match(
    importRoute,
    /case "created":[\s\S]*jsonResponse\(result, 201\)/,
  );
  assert.match(
    importRoute,
    /case "replaced":[\s\S]*jsonResponse\(result, 200\)/,
  );
  assert.match(importRoute, /NOTE_CHANGED_SINCE_CONFIRMATION/);
  assert.match(importRoute, /expectedUpdatedAt/);

  assert.match(notesRoute, /result\.disposition === "created" \? 201 : 200/);
  assert.match(repository, /generation_metadata_json/);
  assert.match(noteImportService, /sourceContentSha256/);
  assert.doesNotMatch(shared, /generationMetadata/);
  assert.match(repository, /expectedUpdatedAt/);
  assert.match(
    database,
    /ALTER TABLE notes ADD COLUMN generation_metadata_json TEXT/,
  );
  assert.doesNotMatch(migration, /ALTER TABLE/);
  assert.match(migration, /SELECT 1/);
  assert.match(
    schema,
    /generationMetadataJson: text\("generation_metadata_json"\)/,
  );
});
