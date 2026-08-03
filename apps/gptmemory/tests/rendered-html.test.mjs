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
  assert.match(page, /대화가 도달한 상태를 10초 안에/);
  assert.match(layout, /lang="ko"/);
  assert.match(layout, /GPTMemory/);
  assert.match(component, /All Notes/);
  assert.match(component, /Favorites/);
  assert.match(component, /Archive/);
  assert.match(component, /Trash/);
  assert.match(component, /\/api\/notes\/import/);
  assert.match(component, /공개 공유 링크만 지원합니다/);
  assert.match(component, /Google Gemini API로/);
  assert.match(
    component,
    /원본 공유 HTML과 복원된 전체 메시지 배열은[\s\S]{0,50}GPTMemory에 저장하지 않습니다/,
  );
  assert.match(component, /선택된 짧은 문장만 메시지 ID와 함께 노트에/);
  assert.doesNotMatch(
    component,
    /외부 AI를 호출하지|외부 AI로 전송하지 않습니다/,
  );
  assert.doesNotMatch(component, /GEMINI_API_KEY|process\.env/);
  assert.match(component, /already_exists/);
  assert.match(component, /expectedUpdatedAt/);
  assert.match(component, /이미 가져온 대화입니다/);
  assert.match(component, /기존 노트 열기/);
  assert.match(component, /새 상태 노트로 재생성/);
  assert.match(component, /새 상태 노트만 갱신되고 기존 편집 본문은 보존됩니다/);
  assert.match(
    component,
    /생성에\s+실패하면 기존 노트는 그대로 유지됩니다/,
  );
  assert.match(component, /summarySchemaVersion/);
  assert.match(component, /note\.stateNote\?\.title\.text/);
  assert.match(component, /note\.summary\?\.title\.text/);
  assert.match(component, /note\.stateNote\.confirmedDecisions\.length/);
  assert.match(component, /note\.stateNote\.openActions\.length/);
  assert.match(component, /note\.stateNote\?\.unresolvedQuestions\.length/);
  assert.match(
    component,
    /outcomes\.some\(\(outcome\) => outcome\.kind === "decision"\)/,
  );
  assert.match(component, /Boolean\(note\.summary\?\.actionItems\.length\)/);
  assert.match(component, /결정 있음/);
  assert.match(component, /할 일 있음/);
  assert.match(component, /확정된 결정/);
  assert.match(component, /제안/);
  assert.match(component, /미해결/);
  assert.match(component, /<details className="conversation-flow-details">/);
  assert.doesNotMatch(
    component,
    /<details className="conversation-flow-details"[^>]*\sopen(?:=|\s|>)/,
  );
  assert.match(component, /<summary>대화 흐름 상세 보기<\/summary>/);
  assert.match(component, /stateNote \? \(/);
  assert.match(component, /note\.summary \? \(/);
  assert.match(component, /<LegacyNoteBody/);
  assert.match(
    component,
    /!note\.summary && !note\.stateNote && !editing && view !== "trash"/,
  );
  assert.match(component, /aria-describedby="import-description gemini-transfer-notice"/);
  const cardStart = component.indexOf('className={`note-card');
  const cardEnd = component.indexOf("</button>", cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  const cardMarkup = component.slice(cardStart, cardEnd);
  assert.doesNotMatch(cardMarkup, /note\.favorite|note\.tags|mini-tag/);
  assert.doesNotMatch(component, /Entity Graph|Extraction Monitor|Knowledge Graph/);

  assert.match(styles, /grid-template-columns:\s*232px/);
  assert.match(styles, /data-mobile-pane/);
  assert.match(styles, /existing-note-card/);
  assert.match(styles, /note-card-signal\.decision/);
  assert.match(styles, /note-card-signal\.action/);
  assert.match(styles, /compressed-summary/);
  assert.match(styles, /state-current-card/);
  assert.match(styles, /state-evidence/);
  assert.match(styles, /outcome-kind\.decision/);
  assert.match(styles, /conversation-flow-details/);
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
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, null);
  if (hosting.project_id !== undefined) {
    assert.match(hosting.project_id, /^appgprj_[a-z0-9]+$/);
  }
});

test("offers an accessible two-step permanent delete only from Trash", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("components/GPTMemoryApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(
    component,
    /view === "trash" \? \([\s\S]{0,900}setPermanentDeleteOpen\(true\)[\s\S]{0,200}영구 삭제/,
  );
  assert.match(component, /\?permanent=true/);
  assert.match(component, /role="alertdialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /aria-labelledby="permanent-delete-title"/);
  assert.match(component, /aria-describedby="permanent-delete-description"/);
  assert.match(component, /이 작업은 취소하거나 복원할 수 없습니다/);
  assert.match(component, /permanentDeleteInFlight\.current/);
  assert.match(component, /disabled=\{permanentlyDeleting\}/);
  assert.match(component, /role="alert"/);
  assert.match(component, /onRemoved\(note\.id\)/);
  assert.match(
    component,
    /setNotes\(\(current\) => current\.filter\(\(note\) => note\.id !== id\)\)/,
  );
  assert.match(
    component,
    /setSelectedId\(\(current\) => \(current === id \? null : current\)\)/,
  );
  assert.match(
    component,
    /if \(selectedId !== null\) return;[\s\S]{0,160}setMobilePane\("list"\)/,
  );
  assert.doesNotMatch(component, /const removedIndex = notes\.findIndex/);
  assert.match(component, /휴지통이 비어 있어요/);
  assert.match(component, /모두 영구 삭제되었습니다/);

  assert.match(styles, /danger-toolbar-button/);
  assert.match(styles, /permanent-delete-dialog/);
  assert.match(styles, /permanent-delete-action/);
  assert.match(styles, /permanent-delete-error/);
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
  assert.match(database, /addNullableTextColumn\(database, column\)/);
  assert.doesNotMatch(migration, /ALTER TABLE/);
  assert.match(migration, /SELECT 1/);
  assert.match(
    schema,
    /generationMetadataJson: text\("generation_metadata_json"\)/,
  );
});
