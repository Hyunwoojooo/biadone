import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("fresh runtime schema contains nullable generated and timeline columns", async () => {
  const databaseSource = await readFile(new URL("db/index.ts", appRoot), "utf8");
  const createTable = databaseSource.match(
    /const CREATE_NOTES_TABLE_SQL = `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(createTable, "runtime CREATE TABLE SQL should be discoverable");

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(createTable);
    const columns = database.prepare("PRAGMA table_info(notes)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const byName = new Map(columns.map((column) => [column.name, column]));

    assert.equal(byName.get("summary_schema_version")?.notnull, 0);
    assert.equal(byName.get("summary_json")?.notnull, 0);
    assert.equal(byName.get("source_timeline_at")?.notnull, 0);
    assert.equal(byName.get("source_last_visible_at")?.notnull, 0);
    assert.equal(
      byName.get("source_timestamped_visible_message_count")?.notnull,
      0,
    );
    assert.equal(byName.get("source_visible_message_count")?.notnull, 0);
  } finally {
    database.close();
  }
});

test("additive generated and timeline columns preserve an existing edited row", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY NOT NULL,
        owner_key TEXT NOT NULL,
        title TEXT NOT NULL,
        overview TEXT NOT NULL DEFAULT '',
        sections_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_url TEXT,
        source_title TEXT,
        source_message_count INTEGER,
        generation_metadata_json TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO notes (
        id, owner_key, title, overview, sections_json, tags_json,
        source_url, source_title, source_message_count,
        generation_metadata_json, favorite, archived, deleted_at,
        created_at, updated_at
      ) VALUES (
        'v1-note', 'owner-a', '사용자 제목', '사용자 개요',
        '[{"id":"edited","body":"사용자 본문"}]', '["사용자태그"]',
        'https://chatgpt.com/share/v1', '원본 제목', 3,
        '{"workflowVersion":"gptmemory-note-import.v2"}', 1, 1, NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
      );
    `);
    const before = database
      .prepare("SELECT * FROM notes WHERE id = 'v1-note'")
      .get();

    database.exec("ALTER TABLE notes ADD COLUMN summary_schema_version TEXT");
    database.exec("ALTER TABLE notes ADD COLUMN summary_json TEXT");
    database.exec("ALTER TABLE notes ADD COLUMN source_timeline_at TEXT");
    database.exec("ALTER TABLE notes ADD COLUMN source_last_visible_at TEXT");
    database.exec(
      "ALTER TABLE notes ADD COLUMN source_timestamped_visible_message_count INTEGER",
    );
    database.exec(
      "ALTER TABLE notes ADD COLUMN source_visible_message_count INTEGER",
    );

    const after = database
      .prepare("SELECT * FROM notes WHERE id = 'v1-note'")
      .get();
    const legacyAfter = Object.fromEntries(
      Object.entries(after ?? {}).filter(
        ([key]) =>
          ![
            "summary_schema_version",
            "summary_json",
            "source_timeline_at",
            "source_last_visible_at",
            "source_timestamped_visible_message_count",
            "source_visible_message_count",
          ].includes(key),
      ),
    );
    assert.deepEqual(legacyAfter, Object.fromEntries(Object.entries(before ?? {})));
    assert.equal(after?.summary_schema_version, null);
    assert.equal(after?.summary_json, null);
    assert.equal(after?.source_timeline_at, null);
    assert.equal(after?.source_last_visible_at, null);
    assert.equal(after?.source_timestamped_visible_message_count, null);
    assert.equal(after?.source_visible_message_count, null);
  } finally {
    database.close();
  }
});

test("runtime bootstrap and Drizzle lineage agree on v2 summary columns", async () => {
  const [databaseSource, snapshotSource, migrationSource] = await Promise.all([
    readFile(new URL("db/index.ts", appRoot), "utf8"),
    readFile(new URL("drizzle/meta/0002_snapshot.json", appRoot), "utf8"),
    readFile(new URL("drizzle/0002_add_note_summary_v2.sql", appRoot), "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotSource) as {
    tables?: { notes?: { columns?: Record<string, unknown> } };
  };

  assert.match(databaseSource, /"summary_schema_version"/);
  assert.match(databaseSource, /"summary_json"/);
  assert.ok(snapshot.tables?.notes?.columns?.summary_schema_version);
  assert.ok(snapshot.tables?.notes?.columns?.summary_json);
  assert.match(migrationSource, /SELECT 1;/);
});

test("runtime bootstrap and Drizzle lineage agree on source timeline columns", async () => {
  const [databaseSource, snapshotSource, migrationSource] = await Promise.all([
    readFile(new URL("db/index.ts", appRoot), "utf8"),
    readFile(new URL("drizzle/meta/0003_snapshot.json", appRoot), "utf8"),
    readFile(
      new URL("drizzle/0003_add_note_source_timeline.sql", appRoot),
      "utf8",
    ),
  ]);
  const snapshot = JSON.parse(snapshotSource) as {
    tables?: { notes?: { columns?: Record<string, unknown> } };
  };

  for (const column of [
    "source_timeline_at",
    "source_last_visible_at",
    "source_timestamped_visible_message_count",
    "source_visible_message_count",
  ]) {
    assert.match(databaseSource, new RegExp(`"${column}"`));
    assert.ok(snapshot.tables?.notes?.columns?.[column]);
  }
  assert.match(migrationSource, /SELECT 1;/);
});

test("conditional reimport updates only summary and source metadata", async () => {
  const repositorySource = await readFile(
    new URL("app/api/notes/_repository.ts", appRoot),
    "utf8",
  );
  const update = repositorySource.match(
    /UPDATE notes([\s\S]*?)RETURNING \$\{PUBLIC_NOTE_COLUMNS\}/,
  )?.[1];
  assert.ok(update, "conditional imported-note UPDATE should be discoverable");

  assert.match(update, /summary_schema_version = \?/);
  assert.match(update, /summary_json = \?/);
  assert.match(update, /generation_metadata_json = \?/);
  assert.match(update, /source_message_count = \?/);
  assert.match(update, /source_timeline_at = \?/);
  assert.match(update, /source_last_visible_at = \?/);
  assert.match(update, /source_timestamped_visible_message_count = \?/);
  assert.match(update, /source_visible_message_count = \?/);
  assert.match(update, /updated_at = \?/);
  assert.match(update, /AND updated_at = \?/);
  for (const preservedColumn of [
    "title",
    "overview",
    "sections_json",
    "tags_json",
    "favorite",
    "archived",
    "deleted_at",
    "created_at",
  ]) {
    assert.doesNotMatch(
      update,
      new RegExp(`^\\s*${preservedColumn}\\s*=`, "m"),
    );
  }
});

test("timeline view is owner-scoped, active-only, imported-only, and null-last", async () => {
  const repositorySource = await readFile(
    new URL("app/api/notes/_repository.ts", appRoot),
    "utf8",
  );

  assert.match(repositorySource, /conditions = \["owner_key = \?"\]/);
  assert.match(repositorySource, /case "timeline":[\s\S]*?"deleted_at IS NULL"/);
  assert.match(repositorySource, /case "timeline":[\s\S]*?"archived = 0"/);
  assert.match(repositorySource, /case "timeline":[\s\S]*?"source_url IS NOT NULL"/);
  assert.match(
    repositorySource,
    /CASE WHEN source_timeline_at IS NULL THEN 1 ELSE 0 END ASC/,
  );
  assert.match(repositorySource, /source_timeline_at DESC/);
});
