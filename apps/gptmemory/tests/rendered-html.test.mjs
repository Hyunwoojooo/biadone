import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertAppearsInOrder(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    assert.ok(current > previous, `expected ordered marker: ${marker}`);
    previous = current;
  }
}

test("replaces the starter preview with the GPTMemory product shell", async () => {
  const [page, layout, component, styles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("components/GPTMemoryApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /<GPTMemoryApp \/>/);
  assert.match(page, /긴 대화의 핵심을 10초 안에/);
  assert.match(layout, /lang="ko"/);
  assert.match(layout, /GPTMemory/);
  assert.match(component, /모든 노트/);
  assert.match(component, /즐겨찾기/);
  assert.match(component, /보관함/);
  assert.match(component, /휴지통/);
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
  assert.match(component, /새 내용 노트로 재생성/);
  assert.match(
    component,
    /생성된 요약만 새 내용 중심 노트로 교체되고 기존 편집 본문은\s+보존됩니다/,
  );
  assert.match(
    component,
    /직접 수정하거나 숨긴 항목이 있으면\s+데이터 보호를 위해 재생성을 중단/,
  );
  assert.match(
    component,
    /생성에 실패해도 기존 노트는\s+그대로 유지됩니다/,
  );
  assert.match(component, /summarySchemaVersion/);
  assert.match(component, /note\.contentNote\?\.title\.text/);
  assert.match(component, /note\.contentNote\?\.oneLineSummary\.text/);
  assert.match(component, /note\.stateNote\?\.title\.text/);
  assert.match(component, /note\.summary\?\.title\.text/);
  assert.match(component, /presentStateItem\(stateNote, "confirmedDecisions"/);
  assert.match(
    component,
    /const unresolved = presentStateItems\([\s\S]{0,100}"unresolvedQuestions"/,
  );
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
  assert.match(component, /note\.contentNote \? \(/);
  assert.match(component, /note\.stateNote \? \(/);
  assert.match(component, /note\.summary \? \(/);
  assert.match(component, /<LegacyNoteBody/);
  assert.match(
    component,
    /!note\.summary && !note\.stateNote && !note\.contentNote && !editing && view !== "trash"/,
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
  assert.match(styles, /content-glance/);
  assert.match(styles, /content-topic-list/);
  assert.match(styles, /content-evidence-details/);
  assert.match(styles, /content-supporting-details/);
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

test("renders v4 content-first cards and detail sections while preserving legacy fallbacks", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("components/GPTMemoryApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  const preview = sourceBetween(
    component,
    "function notePreview(note: NoteRecord)",
    "function noteTitle(note: NoteRecord)",
  );
  assert.match(
    preview,
    /note\.contentNote\?\.oneLineSummary\.text \|\|[\s\S]*currentState \|\|[\s\S]*note\.summary\?\.oneLineSummary\.text \|\|[\s\S]*note\.overview \|\|/,
  );

  const title = sourceBetween(
    component,
    "function noteTitle(note: NoteRecord)",
    "function noteHasDecision(note: NoteRecord)",
  );
  assert.match(
    title,
    /note\.contentNote\?\.title\.text \|\|[\s\S]*note\.stateNote\?\.title\.text \|\|[\s\S]*note\.summary\?\.title\.text \|\|[\s\S]*note\.title/,
  );

  const card = sourceBetween(
    component,
    'className={`note-card',
    "</button>",
  );
  assertAppearsInOrder(card, [
    "{noteTitle(note)}",
    "{notePreview(note)}",
    "noteHasDecision(note)",
    "결정 있음",
    "noteHasActionItems(note)",
    "할 일 있음",
    'dateTime={note.updatedAt}',
    "formatDate(note.updatedAt)",
  ]);
  assert.doesNotMatch(card, /noteHasUnresolved|미해결|note\.favorite|note\.tags|mini-tag/);

  const detailDispatch = sourceBetween(
    component,
    "{note.contentNote ? (",
    "{!note.summary && !note.stateNote && !note.contentNote && note.tags.length",
  );
  assertAppearsInOrder(detailDispatch, [
    "<V4ContentNote",
    ") : note.stateNote ? (",
    "<V3StateNote",
    ") : note.summary ? (",
    "<V2Summary",
    "<LegacyNoteBody",
  ]);

  const v4 = sourceBetween(
    component,
    "function V4ContentNote({",
    "function ContentEvidenceList(",
  );
  assertAppearsInOrder(v4, [
    "한눈에 보기",
    "핵심 정리",
    "주제별 정리",
    "<h2>{outcomeHeading}</h2>",
    "다음에 할 일",
    "남은 질문",
    "보조 정보",
    "대화 흐름 상세 보기",
  ]);
  assert.match(v4, /contentNote\.topics\.map/);
  assert.match(
    v4,
    /const outcomeHeading =[\s\S]*\? "결론과 확정된 결정"[\s\S]*\? "결론"[\s\S]*: "확정된 결정"/,
  );
  assert.match(
    v4,
    /\{supporting\.currentState \? \([\s\S]*<aside className="content-current-state"/,
  );
  assert.match(
    v4,
    /<ContentEvidenceDetails[\s\S]{0,120}items=\{\[contentNote\.oneLineSummary\]\}/,
  );
  assert.match(
    v4,
    /<ContentEvidenceDetails[\s\S]{0,160}items=\{contentNote\.keyTakeaways\}/,
  );
  assert.match(
    v4,
    /items=\{\[topic\.title, topic\.summary, \.\.\.topic\.details\]\}/,
  );
  assert.doesNotMatch(v4, /<EvidenceDetails/);
  assert.match(v4, /<details className="content-supporting-details">/);
  assert.doesNotMatch(
    v4,
    /<details className="(?:content-supporting-details|conversation-flow-details)"[^>]*\sopen(?:=|\s|>)/,
  );

  assert.match(styles, /\.content-note\s*\{/);
  assert.match(styles, /\.content-glance\s*\{/);
  assert.match(styles, /\.content-takeaways/);
  assert.match(styles, /\.content-topic-list\s*\{/);
  assert.match(styles, /\.content-topic-summary[\s\S]*white-space:\s*pre-line/);
  assert.match(styles, /\.content-evidence-details\s*\{/);
  assert.match(styles, /\.content-current-state[\s\S]*border-left:/);
  assert.match(styles, /\.content-labeled-list/);
  assert.match(styles, /\.content-supporting-details\s*\{/);
  assert.match(
    styles,
    /@media \(max-width:\s*900px\)[\s\S]*content-supporting-details > summary[\s\S]*min-height:\s*44px/,
  );

  const groupedEvidence = sourceBetween(
    component,
    "function ContentEvidenceDetails({",
    "function contentDetailLabel(",
  );
  assert.match(groupedEvidence, /new Map<string, string\[\]>/);
  assert.match(groupedEvidence, /item\.sourceMessageIds/);
  assert.match(groupedEvidence, /item\.evidenceSnippets/);
  assert.match(groupedEvidence, /aria-label=\{`\$\{label\} 보기`\}/);
  assert.match(groupedEvidence, /\{evidence\.size\}개 메시지/);
});

test("renders evidence-preserving v3 corrections and compact mobile controls", async () => {
  const [component, styles, itemKey] = await Promise.all([
    readFile(new URL("components/GPTMemoryApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("lib/note-state/item-key.ts", root), "utf8"),
  ]);

  assert.match(component, /stateNoteItemKey/);
  assert.match(component, /userCorrections/);
  assert.match(component, /expectedUpdatedAt:\s*note\.updatedAt/);
  assert.match(component, /stateNoteCorrection:\s*correction/);
  assert.match(component, /operation:\s*"override_text"/);
  assert.match(component, /operation:\s*"hide"/);
  assert.match(component, /operation:\s*"restore"/);
  assert.match(component, /사용자 수정/);
  assert.match(component, /원문으로 복원/);
  assert.match(component, /숨긴 항목 \{items\.length\}개/);
  assert.match(component, /visibleCompletedResults\.slice\(-3\)/);
  assert.match(component, /visibleCompletedResults\.slice\(0, -3\)/);
  assert.match(component, /이전 결과 \{additionalCompletedResults\.length\}개 보기/);
  assert.match(component, /추가로 확인된 결정·남은 작업·미해결 항목 없음/);
  assert.match(component, /view === "trash" \? undefined : saveStateNoteCorrection/);

  assert.match(itemKey, /Browser-safe stable identity/);
  assert.match(itemKey, /stateNoteItemKey/);
  assert.doesNotMatch(itemKey, /process\.env|GEMINI_API_KEY/);

  assert.match(styles, /state-correction-controls/);
  assert.match(styles, /state-correction-editor/);
  assert.match(styles, /state-hidden-items/);
  assert.match(styles, /:where\(button, a, summary, input, textarea\):focus-visible/);
  assert.match(
    styles,
    /@media \(max-width:\s*900px\)[\s\S]*state-correction-controls button,[\s\S]*min-height:\s*44px/,
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
